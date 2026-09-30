import { useEffect, useMemo, useRef, useState } from "react";
import { CRANES, allCranes, getCrane, registerCustomCranes } from "./data/cranes";
import { loadCustomCranes, saveCustomCranes } from "./data/customCranes";
import { computeLiftFull, type FullLiftResult } from "./engine/index";
import {
  defaultProjectMeta,
  defaultState,
  liftInputsFromState,
  riggingTotals,
  type ProjectMeta,
  type UIState,
  type WorkStep,
  type StepSummary,
} from "./ui/state";
import ConfigSidebar from "./ui/ConfigSidebar";
import InputForm from "./ui/InputForm";
import ResultsPanel from "./ui/ResultsPanel";
import CraneSideView2D from "./ui/CraneSideView2D";
import { getCapacityCurve } from "./engine/capacity";
import Crane3D from "./ui/Crane3D";
import GroundForceDiagram from "./ui/GroundForceDiagram";
import ObjectLibrary from "./ui/ObjectLibrary";
import StepsBar from "./ui/StepsBar";
import SitePlan from "./ui/SitePlan";
import ProjectMetaDialog from "./ui/ProjectMetaDialog";
import SelectionWizard from "./ui/SelectionWizard";
import MachinesDialog from "./ui/MachinesDialog";
import ReportDesigner from "./ui/ReportDesigner";
import RiggingEditor from "./ui/RiggingEditor";
import ReachMapView from "./ui/ReachMapView";
import ZoomPan from "./ui/ZoomPan";
import ProjectHome from "./ui/ProjectHome";
import { addRecent, getProjectStore, type ProjectEntry, type ExternalFile } from "./ui/projectStore";
import LoadChartGraph from "./ui/LoadChartGraph";
import LiftPathPanel from "./ui/LiftPathPanel";
import TandemPanel from "./ui/TandemPanel";
import SafetyPanel from "./ui/SafetyPanel";
import ChecklistPanel from "./ui/ChecklistPanel";
import ApprovalPanel from "./ui/ApprovalPanel";
import { computeReachMap } from "./engine/reachMap";
import { planLiftPath, simulateLiftPath, siteToSlewRadius, type LiftPose } from "./engine/liftPath";
import { computeTandem, tandemHookSite } from "./engine/tandem";
import { slingLegForces } from "./engine/slings";
import { outriggerXs } from "./ui/craneRig";
import { loadReportOptions, saveReportOptions, type ReportOptions } from "./ui/reportOptions";
import { Section, SidePanel, Menu } from "./ui/shell";
import { useUpdater } from "./ui/useUpdater";
import UpdateBanner from "./ui/UpdateBanner";
import { useUndoableState } from "./ui/useUndoableState";
import {
  downloadProjectFile,
  hasDroppedModels,
  loadAutosave,
  saveAutosave,
  serializeProject,
  tryParseProject,
  type PersistedProject,
} from "./ui/persistence";
import { generateReport, generateMultiStepReport } from "./ui/report";
// Logo'yu modül olarak içe aktar → Vite paketleyip base'e göre göreli yol üretir,
// böylece hem dev hem de paketlenmiş (file://) uygulamada doğru yüklenir.
import logoW from "./assets/brand/logo_w.png";
import { tStatic, useI18n } from "./ui/i18n";
import { useUnits } from "./ui/units";

// "Makinelerim": kullanıcı vinçleri autosave geri yüklenmeden ÖNCE kayda girmeli.
registerCustomCranes(loadCustomCranes());

/** localStorage'daki autosave'i doğrular (vinç modeli hâlâ mevcut mu) ve
 * ilk state/steps/meta üçlüsünü döndürür. Bozuk/eski/geçersiz veri → null (varsayılana dönülür). */
function restoreFromAutosave(): {
  state: UIState;
  steps: WorkStep[];
  meta: ProjectMeta;
  droppedModels: boolean;
} | null {
  const data = loadAutosave();
  if (!data) return null;
  try {
    getCrane(data.state.craneModel);
  } catch {
    return null;
  }
  const droppedModels =
    hasDroppedModels(data.state.objects) ||
    data.steps.some((s) => hasDroppedModels(s.config.objects));
  return { state: data.state, steps: data.steps, meta: data.meta, droppedModels };
}

type CurrentProject =
  | { kind: "library"; id: string; name: string }
  | { kind: "external"; path: string; name: string }
  | { kind: "unsaved"; name: string };

const CURRENT_PROJECT_KEY = "hareket_current_project";

/** Son oturumda açık olan projenin referansı (devam et → aynı dosyaya kaydetmeyi sürdür). */
function loadCurrentProjectRef(): CurrentProject | null {
  try {
    const raw = localStorage.getItem(CURRENT_PROJECT_KEY);
    const v = raw ? (JSON.parse(raw) as CurrentProject) : null;
    return v && typeof v === "object" && "kind" in v ? v : null;
  } catch {
    return null;
  }
}

type ViewKey = "2d" | "3d" | "ground" | "reach" | "site";
const VIEWS: Array<{ key: ViewKey; icon: string; label: string }> = [
  { key: "2d", icon: "▦", label: "2B Yan" },
  { key: "3d", icon: "◈", label: "3B Model" },
  { key: "ground", icon: "⊕", label: "Üstten" },
  { key: "reach", icon: "▣", label: "Kapasite Haritası" },
  { key: "site", icon: "🛰", label: "Saha" },
];

export default function App() {
  const { t, lang, setLang } = useI18n();
  const u = useUnits();
  /** Metrikte eski biçim ("12.5m"), imperial'de "41.0 ft". */
  const lenTxt = (m: number, d = 1) => (u.imperial ? `${u.fmtLenN(m, d)} ft` : `${m}m`);
  const massTxt = (tn: number) => (u.imperial ? u.fmtMass(tn) : `${tn}t`);
  // Açılışta bir kez: localStorage autosave'i doğrula ve geri yükle (bozuk/eski
  // veri veya tanınmayan vinç modeli → sessizce varsayılana düş).
  const [restored] = useState(() => restoreFromAutosave());

  const {
    state,
    set: setStateFull,
    undo,
    redo,
    canUndo,
    canRedo,
    replace: replaceState,
  } = useUndoableState<UIState>(() => restored?.state ?? defaultState(CRANES[0]));
  const [tab, setTab] = useState<ViewKey>("3d");
  // Al–bırak oynatma/önizleme: aktifken görünüm ve hesap bu pozu gösterir (plan değişmez).
  const [previewPose, setPreviewPose] = useState<LiftPose | null>(null);
  const [steps, setSteps] = useState<WorkStep[]>(() => restored?.steps ?? []);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [modelsNotice, setModelsNotice] = useState(restored?.droppedModels ?? false);
  const [meta, setMeta] = useState<ProjectMeta>(() => restored?.meta ?? defaultProjectMeta());
  const [showMetaDialog, setShowMetaDialog] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showMachines, setShowMachines] = useState(false);
  const [showReportDesigner, setShowReportDesigner] = useState(false);
  const [reportOpts, setReportOpts] = useState<ReportOptions>(() => loadReportOptions());
  const [customCranes, setCustomCranes] = useState(() => loadCustomCranes());
  const craneList = useMemo(() => {
    registerCustomCranes(customCranes);
    return allCranes();
  }, [customCranes]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  // PDF raporuna gömülecek çizimler için ekran dışında (görünmez) render edilen
  // kapsayıcılar — hangi sekme açık olursa olsun her zaman DOM'da mevcutturlar
  // (bkz. ui/report.ts captureSvgContainer). CraneSideView2D/
  // GroundForceDiagram bileşenleri değiştirilmez; yalnızca dıştan sarılır.
  const exportSideRef = useRef<HTMLDivElement>(null);
  const exportTopRef = useRef<HTMLDivElement>(null);
  const updater = useUpdater();

  const crane = useMemo(() => getCrane(state.craneModel), [state.craneModel]);

  const set = (patch: Partial<UIState>) => {
    setStateFull((prev) => {
      let next = { ...prev, ...patch };
      if (patch.craneModel) {
        const c = getCrane(patch.craneModel);
        next = {
          ...next,
          boom_length: c.boom_lengths.includes(next.boom_length) ? next.boom_length : c.boom_lengths[0],
          counterweight: c.counterweight_options.includes(next.counterweight)
            ? next.counterweight
            : c.counterweight_options[c.counterweight_options.length - 1],
          outrigger_config: c.outrigger_configs.includes(next.outrigger_config)
            ? next.outrigger_config
            : c.outrigger_configs[0],
          capacity_pct: (c.capacity_pct_options ?? [75, 85]).includes(next.capacity_pct)
            ? next.capacity_pct
            : (c.capacity_pct_options ?? [75, 85])[0],
          // Vinçte jib tablosu yoksa jib modundan çık.
          lift_config: c.jib_charts ? next.lift_config : "T",
        };
      }
      return next;
    });
    setActiveStepId(null);
  };

  // ── Otomatik kaydetme (debounce'lu) ─────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => saveAutosave(state, steps, meta), 800);
    return () => clearTimeout(t);
  }, [state, steps, meta]);

  // ── Proje kütüphanesi: açılış ekranı + aktif projeye otomatik kayıt ─────────
  const store = useMemo(() => getProjectStore(), []);
  const [screen, setScreen] = useState<"home" | "editor">("home");
  const [currentProject, setCurrentProject] = useState<CurrentProject | null>(() => loadCurrentProjectRef());
  const [saveInfo, setSaveInfo] = useState<{ at: string | null; error: string | null }>({ at: null, error: null });
  // Proje yüklendikten hemen sonraki ilk değişiklik yazılmaz (yükleme = değişiklik değil).
  const skipNextProjectSave = useRef(true);
  const pendingSave = useRef<string | null>(null);

  useEffect(() => {
    try {
      if (currentProject) localStorage.setItem(CURRENT_PROJECT_KEY, JSON.stringify(currentProject));
      else localStorage.removeItem(CURRENT_PROJECT_KEY);
    } catch {
      /* depolama yok */
    }
  }, [currentProject]);

  const writeProject = async (cp: CurrentProject, content: string): Promise<CurrentProject> => {
    if (cp.kind === "library") {
      const e = await store.write({ id: cp.id, name: cp.name, content });
      return { kind: "library", id: e.id, name: e.name };
    }
    if (cp.kind === "external" && store.writeExternal) {
      await store.writeExternal(cp.path, content);
      return cp;
    }
    // Kaydedilmemiş → kütüphane köküne yeni proje.
    const e = await store.write({ folder: "", name: cp.name || meta.projectName || t("Adsız proje"), content });
    addRecent({ kind: "library", id: e.id, name: e.name, craneModel: state.craneModel });
    return { kind: "library", id: e.id, name: e.name };
  };

  const saveNow = async () => {
    const content = serializeProject(state, steps, meta);
    const cp: CurrentProject = currentProject ?? { kind: "unsaved", name: meta.projectName || t("Adsız proje") };
    try {
      const next = await writeProject(cp, content);
      pendingSave.current = null;
      if (next.kind !== cp.kind || (next.kind === "library" && cp.kind === "library" && next.id !== cp.id)) setCurrentProject(next);
      setSaveInfo({ at: new Date().toISOString(), error: null });
    } catch (e) {
      setSaveInfo({ at: null, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // Açık kütüphane/harici projeye 1,5 s gecikmeli otomatik kayıt.
  useEffect(() => {
    if (screen !== "editor" || !currentProject || currentProject.kind === "unsaved") return;
    if (skipNextProjectSave.current) {
      skipNextProjectSave.current = false;
      return;
    }
    pendingSave.current = "pending";
    const h = setTimeout(() => void saveNowRef.current(), 1500);
    return () => clearTimeout(h);
  }, [state, steps, meta, currentProject, screen]);

  const saveAs = async () => {
    const content = serializeProject(state, steps, meta);
    const base = currentProject?.name || meta.projectName || t("Adsız proje");
    try {
      if (store.saveAsDialog) {
        const r = await store.saveAsDialog(base, content);
        if (!r) return;
        setCurrentProject({ kind: "external", path: r.path, name: r.name });
        addRecent({ kind: "external", id: r.path, name: r.name, craneModel: state.craneModel });
      } else {
        const name = window.prompt(t("Yeni proje adı"), base + " (2)");
        if (!name) return;
        const e = await store.write({ folder: "", name, content });
        setCurrentProject({ kind: "library", id: e.id, name: e.name });
        addRecent({ kind: "library", id: e.id, name: e.name, craneModel: state.craneModel });
      }
      skipNextProjectSave.current = true;
      setSaveInfo({ at: new Date().toISOString(), error: null });
    } catch (e) {
      setSaveInfo({ at: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Ayrıştırılmış projeyi editöre yükler (geri al geçmişi sıfırlanır). */
  const applyProject = (data: PersistedProject): boolean => {
    try {
      getCrane(data.state.craneModel);
    } catch {
      window.alert(t("Proje dosyasındaki vinç modeli tanınmıyor: {model}", { model: data.state.craneModel }));
      return false;
    }
    skipNextProjectSave.current = true;
    replaceState(data.state);
    setSteps(data.steps);
    setMeta(data.meta);
    setActiveStepId(null);
    setPreviewPose(null);
    setSaveInfo({ at: null, error: null });
    setModelsNotice(hasDroppedModels(data.state.objects) || data.steps.some((st) => hasDroppedModels(st.config.objects)));
    return true;
  };

  const openFromHome = (
    p:
      | { source: "library"; entry: ProjectEntry; content: string }
      | { source: "external"; file: ExternalFile }
      | { source: "upload"; name: string; content: string },
  ) => {
    const content = p.source === "library" ? p.content : p.source === "external" ? p.file.content : p.content;
    const data = tryParseProject(content);
    if (!data) {
      window.alert(t("Geçersiz veya desteklenmeyen proje dosyası."));
      return;
    }
    if (!applyProject(data)) return;
    if (p.source === "library") setCurrentProject({ kind: "library", id: p.entry.id, name: p.entry.name });
    else if (p.source === "external") {
      setCurrentProject({ kind: "external", path: p.file.path, name: p.file.name });
      addRecent({ kind: "external", id: p.file.path, name: p.file.name, craneModel: data.state.craneModel });
    } else setCurrentProject({ kind: "unsaved", name: p.name });
    setScreen("editor");
  };

  const newFromHome = async (p: { name: string; folder: string; craneModel: string; meta: { projectName: string; siteLocation: string; client: string } }) => {
    const c = getCrane(p.craneModel);
    const st = defaultState(c);
    const m = { ...defaultProjectMeta(), ...p.meta, projectName: p.meta.projectName || p.name };
    try {
      const e = await store.write({ folder: p.folder, name: p.name, content: serializeProject(st, [], m) });
      applyProject({ version: 2, state: st, steps: [], meta: m });
      setCurrentProject({ kind: "library", id: e.id, name: e.name });
      addRecent({ kind: "library", id: e.id, name: e.name, craneModel: c.model });
      setScreen("editor");
    } catch (err) {
      window.alert(t("Proje oluşturulamadı: {msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const goHome = async () => {
    if (pendingSave.current && currentProject && currentProject.kind !== "unsaved") await saveNowRef.current();
    setPreviewPose(null);
    setScreen("home");
  };

  const viewState: UIState = useMemo(
    () =>
      previewPose
        ? { ...state, radius: previewPose.radius, slew_angle: previewPose.slew, load_bottom_height: previewPose.load_bottom_height }
        : state,
    [state, previewPose],
  );

  const { result, error } = useMemo<{
    result: FullLiftResult | null;
    error: string | null;
  }>(() => {
    try {
      const r = computeLiftFull(crane, liftInputsFromState(viewState), {
        outrigger_config: state.outrigger_config,
        slew_angle: viewState.slew_angle,
        crane_heading: state.crane_heading ?? 0,
        crane_position: { x: state.crane_x ?? 0, z: state.crane_z ?? 0 },
        // Esnek: tablo dışı radius / erişilemez geometri hata fırlatmaz → tüm
        // görünümler çizilmeye devam eder, uyarı gösterilir (geri sürüklenebilir).
        lenient: true,
        pad_area: state.pad_area_m2,
        allowable_bearing_t_m2: state.allowable_bearing_t_m2,
        objects: state.objects,
        jib:
          state.lift_config !== "T"
            ? {
                config: state.lift_config,
                jib_length: state.jib_length,
                jib_offset: state.jib_offset,
              }
            : undefined,
      });
      return { result: r, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [crane, state, viewState]);

  // ── Saha geometrisi: vinç konumu/yönü, ana kanca, ayak tablaları ────────────
  const craneX = state.crane_x ?? 0;
  const craneZ = state.crane_z ?? 0;
  const heading = state.crane_heading ?? 0;
  const mainHookSite = useMemo(() => {
    const a = ((heading + viewState.slew_angle) * Math.PI) / 180;
    return { x: craneX + viewState.radius * Math.cos(a), z: craneZ + viewState.radius * Math.sin(a) };
  }, [craneX, craneZ, heading, viewState.slew_angle, viewState.radius]);

  const padSitePositions = useMemo(() => {
    const { Lx, Ly } = outriggerSpan(state.outrigger_config);
    const { rear, front } = outriggerXs(Lx, crane.dimensions?.outrigger_rear_fraction ?? 0.5);
    const h = (heading * Math.PI) / 180;
    const c = Math.cos(h), sn = Math.sin(h);
    return [[rear, Ly / 2], [rear, -Ly / 2], [-front, Ly / 2], [-front, -Ly / 2]].map(([x, z]) => ({
      x: craneX + x * c - z * sn,
      z: craneZ + x * sn + z * c,
    }));
  }, [state.outrigger_config, crane, heading, craneX, craneZ]);

  const siteLatLon = useMemo(() => {
    try {
      const raw = localStorage.getItem("hareket_site_center");
      if (!raw) return null;
      const v = JSON.parse(raw) as { lat?: number; lng?: number };
      return typeof v.lat === "number" && typeof v.lng === "number" ? { lat: v.lat, lon: v.lng } : null;
    } catch {
      return null;
    }
  }, [tab]);

  const liftCfg = {
    outrigger_config: state.outrigger_config,
    crane_heading: heading,
    crane_position: { x: craneX, z: craneZ },
    objects: state.objects,
    jib:
      state.lift_config !== "T"
        ? { config: state.lift_config, jib_length: state.jib_length, jib_offset: state.jib_offset }
        : undefined,
  };

  // ── Al–bırak simülasyonu ─────────────────────────────────────────────────
  const liftPathResult = useMemo(() => {
    if (!state.lift_path) return null;
    try {
      const poses = planLiftPath(state.lift_path.pick, state.lift_path.place, state.lift_path.travel_height, {
        x: craneX,
        z: craneZ,
        heading,
      });
      return simulateLiftPath(crane, liftInputsFromState(state), liftCfg, poses);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crane, state, craneX, craneZ, heading]);

  // ── Tandem ───────────────────────────────────────────────────────────────
  const tandemResult = useMemo(() => {
    const t = state.tandem;
    if (!t?.enabled) return null;
    try {
      const crane2 = getCrane(t.craneModel);
      const inputs = liftInputsFromState(state);
      return computeTandem({
        load_weight: state.load_weight,
        rigging_weight: inputs.rigging_weight,
        cog_ratio: t.cog_ratio,
        derate_pct: t.derate_pct,
        crane1: {
          crane,
          inputs,
          outrigger_config: state.outrigger_config,
          slew_angle: state.slew_angle,
          heading,
          position: { x: craneX, z: craneZ },
          hook_weight: state.hook_weight,
        },
        crane2: {
          crane: crane2,
          counterweight: t.counterweight,
          capacity_pct: t.capacity_pct,
          boom_length: t.boom_length,
          outrigger_config: t.outrigger_config,
          heading: t.heading,
          position: { x: t.x, z: t.z },
          hook_site: tandemHookSite(mainHookSite, { x: t.x, z: t.z }, t.hook_spacing ?? 4),
          hook_weight: state.hook_weight,
        },
        objects: state.objects,
      });
    } catch {
      return null;
    }
  }, [crane, state, heading, craneX, craneZ, mainHookSite]);

  // ── Kapasite haritası (yalnız sekme açıkken) ──────────────────────────────
  const reachMap = useMemo(() => {
    if (tab !== "reach") return null;
    try {
      return computeReachMap(crane, liftInputsFromState(state), {
        outrigger_config: state.outrigger_config,
        crane_heading: heading,
        crane_position: { x: craneX, z: craneZ },
        objects: state.objects,
      });
    } catch {
      return null;
    }
  }, [tab, crane, state, heading, craneX, craneZ]);

  // ── Sapan kol kuvvetleri (rapor için) ─────────────────────────────────────
  const slingReport = useMemo(() => {
    const sling = (state.rigging_items ?? []).find((r) => r.kind === "sling2" || r.kind === "sling4");
    const cog = state.load_cog_offset ?? { x: 0, z: 0 };
    if (!sling && cog.x === 0 && cog.z === 0) return undefined;
    const r = slingLegForces(
      state.load_weight,
      sling?.kind === "sling2" ? 2 : 4,
      sling ? sling.length_m / 2 : 2.5,
      sling ? sling.height_m : 3,
      cog,
    );
    return { max_tension_t: r.max_tension_t, warnings: r.warnings };
  }, [state.rigging_items, state.load_cog_offset, state.load_weight]);

  const collisionBad = !!result && result.collision.worst === "collision";
  // Yalnızca klerens/çarpışma uyarısı — 3B bom rengi için kullanılır (kapasite
  // aşımı ayrı bir görsel kanaldır: Sonuçlar panelindeki banner/rozetler).
  const clearanceWarn = !!result && result.collision.worst !== "ok";
  const capacityOver = !!result && result.capacity.status === "KAPASİTE AŞIMI";
  const warn = clearanceWarn || capacityOver;

  // Vinçe özgü (SANY) doğru 2B/3B çizim + jib çizim parametreleri.
  const jibDraw =
    state.lift_config !== "T"
      ? { jib_length: state.jib_length, jib_offset: state.jib_offset }
      : null;

  // Seçili bom uzunluğunun yük eğrisi → 2B çalışma alanı diyagramı.
  const chartCurve = useMemo(() => {
    if (state.lift_config !== "T") return null;
    try {
      return getCapacityCurve(crane, state.counterweight, state.capacity_pct, state.boom_length);
    } catch {
      return null;
    }
  }, [crane, state.lift_config, state.counterweight, state.capacity_pct, state.boom_length]);
  const span = outriggerSpan(state.outrigger_config);
  const sideView = result ? (
    <CraneSideView2D
      crane={crane}
      clearance={result.clearance}
      boom_length={state.boom_length}
      radius={viewState.radius}
      counterweight={state.counterweight}
      slew_angle={viewState.slew_angle}
      Lx={span.Lx}
      Ly={span.Ly}
      load_height={state.load_height}
      load_diameter={state.load_diameter}
      obstacle_height={state.obstacle_height}
      obstacle_distance={state.obstacle_distance}
      obstacle_width={state.obstacle_width}
      chart={chartCurve}
      falls={result.reeving?.required_parts}
      jib={jibDraw}
      rigging_height={riggingTotals(state.rigging_items).height || undefined}
      rigging_items={state.rigging_items}
      jib_clearance={result.jib_clearance ?? null}
    />
  ) : null;

  const collidingIds = useMemo(() => {
    if (!result) return [];
    const ids = new Set<string>();
    for (const it of result.collision.items) {
      if (it.severity === "ok") continue;
      const m = it.id.match(/^obj-(.+)-(boom|jib|load|hook|rope|tail)$/);
      if (m) ids.add(m[1]);
    }
    return [...ids];
  }, [result]);

  const atAngle = useMemo(() => {
    if (!result?.outrigger) return null;
    const pa = result.outrigger.per_angle;
    if (pa.length === 0) return null;
    const target = ((state.slew_angle % 360) + 360) % 360;
    return pa.reduce(
      (best, a) =>
        Math.abs(a.slew_angle - target) < Math.abs(best.slew_angle - target) ? a : best,
      pa[0],
    );
  }, [result, state.slew_angle]);

  // ── Çalışma adımları ────────────────────────────────────────────────────────
  const summarize = (r: FullLiftResult): StepSummary => ({
    utilization_pct: r.capacity.utilization_pct,
    status: r.capacity.status,
    rated_capacity: r.capacity.rated_capacity,
    total_load: r.capacity.total_load,
    max_corner_load: r.outrigger?.max_corner_load ?? null,
    worst_collision: r.collision.worst,
  });

  const addStep = () => {
    if (!result) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `step-${Date.now()}-${steps.length}`;
    setSteps((s) => [
      ...s,
      { id, name: tStatic("Adım {n}", { n: s.length + 1 }), config: structuredClone(state), summary: summarize(result) },
    ]);
    setActiveStepId(id);
  };
  const selectStep = (id: string) => {
    const s = steps.find((x) => x.id === id);
    if (!s) return;
    setStateFull(structuredClone(s.config));
    setActiveStepId(id);
  };
  const deleteStep = (id: string) => {
    setSteps((s) => s.filter((x) => x.id !== id));
    if (activeStepId === id) setActiveStepId(null);
  };
  const renameStep = (id: string, name: string) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, name } : x)));

  // PDF üretimi asenkrondur (çizimler SVG→PNG'ye dönüştürülür — bkz. ui/report.ts).
  // pdfBusy, üretim sürerken çift tıklamayı/çift üretimi engeller.
  const pdf = async () => {
    if (!result || pdfBusy) return;
    setPdfBusy(true);
    try {
      await generateReport(crane, state, result, meta, {
        sideView: exportSideRef.current,
        topView: exportTopRef.current,
      }, reportOpts, {
        tandem: tandemResult
          ? {
              crane1: { share_t: tandemResult.crane1.share_t, allowed_t: tandemResult.crane1.allowed_t, utilization_pct: tandemResult.crane1.utilization_pct, ok: tandemResult.crane1.ok },
              crane2: { share_t: tandemResult.crane2.share_t, allowed_t: tandemResult.crane2.allowed_t, utilization_pct: tandemResult.crane2.utilization_pct, ok: tandemResult.crane2.ok },
              hook_distance_m: tandemResult.hook_distance_m,
              ok: tandemResult.ok,
              summary: tandemResult.summary,
            }
          : undefined,
        liftPath: liftPathResult
          ? { feasible: liftPathResult.feasible, max_utilization: liftPathResult.max_utilization, summary: liftPathResult.summary }
          : undefined,
        slings: slingReport,
      });
    } catch (e) {
      window.alert(`${t("PDF oluşturulamadı:")} ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPdfBusy(false);
    }
  };
  // Klavye kısayolu (Ctrl+P) her render'da yeniden bağlanmasın diye ref'te tutulur.
  const pdfRef = useRef(pdf);
  pdfRef.current = pdf;

  const handleReset = () => {
    if (!window.confirm(t("Tüm girdiler örnek senaryoya dönecek — emin misin?"))) return;
    setStateFull(defaultState(crane));
    setActiveStepId(null);
  };

  const saveProjectFile = () => downloadProjectFile(state, steps, meta);
  const openProjectFile = () => projectFileInputRef.current?.click();
  const onProjectFileChosen = async (file: File) => {
    const text = await file.text();
    const data = tryParseProject(text);
    if (!data) {
      window.alert(t("Geçersiz veya desteklenmeyen proje dosyası."));
      return;
    }
    try {
      getCrane(data.state.craneModel);
    } catch {
      window.alert(t("Proje dosyasındaki vinç modeli tanınmıyor: {model}", { model: data.state.craneModel }));
      return;
    }
    if (!applyProject(data)) return;
    setCurrentProject({ kind: "unsaved", name: file.name.replace(/\.hcp\.json$|\.json$/i, "") });
  };

  // ── Klavye kısayolları: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (geri al/yinele),
  // Ctrl+P (PDF rapor — tarayıcı yazdırmasını engeller). Metin alanlarında
  // (input/textarea/select) geri al/yinele'yi tetiklemeyiz — native metin
  // düzenleme geri alma davranışına karışmasın diye.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        void pdfRef.current();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        void saveNowRef.current();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (key === "z") {
        e.preventDefault();
        undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);


  const outOfRange = !!result?.capacity.out_of_range;
  const statusText = t(
    error ? "HESAP HATASI" : outOfRange ? "TABLO DIŞI" : collisionBad ? "ÇARPIŞMA RİSKİ" : warn ? "UYARI" : "GÜVENLİ",
  );
  const statusCls = error || outOfRange || collisionBad ? "bad" : warn ? "warn" : "ok";
  // Görünüm üstü uyarı şeridi (görünüm KAPANMAZ, yalnızca uyarılır).
  const viewWarning = result?.capacity.out_of_range
    ? t("Yük tablosu dışında — bu konfigürasyonda kaldırma yapılamaz.") + " " + result.capacity.out_of_range
    : result?.clearance?.warning ?? null;

  if (screen === "home") {
    return (
      <>
        <UpdateBanner u={updater} />
        <ProjectHome
          cranes={craneList}
          appVersion={updater.version || undefined}
          hasAutosave={!!restored}
          onContinue={() => {
            skipNextProjectSave.current = true;
            setScreen("editor");
          }}
          onNew={(p) => void newFromHome(p)}
          onOpen={openFromHome}
        />
      </>
    );
  }

  return (
    <div className="cad">
      {/* Proje dosyası açma (gizli input) */}
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onProjectFileChosen(f);
          e.target.value = "";
        }}
      />

      {/* ── Başlık / menü çubuğu ──────────────────────────────────────────── */}
      <div className="titlebar">
        <img className="brand-logo" src={logoW} alt="Hareket" />
        <span className="brand-name">Crane Planner</span>
        <button
          type="button"
          className="tb-btn"
          style={{ height: 24, padding: "0 10px", fontSize: 11.5, marginLeft: 8 }}
          title={t("Projeler ekranına dön")}
          onClick={() => void goHome()}
        >
          ☰ {currentProject?.name ?? t("Adsız proje")}
          <span style={{ marginLeft: 8, color: saveInfo.error ? "var(--red)" : "var(--text-faint)", fontWeight: 400 }}>
            {saveInfo.error
              ? t("Kaydedilemedi")
              : !currentProject || currentProject.kind === "unsaved"
                ? t("kaydedilmedi")
                : saveInfo.at
                  ? t("Kaydedildi {time}", { time: new Date(saveInfo.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
                  : ""}
          </span>
        </button>
        <span className="brand-sub">· {t("Vinç Kaldırma Planlama")}</span>
        <Menu
          label={t("Dosya")}
          items={[
            { label: t("Projeler Ekranı…"), onClick: () => void goHome() },
            { label: t("Kaydet"), shortcut: "Ctrl+S", onClick: () => void saveNow() },
            { label: t("Farklı Kaydet…"), onClick: () => void saveAs() },
            { separator: true },
            { label: t("Proje Bilgileri…"), onClick: () => setShowMetaDialog(true) },
            { label: t("Makinelerim…"), onClick: () => setShowMachines(true) },
            { separator: true },
            { label: t("PDF Rapor (tek adım)"), shortcut: "Ctrl+P", onClick: () => void pdf() },
            { label: t("Çok Adımlı PDF"), onClick: () => generateMultiStepReport(steps, meta, reportOpts) },
            { separator: true },
            { label: t("Dışa Aktar (.json)"), onClick: saveProjectFile },
            { label: t("Dosyadan Aç (.json)…"), onClick: openProjectFile },
            { separator: true },
            { label: t("Sıfırla"), onClick: handleReset },
          ]}
        />
        <Menu
          label={t("Düzenle")}
          items={[
            { label: t("Geri Al"), shortcut: "Ctrl+Z", onClick: () => undo(), disabled: !canUndo },
            { label: t("Yinele"), shortcut: "Ctrl+Shift+Z", onClick: () => redo(), disabled: !canRedo },
          ]}
        />
        <Menu
          label={t("Görünüm")}
          items={[
            ...VIEWS.map((v) => ({ label: `${v.icon} ${t(v.label)}`, onClick: () => setTab(v.key), checked: tab === v.key })),
            { separator: true },
            {
              label: leftCollapsed ? t("Sol paneli göster") : t("Sol paneli gizle"),
              onClick: () => setLeftCollapsed((c) => !c),
            },
            {
              label: rightCollapsed ? t("Sağ paneli göster") : t("Sağ paneli gizle"),
              onClick: () => setRightCollapsed((c) => !c),
            },
            { separator: true },
            { label: `${t("Dil")}: Türkçe`, checked: lang === "tr", onClick: () => setLang("tr") },
            { label: `${t("Dil")}: English`, checked: lang === "en", onClick: () => setLang("en") },
            { separator: true },
            { label: t("Birim: Metrik (m, t)"), checked: !u.imperial, onClick: () => u.setSystem("metric") },
            { label: t("Birim: Imperial (ft, lb)"), checked: u.imperial, onClick: () => u.setSystem("imperial") },
          ]}
        />
        <Menu
          label={t("Planlama")}
          items={[
            { label: t("Makine Seçim Sihirbazı…"), onClick: () => setShowWizard(true) },
            { label: t("Makinelerim…"), onClick: () => setShowMachines(true) },
          ]}
        />
        <Menu
          label={t("Rapor")}
          items={[
            { label: t("Tek adım PDF"), onClick: () => void pdf() },
            { label: t("Çok adımlı PDF"), onClick: () => generateMultiStepReport(steps, meta, reportOpts) },
            { separator: true },
            { label: t("Rapor Tasarımı…"), onClick: () => setShowReportDesigner(true) },
            { label: t("Proje Bilgileri…"), onClick: () => setShowMetaDialog(true) },
            { label: t("Adımı kaydet"), onClick: () => addStep() },
          ]}
        />
        <div className="spacer" style={{ flex: 1 }} />
        <div className="seg" style={{ height: 22 }} title={t("Dil")}>
          {(["tr", "en"] as const).map((l) => (
            <div
              key={l}
              className={`seg-btn ${lang === l ? "active" : ""}`}
              style={{ padding: "0 7px", fontSize: 11 }}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="seg" style={{ height: 22 }} title={t("Birim sistemi")}>
          {(["metric", "imperial"] as const).map((sys) => (
            <div
              key={sys}
              className={`seg-btn ${u.system === sys ? "active" : ""}`}
              style={{ padding: "0 7px", fontSize: 11 }}
              onClick={() => u.setSystem(sys)}
            >
              {sys === "metric" ? "m·t" : "ft·lb"}
            </div>
          ))}
        </div>
        {updater.isElectron && (
          <button
            className={`tb-btn ${
              updater.status === "available" || updater.status === "downloaded" ? "primary" : ""
            }`}
            style={{ height: 24, padding: "0 10px", fontSize: 11.5 }}
            title={t("Güncellemeleri denetle / güncelle")}
            // İndirme otomatik: bulunduğunda/inerken düğme yalnız durum gösterir.
            disabled={updater.status === "available" || updater.status === "downloading"}
            onClick={updater.status === "downloaded" ? updater.install : updater.check}
          >
            {updater.status === "checking"
              ? `⟳ ${t("Denetleniyor…")}`
              : updater.status === "downloading"
                ? `⬇ %${updater.progress}`
                : updater.status === "downloaded"
                  ? `✓ ${t("Kur")}`
                  : updater.status === "available"
                    ? `⬆ ${t("Güncelle")}`
                    : `⟳ ${t("Güncelle")}`}
          </button>
        )}
        <span className="pill">{crane.model}</span>
        <span className="pill">
          {state.lift_config !== "T"
            ? `${massTxt(state.counterweight)} · ${t("Bom")} ${lenTxt(state.boom_length)} · Jib ${lenTxt(state.jib_length)}@${state.jib_offset}°`
            : `${massTxt(state.counterweight)} · ${lenTxt(state.boom_length)} · %${state.capacity_pct}`}
        </span>
      </div>

      {/* ── Araç çubuğu ───────────────────────────────────────────────────── */}
      <div className="toolbar">
        <div className="seg">
          {VIEWS.map((v) => (
            <div
              key={v.key}
              className={`seg-btn ${tab === v.key ? "active" : ""}`}
              onClick={() => setTab(v.key)}
            >
              {v.icon} {t(v.label)}
            </div>
          ))}
        </div>
        <div className="tb-sep" />
        <button
          className={`tb-btn ${leftCollapsed ? "" : "active"}`}
          onClick={() => setLeftCollapsed((c) => !c)}
          title={t("Konfigürasyon panelini aç/kapa")}
        >
          ⬛ {t("Konfig")}
        </button>
        <button
          className={`tb-btn ${rightCollapsed ? "" : "active"}`}
          onClick={() => setRightCollapsed((c) => !c)}
          title={t("Sonuç panelini aç/kapa")}
        >
          📊 {t("Sonuçlar")}
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="tb-btn" onClick={addStep} title={t("Mevcut konfigürasyonu adım olarak kaydet")}>
          ➕ {t("Adım")}
        </button>
        <button className="tb-btn primary" onClick={() => void pdf()} disabled={pdfBusy} title={t("PDF rapor oluştur")}>
          {pdfBusy ? `⟳ ${t("Oluşturuluyor…")}` : "⬇ PDF"}
        </button>
        <div className="tb-sep" />
        <span className={`tb-status ${statusCls}`}>● {statusText}</span>
      </div>

      {/* ── Güncelleme uyarısı (yalnızca masaüstü) ────────────────────────── */}
      <UpdateBanner u={updater} />

      {/* ── İçe aktarılan 3B modeller oturumluk uyarısı ─────────────────────── */}
      {modelsNotice && (
        <div
          className="update-banner"
          style={{
            background: "linear-gradient(90deg, rgba(255,186,32,.14), rgba(255,186,32,.04))",
          }}
        >
          <span className="ub-text">
            ⚠ {t("İçe aktarılan 3B/BIM modeller yalnızca oturum içinde tutulur — kaydedilen veya açılan projede bu nesnelerin geometrisi kaybolur (kutu ölçüleri korunur). Gerekiyorsa \"Çevre & Nesneler\" bölümünden yeniden içe aktarın.")}
          </span>
          <div className="ub-actions">
            <button className="btn ghost ub-btn" onClick={() => setModelsNotice(false)}>
              {t("Kapat")}
            </button>
          </div>
        </div>
      )}

      {/* ── Gövde: sol panel | viewport | sağ panel ───────────────────────── */}
      <div className="cad-body">
        <SidePanel
          side="left"
          title={t("Konfigürasyon")}
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed((c) => !c)}
          railIcons={[
            { icon: "🏗", label: t("Vinç & Donanım") },
            { icon: "⚖", label: t("Yük & Geometri") },
            { icon: "🏢", label: t("Çevre & Nesneler") },
          ]}
        >
          <Section title={t("Vinç & Donanım")} icon="🏗">
            <ConfigSidebar cranes={craneList} crane={crane} state={state} set={set} />
          </Section>
          <Section title={t("Yük & Geometri")} icon="⚖">
            <InputForm state={state} set={set} riggingFromItems={(state.rigging_items?.length ?? 0) > 0} />
          </Section>
          <Section title={t("Kaldırma Aparatları")} icon="⛓" defaultOpen={false}>
            <RiggingEditor
              items={state.rigging_items ?? []}
              onChange={(rigging_items) => set({ rigging_items })}
              hookLoad_t={state.load_weight}
            />
          </Section>
          <Section title={t("Çevre & Nesneler")} icon="🏢" defaultOpen={false}>
            <ObjectLibrary objects={state.objects} onChange={(objects) => set({ objects })} />
          </Section>
          <Section title={t("Güvenlik & Zemin")} icon="🛡" defaultOpen={false}>
            <SafetyPanel
              state={state}
              crane={crane}
              result={result}
              padSitePositions={padSitePositions}
              siteLatLon={siteLatLon}
              set={set}
            />
          </Section>
          <Section title={t("Al–Bırak Güzergâhı")} icon="↷" defaultOpen={false}>
            <LiftPathPanel
              path={state.lift_path}
              craneX={craneX}
              craneZ={craneZ}
              heading={heading}
              currentHook={{ x: mainHookSite.x, z: mainHookSite.z, h: result?.clearance?.load_bottom_height ?? state.obstacle_height }}
              result={liftPathResult}
              onChange={(lift_path) => set({ lift_path })}
              onPreviewPose={setPreviewPose}
            />
          </Section>
          <Section title={t("Tandem Kaldırma")} icon="⇄" defaultOpen={false}>
            <TandemPanel
              tandem={state.tandem}
              cranes={craneList}
              mainHookSite={mainHookSite}
              craneX={craneX}
              craneZ={craneZ}
              result={tandemResult}
              onChange={(tandem) => set({ tandem })}
            />
          </Section>
        </SidePanel>

        <div className="viewport">
          <div className="viewport-body" style={{ position: "relative" }}>
            {viewWarning && tab !== "site" && (
              <div
                className="error-box"
                role="alert"
                style={{ position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 5, margin: 0, pointerEvents: "none" }}
              >
                ⚠ {viewWarning}
              </div>
            )}
            {tab === "site" ? (
              <SitePlan
                Lx={span.Lx}
                Ly={span.Ly}
                radius={state.radius}
                slewAngle={state.slew_angle}
                heading={state.crane_heading ?? 0}
                rearFraction={crane.dimensions?.outrigger_rear_fraction ?? 0.5}
                objects={state.objects}
                collidingIds={collidingIds}
              />
            ) : error ? (
              <div style={{ padding: 24 }}>
                <div className="error-box">⚠ {error}</div>
              </div>
            ) : tab === "reach" && reachMap ? (
              <ZoomPan resetKey={`reach-${state.craneModel}`}>
              <ReachMapView
                map={reachMap}
                craneX={craneX}
                craneZ={craneZ}
                heading={heading}
                slewAngle={viewState.slew_angle}
                radius={viewState.radius}
                Lx={span.Lx}
                Ly={span.Ly}
                rearFraction={crane.dimensions?.outrigger_rear_fraction ?? 0.5}
                objects={state.objects}
                onPick={(x, z) => {
                  const { radius, slew } = siteToSlewRadius({ x, z }, { x: craneX, z: craneZ, heading });
                  set({ radius: Math.round(radius * 10) / 10, slew_angle: Math.round(slew) });
                }}
              />
              </ZoomPan>
            ) : result && tab === "2d" ? (
              <ZoomPan resetKey={`2d-${state.craneModel}`}>{sideView}</ZoomPan>
            ) : result && tab === "3d" ? (
              <Crane3D
                key={`${state.craneModel}-${state.lift_config}`}
                boomLength={state.boom_length}
                radius={viewState.radius}
                boomOffset={crane.geometry_constants.boom_offset}
                machineGroundHeight={crane.geometry_constants.machine_ground_height}
                cribbingHeight={crane.geometry_constants.cribbing_height}
                gama={result.clearance?.gama ?? Math.PI / 4}
                slewAngleDeg={viewState.slew_angle}
                loadHeight={state.load_height}
                loadDiameter={state.load_diameter}
                obstacleHeight={state.obstacle_height}
                obstacleDistance={state.obstacle_distance}
                obstacleWidth={state.obstacle_width}
                outrigger={span}
                clearanceWarning={clearanceWarn}
                objects={state.objects}
                collidingIds={collidingIds}
                crane={crane}
                counterweight={state.counterweight}
                falls={result.reeving?.required_parts}
                jib={jibDraw}
                heading={state.crane_heading ?? 0}
                riggingHeight={riggingTotals(state.rigging_items).height || undefined}
                riggingItems={state.rigging_items}
                craneX={craneX}
                craneZ={craneZ}
                loadBottomHeight={result.clearance?.load_bottom_height ?? result.jib_clearance?.load_bottom_height}
                boomLengths={crane.boom_lengths}
                radiusRange={chartCurve && chartCurve.length > 0 ? [chartCurve[0][0], chartCurve[chartCurve.length - 1][0]] : null}
                onRadiusChange={(r) => set({ radius: r })}
                onBoomLengthChange={(L) => set({ boom_length: L })}
                onSlewChange={(deg) => set({ slew_angle: deg })}
                onLoadBottomChange={(h) => set({ load_bottom_height: h })}
                onCranePositionChange={(x, z) => set({ crane_x: x, crane_z: z })}
                onObjectChange={(o) => set({ objects: state.objects.map((x) => (x.id === o.id ? o : x)) })}
                powerlineEnvelopes
                secondCrane={
                  state.tandem?.enabled && tandemResult && tandemResult.crane2.gama != null
                    ? {
                        crane: getCrane(state.tandem.craneModel),
                        boomLength: state.tandem.boom_length,
                        radius: tandemResult.crane2.radius,
                        gama: tandemResult.crane2.gama,
                        slewAngleDeg: tandemResult.crane2.slew,
                        heading: state.tandem.heading,
                        x: state.tandem.x,
                        z: state.tandem.z,
                        counterweight: state.tandem.counterweight,
                        outrigger: outriggerSpan(state.tandem.outrigger_config),
                      }
                    : null
                }
                liftPath={
                  liftPathResult
                    ? {
                        points: liftPathResult.poses.map((pc) => [
                          pc.pose.site.x,
                          pc.pose.load_bottom_height + state.load_height,
                          pc.pose.site.z,
                        ] as [number, number, number]),
                        critical: (() => {
                          const c = liftPathResult.poses[liftPathResult.critical_index];
                          return c ? ([c.pose.site.x, c.pose.load_bottom_height + state.load_height, c.pose.site.z] as [number, number, number]) : null;
                        })(),
                      }
                    : null
                }
              />
            ) : result && atAngle ? (
              <ZoomPan resetKey={`ground-${state.craneModel}`}>
              <GroundForceDiagram
                Lx={span.Lx}
                Ly={span.Ly}
                atAngle={atAngle}
                V={result.outrigger!.V}
                padArea={result.outrigger!.pad_area}
                radius={state.radius}
                slewAngle={state.slew_angle}
                rectCenterX={result.outrigger!.rect_center_x}
              />
              </ZoomPan>
            ) : (
              <div style={{ padding: 24 }}>
                <div className="error-box">
                  {t("Zemin kuvveti diyagramı için ayak reaksiyonu gerekli")}
                  {result?.outrigger_error ? `: ${result.outrigger_error}` : "."}
                </div>
              </div>
            )}
          </div>
          <div className="legend">
            <span><i className="swatch" style={{ background: "#ffba20" }} /> {t("Bom")}</span>
            <span><i className="swatch" style={{ background: "#64748b" }} /> {t("Yük")}</span>
            <span><i className="swatch" style={{ background: "rgba(255,186,32,.5)" }} /> {t("Engel")}</span>
            <span><i className="swatch" style={{ background: "#5ad1ff" }} /> {t("Maks koça yüks.")}</span>
            {warn && <span className="bad">● {t("Çarpma/aşım riski")}</span>}
          </div>
        </div>

        <SidePanel
          side="right"
          title={t("Sonuçlar / Denetçi")}
          collapsed={rightCollapsed}
          onToggle={() => setRightCollapsed((c) => !c)}
          railIcons={[
            { icon: "📊", label: t("Kapasite") },
            { icon: "⚠", label: t("Çarpışma") },
            { icon: "⬇", label: "PDF" },
          ]}
        >
          {result ? (
            <>
              {chartCurve && (
                <div className="card" style={{ padding: 10 }}>
                  <LoadChartGraph
                    curve={chartCurve}
                    radius={viewState.radius}
                    totalLoad={result.capacity.total_load}
                    boomLength={state.boom_length}
                    counterweight={state.counterweight}
                    capacityPct={state.capacity_pct}
                  />
                </div>
              )}
              <ResultsPanel result={result} state={viewState} crane={crane} onPdf={() => void pdf()} />
              <Section title={t("Kontrol Listesi")} icon="☑" defaultOpen={false}>
                <ChecklistPanel
                  items={state.checklist}
                  onChange={(checklist) => set({ checklist })}
                  userName={meta.preparedBy}
                />
              </Section>
              <Section title={t("Onay")} icon="✔" defaultOpen={false}>
                <ApprovalPanel
                  approval={state.approval}
                  meta={meta}
                  state={state}
                  result={result}
                  onChange={(approval) => set({ approval })}
                />
              </Section>
            </>
          ) : (
            <div className="error-box">{t("Hesap yapılamadı:")} {error}</div>
          )}
        </SidePanel>
      </div>

      {/* ── Çalışma adımları şeridi ───────────────────────────────────────── */}
      <StepsBar
        steps={steps}
        activeStepId={activeStepId}
        onAdd={addStep}
        onSelect={selectStep}
        onDelete={deleteStep}
        onRename={renameStep}
        onReport={() => generateMultiStepReport(steps, meta, reportOpts)}
      />

      {/* ── Durum çubuğu ──────────────────────────────────────────────────── */}
      <div className="statusbar">
        <span className={`sb-item ${statusCls === "ok" ? "ok" : statusCls === "warn" ? "warn" : "bad"}`}>
          ● {t("Durum")}: {statusText}
        </span>
        <span className="sb-sep">·</span>
        {result && <span className="sb-item">{t("Kapasite")} {Number.isFinite(result.capacity.utilization_pct) ? `%${result.capacity.utilization_pct.toFixed(1)}` : t("tablo dışı")}</span>}
        <span className="sb-sep">·</span>
        {result && result.clearance ? (
          <span className="sb-item">{t("Yük klerensi")} {u.fmtLenN(result.clearance.clearance_to_load, 2)}{u.imperial ? " ft" : "m"}</span>
        ) : (
          result && <span className="sb-item">{t("Jib modu (klerens N/A)")}</span>
        )}
        <span className="sb-sep">·</span>
        <span className="sb-item">{t("{n} çevre nesnesi", { n: state.objects.length })}</span>
        <span className="sb-sep">·</span>
        <span className="sb-item">{t("Vinç")}: {crane.model}</span>
        <div style={{ flex: 1 }} />
        <span className="sb-item" style={{ color: "var(--text-faint)" }}>
          {t("Radius")} {lenTxt(state.radius, 2)} · {t("Bom")} {lenTxt(state.boom_length)} · {t("Dönme")} {state.slew_angle}°
        </span>
      </div>

      {/* ── PDF çizim gömme: ekran dışı (görünmez) render ───────────────────
          Hangi sekme açık olursa olsun her zaman DOM'da mevcut — ui/report.ts
          captureSvgContainer bu kapsayıcıların içindeki <svg>'yi yakalar. */}
      <div
        ref={exportSideRef}
        style={{ position: "fixed", left: -10000, top: 0, width: 900, height: 560, overflow: "hidden", pointerEvents: "none" }}
        aria-hidden="true"
      >
        {result ? sideView : null}
      </div>
      <div
        ref={exportTopRef}
        style={{ position: "fixed", left: -10000, top: 0, width: 900, height: 560, overflow: "hidden", pointerEvents: "none" }}
        aria-hidden="true"
      >
        {result?.outrigger && atAngle ? (
          <GroundForceDiagram
            Lx={span.Lx}
            Ly={span.Ly}
            atAngle={atAngle}
            V={result.outrigger.V}
            padArea={result.outrigger.pad_area}
            radius={state.radius}
            slewAngle={state.slew_angle}
            rectCenterX={result.outrigger.rect_center_x}
          />
        ) : null}
      </div>

      {showMetaDialog && (
        <ProjectMetaDialog meta={meta} onSave={setMeta} onClose={() => setShowMetaDialog(false)} />
      )}
      {showWizard && (
        <SelectionWizard
          cranes={craneList}
          initial={{
            total_load: result?.capacity.total_load ?? state.load_weight + state.hook_weight + state.rigging_weight,
            radius: state.radius,
            load_height: state.load_height,
            load_diameter: state.load_diameter,
            obstacle_height: state.obstacle_height,
            obstacle_distance: state.obstacle_distance,
            obstacle_width: state.obstacle_width,
            rigging_height: riggingTotals(state.rigging_items).height,
          }}
          onApply={(c) => {
            // Önce vinç (craneModel değişimi uyumsuz alanları uzlaştırır), sonra seçilen konfigürasyon.
            set({ craneModel: c.crane_model, lift_config: "T" });
            set({ counterweight: c.counterweight, capacity_pct: c.capacity_pct, boom_length: c.boom_length, radius: c.radius });
          }}
          onClose={() => setShowWizard(false)}
        />
      )}
      {showMachines && (
        <MachinesDialog
          builtIn={CRANES}
          custom={customCranes}
          onChange={(list) => {
            saveCustomCranes(list);
            setCustomCranes(list);
            registerCustomCranes(list);
            // Aktif vinç silindiyse ilk yerleşik vince dön.
            if (!CRANES.some((c) => c.model === state.craneModel) && !list.some((c) => c.model === state.craneModel)) {
              set({ craneModel: CRANES[0].model });
            }
          }}
          onClose={() => setShowMachines(false)}
        />
      )}
      {showReportDesigner && (
        <ReportDesigner
          options={reportOpts}
          onSave={(o) => {
            saveReportOptions(o);
            setReportOpts(o);
          }}
          onClose={() => setShowReportDesigner(false)}
        />
      )}
    </div>
  );
}

/** "10,2x10,6" -> {Lx,Ly} (hata olursa makul varsayılan). */
function outriggerSpan(cfg: string): { Lx: number; Ly: number } {
  const p = cfg.split(/x/i).map((s) => parseFloat(s.trim().replace(",", ".")));
  if (p.length === 2 && p.every((n) => isFinite(n) && n > 0)) return { Lx: p[0], Ly: p[1] };
  return { Lx: 10, Ly: 10 };
}

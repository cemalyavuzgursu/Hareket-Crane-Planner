import { useMemo, useState } from "react";
import { CRANES, getCrane } from "./data/cranes";
import { computeLiftFull, type FullLiftResult } from "./engine/index";
import { defaultState, type UIState, type WorkStep, type StepSummary } from "./ui/state";
import ConfigSidebar from "./ui/ConfigSidebar";
import InputForm from "./ui/InputForm";
import ResultsPanel from "./ui/ResultsPanel";
import SideView2D from "./ui/SideView2D";
import Crane3D from "./ui/Crane3D";
import GroundForceDiagram from "./ui/GroundForceDiagram";
import ObjectLibrary from "./ui/ObjectLibrary";
import StepsBar from "./ui/StepsBar";
import SitePlan from "./ui/SitePlan";
import { Section, SidePanel, Menu } from "./ui/shell";
import { useUpdater } from "./ui/useUpdater";
import UpdateBanner from "./ui/UpdateBanner";
import { generateReport, generateMultiStepReport } from "./ui/report";
// Logo'yu modül olarak içe aktar → Vite paketleyip base'e göre göreli yol üretir,
// böylece hem dev hem de paketlenmiş (file://) uygulamada doğru yüklenir.
import logoW from "./assets/brand/logo_w.png";

/** Ayak takozu (pad) temas alanı varsayımı (m²) — zemin basıncı için. */
const PAD_AREA = 1.0;

const VIEWS: Array<{ key: "2d" | "3d" | "ground" | "site"; label: string }> = [
  { key: "2d", label: "▦ 2B Yan" },
  { key: "3d", label: "◈ 3B Model" },
  { key: "ground", label: "⊕ Üstten" },
  { key: "site", label: "🛰 Saha" },
];

export default function App() {
  const [state, setState] = useState<UIState>(() => defaultState(CRANES[0]));
  const [tab, setTab] = useState<"2d" | "3d" | "ground" | "site">("3d");
  const [steps, setSteps] = useState<WorkStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const updater = useUpdater();

  const crane = useMemo(() => getCrane(state.craneModel), [state.craneModel]);

  const set = (patch: Partial<UIState>) => {
    setState((prev) => {
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

  const { result, error } = useMemo<{
    result: FullLiftResult | null;
    error: string | null;
  }>(() => {
    try {
      const r = computeLiftFull(crane, state, {
        outrigger_config: state.outrigger_config,
        slew_angle: state.slew_angle,
        pad_area: PAD_AREA,
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
  }, [crane, state]);

  const collisionBad = !!result && result.collision.worst === "collision";
  const warn =
    !!result && (result.collision.worst !== "ok" || result.capacity.status === "KAPASİTE AŞIMI");

  const collidingIds = useMemo(() => {
    if (!result) return [];
    const ids = new Set<string>();
    for (const it of result.collision.items) {
      if (it.severity === "ok") continue;
      const m = it.id.match(/^obj-(.+)-(boom|load)$/);
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
      { id, name: `Adım ${s.length + 1}`, config: structuredClone(state), summary: summarize(result) },
    ]);
    setActiveStepId(id);
  };
  const selectStep = (id: string) => {
    const s = steps.find((x) => x.id === id);
    if (!s) return;
    setState(structuredClone(s.config));
    setActiveStepId(id);
  };
  const deleteStep = (id: string) => {
    setSteps((s) => s.filter((x) => x.id !== id));
    if (activeStepId === id) setActiveStepId(null);
  };
  const renameStep = (id: string, name: string) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, name } : x)));

  const pdf = () => result && generateReport(crane, state, result);
  const span = outriggerSpan(state.outrigger_config);

  const statusText = collisionBad ? "ÇARPIŞMA RİSKİ" : warn ? "UYARI" : "GÜVENLİ";
  const statusCls = collisionBad ? "bad" : warn ? "warn" : "ok";

  return (
    <div className="cad">
      {/* ── Başlık / menü çubuğu ──────────────────────────────────────────── */}
      <div className="titlebar">
        <img className="brand-logo" src={logoW} alt="Hareket" />
        <span className="brand-name">Crane Planner</span>
        <span className="brand-sub">· Vinç Kaldırma Planlama</span>
        <Menu
          label="Dosya"
          items={[
            { label: "PDF Rapor (tek adım)", shortcut: "Ctrl+P", onClick: () => pdf() },
            { label: "Çok Adımlı PDF", onClick: () => generateMultiStepReport(steps) },
            { separator: true },
            { label: "Sıfırla", onClick: () => setState(defaultState(crane)) },
          ]}
        />
        <Menu
          label="Görünüm"
          items={[
            ...VIEWS.map((v) => ({ label: v.label, onClick: () => setTab(v.key) })),
            { separator: true },
            {
              label: leftCollapsed ? "Sol paneli göster" : "Sol paneli gizle",
              onClick: () => setLeftCollapsed((c) => !c),
            },
            {
              label: rightCollapsed ? "Sağ paneli göster" : "Sağ paneli gizle",
              onClick: () => setRightCollapsed((c) => !c),
            },
          ]}
        />
        <Menu
          label="Rapor"
          items={[
            { label: "Tek adım PDF", onClick: () => pdf() },
            { label: "Çok adımlı PDF", onClick: () => generateMultiStepReport(steps) },
            { separator: true },
            { label: "Adımı kaydet", onClick: () => addStep() },
          ]}
        />
        <div className="spacer" style={{ flex: 1 }} />
        {updater.isElectron && (
          <button
            className={`tb-btn ${
              updater.status === "available" || updater.status === "downloaded" ? "primary" : ""
            }`}
            style={{ height: 24, padding: "0 10px", fontSize: 11.5 }}
            title="Güncellemeleri denetle / güncelle"
            onClick={
              updater.status === "downloaded"
                ? updater.install
                : updater.status === "available"
                  ? updater.download
                  : updater.check
            }
          >
            {updater.status === "checking"
              ? "⟳ Denetleniyor…"
              : updater.status === "downloading"
                ? `⬇ %${updater.progress}`
                : updater.status === "downloaded"
                  ? "✓ Kur"
                  : updater.status === "available"
                    ? "⬆ Güncelle"
                    : "⟳ Güncelle"}
          </button>
        )}
        <span className="pill">{crane.model}</span>
        <span className="pill">
          {state.lift_config !== "T"
            ? `${state.counterweight}t · Bom ${state.boom_length}m · Jib ${state.jib_length}m@${state.jib_offset}°`
            : `${state.counterweight}t · ${state.boom_length}m · %${state.capacity_pct}`}
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
              {v.label}
            </div>
          ))}
        </div>
        <div className="tb-sep" />
        <button
          className={`tb-btn ${leftCollapsed ? "" : "active"}`}
          onClick={() => setLeftCollapsed((c) => !c)}
          title="Konfigürasyon panelini aç/kapa"
        >
          ⬛ Konfig
        </button>
        <button
          className={`tb-btn ${rightCollapsed ? "" : "active"}`}
          onClick={() => setRightCollapsed((c) => !c)}
          title="Sonuç panelini aç/kapa"
        >
          📊 Sonuçlar
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="tb-btn" onClick={addStep} title="Mevcut konfigürasyonu adım olarak kaydet">
          ➕ Adım
        </button>
        <button className="tb-btn primary" onClick={() => pdf()} title="PDF rapor oluştur">
          ⬇ PDF
        </button>
        <div className="tb-sep" />
        <span className={`tb-status ${statusCls}`}>● {statusText}</span>
      </div>

      {/* ── Güncelleme uyarısı (yalnızca masaüstü) ────────────────────────── */}
      <UpdateBanner u={updater} />

      {/* ── Gövde: sol panel | viewport | sağ panel ───────────────────────── */}
      <div className="cad-body">
        <SidePanel
          side="left"
          title="Konfigürasyon"
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed((c) => !c)}
          railIcons={[
            { icon: "🏗", label: "Vinç & Donanım" },
            { icon: "⚖", label: "Yük & Geometri" },
            { icon: "🏢", label: "Çevre & Nesneler" },
          ]}
        >
          <Section title="Vinç & Donanım" icon="🏗">
            <ConfigSidebar cranes={CRANES} crane={crane} state={state} set={set} />
          </Section>
          <Section title="Yük & Geometri" icon="⚖">
            <InputForm state={state} set={set} />
          </Section>
          <Section title="Çevre & Nesneler" icon="🏢" defaultOpen={false}>
            <ObjectLibrary objects={state.objects} onChange={(objects) => set({ objects })} />
          </Section>
        </SidePanel>

        <div className="viewport">
          <div className="viewport-body">
            {tab === "site" ? (
              <SitePlan
                Lx={span.Lx}
                Ly={span.Ly}
                radius={state.radius}
                slewAngle={state.slew_angle}
                objects={state.objects}
                collidingIds={collidingIds}
              />
            ) : error ? (
              <div style={{ padding: 24 }}>
                <div className="error-box">⚠ {error}</div>
              </div>
            ) : result && (tab === "2d" || tab === "3d") && !result.clearance ? (
              <div style={{ padding: 24 }}>
                <div className="error-box">
                  🚧 Jib modunda ({result.lift_config === "TJ_TH" ? "Bom+Jib" : "Bom+Uzatma+Jib"},
                  jib {state.jib_length}m, ofset {state.jib_offset}°) 2B/3B geometri ve klerens
                  hesaplanmaz — broşürde jib mafsal geometrisi yoktur. Kapasite ve ayak
                  reaksiyonu sağdaki panelde hesaplanır. Geometri için "⊕ Üstten" veya "🛰 Saha"
                  görünümünü kullanın.
                </div>
              </div>
            ) : result && tab === "2d" && result.clearance ? (
              <SideView2D
                g={crane.geometry_constants}
                clearance={result.clearance}
                boom_length={state.boom_length}
                radius={state.radius}
                load_height={state.load_height}
                load_diameter={state.load_diameter}
                obstacle_height={state.obstacle_height}
                obstacle_distance={state.obstacle_distance}
                obstacle_width={state.obstacle_width}
              />
            ) : result && tab === "3d" && result.clearance ? (
              <Crane3D
                boomLength={state.boom_length}
                radius={state.radius}
                boomOffset={crane.geometry_constants.boom_offset}
                machineGroundHeight={crane.geometry_constants.machine_ground_height}
                cribbingHeight={crane.geometry_constants.cribbing_height}
                gama={result.clearance.gama}
                slewAngleDeg={state.slew_angle}
                loadHeight={state.load_height}
                loadDiameter={state.load_diameter}
                obstacleHeight={state.obstacle_height}
                obstacleDistance={state.obstacle_distance}
                obstacleWidth={state.obstacle_width}
                outrigger={span}
                clearanceWarning={warn}
                objects={state.objects}
                collidingIds={collidingIds}
              />
            ) : result && atAngle ? (
              <GroundForceDiagram
                Lx={span.Lx}
                Ly={span.Ly}
                atAngle={atAngle}
                V={result.outrigger!.V}
                padArea={result.outrigger!.pad_area}
                radius={state.radius}
                slewAngle={state.slew_angle}
              />
            ) : (
              <div style={{ padding: 24 }}>
                <div className="error-box">
                  Zemin kuvveti diyagramı için ayak reaksiyonu gerekli
                  {result?.outrigger_error ? `: ${result.outrigger_error}` : "."}
                </div>
              </div>
            )}
          </div>
          <div className="legend">
            <span><i className="swatch" style={{ background: "#ffba20" }} /> Bom</span>
            <span><i className="swatch" style={{ background: "#64748b" }} /> Yük</span>
            <span><i className="swatch" style={{ background: "rgba(255,186,32,.5)" }} /> Engel</span>
            <span><i className="swatch" style={{ background: "#5ad1ff" }} /> Maks koça yüks.</span>
            {warn && <span className="bad">● Çarpma/aşım riski</span>}
          </div>
        </div>

        <SidePanel
          side="right"
          title="Sonuçlar / Denetçi"
          collapsed={rightCollapsed}
          onToggle={() => setRightCollapsed((c) => !c)}
          railIcons={[
            { icon: "📊", label: "Kapasite" },
            { icon: "⚠", label: "Çarpışma" },
            { icon: "⬇", label: "PDF" },
          ]}
        >
          {result ? (
            <ResultsPanel result={result} state={state} onPdf={() => pdf()} />
          ) : (
            <div className="error-box">Hesap yapılamadı: {error}</div>
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
        onReport={() => generateMultiStepReport(steps)}
      />

      {/* ── Durum çubuğu ──────────────────────────────────────────────────── */}
      <div className="statusbar">
        <span className={`sb-item ${statusCls === "ok" ? "ok" : statusCls === "warn" ? "warn" : "bad"}`}>
          ● Durum: {statusText}
        </span>
        <span className="sb-sep">·</span>
        {result && <span className="sb-item">Kapasite %{result.capacity.utilization_pct.toFixed(1)}</span>}
        <span className="sb-sep">·</span>
        {result && result.clearance ? (
          <span className="sb-item">Yük klerensi {result.clearance.clearance_to_load.toFixed(2)}m</span>
        ) : (
          result && <span className="sb-item">Jib modu (klerens N/A)</span>
        )}
        <span className="sb-sep">·</span>
        <span className="sb-item">{state.objects.length} çevre nesnesi</span>
        <span className="sb-sep">·</span>
        <span className="sb-item">Vinç: {crane.model}</span>
        <div style={{ flex: 1 }} />
        <span className="sb-item" style={{ color: "var(--text-faint)" }}>
          Radius {state.radius}m · Bom {state.boom_length}m · Dönme {state.slew_angle}°
        </span>
      </div>
    </div>
  );
}

/** "10,2x10,6" -> {Lx,Ly} (hata olursa makul varsayılan). */
function outriggerSpan(cfg: string): { Lx: number; Ly: number } {
  const p = cfg.split(/x/i).map((s) => parseFloat(s.trim().replace(",", ".")));
  if (p.length === 2 && p.every((n) => isFinite(n) && n > 0)) return { Lx: p[0], Ly: p[1] };
  return { Lx: 10, Ly: 10 };
}

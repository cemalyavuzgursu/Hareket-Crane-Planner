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
import { generateReport, generateMultiStepReport } from "./ui/report";

/** Ayak takozu (pad) temas alanı varsayımı (m²) — zemin basıncı için. */
const PAD_AREA = 1.0;

export default function App() {
  const [state, setState] = useState<UIState>(() => defaultState(CRANES[0]));
  const [tab, setTab] = useState<"2d" | "3d" | "ground" | "site">("2d");
  const [steps, setSteps] = useState<WorkStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  const crane = useMemo(() => getCrane(state.craneModel), [state.craneModel]);

  // Vinç değişince bom/denge/ayak geçerli değilse düzelt.
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
        };
      }
      return next;
    });
    // Konfigürasyon elle değişince "yüklü adım" vurgusu kalkar.
    setActiveStepId(null);
  };

  // Hesap — kapasite lookup hata verebilir (radius aralık dışı vb.)
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
      });
      return { result: r, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [crane, state]);

  const collisionBad = !!result && result.collision.worst === "collision";
  const warn =
    !!result &&
    (result.collision.worst !== "ok" ||
      result.capacity.status === "KAPASİTE AŞIMI");

  // Çakışan çevre nesnesi id'leri (3D kırmızı tint için).
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

  // Mevcut slew açısındaki köşe yükleri (üstten diyagram için).
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
    const step: WorkStep = {
      id,
      name: `Adım ${steps.length + 1}`,
      config: structuredClone(state),
      summary: summarize(result),
    };
    setSteps((s) => [...s, step]);
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

  const renameStep = (id: string, name: string) => {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, name } : x)));
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">H</div>
        <h1>Hareket Crane Planner</h1>
        <span className="sub">· Vinç Kaldırma Planlama</span>
        <div className="spacer" />
        <span className="pill">{crane.model}</span>
        <span className="pill">{state.counterweight}t · {state.boom_length}m · %{state.capacity_pct}</span>
        {result && (
          <span className={`pill ${collisionBad ? "pill-bad" : warn ? "pill-warn" : "pill-ok"}`}>
            {collisionBad ? "● ÇARPIŞMA" : warn ? "● UYARI" : "● GÜVENLİ"}
          </span>
        )}
      </div>

      <StepsBar
        steps={steps}
        activeStepId={activeStepId}
        onAdd={addStep}
        onSelect={selectStep}
        onDelete={deleteStep}
        onRename={renameStep}
        onReport={() => generateMultiStepReport(steps)}
      />

      <div className="layout">
        <ConfigSidebar cranes={CRANES} crane={crane} state={state} set={set} />

        <div className="col center">
          <InputForm state={state} set={set} />

          <div className="viz">
            <div className="viz-tabs">
              <div className={`viz-tab ${tab === "2d" ? "active" : ""}`} onClick={() => setTab("2d")}>
                ▦ 2D Yan Görünüm
              </div>
              <div className={`viz-tab ${tab === "3d" ? "active" : ""}`} onClick={() => setTab("3d")}>
                ◈ 3D Model
              </div>
              <div className={`viz-tab ${tab === "ground" ? "active" : ""}`} onClick={() => setTab("ground")}>
                ⊕ Üstten / Zemin Kuvveti
              </div>
              <div className={`viz-tab ${tab === "site" ? "active" : ""}`} onClick={() => setTab("site")}>
                🛰 Saha Planı
              </div>
              <div className="spacer" style={{ flex: 1 }} />
            </div>
            <div className="viz-body">
              {tab === "site" ? (
                <SitePlan
                  Lx={outriggerSpan(crane.outrigger_configs[0], state.outrigger_config).Lx}
                  Ly={outriggerSpan(crane.outrigger_configs[0], state.outrigger_config).Ly}
                  radius={state.radius}
                  slewAngle={state.slew_angle}
                  objects={state.objects}
                  collidingIds={collidingIds}
                />
              ) : error ? (
                <div style={{ padding: 24 }}>
                  <div className="error-box">⚠ {error}</div>
                </div>
              ) : result && tab === "2d" ? (
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
              ) : result && tab === "3d" ? (
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
                  outrigger={outriggerSpan(crane.outrigger_configs[0], state.outrigger_config)}
                  clearanceWarning={warn}
                  objects={state.objects}
                  collidingIds={collidingIds}
                />
              ) : result && atAngle ? (
                <GroundForceDiagram
                  Lx={outriggerSpan(crane.outrigger_configs[0], state.outrigger_config).Lx}
                  Ly={outriggerSpan(crane.outrigger_configs[0], state.outrigger_config).Ly}
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

          <ObjectLibrary objects={state.objects} onChange={(objects) => set({ objects })} />
        </div>

        {result ? (
          <ResultsPanel
            result={result}
            state={state}
            onPdf={() => generateReport(crane, state, result)}
          />
        ) : (
          <div className="col results">
            <div className="error-box">Hesap yapılamadı: {error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "10,2x10,6" -> {Lx,Ly} (3D için; hata olursa makul varsayılan). */
function outriggerSpan(_fallback: string, cfg: string): { Lx: number; Ly: number } {
  const p = cfg.split(/x/i).map((s) => parseFloat(s.trim().replace(",", ".")));
  if (p.length === 2 && p.every((n) => isFinite(n) && n > 0)) return { Lx: p[0], Ly: p[1] };
  return { Lx: 10, Ly: 10 };
}

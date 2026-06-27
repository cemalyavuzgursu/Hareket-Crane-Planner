import { useMemo, useState } from "react";
import { CRANES, getCrane } from "./data/cranes";
import { computeLiftFull, type FullLiftResult } from "./engine/index";
import { defaultState, type UIState } from "./ui/state";
import ConfigSidebar from "./ui/ConfigSidebar";
import InputForm from "./ui/InputForm";
import ResultsPanel from "./ui/ResultsPanel";
import SideView2D from "./ui/SideView2D";
import Crane3D from "./ui/Crane3D";
import { generateReport } from "./ui/report";

export default function App() {
  const [state, setState] = useState<UIState>(() => defaultState(CRANES[0]));
  const [tab, setTab] = useState<"2d" | "3d">("2d");

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
      });
      return { result: r, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [crane, state]);

  const warn =
    !!result &&
    (result.clearance.clearance_to_load < 0 ||
      result.clearance.clearance_to_obstacle < 0 ||
      result.capacity.status === "KAPASİTE AŞIMI");

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">H</div>
        <h1>Hareket Crane Planner</h1>
        <span className="sub">· Vinç Kaldırma Planlama</span>
        <div className="spacer" />
        <span className="pill">{crane.model}</span>
        <span className="pill">{state.counterweight}t · {state.boom_length}m · %{state.capacity_pct}</span>
      </div>

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
              <div className="spacer" style={{ flex: 1 }} />
            </div>
            <div className="viz-body">
              {error ? (
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
              ) : result ? (
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
                />
              ) : null}
            </div>
            <div className="legend">
              <span><i className="swatch" style={{ background: "#ffba20" }} /> Bom</span>
              <span><i className="swatch" style={{ background: "#64748b" }} /> Yük</span>
              <span><i className="swatch" style={{ background: "rgba(255,186,32,.5)" }} /> Engel</span>
              <span><i className="swatch" style={{ background: "#5ad1ff" }} /> Maks koça yüks.</span>
              {warn && <span className="bad">● Çarpma/aşım riski</span>}
            </div>
          </div>
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

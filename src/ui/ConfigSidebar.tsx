import type { CraneModel } from "../engine/types";
import type { UIState } from "./state";

interface Props {
  cranes: CraneModel[];
  crane: CraneModel;
  state: UIState;
  set: (patch: Partial<UIState>) => void;
}

export default function ConfigSidebar({ cranes, crane, state, set }: Props) {
  return (
    <div className="cfg-fields">
      <div className="field">
        <label>Vinç Modeli</label>
        <select
          value={state.craneModel}
          onChange={(e) => set({ craneModel: e.target.value })}
        >
          {cranes.map((c) => (
            <option key={c.model} value={c.model}>
              {c.model}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Denge Ağırlığı (Counterweight)</label>
        <div className="toggle-group">
          {crane.counterweight_options.map((cw) => (
            <div
              key={cw}
              className={`toggle ${state.counterweight === cw ? "active" : ""}`}
              onClick={() => set({ counterweight: cw })}
            >
              {cw}t
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Bom Uzunluğu (m)</label>
        <select
          value={state.boom_length}
          onChange={(e) => set({ boom_length: parseFloat(e.target.value) })}
        >
          {crane.boom_lengths.map((b) => (
            <option key={b} value={b}>
              {b} m
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Ayak Açıklığı (Outrigger)</label>
        <select
          value={state.outrigger_config}
          onChange={(e) => set({ outrigger_config: e.target.value })}
        >
          {crane.outrigger_configs.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Kapasite Modu (%)</label>
        <div className="toggle-group">
          {[75, 85].map((p) => (
            <div
              key={p}
              className={`toggle ${state.capacity_pct === p ? "active" : ""}`}
              onClick={() => set({ capacity_pct: p })}
            >
              %{p}
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Dönme Açısı (°) — 0 = arka</label>
        <input
          type="number"
          value={state.slew_angle}
          min={0}
          max={360}
          onChange={(e) => set({ slew_angle: parseFloat(e.target.value) || 0 })}
        />
      </div>

      <div className="disclaimer">
        Veri kaynağı: {crane.source ?? "—"}.<br />
        self_weight: {crane.self_weight ?? "tanımsız"} t
        {crane.datasheet_substitute ? " (datasheet ikamesi)" : ""}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { UIState } from "./state";

interface Props {
  state: UIState;
  set: (patch: Partial<UIState>) => void;
}

interface NumFieldProps {
  label: string;
  unit: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}

/**
 * Sağlam sayı girişi: kullanıcı alanı tamamen silebilir, "1." gibi ara
 * değerler yazabilir. State'e yalnızca geçerli sayı yazılır; harici değer
 * değişince (vinç değişimi vb.) metin senkronize edilir.
 */
function NumField({ label, unit, value, step = 0.1, min, onChange }: NumFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // Dışarıdan gelen değer kutudaki sayıdan farklıysa senkronla.
    const cur = parseFloat(text);
    if (!Number.isFinite(cur) || cur !== value) {
      setText(Number.isFinite(value) ? String(value) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="field">
      <label>
        {label} <span className="unit">({unit})</span>
      </label>
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = parseFloat(t);
          if (Number.isFinite(n)) onChange(min != null ? Math.max(min, n) : n);
        }}
        onBlur={() => {
          // Boş/geçersiz bırakıldıysa mevcut değere geri dön.
          if (!Number.isFinite(parseFloat(text))) setText(String(value));
        }}
      />
    </div>
  );
}

export default function InputForm({ state, set }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div className="card" style={{ margin: 0 }}>
        <h3>⚖ Yük Bilgileri</h3>
        <NumField label="Yük Ağırlığı" unit="t" min={0} value={state.load_weight} onChange={(v) => set({ load_weight: v })} />
        <div className="grid2">
          <NumField label="Koça Ağırlığı" unit="t" min={0} value={state.hook_weight} onChange={(v) => set({ hook_weight: v })} />
          <NumField label="Rigging" unit="t" min={0} value={state.rigging_weight} onChange={(v) => set({ rigging_weight: v })} />
        </div>
        <div className="grid2">
          <NumField label="Yük Yüksekliği" unit="m" min={0} value={state.load_height} onChange={(v) => set({ load_height: v })} />
          <NumField label="Yük Çapı" unit="m" min={0} value={state.load_diameter} onChange={(v) => set({ load_diameter: v })} />
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <h3>📐 Geometri & Engel</h3>
        <NumField label="Çalışma Yarıçapı (Radius)" unit="m" min={0} value={state.radius} onChange={(v) => set({ radius: v })} />
        <div className="grid2">
          <NumField label="Engel Yüksekliği" unit="m" min={0} value={state.obstacle_height} onChange={(v) => set({ obstacle_height: v })} />
          <NumField label="Engel Genişliği" unit="m" min={0} value={state.obstacle_width} onChange={(v) => set({ obstacle_width: v })} />
        </div>
        <NumField label="Engel Yatay Uzaklığı" unit="m" value={state.obstacle_distance} onChange={(v) => set({ obstacle_distance: v })} />
      </div>
    </div>
  );
}

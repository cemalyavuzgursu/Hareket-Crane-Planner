/**
 * UnitInput.tsx — birim sistemine duyarlı sayı girişi.
 *
 * `value` ve `onChange` daima SI (m, t, m², t/m², m/s). Kutuda görüntü
 * birimine çevrilmiş değer gösterilir; kullanıcı yazınca SI'ya geri çevrilir.
 * State'te tam hassasiyet korunur (yuvarlama yalnızca gösterimde).
 * `min` / `max` SI cinsindendir.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { inputDisplay, useUnits, type Units } from "./units";

export type UnitKind = "len" | "mass" | "area" | "pressure" | "wind" | "none";

export function toDisplay(u: Units, kind: UnitKind, si: number): number {
  switch (kind) {
    case "len": return u.len(si);
    case "mass": return u.mass(si);
    case "area": return u.area(si);
    case "pressure": return u.pressure(si);
    case "wind": return u.wind(si);
    default: return si;
  }
}

export function fromDisplay(u: Units, kind: UnitKind, v: number): number {
  switch (kind) {
    case "len": return u.fromLen(v);
    case "mass": return u.fromMass(v);
    case "area": return u.fromArea(v);
    case "pressure": return u.fromPressure(v);
    case "wind": return u.fromWind(v);
    default: return v;
  }
}

export function unitLabel(u: Units, kind: UnitKind): string {
  switch (kind) {
    case "len": return u.lenU;
    case "mass": return u.massU;
    case "area": return u.areaU;
    case "pressure": return u.pressureU;
    case "wind": return u.windU;
    default: return "";
  }
}

/** Görüntü birimine uygun adım: imperial'de ağırlık/basınç adımı büyür. */
function scaledStep(u: Units, kind: UnitKind, step: number | undefined): number | undefined {
  if (step == null || !u.imperial) return step;
  const s = toDisplay(u, kind, step);
  if (!Number.isFinite(s) || s <= 0) return step;
  // "güzel" adıma yuvarla (1, 2, 5 × 10^n)
  const p = Math.pow(10, Math.floor(Math.log10(s)));
  const m = s / p;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * p;
}

export interface UnitInputProps {
  kind: UnitKind;
  value: number;
  onChange: (si: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  className?: string;
  /** Gösterim ondalık sayısı (varsayılan 4 — yalnızca aşırı uzun kesirleri kırpar). */
  decimals?: number;
}

export default function UnitInput({
  kind, value, onChange, step, min, max, disabled, title, style, className, decimals = 4,
}: UnitInputProps) {
  const u = useUnits();
  const disp = (si: number) => (Number.isFinite(si) ? inputDisplay(toDisplay(u, kind, si), decimals) : "");
  const [text, setText] = useState(() => disp(value));
  const lastSys = useRef(u.system);

  useEffect(() => {
    // Birim sistemi değiştiyse ya da dışarıdan gelen değer kutudakinden farklıysa senkronla.
    const cur = parseFloat(text);
    const curSi = Number.isFinite(cur) ? fromDisplay(u, kind, cur) : NaN;
    const same = Number.isFinite(curSi) && Math.abs(curSi - value) <= 1e-9 * Math.max(1, Math.abs(value));
    if (lastSys.current !== u.system || !same) {
      setText(disp(value));
    }
    lastSys.current = u.system;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, u.system]);

  const clamp = (si: number) => {
    let v = si;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    return v;
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      style={style}
      title={title}
      disabled={disabled}
      value={text}
      step={scaledStep(u, kind, step)}
      min={min != null ? inputDisplay(toDisplay(u, kind, min), decimals) : undefined}
      max={max != null ? inputDisplay(toDisplay(u, kind, max), decimals) : undefined}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = parseFloat(t);
        if (Number.isFinite(n)) {
          const si = clamp(fromDisplay(u, kind, n));
          // Kullanıcının yazdığı değer ile SI karşılığı birebir tutarlı olsun:
          // parseFloat(text) → SI → state; senkron efekti tekrar yazmaz (same=true).
          onChange(si);
        }
      }}
      onBlur={() => {
        if (!Number.isFinite(parseFloat(text))) setText(disp(value));
      }}
    />
  );
}

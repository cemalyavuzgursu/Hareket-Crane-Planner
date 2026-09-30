/**
 * units.tsx — Metrik / Imperial birim sistemi (yalnızca GÖRÜNTÜ katmanı).
 *
 * Motor ve state daima SI kalır (m, t, t/m², m/s, m²). Bu modül değerleri
 * görüntü birimine çevirir (len/mass/…) ve kullanıcı girişini SI'ya geri
 * çevirir (fromLen/fromMass/…). State'te tam hassasiyet tutulur; yuvarlama
 * yalnızca gösterimde yapılır.
 *
 * Imperial (ABD vinç tabloları): uzunluk ft, ağırlık lb, basınç psf, rüzgâr mph,
 * alan ft², moment ft·lb.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type UnitSystem = "metric" | "imperial";

export const FT_PER_M = 3.28084;
export const LB_PER_T = 2204.62;
export const PSF_PER_TM2 = 204.816;
export const MPH_PER_MS = 2.23694;
export const FT2_PER_M2 = FT_PER_M * FT_PER_M; // 10.7639

const LS_KEY = "hareket_units";

function readSystem(): UnitSystem {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    return v === "imperial" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

let currentSystem: UnitSystem = readSystem();

export function getUnitSystem(): UnitSystem {
  return currentSystem;
}

/** Sayıyı binlik ayırıcılı biçimle (imperial → en-US "12,345.6"). */
function fmtNum(v: number, digits: number, grouping: boolean): string {
  if (!Number.isFinite(v)) return "—";
  if (!grouping) return v.toFixed(digits);
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Giriş kutusunda gösterilecek değer: gereksiz ondalıkları at (drift yok, state SI). */
export function inputDisplay(v: number, decimals = 4): string {
  if (!Number.isFinite(v)) return "";
  const f = Math.pow(10, decimals);
  return String(Math.round(v * f) / f);
}

export interface Units {
  system: UnitSystem;
  imperial: boolean;
  // uzunluk
  len: (m: number) => number;
  lenU: string;
  fromLen: (v: number) => number;
  fmtLen: (m: number, digits?: number) => string;
  // ağırlık
  mass: (t: number) => number;
  massU: string;
  fromMass: (v: number) => number;
  /** Metrik: "12.5 t"; imperial: "27,558 lb" (digits imperial'de lb ondalığı, varsayılan 0). */
  fmtMass: (t: number, digits?: number) => string;
  /** fmtMass'in birimsiz hali. */
  fmtMassN: (t: number, digits?: number) => string;
  fmtLenN: (m: number, digits?: number) => string;
  // alan
  area: (m2: number) => number;
  areaU: string;
  fromArea: (v: number) => number;
  fmtArea: (m2: number, digits?: number) => string;
  // basınç (zemin)
  pressure: (tm2: number) => number;
  pressureU: string;
  fromPressure: (v: number) => number;
  fmtPressure: (tm2: number, digits?: number) => string;
  // rüzgâr
  wind: (ms: number) => number;
  windU: string;
  fromWind: (v: number) => number;
  fmtWind: (ms: number, digits?: number) => string;
  // moment (t·m → ft·lb)
  moment: (tm: number) => number;
  momentU: string;
  fmtMoment: (tm: number, digits?: number) => string;
}

export function makeUnits(system: UnitSystem): Units {
  const imp = system === "imperial";
  const len = (m: number) => (imp ? m * FT_PER_M : m);
  const mass = (t: number) => (imp ? t * LB_PER_T : t);
  const area = (m2: number) => (imp ? m2 * FT2_PER_M2 : m2);
  const pressure = (p: number) => (imp ? p * PSF_PER_TM2 : p);
  const wind = (v: number) => (imp ? v * MPH_PER_MS : v);
  const moment = (tm: number) => (imp ? tm * LB_PER_T * FT_PER_M : tm);
  const lenU = imp ? "ft" : "m";
  const massU = imp ? "lb" : "t";
  const areaU = imp ? "ft²" : "m²";
  const pressureU = imp ? "psf" : "t/m²";
  const windU = imp ? "mph" : "m/s";
  const momentU = imp ? "ft·lb" : "t·m";
  const fmtLenN = (m: number, d = 2) => fmtNum(len(m), d, false);
  const fmtMassN = (t: number, d?: number) =>
    imp ? fmtNum(mass(t), d ?? 0, true) : fmtNum(t, d ?? 1, false);
  return {
    system,
    imperial: imp,
    len,
    lenU,
    fromLen: (v) => (imp ? v / FT_PER_M : v),
    fmtLen: (m, d = 2) => `${fmtLenN(m, d)} ${lenU}`,
    fmtLenN,
    mass,
    massU,
    fromMass: (v) => (imp ? v / LB_PER_T : v),
    fmtMass: (t, d) => `${fmtMassN(t, d)} ${massU}`,
    fmtMassN,
    area,
    areaU,
    fromArea: (v) => (imp ? v / FT2_PER_M2 : v),
    fmtArea: (m2, d = 2) => `${fmtNum(area(m2), d, false)} ${areaU}`,
    pressure,
    pressureU,
    fromPressure: (v) => (imp ? v / PSF_PER_TM2 : v),
    fmtPressure: (p, d) => `${fmtNum(pressure(p), d ?? (imp ? 0 : 1), imp)} ${pressureU}`,
    wind,
    windU,
    fromWind: (v) => (imp ? v / MPH_PER_MS : v),
    fmtWind: (v, d = 1) => `${fmtNum(wind(v), d, false)} ${windU}`,
    moment,
    momentU,
    fmtMoment: (tm, d) => `${fmtNum(moment(tm), d ?? (imp ? 0 : 1), imp)} ${momentU}`,
  };
}

const cache: Record<UnitSystem, Units> = {
  metric: makeUnits("metric"),
  imperial: makeUnits("imperial"),
};

/** React dışı kullanım (report.ts vb.): mevcut birim sistemi. */
export function unitsStatic(): Units {
  return cache[currentSystem];
}

interface UnitsCtx extends Units {
  setSystem: (s: UnitSystem) => void;
}

const Ctx = createContext<UnitsCtx>({ ...cache[currentSystem], setSystem: () => {} });

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [system, setSys] = useState<UnitSystem>(currentSystem);
  const setSystem = useCallback((s: UnitSystem) => {
    currentSystem = s;
    try {
      localStorage.setItem(LS_KEY, s);
    } catch {
      /* yoksay */
    }
    setSys(s);
  }, []);
  const value = useMemo<UnitsCtx>(() => ({ ...cache[system], setSystem }), [system, setSystem]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnits(): UnitsCtx {
  return useContext(Ctx);
}

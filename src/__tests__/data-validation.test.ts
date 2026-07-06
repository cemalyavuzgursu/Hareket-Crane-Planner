// Veri doğrulama — tüm vinç JSON'larındaki yük tablosu eğrilerinin fiziksel
// olarak tutarlı olduğunu doğrular: radius kesin artan, kapasite artmayan,
// tüm kapasiteler pozitif ve sonlu. Ayrıca boom/counterweight/capacity_pct
// meta alanlarının load_chart ile tutarlılığını kontrol eder.

import { describe, it, expect } from "vitest";
import { CRANES } from "../data/cranes.js";
import type { ChartPoint, CraneModel } from "../engine/types.js";

/**
 * Bilinen, broşür/Excel kaynağında da mevcut küçük artışlar — bu iki noktalık
 * istisnalar dışında hiçbir eğride kapasite artışına izin verilmez. SANY
 * SAC2500E jib tablosundaki bu iki nokta SANY PDF s.44 ve s.46 ile birebir
 * teyitlidir (broşürde gerçekten böyle); veri SİLİNMEDİ.
 */
const KNOWN_CAPACITY_INCREASE_ALLOWLIST = new Set<string>([
  // SANY SAC2500E, TEJ_TEH jib=36.0m boom=65.5m offset=15°: r54(2.3)->r56(2.4) — SANY PDF s.44 ile teyitli.
  "SANY SAC2500E|jib_charts/TEJ_TEH/36.0/65.5/15|54->56",
  // SANY SAC2500E, TEJ_TEH jib=43.0m boom=65.5m offset=50°: r52(1.4)->r54(1.5) — SANY PDF s.46 ile teyitli.
  "SANY SAC2500E|jib_charts/TEJ_TEH/43.0/65.5/50|52->54",
]);

interface NamedCurve {
  crane: string;
  path: string; // ör. "load_chart/40/85/16.5" veya "jib_charts/TEJ_TEH/36.0/65.5/15"
  curve: ChartPoint[];
}

/** crane.load_chart ve crane.jib_charts içindeki tüm eğrileri düz bir listeye çıkarır. */
function collectCurves(crane: CraneModel): NamedCurve[] {
  const out: NamedCurve[] = [];
  for (const cw of Object.keys(crane.load_chart)) {
    for (const pct of Object.keys(crane.load_chart[cw])) {
      for (const boom of Object.keys(crane.load_chart[cw][pct])) {
        const curve = crane.load_chart[cw][pct][boom];
        if (curve && curve.length > 0) {
          out.push({ crane: crane.model, path: `load_chart/${cw}/${pct}/${boom}`, curve });
        }
      }
    }
  }
  if (crane.jib_charts) {
    for (const cfg of Object.keys(crane.jib_charts)) {
      for (const jl of Object.keys(crane.jib_charts[cfg])) {
        for (const boom of Object.keys(crane.jib_charts[cfg][jl])) {
          for (const off of Object.keys(crane.jib_charts[cfg][jl][boom])) {
            const curve = crane.jib_charts[cfg][jl][boom][off];
            if (curve && curve.length > 0) {
              out.push({
                crane: crane.model,
                path: `jib_charts/${cfg}/${jl}/${boom}/${off}`,
                curve,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

const allCurves: NamedCurve[] = CRANES.flatMap(collectCurves);

describe("Veri doğrulama — load_chart / jib_charts eğrileri", () => {
  it.each(allCurves.map((nc): [string, NamedCurve] => [`${nc.crane} ${nc.path}`, nc]))(
    "%s: radius kesin artan",
    (_label, { curve }) => {
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i][0]).toBeGreaterThan(curve[i - 1][0]);
      }
    },
  );

  it.each(allCurves.map((nc): [string, NamedCurve] => [`${nc.crane} ${nc.path}`, nc]))(
    "%s: kapasite artmayan (izin verilenler hariç)",
    (_label, { crane, path, curve }) => {
      for (let i = 1; i < curve.length; i++) {
        const [rPrev, cPrev] = curve[i - 1];
        const [r, c] = curve[i];
        const key = `${crane}|${path}|${rPrev}->${r}`;
        if (c > cPrev) {
          expect(KNOWN_CAPACITY_INCREASE_ALLOWLIST.has(key)).toBe(true);
        }
      }
    },
  );

  it.each(allCurves.map((nc): [string, NamedCurve] => [`${nc.crane} ${nc.path}`, nc]))(
    "%s: tüm kapasiteler >0 ve sonlu",
    (_label, { curve }) => {
      for (const [, c] of curve) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThan(0);
      }
    },
  );

  it("KNOWN_CAPACITY_INCREASE_ALLOWLIST'teki her giriş gerçekten kullanılıyor", () => {
    // Allowlist'te veriden kaldırılmış/artık geçersiz kalan giriş bırakılmasın.
    const used = new Set<string>();
    for (const { crane, path, curve } of allCurves) {
      for (let i = 1; i < curve.length; i++) {
        const [rPrev, cPrev] = curve[i - 1];
        const [r, c] = curve[i];
        if (c > cPrev) {
          used.add(`${crane}|${path}|${rPrev}->${r}`);
        }
      }
    }
    for (const key of KNOWN_CAPACITY_INCREASE_ALLOWLIST) {
      expect(used.has(key)).toBe(true);
    }
  });
});

describe("Veri doğrulama — meta alanlar (boom_lengths / counterweight_options / capacity_pct_options)", () => {
  const numericKeyMatch = (keys: string[], n: number): boolean =>
    keys.some((k) => Math.abs(parseFloat(k) - n) < 1e-6);

  it.each(CRANES.map((c): [string, CraneModel] => [c.model, c]))(
    "%s: boom_lengths her değeri load_chart'ta karşılık bulur",
    (_label, crane) => {
      for (const boom of crane.boom_lengths) {
        let found = false;
        for (const cw of Object.keys(crane.load_chart)) {
          for (const pct of Object.keys(crane.load_chart[cw])) {
            if (numericKeyMatch(Object.keys(crane.load_chart[cw][pct]), boom)) {
              found = true;
            }
          }
        }
        expect(found).toBe(true);
      }
    },
  );

  it.each(CRANES.map((c): [string, CraneModel] => [c.model, c]))(
    "%s: counterweight_options her değerin load_chart'ta tablosu var",
    (_label, crane) => {
      const cwKeys = Object.keys(crane.load_chart);
      for (const cw of crane.counterweight_options) {
        expect(numericKeyMatch(cwKeys, cw)).toBe(true);
      }
    },
  );

  it.each(CRANES.map((c): [string, CraneModel] => [c.model, c]))(
    "%s: capacity_pct_options'taki her yüzde her denge ağırlığı için load_chart'ta dolu",
    (_label, crane) => {
      const pctOptions = crane.capacity_pct_options ?? [75, 85];
      for (const cw of crane.counterweight_options) {
        const cwKey = Object.keys(crane.load_chart).find(
          (k) => Math.abs(parseFloat(k) - cw) < 1e-6,
        );
        expect(cwKey).toBeDefined();
        if (!cwKey) continue;
        for (const pct of pctOptions) {
          const pctKey = Object.keys(crane.load_chart[cwKey]).find(
            (k) => Math.abs(parseFloat(k) - pct) < 1e-6,
          );
          expect(pctKey).toBeDefined();
          if (!pctKey) continue;
          const booms = crane.load_chart[cwKey][pctKey];
          const nonEmptyBooms = Object.values(booms).filter((curve) => curve.length > 0);
          expect(nonEmptyBooms.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

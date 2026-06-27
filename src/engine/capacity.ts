// (A) KAPASİTE KONTROLÜ — load_chart_lookup + doğrusal interpolasyon.
// PROJE.md §2(A). Excel'in VLOOKUP yapısı yerine temiz veri modeli + interpolasyon.

import type { ChartPoint, CraneModel } from "./types.js";

export interface CapacityResult {
  total_load: number; // toplam yük (t)
  rated_capacity: number; // load chart'tan okunan izinli kapasite (t)
  utilization_pct: number; // kullanım yüzdesi (%)
  status: "UYGUN" | "KAPASİTE AŞIMI";
}

/** Anahtar normalizasyonu: 16.5 -> "16.5", 40 -> "40". */
function key(n: number): string {
  return String(n);
}

/**
 * Verilen (counterweight, capacity_pct, boom_length) için kapasite eğrisini bulur.
 * boom_length/counterweight tam eşleşmelidir (eğri seçimi); radius interpole edilir.
 */
export function getCapacityCurve(
  crane: CraneModel,
  counterweight: number,
  capacity_pct: number,
  boom_length: number,
): ChartPoint[] {
  const cw = crane.load_chart[key(counterweight)];
  if (!cw) {
    throw new Error(
      `Load chart: denge ağırlığı tablosu yok: ${counterweight}t (mevcut: ${Object.keys(crane.load_chart).join(", ")})`,
    );
  }
  const pct = cw[key(capacity_pct)];
  if (!pct) {
    throw new Error(
      `Load chart: kapasite yüzdesi tablosu yok: %${capacity_pct} (denge ${counterweight}t için mevcut: ${Object.keys(cw).join(", ")})`,
    );
  }
  const curve = pct[key(boom_length)];
  if (!curve || curve.length === 0) {
    throw new Error(
      `Load chart: bom uzunluğu eğrisi yok: ${boom_length}m (denge ${counterweight}t, %${capacity_pct} için mevcut: ${Object.keys(pct).join(", ")})`,
    );
  }
  return curve;
}

/**
 * Radius'a göre kapasiteyi doğrusal interpolasyonla okur.
 * - Tam noktada: o değer.
 * - Ara değerde: komşu iki nokta arasında doğrusal.
 * - Tablo aralığı dışında: hata (ekstrapolasyon güvenli değil).
 */
export function interpolateCapacity(curve: ChartPoint[], radius: number): number {
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  const rMin = pts[0][0];
  const rMax = pts[pts.length - 1][0];

  if (radius < rMin - 1e-9 || radius > rMax + 1e-9) {
    throw new Error(
      `Radius ${radius}m tablo aralığı dışında [${rMin}, ${rMax}]m. Bu konfigürasyonda kaldırma yapılamaz.`,
    );
  }
  // Tam/komşu nokta arama
  for (let i = 0; i < pts.length; i++) {
    const [r, c] = pts[i];
    if (Math.abs(r - radius) < 1e-9) return c;
    if (r > radius) {
      const [r0, c0] = pts[i - 1];
      const t = (radius - r0) / (r - r0);
      return c0 + t * (c - c0);
    }
  }
  return pts[pts.length - 1][1];
}

/** load_chart_lookup: eğri seç + radius interpole et. */
export function loadChartLookup(
  crane: CraneModel,
  counterweight: number,
  capacity_pct: number,
  boom_length: number,
  radius: number,
): number {
  const curve = getCapacityCurve(crane, counterweight, capacity_pct, boom_length);
  return interpolateCapacity(curve, radius);
}

/** (A) Kapasite kontrolü — PROJE.md formülleri. */
export function computeCapacity(
  crane: CraneModel,
  inp: {
    load_weight: number;
    hook_weight: number;
    rigging_weight: number;
    counterweight: number;
    capacity_pct: number;
    boom_length: number;
    radius: number;
  },
): CapacityResult {
  const total_load = inp.load_weight + inp.hook_weight + inp.rigging_weight;
  const rated_capacity = loadChartLookup(
    crane,
    inp.counterweight,
    inp.capacity_pct,
    inp.boom_length,
    inp.radius,
  );
  const utilization_pct = (total_load / rated_capacity) * 100;
  const status = utilization_pct > 100 ? "KAPASİTE AŞIMI" : "UYGUN";
  return { total_load, rated_capacity, utilization_pct, status };
}

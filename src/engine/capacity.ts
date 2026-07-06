// (A) KAPASİTE KONTROLÜ — load_chart_lookup + doğrusal interpolasyon.
// PROJE.md §2(A). Excel'in VLOOKUP yapısı yerine temiz veri modeli + interpolasyon.

import type { ChartPoint, CraneModel, LiftConfig } from "./types.js";

export interface CapacityResult {
  total_load: number; // toplam yük (t)
  rated_capacity: number; // load chart'tan okunan izinli kapasite (t)
  utilization_pct: number; // kullanım yüzdesi (%)
  status: "UYGUN" | "KAPASİTE AŞIMI";
  /** Kullanım bandı: >100% "over", >=90% "warning", altı "ok". */
  severity: "ok" | "warning" | "over";
}

/** utilization_pct'ten severity bandını hesaplar (>100 over, >=90 warning, altı ok). */
function severityFor(utilization_pct: number): "ok" | "warning" | "over" {
  if (utilization_pct > 100) return "over";
  if (utilization_pct >= 90) return "warning";
  return "ok";
}

/** Anahtar normalizasyonu: 16.5 -> "16.5", 40 -> "40". */
function key(n: number): string {
  return String(n);
}

/**
 * Sayısal anahtar araması. Önce birebir String(n) dener; bulunamazsa
 * sayısal eşitlikle eşleşen anahtarı bulur ("55.0" vs "55", "75.0" vs "75"
 * gibi JSON/JS String() farklarını tolere eder).
 */
function pickByNumber<T>(
  obj: Record<string, T> | undefined,
  n: number,
): T | undefined {
  if (!obj) return undefined;
  const direct = obj[key(n)];
  if (direct !== undefined) return direct;
  for (const k of Object.keys(obj)) {
    if (Math.abs(parseFloat(k) - n) < 1e-9) return obj[k];
  }
  return undefined;
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
  const cw = pickByNumber(crane.load_chart, counterweight);
  if (!cw) {
    throw new Error(
      `Load chart: denge ağırlığı tablosu yok: ${counterweight}t (mevcut: ${Object.keys(crane.load_chart).join(", ")})`,
    );
  }
  const pct = pickByNumber(cw, capacity_pct);
  if (!pct) {
    throw new Error(
      `Load chart: kapasite yüzdesi tablosu yok: %${capacity_pct} (denge ${counterweight}t için mevcut: ${Object.keys(cw).join(", ")})`,
    );
  }
  const curve = pickByNumber(pct, boom_length);
  if (!curve || curve.length === 0) {
    throw new Error(
      `Load chart: bom uzunluğu eğrisi yok: ${boom_length}m (denge ${counterweight}t, %${capacity_pct} için mevcut: ${Object.keys(pct).join(", ")})`,
    );
  }
  return curve;
}

/**
 * Radius'a göre kapasiteyi "step-down" (bir büyük yarıçapa yuvarlama) politikasıyla okur.
 * - Tam tablo noktasında: o değer.
 * - Ara değerde: radius'tan büyük veya eşit ilk tablo noktasının kapasitesi
 *   (yani bir sonraki büyük yarıçapın, dolayısıyla daha düşük/konservatif kapasitenin) döner.
 * - Tablo aralığı dışında: hata (ekstrapolasyon güvenli değil).
 *
 * Neden doğrusal interpolasyon değil: yük tablosu eğrisi radius arttıkça
 * kapasitenin azaldığı, konveks (dışbükey) bir eğridir. Konveks bir eğride iki
 * komşu nokta arasını düz çizgiyle birleştirmek, gerçek eğrinin ÜZERİNDE kalır —
 * yani ara yarıçaplarda olduğundan FAZLA kapasite okunur. Bu, güvenlik kritik bir
 * hesapta kabul edilemez bir risktir. Sektör pratiği (ve çoğu üretici yazılımı),
 * tablo dışı bir yarıçapta bir sonraki (daha büyük) tablo noktasının kapasitesini
 * kullanmaktır; bu her zaman gerçek kapasiteye eşit veya ondan düşüktür, yani
 * güvenli tarafta kalır.
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
  // İlk nokta: radius'a eşit ya da ondan büyük (tam eşleşme veya bir üst kademe).
  for (const [r, c] of pts) {
    if (r >= radius - 1e-9) return c;
  }
  // Buraya teorik olarak ulaşılmaz (rMax kontrolü yukarıda yapıldı).
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

/**
 * Jib (副臂) kapasite eğrisini bulur.
 * jib_charts[config][jib_length][boom_length][offset_deg] içinden eğri seçer.
 * boom/jib/offset tam eşleşmeli; radius interpole edilir.
 */
export function getJibCapacityCurve(
  crane: CraneModel,
  config: LiftConfig,
  jib_length: number,
  boom_length: number,
  jib_offset: number,
): ChartPoint[] {
  if (!crane.jib_charts) {
    throw new Error("Bu vinçte jib yük tablosu yok.");
  }
  const cfg = crane.jib_charts[config];
  if (!cfg) {
    throw new Error(
      `Jib tablosu yok: ${config} (mevcut: ${Object.keys(crane.jib_charts).join(", ")})`,
    );
  }
  const jl = pickByNumber(cfg, jib_length);
  if (!jl) {
    throw new Error(
      `Jib uzunluğu tablosu yok: ${jib_length}m (${config} için mevcut: ${Object.keys(cfg).join(", ")})`,
    );
  }
  const bl = pickByNumber(jl, boom_length);
  if (!bl) {
    throw new Error(
      `Jib için bom uzunluğu tablosu yok: ${boom_length}m (${config} ${jib_length}m için mevcut: ${Object.keys(jl).join(", ")})`,
    );
  }
  const curve = pickByNumber(bl, jib_offset);
  if (!curve || curve.length === 0) {
    throw new Error(
      `Jib ofset açısı eğrisi yok: ${jib_offset}° (${config} ${jib_length}m bom ${boom_length}m için mevcut: ${Object.keys(bl).join(", ")})`,
    );
  }
  return curve;
}

/** Jib kapasite lookup: eğri seç + radius interpole et. */
export function jibChartLookup(
  crane: CraneModel,
  config: LiftConfig,
  jib_length: number,
  boom_length: number,
  jib_offset: number,
  radius: number,
): number {
  const curve = getJibCapacityCurve(crane, config, jib_length, boom_length, jib_offset);
  return interpolateCapacity(curve, radius);
}

/** Jib modu kapasite kontrolü (kapasite yapısını T modu ile aynı döner). */
export function computeJibCapacity(
  crane: CraneModel,
  inp: {
    load_weight: number;
    hook_weight: number;
    rigging_weight: number;
    config: LiftConfig;
    jib_length: number;
    boom_length: number;
    jib_offset: number;
    radius: number;
  },
): CapacityResult {
  const total_load = inp.load_weight + inp.hook_weight + inp.rigging_weight;
  const rated_capacity = jibChartLookup(
    crane,
    inp.config,
    inp.jib_length,
    inp.boom_length,
    inp.jib_offset,
    inp.radius,
  );
  const utilization_pct = (total_load / rated_capacity) * 100;
  const status = utilization_pct > 100 ? "KAPASİTE AŞIMI" : "UYGUN";
  return { total_load, rated_capacity, utilization_pct, status, severity: severityFor(utilization_pct) };
}

export interface ReevingResult {
  required_parts: number; // gerekli halat donanımı (parça) sayısı
  single_line_pull_t: number; // tek halat çekiş kapasitesi (t)
  feasible: boolean; // max_parts içinde karşılanabiliyor mu
}

/**
 * Halat donanımı (reeving) kontrolü: toplam yükü kaldırmak için gereken
 * parça (falso) sayısı = ceil(total_load / single_line_pull_t).
 * max_parts (vinç makarasının fiziksel üst sınırı) aşılırsa feasible=false.
 */
export function computeReeving(
  single_line_pull_t: number,
  total_load: number,
  max_parts = 14,
): ReevingResult {
  const required_parts =
    single_line_pull_t > 0 ? Math.ceil(total_load / single_line_pull_t) : Infinity;
  const feasible = required_parts > 0 && required_parts <= max_parts;
  return { required_parts, single_line_pull_t, feasible };
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
  return { total_load, rated_capacity, utilization_pct, status, severity: severityFor(utilization_pct) };
}

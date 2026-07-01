// (C) AYAK (OUTRIGGER) REAKSİYONU — YENİ, Excel'de yok.
// PROJE.md §2(C). Eksantrik yüklü temel mantığı + slew taraması + zemin basıncı.
//
// Not: Bu hesap datasheet'ten crane_self_weight ister. self_weight null ise
// çağıran taraf değer sağlamalıdır; aksi halde hata verilir.

export interface OutriggerInputs {
  crane_self_weight: number; // vinç boş ağırlığı (t)
  counterweight: number; // denge ağırlığı (t)
  total_load: number; // toplam kaldırılan yük (t)
  radius: number; // yük radius'u (m)
  Lx: number; // ayak açıklığı X (m)
  Ly: number; // ayak açıklığı Y (m)
  /** Bileşke makinenin/dengenin sabit eksantrikliği (m). Bilinmiyorsa 0. */
  base_offset_x?: number;
  base_offset_y?: number;
  /** Takoz (pad) temas alanı (m²) — zemin basıncı için. */
  pad_area?: number;
}

export interface CornerLoad {
  label: string; // köşe etiketi (FL, FR, RL, RR)
  load: number; // o köşeye düşen düşey kuvvet (t)
}

export interface OutriggerAtAngle {
  slew_angle: number; // derece
  corners: CornerLoad[];
  max_corner: CornerLoad;
  /** Bileşke ağırlık merkezinin ayak dikdörtgeni merkezine göre kayması (m). */
  cog_x: number;
  cog_y: number;
  /** En az bir ayak yükü kalktı (doğrusal formül negatif verdi) → 3 ayağa yeniden dağıtıldı. */
  uplift: boolean;
  /** Yük 3 ayakla bile dengelenemiyor (CoG destek üçgeni dışında) → devrilme riski. */
  tipping: boolean;
}

export interface OutriggerResult {
  V: number; // bileşke düşey kuvvet (t)
  critical_angle: number; // en kritik slew açısı (°)
  max_corner_load: number; // en büyük köşe yükü (t) — tüm açılar arası
  max_corner_label: string;
  /** Taramada herhangi bir açıda ayak kalkması oluştu mu. */
  has_uplift: boolean;
  /** Taramada herhangi bir açıda devrilme riski oluştu mu. */
  tipping_risk: boolean;
  ground_pressure?: number; // takoz altı basınç (t/m²), pad_area verilirse
  /** Takoz temas alanı (m²) — köşe basınçlarını UI'da göstermek için. */
  pad_area?: number;
  per_angle: OutriggerAtAngle[]; // tarama detayları
}

const CORNERS: Array<{ label: string; sx: 1 | -1; sy: 1 | -1 }> = [
  { label: "FR", sx: +1, sy: +1 },
  { label: "FL", sx: -1, sy: +1 },
  { label: "RR", sx: +1, sy: -1 },
  { label: "RL", sx: -1, sy: -1 },
];

/** "10,2x10,6" -> {Lx:10.2, Ly:10.6}. Türkçe ondalık virgül desteklenir. */
export function parseOutriggerConfig(cfg: string): { Lx: number; Ly: number } {
  const parts = cfg.split(/x/i).map((s) => parseFloat(s.trim().replace(",", ".")));
  if (parts.length !== 2 || parts.some((n) => !isFinite(n) || n <= 0)) {
    throw new Error(`Geçersiz ayak konfigürasyonu: "${cfg}" (beklenen "Lx x Ly", ör. "10,2x10,6")`);
  }
  return { Lx: parts[0], Ly: parts[1] };
}

const DEG = Math.PI / 180;

/**
 * Bir ayak kalkınca (yük 0) kalan 3 ayak statik olarak belirlidir:
 *   ΣP = V, ΣP·x = V·ex, ΣP·y = V·ey  →  3×3 doğrusal sistem (Cramer).
 * Çözüm yoksa (tekil) null döner.
 */
function solveThreeSupport(
  V: number,
  ex: number,
  ey: number,
  pts: Array<{ x: number; y: number }>,
): [number, number, number] | null {
  const [p1, p2, p3] = pts;
  const det =
    1 * (p2.x * p3.y - p3.x * p2.y) -
    1 * (p1.x * p3.y - p3.x * p1.y) +
    1 * (p1.x * p2.y - p2.x * p1.y);
  if (Math.abs(det) < 1e-12) return null;
  const b = [V, V * ex, V * ey];
  // Cramer: her sütunu b ile değiştir. Matris satırları: [1,1,1],[x1,x2,x3],[y1,y2,y3]
  const detFor = (col: number) => {
    const m = [
      [1, 1, 1],
      [p1.x, p2.x, p3.x],
      [p1.y, p2.y, p3.y],
    ].map((row) => [...row]);
    for (let r = 0; r < 3; r++) m[r][col] = b[r];
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  };
  return [detFor(0) / det, detFor(1) / det, detFor(2) / det];
}

/**
 * Tek bir slew açısı için 4 köşe reaksiyonu.
 *
 * Not: Denge ağırlığı ve bom öz-ağırlığının slew ile dönen momentleri
 * modellenmez (broşürlerde ağırlık merkezi kolları yok); bunlar yüke göre
 * ters yönde çalıştığından yüklü taraf köşeleri için sonuç muhafazakârdır.
 */
export function cornerLoadsAtAngle(
  inp: OutriggerInputs,
  slew_angle_deg: number,
): OutriggerAtAngle {
  const V = inp.crane_self_weight + inp.counterweight + inp.total_load;
  const a = slew_angle_deg * DEG;

  // Yükün ayak dikdörtgeni içindeki yatay konumu (slew ile döner).
  const load_offset_x = inp.radius * Math.cos(a);
  const load_offset_y = inp.radius * Math.sin(a);

  // Bileşke ağırlık merkezinin merkeze göre kayması (moment dengesi):
  // e = (Σ kuvvet·kol) / V. Yükün katkısı baskındır; sabit base offset eklenir.
  const e_x = (inp.total_load * load_offset_x) / V + (inp.base_offset_x ?? 0);
  const e_y = (inp.total_load * load_offset_y) / V + (inp.base_offset_y ?? 0);

  // Doğrusal (rijit plaka) formülü — dört ayak da basınçta ise geçerli.
  let loads = CORNERS.map(
    ({ sx, sy }) => (V / 4) * (1 + (sx * 2 * e_x) / inp.Lx + (sy * 2 * e_y) / inp.Ly),
  );

  // Ayak zemini ÇEKEMEZ: negatif köşe fiziksel değil. En negatif ayak kalkar,
  // yük kalan 3 ayağa statik dengeyle dağıtılır (aksi halde maks köşe yükü
  // olduğundan DÜŞÜK raporlanır — güvensiz).
  let uplift = false;
  let tipping = false;
  const minLoad = Math.min(...loads);
  if (minLoad < -1e-9) {
    uplift = true;
    const liftIdx = loads.indexOf(minLoad);
    const rest = CORNERS.map((c, i) => ({ i, x: (c.sx * inp.Lx) / 2, y: (c.sy * inp.Ly) / 2 }))
      .filter(({ i }) => i !== liftIdx);
    const solved = solveThreeSupport(V, e_x, e_y, rest);
    if (solved && solved.every((p) => p > -1e-9)) {
      loads = loads.map(() => 0);
      rest.forEach(({ i }, k) => (loads[i] = Math.max(solved[k], 0)));
    } else {
      // CoG destek üçgeninin de dışında → statik denge kurulamaz: devrilme.
      tipping = true;
      loads = loads.map((p) => Math.max(p, 0));
      const sum = loads.reduce((s, p) => s + p, 0);
      if (sum > 1e-9) loads = loads.map((p) => (p * V) / sum); // en iyi tahmin
    }
  }

  const corners: CornerLoad[] = CORNERS.map(({ label }, i) => ({ label, load: loads[i] }));
  const max_corner = corners.reduce((m, c) => (c.load > m.load ? c : m), corners[0]);
  return { slew_angle: slew_angle_deg, corners, max_corner, cog_x: e_x, cog_y: e_y, uplift, tipping };
}

/** 0–360° taraması; en kritik açı/ayak ve (opsiyonel) zemin basıncı. */
export function computeOutrigger(
  inp: OutriggerInputs,
  step_deg = 1,
): OutriggerResult {
  if (!isFinite(inp.crane_self_weight) || inp.crane_self_weight <= 0) {
    throw new Error(
      "Ayak reaksiyonu için crane_self_weight gerekli (datasheet'ten). self_weight tanımlı değil.",
    );
  }
  const V = inp.crane_self_weight + inp.counterweight + inp.total_load;
  const per_angle: OutriggerAtAngle[] = [];
  let critical: OutriggerAtAngle | null = null;

  for (let deg = 0; deg < 360; deg += step_deg) {
    const at = cornerLoadsAtAngle(inp, deg);
    per_angle.push(at);
    if (!critical || at.max_corner.load > critical.max_corner.load) critical = at;
  }
  const c = critical!;
  const result: OutriggerResult = {
    V,
    critical_angle: c.slew_angle,
    max_corner_load: c.max_corner.load,
    max_corner_label: c.max_corner.label,
    has_uplift: per_angle.some((a) => a.uplift),
    tipping_risk: per_angle.some((a) => a.tipping),
    per_angle,
  };
  if (inp.pad_area && inp.pad_area > 0) {
    result.ground_pressure = c.max_corner.load / inp.pad_area;
    result.pad_area = inp.pad_area;
  }
  return result;
}

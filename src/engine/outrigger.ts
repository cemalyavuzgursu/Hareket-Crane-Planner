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
}

export interface OutriggerResult {
  V: number; // bileşke düşey kuvvet (t)
  critical_angle: number; // en kritik slew açısı (°)
  max_corner_load: number; // en büyük köşe yükü (t) — tüm açılar arası
  max_corner_label: string;
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

/** Tek bir slew açısı için 4 köşe reaksiyonu. */
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

  const corners: CornerLoad[] = CORNERS.map(({ label, sx, sy }) => ({
    label,
    load: (V / 4) * (1 + (sx * 2 * e_x) / inp.Lx + (sy * 2 * e_y) / inp.Ly),
  }));

  const max_corner = corners.reduce((m, c) => (c.load > m.load ? c : m), corners[0]);
  return { slew_angle: slew_angle_deg, corners, max_corner, cog_x: e_x, cog_y: e_y };
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
    per_angle,
  };
  if (inp.pad_area && inp.pad_area > 0) {
    result.ground_pressure = c.max_corner.load / inp.pad_area;
    result.pad_area = inp.pad_area;
  }
  return result;
}

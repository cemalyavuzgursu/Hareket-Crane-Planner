// Vinç "donanım" geometrisi — 2B yandan görünüş ve 3B model için TEK kaynak.
// Saf fonksiyon: vinç verisi (dimensions + geometry_constants) + anlık durum →
// metre cinsinden çizim primitifleri. UI'dan bağımsızdır, test edilebilir.
//
// Koordinat konvansiyonu (bkz. docs/superpowers/specs/2026-09-29-...):
//   - Slew merkezi orijin. Üst yapı yerel çerçevesi: +u = bom yönü (yüke doğru),
//     y = yukarı. Şasi dünya çerçevesi: +X = şasi ARKASI, +Z = yanal.
//   - Slew a → bom yönü dünya (cos a, sin a). 0° = arka üzerinden.
//   - Bom mafsalı (−boom_offset, cribbing+machine_ground) — clearance.ts ile aynı.
//   - Klerens modelinde γ, mafsal→makara doğrusunun açısıdır; bom EKSENİ
//     γ+α açısındadır (α = atan(sheave_offset/L)). Makara noktası tam olarak
//     x = radius'a düşer, halat dik iner.

import type { CraneAppearance, CraneDimensions, CraneModel, GeometryConstants } from "../engine/types";

export interface Pt {
  x: number;
  y: number;
}

/** Eksik alanları vinç sınıfına göre makul varsayılanlarla doldurulmuş ölçüler. */
export interface ResolvedDims extends Required<Omit<CraneDimensions, "source" | "estimated_fields">> {
  source?: string;
}

export function resolveDims(crane: CraneModel): ResolvedDims {
  const g = crane.geometry_constants;
  const d: Partial<CraneDimensions> = crane.dimensions ?? {};
  const len = d.carrier_length_m ?? 15;
  const axles = d.axle_count ?? 5;
  const pivotH = d.boom_pivot_height_m ?? g.machine_ground_height;
  const deck = d.deck_height_m ?? 2.2;
  return {
    source: d.source,
    carrier_length_m: len,
    carrier_width_m: d.carrier_width_m ?? 3,
    body_width_m: d.body_width_m ?? (d.carrier_width_m ?? 3) - 0.2,
    travel_height_m: d.travel_height_m ?? 4,
    ground_clearance_m: d.ground_clearance_m ?? 0.3,
    deck_height_m: deck,
    axle_count: axles,
    tire_diameter_m: d.tire_diameter_m ?? 1.4,
    wheelbase_front_m: d.wheelbase_front_m ?? 2,
    axle_positions_m:
      d.axle_positions_m ?? Array.from({ length: axles }, (_, i) => 2.6 + (i * (len - 4.6)) / Math.max(1, axles - 1)),
    tail_radius_m: d.tail_radius_m ?? 5,
    cab_height_m: d.cab_height_m ?? 3.6,
    boom_pivot_height_m: pivotH,
    boom_pivot_x_m: d.boom_pivot_x_m ?? -g.boom_offset,
    superstructure_deck_height_m: d.superstructure_deck_height_m ?? deck + 0.3,
    counterweight_height_m: d.counterweight_height_m ?? 2.4,
    boom_stowed_length_m: d.boom_stowed_length_m ?? Math.min(...crane.boom_lengths),
    slew_center_from_front_m: d.slew_center_from_front_m ?? len * 0.62,
    boom_sections: d.boom_sections ?? 6,
    boom_base_depth_m: d.boom_base_depth_m ?? 1.6,
    boom_base_width_m: d.boom_base_width_m ?? 1.1,
    counterweight_max_t: d.counterweight_max_t ?? Math.max(...crane.counterweight_options, 1),
    counterweight_depth_m: d.counterweight_depth_m ?? 1.9,
    counterweight_width_m: d.counterweight_width_m ?? 2.9,
    outrigger_x_m: d.outrigger_x_m ?? [],
    outrigger_rear_fraction: d.outrigger_rear_fraction ?? 0.5,
    color: d.color ?? "#f2c200",
  };
}

export interface BoomSection {
  /** Bom ekseni boyunca başlangıç/bitiş (mafsaldan, m). */
  s0: number;
  s1: number;
  depth: number; // kesit yüksekliği (m)
  width: number; // kesit genişliği (m)
}

/** Çizime hazır profil parçası (metre; carrier: dünya X, superstructure: u). */
export interface RigPart {
  pts: Pt[];
  color: string; // çözülmüş #hex
  width: number; // 3B kalınlık
  side: "left" | "right" | "center";
  glass: boolean; // cam: 3B'de bir önceki parçayla eş merkezli, parlak
}

export interface CraneLook {
  colors: Record<string, string>;
  carrier: RigPart[];
  superstructure: RigPart[];
}

const DEFAULT_COLORS: Record<string, string> = {
  body: "#f5c400",
  chassis: "#2b2e33",
  glass: "#2c4257",
  boom: "#f5c400",
  cw: "#565f69",
  dark: "#3a3f45",
};

export interface CraneRig {
  dims: ResolvedDims;
  /** Vince özgü görünüm (çizimden profiller). null → genel parametrik çizim. */
  look: CraneLook | null;
  /** Ayaklar açıkken tüm makinenin kalkma miktarı (tekerlek boşluğu dahil). */
  lift: number;
  base: number; // bom mafsalı yüksekliği (m)
  carrier: {
    frontX: number; // dünya X (ön uç, negatif)
    rearX: number; // dünya X (arka uç, pozitif)
    bottomY: number;
    deckY: number;
    width: number;
    axleXs: number[]; // dünya X
    tireR: number;
    tireY: number; // lastik merkezi y (havada)
    cab: { x0: number; x1: number; y0: number; y1: number }; // sürücü kabini (ön)
  };
  outriggers: {
    /** 4 tabla merkezi, dünya (X, Z). Sıra: arka-sağ, arka-sol, ön-sağ, ön-sol. */
    pads: Array<{ x: number; z: number }>;
    padSize: number; // tabla kenarı (m)
    padH: number; // tabla kalınlığı
    boxXs: number[]; // ayak kutularının şasi üzerindeki dünya X'leri (arka, ön)
    beamY: number; // kiriş merkezi y
    cribbing: number; // takoz yüksekliği
  };
  superstructure: {
    u0: number; // arka (negatif u)
    u1: number; // ön
    y0: number;
    y1: number;
    width: number;
    cab: { u0: number; u1: number; y0: number; y1: number; zOff: number };
  };
  counterweight: {
    u0: number;
    u1: number;
    y0: number;
    y1: number;
    width: number;
    plates: number; // plaka sayısı (0 = CW yok)
  };
  boom: {
    foot: Pt;
    /** Bom ekseni açısı (rad) — γ+α. */
    axisAngle: number;
    length: number;
    /** Eksen ucu (bom başı merkezi). */
    tip: Pt;
    /** Makara (halat çıkış) noktası — x = radius. */
    sheave: Pt;
    sections: BoomSection[];
    headLen: number;
  };
}

export interface RigInput {
  crane: CraneModel;
  boom_length: number;
  /** Mafsal→makara doğrusunun açısı γ (rad); jib modunda bom açısı θ. */
  gama: number;
  /** α dahil edilsin mi (ana bom modu). Jib modunda false (açı zaten eksen açısı). */
  withSheaveOffset: boolean;
  counterweight: number;
  Lx: number;
  Ly: number;
}

export function buildRig(inp: RigInput): CraneRig {
  const { crane, boom_length: L, gama, counterweight } = inp;
  const g: GeometryConstants = crane.geometry_constants;
  const dims = resolveDims(crane);
  const base = g.cribbing_height + g.machine_ground_height;
  // Seyir hâlinde mafsal yüksekliği dims.boom_pivot_height_m; ayaklarda makine
  // takoz + ayak stroku kadar kalkar → çizimde tüm gövde `lift` kadar yukarıda.
  const lift = Math.max(0.12, base - dims.boom_pivot_height_m);

  // ── Şasi (dünya X, +X = arka) ─────────────────────────────────────────────
  const frontX = -dims.slew_center_from_front_m;
  const rearX = frontX + dims.carrier_length_m;
  const tireR = dims.tire_diameter_m / 2;
  const deckY = dims.deck_height_m + lift;
  const bottomY = dims.ground_clearance_m + lift;
  const axleXs = dims.axle_positions_m.map((p) => frontX + p);
  const cab = {
    x0: frontX,
    x1: frontX + 2.3,
    y0: bottomY + 0.4,
    y1: dims.cab_height_m + lift,
  };

  // ── Ayaklar: hesap modeliyle aynı — arka +rear, ön −front (asimetrik olabilir) ──
  const { rear, front } = outriggerXs(inp.Lx, dims.outrigger_rear_fraction);
  const hz = inp.Ly / 2;
  const pads = [
    { x: rear, z: hz },
    { x: rear, z: -hz },
    { x: -front, z: hz },
    { x: -front, z: -hz },
  ];
  const boxXs = [rear, -front];

  // ── Üst yapı (yerel u, +u = bom yönü) ───────────────────────────────────────
  const tail = dims.tail_radius_m;
  const ssY0 = dims.superstructure_deck_height_m + lift;
  const ss = {
    u0: -tail + dims.counterweight_depth_m * 0.6,
    u1: 2.2,
    y0: ssY0,
    y1: Math.max(ssY0 + 1.0, base + 0.4),
    width: Math.min(dims.carrier_width_m, 2.8),
    cab: {
      u0: -0.4,
      u1: 1.9,
      y0: ssY0 - 0.5,
      y1: Math.max(ssY0 + 1.4, dims.travel_height_m + lift - 0.05),
      zOff: dims.carrier_width_m / 2 - 0.55,
    },
  };

  // ── Denge ağırlığı: plaka yığını, arka kenar = kuyruk yarıçapı ──────────────
  const cwFrac = Math.max(0, Math.min(1, counterweight / dims.counterweight_max_t));
  const plates = counterweight > 0 ? Math.max(1, Math.round(cwFrac * 6)) : 0;
  const cwH = plates === 0 ? 0 : Math.max(0.45, dims.counterweight_height_m * cwFrac);
  const cw = {
    u0: -tail,
    u1: -tail + dims.counterweight_depth_m,
    y0: ssY0 + 0.1,
    y1: ssY0 + 0.1 + cwH,
    width: dims.counterweight_width_m,
    plates,
  };

  // ── Vince özgü görünüm: profilleri ayak kalkması (lift) kadar yükselt ─────
  const app: CraneAppearance | undefined = crane.appearance;
  let look: CraneLook | null = null;
  if (app) {
    const colors = { ...DEFAULT_COLORS, ...app.colors };
    const col = (c: string) => (c.startsWith("#") ? c : colors[c] ?? "#888888");
    const bodyW = dims.body_width_m;
    look = {
      colors,
      carrier: app.carrier.map((p) => ({
        pts: p.pts.map(([x, y]) => ({ x: frontX + x, y: y + lift })),
        color: col(p.color),
        width: p.width ?? bodyW,
        side: p.side ?? "center",
        glass: p.color === "glass",
      })),
      superstructure: app.superstructure.map((p) => ({
        pts: p.pts.map(([u, y]) => ({ x: u, y: y + lift })),
        color: col(p.color),
        width: p.width ?? Math.min(bodyW, 2.6),
        side: p.side ?? "center",
        glass: p.color === "glass",
      })),
    };
    if (app.counterweight_box) {
      const b = app.counterweight_box;
      cw.u0 = b.u0;
      cw.u1 = b.u1;
      cw.y0 = b.y0 + lift;
      cw.y1 = plates === 0 ? cw.y0 : cw.y0 + Math.max(0.35, (b.y1 - b.y0) * cwFrac);
    }
  }

  // ── Bom ─────────────────────────────────────────────────────────────────────
  const foot: Pt = { x: -g.boom_offset, y: base };
  const alfa = inp.withSheaveOffset ? Math.atan(g.sheave_offset / L) : 0;
  const axisAngle = gama + alfa;
  const tip: Pt = { x: foot.x + L * Math.cos(axisAngle), y: foot.y + L * Math.sin(axisAngle) };
  const z = inp.withSheaveOffset ? L / Math.cos(alfa) : L;
  const sheave: Pt = { x: foot.x + z * Math.cos(gama), y: foot.y + z * Math.sin(gama) };

  const n = Math.max(1, dims.boom_sections);
  const b0 = Math.min(dims.boom_stowed_length_m, L);
  const ext = Math.max(0, L - b0);
  const sections: BoomSection[] = [];
  for (let i = 0; i < n; i++) {
    // Her teleskop eşit uzar; bölüm i ucu = b0 + i·ext/(n−1).
    const end = n === 1 ? L : b0 + (i * ext) / (n - 1);
    const len = b0 * (1 - 0.04 * i);
    const k = 1 - 0.1 * i;
    sections.push({
      s0: Math.max(0, end - len),
      s1: end,
      depth: dims.boom_base_depth_m * Math.max(0.35, k),
      width: dims.boom_base_width_m * Math.max(0.4, k),
    });
  }

  return {
    dims,
    look,
    lift,
    base,
    carrier: {
      frontX,
      rearX,
      bottomY,
      deckY,
      width: dims.carrier_width_m,
      axleXs,
      tireR,
      tireY: tireR + Math.max(0.1, lift - 0.3),
      cab,
    },
    outriggers: {
      pads,
      padSize: 0.9,
      padH: 0.12,
      boxXs,
      beamY: bottomY + 0.35,
      cribbing: g.cribbing_height,
    },
    superstructure: ss,
    counterweight: cw,
    boom: { foot, axisAngle, length: L, tip, sheave, sections, headLen: 1.6 },
  };
}

/** Boyuna ayak açıklığını slew merkezine göre arka/ön mesafelere böler. */
export function outriggerXs(Lx: number, rearFraction = 0.5): { rear: number; front: number } {
  const f = Math.min(0.9, Math.max(0.1, rearFraction));
  return { rear: Lx * f, front: Lx * (1 - f) };
}

/** Bir dünya noktasının (X,Z) bom düzlemi üzerindeki u izdüşümü. */
export function projectU(x: number, z: number, slewRad: number): number {
  return x * Math.cos(slewRad) + z * Math.sin(slewRad);
}

/** Kanca bloğu dikey yerleşimi: yükün üstünde sapan boyu kadar, maks. kanca yüksekliğini aşmadan. */
export function hookPlacement(
  g: GeometryConstants,
  sheaveY: number,
  loadTopY: number,
  loadDiameter: number,
  /** Aparat (sapan/traverse) toplam yüksekliği — verilirse sapan boyu yerine kullanılır. */
  riggingHeight?: number,
): { bottom: number; top: number } {
  const sling = riggingHeight && riggingHeight > 0 ? riggingHeight : Math.max(1.2, Math.min(3.5, loadDiameter * 0.5));
  const maxBottom = sheaveY - g.sheave_diameter - g.hook_height;
  const bottom = Math.min(loadTopY + sling, maxBottom);
  return { bottom, top: bottom + g.hook_height };
}

/** Halat donanımı sayısı (kanca bloğundaki halat kolu) — çizim için sınırlandırılmış. */
export function drawnFalls(falls: number | undefined): number {
  if (!falls || !Number.isFinite(falls)) return 2;
  return Math.max(1, Math.min(8, Math.round(falls)));
}

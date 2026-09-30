import type { RiggingItem, RiggingKind } from "./state";

export interface RiggingTemplate {
  label: string;
  icon: string;
  desc: string;
  defaults: { weight_t: number; height_m: number; length_m: number };
}

/** Rigging Editor şablonları (Crane Planner 2.0'daki 6 şablona karşılık). */
export const RIGGING_TEMPLATES: Record<RiggingKind, RiggingTemplate> = {
  sling2: {
    label: "2 Kollu Sapan",
    icon: "⋀",
    desc: "İki ayaklı zincir/halat sapan. Uzunluk = ayak uçları arası açıklık.",
    defaults: { weight_t: 0.05, height_m: 3.0, length_m: 2.0 },
  },
  sling4: {
    label: "4 Kollu Sapan",
    icon: "✳",
    desc: "Dört ayaklı sapan. Uzunluk = köşegen ayak açıklığı.",
    defaults: { weight_t: 0.1, height_m: 3.0, length_m: 2.5 },
  },
  spreader: {
    label: "Traverse (Spreader)",
    icon: "⊤",
    desc: "Basma çubuklu traverse; yükseklik üst sapanları da içerir.",
    defaults: { weight_t: 1.2, height_m: 4.0, length_m: 6.0 },
  },
  beam: {
    label: "Askı Kirişi",
    icon: "▭",
    desc: "Eğilmeye çalışan kaldırma kirişi (lifting beam).",
    defaults: { weight_t: 1.5, height_m: 1.2, length_m: 6.0 },
  },
  shackle: {
    label: "Kilit / Mapa",
    icon: "⊂",
    desc: "Kilit (shackle) veya mapa bağlantı elemanı.",
    defaults: { weight_t: 0.02, height_m: 0.3, length_m: 0.2 },
  },
  custom: {
    label: "Özel Aparat",
    icon: "✎",
    desc: "Kullanıcı tanımlı aparat — ölçüleri elle girin.",
    defaults: { weight_t: 0.5, height_m: 1.0, length_m: 1.0 },
  },
};

/** Şablondan yeni aparat üret (benzersiz id). */
export function newRiggingItem(kind: RiggingKind): RiggingItem {
  const t = RIGGING_TEMPLATES[kind];
  return {
    id: `rig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label: t.label,
    weight_t: t.defaults.weight_t,
    height_m: t.defaults.height_m,
    length_m: t.defaults.length_m,
  };
}

/**
 * Sapan ayak açısı (düşeyden) ve ayak başına kuvvet.
 * açı = atan((açıklık/2) / yükseklik), kuvvet = yük / (n_eff · cos(açı)).
 * 4 kollu sapanlarda muhafazakâr olarak yalnızca 2 ayağın taşıdığı kabul edilir
 * (EN 13414 pratiği 3 ayak kabul eder; burada bilinçli olarak daha güvenli taraf: 2).
 * Sıfıra bölme korumalıdır: yükseklik ≤ 0 → açı 90°, kuvvet ∞.
 */
export function slingLegTension(
  totalLoad_t: number,
  legs: number,
  height_m: number,
  spread_m: number,
): { angle_deg: number; tension_t: number } {
  const load = Number.isFinite(totalLoad_t) ? Math.max(0, totalLoad_t) : 0;
  const nEff = Math.max(1, Math.min(Number.isFinite(legs) ? Math.floor(legs) : 1, 2));
  const halfSpread = Number.isFinite(spread_m) ? Math.max(0, spread_m) / 2 : 0;
  if (!Number.isFinite(height_m) || height_m <= 0) {
    return { angle_deg: 90, tension_t: load > 0 ? Infinity : 0 };
  }
  const angle = Math.atan(halfSpread / height_m);
  const cos = Math.cos(angle);
  const tension = cos > 1e-9 ? load / (nEff * cos) : Infinity;
  return { angle_deg: (angle * 180) / Math.PI, tension_t: tension };
}

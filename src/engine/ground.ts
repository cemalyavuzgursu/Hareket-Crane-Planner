// ZEMİN KONTROLLERİ — eğim, ayak altı plaka (mat) boyutlandırma, yer altı yapısı yakınlığı.
// Sonuçlar ön-kontrol niteliğindedir; zemin etüdü / geoteknik mühendis onayının yerini tutmaz.
import type { SceneObject } from "./types.js";

export type GroundLevel = "ok" | "warn" | "bad";

// ─── 1) Zemin eğimi ──────────────────────────────────────────────────────────

export interface SlopeCheck {
  slope_pct: number;
  /** Eğim açısı (°). */
  slope_deg: number;
  level: GroundLevel;
  message: string;
}

/**
 * Kurulum yeri eğimi. Yük tabloları vincin YATAY (terazide) kurulduğu varsayımıyla
 * geçerlidir (EN 13000 / Liebherr: ayaklarla tam terazileme). Ayaklar küçük eğimi
 * terazileyebilir, ancak zemin eğimi büyüdükçe ayak stroku, takoz kayması ve
 * dengesiz ayak yükü riski artar.
 *   ≤ 0,3 %  → uygun
 *   0,3–1 %  → dikkat: ayaklarla terazileme + takoz kayma önlemi
 *   > 1 %    → üretici onayı olmadan izin verilmez (zemin düzeltilmeli)
 */
export function slopeCheck(slope_pct: number): SlopeCheck {
  const s = Number.isFinite(slope_pct) ? Math.abs(slope_pct) : 0;
  const slope_deg = (Math.atan(s / 100) * 180) / Math.PI;
  if (s > 1) {
    return {
      slope_pct: s,
      slope_deg,
      level: "bad",
      message: `Zemin eğimi %${s.toFixed(2)} > %1 — üretici onayı olmadan kurulum yapılamaz (yük tabloları terazide kurulum varsayar). Zemini düzeltin/dolgu yapın.`,
    };
  }
  if (s > 0.3) {
    return {
      slope_pct: s,
      slope_deg,
      level: "warn",
      message: `Zemin eğimi %${s.toFixed(2)} — ayaklarla tam terazileme şart; takoz kaymasına karşı önlem alın.`,
    };
  }
  return { slope_pct: s, slope_deg, level: "ok", message: `Zemin eğimi %${s.toFixed(2)} — uygun (terazileme kontrol edilmeli).` };
}

// ─── 2) Ayak altı plaka (mat) boyutlandırma ─────────────────────────────────

export interface StandardMat {
  label: string;
  side_m: number;
  area_m2: number;
}

/** Standart ayak altı plaka ölçüleri (kare, m). */
export const STANDARD_MATS: StandardMat[] = [1.0, 1.2, 1.5, 2.0, 2.4].map((s) => ({
  label: `${s.toFixed(1).replace(".", ",")} × ${s.toFixed(1).replace(".", ",")} m`,
  side_m: s,
  area_m2: s * s,
}));

export interface MatSizing {
  max_corner_t: number;
  allowable_t_m2: number;
  pad_area_m2: number;
  /** Takozun doğrudan zemine bastığı durumdaki basınç (t/m²). */
  pad_pressure_t_m2: number;
  /** Gerekli taşıma alanı (m²) = köşe yükü / izin verilen basınç. */
  required_area_m2: number;
  /** Gerekli kare plaka kenarı (m). */
  required_side_m: number;
  /** Takoz tek başına yeterli mi. */
  pad_ok: boolean;
  /** Seçilen en küçük uygun standart plaka (yoksa null → özel/çok katmanlı plaka). */
  mat: StandardMat | null;
  /** Seçilen plaka altında (yayılma dahil) zemin basıncı (t/m²). */
  mat_pressure_t_m2: number | null;
  /** 45° yayılma kontrolü (plaka kalınlığı verilirse). */
  spread?: {
    thickness_m: number;
    /** Takozdan 45° yayılmayla plaka tabanında efektif kenar (m) — plaka kenarıyla sınırlı. */
    effective_side_m: number;
    /** Plaka yükü tüm alanına yayamayacak kadar ince mi. */
    too_thin: boolean;
  };
  level: GroundLevel;
  messages: string[];
}

/**
 * Ayak altı plaka boyutlandırma.
 * Gerekli alan = max_corner_t / allowable_t_m2. Plaka rijit kabul edilir ve yükü tüm
 * alanına yayar. mat_thickness_m verilirse 45° yayılma kontrolü yapılır: takoz kenarı b,
 * plaka kalınlığı t → tabanda efektif kenar = min(plaka, b + 2t). Bu kenar plakadan küçükse
 * plaka tam rijit davranmaz (ahşap/ince çelik) ve efektif alan kullanılır.
 * Not: çelik plaka yüksek eğilme rijitliğiyle daha iyi yayar; ahşap (kereste) plakalar
 * ~0,15–0,3 m kalınlıkta katmanlı kullanılır. Kesin boyut üretici/tedarikçi tablosuyla doğrulanmalı.
 */
export function matSizing(
  max_corner_t: number,
  allowable_t_m2: number,
  pad_area_m2: number,
  mat_thickness_m?: number,
): MatSizing {
  const F = Number.isFinite(max_corner_t) ? Math.max(0, max_corner_t) : 0;
  const q = Number.isFinite(allowable_t_m2) && allowable_t_m2 > 0 ? allowable_t_m2 : NaN;
  const Ap = Number.isFinite(pad_area_m2) && pad_area_m2 > 0 ? pad_area_m2 : NaN;
  const messages: string[] = [];
  const required_area_m2 = F / q;
  const required_side_m = Math.sqrt(required_area_m2);
  const pad_pressure_t_m2 = F / Ap;
  const pad_ok = pad_pressure_t_m2 <= q + 1e-9;

  const padSide = Math.sqrt(Ap);
  const t = mat_thickness_m != null && Number.isFinite(mat_thickness_m) && mat_thickness_m > 0 ? mat_thickness_m : undefined;
  const effArea = (m: StandardMat) => {
    const eff = t != null ? Math.min(m.side_m, padSide + 2 * t) : m.side_m;
    return eff * eff;
  };

  let mat: StandardMat | null = null;
  if (!pad_ok && Number.isFinite(required_area_m2)) {
    mat = STANDARD_MATS.find((m) => m.side_m >= padSide - 1e-9 && effArea(m) >= required_area_m2 - 1e-9) ?? null;
  }
  const mat_pressure_t_m2 = mat ? F / effArea(mat) : null;
  let spread: MatSizing["spread"];
  if (t != null && mat) {
    const eff = Math.min(mat.side_m, padSide + 2 * t);
    spread = { thickness_m: t, effective_side_m: eff, too_thin: eff < mat.side_m - 1e-9 };
  }

  let level: GroundLevel = "ok";
  if (!Number.isFinite(q) || !Number.isFinite(Ap)) {
    level = "warn";
    messages.push("İzin verilen zemin basıncı veya takoz alanı tanımlı değil.");
  } else if (pad_ok) {
    messages.push(`Takoz basıncı ${pad_pressure_t_m2.toFixed(1)} t/m² ≤ ${q} t/m² — ek plaka gerekmez.`);
  } else if (mat) {
    level = "warn";
    messages.push(
      `Takoz basıncı ${pad_pressure_t_m2.toFixed(1)} t/m² > ${q} t/m². Gerekli alan ${required_area_m2.toFixed(2)} m² → en az ${mat.label} plaka (${mat_pressure_t_m2!.toFixed(1)} t/m²).`,
    );
    if (spread?.too_thin) {
      messages.push(
        `Plaka kalınlığı ${t!.toFixed(2)} m ile 45° yayılma yalnız ${spread.effective_side_m.toFixed(2)} m kenara ulaşıyor — daha kalın/çelik plaka kullanın.`,
      );
    }
  } else {
    level = "bad";
    messages.push(
      `Gerekli alan ${required_area_m2.toFixed(2)} m² (kenar ≈ ${required_side_m.toFixed(2)} m) standart plakaları aşıyor — özel plaka/çok katmanlı altlık veya zemin iyileştirme gerekli.`,
    );
  }
  messages.push("Çelik plaka daha iyi yük yayar; ahşap plakada kalınlık ve lif yönü kontrol edilmeli.");

  return {
    max_corner_t: F,
    allowable_t_m2: q,
    pad_area_m2: Ap,
    pad_pressure_t_m2,
    required_area_m2,
    required_side_m,
    pad_ok,
    mat,
    mat_pressure_t_m2,
    spread,
    level,
    messages,
  };
}

// ─── 3) Yer altı yapısı yakınlığı ───────────────────────────────────────────

export type UndergroundLevel = "ok" | "warn" | "collision";

export interface UndergroundHit {
  object_id: string;
  object_label: string;
  pad_index: number;
  /** Yapının üst yüzü derinliği (m, ≥ 0). */
  top_depth_m: number;
  /** Takoz kenarından yapı tabanına (plan) yatay mesafe (m); 0 = üstünde. */
  horizontal_m: number;
  level: UndergroundLevel;
  message: string;
}

/** Yer altı güvenlik payı (m) — basınç soğanı sınırına ek. */
export const UNDERGROUND_SAFETY_M = 1.0;

/**
 * Yer altı yapısının kotu: nesne y∈[y, y+height] aralığını kaplar, y+height ≤ 0.
 * y verilmemişse üst yüzü zeminde (y = −height) kabul edilir.
 * Üst yüzü derinliği d = −(y + height), en az 0.
 */
export function undergroundTopDepth(o: SceneObject): number {
  const y = o.y ?? -o.height;
  return Math.max(0, -(y + o.height));
}

/** Plan noktasının döndürülmüş dikdörtgene (nesne tabanı) yatay mesafesi (içindeyse 0). */
function distToFootprint(p: { x: number; z: number }, o: SceneObject): number {
  // collision.ts toObjectLocal ile aynı dönüşüm.
  const rot = ((o.rotationY ?? 0) * Math.PI) / 180;
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - o.width / 2);
  const ez = Math.max(0, Math.abs(lz) - o.depth / 2);
  return Math.hypot(ex, ez);
}

/**
 * Ayak takozu ↔ yer altı yapısı. Takoz basıncı zeminde ~1:1 (45°) yayılır: d
 * derinliğe yatayda d mesafede ulaşır. Takoz, merkezi etrafında padSize kenarlı
 * alan olarak (plan mesafesi için yarıçap padSize/2) modellenir.
 *   takoz yapının üstünde (mesafe 0)      → "collision"
 *   mesafe < üst derinlik + 1 m güvenlik  → "warn" (basınç soğanı yapıya ulaşır)
 * pads ve objects aynı (saha) çerçevede olmalı.
 */
export function undergroundProximity(
  pads: Array<{ x: number; z: number }>,
  objects: SceneObject[],
  padSize: number,
): UndergroundHit[] {
  const half = Number.isFinite(padSize) && padSize > 0 ? padSize / 2 : 0;
  const hits: UndergroundHit[] = [];
  for (const o of objects) {
    if (o.kind !== "underground") continue;
    const d = undergroundTopDepth(o);
    pads.forEach((p, i) => {
      const horiz = Math.max(0, distToFootprint(p, o) - half);
      let level: UndergroundLevel = "ok";
      let message: string;
      if (horiz <= 1e-9) {
        level = "collision";
        message = `Ayak ${i + 1} "${o.label}" yapısının üzerinde (üst yüz ${d.toFixed(1)} m derinde) — takozu taşıyın veya yapının taşıma kapasitesini doğrulatın.`;
      } else if (horiz < d + UNDERGROUND_SAFETY_M) {
        level = "warn";
        message = `Ayak ${i + 1} "${o.label}" yapısına ${horiz.toFixed(1)} m — 45° basınç soğanı ${d.toFixed(1)} m derinliğe ulaşır (gerekli ≥ ${(d + UNDERGROUND_SAFETY_M).toFixed(1)} m).`;
      } else {
        message = `Ayak ${i + 1} "${o.label}" yapısından ${horiz.toFixed(1)} m uzakta — uygun.`;
      }
      hits.push({ object_id: o.id, object_label: o.label, pad_index: i, top_depth_m: d, horizontal_m: horiz, level, message });
    });
  }
  return hits;
}

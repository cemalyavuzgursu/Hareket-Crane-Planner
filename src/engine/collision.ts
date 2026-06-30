// (D) ÇARPIŞMA ALGILAMA — YENİ. Crane Planner 2.0 "collision detection".
//
// İki katman:
//   1) Bom ↔ ana engel / yük: mevcut klerens sonuçlarından (clearance.ts) türetilir.
//   2) Bom / yük / kanca ↔ çevre nesneleri (nesne kütüphanesi): 3D segment–kutu
//      (AABB) en yakın mesafe testi.
//
// Çıktı saf bir uyarı listesidir; UI renklendirme ve raporlama için kullanır.
// Hiçbir şey atmaz: geçersiz girdi "ok" gibi ele alınır (planlama güvenliği için
// kritik uyarılar klerens katmanından zaten gelir).

import type { GeometryConstants, SceneObject } from "./types.js";
import type { ClearanceResult } from "./clearance.js";

/** Negatif = çarpışma; bu eşiğin altındaki pozitif klerens = uyarı (m). */
export const SAFETY_MARGIN_M = 0.5;

export type CollisionSeverity = "ok" | "warning" | "collision";

export interface CollisionItem {
  id: string;
  /** Hangi vinç parçası: bom / yük / kanca. */
  source: "boom" | "load" | "hook";
  /** Neyle: ana engel, zemin, ya da çevre nesnesi etiketi. */
  target: string;
  severity: CollisionSeverity;
  /** Boşluk (m); negatifse çakışma derinliği. */
  clearance_m: number;
  message: string;
}

export interface CollisionReport {
  worst: CollisionSeverity;
  items: CollisionItem[];
  /** Yalnızca çakışma/uyarı içerenler (UI rozet sayısı için). */
  active: CollisionItem[];
}

export interface CollisionInputs {
  g: GeometryConstants;
  boom_length: number;
  radius: number;
  gama: number; // bom yükselme açısı (rad) — clearance.gama
  slew_angle: number; // derece, 0 = +X
  load_height: number;
  load_diameter: number;
  hook_height: number; // kanca bloğu yüksekliği (klerens.max_hook_height yakını)
  objects: SceneObject[];
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** (x,z) düzlemini slew açısı kadar Y ekseni etrafında döndürür. */
function rotY(x: number, z: number, rad: number): { x: number; z: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** Slew-yerel (x,y,z) noktayı dünya çerçevesine çevirir (Y yukarı, sabit). */
function toWorld(lx: number, ly: number, lz: number, slewRad: number): Vec3 {
  const r = rotY(lx, lz, slewRad);
  return { x: r.x, y: ly, z: r.z };
}

/**
 * Vinç geometrisinin dünya-çerçevesi anahtar noktaları (Crane3D ile aynı kabul):
 * bom dibi (-boom_offset, machine+crib), bom ucu, yük merkezi.
 */
export function craneWorldGeometry(inp: CollisionInputs): {
  boomFoot: Vec3;
  boomTip: Vec3;
  loadCenter: Vec3;
  hookCenter: Vec3;
} {
  const { g, boom_length, radius, gama, slew_angle, load_height } = inp;
  const slewRad = slew_angle * DEG;
  const footY = g.machine_ground_height + g.cribbing_height;
  const footX = -g.boom_offset;
  const tipXLocal = footX + boom_length * Math.cos(gama);
  const tipYLocal = footY + boom_length * Math.sin(gama);

  return {
    boomFoot: toWorld(footX, footY, 0, slewRad),
    boomTip: toWorld(tipXLocal, tipYLocal, 0, slewRad),
    loadCenter: toWorld(radius, Math.max(load_height, 0.1) / 2, 0, slewRad),
    hookCenter: toWorld(radius, load_height + inp.hook_height, 0, slewRad),
  };
}

/** Bir noktanın eksen hizalı kutuya (merkez + yarı-ölçüler) en kısa mesafesi. */
function pointToBoxDistance(p: Vec3, center: Vec3, half: Vec3): number {
  const dx = Math.max(Math.abs(p.x - center.x) - half.x, 0);
  const dy = Math.max(Math.abs(p.y - center.y) - half.y, 0);
  const dz = Math.max(Math.abs(p.z - center.z) - half.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Bir doğru parçası (a→b) örneklenerek kutuya en kısa mesafe bulunur. */
function segmentToBoxDistance(a: Vec3, b: Vec3, center: Vec3, half: Vec3, samples = 28): number {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p: Vec3 = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const d = pointToBoxDistance(p, center, half);
    if (d < min) min = d;
  }
  return min;
}

function severityFor(clearance: number): CollisionSeverity {
  if (clearance < 0) return "collision";
  if (clearance < SAFETY_MARGIN_M) return "warning";
  return "ok";
}

function worstOf(a: CollisionSeverity, b: CollisionSeverity): CollisionSeverity {
  const rank = { ok: 0, warning: 1, collision: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Tam çarpışma raporu. Ana engel/yük klerensini (clearance.ts'ten) ve çevre
 * nesnelerini (3D) birleştirir.
 */
export function computeCollisions(
  inp: CollisionInputs,
  clearance: ClearanceResult,
): CollisionReport {
  const items: CollisionItem[] = [];

  // ── 1) Bom ↔ ana engel ─────────────────────────────────────────────────────
  items.push({
    id: "boom-main-obstacle",
    source: "boom",
    target: "Ana engel",
    severity: severityFor(clearance.clearance_to_obstacle),
    clearance_m: clearance.clearance_to_obstacle,
    message:
      clearance.clearance_to_obstacle < 0
        ? "Bom ana engele çarpıyor"
        : "Bom ↔ ana engel klerensi",
  });

  // ── 2) Bom ↔ yük ───────────────────────────────────────────────────────────
  items.push({
    id: "boom-main-load",
    source: "boom",
    target: "Yük",
    severity: severityFor(clearance.clearance_to_load),
    clearance_m: clearance.clearance_to_load,
    message:
      clearance.clearance_to_load < 0
        ? "Bom yüke çarpıyor"
        : "Bom ↔ yük klerensi",
  });

  // ── 3) Kaldırma yüksekliği (yük engeli geçebiliyor mu) ──────────────────────
  // max_sling_spread < 0 → yük + sapan, makara altına sığmıyor.
  items.push({
    id: "lift-height",
    source: "load",
    target: "Kaldırma yüksekliği",
    severity: severityFor(clearance.max_sling_spread),
    clearance_m: clearance.max_sling_spread,
    message:
      clearance.max_sling_spread < 0
        ? "Yük + sapan kaldırma yüksekliğine sığmıyor"
        : "Sapan/kaldırma yüksekliği payı",
  });

  // ── 4) Çevre nesneleri ↔ bom / yük / kanca ─────────────────────────────────
  const geo = craneWorldGeometry(inp);
  const boomHalfThick = inp.g.boom_thickness / 2;
  const loadRadius = Math.max(inp.load_diameter, 0.3) / 2;

  for (const o of inp.objects) {
    const center: Vec3 = { x: o.x, y: o.height / 2, z: o.z };
    const half: Vec3 = { x: o.width / 2, y: o.height / 2, z: o.depth / 2 };

    // Bom (kalınlık payı düşülür)
    const dBoom = segmentToBoxDistance(geo.boomFoot, geo.boomTip, center, half) - boomHalfThick;
    items.push({
      id: `obj-${o.id}-boom`,
      source: "boom",
      target: o.label,
      severity: severityFor(dBoom),
      clearance_m: dBoom,
      message: dBoom < 0 ? `Bom "${o.label}" ile çakışıyor` : `Bom ↔ ${o.label}`,
    });

    // Yük (yarıçap payı düşülür)
    const dLoad = pointToBoxDistance(geo.loadCenter, center, half) - loadRadius;
    items.push({
      id: `obj-${o.id}-load`,
      source: "load",
      target: o.label,
      severity: severityFor(dLoad),
      clearance_m: dLoad,
      message: dLoad < 0 ? `Yük "${o.label}" ile çakışıyor` : `Yük ↔ ${o.label}`,
    });
  }

  const worst = items.reduce<CollisionSeverity>((w, it) => worstOf(w, it.severity), "ok");
  const active = items.filter((it) => it.severity !== "ok");
  return { worst, items, active };
}

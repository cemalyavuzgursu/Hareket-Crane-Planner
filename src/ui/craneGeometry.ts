// Yandan görünüş geometrisi — 2B/3B çizimin klerens/çarpışma SONUCUYLA birebir
// tutarlı olması için. clearance.ts ile aynı kritik noktaları üretir:
//   - efektif klerens doğrusu (bom mafsalından açı = alfa + gama)
//   - bomun yük tarafındaki kenarı (boom_thickness kadar ötelenmiş)
//   - yük ve engelin kritik köşe noktaları
//   - bu köşelerden bom kenarına dik mesafe (= raporlanan klerens)
// Böylece "çarpışma var" derken çizimde de görünür.

import type { GeometryConstants } from "../engine/types";
import type { ClearanceResult } from "../engine/clearance";

export interface Pt {
  x: number;
  y: number;
}

export interface SideGeometry {
  foot: Pt; // bom mafsalı
  tip: Pt; // bom ucu (gama açısıyla)
  gama: number; // bom yükselme açısı (rad)
  /** Efektif klerens doğrusunun açısı (alfa+gama) ve yön/normal birim vektörleri. */
  effAngle: number;
  ux: number; // klerens doğrusu yön (cos)
  uy: number;
  nx: number; // klerens doğrusu normali (yük tarafına +)
  ny: number;
  loadCorner: Pt; // yükün kritik üst-iç köşesi
  obstacleCorner: Pt | null; // engelin kritik üst köşesi
  /** Kritik köşeden bom kenarına dik ayak noktası (çizim için). */
  loadFoot: Pt;
  obstacleFoot: Pt | null;
}

/**
 * clearance.ts formülleriyle aynı kritik geometriyi üretir.
 * base = cribbing + machine_ground (bom mafsalı yüksekliği).
 */
export function sideGeometry(
  g: GeometryConstants,
  c: ClearanceResult,
  boom_length: number,
  load_height: number,
  obstacle_height: number,
): SideGeometry {
  const base = g.cribbing_height + g.machine_ground_height;
  const foot: Pt = { x: -g.boom_offset, y: base };
  const tip: Pt = {
    x: foot.x + boom_length * Math.cos(c.gama),
    y: foot.y + boom_length * Math.sin(c.gama),
  };

  // Klerens doğrusu: mafsaldan (alfa+gama) açısıyla. Normal, yük/engel tarafına (+).
  const effAngle = c.alfa + c.gama;
  const ux = Math.cos(effAngle);
  const uy = Math.sin(effAngle);
  const nx = Math.sin(effAngle); // sağ-alt tarafa normal (yük tarafı)
  const ny = -Math.cos(effAngle);

  // Kritik köşeler (mutlak dünya koordinatı) — clearance.ts ile aynı:
  const loadCorner: Pt = {
    x: c.load_corner_x, // modele göre: centered → radius − çap/2
    y: load_height + obstacle_height,
  };
  const obstacleCorner: Pt | null =
    obstacle_height > 0
      ? { x: c.obstacle_corner_x, y: obstacle_height }
      : null;

  // Bir noktadan klerens doğrusuna dik ayak (izdüşüm) — çizimde dik çizgi için.
  const projFoot = (p: Pt): Pt => {
    const dx = p.x - foot.x;
    const dy = p.y - foot.y;
    const t = dx * ux + dy * uy; // doğru boyunca izdüşüm uzunluğu
    return { x: foot.x + t * ux, y: foot.y + t * uy };
  };

  return {
    foot,
    tip,
    gama: c.gama,
    effAngle,
    ux,
    uy,
    nx,
    ny,
    loadCorner,
    obstacleCorner,
    loadFoot: projFoot(loadCorner),
    obstacleFoot: obstacleCorner ? projFoot(obstacleCorner) : null,
  };
}

// Jib geometrisi motora taşındı (çarpışma/klerens de kullanıyor) — geriye uyum için yeniden dışa aktarılır.
export { jibGeometry, type JibGeometry } from "../engine/jib";

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
  radius: number,
  load_height: number,
  load_diameter: number,
  obstacle_height: number,
  obstacle_distance: number,
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
    x: radius - load_diameter,
    y: load_height + obstacle_height,
  };
  const obstacleCorner: Pt | null =
    obstacle_height > 0
      ? { x: radius - obstacle_distance, y: obstacle_height }
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

export interface JibGeometry {
  foot: Pt;
  boomTip: Pt;
  jibTip: Pt;
  boomAngle: number; // rad
  jibAngle: number; // rad (yataya göre)
  ok: boolean; // çözüm bulundu mu (radius erişilebilir mi)
}

/**
 * Jib modu geometrisi: bom açısı θ'yı, jib ucu yatayda `radius`'a düşecek şekilde
 * çözer. Jib, bom ekseninden `offset`° aşağıda uzanır.
 *   x_tip = -boom_offset + B·cosθ + J·cos(θ − offset)
 * θ ∈ [10°, 85°] aralığında ikili arama (dik boma yakın kök tercih edilir).
 */
export function jibGeometry(
  boom_offset: number,
  base_height: number,
  boom_length: number,
  jib_length: number,
  jib_offset_deg: number,
  radius: number,
): JibGeometry {
  const phi = (jib_offset_deg * Math.PI) / 180;
  const foot: Pt = { x: -boom_offset, y: base_height };
  const reach = (theta: number) =>
    -boom_offset + boom_length * Math.cos(theta) + jib_length * Math.cos(theta - phi);

  // reach(θ) θ arttıkça azalır (daha dik → daha az yatay erişim). Bisection.
  let lo = (10 * Math.PI) / 180;
  let hi = (86 * Math.PI) / 180;
  let ok = true;
  if (radius > reach(lo)) {
    // Çok uzak — erişilemez; en yatık açıyı kullan.
    ok = false;
  } else if (radius < reach(hi)) {
    ok = false;
  }
  let theta = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    theta = (lo + hi) / 2;
    if (reach(theta) > radius) lo = theta;
    else hi = theta;
  }
  const boomTip: Pt = {
    x: foot.x + boom_length * Math.cos(theta),
    y: foot.y + boom_length * Math.sin(theta),
  };
  const jibAngle = theta - phi;
  const jibTip: Pt = {
    x: boomTip.x + jib_length * Math.cos(jibAngle),
    y: boomTip.y + jib_length * Math.sin(jibAngle),
  };
  return { foot, boomTip, jibTip, boomAngle: theta, jibAngle, ok };
}

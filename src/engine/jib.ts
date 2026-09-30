// Jib (bom + jib) geometrisi ve jib modu klerensi.
// Broşürlerde jib mafsal geometrisi yok: jib, bom ekseni ucundan ofset açısıyla
// uzanan düz bir çubuk kabul edilir → sonuçlar YAKLAŞIKTIR (UI'da belirtilir).

import type { GeometryConstants } from "./types.js";

export interface Pt {
  x: number;
  y: number;
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


/** Jib modu klerens sonucu (YAKLAŞIK — jib mafsal geometrisi tahmini). */
export interface JibClearance {
  estimated: true;
  geometry: JibGeometry;
  /** Yük kritik köşesinden bom/jib gövdesine en kısa mesafe (m); negatif = çakışma. */
  clearance_to_load: number;
  /** Engel kritik köşesinden bom/jib gövdesine en kısa mesafe (m). Engel yoksa null. */
  clearance_to_obstacle: number | null;
  /** Jib ucu makarası altında kanca için maks. yükseklik (m). */
  max_hook_height: number;
  /** Kanca altında sapan/aparat için kalan yükseklik (m) — ana bom formülünün jib karşılığı. */
  max_sling_spread: number;
  load_center_x: number;
  load_corner_x: number;
  obstacle_corner_x: number;
  load_bottom_height: number;
}

const JIB_HALF_THICK = 0.45; // kafes jib yarı kesiti (m) — tahmini

/**
 * Noktanın bir gövde parçasına (a→b, kalınlık t) işaretli mesafesi: parçanın
 * ALT/yük tarafındaysa pozitif boşluk, gövde içinde/üstündeyse negatif.
 */
function signedClearance(p: Pt, a: Pt, b: Pt, t: number): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / L, uy = dy / L;
  const s = (p.x - a.x) * ux + (p.y - a.y) * uy;
  if (s < 0 || s > L) {
    const q = s < 0 ? a : b;
    return Math.hypot(p.x - q.x, p.y - q.y) - t;
  }
  // Alt normal (yük tarafı): (uy, −ux)
  const n = (p.x - a.x) * uy - (p.y - a.y) * ux;
  return n - t;
}

export function computeJibClearance(
  g: GeometryConstants,
  inp: {
    boom_length: number;
    jib_length: number;
    jib_offset: number;
    radius: number;
    load_height: number;
    load_diameter: number;
    obstacle_height: number;
    obstacle_distance: number;
    obstacle_width?: number;
    load_bottom_height?: number;
  },
): JibClearance {
  const base = g.cribbing_height + g.machine_ground_height;
  const geo = jibGeometry(g.boom_offset, base, inp.boom_length, inp.jib_length, inp.jib_offset, inp.radius);
  const load_center_x = inp.radius;
  const load_corner_x = inp.radius - inp.load_diameter / 2;
  const obstacle_corner_x = inp.radius - inp.obstacle_distance - (inp.obstacle_width ?? 0) / 2;
  const load_bottom_height = Math.max(0, inp.load_bottom_height ?? inp.obstacle_height);
  const loadCorner = { x: load_corner_x, y: load_bottom_height + inp.load_height };
  const obsCorner = { x: obstacle_corner_x, y: inp.obstacle_height };
  const c = (p: Pt) =>
    Math.min(
      signedClearance(p, geo.foot, geo.boomTip, g.boom_thickness),
      signedClearance(p, geo.boomTip, geo.jibTip, JIB_HALF_THICK),
    );
  const clearance_to_obstacle = inp.obstacle_height > 0 ? c(obsCorner) : Infinity;
  // Yük yüksekliği 0 ise (Excel kuralı) yük klerensi = engel klerensi; engel de yoksa yük köşesi kullanılır.
  const clearance_to_load =
    inp.load_height > 0 || !Number.isFinite(clearance_to_obstacle) ? c(loadCorner) : clearance_to_obstacle;
  const max_hook_height = geo.jibTip.y - g.sheave_diameter - g.hook_height;
  const max_sling_spread = max_hook_height - inp.load_height - load_bottom_height;
  return {
    estimated: true,
    geometry: geo,
    clearance_to_load,
    clearance_to_obstacle: Number.isFinite(clearance_to_obstacle) ? clearance_to_obstacle : null,
    max_hook_height,
    max_sling_spread,
    load_center_x,
    load_corner_x,
    obstacle_corner_x,
    load_bottom_height,
  };
}

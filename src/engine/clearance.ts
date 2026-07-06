// (B) KLERENS / GEOMETRİ — 2D yandan görünüş, trigonometri.
// PROJE.md §2(B). Açılar radyan. Excel ("LT 1250") formülleriyle birebir.

import type { GeometryConstants } from "./types.js";

export interface ClearanceInputs {
  boom_length: number;
  radius: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
}

export interface ClearanceResult {
  alfa: number; // makara ofset açısı (rad)
  z: number; // efektif bom mesafesi (m)
  gama: number; // bom yükselme açısı (rad)
  beta: number; // engel açısı (rad)
  L: number; // engele mesafe (m)
  teta: number; // yük açısı (rad)
  k: number; // yüke mesafe (m)
  max_hook_height: number; // maksimum koça yüksekliği (m)
  max_sling_spread: number; // maksimum sapan aralığı (m)
  clearance_to_obstacle: number; // boma engel klerensi (m)
  clearance_to_load: number; // boma yük klerensi (m) — load_height=0 ise engel klerensi
}

export function computeClearance(
  g: GeometryConstants,
  inp: ClearanceInputs,
): ClearanceResult {
  const {
    boom_length,
    radius,
    load_height,
    load_diameter,
    obstacle_height,
    obstacle_distance,
  } = inp;

  const alfa = Math.atan(g.sheave_offset / boom_length);
  const z = boom_length / Math.cos(alfa);
  // acos alan kontrolü: radius geometrik erişimi aşarsa NaN yayılmasın, açık hata ver.
  const cosGama = (radius + g.boom_offset) / z;
  if (cosGama > 1 + 1e-9) {
    throw new Error(
      `Radius ${radius}m bu bom uzunluğuyla (${boom_length}m) geometrik olarak erişilemez ` +
        `(maks ≈ ${(z - g.boom_offset).toFixed(1)}m).`,
    );
  }
  const gama = Math.acos(Math.min(cosGama, 1)); // bom yükselme açısı

  const max_hook_height =
    z * Math.sin(gama) +
    g.cribbing_height +
    g.machine_ground_height -
    g.sheave_diameter -
    g.hook_height;

  const max_sling_spread =
    z * Math.sin(gama) -
    g.sheave_diameter -
    g.hook_height -
    load_height -
    obstacle_height +
    g.machine_ground_height +
    g.cribbing_height;

  // Boma ENGEL klerensi
  // Alan koruması: payda ≤ 0 ise engel, bom açıklığının (boom_offset+radius)
  // ötesinde demektir — L ve beta formülleri bu bölgede tanımsız/ters işaret
  // üretir. Not: payın işareti (engel makine yüksekliğinin altındaysa negatif
  // çıkar) GEÇERLİ ve mevcut davranıştır, ona dokunulmaz.
  const betaDenom = g.boom_offset + radius - obstacle_distance;
  if (betaDenom <= 0) {
    throw new Error(
      `Engel mesafesi (${obstacle_distance}m) bom açıklığının (boom_offset+radius ≈ ` +
        `${(g.boom_offset + radius).toFixed(2)}m) ötesinde; boma engel klerens formülü ` +
        `bu bölgede geçerli değil.`,
    );
  }
  const beta = Math.atan(
    (obstacle_height - g.machine_ground_height - g.cribbing_height) / betaDenom,
  );
  const L = (radius + g.boom_offset - obstacle_distance) / Math.cos(beta);
  const clearance_to_obstacle =
    L * Math.sin(alfa + gama - beta) - g.boom_thickness;

  // Boma YÜK klerensi
  // Alan koruması: payda ≤ 0 ise yük çapı + bom ofseti radius'u aşıyor demektir
  // (yük merkezi bom ekseninin gerisine geçer) — teta/k formülleri bu bölgede
  // tanımsız/ters işaret üretir. load_height===0 ise bu değerler zaten
  // kullanılmadan clearance_to_obstacle'a düşülür (aşağıda), o yüzden yalnızca
  // gerçekten tüketildiği durumda hata fırlatılır.
  const tetaDenom = radius - load_diameter + g.boom_offset;
  if (tetaDenom <= 0 && load_height !== 0) {
    throw new Error(
      `Yük çapı (${load_diameter}m), radius (${radius}m) + boom_offset'e göre çok büyük; ` +
        `boma yük klerens formülü bu bölgede geçerli değil (radius − load_diameter + ` +
        `boom_offset ≤ 0).`,
    );
  }
  const teta =
    tetaDenom > 0
      ? Math.atan(
          (load_height + obstacle_height - g.cribbing_height - g.machine_ground_height) /
            tetaDenom,
        )
      : NaN;
  const k =
    (load_height + obstacle_height - g.machine_ground_height - g.cribbing_height) /
    Math.sin(teta);
  const clearance_to_load_raw =
    k * Math.sin(alfa + gama - teta) - g.boom_thickness;

  // Excel kuralı: load_height 0 ise yük klerensi = engel klerensi
  const clearance_to_load =
    load_height === 0 ? clearance_to_obstacle : clearance_to_load_raw;

  return {
    alfa,
    z,
    gama,
    beta,
    L,
    teta,
    k,
    max_hook_height,
    max_sling_spread,
    clearance_to_obstacle,
    clearance_to_load,
  };
}

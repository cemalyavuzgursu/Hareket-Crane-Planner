// (B) KLERENS / GEOMETRİ — 2D yandan görünüş, trigonometri.
// PROJE.md §2(B). Açılar radyan. Excel ("LT 1250") formülleriyle birebir.

import type { GeometryConstants } from "./types.js";

/**
 * Klerens geometri modeli:
 *  - "centered" (varsayılan, gerçek geometri): kanca yükün ağırlık merkezinin
 *    üstünde (x = radius); yükün boma yakın kritik köşesi radius − çap/2.
 *    obstacle_distance = kanca → engel MERKEZİ; engelin kritik (boma yakın)
 *    üst köşesi radius − obstacle_distance − obstacle_width/2.
 *  - "excel": Autocrane.xls ile birebir (golden testler). Kanca yükün uzak
 *    kenarında, kritik köşe radius − çap (yarım çap daha muhafazakâr);
 *    engel noktası radius − obstacle_distance (genişlik yok sayılır).
 */
export type ClearanceModel = "centered" | "excel";

export interface ClearanceInputs {
  boom_length: number;
  radius: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
  /** Engel genişliği (m) — yalnız "centered" modelde kritik köşeye girer. Varsayılan 0. */
  obstacle_width?: number;
  /** Varsayılan "centered". */
  model?: ClearanceModel;
  /** Yükün alt yüzünün zeminden yüksekliği (m) — kaldırma (hoist) durumu.
   * Verilmezse obstacle_height (yük engelin üstünden geçirilmiş). "excel"
   * modelinde yok sayılır. */
  load_bottom_height?: number;
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
  /** Kullanılan geometri modeli. */
  model: ClearanceModel;
  /** Yük merkezinin yatay konumu (slew merkezinden, m). */
  load_center_x: number;
  /** Yükün boma yakın kritik üst köşesi x (m). */
  load_corner_x: number;
  /** Engelin boma yakın kritik üst köşesi x (m). */
  obstacle_corner_x: number;
  /** Hesapta kullanılan yük alt yüzü yüksekliği (m). */
  load_bottom_height: number;
  /** Yalnız esnek hesapta: istenen radius geometrik erişimin ötesindeydi; geometri
   * bu radius'a kırpılarak hesaplandı (çizim için). */
  radius_clamped_to?: number;
  /** Yalnız esnek hesapta: klerens formülünün geçersiz olduğu bölge uyarısı. */
  warning?: string;
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
  const model: ClearanceModel = inp.model ?? "centered";
  // Kritik köşelerin slew merkezine göre yatay konumu (modele göre).
  const load_corner_x = model === "excel" ? radius - load_diameter : radius - load_diameter / 2;
  const load_center_x = model === "excel" ? radius - load_diameter / 2 : radius;
  const obstacle_corner_x =
    model === "excel" ? radius - obstacle_distance : radius - obstacle_distance - (inp.obstacle_width ?? 0) / 2;
  // Formüllerdeki "kancadan geri mesafe" terimleri (Excel formül yapısı korunur).
  const loadBack = radius - load_corner_x; // excel: D, centered: D/2
  // Yük alt yüzü: excel'de engel yüksekliği (yük engel üstünden), gerçek modelde
  // kaldırma yüksekliği girdisi (yoksa yine engel yüksekliği).
  const load_bottom_height =
    model === "excel" ? obstacle_height : Math.max(0, inp.load_bottom_height ?? obstacle_height);
  const obsBack = radius - obstacle_corner_x; // excel: od, centered: od + w/2

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
    (model === "excel" ? obstacle_height : load_bottom_height) +
    g.machine_ground_height +
    g.cribbing_height;

  // Boma ENGEL klerensi
  // Alan koruması: payda ≤ 0 ise engel, bom açıklığının (boom_offset+radius)
  // ötesinde demektir — L ve beta formülleri bu bölgede tanımsız/ters işaret
  // üretir. Not: payın işareti (engel makine yüksekliğinin altındaysa negatif
  // çıkar) GEÇERLİ ve mevcut davranıştır, ona dokunulmaz.
  const betaDenom = g.boom_offset + radius - obsBack;
  if (betaDenom <= 0) {
    throw new Error(
      `Engel mesafesi (${obsBack.toFixed(2)}m, kritik köşeye) bom açıklığının (boom_offset+radius ≈ ` +
        `${(g.boom_offset + radius).toFixed(2)}m) ötesinde; boma engel klerens formülü ` +
        `bu bölgede geçerli değil.`,
    );
  }
  const beta = Math.atan(
    (obstacle_height - g.machine_ground_height - g.cribbing_height) / betaDenom,
  );
  const L = (radius + g.boom_offset - obsBack) / Math.cos(beta);
  const clearance_to_obstacle =
    L * Math.sin(alfa + gama - beta) - g.boom_thickness;

  // Boma YÜK klerensi
  // Alan koruması: payda ≤ 0 ise yük çapı + bom ofseti radius'u aşıyor demektir
  // (yük merkezi bom ekseninin gerisine geçer) — teta/k formülleri bu bölgede
  // tanımsız/ters işaret üretir. load_height===0 ise bu değerler zaten
  // kullanılmadan clearance_to_obstacle'a düşülür (aşağıda), o yüzden yalnızca
  // gerçekten tüketildiği durumda hata fırlatılır.
  const tetaDenom = radius - loadBack + g.boom_offset;
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
          (load_height + load_bottom_height - g.cribbing_height - g.machine_ground_height) /
            tetaDenom,
        )
      : NaN;
  const k =
    (load_height + load_bottom_height - g.machine_ground_height - g.cribbing_height) /
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
    model,
    load_center_x,
    load_corner_x,
    obstacle_corner_x,
    load_bottom_height,
  };
}

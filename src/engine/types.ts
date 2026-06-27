// Ortak tipler — hesap çekirdeği (UI'dan bağımsız).

/** Vinçe özgü geometri sabitleri (datasheet'ten gelir). */
export interface GeometryConstants {
  cribbing_height: number; // takoz yüksekliği (m)
  machine_ground_height: number; // makinenin yerden yüksekliği (m)
  boom_offset: number; // bomun yatay ofseti (slew merkezi → bom dibi) (m)
  sheave_diameter: number; // makara çapı (m)
  hook_height: number; // koça yüksekliği (m)
  sheave_offset: number; // makara ofseti (m)
  boom_thickness: number; // bom kalınlığı, klerens payı (m)
}

/** [radius (m), capacity (t)] noktası. */
export type ChartPoint = [number, number];

/**
 * load_chart[counterweight][capacity_pct][boom_length] = [[radius, capacity], ...]
 * Anahtarlar string'tir (JSON), değerler artan radius'a göre sıralı noktalardır.
 */
export type LoadChart = Record<
  string,
  Record<string, Record<string, ChartPoint[]>>
>;

/** Bir vinç modelinin tam veri tanımı (JSON şeması). */
export interface CraneModel {
  model: string;
  source?: string;
  geometry_constants: GeometryConstants;
  self_weight: number | null;
  counterweight_options: number[];
  boom_lengths: number[];
  outrigger_configs: string[];
  notes?: string;
  /** Eksik değerlerin alındığı ikame datasheet bilgisi (ör. Sany SAC2500E). */
  datasheet_substitute?: {
    source: string;
    gross_weight_t?: number;
    outrigger_span_LxT_m?: number[];
    tail_slewing_radius_m?: number;
    counterweight_options_t?: number[];
  };
  load_chart: LoadChart;
}

/** Hesap girdileri (PROJE.md §Girdiler). */
export interface LiftInputs {
  load_weight: number; // yük ağırlığı (t)
  hook_weight: number; // koça/hook block (t)
  rigging_weight: number; // kaldırma ekipmanı (t)
  load_height: number; // yükün yüksekliği (m)
  load_diameter: number; // yükün çapı (m)
  obstacle_height: number; // engel yüksekliği (m)
  obstacle_distance: number; // engel üzerindeki yatay uzaklık (m)
  boom_length: number; // bom uzunluğu (m)
  radius: number; // radius (m)
  counterweight: number; // denge ağırlığı (t)
  capacity_pct: number; // kapasite oranı (%) — 75 veya 85
}

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

/** Jib kaldırma konfigürasyonu türü. "T" = jibsiz (yalnız ana bom). */
export type LiftConfig = "T" | "TJ_TH" | "TEJ_TEH";

/**
 * Jib yük tabloları:
 * jib_charts[config][jib_length][boom_length][offset_deg] = [[radius, capacity], ...]
 * Tüm anahtarlar string'tir; değerler artan radius'a göre sıralı noktalardır.
 * (SANY SAC2500E'de tüm jib tabloları 80t denge ağırlığındadır.)
 */
export type JibCharts = Record<
  string,
  Record<string, Record<string, Record<string, ChartPoint[]>>>
>;

/** Bir jib konfigürasyonunun UI meta bilgisi. */
export interface JibConfigMeta {
  key: LiftConfig;
  label: string;
  jib_lengths: number[];
  boom_lengths: number[];
  offsets: number[];
  desc?: string;
}

/** Jib tablolarının genel meta bilgisi. */
export interface JibConfigsMeta {
  counterweight_required: number;
  note?: string;
  configs: JibConfigMeta[];
}

/** Vinçe özgü fiziksel ölçüler (broşürden) — yandan/üstten çizim doğruluğu için. */
export interface CraneDimensions {
  source?: string;
  carrier_length_m: number; // şasi toplam uzunluğu
  carrier_width_m: number; // tekerlekler üzerinden genişlik
  body_width_m?: number; // gövde genişliği
  travel_height_m?: number; // taşıma yüksekliği (bom yatık)
  ground_clearance_m?: number; // yerden yükseklik
  deck_height_m?: number; // şasi üst güverte yüksekliği
  axle_count: number; // aks sayısı
  tire_diameter_m: number; // lastik dış çapı
  wheelbase_front_m?: number; // ön aks öne mesafesi
  axle_positions_m?: number[]; // ön uçtan aks x konumları
  tail_radius_m: number; // kuyruk dönme yarıçapı
  cab_height_m?: number; // kabin üst yüksekliği
  boom_pivot_height_m: number; // bom mafsalı yerden yükseklik
  boom_pivot_x_m: number; // bom mafsalı slew merkezine göre x (negatif = geride)
  superstructure_deck_height_m?: number; // döner platform güvertesi
  counterweight_height_m?: number; // denge bloğu yüksekliği
  boom_stowed_length_m?: number; // bazik bom uzunluğu
}

/** Yük tablosundaki üretici amblemi/işareti (ör. * = yalnız arka). */
export interface OverRearNote {
  symbol: string;
  meaning: string;
  points: Array<{
    counterweight: number;
    boom_length: number;
    radius: number;
    capacity: number;
  }>;
}

/** Bir vinç modelinin tam veri tanımı (JSON şeması). */
export interface CraneModel {
  model: string;
  source?: string;
  geometry_constants: GeometryConstants;
  /** geometry_constants'ın kaynağı/güvenilirliği (ör. "TAHMİNİ ..."). */
  geometry_source?: string;
  /** Fiziksel ölçüler (broşürden) — vinçe özgü doğru 2B/3B çizim için. */
  dimensions?: CraneDimensions;
  self_weight: number | null;
  /**
   * Kapasite modu seçenekleri. Liebherr/Excel vinçlerinde [75, 85]; SANY gibi
   * tek 360° tablosu olan vinçlerde [100]. Verilmezse [75, 85] varsayılır.
   */
  capacity_pct_options?: number[];
  counterweight_options: number[];
  boom_lengths: number[];
  outrigger_configs: string[];
  notes?: string;
  /** Yük tablosundaki üretici işaretleri/amblemleri (ör. * = yalnız arka). */
  over_rear_notes?: OverRearNote[];
  /** Jib (副臂) yük tabloları meta bilgisi (UI seçicileri için). */
  jib_configs?: JibConfigsMeta;
  /** Jib yük tabloları (config→jib_length→boom→offset→[[radius,cap]]). */
  jib_charts?: JibCharts;
  /** Broşür teknik özellik özeti (referans; hesaba girmez). */
  datasheet_specs?: Record<string, unknown>;
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

/** Çevre nesnesi türleri (nesne kütüphanesi). */
export type SceneObjectKind =
  | "building" // bina
  | "obstacle" // genel engel / blok
  | "truck" // kamyon / araç
  | "person" // personel
  | "powerline" // enerji hattı (yükseklikte yatay tehlike)
  | "model"; // içe aktarılmış 3B model (glTF/GLB)

/**
 * 3D sahneye yerleştirilen çevre nesnesi. Konum slew merkezine göre plan
 * koordinatıdır: x = ileri/geri ekseni (bom 0° iken +X), z = yanal eksen.
 * Tüm ölçüler metre.
 *
 * kind === "model" ise gerçek geometri modelUrl'den yüklenir; width/depth/height
 * çarpışma için sınırlayıcı kutu (bounding box) ve modeli o kutuya sığacak
 * şekilde ölçeklemek için kullanılır.
 */
export interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  label: string;
  x: number; // plan konumu, slew merkezine göre (m)
  z: number; // plan konumu, yanal (m)
  width: number; // X yönü ölçü (m)
  depth: number; // Z yönü ölçü (m)
  height: number; // yükseklik (m)
  rotationY?: number; // Y ekseni dönüşü (derece) — yalnızca çizim
  /** İçe aktarılmış model için blob/object URL (.glb/.gltf). Oturum içi. */
  modelUrl?: string;
  /** İçe aktarılan dosya adı (UI etiketi için). */
  modelName?: string;
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

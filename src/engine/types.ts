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

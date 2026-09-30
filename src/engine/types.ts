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
  /** Slew merkezinin şasi ön ucuna uzaklığı (m). */
  slew_center_from_front_m?: number;
  /** Ana bom bölüm sayısı (bazik + teleskoplar). */
  boom_sections?: number;
  /** Bazik bom kesit yüksekliği / genişliği (m). */
  boom_base_depth_m?: number;
  boom_base_width_m?: number;
  /** Arka ayakların slew merkezine uzaklığının toplam boyuna açıklığa oranı
   * (rear / Lx). 0,5 = simetrik. Çizimden: ön ayaklar genelde daha uzakta. */
  outrigger_rear_fraction?: number;
  /** Tam denge ağırlığı (t) — plaka yığını yüksekliğini ölçeklemek için. */
  counterweight_max_t?: number;
  /** Denge bloğu derinliği (bom ekseni boyunca) / genişliği (m). */
  counterweight_depth_m?: number;
  counterweight_width_m?: number;
  /** Ayak kutularının slew merkezine göre şasi ekseni X konumları [arka, ön] (m). */
  outrigger_x_m?: number[];
  /** Marka rengi (çizim). */
  color?: string;
  /** Datasheet'te bulunamayıp TAHMİN edilen alanların listesi. */
  estimated_fields?: string[];
}

/** [x, y] metre noktası (profil çizimi). */
export type ProfilePt = [number, number];

/** Renkli bir profil parçası (poligon). */
export interface ProfilePart {
  /** Poligon noktaları (metre, SEYİR hâli, zemin y=0). */
  pts: ProfilePt[];
  /** colors anahtarı ("body", "chassis", "glass", …) veya doğrudan #hex. */
  color: string;
  /** 3B'de kalınlık (m) — verilmezse gövde genişliği. */
  width?: number;
  /** 3B'de yanal yerleşim: "left" / "right" / "center" (varsayılan center). */
  side?: "left" | "right" | "center";
}

/**
 * Vince özgü görünüm — üretici ölçü çiziminden çıkarılmış yan profiller.
 * carrier: x = şasi ÖN ucundan arkaya (m). superstructure: u = slew merkezinden
 * bom yönüne (seyirde öne) (m). y = seyir hâlinde zeminden yükseklik.
 */
export interface CraneAppearance {
  source: string;
  colors: Record<string, string>;
  carrier: ProfilePart[];
  superstructure: ProfilePart[];
  /** Tam denge ağırlığının yan kutusu (u0,u1,y0,y1) — plaka yığını tonajla ölçeklenir. */
  counterweight_box?: { u0: number; u1: number; y0: number; y1: number };
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
  /** Vince özgü görünüm (çizimden profil + renkler). Yoksa genel parametrik çizim. */
  appearance?: CraneAppearance;
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
  /** Bom öz-ağırlığı (t) — ayak reaksiyonu momenti için. Yayınlanmamışsa TAHMİNİ etiketlenir. */
  boom_weight_t?: number;
  /** boom_weight_t'nin kaynağı/güvenilirliği (ör. "TAHMİNİ — ..."). */
  boom_weight_source?: string;
  /** Bom CoG'sinin bom dibinden uca oranı (0–1). Yayınlanmazsa muhafazakâr üst sınır kullanılır. */
  boom_cog_ratio?: number;
  /** Denge ağırlığı bloğunun slew merkezine yatay uzaklığı (m) — ayak reaksiyonu momenti için. */
  counterweight_radius_m?: number;
  /** counterweight_radius_m'nin kaynağı/güvenilirliği. */
  counterweight_radius_source?: string;
  /** Maks. izinli rüzgâr hızı (m/s) — broşürde yoksa null. */
  max_wind_speed_ms?: number | null;
  /** Rüzgâr limiti hakkında açıklama/kaynak notu. */
  wind_note?: string;
  /** Tek halat çekiş kapasitesi (t) — reeving (donanım sayısı) kontrolü için. */
  single_line_pull_t?: number;
  /** Maks. izinli tekil ayak (outrigger) kuvveti (t) — referans/aşım kontrolü için. */
  max_outrigger_force_t?: number;
  load_chart: LoadChart;
}

/** Çevre nesnesi türleri (nesne kütüphanesi). */
export type SceneObjectKind =
  | "building" // bina
  | "obstacle" // genel engel / blok
  | "truck" // kamyon / araç
  | "person" // personel
  | "powerline" // enerji hattı (yükseklikte yatay tehlike)
  | "underground" // yer altı yapısı (boru/kanal/bodrum) — y<0; ayak tablası yakınlığı kontrolü
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
  /** Taban kotu, zeminden yükseklik (m). Belirtilmezse 0 (zemine oturur). Ör.
   * enerji hattı gibi ASILI nesneler için >0 kullanılır (kutu [y, y+height]). */
  y?: number;
  /** Enerji hattı gerilimi (kV) — kind==="powerline" için emniyet marjını belirler. */
  voltage_kv?: number;
  /** Y ekseni dönüşü (derece). Çarpışma testinde de dikkate alınır: nesne
   * kutusu bu açı kadar döndürülmüş kabul edilip test noktaları nesnenin
   * yerel çerçevesine çevrilerek mesafe hesaplanır. */
  rotationY?: number;
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
  /** Engel genişliği (m) — "centered" klerens modelinde kritik köşeye girer. */
  obstacle_width?: number;
  /** Klerens geometri modeli; varsayılan "centered" (gerçek). "excel" = Autocrane.xls birebir. */
  clearance_model?: "centered" | "excel";
  /** Yükün alt yüzünün zeminden yüksekliği (m) — kaldırma (hoist) durumu. Yoksa engel yüksekliği. */
  load_bottom_height?: number;
  /** Kaldırma aparatlarının (sapan/traverse/kiriş) kanca altı toplam yüksekliği (m). */
  rigging_height?: number;
  /** Yükün rüzgâr alan yüzeyi A_p (m²) — rüzgâr limiti için. */
  load_wind_area_m2?: number;
  /** Yükün rüzgâr direnç katsayısı c_w (varsayılan 1,2). */
  load_drag_coefficient?: number;
}

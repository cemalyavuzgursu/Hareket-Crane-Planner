import type { CraneModel, LiftConfig, LiftInputs, SceneObject } from "../engine/types";
import type { CollisionSeverity } from "../engine/collision";

/** UI'da tutulan tam girdi durumu (LiftInputs + ayak/dönme + vinç + çevre). */
export interface UIState extends LiftInputs {
  craneModel: string;
  outrigger_config: string;
  slew_angle: number;
  /** Kaldırma konfigürasyonu: "T" = jibsiz ana bom, aksi halde jib modu. */
  lift_config: LiftConfig;
  /** Jib uzunluğu (m) — yalnız jib modunda kullanılır. */
  jib_length: number;
  /** Jib ofset açısı (°) — yalnız jib modunda kullanılır. */
  jib_offset: number;
  /** Engel genişliği (m) — yalnızca çizim için; Excel hesabını etkilemez. */
  obstacle_width: number;
  /** Ayak takozu (pad) temas alanı (m²) — zemin basıncı için. */
  pad_area_m2: number;
  /** İzin verilen zemin taşıma basıncı (t/m²) — bearing kontrolü için. */
  allowable_bearing_t_m2: number;
  /** Sahneye yerleştirilen çevre nesneleri (nesne kütüphanesi). */
  objects: SceneObject[];
  /** Şasinin sahadaki yönü (°) — şasi arkasının (+X) plan açısı. Eski projelerde yok → 0. */
  crane_heading?: number;
  /** Kaldırma aparatları (Rigging Editor). Doluysa rigging_weight/rigging_height bunlardan türetilir. */
  rigging_items?: RiggingItem[];
  /** Vincin (slew merkezinin) saha plan konumu (m). Çevre nesneleri saha koordinatında. */
  crane_x?: number;
  crane_z?: number;
  /** Yükün ağırlık merkezinin geometrik merkezden kaçıklığı (m), yük yerel çerçevesinde
   * (x = bom yönü, z = yanal). Sapan kol kuvvetlerini etkiler. */
  load_cog_offset?: { x: number; z: number };
  /** Seçili kanca bloğu (hookBlocks kütüphanesi id). Seçiliyse hook_weight bundan gelir. */
  hook_block_id?: string;
  /** Zemin eğimi (%) — vinç kurulum yeri. */
  ground_slope_pct?: number;
  /** Tandem (iki vinçli) kaldırma. */
  tandem?: TandemState;
  /** Al–bırak (pick & place) güzergâhı. */
  lift_path?: LiftPathState;
  /** Kaldırma öncesi kontrol listesi. */
  checklist?: ChecklistItem[];
  /** Onay akışı. */
  approval?: ApprovalState;
}

/** İkinci (yardımcı/tandem) vinç. Konum/yön saha koordinatında. */
export interface TandemState {
  enabled: boolean;
  craneModel: string;
  counterweight: number;
  capacity_pct: number;
  boom_length: number;
  outrigger_config: string;
  x: number;
  z: number;
  heading: number;
  /** Yük ağırlık merkezinin iki kanca arasındaki konumu (0 = ana vinç kancası, 1 = ikinci vinç). */
  cog_ratio: number;
  /** Tandem düşürme katsayısı: her vinç kapasitesinin en fazla bu oranı (%) kullanılabilir. */
  derate_pct: number;
  /** İki kanca arası mesafe (m) — vinç 2'nin kancası ana kancadan bu kadar, vinç 2'ye doğru. */
  hook_spacing?: number;
}

/** Saha plan noktası + yükün alt yüzü yüksekliği. */
export interface SitePoint {
  x: number;
  z: number;
  h: number;
}

export interface LiftPathState {
  pick: SitePoint;
  place: SitePoint;
  /** Güzergâh üzerinde yükün geçeceği minimum yükseklik (m) — engel üstünden geçiş. */
  travel_height: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  by?: string;
  at?: string; // ISO tarih
}

export type ApprovalStatus = "draft" | "submitted" | "approved" | "rejected";

export interface ApprovalState {
  status: ApprovalStatus;
  preparedBy: string;
  preparedAt?: string;
  approvedBy: string;
  approvedAt?: string;
  comment: string;
}

/** Rigging Editor şablon türleri (Crane Planner 2.0'daki 6 şablona karşılık). */
export type RiggingKind =
  | "sling2" // 2 kollu sapan
  | "sling4" // 4 kollu sapan
  | "spreader" // traverse (spreader bar) + üst/alt sapanlar
  | "beam" // askı kirişi (lifting beam)
  | "shackle" // kilit / mapa
  | "custom"; // özel aparat

/** Bir kaldırma aparatı. Ölçüler metre, ağırlık ton. Aparatlar kancadan aşağı SIRAYLA dizilir. */
export interface RiggingItem {
  id: string;
  kind: RiggingKind;
  label: string;
  /** Ağırlık (t). */
  weight_t: number;
  /** Kanca altında kapladığı düşey yükseklik (m). */
  height_m: number;
  /** Yatay açıklık/uzunluk (m) — traverse/kiriş boyu, sapan ayak açıklığı. Çizim için. */
  length_m: number;
}

/**
 * UI durumundan hesap girdileri. Aparat listesi doluysa rigging_weight ve
 * rigging_height listeden türetilir (boşsa elle girilen rigging_weight kalır).
 * App ve PDF yeniden hesabı AYNI dönüşümü kullanmalı.
 */
export function liftInputsFromState(s: UIState): UIState {
  const items = s.rigging_items ?? [];
  if (items.length === 0) return s;
  const t = riggingTotals(items);
  return { ...s, rigging_weight: t.weight, rigging_height: t.height };
}

/** Aparat listesinden toplam ağırlık ve yükseklik. */
export function riggingTotals(items: RiggingItem[] | undefined): { weight: number; height: number } {
  if (!items || items.length === 0) return { weight: 0, height: 0 };
  return items.reduce(
    (a, it) => ({ weight: a.weight + (Number.isFinite(it.weight_t) ? it.weight_t : 0), height: a.height + (Number.isFinite(it.height_m) ? it.height_m : 0) }),
    { weight: 0, height: 0 },
  );
}

/**
 * Kalıcılık (localStorage autosave + proje dosyası) şema sürümü. Yapı her
 * değiştiğinde artırılır. persistence.ts eski sürümleri (1) geriye dönük
 * uyumlu şekilde okur (meta alanı boş varsayılanla doldurulur); yalnızca
 * tanınmayan/daha yeni sürümler veya bozuk veri sessizce göz ardı edilir.
 *
 * v1 → v2: ProjectMeta (proje/saha/müşteri/revizyon/hazırlayan/onaylayan) eklendi.
 */
export const STATE_SCHEMA_VERSION = 2;

/** PDF rapor başlığı + imza bloğu için proje/iş meta verisi. Hesaba girmez. */
export interface ProjectMeta {
  projectName: string;
  siteLocation: string;
  client: string;
  jobNo: string;
  revision: string;
  preparedBy: string;
  approvedBy: string;
}

export function defaultProjectMeta(): ProjectMeta {
  return {
    projectName: "",
    siteLocation: "",
    client: "",
    jobNo: "",
    revision: "",
    preparedBy: "",
    approvedBy: "",
  };
}

/** Zemin taşıma basıncı emniyet değeri hazır seçenekleri (t/m²) — serbest giriş de mümkündür. */
export const BEARING_PRESETS: Array<{ label: string; value: number }> = [
  { label: "Gevşek dolgu (10 t/m²)", value: 10 },
  { label: "Kum-çakıl (20 t/m²)", value: 20 },
  { label: "Orta sıkı zemin (25 t/m²)", value: 25 },
  { label: "Sıkı zemin (40 t/m²)", value: 40 },
  { label: "Kaya (100 t/m²)", value: 100 },
];

/** Bir çalışma adımının özeti (hızlı liste + rapor karşılaştırması için). */
export interface StepSummary {
  utilization_pct: number;
  status: string;
  rated_capacity: number;
  total_load: number;
  max_corner_load: number | null;
  worst_collision: CollisionSeverity;
}

/** Kaydedilmiş bir çalışma adımı (multi-step kaldırma senaryosu). */
export interface WorkStep {
  id: string;
  name: string;
  /** O adımdaki tam konfigürasyon (yeniden hesaplanabilir snapshot). */
  config: UIState;
  summary: StepSummary;
}

/** Golden test senaryosu varsayılan değerler (LTM 1250). */
export function defaultState(crane: CraneModel): UIState {
  return {
    craneModel: crane.model,
    load_weight: 105,
    hook_weight: 0.5,
    rigging_weight: 0.2,
    load_height: 4.25,
    load_diameter: 6.32,
    obstacle_height: 2.3,
    obstacle_distance: 0,
    boom_length: crane.boom_lengths[0],
    radius: 9,
    counterweight: crane.counterweight_options.includes(40)
      ? 40
      : crane.counterweight_options[crane.counterweight_options.length - 1],
    capacity_pct: (crane.capacity_pct_options ?? [75, 85]).includes(85)
      ? 85
      : (crane.capacity_pct_options ?? [75, 85])[0],
    outrigger_config: crane.outrigger_configs[0],
    slew_angle: 270,
    lift_config: "T",
    jib_length: 0,
    jib_offset: 0,
    obstacle_width: 2.5,
    pad_area_m2: 1.0,
    allowable_bearing_t_m2: 25,
    objects: [],
  };
}

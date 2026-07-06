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

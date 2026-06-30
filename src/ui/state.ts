import type { CraneModel, LiftInputs, SceneObject } from "../engine/types";
import type { CollisionSeverity } from "../engine/collision";

/** UI'da tutulan tam girdi durumu (LiftInputs + ayak/dönme + vinç + çevre). */
export interface UIState extends LiftInputs {
  craneModel: string;
  outrigger_config: string;
  slew_angle: number;
  /** Engel genişliği (m) — yalnızca çizim için; Excel hesabını etkilemez. */
  obstacle_width: number;
  /** Sahneye yerleştirilen çevre nesneleri (nesne kütüphanesi). */
  objects: SceneObject[];
}

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
    capacity_pct: 85,
    outrigger_config: crane.outrigger_configs[0],
    slew_angle: 270,
    obstacle_width: 2.5,
    objects: [],
  };
}

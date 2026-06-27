import type { CraneModel, LiftInputs } from "../engine/types";

/** UI'da tutulan tam girdi durumu (LiftInputs + ayak/dönme + vinç seçimi). */
export interface UIState extends LiftInputs {
  craneModel: string;
  outrigger_config: string;
  slew_angle: number;
  /** Engel genişliği (m) — yalnızca çizim için; Excel hesabını etkilemez. */
  obstacle_width: number;
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
  };
}

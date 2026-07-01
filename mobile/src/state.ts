// Mobil uygulama girdi durumu + varsayılanlar. Hesap çekirdeği (engine) ile
// aynı LiftInputs alanlarını kullanır; UI-özel alanlar (slew, ayak, engel) eklenir.
import type { CraneModel, LiftInputs } from "./shared/engine/types";

export interface AppState extends LiftInputs {
  craneModel: string;
  outrigger_config: string;
  slew_angle: number;
  obstacle_width: number; // yalnız çizim
}

/** Bir vinç için makul saha varsayılanları. */
export function defaultState(crane: CraneModel): AppState {
  const cwOpts = crane.counterweight_options;
  const pctOpts = crane.capacity_pct_options ?? [75, 85];
  return {
    craneModel: crane.model,
    load_weight: 50,
    hook_weight: 0.5,
    rigging_weight: 0.2,
    load_height: 3,
    load_diameter: 2.5,
    obstacle_height: 0,
    obstacle_distance: 0,
    obstacle_width: 2.5,
    boom_length: crane.boom_lengths[0],
    radius: 9,
    counterweight: cwOpts.includes(40) ? 40 : cwOpts[cwOpts.length - 1],
    capacity_pct: pctOpts.includes(85) ? 85 : pctOpts[pctOpts.length - 1],
    outrigger_config: crane.outrigger_configs[0],
    slew_angle: 270,
  };
}

/** Vinç değişince bağımlı alanları (bom, denge, %, ayak) yeni vince uyarlar. */
export function reconcileForCrane(prev: AppState, crane: CraneModel): AppState {
  const pctOpts = crane.capacity_pct_options ?? [75, 85];
  return {
    ...prev,
    craneModel: crane.model,
    boom_length: crane.boom_lengths.includes(prev.boom_length)
      ? prev.boom_length
      : crane.boom_lengths[0],
    counterweight: crane.counterweight_options.includes(prev.counterweight)
      ? prev.counterweight
      : (crane.counterweight_options.includes(40)
          ? 40
          : crane.counterweight_options[crane.counterweight_options.length - 1]),
    capacity_pct: pctOpts.includes(prev.capacity_pct) ? prev.capacity_pct : pctOpts[pctOpts.length - 1],
    outrigger_config: crane.outrigger_configs.includes(prev.outrigger_config)
      ? prev.outrigger_config
      : crane.outrigger_configs[0],
  };
}

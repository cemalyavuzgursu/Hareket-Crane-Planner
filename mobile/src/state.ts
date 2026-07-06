// Mobil uygulama girdi durumu + varsayılanlar. Hesap çekirdeği (engine) ile
// aynı LiftInputs alanlarını kullanır; UI-özel alanlar (slew, ayak, engel, jib) eklenir.
import type { CraneModel, LiftConfig, LiftInputs } from "./shared/engine/types";

export interface AppState extends LiftInputs {
  craneModel: string;
  outrigger_config: string;
  slew_angle: number;
  obstacle_width: number; // yalnız çizim
  /** Kaldırma konfigürasyonu: "T" = jibsiz ana bom, aksi halde jib modu. */
  lift_config: LiftConfig;
  /** Jib uzunluğu (m) — yalnız jib modunda kullanılır. */
  jib_length: number;
  /** Jib ofset açısı (°) — yalnız jib modunda kullanılır. */
  jib_offset: number;
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
    lift_config: "T",
    jib_length: 0,
    jib_offset: 0,
  };
}

/** Vinç değişince bağımlı alanları (bom, denge, %, ayak, jib) yeni vince uyarlar. */
export function reconcileForCrane(prev: AppState, crane: CraneModel): AppState {
  const pctOpts = crane.capacity_pct_options ?? [75, 85];
  // Yeni vinçte seçili jib konfigürasyonu yoksa (veya vinçte jib tablosu yoksa) ana boma dön.
  const jibMeta = crane.jib_configs?.configs.find((c) => c.key === prev.lift_config);
  const lift_config: LiftConfig = jibMeta ? prev.lift_config : "T";
  return {
    ...prev,
    craneModel: crane.model,
    lift_config,
    jib_length: jibMeta ? (jibMeta.jib_lengths.includes(prev.jib_length) ? prev.jib_length : jibMeta.jib_lengths[0]) : 0,
    jib_offset: jibMeta ? (jibMeta.offsets.includes(prev.jib_offset) ? prev.jib_offset : jibMeta.offsets[0]) : 0,
    boom_length: jibMeta
      ? (jibMeta.boom_lengths.includes(prev.boom_length) ? prev.boom_length : jibMeta.boom_lengths[jibMeta.boom_lengths.length - 1])
      : (crane.boom_lengths.includes(prev.boom_length) ? prev.boom_length : crane.boom_lengths[0]),
    counterweight: jibMeta
      ? crane.jib_configs!.counterweight_required
      : (crane.counterweight_options.includes(prev.counterweight)
          ? prev.counterweight
          : (crane.counterweight_options.includes(40)
              ? 40
              : crane.counterweight_options[crane.counterweight_options.length - 1])),
    capacity_pct: pctOpts.includes(prev.capacity_pct) ? prev.capacity_pct : pctOpts[pctOpts.length - 1],
    outrigger_config: crane.outrigger_configs.includes(prev.outrigger_config)
      ? prev.outrigger_config
      : crane.outrigger_configs[0],
  };
}

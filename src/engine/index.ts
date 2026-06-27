// Hesap çekirdeği — tek giriş noktası. UI'dan tamamen bağımsız.

export * from "./types.js";
export * from "./capacity.js";
export * from "./clearance.js";
export * from "./outrigger.js";

import type { CraneModel, LiftInputs } from "./types.js";
import { computeCapacity, type CapacityResult } from "./capacity.js";
import { computeClearance, type ClearanceResult } from "./clearance.js";
import {
  computeOutrigger,
  parseOutriggerConfig,
  type OutriggerResult,
} from "./outrigger.js";

export interface LiftResult {
  capacity: CapacityResult;
  clearance: ClearanceResult;
}

export interface FullLiftResult extends LiftResult {
  /** self_weight ve ayak konfigürasyonu varsa hesaplanır; aksi halde hata mesajı. */
  outrigger: OutriggerResult | null;
  outrigger_error?: string;
}

/** (A) + (B): bir vinç modeli ve girdiler için tam kaldırma hesabı. */
export function computeLift(crane: CraneModel, inp: LiftInputs): LiftResult {
  const capacity = computeCapacity(crane, {
    load_weight: inp.load_weight,
    hook_weight: inp.hook_weight,
    rigging_weight: inp.rigging_weight,
    counterweight: inp.counterweight,
    capacity_pct: inp.capacity_pct,
    boom_length: inp.boom_length,
    radius: inp.radius,
  });
  const clearance = computeClearance(crane.geometry_constants, {
    boom_length: inp.boom_length,
    radius: inp.radius,
    load_height: inp.load_height,
    load_diameter: inp.load_diameter,
    obstacle_height: inp.obstacle_height,
    obstacle_distance: inp.obstacle_distance,
  });
  return { capacity, clearance };
}

/**
 * (A)+(B)+(C): kapasite + klerens + ayak reaksiyonu.
 * Ayak reaksiyonu için crane.self_weight ve geçerli bir ayak konfigürasyonu gerekir.
 * Eksikse outrigger=null döner ve outrigger_error doldurulur (hesap çökmemeli).
 */
export function computeLiftFull(
  crane: CraneModel,
  inp: LiftInputs,
  opts: { outrigger_config: string; slew_angle: number; pad_area?: number },
): FullLiftResult {
  const base = computeLift(crane, inp);
  let outrigger: OutriggerResult | null = null;
  let outrigger_error: string | undefined;
  try {
    if (crane.self_weight == null) {
      throw new Error("Vinç self_weight tanımlı değil (datasheet'ten doldurulmalı).");
    }
    const { Lx, Ly } = parseOutriggerConfig(opts.outrigger_config);
    outrigger = computeOutrigger(
      {
        crane_self_weight: crane.self_weight,
        counterweight: inp.counterweight,
        total_load: base.capacity.total_load,
        radius: inp.radius,
        Lx,
        Ly,
        pad_area: opts.pad_area,
      },
      1,
    );
  } catch (e) {
    outrigger_error = e instanceof Error ? e.message : String(e);
  }
  return { ...base, outrigger, outrigger_error };
}

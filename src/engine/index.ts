// Hesap çekirdeği — tek giriş noktası. UI'dan tamamen bağımsız.

export * from "./types.js";
export * from "./capacity.js";
export * from "./clearance.js";
export * from "./outrigger.js";
export * from "./collision.js";

import type { CraneModel, LiftConfig, LiftInputs, SceneObject } from "./types.js";
import { computeCapacity, computeJibCapacity, type CapacityResult } from "./capacity.js";
import { computeClearance, type ClearanceResult } from "./clearance.js";
import {
  computeOutrigger,
  parseOutriggerConfig,
  type OutriggerResult,
} from "./outrigger.js";
import { computeCollisions, type CollisionReport } from "./collision.js";

/** Jib kaldırma parametreleri (config === "T" veya tanımsız ise ana bom modu). */
export interface JibParams {
  config: LiftConfig;
  jib_length: number;
  jib_offset: number;
}

export interface LiftResult {
  capacity: CapacityResult;
  /**
   * Klerens/geometri sonucu. Jib modunda null'dur — jib mafsal geometrisi
   * broşürde olmadığından ana bom klerensi bu konfigürasyon için geçersizdir.
   */
  clearance: ClearanceResult | null;
  /** Aktif kaldırma konfigürasyonu (jib bilgisi dahil). */
  lift_config: LiftConfig;
  jib?: JibParams;
}

const EMPTY_COLLISION: CollisionReport = { worst: "ok", items: [], active: [] };

export interface FullLiftResult extends LiftResult {
  /** self_weight ve ayak konfigürasyonu varsa hesaplanır; aksi halde hata mesajı. */
  outrigger: OutriggerResult | null;
  outrigger_error?: string;
  /** Çarpışma raporu (ana engel/yük + çevre nesneleri). Jib modunda boştur. */
  collision: CollisionReport;
}

function isJib(jib?: JibParams): jib is JibParams {
  return !!jib && jib.config !== "T";
}

/** (A) + (B): bir vinç modeli ve girdiler için tam kaldırma hesabı. */
export function computeLift(
  crane: CraneModel,
  inp: LiftInputs,
  jib?: JibParams,
): LiftResult {
  if (isJib(jib)) {
    // Jib tabloları belirli bir denge ağırlığı için geçerlidir (ör. SANY 80t).
    // Farklı denge ağırlığıyla bu tabloyu kullanmak kapasiteyi yanlış gösterir.
    const reqCw = crane.jib_configs?.counterweight_required;
    if (reqCw != null && Math.abs(inp.counterweight - reqCw) > 1e-9) {
      throw new Error(
        `Jib modunda denge ağırlığı ${reqCw}t olmalıdır (seçili: ${inp.counterweight}t). ` +
          `Jib yük tabloları yalnızca ${reqCw}t denge ağırlığı için geçerlidir.`,
      );
    }
    const capacity = computeJibCapacity(crane, {
      load_weight: inp.load_weight,
      hook_weight: inp.hook_weight,
      rigging_weight: inp.rigging_weight,
      config: jib.config,
      jib_length: jib.jib_length,
      boom_length: inp.boom_length,
      jib_offset: jib.jib_offset,
      radius: inp.radius,
    });
    // Jib modunda klerens/2B-3B geometrisi modellenmez.
    return { capacity, clearance: null, lift_config: jib.config, jib };
  }
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
  return { capacity, clearance, lift_config: "T" };
}

/**
 * (A)+(B)+(C): kapasite + klerens + ayak reaksiyonu.
 * Ayak reaksiyonu için crane.self_weight ve geçerli bir ayak konfigürasyonu gerekir.
 * Eksikse outrigger=null döner ve outrigger_error doldurulur (hesap çökmemeli).
 */
export function computeLiftFull(
  crane: CraneModel,
  inp: LiftInputs,
  opts: {
    outrigger_config: string;
    slew_angle: number;
    pad_area?: number;
    objects?: SceneObject[];
    jib?: JibParams;
  },
): FullLiftResult {
  const base = computeLift(crane, inp, opts.jib);
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

  // Jib modunda klerens yok → çarpışma geometrisi hesaplanmaz (boş rapor).
  const collision = base.clearance
    ? computeCollisions(
        {
          g: crane.geometry_constants,
          boom_length: inp.boom_length,
          radius: inp.radius,
          gama: base.clearance.gama,
          slew_angle: opts.slew_angle,
          load_height: inp.load_height,
          load_diameter: inp.load_diameter,
          hook_height: crane.geometry_constants.hook_height,
          objects: opts.objects ?? [],
        },
        base.clearance,
      )
    : EMPTY_COLLISION;

  return { ...base, outrigger, outrigger_error, collision };
}

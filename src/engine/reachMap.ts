// ÜSTTEN KAPASİTE HARİTASI (reach map) — mevcut konfigürasyon için vinç
// çevresindeki her plan noktasında "buraya yük konabilir mi?" sorusunu yanıtlar.
//
// Çerçeve (computeLiftFull ile aynı):
//   • Çevre nesneleri ve hücreler SAHA koordinatındadır; slew merkezi
//     crane_position'dadır (varsayılan 0,0).
//   • Plan açısı θ = atan2(dz, dx) (°): +X = 0°, +Z = 90°.
//   • Bom plan açısı = crane_heading + slew  →  slew = θ − heading.
//   • Ayak reaksiyonu şasiye göredir: cornerLoadsAtAngle(slew).
//
// Hız için computeLiftFull HÜCRE BAŞINA ÇAĞRILMAZ (her çağrı 360° ayak
// taraması yapar). Bunun yerine aynı parçalar tek tek kullanılır:
//   1) Kapasite: eğri bir kez getCapacityCurve ile alınır, hücrede
//      interpolateCapacity (step-down, motorla birebir aynı) okunur.
//   2) Ayak dengesi: yalnız o slew açısında cornerLoadsAtAngle — parametreler
//      computeLiftFull'daki ile aynıdır (base_offset_x = −rect_center_x,
//      boom_cog_offset = −boom_offset + boom_cog_ratio·L·cos γ). Bu mantık
//      index.ts'de değişirse burası da güncellenmelidir (outrigger params).
//   3) Çarpışma: yalnız çevre nesnesi varsa computeClearance + computeCollisions.
//      Haritada yalnız ÇEVRE NESNESİ kalemleri (id "obj-…") değerlendirilir;
//      ana engel/yük/kaldırma yüksekliği kalemleri plan konumundan bağımsızdır
//      (Sonuçlar panelinde gösterilir) ve kuyruk savrulması (…-tail) slew'den
//      bağımsızdır → haritanın tamamını boyayacağından ayrı olarak
//      `tail_warnings` içinde döner.
//   Jib modu modellenmez (ana bom tablosu).

import type { ChartPoint, CraneModel, LiftInputs, SceneObject } from "./types.js";
import { getCapacityCurve, interpolateCapacity } from "./capacity.js";
import { computeClearance, type ClearanceResult } from "./clearance.js";
import { computeCollisions } from "./collision.js";
import { cornerLoadsAtAngle, parseOutriggerConfig, type OutriggerInputs } from "./outrigger.js";

export type ReachStatus = "ok" | "warn" | "over" | "collision" | "unreachable";

export interface ReachCell {
  /** Hücre merkezi, saha koordinatı (m). */
  x: number;
  z: number;
  status: ReachStatus;
  /** Kapasite kullanımı (%) — erişilemeyen hücrede null. */
  utilization_pct: number | null;
  reason?: string;
}

export interface ReachMap {
  cells: ReachCell[];
  /** Hücre kenarı (m). */
  cell: number;
  /** Izgara yarı genişliği (m) — vinç merkezinden. */
  extent: number;
  min_radius: number;
  max_radius: number;
  /** Uygun (ok/warn) hücreler arasındaki en düşük kullanım (%). */
  best_utilization: number | null;
  /** Slew'den bağımsız kuyruk savrulması çakışmaları (varsa). */
  tail_warnings?: string[];
  /** Eğri bulunamadıysa hata mesajı (tüm hücreler unreachable). */
  error?: string;
}

export interface ReachMapOptions {
  outrigger_config: string;
  crane_heading?: number;
  crane_position?: { x: number; z: number };
  objects?: SceneObject[];
  /** Hücre kenarı (m), varsayılan 1. */
  cell?: number;
  /** Uyarı eşiği (%), varsayılan 90. */
  warn_pct?: number;
}

const RAD = 180 / Math.PI;

/** superstructureHeightOnOutriggers (index.ts) kopyası — döngüsel import önlenir. */
function superstructureHeight(crane: CraneModel): number | undefined {
  const d = crane.dimensions;
  if (!d || d.superstructure_deck_height_m == null) return undefined;
  const g = crane.geometry_constants;
  const lift = Math.max(0, g.cribbing_height + g.machine_ground_height - d.boom_pivot_height_m);
  return d.superstructure_deck_height_m + lift;
}

export function computeReachMap(
  crane: CraneModel,
  inputs: LiftInputs,
  opts: ReachMapOptions,
): ReachMap {
  const cell = opts.cell && opts.cell > 0 ? opts.cell : 1;
  const warnPct = opts.warn_pct ?? 90;
  const heading = opts.crane_heading ?? 0;
  const cx = opts.crane_position?.x ?? 0;
  const cz = opts.crane_position?.z ?? 0;
  const total_load = inputs.load_weight + inputs.hook_weight + inputs.rigging_weight;

  let curve: ChartPoint[];
  try {
    curve = [...getCapacityCurve(crane, inputs.counterweight, inputs.capacity_pct, inputs.boom_length)].sort(
      (a, b) => a[0] - b[0],
    );
  } catch (e) {
    return {
      cells: [],
      cell,
      extent: 0,
      min_radius: 0,
      max_radius: 0,
      best_utilization: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const min_radius = curve[0][0];
  const max_radius = curve[curve.length - 1][0];
  const extent = Math.ceil((max_radius + 2) / cell) * cell;

  // ── Ayak dengesi parametreleri (computeLiftFull ile aynı) ──────────────────
  let outBase: OutriggerInputs | null = null;
  if (crane.self_weight != null && crane.self_weight > 0) {
    try {
      const { Lx, Ly } = parseOutriggerConfig(opts.outrigger_config);
      const f = crane.dimensions?.outrigger_rear_fraction ?? 0.5;
      const rect_center_x = (Lx * f - Lx * (1 - f)) / 2;
      outBase = {
        crane_self_weight: crane.self_weight,
        counterweight: inputs.counterweight,
        total_load,
        radius: 0,
        Lx,
        Ly,
        boom_weight: crane.boom_weight_t,
        counterweight_radius: crane.counterweight_radius_m,
        base_offset_x: -rect_center_x,
      };
    } catch {
      outBase = null;
    }
  }

  // ── Çevre nesneleri (vinç çerçevesine) ─────────────────────────────────────
  const objects = (opts.objects ?? [])
    .filter((o) => o.kind !== "underground")
    .map((o) => (cx === 0 && cz === 0 ? o : { ...o, x: o.x - cx, z: o.z - cz }));
  const hasObjects = objects.length > 0;
  const ssh = superstructureHeight(crane);
  const g = crane.geometry_constants;
  const needClearance = hasObjects || (outBase != null && crane.boom_cog_ratio != null);

  const tail_warnings: string[] = [];
  let tailChecked = false;

  const cells: ReachCell[] = [];
  let best: number | null = null;
  const n = Math.round(extent / cell);

  for (let i = -n; i < n; i++) {
    const dx = (i + 0.5) * cell;
    for (let j = -n; j < n; j++) {
      const dz = (j + 0.5) * cell;
      const r = Math.hypot(dx, dz);
      if (r > extent) continue; // dairesel ızgara
      const x = cx + dx;
      const z = cz + dz;
      if (r < min_radius - 1e-9) {
        cells.push({ x, z, status: "unreachable", utilization_pct: null, reason: `Min. radius (${min_radius} m) altında` });
        continue;
      }
      if (r > max_radius + 1e-9) {
        cells.push({ x, z, status: "unreachable", utilization_pct: null, reason: `Maks. radius (${max_radius} m) dışında` });
        continue;
      }
      const planAngle = Math.atan2(dz, dx) * RAD;
      const slew = planAngle - heading;

      const cap = interpolateCapacity(curve, r);
      const util = (total_load / cap) * 100;
      let status: ReachStatus = util > 100 ? "over" : util >= warnPct ? "warn" : "ok";
      let reason: string | undefined =
        status === "over" ? `Kapasite aşımı (${cap.toFixed(1)} t izinli)` : undefined;

      let cl: ClearanceResult | null = null;
      if (needClearance) {
        try {
          cl = computeClearance(g, {
            boom_length: inputs.boom_length,
            radius: r,
            load_height: inputs.load_height,
            load_diameter: inputs.load_diameter,
            obstacle_height: inputs.obstacle_height,
            obstacle_distance: inputs.obstacle_distance,
            obstacle_width: inputs.obstacle_width,
            model: inputs.clearance_model,
            load_bottom_height: inputs.load_bottom_height,
          });
          if (!isFinite(cl.gama)) cl = null;
        } catch {
          cl = null;
        }
      }

      // Ayak dengesi — yalnız bu slew açısında.
      if (outBase && status !== "over") {
        let boom_cog_offset: number | undefined;
        if (crane.boom_cog_ratio != null) {
          boom_cog_offset = cl
            ? -g.boom_offset + crane.boom_cog_ratio * inputs.boom_length * Math.cos(cl.gama)
            : r * crane.boom_cog_ratio;
        }
        const at = cornerLoadsAtAngle({ ...outBase, radius: r, boom_cog_offset }, slew);
        if (at.tipping) {
          status = "over";
          reason = "Devrilme riski (ayak dengesi)";
        } else if (
          status === "ok" &&
          crane.max_outrigger_force_t != null &&
          crane.max_outrigger_force_t > 0 &&
          at.max_corner.load > crane.max_outrigger_force_t
        ) {
          status = "warn";
          reason = `Ayak kuvveti ${at.max_corner.load.toFixed(1)} t > ${crane.max_outrigger_force_t} t`;
        }
      }

      // Çarpışma — yalnız çevre nesnesi varsa.
      if (hasObjects && cl) {
        const rep = computeCollisions(
          {
            g,
            boom_length: inputs.boom_length,
            radius: r,
            gama: cl.gama,
            rigging_height: inputs.rigging_height,
            load_bottom: cl.load_bottom_height,
            slew_angle: planAngle,
            load_height: inputs.load_height,
            load_diameter: inputs.load_diameter,
            load_center_x: cl.load_center_x,
            hook_height: g.hook_height,
            objects,
            tail_radius_m: tailChecked ? undefined : crane.dimensions?.tail_radius_m,
            superstructure_height_m: tailChecked ? undefined : ssh,
          },
          cl,
        );
        if (!tailChecked) {
          tailChecked = true;
          for (const it of rep.items) {
            if (it.source === "tail" && it.severity === "collision") tail_warnings.push(it.message);
          }
        }
        const hit = rep.items.find(
          (it) => it.id.startsWith("obj-") && it.source !== "tail" && it.severity === "collision",
        );
        if (hit) {
          status = "collision";
          reason = hit.message;
        }
      }

      if ((status === "ok" || status === "warn") && (best == null || util < best)) best = util;
      cells.push({ x, z, status, utilization_pct: util, reason });
    }
  }

  const res: ReachMap = { cells, cell, extent, min_radius, max_radius, best_utilization: best };
  if (tail_warnings.length) res.tail_warnings = tail_warnings;
  return res;
}

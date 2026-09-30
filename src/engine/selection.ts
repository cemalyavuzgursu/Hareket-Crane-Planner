// Makine seçim sihirbazı — "bu kaldırmayı hangi vinç/konfigürasyon yapabilir?"
// Tüm vinçler × denge ağırlığı × kapasite modu × bom uzunluğu (ana bom, T modu)
// taranır; kapasite, klerens ve kanca yüksekliği kontrol edilir.

import type { CraneModel } from "./types.js";
import { loadChartLookup } from "./capacity.js";
import { computeClearance } from "./clearance.js";

export interface SelectionQuery {
  /** Toplam kanca yükü (yük + kanca + aparat) (t). */
  total_load: number;
  radius: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
  obstacle_width?: number;
  /** Aparat yüksekliği (m) — kaldırma yüksekliği kontrolüne girer. */
  rigging_height?: number;
  /** Gerekli minimum kanca yüksekliği (m) — verilmezse kontrol edilmez. */
  required_hook_height?: number;
  /** İzin verilen maks. kapasite kullanımı (%) — varsayılan 100. */
  max_utilization_pct?: number;
  /** Minimum bom/yük klerensi (m) — varsayılan 0. */
  min_clearance_m?: number;
}

export interface SelectionCandidate {
  crane_model: string;
  counterweight: number;
  capacity_pct: number;
  boom_length: number;
  rated_capacity: number | null;
  utilization_pct: number | null;
  clearance_to_load: number | null;
  clearance_to_obstacle: number | null;
  max_hook_height: number | null;
  /** Aparatlar sonrası kalan kaldırma yüksekliği (m). */
  lift_room: number | null;
  feasible: boolean;
  /** Uygun değilse nedenleri (Türkçe, kısa). */
  reasons: string[];
}

export function findConfigurations(cranes: CraneModel[], q: SelectionQuery): SelectionCandidate[] {
  const maxUtil = q.max_utilization_pct ?? 100;
  const minClr = q.min_clearance_m ?? 0;
  const out: SelectionCandidate[] = [];

  for (const crane of cranes) {
    const pcts = crane.capacity_pct_options ?? [75, 85];
    for (const cw of crane.counterweight_options) {
      for (const pct of pcts) {
        for (const boom of crane.boom_lengths) {
          const c: SelectionCandidate = {
            crane_model: crane.model,
            counterweight: cw,
            capacity_pct: pct,
            boom_length: boom,
            rated_capacity: null,
            utilization_pct: null,
            clearance_to_load: null,
            clearance_to_obstacle: null,
            max_hook_height: null,
            lift_room: null,
            feasible: false,
            reasons: [],
          };
          try {
            c.rated_capacity = loadChartLookup(crane, cw, pct, boom, q.radius);
            c.utilization_pct = (q.total_load / c.rated_capacity) * 100;
            if (c.utilization_pct > maxUtil) c.reasons.push(`kapasite %${c.utilization_pct.toFixed(0)}`);
          } catch {
            // Tablo yok ya da radius tablo aralığı dışında → bu konfigürasyon listelenmez.
            continue;
          }
          try {
            const cl = computeClearance(crane.geometry_constants, {
              boom_length: boom,
              radius: q.radius,
              load_height: q.load_height,
              load_diameter: q.load_diameter,
              obstacle_height: q.obstacle_height,
              obstacle_distance: q.obstacle_distance,
              obstacle_width: q.obstacle_width,
            });
            c.clearance_to_load = cl.clearance_to_load;
            c.clearance_to_obstacle = cl.clearance_to_obstacle;
            c.max_hook_height = cl.max_hook_height;
            c.lift_room = cl.max_sling_spread - (q.rigging_height ?? 0);
            if (cl.clearance_to_load < minClr) c.reasons.push(`yük klerensi ${cl.clearance_to_load.toFixed(2)} m`);
            if (q.obstacle_height > 0 && cl.clearance_to_obstacle < minClr)
              c.reasons.push(`engel klerensi ${cl.clearance_to_obstacle.toFixed(2)} m`);
            if (c.lift_room < 0) c.reasons.push("kaldırma yüksekliği yetmiyor");
            if (q.required_hook_height != null && cl.max_hook_height < q.required_hook_height)
              c.reasons.push(`kanca yüksekliği ${cl.max_hook_height.toFixed(1)} m`);
          } catch (e) {
            c.reasons.push(e instanceof Error ? "geometri: erişilemez" : "geometri hatası");
          }
          c.feasible = c.reasons.length === 0;
          out.push(c);
        }
      }
    }
  }

  // Sıralama: uygunlar önce; aralarında en az kurulum (düşük denge ağırlığı,
  // kısa bom), eşitlikte daha yüksek kullanım (vinç daha verimli kullanılır).
  // Uygun olmayanlar kullanım oranına göre (en yakın aday üstte).
  return out.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.feasible) {
      return (
        a.counterweight - b.counterweight ||
        a.boom_length - b.boom_length ||
        (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0)
      );
    }
    return (a.utilization_pct ?? Infinity) - (b.utilization_pct ?? Infinity);
  });
}

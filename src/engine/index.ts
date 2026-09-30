// Hesap çekirdeği — tek giriş noktası. UI'dan tamamen bağımsız.

export * from "./types.js";
export * from "./capacity.js";
export * from "./clearance.js";
export * from "./outrigger.js";
export * from "./collision.js";

import type { CraneModel, LiftConfig, LiftInputs, SceneObject } from "./types.js";
import {
  computeCapacity,
  computeJibCapacity,
  computeReeving,
  outOfRangeCapacity,
  type CapacityResult,
  type ReevingResult,
} from "./capacity.js";
import { computeClearance, type ClearanceResult } from "./clearance.js";
import {
  computeOutrigger,
  parseOutriggerConfig,
  type OutriggerResult,
} from "./outrigger.js";
import { computeCollisions, type CollisionReport } from "./collision.js";
import { computeJibClearance, type JibClearance } from "./jib.js";

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
  /** Jib modu klerensi (YAKLAŞIK — jib mafsal geometrisi tahmini). Ana bom modunda yok. */
  jib_clearance?: JibClearance;
  /** Yük rüzgâr alanına göre izinli rüzgâr hızı (load_wind_area_m2 verilirse). */
  wind?: WindResult;
  /** Çarpışma raporu (ana engel/yük + çevre nesneleri; jib modunda jib dahil). */
  collision: CollisionReport;
  /** Halat donanımı (reeving) kontrolü — crane.single_line_pull_t tanımlıysa hesaplanır. */
  reeving?: ReevingResult;
}

function isJib(jib?: JibParams): jib is JibParams {
  return !!jib && jib.config !== "T";
}

/** (A) + (B): bir vinç modeli ve girdiler için tam kaldırma hesabı. */
export function computeLift(
  crane: CraneModel,
  inp: LiftInputs,
  jib?: JibParams,
  /** true: tablo dışı radius / erişilemez geometri HATA FIRLATMAZ — sonuç
   * "kaldırma yapılamaz" olarak işaretlenir, çizim sürer (arayüz için). */
  lenient = false,
): LiftResult {
  const total = inp.load_weight + inp.hook_weight + inp.rigging_weight;
  const cap = (f: () => CapacityResult): CapacityResult => {
    if (!lenient) return f();
    try {
      return f();
    } catch (e) {
      return outOfRangeCapacity(total, e instanceof Error ? e.message : String(e));
    }
  };
  if (isJib(jib)) {
    // Jib tabloları belirli bir denge ağırlığı için geçerlidir (ör. SANY 80t).
    // Farklı denge ağırlığıyla bu tabloyu kullanmak kapasiteyi yanlış gösterir.
    const reqCw = crane.jib_configs?.counterweight_required;
    const capacity = cap(() => {
      if (reqCw != null && Math.abs(inp.counterweight - reqCw) > 1e-9) {
        throw new Error(
          `Jib modunda denge ağırlığı ${reqCw}t olmalıdır (seçili: ${inp.counterweight}t). ` +
            `Jib yük tabloları yalnızca ${reqCw}t denge ağırlığı için geçerlidir.`,
        );
      }
      return computeJibCapacity(crane, {
      load_weight: inp.load_weight,
      hook_weight: inp.hook_weight,
      rigging_weight: inp.rigging_weight,
      config: jib.config,
      jib_length: jib.jib_length,
      boom_length: inp.boom_length,
      jib_offset: jib.jib_offset,
      radius: inp.radius,
    });
    });
    // Jib modunda klerens/2B-3B geometrisi modellenmez.
    return { capacity, clearance: null, lift_config: jib.config, jib };
  }
  const capacity = cap(() =>
    computeCapacity(crane, {
      load_weight: inp.load_weight,
      hook_weight: inp.hook_weight,
      rigging_weight: inp.rigging_weight,
      counterweight: inp.counterweight,
      capacity_pct: inp.capacity_pct,
      boom_length: inp.boom_length,
      radius: inp.radius,
    }),
  );
  const clrInputs = (radius: number, withObstacle = true) => ({
    boom_length: inp.boom_length,
    radius,
    load_height: inp.load_height,
    load_diameter: inp.load_diameter,
    obstacle_height: inp.obstacle_height,
    obstacle_distance: inp.obstacle_distance,
    obstacle_width: inp.obstacle_width,
    model: inp.clearance_model,
    load_bottom_height: inp.load_bottom_height,
    ...(withObstacle ? {} : { obstacle_height: 0, obstacle_distance: 0, obstacle_width: 0 }),
  });
  if (!lenient) {
    return { capacity, clearance: computeClearance(crane.geometry_constants, clrInputs(inp.radius)), lift_config: "T" };
  }
  // Esnek: erişilemeyen radius'ta geometri maksimum erişime kırpılır; engel/yük
  // formül alanı dışındaysa engelsiz tekrar denenir — çizim her durumda sürer.
  const g = crane.geometry_constants;
  const z = inp.boom_length / Math.cos(Math.atan(g.sheave_offset / inp.boom_length));
  const maxReach = z - g.boom_offset - 0.01;
  const r = Math.min(inp.radius, maxReach);
  let clearance: ClearanceResult | null = null;
  try {
    clearance = computeClearance(g, clrInputs(r));
  } catch (e) {
    try {
      clearance = computeClearance(g, clrInputs(r, false));
      clearance.warning = e instanceof Error ? e.message : String(e);
    } catch {
      clearance = null;
    }
  }
  if (clearance && r < inp.radius) {
    clearance.radius_clamped_to = r;
    clearance.warning =
      `Radius ${inp.radius} m bu bom uzunluğuyla (${inp.boom_length} m) geometrik olarak erişilemez ` +
      `(maks ≈ ${maxReach.toFixed(1)} m); çizim maksimum erişimde gösteriliyor.`;
  }
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
    /** İzin verilen zemin taşıma basıncı (t/m²) — verilirse bearing_ok/required_pad_area_m2 hesaplanır. */
    allowable_bearing_t_m2?: number;
    /** Şasinin sahadaki yönü (°): şasi +X (arka) ekseninin plan açısı. Çevre
     * nesneleri plan çerçevesinde olduğundan çarpışmada bom plan açısı =
     * crane_heading + slew_angle. Ayak reaksiyonu şasiye göredir (etkilenmez). */
    crane_heading?: number;
    /** Vincin (slew merkezinin) saha plan konumu (m). Çevre nesneleri saha
     * koordinatındadır; çarpışmada vinç konumu çıkarılır. Varsayılan (0,0). */
    crane_position?: { x: number; z: number };
    /** true: tablo dışı / erişilemez konfigürasyonda HATA FIRLATMA — sonuç
     * "kaldırma yapılamaz" (capacity.out_of_range) ile döner. Arayüz kullanır;
     * sihirbaz/harita/güzergâh gibi tarayıcılar katı modu (hata) kullanır. */
    lenient?: boolean;
  },
): FullLiftResult {
  const base = computeLift(crane, inp, opts.jib, opts.lenient ?? false);
  let outrigger: OutriggerResult | null = null;
  let outrigger_error: string | undefined;
  try {
    if (crane.self_weight == null) {
      throw new Error("Vinç self_weight tanımlı değil (datasheet'ten doldurulmalı).");
    }
    const { Lx, Ly } = parseOutriggerConfig(opts.outrigger_config);
    // Asimetrik ayaklar: arka = f·Lx, ön = (1−f)·Lx (slew merkezine göre).
    // Dikdörtgen merkezi c = (arka − ön)/2; yükler dikdörtgen merkezine göre
    // alındığından tüm bileşke −c kadar kayar (base_offset_x).
    const f = crane.dimensions?.outrigger_rear_fraction ?? 0.5;
    const rect_center_x = (Lx * f - Lx * (1 - f)) / 2;

    // Bom CoG'sinin slew merkezine yatay uzaklığı (slew-yerel +X, yükle aynı yön).
    // Ana bom modunda klerensten gama (bom yükselme açısı) bilinir:
    //   r_boom = -boom_offset + boom_cog_ratio·boom_length·cos(gama)
    // (bom mafsalı slew merkezinin boom_offset kadar gerisinde; CoG bu noktadan
    // bom ekseni boyunca boom_cog_ratio oranında ileridedir — yaklaşık, alfa
    // ihmal edilir). Jib modunda gama hesaplanmaz (klerens jib geometrisini
    // modellemez); muhafazakâr yaklaşım: bom+jib bileşke CoG'sinin yükün yarısı
    // mesafesinde olduğu kabul edilir (r_boom = radius·boom_cog_ratio).
    let boom_cog_offset: number | undefined;
    if (crane.boom_cog_ratio != null) {
      boom_cog_offset = base.clearance
        ? -crane.geometry_constants.boom_offset +
          crane.boom_cog_ratio * inp.boom_length * Math.cos(base.clearance.gama)
        : inp.radius * crane.boom_cog_ratio;
    }

    outrigger = computeOutrigger(
      {
        crane_self_weight: crane.self_weight,
        counterweight: inp.counterweight,
        total_load: base.capacity.total_load,
        radius: inp.radius,
        Lx,
        Ly,
        pad_area: opts.pad_area,
        boom_weight: crane.boom_weight_t,
        boom_cog_offset,
        counterweight_radius: crane.counterweight_radius_m,
        base_offset_x: -rect_center_x,
      },
      1,
      crane.max_outrigger_force_t,
    );
    outrigger.rect_center_x = rect_center_x;

    if (opts.allowable_bearing_t_m2 && opts.allowable_bearing_t_m2 > 0) {
      outrigger.required_pad_area_m2 = outrigger.max_corner_load / opts.allowable_bearing_t_m2;
      if (outrigger.pad_area != null) {
        outrigger.bearing_ok = outrigger.pad_area >= outrigger.required_pad_area_m2;
      }
    }
  } catch (e) {
    outrigger_error = e instanceof Error ? e.message : String(e);
  }

  // Jib modu: ana bom klerensi yok; jib geometrisi (YAKLAŞIK) ile klerens +
  // çarpışma hesaplanır.
  const jib_clearance =
    !base.clearance && base.jib
      ? computeJibClearance(crane.geometry_constants, {
          boom_length: inp.boom_length,
          jib_length: base.jib.jib_length,
          jib_offset: base.jib.jib_offset,
          radius: inp.radius,
          load_height: inp.load_height,
          load_diameter: inp.load_diameter,
          obstacle_height: inp.obstacle_height,
          obstacle_distance: inp.obstacle_distance,
          obstacle_width: inp.obstacle_width,
          load_bottom_height: inp.load_bottom_height,
        })
      : undefined;
  const main = base.clearance ?? jib_clearance;
  const collision = main
    ? computeCollisions(
        {
          g: crane.geometry_constants,
          boom_length: inp.boom_length,
          radius: inp.radius,
          gama: base.clearance ? base.clearance.gama : jib_clearance!.geometry.boomAngle,
          jib_points: jib_clearance
            ? { boomTip: jib_clearance.geometry.boomTip, jibTip: jib_clearance.geometry.jibTip }
            : undefined,
          rigging_height: inp.rigging_height,
          load_bottom: main.load_bottom_height,
          slew_angle: opts.slew_angle + (opts.crane_heading ?? 0),
          load_height: inp.load_height,
          load_diameter: inp.load_diameter,
          load_center_x: main.load_center_x,
          hook_height: crane.geometry_constants.hook_height,
          objects: toCraneFrame(opts.objects ?? [], opts.crane_position),
          // dimensions yoksa (ör. eksik broşür verisi) kuyruk savrulma kontrolü
          // atlanır — computeCollisions bu alanlar undefined ise item üretmez.
          tail_radius_m: crane.dimensions?.tail_radius_m,
          superstructure_height_m: superstructureHeightOnOutriggers(crane),
        },
        main,
      )
    : EMPTY_COLLISION;

  const reeving =
    crane.single_line_pull_t != null
      ? computeReeving(crane.single_line_pull_t, base.capacity.total_load)
      : undefined;

  const wind =
    inp.load_wind_area_m2 != null && inp.load_wind_area_m2 > 0
      ? computeWindLimit(
          crane.max_wind_speed_ms ?? null,
          base.capacity.total_load,
          inp.load_wind_area_m2,
          inp.load_drag_coefficient,
        )
      : undefined;

  return { ...base, outrigger, outrigger_error, collision, reeving, jib_clearance, wind };
}

/** Saha koordinatındaki nesneleri vinç (slew merkezi) çerçevesine taşır. */
function toCraneFrame(objects: SceneObject[], pos?: { x: number; z: number }): SceneObject[] {
  if (!pos || (pos.x === 0 && pos.z === 0)) return objects;
  return objects.map((o) => ({ ...o, x: o.x - pos.x, z: o.z - pos.z }));
}

export interface WindResult {
  /** Yük tablosunun varsaydığı rüzgâr hızı (m/s) — null ise vinç verisinde yok. */
  chart_wind_ms: number | null;
  /** Bu yük için izinli rüzgâr hızı (m/s). chart_wind_ms null ise null. */
  allowed_wind_ms: number | null;
  /** Yükün rüzgâr yüzeyi A_p·c_w (m²). */
  wind_area_m2: number;
  /** Tablonun varsaydığı yüzey: 1,2 m²/t · m_H (m²). */
  reference_area_m2: number;
  /** Yük yüzeyi referansı aşıyor → rüzgâr limiti düşer. */
  reduced: boolean;
}

/**
 * EN 13000 / Liebherr yaklaşımı: yük tabloları yük başına 1,2 m²/t rüzgâr
 * yüzeyi (A_p·c_w) varsayar. Gerçek yüzey büyükse izinli rüzgâr hızı
 *   v_izin = v_tablo · √(1,2 · m_H / (A_p · c_w))
 * ile düşer; küçükse tablo değeri geçerlidir (artırılmaz). m_H = kanca yükü (t).
 */
export function computeWindLimit(
  chart_wind_ms: number | null,
  hoist_load_t: number,
  area_m2: number,
  drag = 1.2,
): WindResult {
  const cw = drag > 0 ? drag : 1.2;
  const wind_area_m2 = area_m2 * cw;
  const reference_area_m2 = 1.2 * hoist_load_t;
  const reduced = wind_area_m2 > reference_area_m2;
  const allowed_wind_ms =
    chart_wind_ms == null
      ? null
      : reduced
        ? chart_wind_ms * Math.sqrt(reference_area_m2 / wind_area_m2)
        : chart_wind_ms;
  return { chart_wind_ms, allowed_wind_ms, wind_area_m2, reference_area_m2, reduced };
}

/**
 * Ayaklar açıkken üst yapı güverte yüksekliği (m). Broşür değeri seyir
 * hâlindedir; ayaklarda makine, mafsal yüksekliği farkı kadar (takoz + ayak
 * stroku) kalkar: lift = (cribbing + machine_ground) − seyir mafsal yüksekliği.
 * dimensions yoksa undefined → kuyruk kontrolü atlanır.
 */
export function superstructureHeightOnOutriggers(crane: CraneModel): number | undefined {
  const d = crane.dimensions;
  if (!d || d.superstructure_deck_height_m == null) return undefined;
  const g = crane.geometry_constants;
  const lift = Math.max(0, g.cribbing_height + g.machine_ground_height - d.boom_pivot_height_m);
  return d.superstructure_deck_height_m + lift;
}

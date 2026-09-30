// TANDEM (İKİ VİNÇLİ) KALDIRMA — tek yük iki kancada.
// Statik paylaşım: yük ağırlık merkezi (CoG) kanca1→kanca2 doğrusu üzerinde
// cog_ratio konumunda → pay1 = W·(1−cog_ratio), pay2 = W·cog_ratio
// (W = yük + kaldırma aparatları). Her vinç kendi kanca bloğunu da taşır.
// Kontrol: pay_i + kanca_i ≤ derate_pct% × tablo kapasitesi_i (kendi radüsünde).
// Senkron hareket, eğik çekme ve dinamik etkiler MODELLENMEZ.

import type { CraneModel, LiftInputs, SceneObject } from "./types.js";
import { computeLiftFull, type FullLiftResult } from "./index.js";

export interface TandemInput {
  load_weight: number;
  rigging_weight: number;
  cog_ratio: number;
  derate_pct: number;
  crane1: {
    crane: CraneModel;
    inputs: LiftInputs;
    outrigger_config: string;
    slew_angle: number;
    heading: number;
    position: { x: number; z: number };
    hook_weight: number;
  };
  crane2: {
    crane: CraneModel;
    counterweight: number;
    capacity_pct: number;
    boom_length: number;
    outrigger_config: string;
    heading: number;
    position: { x: number; z: number };
    hook_site: { x: number; z: number };
    hook_weight: number;
  };
  objects: SceneObject[];
}

export interface TandemCraneResult {
  /** Bu vince düşen yük payı (yük + aparat payı, kanca hariç) (t). */
  share_t: number;
  /** Kancadaki toplam: pay + kanca bloğu (t). */
  total_on_hook_t: number;
  /** Tablo kapasitesi (t) — tablo dışıysa null. */
  rated_t: number | null;
  /** İzinli = derate_pct% × tablo kapasitesi (t). */
  allowed_t: number | null;
  /** total_on_hook / allowed (%). */
  utilization_pct: number | null;
  radius: number;
  slew: number;
  gama: number | null;
  ok: boolean;
  message: string;
  full: FullLiftResult | null;
}

export interface TandemResult {
  crane1: TandemCraneResult;
  crane2: TandemCraneResult;
  /** İki kanca arasındaki plan mesafesi (m). */
  hook_distance_m: number;
  ok: boolean;
  summary: string;
}

const DEG = Math.PI / 180;

function norm360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Vinç konumu/yönü + dönme açısı + radüsten kancanın saha plan noktası.
 * Bom plan açısı = heading + slew; plan açısı θ → (cos θ, sin θ). */
export function hookSiteFromCrane(
  position: { x: number; z: number },
  heading: number,
  slew: number,
  radius: number,
): { x: number; z: number } {
  const a = (heading + slew) * DEG;
  return { x: position.x + radius * Math.cos(a), z: position.z + radius * Math.sin(a) };
}

/** Vinç konumundan hedef plan noktasına radüs ve (şasiye göre) dönme açısı [0,360). */
export function radiusSlewToward(
  position: { x: number; z: number },
  heading: number,
  target: { x: number; z: number },
): { radius: number; slew: number } {
  const dx = target.x - position.x;
  const dz = target.z - position.z;
  const radius = Math.hypot(dx, dz);
  const plan = radius < 1e-9 ? heading : Math.atan2(dz, dx) / DEG;
  return { radius, slew: norm360(plan - heading) };
}

const fmt = (n: number) => n.toFixed(1).replace(".", ",");

function evalCrane(
  label: string,
  crane: CraneModel,
  inp: LiftInputs,
  share: number,
  derate: number,
  opts: {
    outrigger_config: string;
    slew_angle: number;
    heading: number;
    position: { x: number; z: number };
    objects: SceneObject[];
  },
): TandemCraneResult {
  const total = share + inp.hook_weight;
  const base = {
    share_t: share,
    total_on_hook_t: total,
    radius: inp.radius,
    slew: opts.slew_angle,
  };
  let full: FullLiftResult;
  try {
    full = computeLiftFull(crane, inp, {
      outrigger_config: opts.outrigger_config,
      slew_angle: opts.slew_angle,
      crane_heading: opts.heading,
      crane_position: opts.position,
      objects: opts.objects,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ...base,
      rated_t: null,
      allowed_t: null,
      utilization_pct: null,
      gama: null,
      ok: false,
      message: `${label}: hesaplanamadı — ${err}`,
      full: null,
    };
  }
  const rated = full.capacity.rated_capacity;
  const allowed = rated * (derate / 100);
  const util = allowed > 0 ? (total / allowed) * 100 : Infinity;
  const problems: string[] = [];
  if (util > 100) {
    problems.push(
      `kapasite aşımı (${fmt(total)} t > izinli ${fmt(allowed)} t = %${derate} × ${fmt(rated)} t)`,
    );
  }
  if (full.collision.worst === "collision") problems.push("çarpışma var");
  if (full.outrigger?.tipping_risk) problems.push("devrilme riski");
  const ok = problems.length === 0;
  return {
    ...base,
    rated_t: rated,
    allowed_t: allowed,
    utilization_pct: util,
    gama: full.clearance ? full.clearance.gama : null,
    ok,
    message: ok
      ? `${label}: uygun (%${util.toFixed(0)} kullanım, ${fmt(total)} / ${fmt(allowed)} t)`
      : `${label}: ${problems.join(", ")}`,
    full,
  };
}

/** Tandem kaldırma hesabı — iki vinç için yük paylaşımı + tam kontroller. */
export function computeTandem(t: TandemInput): TandemResult {
  const c = Math.min(1, Math.max(0, t.cog_ratio));
  const derate = t.derate_pct > 0 ? t.derate_pct : 100;
  const W = t.load_weight + t.rigging_weight;
  const share1 = W * (1 - c);
  const share2 = W * c;

  // Vinç 1 — mevcut plan girdileri, yük = pay1 (aparat payın içinde).
  const c1 = t.crane1;
  const inp1: LiftInputs = {
    ...c1.inputs,
    load_weight: share1,
    rigging_weight: 0,
    hook_weight: c1.hook_weight,
  };
  const r1 = evalCrane("Vinç 1", c1.crane, inp1, share1, derate, {
    outrigger_config: c1.outrigger_config,
    slew_angle: c1.slew_angle,
    heading: c1.heading,
    position: c1.position,
    objects: t.objects,
  });

  // Vinç 2 — konumundan kanca noktasına radüs/dönme.
  const c2 = t.crane2;
  const rs = radiusSlewToward(c2.position, c2.heading, c2.hook_site);
  const inp2: LiftInputs = {
    ...c1.inputs,
    load_weight: share2,
    rigging_weight: 0,
    hook_weight: c2.hook_weight,
    counterweight: c2.counterweight,
    capacity_pct: c2.capacity_pct,
    boom_length: c2.boom_length,
    radius: rs.radius,
  };
  const r2 = evalCrane("Vinç 2", c2.crane, inp2, share2, derate, {
    outrigger_config: c2.outrigger_config,
    slew_angle: rs.slew,
    heading: c2.heading,
    position: c2.position,
    objects: t.objects,
  });

  const hook1 = hookSiteFromCrane(c1.position, c1.heading, c1.slew_angle, c1.inputs.radius);
  const hook_distance_m = Math.hypot(c2.hook_site.x - hook1.x, c2.hook_site.z - hook1.z);
  const ok = r1.ok && r2.ok;
  const summary = ok
    ? `Tandem kaldırma UYGUN — kanca aralığı ${fmt(hook_distance_m)} m.`
    : `Tandem kaldırma UYGUN DEĞİL — ${[r1, r2].filter((r) => !r.ok).map((r) => r.message).join("; ")}`;
  return { crane1: r1, crane2: r2, hook_distance_m, ok, summary };
}

/**
 * Vinç 2 kanca noktası (TandemState'te ayrı alan yoksa): ana kancadan vinç 2
 * konumuna doğru hook_spacing (varsayılan 4 m) ileride. Vinç 2 ana kancanın
 * üzerindeyse +X yönünde alınır.
 */
export function tandemHookSite(
  mainHook: { x: number; z: number },
  crane2Pos: { x: number; z: number },
  hookSpacing = 4,
): { x: number; z: number } {
  const dx = crane2Pos.x - mainHook.x;
  const dz = crane2Pos.z - mainHook.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9) return { x: mainHook.x + hookSpacing, z: mainHook.z };
  const s = Math.min(hookSpacing, d);
  return { x: mainHook.x + (dx / d) * s, z: mainHook.z + (dz / d) * s };
}

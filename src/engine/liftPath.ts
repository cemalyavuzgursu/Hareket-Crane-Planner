// Kaldırma güzergâhı (lift path) planlama + simülasyon.
//
// Tipik vinç operasyonu üç fazda modellenir:
//   1) hoist — alma noktasında düşey kaldırma (pick.h → seyir yüksekliği)
//   2) slew  — seyir yüksekliğinde eşzamanlı dönme + radius değişimi (luff/tele)
//   3) lower — bırakma noktasında düşey indirme (seyir yüksekliği → place.h)
// Her poz için computeLiftFull çağrılır; kapasite, çarpışma ve erişim kontrol edilir.

import type { CraneModel, LiftInputs, SceneObject } from "./types.js";
import { computeLiftFull, type JibParams } from "./index.js";

/** Saha plan noktası: x,z saha koordinatı (m), h = yük ALT yüzü yüksekliği (m). */
export interface LiftSitePoint {
  x: number;
  z: number;
  h: number;
}

export type LiftPhase = "hoist" | "slew" | "lower";

export interface LiftPose {
  /** Normalize zaman 0..1 (sabit hızla kat edilen yol uzunluğuna göre). */
  t: number;
  /** Şasiye göre dönme açısı (°, 0..360). */
  slew: number;
  radius: number;
  load_bottom_height: number;
  phase: LiftPhase;
  /** Kanca/yük merkezinin saha plan konumu. */
  site: { x: number; z: number };
}

export type PoseStatus = "ok" | "warning" | "collision" | "over" | "unreachable";

export interface PoseCheck {
  pose: LiftPose;
  utilization_pct: number | null;
  /** Yük/kanca/halat ile en yakın engel arasındaki en küçük klerens (m). */
  clearance_to_load: number | null;
  worst: PoseStatus;
  message?: string;
}

export interface LiftPathResult {
  poses: PoseCheck[];
  /** En kritik pozun indeksi (−1: poz yok). */
  critical_index: number;
  max_utilization: number | null;
  /** Hiçbir pozda çarpışma / kapasite aşımı / erişilemezlik yoksa true. */
  feasible: boolean;
  summary: string;
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Saha noktasının vince göre radius ve dönme açısı. */
export function siteToSlewRadius(
  p: { x: number; z: number },
  crane: { x: number; z: number; heading: number },
): { radius: number; slew: number } {
  const dx = p.x - crane.x;
  const dz = p.z - crane.z;
  const radius = Math.hypot(dx, dz);
  const plan = (Math.atan2(dz, dx) * 180) / Math.PI;
  return { radius, slew: norm360(plan - crane.heading) };
}

/** Dönme + radius → saha plan noktası. */
export function slewRadiusToSite(
  slew: number,
  radius: number,
  crane: { x: number; z: number; heading: number },
): { x: number; z: number } {
  const a = ((crane.heading + slew) * Math.PI) / 180;
  return { x: crane.x + radius * Math.cos(a), z: crane.z + radius * Math.sin(a) };
}

/**
 * Alma → bırakma güzergâhını pozlara böler.
 * samples: toplam poz sayısı (varsayılan 90, 60..120 arası önerilir).
 * shortestSlew: true (varsayılan) → kısa yönden döner; false → uzun yönden.
 */
export function planLiftPath(
  pick: LiftSitePoint,
  place: LiftSitePoint,
  travelHeight: number,
  crane: { x: number; z: number; heading: number },
  opts?: { samples?: number; shortestSlew?: boolean },
): LiftPose[] {
  const N = Math.max(6, Math.round(opts?.samples ?? 90));
  const shortest = opts?.shortestSlew ?? true;
  const H = Math.max(travelHeight, pick.h, place.h);

  const a = siteToSlewRadius(pick, crane);
  const b = siteToSlewRadius(place, crane);
  let dSlew = ((b.slew - a.slew + 540) % 360) - 180; // −180..180 (kısa yön)
  if (!shortest && Math.abs(dSlew) > 1e-9) dSlew = dSlew > 0 ? dSlew - 360 : dSlew + 360;
  const dR = b.radius - a.radius;

  // Faz uzunlukları (m) — örnek dağılımı ve zaman ölçeği için.
  const len1 = H - pick.h;
  const avgR = (a.radius + b.radius) / 2;
  const len2 = Math.hypot((Math.abs(dSlew) * Math.PI * avgR) / 180, dR);
  const len3 = H - place.h;
  const total = len1 + len2 + len3;

  // Her faza en az 2 aralık (uzunluğu > 0 ise), kalanı uzunlukla orantılı.
  const segs = N - 1;
  const lens = [len1, len2, len3];
  const counts: number[] = lens.map((l) => (l > 1e-9 ? 2 : 0));
  let remaining = segs - counts.reduce((s, c) => s + c, 0);
  if (total > 1e-9 && remaining > 0) {
    const extra = lens.map((l) => Math.floor((l / total) * remaining));
    extra.forEach((e, i) => (counts[i] += lens[i] > 1e-9 ? e : 0));
    remaining = segs - counts.reduce((s, c) => s + c, 0);
    // Yuvarlama artığı en uzun faza.
    const iMax = lens.indexOf(Math.max(...lens));
    counts[iMax] += Math.max(0, remaining);
  }

  const poses: LiftPose[] = [];
  let dist = 0;
  const push = (slew: number, radius: number, h: number, phase: LiftPhase) => {
    const sn = norm360(slew);
    poses.push({
      t: total > 1e-9 ? Math.min(1, dist / total) : 0,
      slew: sn,
      radius,
      load_bottom_height: h,
      phase,
      site: slewRadiusToSite(sn, radius, crane),
    });
  };

  // Faz 1: hoist
  push(a.slew, a.radius, pick.h, "hoist");
  for (let i = 1; i <= counts[0]; i++) {
    dist = (len1 * i) / counts[0];
    push(a.slew, a.radius, pick.h + ((H - pick.h) * i) / counts[0], "hoist");
  }
  // Faz 2: slew + luff
  for (let i = 1; i <= counts[1]; i++) {
    const f = i / counts[1];
    dist = len1 + len2 * f;
    push(a.slew + dSlew * f, a.radius + dR * f, H, "slew");
  }
  // Faz 3: lower
  for (let i = 1; i <= counts[2]; i++) {
    const f = i / counts[2];
    dist = len1 + len2 + len3 * f;
    push(b.slew, b.radius, H + (place.h - H) * f, "lower");
  }
  // Uç nokta kesinliği
  const last = poses[poses.length - 1];
  last.slew = b.slew;
  last.radius = b.radius;
  last.load_bottom_height = place.h;
  last.site = slewRadiusToSite(b.slew, b.radius, crane);
  if (total > 1e-9) last.t = 1;
  return poses;
}

const RANK: Record<PoseStatus, number> = { ok: 0, warning: 1, over: 3, collision: 3, unreachable: 4 };

/**
 * Her pozu tam kaldırma hesabıyla kontrol eder.
 * Not: 2B "ana engel" (obstacle_*) plan konumu olmadığından güzergâhta
 * uygulanmaz (nötrlenir); engeller 3B sahne nesneleriyle (objects) kontrol
 * edilir. Klerens modeli "centered" zorlanır (yük alt yüksekliği için gerekli).
 */
export function simulateLiftPath(
  craneModel: CraneModel,
  inputs: LiftInputs,
  cfg: {
    outrigger_config: string;
    crane_heading: number;
    crane_position: { x: number; z: number };
    objects: SceneObject[];
    jib?: JibParams;
  },
  poses: LiftPose[],
): LiftPathResult {
  const checks: PoseCheck[] = poses.map((pose) => {
    const inp: LiftInputs = {
      ...inputs,
      radius: pose.radius,
      load_bottom_height: pose.load_bottom_height,
      obstacle_height: 0,
      obstacle_distance: 0,
      obstacle_width: 0,
      clearance_model: "centered",
    };
    try {
      const r = computeLiftFull(craneModel, inp, {
        outrigger_config: cfg.outrigger_config,
        slew_angle: pose.slew,
        crane_heading: cfg.crane_heading,
        crane_position: cfg.crane_position,
        objects: cfg.objects,
        jib: cfg.jib,
      });
      const util = r.capacity.utilization_pct;
      const loadItems = r.collision.items.filter(
        (i) => i.source === "load" || i.source === "hook" || i.source === "rope",
      );
      const clr = loadItems.length ? Math.min(...loadItems.map((i) => i.clearance_m)) : null;
      const colWorst = r.collision.worst;
      const over = util > 100;
      let worst: PoseStatus = "ok";
      const msgs: string[] = [];
      if (colWorst === "collision") {
        worst = "collision";
      } else if (over) {
        worst = "over";
      } else if (colWorst === "warning" || r.capacity.severity === "warning") {
        worst = "warning";
      }
      if (over) msgs.push(`Kapasite aşımı (%${util.toFixed(0)})`);
      for (const it of r.collision.active) if (it.severity === "collision") msgs.push(it.message);
      if (!msgs.length) for (const it of r.collision.active) msgs.push(it.message);
      return {
        pose,
        utilization_pct: util,
        clearance_to_load: clr,
        worst,
        message: msgs.length ? msgs.slice(0, 3).join("; ") : undefined,
      };
    } catch (e) {
      return {
        pose,
        utilization_pct: null,
        clearance_to_load: null,
        worst: "unreachable" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  let critical_index = -1;
  checks.forEach((c, i) => {
    if (critical_index < 0) {
      critical_index = i;
      return;
    }
    const cur = checks[critical_index];
    const rc = RANK[c.worst];
    const rk = RANK[cur.worst];
    if (rc > rk || (rc === rk && (c.utilization_pct ?? -1) > (cur.utilization_pct ?? -1))) {
      critical_index = i;
    }
  });

  const utils = checks.map((c) => c.utilization_pct).filter((u): u is number => u != null);
  const max_utilization = utils.length ? Math.max(...utils) : null;
  const bad = checks.filter((c) => c.worst === "collision" || c.worst === "over" || c.worst === "unreachable");
  const feasible = checks.length > 0 && bad.length === 0;

  let summary = "Güzergâh pozu yok.";
  if (critical_index >= 0) {
    const c = checks[critical_index];
    const p = c.pose;
    const moment =
      `En kritik an: %${(p.t * 100).toFixed(0)} — dönme ${p.slew.toFixed(0)}°, ` +
      `radius ${p.radius.toFixed(1)} m, yük alt ${p.load_bottom_height.toFixed(1)} m` +
      (c.utilization_pct != null ? `, kullanım %${c.utilization_pct.toFixed(0)}` : "");
    const head = feasible
      ? "Güzergâh uygun."
      : `Güzergâh UYGUN DEĞİL (${bad.length}/${checks.length} pozda sorun).`;
    summary = `${head} ${moment}${!feasible && c.message ? ` — ${c.message}` : ""}`;
  }

  return { poses: checks, critical_index, max_utilization, feasible, summary };
}

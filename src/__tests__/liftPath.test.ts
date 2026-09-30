import { describe, it, expect } from "vitest";
import { CRANES } from "../data/cranes";
import { planLiftPath, simulateLiftPath, siteToSlewRadius } from "../engine/liftPath.js";
import type { LiftInputs, SceneObject } from "../engine/types.js";

const sany = CRANES.find((c) => c.model === "SANY SAC2500E")!;
const inp: LiftInputs = {
  load_weight: 20, hook_weight: 1, rigging_weight: 0.3, load_height: 2, load_diameter: 2,
  obstacle_height: 0, obstacle_distance: 0, boom_length: 32.5, radius: 14, counterweight: 80, capacity_pct: 100,
};
const crane = { x: 5, z: -3, heading: 30 };
// Alma: slew 0 / r 14 ; bırakma: slew 90 / r 14 (vinç merkezine göre)
const at = (slew: number, r: number, h: number) => {
  const a = ((crane.heading + slew) * Math.PI) / 180;
  return { x: crane.x + r * Math.cos(a), z: crane.z + r * Math.sin(a), h };
};
const pick = at(0, 14, 0);
const place = at(90, 14, 0);
const cfg = (objects: SceneObject[]) => ({
  outrigger_config: "9x7,8", crane_heading: crane.heading, crane_position: { x: crane.x, z: crane.z }, objects,
});
const mid = at(45, 14, 0);
const building: SceneObject = { id: "b", kind: "building", label: "Bina", x: mid.x, z: mid.z, width: 3, depth: 3, height: 8 };

describe("planLiftPath", () => {
  const poses = planLiftPath(pick, place, 10, crane, { samples: 90 });

  it("uç noktalar alma/bırakma ile eşleşir", () => {
    expect(poses.length).toBe(90);
    const p0 = poses[0], pn = poses[poses.length - 1];
    expect(p0.t).toBe(0);
    expect(pn.t).toBe(1);
    expect(p0.radius).toBeCloseTo(14, 6);
    expect(p0.slew).toBeCloseTo(0, 6);
    expect(p0.load_bottom_height).toBe(0);
    expect(pn.radius).toBeCloseTo(14, 6);
    expect(pn.slew).toBeCloseTo(90, 6);
    expect(pn.site.x).toBeCloseTo(place.x, 6);
    expect(pn.site.z).toBeCloseTo(place.z, 6);
    for (let i = 1; i < poses.length; i++) expect(poses[i].t).toBeGreaterThanOrEqual(poses[i - 1].t);
  });

  it("hoist fazı düşeydir", () => {
    const hoist = poses.filter((p) => p.phase === "hoist");
    expect(hoist.length).toBeGreaterThan(1);
    for (const p of hoist) {
      expect(p.radius).toBeCloseTo(14, 6);
      expect(p.slew).toBeCloseTo(0, 6);
      expect(p.site.x).toBeCloseTo(pick.x, 6);
    }
    expect(hoist[hoist.length - 1].load_bottom_height).toBeCloseTo(10, 6);
    expect(poses.filter((p) => p.phase === "slew").every((p) => p.load_bottom_height === 10)).toBe(true);
  });

  it("dönme kısa yönden yapılır", () => {
    const a = at(350, 12, 0);
    const b = at(20, 12, 0);
    expect(siteToSlewRadius(a, crane).slew).toBeCloseTo(350, 6);
    const ps = planLiftPath(a, b, 5, crane);
    const slews = ps.filter((p) => p.phase === "slew").map((p) => p.slew);
    // 350 → 360/0 → 20 ; asla 180 civarından geçmez
    expect(slews.every((s) => s >= 349.99 || s <= 20.01)).toBe(true);
    const long = planLiftPath(a, b, 5, crane, { shortestSlew: false });
    expect(long.some((p) => Math.abs(p.slew - 180) < 10)).toBe(true);
  });
});

describe("simulateLiftPath", () => {
  it("engel yok → uygun", () => {
    const r = simulateLiftPath(sany, inp, cfg([]), planLiftPath(pick, place, 4, crane));
    expect(r.feasible).toBe(true);
    expect(r.max_utilization).not.toBeNull();
  });

  it("seyir yüksekliğinden yüksek bina → ortada çarpışma; yükseltince temiz", () => {
    const low = simulateLiftPath(sany, inp, cfg([building]), planLiftPath(pick, place, 4, crane));
    expect(low.feasible).toBe(false);
    const crit = low.poses[low.critical_index];
    expect(crit.worst).toBe("collision");
    expect(crit.pose.phase).toBe("slew");
    const colSlews = low.poses.filter((c) => c.worst === "collision").map((c) => c.pose.slew);
    expect(colSlews.some((s) => Math.abs(s - 45) < 5)).toBe(true);
    expect(low.summary).toContain("En kritik an");

    const high = simulateLiftPath(sany, inp, cfg([building]), planLiftPath(pick, place, 12, crane));
    expect(high.poses.some((c) => c.worst === "collision")).toBe(false);
    expect(high.feasible).toBe(true);
  });

  it("menzil dışı bırakma → erişilemez", () => {
    const far = at(90, 80, 0);
    const r = simulateLiftPath(sany, inp, cfg([]), planLiftPath(pick, far, 4, crane));
    expect(r.feasible).toBe(false);
    expect(r.poses[r.poses.length - 1].worst).toBe("unreachable");
    expect(r.poses[r.critical_index].worst).toBe("unreachable");
  });
});

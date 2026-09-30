import { describe, it, expect } from "vitest";
import { CRANES } from "../data/cranes";
import { computeTandem, hookSiteFromCrane, radiusSlewToward, type TandemInput } from "../engine/tandem.js";
import type { LiftInputs } from "../engine/types.js";

const sany = CRANES.find((c) => c.model === "SANY SAC2500E")!;
const inp: LiftInputs = {
  load_weight: 20, hook_weight: 1, rigging_weight: 0.3, load_height: 2, load_diameter: 2,
  obstacle_height: 0, obstacle_distance: 0, boom_length: 32.5, radius: 14, counterweight: 80, capacity_pct: 100,
};

function base(over: Partial<TandemInput> = {}): TandemInput {
  return {
    load_weight: 40,
    rigging_weight: 0,
    cog_ratio: 0.5,
    derate_pct: 75,
    crane1: {
      crane: sany, inputs: inp, outrigger_config: sany.outrigger_configs[0],
      slew_angle: 0, heading: 0, position: { x: 0, z: 0 }, hook_weight: 1,
    },
    crane2: {
      crane: sany, counterweight: 80, capacity_pct: 100, boom_length: 32.5,
      outrigger_config: sany.outrigger_configs[0], heading: 180,
      position: { x: 32, z: 0 }, hook_site: { x: 18, z: 0 }, hook_weight: 1,
    },
    objects: [],
    ...over,
  };
}

describe("tandem kaldırma", () => {
  it("simetrik CoG → 50/50 paylaşım", () => {
    const r = computeTandem(base());
    expect(r.crane1.share_t).toBeCloseTo(20);
    expect(r.crane2.share_t).toBeCloseTo(20);
    expect(r.crane1.total_on_hook_t).toBeCloseTo(21);
    expect(r.crane2.radius).toBeCloseTo(14);
    expect(r.crane2.slew).toBeCloseTo(0);
    expect(r.hook_distance_m).toBeCloseTo(4);
  });

  it("cog_ratio 0,25 → %75 / %25", () => {
    const r = computeTandem(base({ cog_ratio: 0.25, rigging_weight: 2 }));
    expect(r.crane1.share_t).toBeCloseTo(42 * 0.75);
    expect(r.crane2.share_t).toBeCloseTo(42 * 0.25);
  });

  it("düşürme katsayısı izinli yükü azaltır", () => {
    const a = computeTandem(base({ derate_pct: 100 }));
    const b = computeTandem(base({ derate_pct: 75 }));
    expect(a.crane1.rated_t).not.toBeNull();
    expect(b.crane1.allowed_t!).toBeCloseTo(a.crane1.rated_t! * 0.75);
    expect(b.crane1.utilization_pct!).toBeGreaterThan(a.crane1.utilization_pct!);
  });

  it("aşırı yük → uygun değil", () => {
    const r = computeTandem(base({ load_weight: 1000 }));
    expect(r.crane1.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("tablo dışı radüs → rated null, ok false", () => {
    const b = base();
    const r = computeTandem({ ...b, crane2: { ...b.crane2, hook_site: { x: -200, z: 0 } } });
    expect(r.crane2.rated_t).toBeNull();
    expect(r.crane2.ok).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.crane2.message).toMatch(/Vinç 2/);
  });

  it("hookSiteFromCrane ∘ radiusSlewToward gidiş-dönüş", () => {
    const pos = { x: 5, z: -3 };
    for (const [h, s, R] of [[0, 30, 12], [135, 250, 20], [-40, 359, 7.5]]) {
      const p = hookSiteFromCrane(pos, h, s, R);
      const rs = radiusSlewToward(pos, h, p);
      expect(rs.radius).toBeCloseTo(R);
      expect(rs.slew).toBeCloseTo(((s % 360) + 360) % 360);
      const q = hookSiteFromCrane(pos, h, rs.slew, rs.radius);
      expect(q.x).toBeCloseTo(p.x);
      expect(q.z).toBeCloseTo(p.z);
    }
  });
});

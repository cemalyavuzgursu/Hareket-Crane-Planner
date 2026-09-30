// Klerens geometri modelleri: "centered" (gerçek, varsayılan) ↔ "excel"
// (Autocrane.xls, golden). İkisi arasındaki ilişki matematiksel olarak sabit:
//   centered(yük çapı D)            ≡ excel(yük çapı D/2)
//   centered(engel mesafe d, gen. w) ≡ excel(engel mesafe d + w/2)
// Böylece gerçek model, Excel'in doğrulanmış formül yapısını aynen kullanır.

import { describe, it, expect } from "vitest";
import { computeClearance, type ClearanceInputs } from "../engine/clearance.js";
import { computeLift } from "../engine/index.js";
import { CRANES } from "../data/cranes";
import type { LiftInputs } from "../engine/types.js";

const base: ClearanceInputs = {
  boom_length: 16.5, radius: 9, load_height: 4.25, load_diameter: 6.32,
  obstacle_height: 2.3, obstacle_distance: 1.5, obstacle_width: 2.5,
};

describe.each(CRANES.map((c) => [c.model, c] as const))("%s — klerens modelleri", (_n, crane) => {
  const g = crane.geometry_constants;
  const boom = crane.boom_lengths[Math.min(2, crane.boom_lengths.length - 1)];
  const inp = { ...base, boom_length: boom };
  const cen = computeClearance(g, inp);
  const exHalf = computeClearance(g, {
    ...inp, load_diameter: inp.load_diameter / 2,
    obstacle_distance: inp.obstacle_distance + inp.obstacle_width! / 2, model: "excel",
  });
  const ex = computeClearance(g, { ...inp, model: "excel" });

  it("varsayılan model centered", () => expect(cen.model).toBe("centered"));

  it("centered(D) ≡ excel(D/2) — yük klerensi", () => {
    expect(cen.clearance_to_load).toBeCloseTo(exHalf.clearance_to_load, 12);
  });

  it("centered(d, w) ≡ excel(d + w/2) — engel klerensi", () => {
    expect(cen.clearance_to_obstacle).toBeCloseTo(exHalf.clearance_to_obstacle, 12);
  });

  it("kanca yükün ağırlık merkezinin üstünde; kritik köşe yarım çap geride", () => {
    expect(cen.load_center_x).toBeCloseTo(base.radius, 12);
    expect(cen.load_corner_x).toBeCloseTo(base.radius - base.load_diameter / 2, 12);
    expect(ex.load_corner_x).toBeCloseTo(base.radius - base.load_diameter, 12);
  });

  it("gerçek model Excel'den daha az muhafazakâr (yük boma yarım çap daha uzak)", () => {
    expect(cen.clearance_to_load).toBeGreaterThan(ex.clearance_to_load);
  });

  it("geometri (γ, maks kanca yüksekliği) modelden bağımsız", () => {
    expect(cen.gama).toBe(ex.gama);
    expect(cen.max_hook_height).toBe(ex.max_hook_height);
  });
});

describe("computeLift varsayılanı gerçek geometri", () => {
  it("LTM 1160 golden senaryosu: Excel çarpışma (−1.23 m) derken gerçek geometride geçer", () => {
    const crane = CRANES.find((c) => c.model === "LIEBHERR LTM 1160")!;
    const inp: LiftInputs = {
      load_weight: 96, hook_weight: 0.5, rigging_weight: 0.2, load_height: 4.25, load_diameter: 6.32,
      obstacle_height: 2.3, obstacle_distance: 0, boom_length: 14.1, radius: 4.5, counterweight: 24, capacity_pct: 85,
    };
    const excel = computeLift(crane, { ...inp, clearance_model: "excel" }).clearance!;
    const real = computeLift(crane, inp).clearance!;
    expect(excel.clearance_to_load).toBeCloseTo(-1.231318, 5);
    expect(real.model).toBe("centered");
    expect(real.clearance_to_load).toBeGreaterThan(0);
  });
});

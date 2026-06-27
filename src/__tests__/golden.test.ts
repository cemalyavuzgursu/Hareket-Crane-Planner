// GOLDEN TEST — PROJE.md §6. Çekirdeği Excel'in kendi çıktısına karşı doğrular.
// Tolerans ±0.01. Bu test geçmeden UI'a geçilmez.

import { describe, it, expect } from "vitest";
import ltm1250 from "../data/ltm1250.json" assert { type: "json" };
import { computeLift } from "../engine/index.js";
import type { CraneModel, LiftInputs } from "../engine/types.js";

const crane = ltm1250 as unknown as CraneModel;

// PROJE.md §6 girdileri
const inputs: LiftInputs = {
  load_weight: 105,
  hook_weight: 0.5,
  rigging_weight: 0.2,
  load_height: 4.25,
  load_diameter: 6.32,
  obstacle_height: 2.3,
  obstacle_distance: 0,
  boom_length: 16.5,
  radius: 9,
  counterweight: 40,
  capacity_pct: 85,
};

const TOL = 0.01;

describe("GOLDEN TEST — LIEBHERR LTM 1250 (Autocrane.xls 'LT 1250')", () => {
  const { capacity, clearance } = computeLift(crane, inputs);

  const cases: Array<[string, number, number]> = [
    ["total_load", capacity.total_load, 105.7],
    ["rated_capacity", capacity.rated_capacity, 101.0],
    ["utilization_pct", capacity.utilization_pct, 104.65],
    ["alfa (rad)", clearance.alfa, 0.0841],
    ["gama (rad)", clearance.gama, 0.73081],
    ["max_hook_height (m)", clearance.max_hook_height, 13.4104],
    ["max_sling_spread (m)", clearance.max_sling_spread, 6.8604],
    ["clearance_to_obstacle (m)", clearance.clearance_to_obstacle, 8.7339],
    ["clearance_to_load (m)", clearance.clearance_to_load, 1.2198],
  ];

  it.each(cases)("%s = %f (±0.01)", (_name, actual, expected) => {
    expect(actual).toBeCloseTo(expected, 2);
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
  });

  it("status = KAPASİTE AŞIMI", () => {
    expect(capacity.status).toBe("KAPASİTE AŞIMI");
  });
});

// İkinci golden — LIEBHERR LTM 1160 (Autocrane.xls 'LT 1160').
// sheave_offset=1.321 (1250'den farklı) ve NEGATİF yük klerensi içerir.
// Beklenen değerler Excel 'LT 1160' sayfasının kendi hücre çıktılarıdır.

import { describe, it, expect } from "vitest";
import ltm1160 from "../data/ltm1160.json" assert { type: "json" };
import { computeLift } from "../engine/index.js";
import type { CraneModel, LiftInputs } from "../engine/types.js";

const crane = ltm1160 as unknown as CraneModel;

const inputs: LiftInputs = {
  load_weight: 96,
  hook_weight: 0.5,
  rigging_weight: 0.2,
  load_height: 4.25,
  load_diameter: 6.32,
  obstacle_height: 2.3,
  obstacle_distance: 0,
  boom_length: 14.1,
  radius: 4.5,
  counterweight: 24,
  capacity_pct: 85,
};

describe("GOLDEN TEST 2 — LTM 1160", () => {
  const { capacity, clearance } = computeLift(crane, inputs);
  if (!clearance) throw new Error("T modunda klerens null olmamalı");

  const cases: Array<[string, number, number]> = [
    ["total_load", capacity.total_load, 96.7],
    ["rated_capacity", capacity.rated_capacity, 125.0],
    ["utilization_pct", capacity.utilization_pct, 77.36],
    ["alfa", clearance.alfa, 0.0934153],
    ["gama", clearance.gama, 0.9849582],
    ["max_hook_height", clearance.max_hook_height, 14.158260],
    ["max_sling_spread", clearance.max_sling_spread, 7.608260],
    ["clearance_to_obstacle", clearance.clearance_to_obstacle, 6.347042],
    ["clearance_to_load (NEGATİF)", clearance.clearance_to_load, -1.231318],
  ];

  it.each(cases)("%s ≈ %f", (_n, actual, expected) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01);
  });

  it("status = UYGUN (77% < 100)", () => {
    expect(capacity.status).toBe("UYGUN");
  });

  it("yük klerensi negatif → bom yüke çarpar (kırmızı uyarı durumu)", () => {
    expect(clearance.clearance_to_load).toBeLessThan(0);
  });
});

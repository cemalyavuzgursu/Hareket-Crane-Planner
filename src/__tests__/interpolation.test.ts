// Faz 2 — Load chart doğrusal interpolasyon testleri + sınır durumları.

import { describe, it, expect } from "vitest";
import {
  interpolateCapacity,
  loadChartLookup,
} from "../engine/capacity.js";
import ltm1250 from "../data/ltm1250.json" assert { type: "json" };
import type { ChartPoint, CraneModel } from "../engine/types.js";

const crane = ltm1250 as unknown as CraneModel;

describe("interpolateCapacity", () => {
  const curve: ChartPoint[] = [
    [3, 275],
    [4, 220],
    [5, 176],
    [9, 101],
    [10, 92],
  ];

  it("tam noktada birebir değer döner", () => {
    expect(interpolateCapacity(curve, 9)).toBe(101);
    expect(interpolateCapacity(curve, 3)).toBe(275);
  });

  it("iki nokta arasında doğrusal interpole eder", () => {
    // 4 ile 5 arası orta nokta: (220+176)/2 = 198
    expect(interpolateCapacity(curve, 4.5)).toBeCloseTo(198, 6);
    // 9 ile 10 arası %30: 101 + 0.3*(92-101) = 98.3
    expect(interpolateCapacity(curve, 9.3)).toBeCloseTo(98.3, 6);
  });

  it("sıralanmamış girişte de doğru çalışır", () => {
    const shuffled: ChartPoint[] = [
      [10, 92],
      [3, 275],
      [5, 176],
      [9, 101],
      [4, 220],
    ];
    expect(interpolateCapacity(shuffled, 4.5)).toBeCloseTo(198, 6);
  });

  it("aralık dışında hata verir (ekstrapolasyon yok)", () => {
    expect(() => interpolateCapacity(curve, 2)).toThrow();
    expect(() => interpolateCapacity(curve, 11)).toThrow();
  });
});

describe("loadChartLookup (LTM 1250, gerçek veri)", () => {
  it("radius=9, boom=16.5, cw=40, %85 → 101 (Excel)", () => {
    expect(loadChartLookup(crane, 40, 85, 16.5, 9)).toBe(101);
  });

  it("ara radius interpole edilir (8.5↔9: 105.5↔101)", () => {
    // radius 8.75 → 105.5 + 0.5*(101-105.5) = 103.25
    expect(loadChartLookup(crane, 40, 85, 16.5, 8.75)).toBeCloseTo(103.25, 4);
  });

  it("eksik tablo (yüzde) için anlamlı hata verir", () => {
    // 40t/55 boom için 75% tablosu yok
    expect(() => loadChartLookup(crane, 40, 75, 55.0, 10)).toThrow(/yüzde|eğri|tablo/i);
  });
});

// Faz 2 — Load chart "step-down" interpolasyon testleri + sınır durumları.
// Politika: ara yarıçapta BİR BÜYÜK yarıçapın kapasitesi döner (konveks eğride
// doğrusal interpolasyon fazla okur; step-down her zaman güvenli taraftadır).

import { describe, it, expect } from "vitest";
import {
  interpolateCapacity,
  loadChartLookup,
} from "../engine/capacity.js";
import ltm1250 from "../data/ltm1250.json" assert { type: "json" };
import type { ChartPoint, CraneModel } from "../engine/types.js";

const crane = ltm1250 as unknown as CraneModel;

describe("interpolateCapacity (step-down politikası)", () => {
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

  it("ara değerde bir büyük yarıçapın kapasitesini döner (step-down)", () => {
    // 4 ile 5 arası: bir büyük yarıçap 5 → kapasite 176
    expect(interpolateCapacity(curve, 4.5)).toBe(176);
    // 9 ile 10 arası: bir büyük yarıçap 10 → kapasite 92
    expect(interpolateCapacity(curve, 9.3)).toBe(92);
  });

  it("sıralanmamış girişte de doğru çalışır", () => {
    const shuffled: ChartPoint[] = [
      [10, 92],
      [3, 275],
      [5, 176],
      [9, 101],
      [4, 220],
    ];
    expect(interpolateCapacity(shuffled, 4.5)).toBe(176);
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

  it("ara radius için bir büyük yarıçapın kapasitesini döner (8.5↔9: step-down → 9'un kapasitesi 101)", () => {
    // Excel lineer interpole ediyordu (105.5 + 0.5*(101-105.5) = 103.25);
    // step-down bilinçli sapma: konveks eğride güvenli tarafta kalmak için
    // radius=8.75, bir büyük tablo noktası olan 9.0'ın kapasitesini (101) alır.
    expect(loadChartLookup(crane, 40, 85, 16.5, 8.75)).toBe(101);
  });

  it("eksik tablo (yüzde) için anlamlı hata verir", () => {
    // 40t/55 boom için 75% tablosu yok
    expect(() => loadChartLookup(crane, 40, 75, 55.0, 10)).toThrow(/yüzde|eğri|tablo/i);
  });
});

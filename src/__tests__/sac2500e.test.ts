// SANY SAC2500E — broşürden (Sany_crane-brochure_SAC2500E.pdf) çıkarılan
// ana bom (Load Chart-T) yük tablosunun doğrulaması.
// Beklenen değerler broşürün 360° tam-ayak yük tablosu hücreleridir.

import { describe, it, expect } from "vitest";
import sac2500e from "../data/sac2500e.json" assert { type: "json" };
import { loadChartLookup, computeCapacity, jibChartLookup } from "../engine/capacity.js";
import { computeOutrigger } from "../engine/outrigger.js";
import { computeLiftFull } from "../engine/index.js";
import type { CraneModel } from "../engine/types.js";

const crane = sac2500e as unknown as CraneModel;

describe("SANY SAC2500E — veri modeli", () => {
  it("model kaydı doğru", () => {
    expect(crane.model).toBe("SANY SAC2500E");
    expect(crane.self_weight).toBe(60);
    expect(crane.capacity_pct_options).toEqual([100]);
  });

  it("7 denge ağırlığı tablosu ve 14 bom uzunluğu", () => {
    expect(crane.counterweight_options).toEqual([0, 22, 31.5, 41, 50.5, 60, 80]);
    expect(crane.boom_lengths).toHaveLength(14);
    expect(crane.boom_lengths[0]).toBe(13.9);
    expect(crane.boom_lengths[13]).toBe(75.0);
  });
});

describe("SANY SAC2500E — yük tablosu (broşür hücreleri)", () => {
  // Tablodan birebir okunan (interpolasyonsuz) değerler.
  const exact: Array<[number, number, number, number]> = [
    // [counterweight, boom, radius, beklenen kapasite]
    [80, 13.9, 3, 134.0],
    [80, 13.9, 9, 73.8],
    [80, 13.9, 11, 51.4],
    [80, 75.0, 16, 12.0],
    [80, 75.0, 70, 2.5],
    [60, 13.9, 5, 114.2],
  ];

  it.each(exact)(
    "cw%it bom%im r%im → %it",
    (cw, boom, r, cap) => {
      expect(loadChartLookup(crane, cw, 100, boom, r)).toBeCloseTo(cap, 2);
    },
  );

  it("radius interpolasyonu: cw80 bom13.9 r9.5 = (73.8+64.0)/2 = 68.9", () => {
    expect(loadChartLookup(crane, 80, 100, 13.9, 9.5)).toBeCloseTo(68.9, 2);
  });

  it("amblem (*) noktası 360° tablodan çıkarıldı: cw80 bom13.9 min radius = 3m", () => {
    // 2.5m'deki 250t* 'yalnız arka' değeri tabloda yok → aralık dışı hata.
    expect(() => loadChartLookup(crane, 80, 100, 13.9, 2.5)).toThrow();
    const notes = crane.over_rear_notes ?? [];
    expect(notes[0]?.points[0]).toMatchObject({
      counterweight: 80,
      boom_length: 13.9,
      radius: 2.5,
      capacity: 250,
    });
  });

  it("kapasite kontrolü: cw80 bom13.9 r9, 60t yük → UYGUN (73.8t sınır)", () => {
    const r = computeCapacity(crane, {
      load_weight: 60,
      hook_weight: 1.5,
      rigging_weight: 0.5,
      counterweight: 80,
      capacity_pct: 100,
      boom_length: 13.9,
      radius: 9,
    });
    expect(r.rated_capacity).toBeCloseTo(73.8, 2);
    expect(r.total_load).toBeCloseTo(62.0, 2);
    expect(r.status).toBe("UYGUN");
  });
});

describe("SANY SAC2500E — jib yük tabloları (broşür hücreleri)", () => {
  it("jib_configs meta doğru", () => {
    expect(crane.jib_configs?.counterweight_required).toBe(80);
    const keys = crane.jib_configs?.configs.map((c) => c.key);
    expect(keys).toEqual(["TJ_TH", "TEJ_TEH"]);
    const tjth = crane.jib_configs?.configs.find((c) => c.key === "TJ_TH");
    expect(tjth?.jib_lengths).toEqual([11.2, 20.0]);
    const teteh = crane.jib_configs?.configs.find((c) => c.key === "TEJ_TEH");
    expect(teteh?.jib_lengths).toEqual([19.2, 27.2, 28.0, 36.0, 43.0]);
  });

  // [config, jib_length, boom, offset, radius, beklenen]
  const exact: Array<[string, number, number, number, number, number]> = [
    ["TJ_TH", 11.2, 56.1, 0, 13, 14.6],
    ["TJ_TH", 11.2, 56.1, 0, 62, 2.6],
    ["TJ_TH", 11.2, 75.0, 50, 26, 5.4],
    ["TEJ_TEH", 43.0, 56.1, 0, 22, 2.7],
  ];
  it.each(exact)("%s jib%im bom%im %i° r%im → %it", (cfg, jl, bl, off, r, cap) => {
    expect(jibChartLookup(crane, cfg as never, jl, bl, off, r)).toBeCloseTo(cap, 2);
  });

  it("jib radius interpolasyonu (TJ_TH 11.2 boom56.1 0°, r13→14.6, r16→14.6)", () => {
    // r14/r16 = 14.6 → r15 de 14.6
    expect(jibChartLookup(crane, "TJ_TH", 11.2, 56.1, 0, 15)).toBeCloseTo(14.6, 2);
  });

  it("jib modunda yanlış denge ağırlığı reddedilir (tablo 80t için geçerli)", () => {
    const inp = {
      load_weight: 8, hook_weight: 1, rigging_weight: 0.5,
      load_height: 0, load_diameter: 0, obstacle_height: 0, obstacle_distance: 0,
      boom_length: 56.1, radius: 13, counterweight: 50.5, capacity_pct: 100,
    };
    expect(() =>
      computeLiftFull(crane, inp, {
        outrigger_config: "9x7,8", slew_angle: 180,
        jib: { config: "TJ_TH", jib_length: 11.2, jib_offset: 0 },
      }),
    ).toThrow(/denge ağırlığı 80t/i);
  });

  it("jib modunda computeLiftFull: kapasite jib tablosundan, klerens null", () => {
    const inp = {
      load_weight: 8, hook_weight: 1, rigging_weight: 0.5,
      load_height: 0, load_diameter: 0, obstacle_height: 0, obstacle_distance: 0,
      boom_length: 56.1, radius: 13, counterweight: 80, capacity_pct: 100,
    };
    const r = computeLiftFull(crane, inp, {
      outrigger_config: "9x7,8", slew_angle: 180, pad_area: 1.0,
      jib: { config: "TJ_TH", jib_length: 11.2, jib_offset: 0 },
    });
    expect(r.clearance).toBeNull();
    expect(r.lift_config).toBe("TJ_TH");
    expect(r.capacity.rated_capacity).toBeCloseTo(14.6, 2);
    expect(r.capacity.total_load).toBeCloseTo(9.5, 2);
    expect(r.capacity.status).toBe("UYGUN");
    expect(r.outrigger).not.toBeNull(); // ayak reaksiyonu yine hesaplanır
    expect(r.collision.worst).toBe("ok"); // jib modunda çarpışma boş
  });
});

describe("SANY SAC2500E — ayak reaksiyonu (self_weight=60t)", () => {
  it("9x7.8 m ayakta 360° tarama tutarlı", () => {
    const res = computeOutrigger({
      crane_self_weight: 60,
      counterweight: 80,
      total_load: 62,
      radius: 9,
      Lx: 9.0,
      Ly: 7.8,
      pad_area: 1.0,
    });
    // V = 60 + 80 + 62 = 202 t
    expect(res.V).toBeCloseTo(202, 6);
    expect(res.max_corner_load).toBeGreaterThan(202 / 4); // eksantrik → köşe > ortalama
  });
});

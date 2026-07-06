// Faz 4 — Ayak reaksiyonu testleri (statik mantık sağlaması).

import { describe, it, expect } from "vitest";
import {
  parseOutriggerConfig,
  cornerLoadsAtAngle,
  computeOutrigger,
} from "../engine/outrigger.js";
import { computeReeving } from "../engine/capacity.js";

describe("parseOutriggerConfig", () => {
  it("Türkçe ondalık virgülü çözer", () => {
    expect(parseOutriggerConfig("10,2x10,6")).toEqual({ Lx: 10.2, Ly: 10.6 });
    expect(parseOutriggerConfig("8,20x8,68")).toEqual({ Lx: 8.2, Ly: 8.68 });
  });
  it("geçersiz girdide hata verir", () => {
    expect(() => parseOutriggerConfig("abc")).toThrow();
  });
});

describe("cornerLoadsAtAngle", () => {
  const base = {
    crane_self_weight: 60,
    counterweight: 40,
    total_load: 100,
    radius: 9,
    Lx: 10.2,
    Ly: 10.6,
  };

  it("yük yokken 4 köşe eşit paylaşır (V/4)", () => {
    const at = cornerLoadsAtAngle({ ...base, total_load: 0, radius: 0 }, 0);
    const V = 60 + 40 + 0;
    for (const c of at.corners) expect(c.load).toBeCloseTo(V / 4, 6);
  });

  it("4 köşe toplamı her zaman V'ye eşittir (denge)", () => {
    const at = cornerLoadsAtAngle(base, 37);
    const V = 60 + 40 + 100;
    const sum = at.corners.reduce((s, c) => s + c.load, 0);
    expect(sum).toBeCloseTo(V, 6);
  });

  it("slew=0 (arka/+x) yükü ön köşeleri ağırlaştırır", () => {
    const at = cornerLoadsAtAngle(base, 0);
    const fr = at.corners.find((c) => c.label === "FR")!;
    const rl = at.corners.find((c) => c.label === "RL")!;
    expect(fr.load).toBeGreaterThan(rl.load);
  });

  it("normal senaryoda ayak kalkması/devrilme bayrağı yok", () => {
    // slew=0: ex=4.5 → 2ex/Lx=0.88 < 1, ey=0 → tüm köşeler basınçta.
    const at = cornerLoadsAtAngle(base, 0);
    expect(at.uplift).toBe(false);
    expect(at.tipping).toBe(false);
  });

  it("ayak kalkması: negatif köşe 0'a çekilir, yük 3 ayağa dengeyle dağıtılır", () => {
    // Lx=Ly=8, slew 45°: ex=ey=160·5.657·cos45 / 200 = 3.2 → doğrusal RL köşesi
    // negatif, ama CoG (3.2, 3.2) hem dikdörtgen hem destek üçgeni içinde.
    const inp = {
      crane_self_weight: 40,
      counterweight: 0,
      total_load: 160,
      radius: 5.6569,
      Lx: 8,
      Ly: 8,
    };
    const at = cornerLoadsAtAngle(inp, 45);
    expect(at.uplift).toBe(true);
    expect(at.tipping).toBe(false);
    const V = 200;
    const sum = at.corners.reduce((s, c) => s + c.load, 0);
    expect(sum).toBeCloseTo(V, 6); // kuvvet dengesi korunur
    for (const c of at.corners) expect(c.load).toBeGreaterThanOrEqual(0); // ayak çekemez
    const rl = at.corners.find((c) => c.label === "RL")!;
    expect(rl.load).toBeCloseTo(0, 9); // kalkan ayak
    // Moment dengesi: ΣP·x = V·ex, ΣP·y = V·ey
    const mx = at.corners.reduce((s, c) => {
      const sx = c.label.endsWith("R") ? 1 : -1;
      return s + c.load * sx * 4;
    }, 0);
    expect(mx).toBeCloseTo(V * at.cog_x, 6);
    // Doğrusal formülün verdiğinden BÜYÜK maks köşe (güvenli taraf)
    const linMax = (V / 4) * (1 + (2 * at.cog_x) / 8 + (2 * at.cog_y) / 8);
    expect(at.max_corner.load).toBeGreaterThan(linMax - 1e-9);
  });

  it("CoG destek alanı dışında → devrilme bayrağı", () => {
    const at = cornerLoadsAtAngle(
      { crane_self_weight: 40, counterweight: 0, total_load: 160, radius: 12, Lx: 8, Ly: 8 },
      45,
    );
    expect(at.tipping).toBe(true);
  });

  it("bom ağırlığı (yük yönünde momentle) köşe yükünü artırır", () => {
    const withoutBoom = cornerLoadsAtAngle(base, 0);
    const withBoom = cornerLoadsAtAngle({ ...base, boom_weight: 20, boom_cog_offset: 3 }, 0);
    expect(withBoom.max_corner.load).toBeGreaterThan(withoutBoom.max_corner.load);
  });

  it("CW yarıçapı yük tarafı köşeyi azaltır ama ΣP=V korunur", () => {
    const withoutCwR = cornerLoadsAtAngle(base, 0);
    const withCwR = cornerLoadsAtAngle({ ...base, counterweight_radius: 4 }, 0);
    const V = base.crane_self_weight + base.counterweight + base.total_load;
    const sum1 = withoutCwR.corners.reduce((s, c) => s + c.load, 0);
    const sum2 = withCwR.corners.reduce((s, c) => s + c.load, 0);
    expect(sum1).toBeCloseTo(V, 6);
    expect(sum2).toBeCloseTo(V, 6); // CW yarıçapı ağırlığı değiştirmez, yalnız dağılımı
    expect(withCwR.max_corner.load).toBeLessThan(withoutCwR.max_corner.load);
  });

  it("büyük CW + büyük cw_radius + küçük yük/radius → geri devrilme (yük tarafı ayaklar kalkar)", () => {
    const inp = {
      crane_self_weight: 20,
      counterweight: 100,
      counterweight_radius: 6,
      total_load: 5,
      radius: 2,
      Lx: 6,
      Ly: 6,
    };
    const at = cornerLoadsAtAngle(inp, 0);
    expect(at.uplift || at.tipping).toBe(true);
    const V = inp.crane_self_weight + inp.counterweight + inp.total_load;
    const sum = at.corners.reduce((s, c) => s + c.load, 0);
    expect(sum).toBeCloseTo(V, 6);
    // Yük tarafı (FR/RR, sx=+1) köşeleri kalkar; CW tarafı (FL/RL) ağırlaşır.
    const fr = at.corners.find((c) => c.label === "FR")!;
    const fl = at.corners.find((c) => c.label === "FL")!;
    expect(fr.load).toBeCloseTo(0, 6);
    expect(fr.load).toBeLessThan(fl.load);
  });

  it("boom_weight/boom_cog_offset/counterweight_radius verilmeyince eski davranışla birebir aynı", () => {
    const at = cornerLoadsAtAngle(base, 53);
    const V = base.crane_self_weight + base.counterweight + base.total_load;
    const a = (53 * Math.PI) / 180;
    const ex = (base.total_load * base.radius * Math.cos(a)) / V;
    const ey = (base.total_load * base.radius * Math.sin(a)) / V;
    expect(at.cog_x).toBeCloseTo(ex, 9);
    expect(at.cog_y).toBeCloseTo(ey, 9);
  });
});

describe("computeOutrigger (slew taraması)", () => {
  it("kritik açıyı ve en büyük köşe yükünü bulur", () => {
    const res = computeOutrigger(
      {
        crane_self_weight: 60,
        counterweight: 40,
        total_load: 100,
        radius: 9,
        Lx: 10.2,
        Ly: 10.6,
        pad_area: 1.0,
      },
      1,
    );
    expect(res.V).toBeCloseTo(200, 6);
    expect(res.max_corner_load).toBeGreaterThan(res.V / 4);
    expect(res.ground_pressure).toBeCloseTo(res.max_corner_load / 1.0, 6);
    expect(res.critical_angle).toBeGreaterThanOrEqual(0);
    expect(res.critical_angle).toBeLessThan(360);
  });

  it("self_weight verilmezse hata", () => {
    expect(() =>
      computeOutrigger({
        crane_self_weight: 0,
        counterweight: 40,
        total_load: 100,
        radius: 9,
        Lx: 10,
        Ly: 10,
      }),
    ).toThrow(/self_weight/i);
  });

  it("max_force_t aşılırsa max_outrigger_force_exceeded=true", () => {
    const res = computeOutrigger(
      { crane_self_weight: 60, counterweight: 40, total_load: 100, radius: 9, Lx: 10.2, Ly: 10.6 },
      1,
      10,
    );
    expect(res.max_outrigger_force_exceeded).toBe(true);
  });

  it("max_force_t verilmeyince flag tanımsız kalır", () => {
    const res = computeOutrigger(
      { crane_self_weight: 60, counterweight: 40, total_load: 100, radius: 9, Lx: 10.2, Ly: 10.6 },
      1,
    );
    expect(res.max_outrigger_force_exceeded).toBeUndefined();
  });
});

describe("computeReeving (halat donanımı kontrolü)", () => {
  it("tam bölünen durumda gerekli parça sayısını hesaplar", () => {
    const r = computeReeving(10, 100);
    expect(r.required_parts).toBe(10);
    expect(r.feasible).toBe(true);
  });

  it("bölünmeyen durumda yukarı yuvarlar (ceil)", () => {
    const r = computeReeving(10.7, 62);
    expect(r.required_parts).toBe(Math.ceil(62 / 10.7));
    expect(r.feasible).toBe(true);
  });

  it("gerekli parça sayısı max_parts'ı aşarsa feasible=false", () => {
    const r = computeReeving(10, 1000, 14);
    expect(r.required_parts).toBe(100);
    expect(r.feasible).toBe(false);
  });

  it("varsayılan max_parts=14 kullanılır", () => {
    const r = computeReeving(10.7, 250); // SAC2500E maks. 250t kaldırma
    expect(r.required_parts).toBe(Math.ceil(250 / 10.7));
    expect(r.feasible).toBe(r.required_parts <= 14);
  });
});

// Emniyet modülleri: sapan kol kuvvetleri, kanca bloğu seçimi, zemin kontrolleri.
import { describe, it, expect } from "vitest";
import { slingLegForces } from "../engine/slings";
import { hookBlocksFor, maxPartsFor, selectHookBlock } from "../engine/hookBlocks";
import { matSizing, slopeCheck, undergroundProximity, undergroundTopDepth } from "../engine/ground";
import { windAtHeight } from "../ui/weather";
import type { SceneObject } from "../engine/types";

describe("slingLegForces", () => {
  it("2 kol simetrik: 45°, eşit paylaşım", () => {
    const r = slingLegForces(10, 2, 2, 2);
    expect(r.conservative.legs.map((l) => l.vertical_t)).toEqual([5, 5]);
    expect(r.max_angle_deg).toBeCloseTo(45, 6);
    expect(r.max_tension_t).toBeCloseTo(5 * Math.SQRT2, 6);
    expect(r.cog_outside).toBe(false);
  });

  it("2 kol eksantrik CoG: kaldıraç kuralı + yatay denge", () => {
    const r = slingLegForces(10, 2, 2, 2, { x: 1, z: 0 });
    const [a, b] = r.conservative.legs;
    expect(a.vertical_t).toBeCloseTo(7.5, 9);
    expect(b.vertical_t).toBeCloseTo(2.5, 9);
    expect(a.tension_t).toBeCloseTo(7.5 * Math.sqrt(1.25), 6);
    expect(b.tension_t).toBeCloseTo(2.5 * Math.sqrt(3.25), 6);
    // Yatay bileşenler eşit (kanca düğümü dengesi).
    expect((a.vertical_t * a.horizontal_m) / 2).toBeCloseTo((b.vertical_t * b.horizontal_m) / 2, 9);
    // Uzak kol 56° → 45° uyarısı, 60° değil.
    expect(r.angle_not_allowed).toBe(false);
    expect(r.warnings.some((w) => w.includes("45°"))).toBe(true);
  });

  it("CoG bağlantılar dışında → devrilme uyarısı", () => {
    const r = slingLegForces(10, 2, 2, 2, { x: 3, z: 0 });
    expect(r.cog_outside).toBe(true);
    expect(r.warnings.some((w) => w.includes("devrilir"))).toBe(true);
  });

  it("60° üstü açı izin verilmez", () => {
    const r = slingLegForces(10, 2, 4, 1);
    expect(r.max_angle_deg).toBeGreaterThan(60);
    expect(r.angle_not_allowed).toBe(true);
  });

  it("4 kol simetrik: muhafazakâr 2 köşegen kol, rijit 4 eşit", () => {
    const r = slingLegForces(20, 4, 2, 2);
    expect(r.max_tension_t).toBeCloseTo(10 * Math.SQRT2, 6);
    expect(r.conservative.active_legs).toBe(2);
    expect(r.rigid.active_legs).toBe(4);
    r.rigid.legs.forEach((l) => expect(l.vertical_t).toBeCloseTo(5, 9));
  });

  it("4 kol eksantrik: rijit dağılım dengeyi sağlar, muhafazakâr ≥ rijit", () => {
    const c = { x: 0.3, z: -0.2 };
    const r = slingLegForces(20, 4, 2, 3, c);
    const legs = r.rigid.legs;
    const sum = legs.reduce((s, l) => s + l.vertical_t, 0);
    const mx = legs.reduce((s, l) => s + l.vertical_t * l.attach.x, 0);
    const mz = legs.reduce((s, l) => s + l.vertical_t * l.attach.z, 0);
    expect(sum).toBeCloseTo(20, 9);
    expect(mx).toBeCloseTo(20 * c.x, 9);
    expect(mz).toBeCloseTo(20 * c.z, 9);
    expect(r.max_tension_t).toBeGreaterThanOrEqual(r.rigid.max_tension_t);
  });

  it("4 kol, CoG köşeye yakın: bir kol gevşer → 3 kol", () => {
    const s = 2 / Math.SQRT2;
    const r = slingLegForces(20, 4, 2, 3, { x: s * 0.8, z: s * 0.8 });
    expect(r.rigid.active_legs).toBe(3);
    expect(r.cog_outside).toBe(false);
    const sum = r.rigid.legs.reduce((a, l) => a + l.vertical_t, 0);
    expect(sum).toBeCloseTo(20, 9);
  });

  it("yükseklik ≤ 0 → sonsuz kuvvet", () => {
    const r = slingLegForces(10, 2, 2, 0);
    expect(r.max_tension_t).toBe(Infinity);
    expect(r.angle_not_allowed).toBe(true);
  });
});

describe("kanca bloğu", () => {
  it("LTM 1160 datasheet blokları", () => {
    const b = hookBlocksFor("LIEBHERR LTM 1160");
    expect(b.map((x) => x.capacity_t)).toEqual([10, 30, 65, 100, 130, 160]);
    expect(b.find((x) => x.capacity_t === 160)!.weight_t).toBe(1.98);
    expect(maxPartsFor(b.find((x) => x.capacity_t === 65)!)).toBe(6);
    expect(maxPartsFor(b.find((x) => x.capacity_t === 10)!)).toBe(1);
  });

  it("en küçük yeterli blok (kapasite + donanım)", () => {
    const s1 = selectHookBlock("LIEBHERR LTM 1160", 50, 9.3);
    expect(s1.required_parts).toBe(6);
    expect(s1.block?.capacity_t).toBe(65);
    const s2 = selectHookBlock("LIEBHERR LTM 1160", 60, 9.3);
    expect(s2.required_parts).toBe(7);
    expect(s2.block?.capacity_t).toBe(100); // 65 t bloğu 6 donanımla yetmez
    const s3 = selectHookBlock("LIEBHERR LTM 1160", 200, 9.3);
    expect(s3.block).toBeNull();
  });

  it("SANY yayınlanmış donanım sayısı kullanılır", () => {
    const b = hookBlocksFor("SANY SAC2500E");
    expect(maxPartsFor(b.find((x) => x.capacity_t === 125)!)).toBe(11);
    expect(selectHookBlock("SANY SAC2500E", 5, 10.7).block?.capacity_t).toBe(12.5);
    expect(selectHookBlock("SANY SAC2500E", 20, 10.7).block?.capacity_t).toBe(32);
  });

  it("bilinmeyen vinç → boş", () => {
    expect(hookBlocksFor("X")).toEqual([]);
    expect(selectHookBlock("X", 10, 10).block).toBeNull();
  });
});

describe("zemin", () => {
  it("eğim sınırları", () => {
    expect(slopeCheck(0.2).level).toBe("ok");
    expect(slopeCheck(0.5).level).toBe("warn");
    expect(slopeCheck(1.5).level).toBe("bad");
  });

  it("plaka boyutlandırma", () => {
    const ok = matSizing(20, 25, 1);
    expect(ok.pad_ok).toBe(true);
    expect(ok.mat).toBeNull();

    const m = matSizing(50, 25, 1);
    expect(m.required_area_m2).toBeCloseTo(2, 9);
    expect(m.mat?.side_m).toBe(1.5);
    expect(m.mat_pressure_t_m2).toBeCloseTo(50 / 2.25, 9);

    // İnce plaka: 45° yayılma 1 + 2·0,1 = 1,2 m kenar → hiçbir standart yetmez.
    expect(matSizing(50, 25, 1, 0.1).mat).toBeNull();
    const thick = matSizing(50, 25, 1, 0.3);
    expect(thick.mat?.side_m).toBe(1.5);
    expect(thick.spread?.too_thin).toBe(false);

    expect(matSizing(200, 10, 1).level).toBe("bad");
  });

  it("yer altı yapısı yakınlığı (45° basınç soğanı)", () => {
    const pipe: SceneObject = { id: "u1", kind: "underground", label: "Kanal", x: 5, z: 0, width: 2, depth: 2, height: 1, y: -3 };
    expect(undergroundTopDepth(pipe)).toBeCloseTo(2, 9);
    const hits = undergroundProximity([{ x: 0, z: 0 }, { x: 2.5, z: 0 }, { x: 5, z: 0 }], [pipe], 1);
    expect(hits.map((h) => h.level)).toEqual(["ok", "warn", "collision"]);
    expect(hits[0].horizontal_m).toBeCloseTo(3.5, 9);
    // Diğer nesne türleri yok sayılır.
    expect(undergroundProximity([{ x: 5, z: 0 }], [{ ...pipe, kind: "building" }], 1)).toEqual([]);
    // y yoksa üst yüz zeminde.
    expect(undergroundTopDepth({ ...pipe, y: undefined })).toBe(0);
  });
});

describe("rüzgâr yükseklik profili", () => {
  it("güç kanunu 0,14; 10 m altında azaltma yok", () => {
    expect(windAtHeight(10, 10)).toBeCloseTo(10, 9);
    expect(windAtHeight(10, 5)).toBeCloseTo(10, 9);
    expect(windAtHeight(10, 50)).toBeCloseTo(10 * Math.pow(5, 0.14), 9);
  });
});

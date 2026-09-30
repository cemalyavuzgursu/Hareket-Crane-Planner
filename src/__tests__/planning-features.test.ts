// Crane Planner paritesi — yeni motor özellikleri: vinç yönü (heading),
// asimetrik ayaklar, jib klerensi/çarpışması, yük alanına göre rüzgâr,
// aparat yüksekliği.

import { describe, it, expect } from "vitest";
import { CRANES } from "../data/cranes";
import { computeLiftFull, computeWindLimit } from "../engine/index.js";
import { cornerLoadsAtAngle } from "../engine/outrigger.js";
import type { LiftInputs, SceneObject } from "../engine/types.js";

const sany = CRANES.find((c) => c.model === "SANY SAC2500E")!;
const inp: LiftInputs = {
  load_weight: 20, hook_weight: 1, rigging_weight: 0.3, load_height: 2, load_diameter: 2,
  obstacle_height: 0, obstacle_distance: 0, boom_length: 32.5, radius: 14, counterweight: 80, capacity_pct: 100,
};
const wall = (x: number, z: number): SceneObject => ({ id: "w", kind: "building", label: "Duvar", x, z, width: 2, depth: 2, height: 30 });

describe("vinç yönü (crane_heading)", () => {
  it("nesne dünya çerçevesinde: bom plan açısı = yön + dönme", () => {
    // Duvar kuzeydoğu (plan açısı 90°) yönünde 14 m'de. slew 0 + heading 90 → bom duvara bakar.
    const obj = [wall(0, 14)];
    const hit = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0, crane_heading: 90, objects: obj });
    const miss = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0, crane_heading: 0, objects: obj });
    expect(hit.collision.worst).toBe("collision");
    expect(miss.collision.items.find((i) => i.id === "obj-w-load")!.severity).toBe("ok");
  });

  it("ayak reaksiyonu şasiye göre: yön değişince değişmez", () => {
    const a = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 30, crane_heading: 0 });
    const b = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 30, crane_heading: 135 });
    expect(b.outrigger!.max_corner_load).toBeCloseTo(a.outrigger!.max_corner_load, 9);
  });
});

describe("asimetrik ayaklar", () => {
  const base = { crane_self_weight: 60, counterweight: 40, total_load: 50, radius: 8, Lx: 9, Ly: 7.8 };
  it("slew merkezi arka ayaklara yakınsa (ön daha uzak) arka üzerinden kaldırma arka ayakları daha çok yükler", () => {
    const sym = cornerLoadsAtAngle(base, 0);
    // rear = 0.38·9 = 3.42, front = 5.58 → dikdörtgen merkezi c = −1.08 → base_offset_x = +1.08
    const asym = cornerLoadsAtAngle({ ...base, base_offset_x: 1.08 }, 0);
    expect(asym.max_corner.label.startsWith("R")).toBe(true);
    expect(asym.max_corner.load).toBeGreaterThan(sym.max_corner.load);
  });

  it("computeLiftFull dikdörtgen merkezini raporlar (SANY f=0,38)", () => {
    const r = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0 });
    expect(r.outrigger!.rect_center_x).toBeCloseTo((9 * 0.38 - 9 * 0.62) / 2, 9);
    const sum = r.outrigger!.per_angle[0].corners.reduce((s, c) => s + c.load, 0);
    expect(sum).toBeCloseTo(r.outrigger!.V, 6);
  });
});

describe("jib modu klerensi + çarpışma (YAKLAŞIK)", () => {
  const jibInp: LiftInputs = { ...inp, boom_length: 56.1, radius: 20, load_weight: 3 };
  const jib = { config: "TJ_TH" as const, jib_length: 11.2, jib_offset: 0 };

  it("jib klerensi ve maks kanca yüksekliği hesaplanır", () => {
    const r = computeLiftFull(sany, jibInp, { outrigger_config: "9x7,8", slew_angle: 0, jib });
    expect(r.clearance).toBeNull();
    expect(r.jib_clearance).toBeDefined();
    expect(r.jib_clearance!.estimated).toBe(true);
    expect(r.jib_clearance!.max_hook_height).toBeGreaterThan(50);
    expect(r.jib_clearance!.clearance_to_load).toBeGreaterThan(0);
  });

  it("jib çarpışma kontrolü çevre nesnelerini görür", () => {
    const r = computeLiftFull(sany, jibInp, {
      outrigger_config: "9x7,8", slew_angle: 0, jib,
      objects: [{ id: "t", kind: "building", label: "Kule", x: 19, z: 0, width: 4, depth: 4, height: 70 }],
    });
    expect(r.collision.items.some((i) => i.source === "jib")).toBe(true);
    expect(r.collision.worst).toBe("collision");
  });
});

describe("rüzgâr limiti (yük alanı)", () => {
  it("yüzey 1,2 m²/t'yi aşmıyorsa tablo hızı geçerli", () => {
    const w = computeWindLimit(9, 20, 10); // 10·1,2 = 12 m² ≤ 24 m²
    expect(w.reduced).toBe(false);
    expect(w.allowed_wind_ms).toBe(9);
  });
  it("büyük yüzey izinli hızı √oranla düşürür", () => {
    const w = computeWindLimit(9, 10, 40, 1.2); // A·cw=48, ref=12 → 9·√(12/48)=4,5
    expect(w.reduced).toBe(true);
    expect(w.allowed_wind_ms!).toBeCloseTo(4.5, 9);
  });
  it("vinç verisinde rüzgâr limiti yoksa null döner", () => {
    expect(computeWindLimit(null, 10, 40).allowed_wind_ms).toBeNull();
  });
  it("computeLiftFull rüzgâr sonucunu alan verilince üretir", () => {
    const ltm = CRANES.find((c) => c.model === "LIEBHERR LTM 1250")!;
    const r = computeLiftFull(ltm, { ...inp, boom_length: 16.5, radius: 9, counterweight: 40, capacity_pct: 85, load_wind_area_m2: 60 }, { outrigger_config: "10,2x10,6", slew_angle: 0 });
    expect(r.wind!.reduced).toBe(true);
    expect(r.wind!.allowed_wind_ms!).toBeLessThan(9);
  });
});

describe("aparat yüksekliği", () => {
  it("kaldırma yüksekliği payından düşülür", () => {
    const a = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0 });
    const b = computeLiftFull(sany, { ...inp, rigging_height: 4 }, { outrigger_config: "9x7,8", slew_angle: 0 });
    const ha = a.collision.items.find((i) => i.id === "lift-height")!.clearance_m;
    const hb = b.collision.items.find((i) => i.id === "lift-height")!.clearance_m;
    expect(ha - hb).toBeCloseTo(4, 9);
  });
});

import { findConfigurations } from "../engine/selection.js";

describe("makine seçim sihirbazı", () => {
  const q = { total_load: 25, radius: 12, load_height: 2, load_diameter: 2, obstacle_height: 0, obstacle_distance: 0 };
  const res = findConfigurations(CRANES, q);

  it("uygun adaylar önce, en az kurulum (düşük CW, kısa bom) ilk sırada", () => {
    expect(res.length).toBeGreaterThan(0);
    const feas = res.filter((r) => r.feasible);
    expect(feas.length).toBeGreaterThan(0);
    expect(res[0].feasible).toBe(true);
    for (let i = 1; i < feas.length; i++) {
      expect(feas[i].counterweight).toBeGreaterThanOrEqual(feas[i - 1].counterweight);
    }
  });

  it("her uygun aday gerçekten taşıyor ve klerensi pozitif", () => {
    for (const r of res.filter((x) => x.feasible)) {
      expect(r.utilization_pct!).toBeLessThanOrEqual(100);
      expect(r.clearance_to_load!).toBeGreaterThanOrEqual(0);
    }
  });

  it("aşırı yük hiçbir uygun aday bırakmaz ve nedenini yazar", () => {
    const heavy = findConfigurations(CRANES, { ...q, total_load: 5000 });
    expect(heavy.some((r) => r.feasible)).toBe(false);
    expect(heavy[0].reasons.join(" ")).toMatch(/kapasite/);
  });

  it("gerekli kanca yüksekliği kısa bomları eler", () => {
    const tall = findConfigurations(CRANES, { ...q, required_hook_height: 40 });
    for (const r of tall.filter((x) => x.feasible)) expect(r.max_hook_height!).toBeGreaterThanOrEqual(40);
  });
});

describe("kaldırma yüksekliği (load_bottom_height) ve vinç saha konumu", () => {
  it("varsayılan: yük engel üstünde (eski davranış birebir)", () => {
    const base = { ...inp, obstacle_height: 2.3 };
    const a = computeLiftFull(sany, base, { outrigger_config: "9x7,8", slew_angle: 0 });
    const b = computeLiftFull(sany, { ...base, load_bottom_height: 2.3 }, { outrigger_config: "9x7,8", slew_angle: 0 });
    expect(b.clearance!.clearance_to_load).toBeCloseTo(a.clearance!.clearance_to_load, 12);
    expect(a.clearance!.load_bottom_height).toBe(2.3);
  });

  it("yük yükseldikçe boma yaklaşır (yük klerensi azalır), kaldırma payı azalır", () => {
    const low = computeLiftFull(sany, { ...inp, load_bottom_height: 1 }, { outrigger_config: "9x7,8", slew_angle: 0 });
    const high = computeLiftFull(sany, { ...inp, load_bottom_height: 12 }, { outrigger_config: "9x7,8", slew_angle: 0 });
    expect(high.clearance!.clearance_to_load).toBeLessThan(low.clearance!.clearance_to_load);
    const room = (r: typeof low) => r.collision.items.find((i) => i.id === "lift-height")!.clearance_m;
    expect(room(low) - room(high)).toBeCloseTo(11, 9);
  });

  it("vinç konumu: nesneler saha koordinatında, vinç taşınınca çarpışma değişir", () => {
    const obj = [wall(14, 0)]; // sahada (14,0)
    const atOrigin = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0, objects: obj });
    const moved = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0, objects: obj, crane_position: { x: 0, z: 20 } });
    expect(atOrigin.collision.worst).toBe("collision");
    expect(moved.collision.items.find((i) => i.id === "obj-w-load")!.severity).toBe("ok");
  });

  it("yer altı nesneleri bom/yük çarpışması üretmez", () => {
    const pipe: SceneObject = { id: "p", kind: "underground", label: "Boru", x: 14, z: 0, width: 3, depth: 3, height: 1, y: -2 };
    const r = computeLiftFull(sany, inp, { outrigger_config: "9x7,8", slew_angle: 0, objects: [pipe] });
    expect(r.collision.items.some((i) => i.id.startsWith("obj-p-"))).toBe(false);
  });
});

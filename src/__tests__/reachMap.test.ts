import { describe, it, expect } from "vitest";
import ltm1250 from "../data/ltm1250.json" assert { type: "json" };
import { computeReachMap, type ReachMap } from "../engine/reachMap.js";
import type { CraneModel, LiftInputs, SceneObject } from "../engine/types.js";

const crane = ltm1250 as unknown as CraneModel;

function inputs(load: number, boom = 16.5): LiftInputs {
  return {
    load_weight: load,
    hook_weight: 0.5,
    rigging_weight: 0.2,
    load_height: 1,
    load_diameter: 1,
    obstacle_height: 0,
    obstacle_distance: 0,
    boom_length: boom,
    radius: 6,
    counterweight: 40,
    capacity_pct: 85,
  };
}

const OPTS = { outrigger_config: "10,2x10,6" };

function at(map: ReachMap, x: number, z: number) {
  const c = map.cells.find((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6);
  if (!c) throw new Error(`hücre yok: ${x},${z}`);
  return c;
}

const building: SceneObject = {
  id: "b1",
  kind: "building",
  label: "Bina",
  x: 0,
  z: 8,
  width: 4,
  depth: 3,
  height: 40,
};

describe("computeReachMap", () => {
  it("hafif yük min radius yakınında ok; tablo dışı unreachable", () => {
    const m = computeReachMap(crane, inputs(5), OPTS);
    expect(m.min_radius).toBe(3);
    expect(m.max_radius).toBe(12);
    expect(m.extent).toBe(14);
    expect(at(m, 3.5, 0.5).status).toBe("ok");
    expect(at(m, 0.5, 0.5).status).toBe("unreachable"); // min radius altında
    expect(at(m, 13.5, 0.5).status).toBe("unreachable"); // maks radius dışında
    expect(at(m, 13.5, 0.5).utilization_pct).toBeNull();
    expect(m.best_utilization).not.toBeNull();
  });

  it("ağır yük uzak radiuste over", () => {
    const m = computeReachMap(crane, inputs(150), OPTS);
    const far = at(m, 11.5, 0.5); // r ≈ 11.51 → 77 t
    expect(far.status).toBe("over");
    expect(far.utilization_pct!).toBeGreaterThan(100);
    expect(at(m, 3.5, 0.5).status).not.toBe("over"); // 275 t
  });

  it("warn eşiği", () => {
    // r=11.5 hücresi (11.51 → 12 m kademesi, 77 t): 70.7 t → %91.8
    const m = computeReachMap(crane, inputs(70), OPTS);
    expect(at(m, 11.5, 0.5).status).toBe("warn");
  });

  it("yüksek bina arkasındaki hücre collision; ters taraf değil", () => {
    const m = computeReachMap(crane, inputs(5), { ...OPTS, objects: [building] });
    const hit = at(m, 0.5, 9.5); // plan açısı ~90°, binanın içinden/arkasından
    expect(hit.status).toBe("collision");
    expect(hit.reason).toMatch(/Bina/);
    expect(at(m, 0.5, -9.5).status).not.toBe("collision"); // 270°
    expect(at(m, 9.5, 0.5).status).not.toBe("collision"); // 0°
  });

  it("heading haritayı döndürür (ayak dengesi şasiye bağlı)", () => {
    // Ayak dengesinin yöne bağlı devrildiği bir yük: bazı hücreler over, bazıları değil.
    const load = 10;
    const narrow = { outrigger_config: "10,2x4" }; // dar ayak: yana devrilme
    const m0 = computeReachMap(crane, inputs(load, 42.2), narrow);
    const m90 = computeReachMap(crane, inputs(load, 42.2), { ...narrow, crane_heading: 90 });
    // (x,z) plan açısı +90° döner → (−z, x).
    let compared = 0;
    let differs = 0;
    for (const c of m0.cells) {
      const r = at(m90, -c.z, c.x);
      expect(r.status).toBe(c.status);
      compared++;
      if (at(m0, -c.z, c.x).status !== c.status) differs++;
    }
    expect(compared).toBeGreaterThan(1000);
    // Harita gerçekten yöne bağlı olmalı (aksi halde test anlamsız).
    expect(differs).toBeGreaterThan(0);
  });

  it("heading, 90°'deki binayı slew açısıyla birlikte değerlendirir (plan açısı sabit)", () => {
    const m = computeReachMap(crane, inputs(5), { ...OPTS, objects: [building], crane_heading: 90 });
    expect(at(m, 0.5, 9.5).status).toBe("collision");
    expect(at(m, 9.5, 0.5).status).not.toBe("collision");
  });

  it("crane_position haritayı kaydırır", () => {
    const pos = { x: 10, z: -5 };
    const m0 = computeReachMap(crane, inputs(5), { ...OPTS, objects: [building] });
    const m1 = computeReachMap(crane, inputs(5), {
      ...OPTS,
      crane_position: pos,
      objects: [{ ...building, x: building.x + pos.x, z: building.z + pos.z }],
    });
    expect(m1.cells.length).toBe(m0.cells.length);
    for (let k = 0; k < m0.cells.length; k++) {
      expect(m1.cells[k].x).toBeCloseTo(m0.cells[k].x + pos.x);
      expect(m1.cells[k].z).toBeCloseTo(m0.cells[k].z + pos.z);
      expect(m1.cells[k].status).toBe(m0.cells[k].status);
    }
    expect(at(m1, 10.5, 4.5).status).toBe("collision");
  });

  it("performans: ~5000 hücre < 300 ms (nesneli)", () => {
    const objs: SceneObject[] = [building, { ...building, id: "b2", x: -20, z: -10 }];
    const t0 = performance.now();
    const m = computeReachMap(crane, inputs(20, 42.2), { ...OPTS, objects: objs });
    const dt = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`reachMap: ${m.cells.length} hücre, ${dt.toFixed(1)} ms`);
    expect(m.cells.length).toBeGreaterThan(3000);
    expect(dt).toBeLessThan(300);
  });
});

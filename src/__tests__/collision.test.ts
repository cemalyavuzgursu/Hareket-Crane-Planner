// Faz 6 — Çarpışma algılama testleri (klerens katmanı + çevre nesneleri).

import { describe, it, expect } from "vitest";
import { computeClearance } from "../engine/clearance.js";
import { computeCollisions, craneWorldGeometry } from "../engine/collision.js";
import type { GeometryConstants, SceneObject } from "../engine/types.js";

const G: GeometryConstants = {
  cribbing_height: 0.3,
  machine_ground_height: 3.475,
  boom_offset: 3.33,
  sheave_diameter: 0.417,
  hook_height: 1.0,
  sheave_offset: 1.391,
  boom_thickness: 1.25,
};

// Golden senaryo geometrisi (PROJE.md §6): radius 9, boom 16.5.
function baseClearance() {
  return computeClearance(G, {
    boom_length: 16.5,
    radius: 9,
    load_height: 4.25,
    load_diameter: 6.32,
    obstacle_height: 2.3,
    obstacle_distance: 0,
  });
}

function baseInputs(objects: SceneObject[] = []) {
  const cl = baseClearance();
  return {
    g: G,
    boom_length: 16.5,
    radius: 9,
    gama: cl.gama,
    slew_angle: 0,
    load_height: 4.25,
    load_diameter: 6.32,
    hook_height: G.hook_height,
    objects,
  };
}

describe("çarpışma — klerens katmanı", () => {
  it("negatif klerens çakışma üretir, pozitif olmaz", () => {
    const cl = baseClearance();
    const rep = computeCollisions(baseInputs(), cl);
    const boomLoad = rep.items.find((i) => i.id === "boom-main-load")!;
    // Golden klerens_to_load ≈ 1.22 m (pozitif) → ok
    expect(boomLoad.clearance_m).toBeCloseTo(cl.clearance_to_load, 6);
    expect(boomLoad.severity).toBe("ok");
  });

  it("negatif yük klerensi 'collision' işaretler", () => {
    const cl = { ...baseClearance(), clearance_to_load: -0.4 };
    const rep = computeCollisions(baseInputs(), cl);
    const boomLoad = rep.items.find((i) => i.id === "boom-main-load")!;
    expect(boomLoad.severity).toBe("collision");
    expect(rep.worst).toBe("collision");
  });
});

describe("çarpışma — çevre nesneleri (3D)", () => {
  it("bom hattının üstüne konan bina ile çakışma bulur", () => {
    // Bom 0° iken +X boyunca uzanır; ~9 m ileride, yükselen boma değecek
    // yükseklikte büyük bir bina koy.
    const obj: SceneObject = {
      id: "b1",
      kind: "building",
      label: "Bina",
      x: 6,
      z: 0,
      width: 3,
      depth: 3,
      height: 12,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    const boomHit = rep.items.find((i) => i.id === "obj-b1-boom")!;
    expect(boomHit.severity).toBe("collision");
  });

  it("uzaktaki nesne ile çakışma yok", () => {
    const obj: SceneObject = {
      id: "b2",
      kind: "building",
      label: "Uzak bina",
      x: 0,
      z: 40,
      width: 3,
      depth: 3,
      height: 5,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    const boomHit = rep.items.find((i) => i.id === "obj-b2-boom")!;
    const loadHit = rep.items.find((i) => i.id === "obj-b2-load")!;
    expect(boomHit.severity).toBe("ok");
    expect(loadHit.severity).toBe("ok");
  });
});

describe("craneWorldGeometry", () => {
  it("bom ucu yatayda yaklaşık radius'a ulaşır (slew=0)", () => {
    const geo = craneWorldGeometry(baseInputs());
    // tip_x ≈ radius (rope yük üzerine dik düşsün)
    expect(geo.boomTip.x).toBeCloseTo(9, 1);
    expect(geo.boomTip.y).toBeGreaterThan(geo.boomFoot.y);
  });

  it("slew=90° bom ucunu +Z eksenine döndürür", () => {
    const geo = craneWorldGeometry({ ...baseInputs(), slew_angle: 90 });
    expect(Math.abs(geo.boomTip.x)).toBeLessThan(0.001);
    expect(geo.boomTip.z).toBeCloseTo(9, 1);
  });
});

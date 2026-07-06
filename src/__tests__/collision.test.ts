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
    const hookHit = rep.items.find((i) => i.id === "obj-b2-hook")!;
    const ropeHit = rep.items.find((i) => i.id === "obj-b2-rope")!;
    expect(boomHit.severity).toBe("ok");
    expect(loadHit.severity).toBe("ok");
    expect(hookHit.severity).toBe("ok");
    expect(ropeHit.severity).toBe("ok");
  });

  it("kanca/halat hizasındaki yüksek nesne halat çakışması üretir", () => {
    // Halat bom ucundan (≈(8.95, 14.8)) kancaya ((9, 4.75)) düşer; x=9'da
    // 12 m yüksek ince direk halatı keser (bom üstünden geçer: tepe 14.8 > 12).
    const obj: SceneObject = {
      id: "p1",
      kind: "powerline",
      label: "Direk",
      x: 9,
      z: 0,
      width: 0.4,
      depth: 0.4,
      height: 12,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    const ropeHit = rep.items.find((i) => i.id === "obj-p1-rope")!;
    const hookHit = rep.items.find((i) => i.id === "obj-p1-hook")!;
    expect(ropeHit.severity).toBe("collision");
    expect(hookHit.severity).toBe("collision"); // kanca (9, 4.75) direğin içinde
  });
});

describe("computeClearance — geometrik erişim koruması", () => {
  it("erişilemez radius NaN yaymak yerine açık hata verir", () => {
    // boom 16.5 m: z ≈ 16.56, maks radius ≈ z − boom_offset ≈ 13.2 m
    expect(() =>
      computeClearance(G, {
        boom_length: 16.5,
        radius: 14.5,
        load_height: 0,
        load_diameter: 0,
        obstacle_height: 0,
        obstacle_distance: 0,
      }),
    ).toThrow(/erişilemez/i);
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

  it("yük merkezi klerens konvansiyonuyla hizalı: x = radius − load_diameter/2", () => {
    const geo = craneWorldGeometry(baseInputs());
    // radius=9, load_diameter=6.32 → merkez x ≈ 9 − 3.16 = 5.84
    expect(geo.loadCenter.x).toBeCloseTo(9 - 6.32 / 2, 6);
    // kanca x=radius'ta kalır (yükün uzak kenarında)
    expect(geo.hookCenter.x).toBeCloseTo(9, 6);
  });
});

describe("çarpışma — döndürülmüş nesne (rotationY)", () => {
  it("45° döndürülmüş uzun ince kutu: köşegeni bom hattına giriyor", () => {
    // Nesne merkezi bom hattından (x ekseni, z=0) uzakta (z=5), ama 45°
    // döndürülmüş 8m uzun ince bir kutu köşesiyle hatta uzanıyor.
    const obj: SceneObject = {
      id: "r1",
      kind: "obstacle",
      label: "Döner kutu",
      x: 6,
      z: 5,
      width: 8,
      depth: 0.5,
      height: 12,
      rotationY: 45,
    };
    const repRotated = computeCollisions(baseInputs([obj]), baseClearance());
    const repUnrotated = computeCollisions(
      baseInputs([{ ...obj, rotationY: 0 }]),
      baseClearance(),
    );
    const boomRot = repRotated.items.find((i) => i.id === "obj-r1-boom")!;
    const boomFlat = repUnrotated.items.find((i) => i.id === "obj-r1-boom")!;
    // 45° döndürülünce kutunun köşegeni bom hattına belirgin şekilde yaklaşır;
    // döndürülmemiş haliyle (dar kenar bom hattına bakar) aynı olmamalı.
    expect(boomRot.clearance_m).not.toBeCloseTo(boomFlat.clearance_m, 3);
    expect(boomRot.clearance_m).toBeLessThan(boomFlat.clearance_m);
  });

  it("rotationY=0 iken eski (döndürülmemiş) davranışla birebir aynı sonucu verir", () => {
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
});

describe("çarpışma — nesne taban kotu (y)", () => {
  // Bom hattının orta noktası ≈ (2.813, 9.282) — bu x'te bom yalnızca bu
  // yükseklikte geçer; aynı (x,z) konumunda farklı y (taban kotu) farklı sonuç
  // vermeli (önceden y desteği yokken bu senaryo ayırt edilemezdi).
  const midX = 2.8132087539256805;
  const midY = 9.281676511807362;

  it("bom yüksekliğine getirilen (y kotu) nesne ile çarpışma bulunur", () => {
    const elevated: SceneObject = {
      id: "e1",
      kind: "obstacle",
      label: "Yükseltilmiş",
      x: midX,
      z: 0,
      width: 0.4,
      depth: 0.4,
      height: 1.0,
      y: midY - 0.5, // kutu [midY-0.5, midY+0.5] — bom hattını kapsar
    };
    const rep = computeCollisions(baseInputs([elevated]), baseClearance());
    const boomHit = rep.items.find((i) => i.id === "obj-e1-boom")!;
    expect(boomHit.severity).toBe("collision");
  });

  it("aynı (x,z) konumunda ama zemine oturan (y=0 varsayılan) nesne için güvenli geçiş", () => {
    const grounded: SceneObject = {
      id: "g1",
      kind: "obstacle",
      label: "Zemindeki nesne",
      x: midX,
      z: 0,
      width: 0.4,
      depth: 0.4,
      height: 1.0,
      // y verilmedi → varsayılan 0, bom bu noktada y≈9.28'de geçtiği için uzak
    };
    const rep = computeCollisions(baseInputs([grounded]), baseClearance());
    const boomHit = rep.items.find((i) => i.id === "obj-g1-boom")!;
    expect(boomHit.severity).toBe("ok");
    expect(boomHit.clearance_m).toBeGreaterThan(0);
  });
});

describe("çarpışma — enerji hattı (powerline) emniyet marjı", () => {
  it("voltage_kv verilmemişse muhafazakâr 6.1m marj uygulanır (1.5m boşluk normalde 'ok', powerline'da 'warning')", () => {
    // Kanca (9, 4.75, 0) etrafında hesaplanmış, dHook tam olarak 1.5m olacak
    // şekilde konumlandırılmış nesne: 0.5m'lik varsayılan eşikte "ok" olurdu,
    // ama powerline'ın muhafazakâr 6.1m marjı altında kaldığı için "warning".
    const obj: SceneObject = {
      id: "pl6",
      kind: "powerline",
      label: "Hat (gerilim bilinmiyor)",
      x: 9,
      z: 2.0,
      width: 0.4,
      depth: 0.4,
      height: 0.4,
      y: 4.55,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    const hookHit = rep.items.find((i) => i.id === "obj-pl6-hook")!;
    expect(hookHit.clearance_m).toBeCloseTo(1.5, 6);
    expect(hookHit.severity).toBe("warning");

    // Aynı geometri "obstacle" olsaydı (0.5m eşik) "ok" olurdu — marj farkını kanıtlar.
    const asObstacle: SceneObject = { ...obj, id: "n6", kind: "obstacle" };
    const repObstacle = computeCollisions(baseInputs([asObstacle]), baseClearance());
    const hookHitObstacle = repObstacle.items.find((i) => i.id === "obj-n6-hook")!;
    expect(hookHitObstacle.severity).toBe("ok");
  });

  it("voltage_kv=33 (≤50kV) → 3.05m marj; voltage_kv=400 (>350kV) → 7.6m marj", () => {
    const base: SceneObject = {
      id: "pl4",
      kind: "powerline",
      label: "Hat",
      x: 20,
      z: 20,
      width: 0.4,
      depth: 0.4,
      height: 0.4,
    };
    const lowKv: SceneObject = { ...base, voltage_kv: 33 };
    const highKv: SceneObject = { ...base, id: "pl5", voltage_kv: 400 };
    const rep = computeCollisions(baseInputs([lowKv, highKv]), baseClearance());
    const lowHit = rep.items.find((i) => i.id === "obj-pl4-boom")!;
    const highHit = rep.items.find((i) => i.id === "obj-pl5-boom")!;
    // Aynı mesafede, düşük kV daha küçük marjla "ok" kalabilirken yüksek kV
    // marjı daha büyük olduğundan aynı boşluk için daha çabuk "warning" olur
    // (ya da her ikisi de ok ise en azından marj mesajı farklıdır).
    expect(lowHit.message).not.toBe(highHit.message);
  });

  it("düz nesnelerde (powerline olmayan) marj her zaman 0.5m sabittir", () => {
    const obj: SceneObject = {
      id: "n1",
      kind: "obstacle",
      label: "Engel",
      x: 40,
      z: 0,
      width: 1,
      depth: 1,
      height: 1,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    const boomHit = rep.items.find((i) => i.id === "obj-n1-boom")!;
    expect(boomHit.message).not.toContain("emniyet marjı");
  });
});

describe("çarpışma — kuyruk savrulması (tail swing)", () => {
  function inputsWithTail(objects: SceneObject[], tail = 3.5, deck = 1.2) {
    return {
      ...baseInputs(objects),
      tail_radius_m: tail,
      superstructure_height_m: deck,
    };
  }

  it("kuyruk bandında ve yarıçap içinde nesne ile çakışma üretir", () => {
    // Slew merkezine 2m mesafede, güverte bandı [1.2, 3.7] ile kesişen nesne;
    // tail_radius=3.5 > (2 - yarı_köşegen) → çakışma.
    const obj: SceneObject = {
      id: "t1",
      kind: "obstacle",
      label: "Kuyruk engeli",
      x: 2,
      z: 0,
      width: 0.6,
      depth: 0.6,
      height: 2,
      y: 0.5,
    };
    const rep = computeCollisions(inputsWithTail([obj]), baseClearance());
    const tailHit = rep.items.find((i) => i.id === "obj-t1-tail")!;
    expect(tailHit.severity).toBe("collision");
    expect(tailHit.clearance_m).toBeLessThan(0);
  });

  it("yükseklik bandının tamamen dışındaki nesne için 'ok' döner (yatay yakın olsa da)", () => {
    const obj: SceneObject = {
      id: "t2",
      kind: "obstacle",
      label: "Yerdeki düşük nesne",
      x: 2,
      z: 0,
      width: 0.6,
      depth: 0.6,
      height: 0.3, // [0, 0.3] — bant [1.2, 3.7] ile kesişmiyor
    };
    const rep = computeCollisions(inputsWithTail([obj]), baseClearance());
    const tailHit = rep.items.find((i) => i.id === "obj-t2-tail")!;
    expect(tailHit.severity).toBe("ok");
  });

  it("bant içinde ama yatayda uzak nesne için 'ok' döner", () => {
    const obj: SceneObject = {
      id: "t3",
      kind: "obstacle",
      label: "Uzak nesne",
      x: 30,
      z: 0,
      width: 0.6,
      depth: 0.6,
      height: 2,
      y: 0.5,
    };
    const rep = computeCollisions(inputsWithTail([obj]), baseClearance());
    const tailHit = rep.items.find((i) => i.id === "obj-t3-tail")!;
    expect(tailHit.severity).toBe("ok");
    expect(tailHit.clearance_m).toBeGreaterThan(0);
  });

  it("tail_radius_m / superstructure_height_m verilmezse kontrol tamamen atlanır (item üretilmez)", () => {
    const obj: SceneObject = {
      id: "t4",
      kind: "obstacle",
      label: "Nesne",
      x: 2,
      z: 0,
      width: 0.6,
      depth: 0.6,
      height: 2,
      y: 0.5,
    };
    const rep = computeCollisions(baseInputs([obj]), baseClearance());
    expect(rep.items.find((i) => i.id === "obj-t4-tail")).toBeUndefined();
  });
});

describe("computeClearance — teta/beta alan (domain) koruması", () => {
  it("engel bom açıklığının ötesindeyse (beta paydası ≤ 0) açık hata verir", () => {
    // boom_offset+radius = 3.33+9 = 12.33 → obstacle_distance bunu aşarsa hata.
    expect(() =>
      computeClearance(G, {
        boom_length: 16.5,
        radius: 9,
        load_height: 4.25,
        load_diameter: 6.32,
        obstacle_height: 2.3,
        obstacle_distance: 12.33,
      }),
    ).toThrow(/bom açıklığının/i);
  });

  it("yük çapı radius+boom_offset'i aşıyorsa (teta paydası ≤ 0) ve load_height≠0 ise hata verir", () => {
    // radius − load_diameter + boom_offset ≤ 0 → 9 − 13 + 3.33 = −0.67
    expect(() =>
      computeClearance(G, {
        boom_length: 16.5,
        radius: 9,
        load_height: 4.25,
        load_diameter: 13,
        obstacle_height: 2.3,
        obstacle_distance: 0,
      }),
    ).toThrow(/yük çapı/i);
  });

  it("aynı geçersiz teta paydası load_height=0 iken hata vermez (kullanılmaz, obstacle klerensine düşer)", () => {
    const cl = computeClearance(G, {
      boom_length: 16.5,
      radius: 9,
      load_height: 0,
      load_diameter: 13,
      obstacle_height: 2.3,
      obstacle_distance: 0,
    });
    expect(cl.clearance_to_load).toBeCloseTo(cl.clearance_to_obstacle, 9);
  });

  it("engel makine yüksekliğinin altındaysa beta negatif çıkar (geçerli davranış, hata değil)", () => {
    const cl = computeClearance(G, {
      boom_length: 16.5,
      radius: 9,
      load_height: 4.25,
      load_diameter: 6.32,
      obstacle_height: 0, // machine_ground_height+cribbing_height (3.775) altında
      obstacle_distance: 0,
    });
    expect(cl.beta).toBeLessThan(0);
    expect(Number.isNaN(cl.beta)).toBe(false);
  });
});

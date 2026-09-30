// Vinç ölçü verisi tutarlılığı + çizim geometrisi (craneRig) ↔ klerens hesabı
// uyumu. Amaç: 2B/3B çizim ile hesap sonucu asla ayrışmasın ve veri kendi
// içinde fiziksel olarak tutarlı olsun.

import { describe, it, expect } from "vitest";
import { CRANES } from "../data/cranes";
import { computeClearance } from "../engine/clearance.js";
import { parseOutriggerConfig } from "../engine/outrigger.js";
import { computeLiftFull, superstructureHeightOnOutriggers } from "../engine/index.js";
import { buildRig, resolveDims } from "../ui/craneRig";
import type { LiftInputs } from "../engine/types.js";

describe.each(CRANES.map((c) => [c.model, c] as const))("%s — ölçü verisi", (_name, crane) => {
  const d = crane.dimensions!;

  it("dimensions bloğu var ve kaynaklı", () => {
    expect(d).toBeDefined();
    expect(d.source && d.source.length > 20).toBe(true);
  });

  it("SANY ikame verisi Liebherr'lere kopyalanmamış", () => {
    if (crane.model.includes("LIEBHERR")) expect(crane.datasheet_substitute).toBeUndefined();
  });

  it("bom mafsalı konumu hesap geometrisiyle aynı (çizim = klerens)", () => {
    expect(d.boom_pivot_x_m).toBeCloseTo(-crane.geometry_constants.boom_offset, 9);
  });

  it("aks konumları artan ve şasi içinde; sayı axle_count ile uyumlu", () => {
    const ax = d.axle_positions_m!;
    expect(ax).toHaveLength(d.axle_count);
    for (let i = 1; i < ax.length; i++) expect(ax[i]).toBeGreaterThan(ax[i - 1]);
    expect(ax[0]).toBeGreaterThan(0);
    expect(ax[ax.length - 1]).toBeLessThan(d.carrier_length_m);
  });

  it("slew merkezi şasi üzerinde", () => {
    const f = d.slew_center_from_front_m!;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(d.carrier_length_m);
  });

  it("denge ağırlığı yarıçapı kuyruk yarıçapından küçük", () => {
    if (crane.counterweight_radius_m != null) {
      expect(crane.counterweight_radius_m).toBeLessThan(d.tail_radius_m);
    }
  });

  it("maks. denge ağırlığı seçeneklerle uyumlu", () => {
    expect(d.counterweight_max_t).toBe(Math.max(...crane.counterweight_options));
  });

  it("ayak açıklıkları şasi genişliğinden büyük (ayak açık)", () => {
    for (const cfg of crane.outrigger_configs) {
      const { Lx, Ly } = parseOutriggerConfig(cfg);
      expect(Ly).toBeGreaterThan(d.carrier_width_m);
      expect(Lx).toBeGreaterThan(4);
    }
  });

  it("bazik bom en kısa bom uzunluğuna eşit", () => {
    expect(d.boom_stowed_length_m).toBeCloseTo(Math.min(...crane.boom_lengths), 6);
  });
});

describe.each(CRANES.map((c) => [c.model, c] as const))("%s — çizim geometrisi (craneRig)", (_name, crane) => {
  const g = crane.geometry_constants;
  const boom = crane.boom_lengths[Math.floor(crane.boom_lengths.length / 2)];
  const radius = 10;
  const c = computeClearance(g, {
    boom_length: boom, radius, load_height: 2, load_diameter: 2, obstacle_height: 0, obstacle_distance: 0,
  });
  const { Lx, Ly } = parseOutriggerConfig(crane.outrigger_configs[0]);
  const rig = buildRig({
    crane, boom_length: boom, gama: c.gama, withSheaveOffset: true,
    counterweight: Math.max(...crane.counterweight_options), Lx, Ly,
  });

  it("makara noktası tam radius'ta (halat dik iner)", () => {
    expect(rig.boom.sheave.x).toBeCloseTo(radius, 9);
  });

  it("makara yüksekliği − makara çapı − kanca = maks. kanca yüksekliği", () => {
    expect(rig.boom.sheave.y - g.sheave_diameter - g.hook_height).toBeCloseTo(c.max_hook_height, 9);
  });

  it("bom ekseni klerens doğrusuyla aynı açıda (α+γ)", () => {
    expect(rig.boom.axisAngle).toBeCloseTo(c.alfa + c.gama, 12);
  });

  it("teleskop bölümleri mafsaldan başlayıp tam bom uzunluğunda biter", () => {
    const s = rig.boom.sections;
    expect(s[0].s0).toBeCloseTo(0, 9);
    expect(s[s.length - 1].s1).toBeCloseTo(boom, 9);
    for (let i = 1; i < s.length; i++) {
      expect(s[i].s1).toBeGreaterThanOrEqual(s[i - 1].s1);
      expect(s[i].depth).toBeLessThan(s[i - 1].depth);
    }
  });

  it("ayak tablaları hesap modeliyle aynı yerde (arka f·Lx, ön (1−f)·Lx, ±Ly/2)", () => {
    const f = crane.dimensions!.outrigger_rear_fraction ?? 0.5;
    const xs = rig.outriggers.pads.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(f * Lx, 9);
    expect(Math.min(...xs)).toBeCloseTo(-(1 - f) * Lx, 9);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Lx, 9);
    rig.outriggers.pads.forEach((p) => expect(Math.abs(p.z)).toBeCloseTo(Ly / 2, 9));
  });

  it("denge ağırlığının arka kenarı kuyruk yarıçapının içinde (köşe = kuyruk R)", () => {
    const tail = resolveDims(crane).tail_radius_m;
    expect(-rig.counterweight.u0).toBeLessThanOrEqual(tail + 1e-9);
    expect(-rig.counterweight.u0).toBeGreaterThan(tail - 1.2);
    expect(rig.counterweight.plates).toBeGreaterThan(0);
  });

  it("ayaklarda tekerlekler yerden kalkık", () => {
    expect(rig.carrier.tireY - rig.carrier.tireR).toBeGreaterThan(0);
  });
});

describe("kuyruk savrulma kontrolü tüm vinçlerde aktif", () => {
  const inp = (crane: (typeof CRANES)[number]): LiftInputs => ({
    load_weight: 5, hook_weight: 1, rigging_weight: 0.2, load_height: 2, load_diameter: 2,
    obstacle_height: 0, obstacle_distance: 0, boom_length: crane.boom_lengths[0],
    radius: 6, counterweight: crane.counterweight_options[0], capacity_pct: (crane.capacity_pct_options ?? [85])[0],
  });

  it.each(CRANES.map((c) => [c.model, c] as const))("%s: kuyruğun içine giren duvar çarpışma verir", (_n, crane) => {
    const tail = crane.dimensions!.tail_radius_m;
    // Slew 0 → bom +X; kuyruk −X yönünde. Duvar kuyruk yarıçapının 0,3 m içinde.
    const r = computeLiftFull(crane, inp(crane), {
      outrigger_config: crane.outrigger_configs[0],
      slew_angle: 0,
      objects: [{ id: "w", kind: "building", label: "Duvar", x: -(tail - 0.3) - 1, z: 0, width: 2, depth: 6, height: 8 }],
    });
    const t = r.collision.items.find((i) => i.source === "tail");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("collision");
  });

  it("üst yapı bandı ayaklarda seyir değerinden yüksek (makine kalkar)", () => {
    for (const crane of CRANES) {
      const h = superstructureHeightOnOutriggers(crane)!;
      expect(h).toBeGreaterThanOrEqual(crane.dimensions!.superstructure_deck_height_m!);
    }
  });
});

describe.each(CRANES.map((c) => [c.model, c] as const))("%s — vince özgü görünüm (appearance)", (_name, crane) => {
  const app = crane.appearance!;

  it("çizimden profil + kaynak var", () => {
    expect(app).toBeDefined();
    expect(app.source.length).toBeGreaterThan(20);
    expect(app.carrier.length).toBeGreaterThan(2);
    expect(app.superstructure.length).toBeGreaterThan(1);
  });

  it("şasi profilleri şasi boyu içinde ve seyir yüksekliğinin altında", () => {
    const d = crane.dimensions!;
    for (const part of app.carrier) {
      expect(part.pts.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of part.pts) {
        expect(x).toBeGreaterThanOrEqual(-0.1);
        expect(x).toBeLessThanOrEqual(d.carrier_length_m + 0.1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(d.travel_height_m! + 0.1);
      }
    }
  });

  it("üst yapı profilleri kuyruk yarıçapı içinde", () => {
    const tail = crane.dimensions!.tail_radius_m;
    for (const part of app.superstructure) for (const [u] of part.pts) expect(u).toBeGreaterThanOrEqual(-tail - 0.05);
  });

  it("renk anahtarları çözülüyor", () => {
    for (const part of [...app.carrier, ...app.superstructure]) {
      expect(part.color.startsWith("#") || part.color in app.colors).toBe(true);
    }
  });
});

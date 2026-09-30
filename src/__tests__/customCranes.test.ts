import { describe, expect, it } from "vitest";
import ltm1160 from "../data/ltm1160.json";
import ltm1250 from "../data/ltm1250.json";
import sac2500e from "../data/sac2500e.json";
import {
  buildCraneFromForm,
  craneTemplateJson,
  isBuiltInModel,
  loadCustomCranes,
  parseLoadChartCsv,
  removeCustomCrane,
  saveCustomCranes,
  upsertCustomCrane,
  validateCraneModel,
} from "../data/customCranes";
import { loadChartLookup } from "../engine/capacity";
import type { CraneModel, GeometryConstants } from "../engine/types";

const GEO: GeometryConstants = {
  cribbing_height: 0.3,
  machine_ground_height: 3.475,
  boom_offset: 3.33,
  sheave_diameter: 0.417,
  hook_height: 1.0,
  sheave_offset: 1.321,
  boom_thickness: 1.25,
};

describe("validateCraneModel", () => {
  it.each([
    ["ltm1160", ltm1160],
    ["ltm1250", ltm1250],
    ["sac2500e", sac2500e],
  ])("yerleşik %s JSON geçerli", (_n, json) => {
    const v = validateCraneModel(json);
    if (!v.ok) throw new Error(v.errors.join("\n"));
    expect(v.ok).toBe(true);
  });

  it("şablon JSON geçerli", () => {
    expect(validateCraneModel(JSON.parse(craneTemplateJson())).ok).toBe(true);
  });

  it("nesne olmayan girdi reddedilir", () => {
    const v = validateCraneModel([1, 2]);
    expect(v.ok).toBe(false);
  });

  it("eksik/bozuk alanlar hata listesi üretir", () => {
    const bad = JSON.parse(craneTemplateJson());
    bad.model = "  ";
    delete bad.geometry_constants.hook_height;
    bad.boom_lengths = [];
    bad.outrigger_configs = ["abc"];
    bad.self_weight = "ağır";
    bad.load_chart["10"]["100"]["12"] = [
      [5, 40],
      [3, 60],
    ];
    bad.load_chart["10"]["100"]["20"] = [[4, 0]];
    const v = validateCraneModel(bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join("\n");
    expect(all).toMatch(/model/);
    expect(all).toMatch(/hook_height/);
    expect(all).toMatch(/boom_lengths/);
    expect(all).toMatch(/ayak konfigürasyonu/);
    expect(all).toMatch(/self_weight/);
    expect(all).toMatch(/kesin artan/);
    expect(all).toMatch(/kapasite pozitif/);
  });

  it("boş load_chart reddedilir", () => {
    const bad = JSON.parse(craneTemplateJson());
    bad.load_chart = {};
    expect(validateCraneModel(bad).ok).toBe(false);
  });
});

describe("parseLoadChartCsv", () => {
  it("virgül ayraçlı, başlıklı, sırasız satırları sıralar", () => {
    const csv = [
      "counterweight,capacity_pct,boom_length,radius,capacity",
      "10,100,12,8,25",
      "10,100,12,3,60",
      "10,100,12,5,42",
      "10,100,20.5,4,40",
      "",
    ].join("\n");
    const r = parseLoadChartCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.chart["10"]["100"]["12"]).toEqual([
      [3, 60],
      [5, 42],
      [8, 25],
    ]);
    expect(r.chart["10"]["100"]["20.5"]).toEqual([[4, 40]]);
    expect(r.counterweights).toEqual([10]);
    expect(r.pcts).toEqual([100]);
    expect(r.booms).toEqual([12, 20.5]);
  });

  it("noktalı virgül + ondalık virgül (başlıksız)", () => {
    const csv = "24;85;14,1;3;176\r\n24;85;14,1;3,5;148\r\n0;75;14,1;3;120,5";
    const r = parseLoadChartCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.chart["24"]["85"]["14.1"]).toEqual([
      [3, 176],
      [3.5, 148],
    ]);
    expect(r.chart["0"]["75"]["14.1"]).toEqual([[3, 120.5]]);
    expect(r.counterweights).toEqual([0, 24]);
    expect(r.pcts).toEqual([75, 85]);
  });

  it("bozuk, eksik sütunlu ve tekrar eden satırları raporlar", () => {
    const csv = ["10,100,12,3,60", "10,100,12,abc,50", "10,100,12", "10,100,12,3,55", "10,100,12,5,-1"].join("\n");
    const r = parseLoadChartCsv(csv);
    expect(r.errors.length).toBe(4);
    expect(r.errors.join("\n")).toMatch(/Satır 2/);
    expect(r.errors.join("\n")).toMatch(/Satır 3/);
    expect(r.errors.join("\n")).toMatch(/tekrar/);
    expect(r.errors.join("\n")).toMatch(/Satır 5/);
    expect(r.chart["10"]["100"]["12"]).toEqual([[3, 60]]);
  });

  it("boş CSV hata verir", () => {
    expect(parseLoadChartCsv("  \n").errors.length).toBeGreaterThan(0);
  });
});

describe("buildCraneFromForm", () => {
  const csv = "cw;pct;boom;r;cap\n10;100;12;8;25\n10;100;12;3;60\n10;100;12;5;42\n10;100;20;4;40\n10;100;20;12;13";

  it("motorun sorgulayabileceği bir vinç üretir", () => {
    const res = buildCraneFromForm({
      model: "Benim Vincim 60t",
      geometry_constants: GEO,
      self_weight: 36,
      outrigger_config: "9x7,8",
      csv,
    });
    if (!res.ok) throw new Error(res.errors.join("\n"));
    const c = res.crane;
    expect(c.source).toBe("Kullanıcı tanımlı (Makinelerim)");
    expect(c.counterweight_options).toEqual([10]);
    expect(c.boom_lengths).toEqual([12, 20]);
    expect(c.capacity_pct_options).toEqual([100]);
    expect(loadChartLookup(c, 10, 100, 12, 3)).toBe(60);
    expect(loadChartLookup(c, 10, 100, 12, 4)).toBe(42); // step-down
    expect(loadChartLookup(c, 10, 100, 20, 12)).toBe(13);
  });

  it("geçersiz ayak ve eksik kapasite modu hatası", () => {
    const res = buildCraneFromForm({
      model: "X",
      geometry_constants: GEO,
      self_weight: null,
      outrigger_config: "dokuz",
      csv,
      capacity_pct_options: [75],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join("\n")).toMatch(/ayak/);
    expect(res.errors.join("\n")).toMatch(/%75/);
  });

  it("boş model adı reddedilir", () => {
    const res = buildCraneFromForm({ model: " ", geometry_constants: GEO, self_weight: 1, outrigger_config: "9x7", csv });
    expect(res.ok).toBe(false);
  });
});

describe("isBuiltInModel + localStorage", () => {
  it("yerleşik isim çakışması (büyük/küçük harf duyarsız)", () => {
    const b = [ltm1160 as unknown as CraneModel];
    expect(isBuiltInModel("liebherr ltm 1160", b)).toBe(true);
    expect(isBuiltInModel("Başka Vinç", b)).toBe(false);
  });

  it("localStorage yokken (node) güvenli çalışır", () => {
    expect(() => saveCustomCranes([])).not.toThrow();
    expect(loadCustomCranes()).toEqual([]);
  });

  it("bellek içi localStorage ile ekle/güncelle/sil", () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    try {
      const tpl = JSON.parse(craneTemplateJson()) as CraneModel;
      expect(upsertCustomCrane(tpl)).toHaveLength(1);
      expect(upsertCustomCrane({ ...tpl, self_weight: 50 })).toHaveLength(1);
      expect(loadCustomCranes()[0].self_weight).toBe(50);
      expect(upsertCustomCrane({ ...tpl, model: "İkinci" })).toHaveLength(2);
      expect(removeCustomCrane(tpl.model).map((c) => c.model)).toEqual(["İkinci"]);
      store.set("hareket_custom_cranes", "{bozuk json");
      expect(loadCustomCranes()).toEqual([]);
    } finally {
      g.window = prev;
    }
  });
});

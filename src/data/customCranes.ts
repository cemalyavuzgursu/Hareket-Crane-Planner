/**
 * customCranes.ts — "Makinelerim": kullanıcının kendi tanımladığı vinçler.
 *
 * - validateCraneModel: dışarıdan gelen (JSON) vinç tanımını doğrular.
 * - parseLoadChartCsv: CSV yük tablosunu iç içe load_chart yapısına çevirir.
 * - buildCraneFromForm: form + CSV'den CraneModel üretir ve doğrular.
 * - localStorage kalıcılığı (anahtar "hareket_custom_cranes").
 *
 * GÜVENLİK: Yük tablosu değerleri doğrudan kaldırma güvenliğini etkiler.
 * Burada yalnız yapısal/tutarlılık kontrolü yapılır; değerlerin üretici
 * tablosuyla doğruluğu kullanıcının sorumluluğundadır.
 */
import type { ChartPoint, CraneModel, GeometryConstants, LoadChart } from "../engine/types";
import { parseOutriggerConfig } from "../engine/outrigger";

export const CUSTOM_CRANES_STORAGE_KEY = "hareket_custom_cranes";
export const CUSTOM_CRANE_SOURCE = "Kullanıcı tanımlı (Makinelerim)";

export const GEOMETRY_KEYS: Array<keyof GeometryConstants> = [
  "cribbing_height",
  "machine_ground_height",
  "boom_offset",
  "sheave_diameter",
  "hook_height",
  "sheave_offset",
  "boom_thickness",
];

export const GEOMETRY_LABELS: Record<keyof GeometryConstants, string> = {
  cribbing_height: "Takoz yüksekliği (m)",
  machine_ground_height: "Makine yerden yüksekliği (m)",
  boom_offset: "Bom ofseti (m)",
  sheave_diameter: "Makara çapı (m)",
  hook_height: "Kanca yüksekliği (m)",
  sheave_offset: "Makara ofseti (m)",
  boom_thickness: "Bom kalınlığı payı (m)",
};

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function isNumArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every(isNum);
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

export function validateCraneModel(
  x: unknown,
): { ok: true; crane: CraneModel } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(x)) return { ok: false, errors: ["Vinç tanımı bir JSON nesnesi olmalı."] };

  // model
  if (typeof x.model !== "string" || x.model.trim() === "") {
    errors.push("\"model\" alanı boş olmayan bir metin olmalı.");
  }

  // geometry_constants
  const g = x.geometry_constants;
  if (!isObj(g)) {
    errors.push("\"geometry_constants\" nesnesi eksik.");
  } else {
    for (const k of GEOMETRY_KEYS) {
      if (!isNum(g[k])) errors.push(`geometry_constants.${k} (${GEOMETRY_LABELS[k]}) sayısal olmalı.`);
    }
  }

  // self_weight
  if (!(x.self_weight === null || isNum(x.self_weight))) {
    errors.push("\"self_weight\" sayı veya null olmalı.");
  } else if (isNum(x.self_weight) && x.self_weight < 0) {
    errors.push("\"self_weight\" negatif olamaz.");
  }

  // counterweight_options / boom_lengths
  if (!isNumArray(x.counterweight_options) || x.counterweight_options.length === 0) {
    errors.push("\"counterweight_options\" boş olmayan bir sayı dizisi olmalı.");
  }
  if (!isNumArray(x.boom_lengths) || x.boom_lengths.length === 0) {
    errors.push("\"boom_lengths\" boş olmayan bir sayı dizisi olmalı.");
  } else if (x.boom_lengths.some((b) => b <= 0)) {
    errors.push("\"boom_lengths\" değerleri pozitif olmalı.");
  }

  // capacity_pct_options (opsiyonel)
  if (x.capacity_pct_options !== undefined) {
    if (!isNumArray(x.capacity_pct_options) || x.capacity_pct_options.length === 0) {
      errors.push("\"capacity_pct_options\" verilmişse boş olmayan bir sayı dizisi olmalı.");
    } else if (x.capacity_pct_options.some((p) => p <= 0 || p > 100)) {
      errors.push("\"capacity_pct_options\" değerleri 0 < % ≤ 100 aralığında olmalı.");
    }
  }

  // outrigger_configs
  if (
    !Array.isArray(x.outrigger_configs) ||
    x.outrigger_configs.length === 0 ||
    !x.outrigger_configs.every((s) => typeof s === "string")
  ) {
    errors.push("\"outrigger_configs\" boş olmayan bir metin dizisi olmalı (ör. [\"9x7,8\"]).");
  } else {
    for (const s of x.outrigger_configs as string[]) {
      try {
        parseOutriggerConfig(s);
      } catch {
        errors.push(`Geçersiz ayak konfigürasyonu: "${s}" (beklenen "Lx x Ly", ör. "9x7,8").`);
      }
    }
  }

  // load_chart
  const lc = x.load_chart;
  if (!isObj(lc) || Object.keys(lc).length === 0) {
    errors.push("\"load_chart\" boş olmayan bir nesne olmalı.");
  } else {
    let curveCount = 0;
    for (const [cw, pcts] of Object.entries(lc)) {
      if (!isFinite(parseFloat(cw))) errors.push(`load_chart: geçersiz denge ağırlığı anahtarı "${cw}".`);
      // Boş alt tablo (ör. henüz doldurulmamış %75 seti) hata değildir; o
      // kombinasyon motor tarafından "tablo yok" olarak reddedilir.
      if (!isObj(pcts)) {
        errors.push(`load_chart[${cw}]: kapasite yüzdesi tabloları bir nesne olmalı.`);
        continue;
      }
      for (const [pct, booms] of Object.entries(pcts)) {
        if (!isFinite(parseFloat(pct))) errors.push(`load_chart[${cw}]: geçersiz kapasite yüzdesi anahtarı "${pct}".`);
        if (!isObj(booms)) {
          errors.push(`load_chart[${cw}][${pct}]: bom eğrileri bir nesne olmalı.`);
          continue;
        }
        for (const [boom, curve] of Object.entries(booms)) {
          const where = `load_chart[${cw}t][%${pct}][${boom}m]`;
          if (!isFinite(parseFloat(boom))) errors.push(`${where}: geçersiz bom uzunluğu anahtarı.`);
          if (!Array.isArray(curve) || curve.length === 0) {
            errors.push(`${where}: eğri boş.`);
            continue;
          }
          curveCount++;
          let prevR = -Infinity;
          for (let i = 0; i < curve.length; i++) {
            const p = curve[i] as unknown;
            if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1])) {
              errors.push(`${where}: ${i + 1}. nokta [radius, kapasite] sayı çifti olmalı.`);
              continue;
            }
            const [r, c] = p as [number, number];
            if (r < 0) errors.push(`${where}: ${i + 1}. noktada radius negatif (${r}).`);
            if (!(c > 0)) errors.push(`${where}: ${r} m radius'ta kapasite pozitif olmalı (${c}).`);
            if (!(r > prevR)) {
              errors.push(`${where}: radius kesin artan olmalı (${prevR} → ${r}).`);
            }
            prevR = r;
          }
        }
      }
    }
    if (curveCount === 0) errors.push("load_chart hiç eğri içermiyor.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, crane: x as unknown as CraneModel };
}

// ---------------------------------------------------------------------------
// CSV yük tablosu
// ---------------------------------------------------------------------------

function uniqSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/**
 * CSV satırları: counterweight,capacity_pct,boom_length,radius,capacity
 * Ayraç: ',' (varsayılan), ';' (ondalık virgül serbest) veya TAB.
 * Başlık satırı opsiyoneldir; '#' ile başlayan satırlar yorumdur.
 */
export function parseLoadChartCsv(csv: string): {
  chart: LoadChart;
  counterweights: number[];
  pcts: number[];
  booms: number[];
  errors: string[];
} {
  const errors: string[] = [];
  const chart: LoadChart = {};
  const cws: number[] = [];
  const pcts: number[] = [];
  const booms: number[] = [];

  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  const sep = nonEmpty.some((l) => l.includes(";")) ? ";" : nonEmpty.some((l) => l.includes("\t")) ? "\t" : ",";
  const decimalComma = sep !== ",";

  const num = (s: string): number => {
    let t = s.trim();
    if (decimalComma) t = t.replace(",", ".");
    if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return NaN;
    return Number(t);
  };

  let firstDataSeen = false;
  const seen = new Set<string>();

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const lineNo = idx + 1;
    if (line === "" || line.startsWith("#")) return;
    const cells = line.split(sep);
    const vals = cells.map(num);

    if (!firstDataSeen) {
      firstDataSeen = true;
      // Başlık satırı: ilk hücre sayı değilse atla.
      if (!isFinite(vals[0])) return;
    }

    if (cells.length < 5) {
      errors.push(`Satır ${lineNo}: 5 sütun bekleniyor (denge, %, bom, radius, kapasite), ${cells.length} bulundu.`);
      return;
    }
    const [cw, pct, boom, r, c] = vals;
    if (![cw, pct, boom, r, c].every((v) => isFinite(v))) {
      errors.push(`Satır ${lineNo}: sayısal olmayan değer ("${line}").`);
      return;
    }
    if (cw < 0 || pct <= 0 || pct > 100 || boom <= 0 || r < 0) {
      errors.push(`Satır ${lineNo}: aralık dışı değer (denge ≥ 0, 0 < % ≤ 100, bom > 0, radius ≥ 0).`);
      return;
    }
    if (!(c > 0)) {
      errors.push(`Satır ${lineNo}: kapasite pozitif olmalı (${c}).`);
      return;
    }
    const k = `${cw}|${pct}|${boom}|${r}`;
    if (seen.has(k)) {
      errors.push(`Satır ${lineNo}: tekrar eden nokta (denge ${cw}t, %${pct}, bom ${boom}m, radius ${r}m).`);
      return;
    }
    seen.add(k);

    const a = (chart[String(cw)] ??= {});
    const b = (a[String(pct)] ??= {});
    const curve = (b[String(boom)] ??= []);
    curve.push([r, c] as ChartPoint);
    cws.push(cw);
    pcts.push(pct);
    booms.push(boom);
  });

  for (const byPct of Object.values(chart)) {
    for (const byBoom of Object.values(byPct)) {
      for (const curve of Object.values(byBoom)) curve.sort((p, q) => p[0] - q[0]);
    }
  }

  if (seen.size === 0 && errors.length === 0) errors.push("CSV'de hiç veri satırı yok.");

  return { chart, counterweights: uniqSorted(cws), pcts: uniqSorted(pcts), booms: uniqSorted(booms), errors };
}

// ---------------------------------------------------------------------------
// Formdan vinç
// ---------------------------------------------------------------------------

export function buildCraneFromForm(f: {
  model: string;
  geometry_constants: GeometryConstants;
  self_weight: number | null;
  outrigger_config: string;
  csv: string;
  capacity_pct_options?: number[];
}): { ok: true; crane: CraneModel } | { ok: false; errors: string[] } {
  const parsed = parseLoadChartCsv(f.csv);
  const errors = [...parsed.errors];

  let pctOptions = parsed.pcts;
  if (f.capacity_pct_options && f.capacity_pct_options.length > 0) {
    const missing = f.capacity_pct_options.filter((p) => !parsed.pcts.some((q) => Math.abs(q - p) < 1e-9));
    if (missing.length > 0 && parsed.pcts.length > 0) {
      errors.push(
        `Kapasite modları CSV'de yok: %${missing.join(", %")} (CSV'deki: %${parsed.pcts.join(", %")}).`,
      );
    }
    pctOptions = uniqSorted(f.capacity_pct_options);
  }

  const crane: CraneModel = {
    model: f.model.trim(),
    source: CUSTOM_CRANE_SOURCE,
    geometry_constants: { ...f.geometry_constants },
    self_weight: f.self_weight,
    capacity_pct_options: pctOptions,
    counterweight_options: parsed.counterweights,
    boom_lengths: parsed.booms,
    outrigger_configs: [f.outrigger_config.trim()],
    load_chart: parsed.chart,
  };

  const v = validateCraneModel(crane);
  if (!v.ok) errors.push(...v.errors);
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, crane };
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCustomCranes(): CraneModel[] {
  try {
    const ls = storage();
    if (!ls) return [];
    const raw = ls.getItem(CUSTOM_CRANES_STORAGE_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: CraneModel[] = [];
    for (const item of arr) {
      const v = validateCraneModel(item);
      if (v.ok) out.push(v.crane);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustomCranes(list: CraneModel[]): void {
  try {
    const ls = storage();
    if (!ls) return;
    ls.setItem(CUSTOM_CRANES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* kota/erişim hatası — sessizce yut */
  }
}

/** Aynı model adlı özel vinci değiştirir veya ekler; yeni listeyi kaydedip döndürür. */
export function upsertCustomCrane(c: CraneModel): CraneModel[] {
  const list = loadCustomCranes();
  const i = list.findIndex((x) => x.model === c.model);
  const next = i >= 0 ? list.map((x, j) => (j === i ? c : x)) : [...list, c];
  saveCustomCranes(next);
  return next;
}

export function removeCustomCrane(model: string): CraneModel[] {
  const next = loadCustomCranes().filter((x) => x.model !== model);
  saveCustomCranes(next);
  return next;
}

/** Model adı yerleşik bir vinçle çakışıyor mu (büyük/küçük harf ve boşluk duyarsız)? */
export function isBuiltInModel(model: string, builtIns: CraneModel[]): boolean {
  const norm = (s: string) =>
    s.trim().replace(/\s+/g, " ").replace(/[İIı]/g, "i").toLowerCase();
  const m = norm(model);
  return builtIns.some((b) => norm(b.model) === m);
}

// ---------------------------------------------------------------------------
// Şablon
// ---------------------------------------------------------------------------

export function craneTemplateJson(): string {
  const tpl: CraneModel = {
    model: "ÖRNEK VİNÇ 100t",
    source: CUSTOM_CRANE_SOURCE,
    geometry_constants: {
      cribbing_height: 0.3,
      machine_ground_height: 3.475,
      boom_offset: 3.33,
      sheave_diameter: 0.417,
      hook_height: 1.0,
      sheave_offset: 1.321,
      boom_thickness: 1.25,
    },
    self_weight: 48,
    capacity_pct_options: [100],
    counterweight_options: [10],
    boom_lengths: [12, 20],
    outrigger_configs: ["9x7,8"],
    notes:
      "ŞABLON — değerler örnektir, gerçek değildir. load_chart[denge_t][kapasite_%][bom_m] = [[radius_m, kapasite_t], ...] (radius artan). Üreticinin orijinal tablosundan doldurun.",
    load_chart: {
      "10": {
        "100": {
          "12": [
            [3, 60],
            [5, 42],
            [8, 25],
            [10, 18],
          ],
          "20": [
            [4, 40],
            [8, 22],
            [12, 13],
            [16, 8],
          ],
        },
      },
    },
  };
  return JSON.stringify(tpl, null, 2);
}

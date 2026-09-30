// Masaüstü proje dosyası (.json) → mobil AppState dönüşümü.
//
// Masaüstü "Dosya → Projeyi Kaydet" ile üretilen gövde (bkz. ../../src/ui/persistence.ts
// serializeProject): { version, state: UIState, steps: WorkStep[], meta: ProjectMeta }.
// Bu modül SAF fonksiyonlardan oluşur (RN / Expo bağımlılığı yok) → birim test edilebilir.
//
// Masaüstüne özgü özellikler (çevre nesneleri, tandem, al–bırak güzergâhı, saha
// konumu/yönü, aparat listesi ayrıntısı, zemin basıncı…) mobilde yoktur; bunlar
// düşürülür ve kullanıcıya uyarı olarak bildirilir.
import type { CraneModel, LiftConfig } from "./shared/engine/types";
import { type AppState, defaultState, reconcileForCrane } from "./state";

/** Masaüstü persistence katmanının okuyabildiği şema aralığı (desktop state.ts STATE_SCHEMA_VERSION).
 * Masaüstü şeması artarsa burası da güncellenmeli. */
export const MIN_PROJECT_VERSION = 1;
export const MAX_PROJECT_VERSION = 2;

type Raw = Record<string, unknown>;

/** Ayrıştırılmış (henüz eşlenmemiş) masaüstü projesi. */
export interface ParsedDesktopProject {
  version: number;
  projectName: string;
  /** Kaydedildiği andaki güncel plan (UIState ham nesnesi). */
  current: Raw;
  /** Çalışma adımları (ad + ham UIState snapshot). */
  steps: { name: string; config: Raw }[];
}

export interface ProjectImportResult {
  state: AppState;
  projectName: string;
  stepNames: string[];
  warnings: string[];
}

export type ParseOutcome =
  | { ok: true; project: ParsedDesktopProject }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** JSON metnini ayrıştırıp şekil/sürüm doğrulaması yapar (masaüstü isValidPersisted ile aynı kurallar).
 * Tanınmayan ek alanlar yok sayılır. Fırlatmaz. */
export function parseDesktopProject(json: string, fallbackName = ""): ParseOutcome {
  let data: unknown;
  try {
    // Bazı paylaşım uygulamaları UTF-8 BOM ekler — JSON.parse onu kabul etmez.
    data = JSON.parse(json.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "Dosya geçerli bir JSON değil. Masaüstünde “Projeyi Kaydet (.json)” ile üretilen dosyayı seçin." };
  }
  if (!isObj(data)) return { ok: false, error: "Dosya bir Hareket Crane Planner projesi değil." };
  const version = data.version;
  if (!isNum(version)) return { ok: false, error: "Dosya bir Hareket Crane Planner projesi değil (sürüm alanı yok)." };
  if (version > MAX_PROJECT_VERSION) {
    return {
      ok: false,
      error: `Bu proje daha yeni bir masaüstü sürümüyle kaydedilmiş (şema v${version}). Mobil uygulamayı güncelleyin.`,
    };
  }
  if (version < MIN_PROJECT_VERSION) return { ok: false, error: `Desteklenmeyen proje şeması (v${version}).` };
  const st = data.state;
  if (!isObj(st) || typeof st.craneModel !== "string") {
    return { ok: false, error: "Proje dosyasında vinç durumu (state.craneModel) bulunamadı." };
  }
  if (!Array.isArray(st.objects) || !Array.isArray(data.steps)) {
    return { ok: false, error: "Proje dosyası eksik veya bozuk (objects/steps alanları yok)." };
  }
  const steps: { name: string; config: Raw }[] = [];
  data.steps.forEach((s, i) => {
    if (isObj(s) && isObj(s.config) && typeof s.config.craneModel === "string") {
      steps.push({ name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : `Adım ${i + 1}`, config: s.config });
    }
  });
  const meta = isObj(data.meta) ? data.meta : {};
  const metaName = typeof meta.projectName === "string" ? meta.projectName.trim() : "";
  return {
    ok: true,
    project: {
      version,
      projectName: metaName || fallbackName.replace(/\.json$/i, "") || "Adsız proje",
      current: st,
      steps,
    },
  };
}

/** Aparat listesinden toplam ağırlık/yükseklik (masaüstü riggingTotals ile aynı). */
function riggingTotals(items: unknown[]): { weight: number; height: number } {
  return items.reduce<{ weight: number; height: number }>(
    (a, it) => {
      const o = isObj(it) ? it : {};
      return {
        weight: a.weight + (isNum(o.weight_t) ? o.weight_t : 0),
        height: a.height + (isNum(o.height_m) ? o.height_m : 0),
      };
    },
    { weight: 0, height: 0 },
  );
}

const fmt = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

/**
 * Ham masaüstü UIState → mobil AppState. Vinç mobil listede yoksa fırlatır.
 * Vince uymayan değerler (bom, denge, %, ayak, jib) mobilin reconcileForCrane
 * kuralıyla düzeltilir ve her düzeltme uyarı olarak raporlanır.
 */
export function mapDesktopState(raw: Raw, cranes: CraneModel[]): { state: AppState; warnings: string[] } {
  const warnings: string[] = [];
  const model = typeof raw.craneModel === "string" ? raw.craneModel : "";
  const crane = cranes.find((c) => c.model === model);
  if (!crane) {
    throw new Error(
      `Projedeki vinç (${model || "?"}) mobil uygulamada yok. Mevcut vinçler: ${cranes.map((c) => c.model).join(", ")}. ` +
        "Özel (kullanıcı tanımlı) vinçler mobile aktarılmaz.",
    );
  }
  const base = defaultState(crane);
  const num = (key: keyof AppState & string, label: string, min = -Infinity): number => {
    const v = raw[key];
    if (isNum(v) && v >= min) return v;
    if (v !== undefined) warnings.push(`${label} geçersiz (${fmt(v)}) — varsayılan ${fmt(base[key])} kullanıldı.`);
    return base[key] as number;
  };

  // Kaldırma aparatları: liste doluysa ağırlık/yükseklik listeden türetilir (masaüstü liftInputsFromState).
  const items = Array.isArray(raw.rigging_items) ? raw.rigging_items : [];
  let rigging_weight = num("rigging_weight", "Sapan/ekipman ağırlığı", 0);
  let rigging_height: number | undefined = isNum(raw.rigging_height) ? raw.rigging_height : undefined;
  if (items.length > 0) {
    const t = riggingTotals(items);
    rigging_weight = t.weight;
    rigging_height = t.height;
    warnings.push(
      `${items.length} kaldırma aparatı toplam olarak alındı (${t.weight.toFixed(2)} t, ${t.height.toFixed(2)} m); aparat ayrıntıları mobilde gösterilmez.`,
    );
  }

  const liftCfg = typeof raw.lift_config === "string" ? (raw.lift_config as LiftConfig) : "T";

  const candidate: AppState = {
    ...base,
    craneModel: crane.model,
    load_weight: num("load_weight", "Yük ağırlığı", 0),
    hook_weight: num("hook_weight", "Kanca bloğu ağırlığı", 0),
    rigging_weight,
    load_height: num("load_height", "Yük yüksekliği", 0),
    load_diameter: num("load_diameter", "Yük çapı", 0),
    obstacle_height: num("obstacle_height", "Engel yüksekliği", 0),
    obstacle_distance: num("obstacle_distance", "Engel uzaklığı"),
    obstacle_width: num("obstacle_width", "Engel genişliği", 0),
    boom_length: num("boom_length", "Bom uzunluğu", 0),
    radius: num("radius", "Radius", 0),
    counterweight: num("counterweight", "Denge ağırlığı", 0),
    capacity_pct: num("capacity_pct", "Kapasite oranı", 0),
    outrigger_config: typeof raw.outrigger_config === "string" ? raw.outrigger_config : base.outrigger_config,
    slew_angle: num("slew_angle", "Dönme açısı"),
    lift_config: liftCfg,
    jib_length: isNum(raw.jib_length) ? raw.jib_length : 0,
    jib_offset: isNum(raw.jib_offset) ? raw.jib_offset : 0,
  };
  // Hesaba giren opsiyonel LiftInputs alanları — masaüstüyle aynı sonucu vermek için taşınır.
  if (rigging_height !== undefined) candidate.rigging_height = rigging_height;
  if (isNum(raw.load_bottom_height)) candidate.load_bottom_height = raw.load_bottom_height;
  if (raw.clearance_model === "centered" || raw.clearance_model === "excel") candidate.clearance_model = raw.clearance_model;
  if (isNum(raw.load_wind_area_m2)) candidate.load_wind_area_m2 = raw.load_wind_area_m2;
  if (isNum(raw.load_drag_coefficient)) candidate.load_drag_coefficient = raw.load_drag_coefficient;

  // Vince uyumlama + her düzeltmeyi raporla.
  const state = reconcileForCrane(candidate, crane);
  const labels: [keyof AppState, string][] = [
    ["lift_config", "Kaldırma konfigürasyonu"],
    ["boom_length", "Bom uzunluğu"],
    ["counterweight", "Denge ağırlığı"],
    ["capacity_pct", "Kapasite oranı"],
    ["outrigger_config", "Ayak açıklığı"],
    ["jib_length", "Jib uzunluğu"],
    ["jib_offset", "Jib ofseti"],
  ];
  for (const [k, label] of labels) {
    if (state[k] !== candidate[k]) {
      warnings.push(`${label} ${fmt(candidate[k])} bu vinçte yok — ${fmt(state[k])} kullanıldı.`);
    }
  }

  // Mobilde olmayan masaüstü özellikleri.
  const objs = Array.isArray(raw.objects) ? raw.objects.length : 0;
  if (objs > 0) {
    warnings.push(`${objs} çevre nesnesi (bina, enerji hattı vb.) mobilde gösterilmez; çevre çarpışma kontrolü yalnız masaüstündedir.`);
  }
  if (isObj(raw.tandem) && raw.tandem.enabled === true) {
    warnings.push("Tandem (iki vinçli) kaldırma mobilde desteklenmez — yalnız ana vinç yüklendi.");
  }
  if (isObj(raw.lift_path)) warnings.push("Al–bırak güzergâhı mobilde gösterilmez.");
  if ((isNum(raw.crane_heading) && raw.crane_heading !== 0) || (isNum(raw.crane_x) && raw.crane_x !== 0) || (isNum(raw.crane_z) && raw.crane_z !== 0)) {
    warnings.push("Vincin saha konumu/yönü mobilde kullanılmaz (dönme açısı şasiye göredir).");
  }
  if (isObj(raw.load_cog_offset) && ((isNum(raw.load_cog_offset.x) && raw.load_cog_offset.x !== 0) || (isNum(raw.load_cog_offset.z) && raw.load_cog_offset.z !== 0))) {
    warnings.push("Yük ağırlık merkezi kaçıklığı (sapan kol kuvvetleri) mobilde hesaplanmaz.");
  }
  if (isNum(raw.ground_slope_pct) && raw.ground_slope_pct !== 0) {
    warnings.push(`Zemin eğimi (%${raw.ground_slope_pct}) mobilde dikkate alınmaz.`);
  }
  if (isNum(raw.allowable_bearing_t_m2)) {
    warnings.push("Zemin taşıma basıncı / takoz kontrolü mobilde yapılmaz — masaüstü raporuna bakın.");
  }
  return { state, warnings };
}

/**
 * Tek adımda: JSON → seçili plan (stepIndex null/undefined = kaydedildiği andaki güncel plan,
 * aksi halde steps[stepIndex]). Hata durumunda fırlatır (mesaj Türkçe, kullanıcıya gösterilebilir).
 */
export function importDesktopProject(
  json: string,
  cranes: CraneModel[],
  opts: { stepIndex?: number | null; fileName?: string } = {},
): ProjectImportResult {
  const parsed = parseDesktopProject(json, opts.fileName);
  if (!parsed.ok) throw new Error(parsed.error);
  return importParsedProject(parsed.project, cranes, opts.stepIndex);
}

/** Ayrıştırılmış projeden (adım seçimi sonrası) plan yükler. */
export function importParsedProject(
  project: ParsedDesktopProject,
  cranes: CraneModel[],
  stepIndex?: number | null,
): ProjectImportResult {
  const step = stepIndex == null ? null : project.steps[stepIndex];
  if (stepIndex != null && !step) throw new Error(`Çalışma adımı bulunamadı (#${stepIndex + 1}).`);
  const { state, warnings } = mapDesktopState(step ? step.config : project.current, cranes);
  return {
    state,
    projectName: step ? `${project.projectName} — ${step.name}` : project.projectName,
    stepNames: project.steps.map((s) => s.name),
    warnings,
  };
}

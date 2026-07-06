/**
 * persistence.ts — kalıcılık katmanı: localStorage autosave + proje dosyası
 * (indirme/açma) için ortak serileştirme. UIState + WorkStep[] + ProjectMeta
 * tek bir JSON gövdesinde tutulur (adımların her biri zaten tam bir UIState
 * snapshot'ı içerir — bkz. state.ts WorkStep.config).
 *
 * İçe aktarılan 3B/BIM modellerinin modelUrl'i (blob: URL) oturum kapanınca
 * geçersiz kalır ve JSON'a da serileştirilemez; bu yüzden kaydetmeden önce
 * her SceneObject'ten modelUrl/modelName düşülür. Yükleme sonrası, "model"
 * türünde ama modelUrl'i olmayan nesne varsa çağıran taraf kullanıcıyı
 * yeniden içe aktarmaya davet eder (bkz. App.tsx modelsNotice).
 *
 * Şema sürümü geçmişi: v1 → meta yok. v2 → ProjectMeta eklendi (bkz.
 * state.ts STATE_SCHEMA_VERSION). v1 dosyaları/autosave'leri okunmaya devam
 * eder; meta alanı boş varsayılanla doldurulur (bkz. isValidPersisted/tryParseProject).
 */
import type { SceneObject } from "../engine/types";
import {
  defaultProjectMeta,
  STATE_SCHEMA_VERSION,
  type ProjectMeta,
  type UIState,
  type WorkStep,
} from "./state";

export interface PersistedProject {
  version: number;
  state: UIState;
  steps: WorkStep[];
  meta: ProjectMeta;
}

const AUTOSAVE_KEY = "hareket-crane-planner:autosave";

/** Bu sürümdeki persistence katmanının okuyabileceği en eski şema sürümü. */
const MIN_SUPPORTED_VERSION = 1;

function stripModelBlobs(objects: SceneObject[]): SceneObject[] {
  return objects.map((o) => {
    if (o.kind !== "model") return o;
    const { modelUrl: _modelUrl, modelName: _modelName, ...rest } = o;
    return rest as SceneObject;
  });
}

function stripState(state: UIState): UIState {
  return { ...state, objects: stripModelBlobs(state.objects) };
}

function stripSteps(steps: WorkStep[]): WorkStep[] {
  return steps.map((s) => ({ ...s, config: stripState(s.config) }));
}

/** state + steps + meta'yı JSON'a serileştirir (blob modelUrl'ler düşülür). */
export function serializeProject(state: UIState, steps: WorkStep[], meta: ProjectMeta): string {
  const data: PersistedProject = {
    version: STATE_SCHEMA_VERSION,
    state: stripState(state),
    steps: stripSteps(steps),
    meta,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Kabaca şekil doğrulaması: sürüm [MIN_SUPPORTED_VERSION, STATE_SCHEMA_VERSION]
 * aralığında olmalı (eskisi geriye uyumlu okunur; yenisi bu sürümün tanımadığı
 * bir şema olabilir → reddedilir) + state/steps temel alanları olmalı.
 */
function isValidPersisted(data: unknown): data is { version: number; state: unknown; steps: unknown; meta?: unknown } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.version !== "number" || d.version < MIN_SUPPORTED_VERSION || d.version > STATE_SCHEMA_VERSION) {
    return false;
  }
  if (!d.state || typeof d.state !== "object") return false;
  const s = d.state as Record<string, unknown>;
  if (typeof s.craneModel !== "string") return false;
  if (!Array.isArray(s.objects)) return false;
  if (!Array.isArray(d.steps)) return false;
  return true;
}

/** JSON metnini ayrıştırır; bozuk/desteklenmeyen/geçersizse null döner (fırlatmaz).
 * Eski (v1) veride meta alanı yoktur — boş varsayılanla doldurulur. */
export function tryParseProject(json: string): PersistedProject | null {
  try {
    const data = JSON.parse(json);
    if (!isValidPersisted(data)) return null;
    const meta =
      data.meta && typeof data.meta === "object"
        ? { ...defaultProjectMeta(), ...(data.meta as Partial<ProjectMeta>) }
        : defaultProjectMeta();
    return {
      version: data.version,
      state: data.state as UIState,
      steps: data.steps as WorkStep[],
      meta,
    };
  } catch {
    return null;
  }
}

/** Bir nesnenin oturumluk 3B modelini kaybedip kaybetmediğini bildirir. */
export function hasDroppedModels(objects: SceneObject[]): boolean {
  return objects.some((o) => o.kind === "model" && !o.modelUrl);
}

export function saveAutosave(state: UIState, steps: WorkStep[], meta: ProjectMeta): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(state, steps, meta));
  } catch {
    // localStorage kullanılamıyor (gizli mod/kota) — sessizce yoksay.
  }
}

export function loadAutosave(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return tryParseProject(raw);
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // yoksay
  }
}

/** Proje JSON'unu ".json" dosyası olarak indirir (tarayıcı/Electron ortak). */
export function downloadProjectFile(state: UIState, steps: WorkStep[], meta: ProjectMeta): void {
  const json = serializeProject(state, steps, meta);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `hareket-crane-plan-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

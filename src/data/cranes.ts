// Vinç kayıt defteri — tüm vinç JSON'larını tipli olarak toplar.
import ltm1250 from "./ltm1250.json";
import ltm1160 from "./ltm1160.json";
import sac2500e from "./sac2500e.json";
import type { CraneModel } from "../engine/types";

export const CRANES: CraneModel[] = [
  ltm1250 as unknown as CraneModel,
  ltm1160 as unknown as CraneModel,
  sac2500e as unknown as CraneModel,
];

// "Makinelerim" (kullanıcı tanımlı) vinçler — App açılışta ve değişiklikte kaydeder.
let customCranes: CraneModel[] = [];

/** Kullanıcı vinçlerini kayıt defterine ekler (yerleşik adlarla çakışanlar yok sayılır). */
export function registerCustomCranes(list: CraneModel[]): void {
  customCranes = list.filter((c) => !CRANES.some((b) => b.model === c.model));
}

/** Yerleşik + kullanıcı vinçleri. */
export function allCranes(): CraneModel[] {
  return [...CRANES, ...customCranes];
}

export function getCrane(model: string): CraneModel {
  const c = allCranes().find((c) => c.model === model);
  if (!c) throw new Error(`Vinç bulunamadı: ${model}`);
  return c;
}

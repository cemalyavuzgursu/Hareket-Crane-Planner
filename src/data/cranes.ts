// Vinç kayıt defteri — tüm vinç JSON'larını tipli olarak toplar.
import ltm1250 from "./ltm1250.json";
import ltm1160 from "./ltm1160.json";
import type { CraneModel } from "../engine/types";

export const CRANES: CraneModel[] = [
  ltm1250 as unknown as CraneModel,
  ltm1160 as unknown as CraneModel,
];

export function getCrane(model: string): CraneModel {
  const c = CRANES.find((c) => c.model === model);
  if (!c) throw new Error(`Vinç bulunamadı: ${model}`);
  return c;
}

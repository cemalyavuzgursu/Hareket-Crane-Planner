// Ortak renk paleti + ölçüler. Masaüstü koyu CAD temasıyla uyumlu.
export const C = {
  bg: "#0c0e11",
  bg2: "#12151a",
  panel: "#161a20",
  panel2: "#1c222a",
  border: "#252c36",
  border2: "#323b47",
  text: "#e7edf4",
  textDim: "#9aa7b6",
  textFaint: "#6b7684",
  accent: "#ffba20", // amber
  blue: "#4aa3ff",
  green: "#00e475",
  orange: "#ff8a3d",
  red: "#ff5a4d",
  steel: "#aebfd4",
  steelDim: "#6f86a6",
} as const;

export const mono = "monospace";

/** Kullanım yüzdesine göre durum rengi. */
export function utilColor(pct: number): string {
  if (!Number.isFinite(pct)) return C.textFaint;
  if (pct > 100) return C.red;
  if (pct > 90) return C.orange;
  if (pct > 75) return C.accent;
  return C.green;
}

/** Çarpışma/klerens şiddeti rengi. */
export function severityColor(sev: "ok" | "warning" | "collision"): string {
  return sev === "collision" ? C.red : sev === "warning" ? C.orange : C.green;
}

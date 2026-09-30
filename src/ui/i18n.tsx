/**
 * i18n.tsx — Türkçe / English dil desteği.
 *
 * Anahtar = Türkçe kaynak metin. `t("Yük Ağırlığı")` dil "en" ise İngilizce
 * sözlükten (i18n.en.ts) karşılığını döndürür; yoksa Türkçe metnin kendisi.
 * `{ad}` biçimindeki yer tutucular `vars` ile doldurulur:
 *   t("{n} adım", { n: 3 })
 *
 * React dışı kod (report.ts vb.) için `tStatic` mevcut dili okur.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EN } from "./i18n.en";

export type Lang = "tr" | "en";
export type TVars = Record<string, string | number>;

const LS_KEY = "hareket_lang";

function readLang(): Lang {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    return v === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

let currentLang: Lang = readLang();
const missingLogged = new Set<string>();

function interpolate(s: string, vars?: TVars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Belirtilen dilde çeviri. */
export function translate(lang: Lang, tr: string, vars?: TVars): string {
  if (lang === "tr" || !tr) return interpolate(tr, vars);
  const en = EN[tr];
  if (en == null) {
    if (import.meta.env?.DEV && !missingLogged.has(tr)) {
      missingLogged.add(tr);
      // eslint-disable-next-line no-console
      console.debug("[i18n] missing EN:", JSON.stringify(tr));
    }
    return interpolate(tr, vars);
  }
  return interpolate(en, vars);
}

/** React dışı kullanım: mevcut dili okur. */
export function tStatic(tr: string, vars?: TVars): string {
  return translate(currentLang, tr, vars);
}

export function getLang(): Lang {
  return currentLang;
}

export type TFn = (tr: string, vars?: TVars) => string;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const Ctx = createContext<I18nCtx>({
  lang: currentLang,
  setLang: () => {},
  t: (tr, vars) => translate(currentLang, tr, vars),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const setLang = useCallback((l: Lang) => {
    currentLang = l;
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      /* yoksay */
    }
    try {
      document.documentElement.lang = l;
    } catch {
      /* yoksay */
    }
    setLangState(l);
  }, []);
  const value = useMemo<I18nCtx>(
    () => ({ lang, setLang, t: (tr, vars) => translate(lang, tr, vars) }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}

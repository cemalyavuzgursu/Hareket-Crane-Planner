// Canlı rüzgâr verisi — Open-Meteo (anahtar gerekmez). Konum (enlem/boylam) Open-Meteo'ya gönderilir.
// Değerler zeminden 10 m yükseklik içindir; bom ucu yüksekliğine windAtHeight ile YAKLAŞIK taşınır.

import { tStatic } from "./i18n";

export interface WindHour {
  time: string; // ISO yerel saat (Open-Meteo timezone=auto)
  wind_ms: number;
  gust_ms: number;
}

export interface WindData {
  current_ms: number;
  gust_ms: number;
  hourly: WindHour[];
}

const BASE = "https://api.open-meteo.com/v1/forecast";

/** Open-Meteo'dan anlık + saatlik (önümüzdeki 24 saat) rüzgâr ve hamle (10 m, m/s). */
export async function fetchWind(lat: number, lon: number, signal?: AbortSignal): Promise<WindData> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(tStatic("Geçersiz konum (enlem/boylam)."));
  }
  const url =
    `${BASE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=wind_speed_10m,wind_gusts_10m&hourly=wind_speed_10m,wind_gusts_10m` +
    `&wind_speed_unit=ms&forecast_days=2&timezone=auto`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error(tStatic("Hava durumu servisine ulaşılamadı (internet bağlantısını kontrol edin)."));
  }
  if (!res.ok) {
    throw new Error(tStatic("Hava durumu servisi hata döndürdü (HTTP {status}).", { status: res.status }));
  }
  let j: any;
  try {
    j = await res.json();
  } catch {
    throw new Error(tStatic("Hava durumu yanıtı okunamadı."));
  }
  const cur = j?.current;
  const h = j?.hourly;
  if (!cur || !h || !Array.isArray(h.time)) throw new Error(tStatic("Hava durumu yanıtı beklenen biçimde değil."));
  const current_ms = Number(cur.wind_speed_10m);
  const gust_ms = Number(cur.wind_gusts_10m);
  if (!Number.isFinite(current_ms)) throw new Error(tStatic("Anlık rüzgâr verisi yok."));

  // Şimdiki saatten itibaren 24 saat. Open-Meteo current.time ile aynı yerel biçimde.
  const nowKey = typeof cur.time === "string" ? cur.time.slice(0, 13) : "";
  let start = h.time.findIndex((t: string) => t.slice(0, 13) >= nowKey);
  if (start < 0) start = 0;
  const hourly: WindHour[] = [];
  for (let i = start; i < h.time.length && hourly.length < 24; i++) {
    const w = Number(h.wind_speed_10m?.[i]);
    const g = Number(h.wind_gusts_10m?.[i]);
    if (!Number.isFinite(w)) continue;
    hourly.push({ time: h.time[i], wind_ms: w, gust_ms: Number.isFinite(g) ? g : w });
  }
  return { current_ms, gust_ms: Number.isFinite(gust_ms) ? gust_ms : current_ms, hourly };
}

/** Rüzgâr profili üs katsayısı (açık arazi, güç kanunu). */
export const WIND_POWER_EXPONENT = 0.14;

/**
 * 10 m rüzgârını h yüksekliğine taşır: v(h) = v10 · (h/10)^0,14.
 * YAKLAŞIKTIR: EN 13000 yükseklik profili ve anlık hamle (3 s) esas alınır; burada
 * basit güç kanunu kullanılır. 10 m altında azaltma yapılmaz (muhafazakâr).
 */
export function windAtHeight(v10: number, h: number): number {
  if (!Number.isFinite(v10)) return NaN;
  const hh = Number.isFinite(h) ? Math.max(10, h) : 10;
  return v10 * Math.pow(hh / 10, WIND_POWER_EXPONENT);
}

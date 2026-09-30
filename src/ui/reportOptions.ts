/**
 * reportOptions.ts — Rapor tasarımcısı (report designer) ayarları: PDF'te
 * hangi bölümlerin yer alacağı, serbest notlar ve başlık override'ı.
 * localStorage'da ("hareket_report_options") kalıcı tutulur.
 */

export interface ReportOptions {
  sections: {
    cover: boolean; // proje bilgileri başlığı/kapak tablosu
    config: boolean; // vinç & konfigürasyon
    load: boolean; // yük bilgileri (+ rigging)
    capacity: boolean; // kapasite kontrolü
    clearance: boolean; // klerens
    collision: boolean; // çarpışma
    outrigger: boolean; // ayak reaksiyonu & zemin
    wind: boolean; // rüzgâr
    drawings: boolean; // gömülü 2B/üstten çizimler
    signatures: boolean; // imza blokları
    checklist: boolean; // kaldırma öncesi kontrol listesi
    approval: boolean; // dijital onay kaydı
    site: boolean; // saha konumu / yön / zemin eğimi
    tandem: boolean; // tandem (iki vinçli) kaldırma
    liftPath: boolean; // al–bırak güzergâhı
  };
  notes: string; // serbest notlar (rapora "Notlar" bölümü olarak)
  title: string; // rapor başlığı override ("" = varsayılan)
}

const STORAGE_KEY = "hareket_report_options";

export function defaultReportOptions(): ReportOptions {
  return {
    sections: {
      cover: true,
      config: true,
      load: true,
      capacity: true,
      clearance: true,
      collision: true,
      outrigger: true,
      wind: true,
      drawings: true,
      signatures: true,
      checklist: true,
      approval: true,
      site: true,
      tandem: true,
      liftPath: true,
    },
    notes: "",
    title: "",
  };
}

export function loadReportOptions(): ReportOptions {
  const def = defaultReportOptions();
  try {
    if (typeof localStorage === "undefined") return def;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<ReportOptions> | null;
    if (!parsed || typeof parsed !== "object") return def;
    const sections = { ...def.sections };
    if (parsed.sections && typeof parsed.sections === "object") {
      for (const k of Object.keys(sections) as Array<keyof ReportOptions["sections"]>) {
        const v = (parsed.sections as Record<string, unknown>)[k];
        if (typeof v === "boolean") sections[k] = v;
      }
    }
    return {
      sections,
      notes: typeof parsed.notes === "string" ? parsed.notes : def.notes,
      title: typeof parsed.title === "string" ? parsed.title : def.title,
    };
  } catch {
    return def;
  }
}

export function saveReportOptions(o: ReportOptions): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* depolama erişilemez — sessizce yok say */
  }
}

/**
 * ReportDesigner.tsx — "Rapor Tasarımcısı" modalı (Crane Planner 2.0 report
 * designer benzeri). PDF'te hangi bölümlerin yer alacağını, rapor başlığını
 * ve serbest notları düzenler (bkz. reportOptions.ts, report.ts).
 */
import { useEffect, useState } from "react";
import { defaultReportOptions, type ReportOptions } from "./reportOptions";
import { useI18n } from "./i18n";

interface Props {
  options: ReportOptions;
  onSave: (o: ReportOptions) => void;
  onClose: () => void;
}

type SectionKey = keyof ReportOptions["sections"];

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "cover", label: "Proje bilgileri / kapak tablosu" },
  { key: "config", label: "Vinç & konfigürasyon (jib, halat donanımı)" },
  { key: "load", label: "Yük bilgileri (+ rigging aparatları)" },
  { key: "capacity", label: "Kapasite kontrolü" },
  { key: "clearance", label: "Klerens / geometri" },
  { key: "collision", label: "Çarpışma kontrolü" },
  { key: "outrigger", label: "Ayak reaksiyonu & zemin basıncı" },
  { key: "wind", label: "Rüzgâr" },
  { key: "drawings", label: "Çizimler (yandan / üstten görünüş)" },
  { key: "signatures", label: "Onay ve imza blokları" },
  { key: "checklist", label: "Kaldırma öncesi kontrol listesi" },
  { key: "approval", label: "Dijital onay kaydı" },
  { key: "site", label: "Saha konumu / yön / zemin eğimi" },
  { key: "tandem", label: "Tandem (iki vinçli) kaldırma" },
  { key: "liftPath", label: "Al–bırak güzergâhı" },
];

export default function ReportDesigner({ options, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ReportOptions>(options);
  useEffect(() => setDraft(options), [options]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (key: SectionKey) =>
    setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: !d.sections[key] } }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h3>🖨 {t("Rapor Tasarımcısı")}</h3>

        <div className="field">
          <label>{t("Rapor başlığı (boş = varsayılan)")}</label>
          <input
            type="text"
            value={draft.title}
            placeholder={t("ör. Kaldırma Planı — Çatı Makasları")}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </div>

        <div className="field">
          <label>{t("Rapora dahil edilecek bölümler")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
            {SECTIONS.map((s) => (
              <label
                key={s.key}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: "normal" }}
              >
                <input type="checkbox" checked={draft.sections[s.key]} onChange={() => toggle(s.key)} />
                <span>{t(s.label)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('Notlar (rapora "Notlar" bölümü olarak eklenir)')}</label>
          <textarea
            rows={5}
            value={draft.notes}
            placeholder={t("ör. Kaldırma öncesi zemin etüdü raporu kontrol edilecek...")}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        <div className="disclaimer">
          {t("Uyarı kutuları (kapasite aşımı, manuel doğrulama vb.) ve yük tablosu kaynağı her zaman rapora eklenir.")}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn ghost" type="button" onClick={() => setDraft(defaultReportOptions())}>
            {t("Varsayılana dön")}
          </button>
          <button className="btn ghost" style={{ flex: 1 }} type="button" onClick={onClose}>
            {t("İptal")}
          </button>
          <button
            className="btn primary"
            style={{ flex: 1 }}
            type="button"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t("Kaydet")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ProjectMetaDialog.tsx — "Proje Bilgileri" modalı. PDF rapor başlığında ve
 * imza bloklarında kullanılan proje/saha/müşteri/revizyon/hazırlayan/onaylayan
 * meta verisini düzenler (bkz. state.ts ProjectMeta, report.ts).
 */
import { useEffect, useState } from "react";
import type { ProjectMeta } from "./state";

interface Props {
  meta: ProjectMeta;
  onSave: (meta: ProjectMeta) => void;
  onClose: () => void;
}

const FIELDS: Array<{ key: keyof ProjectMeta; label: string; placeholder?: string }> = [
  { key: "projectName", label: "Proje Adı", placeholder: "ör. Fabrika Çatı Vinç Montajı" },
  { key: "siteLocation", label: "Saha / Lokasyon", placeholder: "ör. Gebze OSB, Kocaeli" },
  { key: "client", label: "Müşteri", placeholder: "ör. ABC İnşaat A.Ş." },
  { key: "jobNo", label: "İş / Plan No", placeholder: "ör. LP-2026-014" },
  { key: "revision", label: "Revizyon", placeholder: "ör. Rev. A" },
  { key: "preparedBy", label: "Hazırlayan", placeholder: "Ad Soyad" },
  { key: "approvedBy", label: "Onaylayan (Kaldırma Mühendisi)", placeholder: "Ad Soyad" },
];

export default function ProjectMetaDialog({ meta, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ProjectMeta>(meta);
  useEffect(() => setDraft(meta), [meta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" onClick={(e) => e.stopPropagation()}>
        <h3>📋 Proje Bilgileri</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {FIELDS.map((f) => (
            <div className="field" key={f.key} style={f.key === "approvedBy" ? { gridColumn: "1 / -1" } : undefined}>
              <label>{f.label}</label>
              <input
                type="text"
                value={draft[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="disclaimer">
          Bu bilgiler PDF raporunun başlığında ve son sayfadaki imza bloklarında görünür;
          hesaba dahil edilmez.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} type="button">
            Vazgeç
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
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

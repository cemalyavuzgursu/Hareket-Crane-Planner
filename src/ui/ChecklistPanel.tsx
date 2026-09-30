/**
 * ChecklistPanel.tsx — Kaldırma öncesi kontrol listesi (yan panel).
 * İşaretlenen madde, işaretleyen kullanıcı adı ve zamanla damgalanır.
 */
import { useState, type CSSProperties } from "react";
import type { ChecklistItem } from "./state";
import { useI18n } from "./i18n";
import { checklistProgress, formatIsoTr, isCustomChecklistItem, newChecklist, newCustomChecklistItem } from "./workflow";

interface Props {
  items: ChecklistItem[] | undefined;
  onChange: (items: ChecklistItem[]) => void;
  userName: string;
}

const smallBtn: CSSProperties = {
  width: "auto",
  padding: "4px 8px",
  fontSize: 12,
  marginTop: 0,
};

export default function ChecklistPanel({ items, onChange, userName }: Props) {
  const { t } = useI18n();
  const list = items ?? [];
  const prog = checklistProgress(list);
  const [newText, setNewText] = useState("");

  const toggle = (id: string) => {
    onChange(
      list.map((it) =>
        it.id !== id
          ? it
          : it.checked
            ? { id: it.id, text: it.text, checked: false }
            : { ...it, checked: true, by: userName.trim() || undefined, at: new Date().toISOString() },
      ),
    );
  };

  const addItem = () => {
    const txt = newText.trim();
    if (!txt) return;
    onChange([...list, newCustomChecklistItem(txt)]);
    setNewText("");
  };

  const removeItem = (id: string) => onChange(list.filter((it) => it.id !== id));

  const loadDefaults = () => {
    if (list.length > 0 && !window.confirm(t("Mevcut liste varsayılan listeyle değiştirilsin mi? (İşaretler silinir)"))) return;
    onChange(newChecklist());
  };

  const barColor = prog.complete ? "var(--green)" : prog.pct >= 50 ? "var(--accent)" : "var(--red)";

  return (
    <div>
      <div className="section-title">{t("Kaldırma Öncesi Kontrol Listesi")}</div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "var(--text-dim)" }}>{t("İlerleme")}</span>
        <span className={prog.complete ? "ok" : "warn"} style={{ fontFamily: "var(--mono)", fontWeight: 700 }}>
          {prog.done}/{prog.total} ({prog.pct.toFixed(0)}%)
        </span>
      </div>
      <div className="bar" style={{ marginTop: 4, marginBottom: 10 }}>
        <div style={{ width: `${prog.pct}%`, background: barColor }} />
      </div>

      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>
          {t("Kontrol listesi boş. Varsayılan listeyi yükleyin veya madde ekleyin.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
          {list.map((it) => (
            <div
              key={it.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                padding: "5px 4px",
                borderBottom: "1px dashed var(--border)",
              }}
            >
              <label style={{ display: "flex", alignItems: "flex-start", gap: 6, flex: 1, minWidth: 0, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => toggle(it.id)}
                  style={{ marginTop: 2, flex: "0 0 auto" }}
                />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: it.checked ? "var(--text-dim)" : "var(--text)",
                      textDecoration: it.checked ? "line-through" : "none",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {isCustomChecklistItem(it) ? it.text : t(it.text)}
                  </span>
                  {it.checked && (
                    <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
                      ✓ {it.by || "—"} · {formatIsoTr(it.at)}
                    </span>
                  )}
                </span>
              </label>
              {isCustomChecklistItem(it) && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ ...smallBtn, padding: "2px 6px" }}
                  title={t("Maddeyi sil")}
                  onClick={() => removeItem(it.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={newText}
          placeholder={t("Özel madde ekle...")}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
          style={{ flex: 1, minWidth: 0, padding: "5px 8px", fontSize: 12 }}
        />
        <button type="button" className="btn primary" style={smallBtn} onClick={addItem} disabled={!newText.trim()}>
          {t("Ekle")}
        </button>
      </div>

      <button type="button" className="btn ghost" style={{ fontSize: 12, padding: 7 }} onClick={loadDefaults}>
        {t("Varsayılan listeyi yükle")}
      </button>
    </div>
  );
}

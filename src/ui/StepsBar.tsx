import { useState } from "react";
import type { WorkStep } from "./state";

/**
 * Çalışma adımları şeridi (Liebherr Crane Planner 2.0 "working steps" benzeri).
 *
 * Kullanıcı mevcut kaldırma konfigürasyonunu bir ADIM olarak kaydeder; adımları
 * çok-adımlı bir senaryo olarak yatay şeritte listeler, seçer (yükler), siler,
 * yeniden adlandırır ve hepsinden tek bir çok-adımlı PDF üretir.
 *
 * Bu bileşen adımın config içeriğini KULLANMAZ — yalnızca özet (summary) bilgisini
 * gösterir ve geri çağrılar (callbacks) üzerinden işlemleri tetikler.
 */
export interface StepsBarProps {
  steps: WorkStep[];
  activeStepId: string | null; // o an yüklü/seçili adım (vurgulamak için), yoksa null
  onAdd: () => void; // mevcut konfigürasyonu yeni adım olarak ekle
  onSelect: (id: string) => void; // adımı geçerli konfigürasyona yükle
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReport: () => void; // tüm adımlardan çok-adımlı PDF üret
}

/** Tek bir adım çipi (mini-kart). İsim düzenleme yerel state ile yönetilir. */
function StepChip({
  step,
  index,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  step: WorkStep;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  // İsim düzenleme: çift tıkla input'a dön; blur veya Enter'da kaydet, Escape'te iptal.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.name);

  const over = step.summary.status === "KAPASİTE AŞIMI";
  const pctColor = over ? "var(--red)" : "var(--green)";

  const worst = step.summary.worst_collision;
  // Çarpışma rozeti: "collision" → kırmızı ●, "warning" → amber ●, "ok" → yok.
  const collisionDot =
    worst === "collision"
      ? { color: "var(--red)", title: "Çarpışma" }
      : worst === "warning"
        ? { color: "var(--accent)", title: "Uyarı: temas riski" }
        : null;

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== step.name) {
      onRename(step.id, next);
    } else {
      // Boş veya değişmemiş ise eski ismi geri yükle.
      setDraft(step.name);
    }
  }

  function cancel() {
    setDraft(step.name);
    setEditing(false);
  }

  return (
    <div
      onClick={() => onSelect(step.id)}
      title="Adımı yükle"
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: 150,
        cursor: "pointer",
        background: "var(--panel-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-2)"}`,
        boxShadow: active ? "0 0 0 1px var(--accent)" : "none",
        borderRadius: 9,
        padding: "8px 10px",
        userSelect: "none",
      }}
    >
      {/* Silme butonu (sağ üst) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(step.id);
        }}
        title="Adımı sil"
        aria-label="Adımı sil"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          width: 18,
          height: 18,
          lineHeight: "16px",
          padding: 0,
          borderRadius: 5,
          border: "1px solid var(--border-2)",
          background: "var(--bg)",
          color: "var(--text-dim)",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        ✕
      </button>

      {/* Adım numarası + isim */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 18 }}>
        <span
          className="pill"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            padding: "1px 6px",
            color: active ? "var(--accent)" : "var(--text-dim)",
          }}
        >
          #{index + 1}
        </span>
        {editing ? (
          <input
            type="text"
            value={draft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            style={{
              width: "100%",
              padding: "2px 6px",
              background: "var(--bg)",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              color: "var(--text)",
              fontFamily: "var(--sans)",
              fontSize: 12,
              fontWeight: 600,
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(step.name);
              setEditing(true);
            }}
            title="İsmi düzenlemek için çift tıkla"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {step.name}
          </span>
        )}
      </div>

      {/* Kullanım yüzdesi + çarpışma rozeti */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 18,
            fontWeight: 800,
            lineHeight: 1,
            color: pctColor,
          }}
        >
          {step.summary.utilization_pct.toFixed(0)}%
        </span>
        {collisionDot && (
          <span
            title={collisionDot.title}
            style={{ color: collisionDot.color, fontSize: 14, lineHeight: 1 }}
          >
            ●
          </span>
        )}
      </div>

      {/* Durum etiketi */}
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: ".3px",
          color: over ? "var(--red)" : "var(--text-dim)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {step.summary.status}
      </div>
    </div>
  );
}

export default function StepsBar({
  steps,
  activeStepId,
  onAdd,
  onSelect,
  onDelete,
  onRename,
  onReport,
}: StepsBarProps): JSX.Element {
  const hasSteps = steps.length > 0;

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Sol: başlık + adım sayısı */}
        <div
          className="section-title"
          style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}
        >
          <span>Çalışma Adımları</span>
          <span
            className="pill"
            style={{ fontFamily: "var(--mono)", fontSize: 10, padding: "1px 7px" }}
          >
            {steps.length}
          </span>
        </div>

        {/* Adımı kaydet */}
        <button
          className="btn ghost"
          onClick={onAdd}
          style={{ width: "auto", padding: "6px 12px", fontSize: 12, marginTop: 0, flex: "0 0 auto" }}
        >
          ➕ Adımı Kaydet
        </button>

        {/* Orta: yatay kaydırılabilir adım şeridi */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            gap: 10,
            overflowX: "auto",
            padding: "2px 2px 4px",
          }}
        >
          {hasSteps ? (
            steps.map((step, i) => (
              <StepChip
                key={step.id}
                step={step}
                index={i}
                active={step.id === activeStepId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))
          ) : (
            <div
              style={{
                color: "var(--text-faint)",
                fontSize: 12,
                alignSelf: "center",
                fontStyle: "italic",
              }}
            >
              Henüz adım yok. Konfigürasyonu ayarlayıp "Adımı Kaydet"e basın.
            </div>
          )}
        </div>

        {/* Sağ: çok-adımlı PDF */}
        <button
          className="btn primary"
          onClick={onReport}
          disabled={!hasSteps}
          title={hasSteps ? "Tüm adımlardan çok-adımlı PDF üret" : "Önce en az bir adım kaydedin"}
          style={{
            width: "auto",
            padding: "6px 12px",
            fontSize: 12,
            marginTop: 0,
            flex: "0 0 auto",
            opacity: hasSteps ? 1 : 0.5,
            cursor: hasSteps ? "pointer" : "not-allowed",
          }}
        >
          📄 Çok Adımlı PDF
        </button>
      </div>
    </div>
  );
}

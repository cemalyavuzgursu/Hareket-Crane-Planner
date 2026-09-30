/**
 * ApprovalPanel.tsx — Kaldırma planı dijital onay akışı (yan panel).
 * Taslak → Onaya gönderildi → Onaylandı / Reddedildi; "Yeniden aç" ile taslağa döner.
 * Onaya gönderme ve onaylama, canApprove() engelleri varken kilitlidir.
 */
import type { CSSProperties } from "react";
import type { FullLiftResult } from "../engine/index";
import { useI18n } from "./i18n";
import type { ApprovalState, ApprovalStatus, ProjectMeta, UIState } from "./state";
import {
  APPROVAL_STATUS_TR,
  approvalActionAllowed,
  approvalTransition,
  canApprove,
  defaultApproval,
  formatIsoTr,
  type ApprovalAction,
} from "./workflow";

interface Props {
  approval: ApprovalState | undefined;
  meta: ProjectMeta;
  state: UIState;
  result: FullLiftResult | null;
  onChange: (a: ApprovalState) => void;
}

const BADGE: Record<ApprovalStatus, { bg: string; fg: string }> = {
  draft: { bg: "var(--panel-2)", fg: "var(--text-dim)" },
  submitted: { bg: "rgba(59,130,246,.16)", fg: "var(--blue)" },
  approved: { bg: "rgba(34,197,94,.15)", fg: "var(--green)" },
  rejected: { bg: "rgba(239,68,68,.18)", fg: "var(--red)" },
};

const btn: CSSProperties = { flex: 1, padding: "7px 6px", fontSize: 12, marginTop: 0 };

export default function ApprovalPanel({ approval, meta, state, result, onChange }: Props) {
  const { t } = useI18n();
  // Etkin onay kaydı: boş isimler proje meta bilgisinden varsayılanlanır.
  const base = approval ?? defaultApproval();
  const a: ApprovalState = {
    ...base,
    preparedBy: base.preparedBy || meta.preparedBy || "",
    approvedBy: base.approvedBy || meta.approvedBy || "",
  };
  const check = canApprove({ ...state, approval: a }, result);
  const badge = BADGE[a.status];
  const editableNames = a.status === "draft" || a.status === "rejected";

  const act = (action: ApprovalAction) => {
    const who = action === "submit" ? a.preparedBy : action === "reopen" ? "" : a.approvedBy;
    onChange(approvalTransition(a, action, who, a.comment));
  };

  const blocked = (action: ApprovalAction) =>
    !approvalActionAllowed(a.status, action) ||
    ((action === "submit" || action === "approve") && !check.ok) ||
    (action === "approve" && !a.approvedBy.trim());

  return (
    <div>
      <div className="section-title">{t("Onay Akışı")}</div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("Durum")}</span>
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: badge.bg,
            color: badge.fg,
            border: "1px solid var(--border-2)",
          }}
        >
          {t(APPROVAL_STATUS_TR[a.status])}
        </span>
      </div>

      <div className="field">
        <label>{t("Hazırlayan")}</label>
        <input
          type="text"
          value={a.preparedBy}
          disabled={!editableNames}
          placeholder={t("Ad Soyad")}
          onChange={(e) => onChange({ ...a, preparedBy: e.target.value })}
        />
        {a.preparedAt && (
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3 }}>
            {t("Gönderim")}: {formatIsoTr(a.preparedAt)}
          </div>
        )}
      </div>

      <div className="field">
        <label>{t("Onaylayan")}</label>
        <input
          type="text"
          value={a.approvedBy}
          disabled={a.status === "approved"}
          placeholder={t("Ad Soyad (kaldırma mühendisi)")}
          onChange={(e) => onChange({ ...a, approvedBy: e.target.value })}
        />
        {a.approvedAt && (a.status === "approved" || a.status === "rejected") && (
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3 }}>
            {a.status === "approved" ? t("Onay") : t("Red")}: {formatIsoTr(a.approvedAt)}
          </div>
        )}
      </div>

      <div className="field">
        <label>{t("Yorum")}</label>
        <textarea
          rows={3}
          value={a.comment}
          placeholder={t("Onay / red gerekçesi, koşullar...")}
          onChange={(e) => onChange({ ...a, comment: e.target.value })}
          style={{ resize: "vertical", boxSizing: "border-box" }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn primary" style={btn} disabled={blocked("submit")} onClick={() => act("submit")}>
          {t("Onaya gönder")}
        </button>
        <button type="button" className="btn primary" style={btn} disabled={blocked("approve")} onClick={() => act("approve")}>
          {t("Onayla")}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button type="button" className="btn ghost" style={btn} disabled={blocked("reject")} onClick={() => act("reject")}>
          {t("Reddet")}
        </button>
        <button type="button" className="btn ghost" style={btn} disabled={blocked("reopen")} onClick={() => act("reopen")}>
          {t("Yeniden aç")}
        </button>
      </div>

      {!check.ok && a.status !== "approved" && (
        <div className="error-box" style={{ marginTop: 10, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("Onay engelleri")}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {check.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {a.status === "submitted" && !a.approvedBy.trim() && (
        <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 6 }}>{t("Onaylamak için \"Onaylayan\" adını girin.")}</div>
      )}

      <div className="disclaimer">{t("Bu dijital onay kaydıdır; ıslak imza yerine geçmez.")}</div>
    </div>
  );
}

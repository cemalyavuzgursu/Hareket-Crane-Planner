/**
 * workflow.ts — Kaldırma öncesi kontrol listesi + dijital onay akışı yardımcıları.
 *
 * Saf (React'siz) fonksiyonlar: ChecklistPanel / ApprovalPanel / report.ts
 * tarafından kullanılır. Onay akışı: draft → submitted → approved | rejected,
 * "reopen" ile her durumdan draft'a dönülür.
 */
import type { FullLiftResult } from "../engine/index";
import type { ApprovalState, ApprovalStatus, ChecklistItem, UIState } from "./state";
import { getLang, tStatic } from "./i18n";

/**
 * Varsayılan kaldırma öncesi kontrol maddeleri. Veri olarak Türkçe saklanır;
 * görüntülemede t(item.text) ile çevrilir (özel maddeler olduğu gibi kalır).
 */
export const DEFAULT_CHECKLIST: string[] = [
  "Zemin etüdü / taşıma kapasitesi doğrulandı",
  "Ayaklar tam açık, takozlar yerleştirildi",
  "Vinç terazisi kontrol edildi (≤ %1 eğim)",
  "Yük ağırlığı belgeyle doğrulandı",
  "Sapan/aparat sertifikaları geçerli",
  "Rüzgâr hızı limit altında",
  "Enerji hattı mesafesi kontrol edildi",
  "Operatör ve işaretçi brifingi yapıldı",
  "Kaldırma alanı çevrildi / yetkisiz giriş engellendi",
  "LML / yük moment sınırlayıcı test edildi",
  "Kanca emniyet mandalı kontrol edildi",
  "Kılavuz halat (tag line) hazır",
  "İletişim (telsiz/işaret) kontrol edildi",
  "Acil durum planı biliniyor",
  "Deneme kaldırması yapıldı",
];

/** Varsayılan maddelerin id öneki — özel (kullanıcı) maddeler "custom-" ile başlar. */
export const DEFAULT_ID_PREFIX = "def-";
export const CUSTOM_ID_PREFIX = "custom-";

export function isCustomChecklistItem(item: ChecklistItem): boolean {
  return item.id.startsWith(CUSTOM_ID_PREFIX);
}

/** Varsayılan listeden yeni (işaretlenmemiş) kontrol listesi üretir. */
export function newChecklist(): ChecklistItem[] {
  return DEFAULT_CHECKLIST.map((text, i) => ({ id: `${DEFAULT_ID_PREFIX}${i + 1}`, text, checked: false }));
}

/** Yeni özel madde. */
export function newCustomChecklistItem(text: string): ChecklistItem {
  const rnd = Math.random().toString(36).slice(2, 8);
  return { id: `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}-${rnd}`, text: text.trim(), checked: false };
}

export interface ChecklistProgress {
  done: number;
  total: number;
  pct: number; // 0..100
  complete: boolean;
}

export function checklistProgress(items: ChecklistItem[] | undefined): ChecklistProgress {
  const list = items ?? [];
  const total = list.length;
  const done = list.filter((i) => i.checked).length;
  return {
    done,
    total,
    pct: total > 0 ? (done / total) * 100 : 0,
    complete: total > 0 && done === total,
  };
}

export function defaultApproval(): ApprovalState {
  return { status: "draft", preparedBy: "", approvedBy: "", comment: "" };
}

/** Onay durum etiketleri (Türkçe anahtar; görüntülemede t() ile çevrilir). */
export const APPROVAL_STATUS_TR: Record<ApprovalStatus, string> = {
  draft: "Taslak",
  submitted: "Onaya gönderildi",
  approved: "Onaylandı",
  rejected: "Reddedildi",
};

/**
 * Plan onaylanabilir mi? Güvenlik engelleri (kapasite aşımı, çarpışma,
 * devrilme riski), eksik kontrol listesi ve boş "Hazırlayan" onayı engeller.
 * Hazırlayan adı state.approval.preparedBy'den okunur.
 */
export function canApprove(state: UIState, result: FullLiftResult | null): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!result) {
    reasons.push(tStatic("Hesap sonucu yok — kaldırma hesaplanamadı."));
  } else {
    if (result.capacity.severity === "over") {
      reasons.push(tStatic("Kapasite aşımı (%{pct}).", { pct: result.capacity.utilization_pct.toFixed(1) }));
    }
    if (result.collision.worst === "collision") {
      reasons.push(tStatic("Çarpışma tespit edildi."));
    }
    if (result.outrigger?.tipping_risk) {
      reasons.push(tStatic("Devrilme riski (ağırlık merkezi destek alanı dışında)."));
    }
    if (result.reeving && !result.reeving.feasible) {
      reasons.push(tStatic("Halat donanımı yetersiz."));
    }
  }
  const prog = checklistProgress(state.checklist);
  if (prog.total === 0) {
    reasons.push(tStatic("Kontrol listesi oluşturulmamış."));
  } else if (!prog.complete) {
    reasons.push(tStatic("Kontrol listesi eksik ({done}/{total}).", { done: prog.done, total: prog.total }));
  }
  if (!(state.approval?.preparedBy ?? "").trim()) {
    reasons.push(tStatic("Hazırlayan adı girilmemiş."));
  }
  return { ok: reasons.length === 0, reasons };
}

export type ApprovalAction = "submit" | "approve" | "reject" | "reopen";

/** Bu durumda bu eylem geçerli mi? */
export function approvalActionAllowed(status: ApprovalStatus, action: ApprovalAction): boolean {
  switch (action) {
    case "submit":
      return status === "draft" || status === "rejected";
    case "approve":
    case "reject":
      return status === "submitted";
    case "reopen":
      return status !== "draft";
  }
}

/**
 * Onay durum geçişi (saf). Geçersiz geçişte durum değişmeden döner.
 * Zaman damgaları ISO. Reddetmede approvedBy/approvedAt karar vereni/zamanını tutar.
 */
export function approvalTransition(
  a: ApprovalState,
  action: ApprovalAction,
  who: string,
  comment?: string,
): ApprovalState {
  if (!approvalActionAllowed(a.status, action)) return a;
  const now = new Date().toISOString();
  const name = who.trim();
  const c = comment ?? a.comment;
  switch (action) {
    case "submit":
      return {
        ...a,
        status: "submitted",
        preparedBy: name || a.preparedBy,
        preparedAt: now,
        approvedAt: undefined,
        comment: c,
      };
    case "approve":
      return { ...a, status: "approved", approvedBy: name || a.approvedBy, approvedAt: now, comment: c };
    case "reject":
      return { ...a, status: "rejected", approvedBy: name || a.approvedBy, approvedAt: now, comment: c };
    case "reopen":
      return { ...a, status: "draft", approvedAt: undefined, comment: c };
  }
}

/** ISO → yerel tarih/saat (dil "en" ise en-GB, aksi halde tr-TR; geçersiz/boşsa "—"). */
export function formatIsoTr(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(getLang() === "en" ? "en-GB" : "tr-TR");
}

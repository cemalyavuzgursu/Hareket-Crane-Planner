/**
 * report.ts — PDF kaldırma planı raporu (tek adım + çok adımlı).
 *
 * Unicode/Türkçe destek: jsPDF'in yerleşik fontları (helvetica vb.) yalnızca
 * WinAnsi/Latin-1 alt kümesini destekler; burada DejaVu Sans (bkz.
 * reportFonts.ts) TrueType olarak gömülür ve tüm metin bu fontla yazılır —
 * eski ASCII'leştirme (tr()) fonksiyonuna gerek kalmamıştır.
 *
 * Çizim gömme: SideView2D/GroundForceDiagram gibi bileşenler zaten canlı DOM'da
 * <svg> olarak render edilir; App.tsx bu elemanları içeren (görünmez, ekran
 * dışı) kapsayıcı div'lere ref verir ve bu ref'ler generateReport'a geçirilir.
 * captureSvgContainer, SVG'yi klonlayıp canlı temanın CSS değişkenlerini
 * (--accent, --red vb.) satır-içi stile gömerek bağımsız bir belge olarak
 * serileştirir (bağımsız serileştirilen bir SVG, üst sayfanın stylesheet'ine
 * erişemez) — sonra bir <canvas> üzerinden PNG'ye çevirir.
 */
import { jsPDF } from "jspdf";
import type { CraneModel, OverRearNote } from "../engine/types";
import { computeLiftFull, type FullLiftResult } from "../engine/index";
import { getCrane } from "../data/cranes";
import {
  liftInputsFromState,
  riggingTotals,
  type ApprovalState,
  type ChecklistItem,
  type ProjectMeta,
  type UIState,
  type WorkStep,
} from "./state";
import { DEJAVU_SANS_BOLD_B64, DEJAVU_SANS_NORMAL_B64 } from "./reportFonts";
import { defaultReportOptions, type ReportOptions } from "./reportOptions";
import { APPROVAL_STATUS_TR, checklistProgress, formatIsoTr } from "./workflow";
import { getLang, tStatic, type TVars } from "./i18n";
import { unitsStatic, type Units } from "./units";

// ───────────────────────── Dil / birim (rapor üretimi başında okunur) ─────────────────────────

let U: Units = unitsStatic();
/** Rapor üretimi başında çağrılır: güncel birim sistemini okur. */
function refreshLocale(): void {
  U = unitsStatic();
}
function T(tr: string, vars?: TVars): string {
  return tStatic(tr, vars);
}
function fmtDate(d: Date): string {
  return d.toLocaleString(getLang() === "en" ? "en-US" : "tr-TR");
}
function fmtIso(iso: string | undefined): string {
  if (getLang() !== "en") return formatIsoTr(iso);
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US");
}
function grp(v: number, d: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
/* Sayı biçimleyiciler: metrikte `d` verilmezse ham değer yazılır (eski çıktı birebir). */
function nL(m: number, d?: number): string {
  return U.imperial ? U.len(m).toFixed(d ?? 2) : d == null ? String(m) : m.toFixed(d);
}
function nM(t: number, d?: number): string {
  return U.imperial ? grp(U.mass(t), 0) : d == null ? String(t) : t.toFixed(d);
}
function nA(a: number, d?: number): string {
  return U.imperial ? U.area(a).toFixed(d ?? 2) : d == null ? String(a) : a.toFixed(d);
}
function nP(p: number, d?: number): string {
  return U.imperial ? grp(U.pressure(p), 0) : d == null ? String(p) : p.toFixed(d);
}
function nW(v: number, d?: number): string {
  return U.imperial ? U.wind(v).toFixed(d ?? 1) : d == null ? String(v) : v.toFixed(d);
}
const fL = (m: number, d?: number) => `${nL(m, d)} ${U.lenU}`;
const fM = (t: number, d?: number) => `${nM(t, d)} ${U.massU}`;
const fA = (a: number, d?: number) => `${nA(a, d)} ${U.areaU}`;
const fP = (p: number, d?: number) => `${nP(p, d)} ${U.pressureU}`;
const fW = (v: number, d?: number) => `${nW(v, d)} ${U.windU}`;
/** "%12.5" (TR) / "12.5%" (EN). */
const pctPre = (v: string) => T("%{v}", { v });
const DEG = () => T("derece");

const FONT = "DejaVu";

function registerFonts(doc: jsPDF): void {
  doc.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_NORMAL_B64);
  doc.addFont("DejaVuSans.ttf", FONT, "normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", DEJAVU_SANS_BOLD_B64);
  doc.addFont("DejaVuSans-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
}

// ───────────────────────── SVG → PNG (çizim gömme) ─────────────────────────

/** SVG içinde kullanılan, App.tsx canlı temasından okunması gereken CSS değişkenleri. */
const CSS_VARS = [
  "--bg", "--bg-2", "--panel", "--panel-2", "--border", "--border-2",
  "--text", "--text-dim", "--text-faint", "--accent", "--orange", "--warning",
  "--danger", "--green", "--red", "--blue", "--mono", "--sans",
];

function cssVarStyleString(): string {
  if (typeof document === "undefined") return "";
  const cs = getComputedStyle(document.documentElement);
  return CSS_VARS.map((v) => `${v}:${cs.getPropertyValue(v).trim()}`).join(";");
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG görsele dönüştürülemedi."));
    img.src = src;
  });
}


/** Kullanım yüzdesi: tablo dışı (Infinity) ise "—". */
function fmtUtil(u: number, d: number): string {
  return Number.isFinite(u) ? u.toFixed(d) : "—";
}

export interface CapturedDrawing {
  dataUrl: string;
  width: number;
  height: number;
}

/** Bir <svg> elemanını (klonlayıp CSS değişkenlerini gömerek) PNG data URL'e çevirir. */
async function svgToPng(svgEl: SVGSVGElement, targetWidthPx = 1000): Promise<CapturedDrawing | null> {
  try {
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const vb = svgEl.viewBox?.baseVal;
    const aspect =
      vb && vb.width > 0 && vb.height > 0
        ? vb.width / vb.height
        : (svgEl.clientWidth || 800) / (svgEl.clientHeight || 500) || 1.6;
    const w = targetWidthPx;
    const h = Math.max(1, Math.round(targetWidthPx / aspect));
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.style.cssText = `${cssVarStyleString()};width:${w}px;height:${h}px;${clone.style.cssText}`;
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImageEl(url);
      const scale = 2; // baskı netliği için 2x örnekleme
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/** Bir kapsayıcı DOM elemanının içindeki ilk <svg>'yi yakalar (yoksa/başarısızsa null). */
export async function captureSvgContainer(container: HTMLElement | null | undefined): Promise<CapturedDrawing | null> {
  if (!container) return null;
  const svg = container.querySelector("svg");
  if (!svg) return null;
  return svgToPng(svg as SVGSVGElement);
}

/** generateReport'a geçirilen, ekran dışında render edilmiş çizim kapsayıcıları. */
export interface ReportDrawingRefs {
  sideView?: HTMLElement | null;
  topView?: HTMLElement | null;
}

/** Tandem kaldırmada tek vincin payı (App.tsx motor sonucundan). */
export interface ReportTandemCrane {
  share_t: number;
  allowed_t: number | null;
  utilization_pct: number | null;
  ok: boolean;
}

/**
 * generateReport'a isteğe bağlı olarak geçirilen, report.ts içinde yeniden
 * hesaplanmayan ek sonuçlar (tandem, güzergâh, sapan kuvvetleri).
 * Alan yoksa ilgili sayısal satırlar basılmaz.
 */
export interface ReportExtras {
  tandem?: {
    crane1: ReportTandemCrane;
    crane2: ReportTandemCrane;
    hook_distance_m: number;
    ok: boolean;
    summary: string;
  };
  liftPath?: { feasible: boolean; max_utilization: number | null; summary: string };
  slings?: { max_tension_t: number; warnings: string[] };
}

// ───────────────────────────── Ortak çizim yardımcıları ─────────────────────────────

const L = 16;
const R = 194;
const PAGE_BOTTOM = 282;

interface Cursor {
  y: number;
}

interface Palette {
  bg: [number, number, number];
  border: [number, number, number];
  title: [number, number, number];
  text: [number, number, number];
}

const AMBER: Palette = { bg: [255, 244, 230], border: [255, 103, 0], title: [150, 60, 0], text: [90, 50, 10] };
const RED: Palette = { bg: [255, 228, 225], border: [255, 60, 45], title: [150, 20, 10], text: [110, 25, 15] };

const CORNER_TR: Record<string, string> = {
  FL: "ÖN SOL", FR: "ÖN SAĞ", RL: "ARKA SOL", RR: "ARKA SAĞ",
};
const SOURCE_TR: Record<string, string> = {
  boom: "Bom", load: "Yük", hook: "Kanca", rope: "Halat", jib: "Jib", tail: "Kuyruk Savrulması",
};
const SEV_TR: Record<string, string> = {
  ok: "Uygun", warning: "Uyarı", collision: "ÇARPIŞMA",
};

function drawHeader(doc: jsPDF, subtitle: string): void {
  doc.setFillColor(12, 14, 17);
  doc.rect(0, 0, 210, 11, "F");
  doc.setTextColor(255, 186, 32);
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  doc.text("HAREKET CRANE PLANNER", L, 7.6);
  doc.setTextColor(180);
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  doc.text(subtitle, R, 7.6, { align: "right" });
}

function drawFooter(doc: jsPDF, meta: ProjectMeta, generatedAt: Date): void {
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(140);
  const left = meta.projectName
    ? `${meta.projectName}${meta.revision ? " — " + meta.revision : ""}`
    : "Hareket Crane Planner";
  doc.text(left, L, 293);
  doc.text(T("Sayfa {n}", { n: doc.getCurrentPageInfo().pageNumber }), 105, 293, { align: "center" });
  doc.text(T("Üretim: {d}", { d: fmtDate(generatedAt) }), R, 293, { align: "right" });
}

/** Yeni sayfa açar, başlığı çizer ve imleci sıfırlar. */
function newSection(doc: jsPDF, cur: Cursor, subtitle: string): void {
  doc.addPage();
  drawHeader(doc, subtitle);
  cur.y = 20;
}

/** Gerekli alan kalmadıysa yeni sayfa açar. */
function checkSpace(doc: jsPDF, cur: Cursor, needed: number, subtitle: string): void {
  if (cur.y + needed > PAGE_BOTTOM) newSection(doc, cur, subtitle);
}

function sectionTitle(doc: jsPDF, cur: Cursor, t: string): void {
  doc.setFont(FONT, "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  cur.y += 2;
  doc.text(t, L, cur.y);
  cur.y += 5;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(40);
}

function kv(doc: jsPDF, cur: Cursor, k: string, v: string, warn = false): void {
  doc.setFont(FONT, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(80);
  doc.text(k, L + 2, cur.y);
  doc.setTextColor(warn ? 200 : 20, warn ? 30 : 20, warn ? 30 : 20);
  doc.setFont(FONT, "bold");
  doc.text(v, R, cur.y, { align: "right" });
  doc.setFont(FONT, "normal");
  cur.y += 5.5;
}

function hr(doc: jsPDF, cur: Cursor): void {
  doc.setDrawColor(200);
  doc.line(L, cur.y, R, cur.y);
  cur.y += 5;
}

/** Renkli (amber/kırmızı) uyarı kutusu — çok satırlı, otomatik kelime kaydırmalı. */
function warnBox(doc: jsPDF, cur: Cursor, title: string, bodyLines: string[], palette: Palette): void {
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  const wrapped = bodyLines.flatMap((l) => doc.splitTextToSize(l, R - L - 6) as string[]);
  const h = 9 + wrapped.length * 4.4 + 3;
  doc.setFillColor(...palette.bg);
  doc.setDrawColor(...palette.border);
  doc.roundedRect(L, cur.y, R - L, h, 2, 2, "FD");
  doc.setTextColor(...palette.title);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8.5);
  doc.text(title, L + 3, cur.y + 6);
  doc.setFont(FONT, "normal");
  doc.setTextColor(...palette.text);
  doc.setFontSize(8);
  wrapped.forEach((l, i) => doc.text(l, L + 3, cur.y + 11 + i * 4.4));
  cur.y += h + 4;
}

/** Metni verilen genişliğe sığdırır (taşarsa "..." ile kırpar). */
function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxWidth) t = t.slice(0, -1);
  return t.length > 1 ? `${t}...` : t;
}

interface TableCol {
  x: number;
  w: number;
  t: string;
}

function drawTableHeader(doc: jsPDF, cur: Cursor, cols: TableCol[]): void {
  doc.setFillColor(28, 30, 34);
  doc.rect(L, cur.y - 4, R - L, 7, "F");
  doc.setTextColor(200);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  cols.forEach((c) => doc.text(c.t, c.x + 1, cur.y));
  doc.setFont(FONT, "normal");
  cur.y += 6.5;
}

/** İmza blokları (hazırlayan / onaylayan / operatör / sapancı-işaretçi). */
function drawSignatureBlock(doc: jsPDF, cur: Cursor, meta: ProjectMeta, approval?: ApprovalState): void {
  sectionTitle(doc, cur, T("Onay ve İmza Blokları"));
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  const intro = doc.splitTextToSize(
    T("Bu kaldırma planı, uygulanmadan önce aşağıdaki taraflarca gözden geçirilip imzalanmalıdır."),
    R - L,
  ) as string[];
  intro.forEach((l, i) => doc.text(l, L, cur.y + i * 4.4));
  cur.y += intro.length * 4.4 + 6;

  const colRole = L;
  const colName = L + 54;
  const colSign = L + 110;
  const colDate = L + 150;

  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(T("Görev"), colRole, cur.y);
  doc.text(T("Ad Soyad"), colName, cur.y);
  doc.text(T("İmza"), colSign, cur.y);
  doc.text(T("Tarih"), colDate, cur.y);
  cur.y += 2;
  doc.setDrawColor(180);
  doc.line(L, cur.y, R, cur.y);
  cur.y += 12;

  const rows: Array<{ role: string; prefill?: string }> = [
    { role: T("Hazırlayan"), prefill: meta.preparedBy || approval?.preparedBy || undefined },
    { role: T("Onaylayan (Kaldırma Mühendisi)"), prefill: meta.approvedBy || approval?.approvedBy || undefined },
    { role: T("Operatör") },
    { role: T("Sapancı / İşaretçi") },
  ];
  doc.setFont(FONT, "normal");
  rows.forEach((r) => {
    doc.setFontSize(9);
    doc.setTextColor(30);
    doc.text(fitText(doc, r.role, colName - colRole - 3), colRole, cur.y);
    if (r.prefill) doc.text(fitText(doc, r.prefill, colSign - colName - 3), colName, cur.y);
    doc.setDrawColor(190);
    doc.line(colName, cur.y + 2, colSign - 4, cur.y + 2);
    doc.line(colSign, cur.y + 2, colDate - 4, cur.y + 2);
    doc.line(colDate, cur.y + 2, R, cur.y + 2);
    cur.y += 18;
  });
}

/** Vektörel onay/ret işareti (alt kümelenmiş fontta ✓/✗ glifleri yok). y = metin taban çizgisi. */
function drawCheckMark(doc: jsPDF, x: number, y: number, checked: boolean): void {
  const s = 3.4;
  const top = y - s + 0.5;
  doc.setLineWidth(0.25);
  doc.setDrawColor(150);
  doc.rect(x, top, s, s);
  doc.setLineWidth(0.55);
  if (checked) {
    doc.setDrawColor(20, 140, 60);
    doc.line(x + 0.6, top + s * 0.55, x + s * 0.42, top + s - 0.6);
    doc.line(x + s * 0.42, top + s - 0.6, x + s - 0.5, top + 0.5);
  } else {
    doc.setDrawColor(200, 30, 30);
    doc.line(x + 0.7, top + 0.7, x + s - 0.7, top + s - 0.7);
    doc.line(x + s - 0.7, top + 0.7, x + 0.7, top + s - 0.7);
  }
  doc.setLineWidth(0.2);
}

/** Kaldırma öncesi kontrol listesi — işaret, madde, işaretleyen, zaman. */
function drawChecklist(doc: jsPDF, cur: Cursor, items: ChecklistItem[], subtitle: string): void {
  const prog = checklistProgress(items);
  checkSpace(doc, cur, 30, subtitle);
  sectionTitle(doc, cur, T("Kaldırma Öncesi Kontrol Listesi ({done}/{total})", { done: prog.done, total: prog.total }));
  const colText = L + 7;
  const colBy = L + 112;
  const colAt = L + 148;
  const header = () => {
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(T("Madde"), colText, cur.y);
    doc.text(T("İşaretleyen"), colBy, cur.y);
    doc.text(T("Zaman"), colAt, cur.y);
    cur.y += 2;
    doc.setDrawColor(190);
    doc.line(L, cur.y, R, cur.y);
    cur.y += 4.5;
  };
  header();
  for (const it of items) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(T(it.text), colBy - colText - 3) as string[];
    const h = Math.max(1, lines.length) * 4.2 + 1.6;
    if (cur.y + h > PAGE_BOTTOM) {
      newSection(doc, cur, subtitle);
      header();
    }
    drawCheckMark(doc, L + 1, cur.y, it.checked);
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    if (it.checked) doc.setTextColor(30);
    else doc.setTextColor(150, 30, 30);
    lines.forEach((l, i) => doc.text(l, colText, cur.y + i * 4.2));
    doc.setFontSize(7.5);
    if (it.checked) {
      doc.setTextColor(90);
      doc.text(fitText(doc, it.by || "—", colAt - colBy - 3), colBy, cur.y);
      doc.text(fitText(doc, fmtIso(it.at), R - colAt), colAt, cur.y);
    } else {
      doc.setTextColor(200, 30, 30);
      doc.text(T("Yapılmadı"), colBy, cur.y);
    }
    cur.y += h;
  }
  cur.y += 1;
  if (!prog.complete) {
    checkSpace(doc, cur, 18, subtitle);
    warnBox(doc, cur, T("KONTROL LİSTESİ TAMAMLANMAMIŞ"), [
      T("{n} madde işaretlenmemiş. Kaldırma, tüm maddeler doğrulanmadan yapılmamalıdır.", { n: prog.total - prog.done }),
    ], RED);
  } else {
    hr(doc, cur);
  }
}

/** Dijital onay kaydı; onaylandıysa "ONAYLANDI" damga kutusu (imza bloklarının hemen üstünde). */
function drawApproval(doc: jsPDF, cur: Cursor, a: ApprovalState, subtitle: string): void {
  checkSpace(doc, cur, 48, subtitle);
  sectionTitle(doc, cur, T("Dijital Onay Kaydı"));
  kv(doc, cur, T("Durum"), T(APPROVAL_STATUS_TR[a.status] ?? a.status), a.status === "rejected");
  kv(doc, cur, T("Hazırlayan"), a.preparedBy || "—");
  if (a.preparedAt) kv(doc, cur, T("Onaya gönderim zamanı"), fmtIso(a.preparedAt));
  kv(doc, cur, T("Onaylayan"), a.approvedBy || "—");
  if (a.approvedAt && (a.status === "approved" || a.status === "rejected")) {
    kv(doc, cur, a.status === "approved" ? T("Onay zamanı") : T("Red zamanı"), fmtIso(a.approvedAt));
  }
  const comment = (a.comment ?? "").trim();
  if (comment) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(80);
    doc.text(T("Yorum:"), L + 2, cur.y);
    cur.y += 4.4;
    const cl = doc.splitTextToSize(comment, R - L - 6) as string[];
    for (const l of cl) {
      checkSpace(doc, cur, 5, subtitle);
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(30);
      doc.text(l, L + 4, cur.y);
      cur.y += 4.4;
    }
    cur.y += 1;
  }
  if (a.status === "approved") {
    checkSpace(doc, cur, 26, subtitle);
    const w = 70;
    const h = 20;
    const x = R - w;
    const y = cur.y;
    doc.setLineWidth(0.8);
    doc.setDrawColor(20, 140, 60);
    doc.setFillColor(232, 248, 236);
    doc.roundedRect(x, y, w, h, 2, 2, "FD");
    doc.setLineWidth(0.2);
    doc.setTextColor(20, 120, 50);
    doc.setFont(FONT, "bold");
    doc.setFontSize(14);
    doc.text(T("ONAYLANDI"), x + w / 2, y + 8, { align: "center" });
    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    doc.text(fitText(doc, a.approvedBy || "—", w - 4), x + w / 2, y + 13, { align: "center" });
    doc.text(fmtIso(a.approvedAt), x + w / 2, y + 17, { align: "center" });
    cur.y += h + 4;
  } else if (a.status === "rejected") {
    checkSpace(doc, cur, 18, subtitle);
    warnBox(doc, cur, T("PLAN REDDEDİLDİ"), [T("Bu kaldırma planı onaylanmamıştır; uygulanamaz.")], RED);
  } else {
    checkSpace(doc, cur, 18, subtitle);
    warnBox(doc, cur, T("PLAN HENÜZ ONAYLANMADI"), [
      T("Durum: {s}. Onay tamamlanmadan kaldırma yapılmamalıdır.", { s: T(APPROVAL_STATUS_TR[a.status] ?? a.status) }),
    ], AMBER);
  }
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(T("Bu dijital onay kaydıdır; ıslak imza yerine geçmez."), L, cur.y);
  cur.y += 7;
}

/** Serbest "Notlar" bölümü — satır satır kaydırılır, sayfa sonunda yeni sayfaya geçer. */
function drawNotes(doc: jsPDF, cur: Cursor, notes: string, subtitle: string): void {
  const text = notes.trim();
  if (!text) return;
  checkSpace(doc, cur, 20, subtitle);
  sectionTitle(doc, cur, T("Notlar"));
  const LINE = 4.6;
  const paragraphs = text.split(/\r?\n/);
  for (const para of paragraphs) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    const lines = para.trim() === "" ? [""] : (doc.splitTextToSize(para, R - L - 4) as string[]);
    for (const line of lines) {
      checkSpace(doc, cur, LINE, subtitle);
      doc.setFont(FONT, "normal");
      doc.setFontSize(9);
      doc.setTextColor(30);
      if (line) doc.text(line, L + 2, cur.y);
      cur.y += LINE;
    }
  }
  cur.y += 1;
  hr(doc, cur);
}

/** Rüzgâr limiti satırları (FullLiftResult.wind) — yük rüzgâr alanına göre izinli hız. */
function drawWindLimit(doc: jsPDF, cur: Cursor, result: FullLiftResult): void {
  const w = result.wind;
  if (!w) return;
  kv(doc, cur, T("Tablo rüzgâr hızı (vinç verisi)"), w.chart_wind_ms != null ? fW(w.chart_wind_ms) : T("vinç verisinde yok"));
  kv(doc, cur, T("Yük rüzgâr alanı (A·cw)"), fA(w.wind_area_m2, 2), w.reduced);
  kv(doc, cur, T("Referans alan (1,2 m²/t · m_H)"), fA(w.reference_area_m2, 2));
  kv(
    doc, cur,
    T("İzinli rüzgâr hızı (bu yük)"),
    w.allowed_wind_ms != null ? fW(w.allowed_wind_ms, 1) : T("vinç verisinde yok"),
    w.reduced || w.allowed_wind_ms == null,
  );
  if (w.reduced) {
    warnBox(doc, cur, T("RÜZGÂR LİMİTİ DÜŞÜRÜLDÜ"), [
      T("Yükün rüzgâr alanı referans alanı aşıyor; izinli rüzgâr hızı tablo değerinin altına düşürülmüştür (v_izin = v_tablo · √(A_ref / A·cw))."),
    ], AMBER);
  }
}

/** Çizimi sayfaya sığdırıp altına başlık yazar; öncesinde çağıran taraf checkSpace çağırmalıdır. */
function placeImage(doc: jsPDF, cur: Cursor, img: CapturedDrawing, caption: string): void {
  const maxW = R - L;
  const maxH = 145;
  let w = maxW;
  let h = w * (img.height / img.width);
  if (h > maxH) {
    h = maxH;
    w = h * (img.width / img.height);
  }
  const x = L + (maxW - w) / 2;
  doc.addImage(img.dataUrl, "PNG", x, cur.y, w, h);
  cur.y += h + 5;
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(caption, 105, cur.y, { align: "center" });
  cur.y += 9;
}

/** Vinç yük tablosundaki üretici amblemi (over_rear_notes), mevcut senaryo (denge/bom/radius)
 * tam olarak bir işaretli noktaya denk geliyorsa döner (aksi halde null). */
function matchingOverRearNote(crane: CraneModel, state: UIState): OverRearNote | null {
  if (!crane.over_rear_notes) return null;
  const EPS = 1e-6;
  for (const note of crane.over_rear_notes) {
    const hit = note.points.some(
      (p) =>
        Math.abs(p.counterweight - state.counterweight) < EPS &&
        Math.abs(p.boom_length - state.boom_length) < EPS &&
        Math.abs(p.radius - state.radius) < EPS,
    );
    if (hit) return note;
  }
  return null;
}

/** Proje meta satırı (varsa) — başlık bloğunda kullanılır. */
function metaSummaryLine(meta: ProjectMeta): string {
  return [
    meta.siteLocation && T("Saha: {v}", { v: meta.siteLocation }),
    meta.client && T("Müşteri: {v}", { v: meta.client }),
    meta.jobNo && T("İş No: {v}", { v: meta.jobNo }),
    meta.revision && `Rev: ${meta.revision}`,
  ]
    .filter(Boolean)
    .join("   ");
}

// ───────────────────────────── Tek adım raporu ─────────────────────────────

/**
 * Tek adımlık kaldırma planı PDF'i. Görsel gömme (yandan görünüş + üstten
 * şematik) ve font/SVG dönüşümü asenkron olduğundan fonksiyon Promise döner —
 * çağıran taraf (App.tsx) `await`/`.then` ile bekler.
 */
export async function generateReport(
  crane: CraneModel,
  state: UIState,
  result: FullLiftResult,
  meta: ProjectMeta,
  drawings?: ReportDrawingRefs,
  opts?: ReportOptions,
  extras?: ReportExtras,
): Promise<void> {
  refreshLocale();
  const o = opts ?? defaultReportOptions();
  const S = o.sections;
  const customTitle = o.title.trim();
  const generatedAt = new Date();
  const [sideImg, topImg] = S.drawings
    ? await Promise.all([
        captureSvgContainer(drawings?.sideView),
        captureSvgContainer(drawings?.topView),
      ])
    : [null, null];

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerFonts(doc);
  if (customTitle) doc.setProperties({ title: customTitle });
  const cur: Cursor = { y: 20 };
  const { capacity, clearance, outrigger, collision } = result;
  const jibClr = !clearance ? result.jib_clearance : undefined;
  const SUBTITLE = customTitle || T("Kaldırma Planı / Lift Plan");

  drawHeader(doc, SUBTITLE);

  if (customTitle) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    const tl = doc.splitTextToSize(customTitle, R - L) as string[];
    tl.forEach((l, i) => doc.text(l, L, cur.y + i * 6));
    cur.y += tl.length * 6 + 2;
    doc.setFont(FONT, "normal");
  }

  // ── Başlık: proje meta + vinç/konfig özeti ──────────────────────────────
  if (S.cover) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    doc.setTextColor(20);
    doc.text(meta.projectName ? T("Proje: {v}", { v: meta.projectName }) : T("Vinç: {v}", { v: crane.model }), L, cur.y);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(T("Üretim: {d}", { d: fmtDate(generatedAt) }), R, cur.y, { align: "right" });
    cur.y += 5.5;
    const metaLine = metaSummaryLine(meta);
    if (meta.projectName) {
      doc.setFontSize(8);
      doc.setTextColor(70);
      if (metaLine) {
        doc.text(metaLine, L, cur.y);
        cur.y += 5;
      }
      doc.text(T("Vinç: {v}", { v: crane.model }), L, cur.y);
      cur.y += 5;
    }
  }
  if (S.cover || S.config) {
    if (!S.cover) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(9);
      doc.setTextColor(20);
      doc.text(T("Vinç: {v}", { v: crane.model }), L, cur.y);
      cur.y += 5.5;
    }
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    doc.setTextColor(20);
    const cfgText = result.jib
      ? `${T("Denge")}: ${nM(state.counterweight)}${U.massU}   ${T("Bom")}: ${nL(state.boom_length)}${U.lenU}   Jib: ${nL(result.jib.jib_length)}${U.lenU} @ ${result.jib.jib_offset} ${DEG()}`
      : `${T("Denge")}: ${nM(state.counterweight)}${U.massU}   ${T("Bom")}: ${nL(state.boom_length)}${U.lenU}   ${T("Kapasite")}: ${pctPre(String(state.capacity_pct))}`;
    doc.text(cfgText, L, cur.y);
    cur.y += 6;
    hr(doc, cur);
  }

  // ── Yük Bilgileri ────────────────────────────────────────────────────────
  if (S.load) {
    sectionTitle(doc, cur, T("Yük Bilgileri"));
    kv(doc, cur, T("Yük ağırlığı"), fM(state.load_weight));
    kv(doc, cur, T("Kanca + Rigging"), `${nM(state.hook_weight)} + ${nM(state.rigging_weight)} ${U.massU}`);
    kv(doc, cur, T("Yük ölçüleri (yükseklik x çap)"), `${nL(state.load_height)} x ${nL(state.load_diameter)} ${U.lenU}`);
    kv(doc, cur, T("Çalışma yarıçapı (radius)"), fL(state.radius));
    kv(doc, cur, T("Engel (yükseklik / genişlik / kancadan merkeze)"), `${nL(state.obstacle_height)} / ${nL(state.obstacle_width)} / ${nL(state.obstacle_distance)} ${U.lenU}`);
    kv(doc, cur, T("Klerens modeli"), T("Gerçek geometri (kanca yük ağırlık merkezinde)"));
    const items = state.rigging_items ?? [];
    if (items.length > 0) {
      checkSpace(doc, cur, 12, SUBTITLE);
      doc.setFont(FONT, "bold");
      doc.setFontSize(9);
      doc.setTextColor(40);
      doc.text(T("Kaldırma aparatları (kancadan aşağı sırayla)"), L + 2, cur.y);
      cur.y += 5.5;
      items.forEach((it, i) => {
        checkSpace(doc, cur, 6, SUBTITLE);
        kv(doc, cur, `${i + 1}. ${T(it.label)}`, `${fM(it.weight_t)}  /  ${fL(it.height_m)}`);
      });
      const tot = riggingTotals(items);
      kv(doc, cur, T("Aparat toplamı (ağırlık / yükseklik)"), `${fM(tot.weight, 2)}  /  ${fL(tot.height, 2)}`);
    }
    const cog = state.load_cog_offset;
    if (cog && (cog.x !== 0 || cog.z !== 0)) {
      checkSpace(doc, cur, 6, SUBTITLE);
      kv(doc, cur, T("Yük ağırlık merkezi kaçıklığı (x / z)"), `${nL(cog.x, 2)} / ${nL(cog.z, 2)} ${U.lenU}`);
    }
    if (extras?.slings) {
      checkSpace(doc, cur, 6, SUBTITLE);
      kv(doc, cur, T("Maks. sapan kol kuvveti"), fM(extras.slings.max_tension_t, 2), extras.slings.warnings.length > 0);
      if (extras.slings.warnings.length > 0) {
        checkSpace(doc, cur, 14 + extras.slings.warnings.length * 5, SUBTITLE);
        warnBox(doc, cur, T("SAPAN UYARILARI"), extras.slings.warnings, AMBER);
      }
    }
    hr(doc, cur);
  }

  // ── Saha Konumu ──────────────────────────────────────────────────────────
  const hasSite =
    state.crane_x != null || state.crane_z != null || state.crane_heading != null || state.ground_slope_pct != null;
  if (S.site && hasSite) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(doc, cur, T("Saha Konumu"));
    kv(doc, cur, T("Vinç konumu (x / z)"), `${nL(state.crane_x ?? 0, 2)} / ${nL(state.crane_z ?? 0, 2)} ${U.lenU}`);
    kv(doc, cur, T("Şasi yönü (heading)"), `${(state.crane_heading ?? 0).toFixed(1)} ${DEG()}`);
    const slope = state.ground_slope_pct;
    if (slope != null) kv(doc, cur, T("Zemin eğimi"), pctPre(slope.toFixed(2)), slope > 1);
    if (slope != null && slope > 1) {
      checkSpace(doc, cur, 18, SUBTITLE);
      warnBox(doc, cur, T("ZEMİN EĞİMİ"), [
        T("Zemin eğimi %1'i aşıyor. Yük tabloları terazisinde kurulmuş vinç için geçerlidir; ayaklarla terazileme yapılmalıdır."),
      ], AMBER);
    }
    hr(doc, cur);
  }

  // ── Kapasite Kontrolü ────────────────────────────────────────────────────
  if (S.capacity) {
    sectionTitle(doc, cur, T("Kapasite Kontrolü"));
    const sevLabel =
      capacity.severity === "over" ? T("KAPASİTE AŞIMI") : capacity.severity === "warning" ? T("KRİTİK KALDIRMA (%90 ve üzeri)") : T("UYGUN");
    kv(doc, cur, T("Toplam yük"), fM(capacity.total_load, 2));
    kv(doc, cur, T("İzin verilen kapasite"), fM(capacity.rated_capacity, 2));
    kv(doc, cur, T("Kullanım yüzdesi"), `${fmtUtil(capacity.utilization_pct, 2)} %`, capacity.severity !== "ok");
    kv(doc, cur, T("Durum"), sevLabel, capacity.severity !== "ok");
    hr(doc, cur);
  }
  // Kapasite uyarı kutuları bölüm kapalı olsa da gösterilir (güvenlik uyarısı).
  if (capacity.severity === "over") {
    warnBox(doc, cur, T("KAPASİTE AŞIMI"), [
      T("Bu konfigürasyonda toplam yük izin verilen kapasiteyi aşıyor. Bu haliyle kaldırma yapılamaz."),
    ], RED);
  } else if (capacity.severity === "warning") {
    warnBox(doc, cur, T("KRİTİK KALDIRMA"), [
      T("Kullanım oranı %90 ve üzerinde. Ek dikkat ve yetkili mühendislik onayı gerekir."),
    ], AMBER);
  }

  // ── Halat Donanımı & Rüzgâr ──────────────────────────────────────────────
  const showReeving = S.config && !!result.reeving;
  const showWind = S.wind && (crane.max_wind_speed_ms != null || !!crane.wind_note || !!result.wind);
  if (showReeving || showWind) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(
      doc, cur,
      S.config && S.wind ? T("Halat Donanımı & Rüzgâr") : showReeving ? T("Halat Donanımı") : T("Rüzgâr"),
    );
    if (showReeving && result.reeving) {
      kv(doc, cur, T("Halat donanımı (reeving)"), T("{n} kollu", { n: result.reeving.required_parts }), !result.reeving.feasible);
      kv(doc, cur, T("Tek halat çekişi"), fM(result.reeving.single_line_pull_t, 1));
      if (!result.reeving.feasible) {
        warnBox(doc, cur, T("DONANIM YETERSİZ"), [
          T("Gerekli halat donanımı vinç makarasının fiziksel sınırını aşıyor — bu yük bu konfigürasyonla kaldırılamaz."),
        ], RED);
      }
    }
    if (showWind) {
      if (crane.max_wind_speed_ms != null && !result.wind) {
        kv(doc, cur, T("Maks. çalışma rüzgârı"), fW(crane.max_wind_speed_ms));
      }
      if (result.wind) {
        checkSpace(doc, cur, 30, SUBTITLE);
        drawWindLimit(doc, cur, result);
      }
      if (crane.wind_note) {
        doc.setFontSize(7.5);
        doc.setTextColor(110);
        const wl = doc.splitTextToSize(crane.wind_note, R - L - 2) as string[];
        wl.forEach((l, i) => doc.text(l, L + 2, cur.y + i * 4));
        cur.y += wl.length * 4 + 2;
      }
    }
    hr(doc, cur);
  }

  // ── Jib Konfigürasyonu ───────────────────────────────────────────────────
  if (result.jib) {
    if (S.config) {
      checkSpace(doc, cur, 45, SUBTITLE);
      sectionTitle(doc, cur, T("Jib Konfigürasyonu"));
      kv(doc, cur, T("Konfigürasyon"), result.lift_config === "TJ_TH" ? T("Bom + Jib") : T("Bom + Uzatma + Jib"));
      kv(doc, cur, T("Jib uzunluğu"), fL(result.jib.jib_length));
      kv(doc, cur, T("Jib ofset açısı"), `${result.jib.jib_offset} ${DEG()}`);
      hr(doc, cur);
    }
    checkSpace(doc, cur, 30, SUBTITLE);
    if (jibClr) {
      warnBox(doc, cur, T("JİB KLERENSİ YAKLAŞIKTIR"), [
        T("Jib modunda klerens ve çarpışma kontrolleri, üretici broşüründe bulunmayan jib mafsal geometrisi tahmin edilerek YAKLAŞIK olarak hesaplanmıştır. Sahadaki gerçek geometri ve klerensler yetkili kaldırma mühendisi tarafından ayrıca doğrulanmalıdır."),
      ], RED);
    } else {
      warnBox(doc, cur, T("KLERENS / ÇARPIŞMA KONTROLÜ YAPILMAMIŞTIR"), [
        T("Bu kaldırma konfigürasyonunda (jib modu) klerens ve çarpışma kontrolleri hesaplanmaz; üreticinin broşüründe jib mafsal geometrisi bulunmamaktadır. Sahadaki gerçek geometri ve klerensler yetkili kaldırma mühendisi tarafından ayrıca doğrulanmalıdır."),
      ], RED);
    }
  }

  // ── Klerens / Geometri ───────────────────────────────────────────────────
  if (S.clearance) {
    checkSpace(doc, cur, 42, SUBTITLE);
    sectionTitle(doc, cur, T("Klerens / Geometri"));
    if (clearance) {
      kv(doc, cur, T("Maks kanca yüksekliği"), fL(clearance.max_hook_height, 3));
      kv(doc, cur, T("Maks sapan aralığı"), fL(clearance.max_sling_spread, 3));
      kv(doc, cur, T("Boma engel klerensi"), fL(clearance.clearance_to_obstacle, 3), clearance.clearance_to_obstacle < 0);
      kv(doc, cur, T("Boma yük klerensi"), fL(clearance.clearance_to_load, 3), clearance.clearance_to_load < 0);
      kv(doc, cur, T("Bom açısı (gama)"), `${((clearance.gama * 180) / Math.PI).toFixed(2)} ${DEG()}`);
    } else if (jibClr) {
      doc.setFontSize(8);
      doc.setTextColor(170, 40, 30);
      doc.text(T("(YAKLAŞIK — jib mafsal geometrisi tahmini)"), L + 2, cur.y);
      cur.y += 5;
      kv(doc, cur, T("Maks kanca yüksekliği (jib ucu)"), fL(jibClr.max_hook_height, 2));
      kv(doc, cur, T("Bom/jib engel klerensi"),
        jibClr.clearance_to_obstacle == null ? T("— (engel yok)") : fL(jibClr.clearance_to_obstacle, 2),
        jibClr.clearance_to_obstacle != null && jibClr.clearance_to_obstacle < 0);
      kv(doc, cur, T("Bom/jib yük klerensi"), fL(jibClr.clearance_to_load, 2), jibClr.clearance_to_load < 0);
    } else {
      kv(doc, cur, T("Jib modu"), T("Klerens/geometri hesaplanmaz (jib mafsal geometrisi yok)"), true);
    }
    hr(doc, cur);
  }

  // ── Çarpışma Kontrolü (ana bom modunda veya yaklaşık jib geometrisiyle) ──
  if (S.collision && (clearance || jibClr)) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(doc, cur, jibClr ? T("Çarpışma Kontrolü (YAKLAŞIK — jib)") : T("Çarpışma Kontrolü"));
    if (collision.active.length === 0) {
      kv(doc, cur, T("Sonuç"), T("Çarpışma/uyarı yok"));
    } else {
      collision.active.slice(0, 12).forEach((c) =>
        kv(
          doc, cur,
          `${T(SOURCE_TR[c.source] ?? c.source)} - ${c.target}`,
          `${fL(c.clearance_m, 2)} (${T(SEV_TR[c.severity])})`,
          c.severity === "collision",
        ),
      );
    }
    if (state.objects.length > 0) kv(doc, cur, T("Çevre nesnesi sayısı"), String(state.objects.length));
    hr(doc, cur);
  }

  // ── Ayak Reaksiyonu (Outrigger) ───────────────────────────────────────────
  if (S.outrigger) {
    checkSpace(doc, cur, 55, SUBTITLE);
    sectionTitle(doc, cur, T("Ayak Reaksiyonu (Outrigger)"));
    if (outrigger) {
      kv(doc, cur, T("Bileşke düşey kuvvet (V)"), fM(outrigger.V, 1));
      kv(
        doc, cur,
        T("En kritik köşe yükü (tüm açılar)"),
        `${fM(outrigger.max_corner_load, 1)} (${outrigger.max_corner_label})`,
        outrigger.max_outrigger_force_exceeded === true,
      );
      kv(doc, cur, T("Kritik dönme açısı"), `${outrigger.critical_angle.toFixed(0)} ${DEG()}`);
      if (outrigger.max_outrigger_force_exceeded) {
        warnBox(doc, cur, T("AYAK KUVVETİ AŞIMI"), [
          T("Üretici maks. ayak kuvveti ({f}) aşıldı.", { f: fM(crane.max_outrigger_force_t ?? 0) }),
        ], RED);
      }
      if (outrigger.ground_pressure != null) {
        kv(doc, cur, T("Zemin basıncı (mevcut takoz)"), fP(outrigger.ground_pressure, 1), outrigger.bearing_ok === false);
      }
      if (outrigger.pad_area != null) kv(doc, cur, T("Takoz temas alanı (kullanılan)"), fA(outrigger.pad_area, 2));
      if (outrigger.bearing_ok != null) {
        kv(doc, cur, T("Zemin taşıma kontrolü"), outrigger.bearing_ok ? T("GEÇER") : T("KALIR"), !outrigger.bearing_ok);
      }
      if (outrigger.required_pad_area_m2 != null) {
        kv(doc, cur, T("Önerilen min. takoz alanı"), fA(outrigger.required_pad_area_m2, 2), outrigger.bearing_ok === false);
      }
      if (outrigger.tipping_risk || outrigger.has_uplift) {
        warnBox(
          doc, cur,
          outrigger.tipping_risk ? T("DEVRİLME RİSKİ") : T("AYAK KALKMASI RİSKİ"),
          [
            outrigger.tipping_risk
              ? T("Ağırlık merkezi, ayakların oluşturduğu destek alanının dışına çıkıyor — devrilme riski.")
              : T("Bazı dönme açılarında bir ayak yüksüz kalıyor (kalkma riski)."),
          ],
          RED,
        );
      }

      // Mevcut yönelim: 4 köşe yükü + CoG kayması.
      const normalizedSlew = ((state.slew_angle % 360) + 360) % 360;
      const atCurrent = outrigger.per_angle.reduce(
        (best, a) => (Math.abs(a.slew_angle - normalizedSlew) < Math.abs(best.slew_angle - normalizedSlew) ? a : best),
        outrigger.per_angle[0],
      );
      checkSpace(doc, cur, 38, SUBTITLE);
      sectionTitle(doc, cur, T("Mevcut Yönelim ({a} derece) — Köşe Yükleri", { a: state.slew_angle }));
      kv(doc, cur, T("Ağırlık merkezi kayması (CoG)"), fL(Math.hypot(atCurrent.cog_x, atCurrent.cog_y), 2));
      atCurrent.corners.forEach((c) => kv(doc, cur, T(CORNER_TR[c.label] ?? c.label), fM(c.load, 1)));
    } else {
      kv(doc, cur, T("Durum"), result.outrigger_error ?? T("Hesaplanamadı (self_weight eksik)"), true);
    }
    hr(doc, cur);
  }

  // ── Tandem (iki vinçli) kaldırma ─────────────────────────────────────────
  const tandem = state.tandem;
  if (S.tandem && tandem?.enabled) {
    checkSpace(doc, cur, 60, SUBTITLE);
    sectionTitle(doc, cur, T("Tandem Kaldırma (İkinci Vinç)"));
    kv(doc, cur, T("İkinci vinç"), tandem.craneModel);
    kv(doc, cur, T("Denge / Bom / Kapasite"), `${fM(tandem.counterweight)}  /  ${fL(tandem.boom_length)}  /  ${pctPre(String(tandem.capacity_pct))}`);
    kv(doc, cur, T("Ayak konfigürasyonu"), tandem.outrigger_config);
    kv(doc, cur, T("Konum (x / z) — yön"), `${nL(tandem.x, 2)} / ${nL(tandem.z, 2)} ${U.lenU} — ${tandem.heading.toFixed(1)} ${DEG()}`);
    kv(doc, cur, T("Yük ağırlık merkezi oranı (0 = ana, 1 = ikinci)"), tandem.cog_ratio.toFixed(2));
    kv(doc, cur, T("Tandem düşürme katsayısı"), pctPre(String(tandem.derate_pct)));
    const tr = extras?.tandem;
    if (tr) {
      const row = (label: string, c: ReportTandemCrane) => {
        checkSpace(doc, cur, 6, SUBTITLE);
        kv(
          doc, cur, label,
          c.allowed_t == null || c.utilization_pct == null
            ? `${fM(c.share_t, 2)} — ${T("tablo dışı / hesaplanamadı")}`
            : `${nM(c.share_t, 2)} / ${nM(c.allowed_t, 2)} ${U.massU}  (${pctPre(c.utilization_pct.toFixed(1))})  ${c.ok ? T("Uygun") : T("AŞIM")}`,
          !c.ok,
        );
      };
      row(T("Ana vinç ({m}) — pay / izin", { m: crane.model }), tr.crane1);
      row(T("İkinci vinç ({m}) — pay / izin", { m: tandem.craneModel }), tr.crane2);
      checkSpace(doc, cur, 12, SUBTITLE);
      kv(doc, cur, T("Kancalar arası mesafe"), fL(tr.hook_distance_m, 2));
      kv(doc, cur, T("Tandem sonucu"), tr.ok ? T("UYGUN") : T("UYGUN DEĞİL"), !tr.ok);
      if (tr.summary) {
        checkSpace(doc, cur, 18, SUBTITLE);
        warnBox(doc, cur, tr.ok ? T("TANDEM ÖZETİ") : T("TANDEM KALDIRMA UYGUN DEĞİL"), [tr.summary], tr.ok ? AMBER : RED);
      }
    }
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, T("TANDEM KALDIRMA — KRİTİK OPERASYON"), [
      T("İki vinçli kaldırmalar kritik kaldırma sayılır; yük paylaşımı senkronizasyona bağlıdır. Ayrıntılı yöntem beyanı ve yetkili kaldırma mühendisi gözetimi gerekir."),
    ], AMBER);
    hr(doc, cur);
  }

  // ── Al–Bırak Güzergâhı ─────────────────────────────────────────────────────
  const lp = state.lift_path;
  const lpRes = extras?.liftPath;
  if (S.liftPath && (lpRes || lp)) {
    checkSpace(doc, cur, 40, SUBTITLE);
    sectionTitle(doc, cur, T("Al–Bırak Güzergâhı"));
    if (lp) {
      kv(doc, cur, T("Alma noktası (x / z / h)"), `${nL(lp.pick.x, 2)} / ${nL(lp.pick.z, 2)} / ${nL(lp.pick.h, 2)} ${U.lenU}`);
      kv(doc, cur, T("Bırakma noktası (x / z / h)"), `${nL(lp.place.x, 2)} / ${nL(lp.place.z, 2)} / ${nL(lp.place.h, 2)} ${U.lenU}`);
      kv(doc, cur, T("Geçiş yüksekliği (min.)"), fL(lp.travel_height, 2));
    }
    if (lpRes) {
      kv(doc, cur, T("Güzergâh uygunluğu"), lpRes.feasible ? T("UYGUN") : T("UYGUN DEĞİL"), !lpRes.feasible);
      if (lpRes.max_utilization != null) {
        kv(doc, cur, T("Güzergâh boyunca maks. kullanım"), pctPre(lpRes.max_utilization.toFixed(1)), lpRes.max_utilization >= 90);
      }
      if (lpRes.summary) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(8.5);
        const sl = doc.splitTextToSize(lpRes.summary, R - L - 4) as string[];
        checkSpace(doc, cur, sl.length * 4.4 + 2, SUBTITLE);
        doc.setFont(FONT, "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(60);
        sl.forEach((l, i) => doc.text(l, L + 2, cur.y + i * 4.4));
        cur.y += sl.length * 4.4 + 2;
      }
      if (!lpRes.feasible) {
        checkSpace(doc, cur, 18, SUBTITLE);
        warnBox(doc, cur, T("GÜZERGÂH UYGUN DEĞİL"), [
          T("Al–bırak güzergâhının en az bir noktasında kapasite/geometri sınırı aşılıyor."),
        ], RED);
      }
    }
    hr(doc, cur);
  }

  // ── Üretici amblemi (over_rear_notes) ─────────────────────────────────────
  const note = matchingOverRearNote(crane, state);
  if (note) {
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, T('ÜRETİCİ AMBLEMİ: "{s}"', { s: note.symbol }), [note.meaning], AMBER);
  }

  // ── Kaynak notu ────────────────────────────────────────────────────────────
  checkSpace(doc, cur, 12, SUBTITLE);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(T("Yük tablosu kaynağı: {s}", { s: crane.source ?? "—" }), L, cur.y);
  cur.y += 4;
  doc.text(T("Üretici yük tablosu esastır; bu rapor yardımcı bir hesap aracıdır ve onun yerine geçmez."), L, cur.y);
  cur.y += 6;

  // ── Genel uyarı ────────────────────────────────────────────────────────────
  checkSpace(doc, cur, 24, SUBTITLE);
  warnBox(doc, cur, T("MANUEL DOĞRULAMA GEREKİR"), [
    T("Bu plan üreticinin gerçek load chart'ına dayanır ancak yetkili kaldırma mühendisi tarafından manuel olarak doğrulanmalıdır. Uygulama karar otoritesi değildir."),
  ], AMBER);

  // ── Çizimler ─────────────────────────────────────────────────────────────
  if (S.drawings && (sideImg || topImg)) {
    newSection(doc, cur, T("Çizimler (ölçeksiz şematik)"));
    if (sideImg) {
      checkSpace(doc, cur, 100, T("Çizimler (ölçeksiz şematik)"));
      placeImage(doc, cur, sideImg, T("Yandan görünüş — ölçeksiz şematik, yalnızca referans amaçlıdır"));
    }
    if (topImg) {
      checkSpace(doc, cur, 100, T("Çizimler (ölçeksiz şematik)"));
      placeImage(doc, cur, topImg, T("Üstten şematik görünüm (ayak izi / yük / ağırlık merkezi) — ölçeksiz"));
    }
  }

  // ── Notlar ───────────────────────────────────────────────────────────────
  if (o.notes.trim()) {
    drawNotes(doc, cur, o.notes, SUBTITLE);
  }

  // ── Kontrol listesi ──────────────────────────────────────────────────────
  const checklist = state.checklist ?? [];
  if (S.checklist && checklist.length > 0) {
    newSection(doc, cur, T("Kontrol Listesi"));
    drawChecklist(doc, cur, checklist, T("Kontrol Listesi (devam)"));
  }

  // ── Onay kaydı + imza blokları ───────────────────────────────────────────
  const approval = state.approval;
  const showApproval = S.approval && !!approval;
  if (showApproval || S.signatures) {
    newSection(doc, cur, T("Onay / İmza"));
    if (showApproval && approval) drawApproval(doc, cur, approval, T("Onay / İmza (devam)"));
    if (S.signatures) {
      if (showApproval) checkSpace(doc, cur, 110, T("Onay / İmza (devam)"));
      drawSignatureBlock(doc, cur, meta, approval);
    }
  }

  // ── Alt bilgi (tüm sayfalar) ─────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, meta, generatedAt);
  }

  doc.save(`lift-plan-${crane.model.replace(/\s+/g, "_")}.pdf`);
}

// ───────────────────────────── Çok adımlı rapor ─────────────────────────────

/** Bir çalışma adımını üretim anında yeniden hesaplar (App.tsx computeLiftFull çağrısıyla birebir). */
function computeStepFull(step: WorkStep): FullLiftResult {
  const cfg = step.config;
  const crane = getCrane(cfg.craneModel);
  return computeLiftFull(crane, liftInputsFromState(cfg), {
    outrigger_config: cfg.outrigger_config,
    slew_angle: cfg.slew_angle,
    crane_heading: cfg.crane_heading ?? 0,
    crane_position: { x: cfg.crane_x ?? 0, z: cfg.crane_z ?? 0 },
    pad_area: cfg.pad_area_m2,
    allowable_bearing_t_m2: cfg.allowable_bearing_t_m2,
    objects: cfg.objects,
    jib:
      cfg.lift_config !== "T"
        ? { config: cfg.lift_config, jib_length: cfg.jib_length, jib_offset: cfg.jib_offset }
        : undefined,
  });
}

/**
 * Çok adımlı kaldırma raporu (Crane Planner 2.0 "report designer / working
 * steps" benzeri). Kapak özet tablosu ve adım detay sayfaları AYNI, üretim
 * anında hesaplanmış sonuçları (computeStepFull) kullanır — kayıtlı
 * WorkStep.summary yalnızca hızlı liste görünümünde (StepsBar) kullanılır,
 * bu yüzden kapak/detay arasında hiçbir zaman çelişki oluşmaz.
 */
export function generateMultiStepReport(steps: WorkStep[], meta: ProjectMeta, opts?: ReportOptions): void {
  if (steps.length === 0) return;
  refreshLocale();
  const o = opts ?? defaultReportOptions();
  const S = o.sections;
  const customTitle = o.title.trim();
  const generatedAt = new Date();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerFonts(doc);
  if (customTitle) doc.setProperties({ title: customTitle });
  const results = steps.map(computeStepFull);
  const SUBTITLE = customTitle || T("Çok Adımlı Kaldırma Planı");

  // ── Kapak / özet tablo ────────────────────────────────────────────────────
  drawHeader(doc, SUBTITLE);
  const cur: Cursor = { y: 20 };
  if (customTitle) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    const tl = doc.splitTextToSize(customTitle, R - L) as string[];
    tl.forEach((l, i) => doc.text(l, L, cur.y + i * 6));
    cur.y += tl.length * 6 + 2;
  }
  if (S.cover) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    doc.setTextColor(70);
    const metaLine = metaSummaryLine(meta);
    if (meta.projectName) {
      doc.text(T("Proje: {v}", { v: meta.projectName }), L, cur.y);
      cur.y += 4.5;
    }
    if (metaLine) {
      doc.text(metaLine, L, cur.y);
      cur.y += 4.5;
    }
    cur.y += 2;
    doc.setTextColor(20);
    doc.setFont(FONT, "bold");
    doc.setFontSize(12);
    doc.text(T("Çalışma Adımları Özeti ({n} adım)", { n: steps.length }), L, cur.y);
    cur.y += 8;

    const cols: TableCol[] = [
      { x: L, w: 8, t: "#" },
      { x: L + 8, w: 40, t: T("Adım") },
      { x: L + 48, w: 22, t: T("Vinç") },
      { x: L + 70, w: 18, t: T("Radius") },
      { x: L + 88, w: 18, t: T("Bom") },
      { x: L + 106, w: 22, t: T("Kullanım") },
      { x: L + 128, w: 26, t: T("Durum") },
      { x: L + 154, w: 24, t: T("Çarpışma") },
    ];
    drawTableHeader(doc, cur, cols);

    doc.setFont(FONT, "normal");
    steps.forEach((s, i) => {
      const r = results[i];
      const over = r.capacity.severity === "over";
      const warn = r.capacity.severity === "warning";
      if (i % 2 === 0) {
        doc.setFillColor(245, 246, 248);
        doc.rect(L, cur.y - 4, R - L, 6.5, "F");
      }
      doc.setTextColor(40);
      doc.setFontSize(8);
      const cells = [
        String(i + 1),
        fitText(doc, s.name, cols[1].w - 2),
        fitText(doc, s.config.craneModel, cols[2].w - 2),
        fL(s.config.radius),
        fL(s.config.boom_length),
        `${fmtUtil(r.capacity.utilization_pct, 1)}%`,
      ];
      cols.slice(0, 6).forEach((c, ci) => doc.text(cells[ci], c.x + 1, cur.y));
      doc.setTextColor(over ? 200 : warn ? 190 : 20, over ? 30 : warn ? 140 : 130, over ? 30 : warn ? 20 : 40);
      doc.setFont(FONT, "bold");
      doc.text(over ? T("AŞIM") : warn ? T("DİKKAT") : T("Uygun"), cols[6].x + 1, cur.y);
      doc.setTextColor(r.collision.worst === "collision" ? 200 : 80, 40, 40);
      doc.text(SEV_TR[r.collision.worst] ? T(SEV_TR[r.collision.worst]) : "-", cols[7].x + 1, cur.y);
      doc.setFont(FONT, "normal");
      cur.y += 6.5;
      if (cur.y > 270) {
        newSection(doc, cur, SUBTITLE);
        drawTableHeader(doc, cur, cols);
      }
    });

    cur.y += 4;
  }
  checkSpace(doc, cur, 20, SUBTITLE);
  warnBox(doc, cur, T("MANUEL DOĞRULAMA GEREKİR"), [
    T("Her adım, uygulanmadan önce yetkili kaldırma mühendisi tarafından doğrulanmalıdır."),
  ], AMBER);

  // ── Adım başına detay sayfaları ───────────────────────────────────────────
  steps.forEach((s, i) => {
    doc.addPage();
    drawHeader(doc, T("Adım {i} / {n}", { i: i + 1, n: steps.length }));
    const stepCur: Cursor = { y: 20 };
    drawStepDetail(doc, stepCur, s, i, results[i], o);
  });

  // ── Notlar ───────────────────────────────────────────────────────────────
  if (o.notes.trim()) {
    doc.addPage();
    drawHeader(doc, T("Notlar"));
    const notesCur: Cursor = { y: 20 };
    drawNotes(doc, notesCur, o.notes, T("Notlar (devam)"));
  }

  // ── İmza blokları ────────────────────────────────────────────────────────
  if (S.signatures) {
    doc.addPage();
    drawHeader(doc, T("Onay / İmza"));
    const sigCur: Cursor = { y: 20 };
    drawSignatureBlock(doc, sigCur, meta);
  }

  // ── Alt bilgi (tüm sayfalar) ─────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, meta, generatedAt);
  }

  doc.save(getLang() === "en" ? `multi-step-plan-${steps.length}-steps.pdf` : `cok-adimli-plan-${steps.length}-adim.pdf`);
}

/** Tek bir adımın detay sayfasını çizer (result üretim anında computeStepFull ile hesaplanmıştır). */
function drawStepDetail(
  doc: jsPDF,
  cur: Cursor,
  step: WorkStep,
  index: number,
  result: FullLiftResult,
  o: ReportOptions,
): void {
  const S = o.sections;
  const cfg = step.config;
  const crane = getCrane(cfg.craneModel);
  const { capacity, clearance, outrigger, collision } = result;
  const jibClr = !clearance ? result.jib_clearance : undefined;
  const SUBTITLE = T("Adım {i} (devam)", { i: index + 1 });

  doc.setTextColor(20);
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  doc.text(T("Adım {i}: {name}", { i: index + 1, name: step.name }), L, cur.y);
  cur.y += 7;
  if (S.config) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(9);
    doc.setTextColor(60);
    const stepCfgText = result.jib
      ? `${crane.model}  —  ${T("Denge")} ${nM(cfg.counterweight)}${U.massU}  —  ${T("Bom")} ${nL(cfg.boom_length)}${U.lenU}  —  Jib ${nL(result.jib.jib_length)}${U.lenU}@${result.jib.jib_offset} ${DEG()}  —  ${T("Dönme")} ${cfg.slew_angle} ${DEG()}`
      : `${crane.model}  —  ${T("Denge")} ${nM(cfg.counterweight)}${U.massU}  —  ${T("Bom")} ${nL(cfg.boom_length)}${U.lenU}  —  ${pctPre(String(cfg.capacity_pct))}  —  ${T("Dönme")} ${cfg.slew_angle} ${DEG()}`;
    doc.text(stepCfgText, L, cur.y);
    cur.y += 6;
  }
  hr(doc, cur);

  if (S.capacity) {
    sectionTitle(doc, cur, T("Kapasite"));
    const sevLabel =
      capacity.severity === "over" ? T("KAPASİTE AŞIMI") : capacity.severity === "warning" ? T("KRİTİK KALDIRMA (%90 ve üzeri)") : T("UYGUN");
    kv(doc, cur, T("Toplam yük"), fM(capacity.total_load, 2));
    kv(doc, cur, T("İzin verilen kapasite"), fM(capacity.rated_capacity, 2));
    kv(doc, cur, T("Kullanım"), `${fmtUtil(capacity.utilization_pct, 2)} %`, capacity.severity !== "ok");
    kv(doc, cur, T("Durum"), sevLabel, capacity.severity !== "ok");
    hr(doc, cur);
  } else if (capacity.severity !== "ok") {
    // Bölüm kapalı olsa da kapasite uyarısı gösterilir.
    warnBox(
      doc, cur,
      capacity.severity === "over" ? T("KAPASİTE AŞIMI") : T("KRİTİK KALDIRMA"),
      [T("Kullanım: {v} %", { v: fmtUtil(capacity.utilization_pct, 1) })],
      capacity.severity === "over" ? RED : AMBER,
    );
  }

  const showReeving = S.config && !!result.reeving;
  const showWind = S.wind && (crane.max_wind_speed_ms != null || !!crane.wind_note || !!result.wind);
  if (showReeving || showWind) {
    checkSpace(doc, cur, 24, SUBTITLE);
    sectionTitle(
      doc, cur,
      S.config && S.wind ? T("Halat Donanımı & Rüzgâr") : showReeving ? T("Halat Donanımı") : T("Rüzgâr"),
    );
    if (showReeving && result.reeving) {
      kv(doc, cur, T("Halat donanımı (reeving)"), T("{n} kollu", { n: result.reeving.required_parts }), !result.reeving.feasible);
    }
    if (showWind) {
      if (result.wind) {
        checkSpace(doc, cur, 26, SUBTITLE);
        drawWindLimit(doc, cur, result);
      } else if (crane.max_wind_speed_ms != null) {
        kv(doc, cur, T("Maks. çalışma rüzgârı"), fW(crane.max_wind_speed_ms));
      }
    }
    hr(doc, cur);
  }

  if (result.jib) {
    checkSpace(doc, cur, 20, SUBTITLE);
    if (jibClr) {
      warnBox(doc, cur, T("JİB KLERENSİ YAKLAŞIKTIR"), [
        T("Jib modunda klerens/çarpışma, tahmini jib mafsal geometrisiyle yaklaşık hesaplanmıştır; sahada doğrulanmalıdır."),
      ], RED);
    } else {
      warnBox(doc, cur, T("KLERENS/ÇARPIŞMA KONTROLÜ YAPILMAMIŞTIR"), [
        T("Jib modunda klerens ve çarpışma kontrolleri hesaplanmaz (broşürde jib mafsal geometrisi yok)."),
      ], RED);
    }
  }

  if (S.clearance) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(doc, cur, T("Klerens / Geometri"));
    if (clearance) {
      kv(doc, cur, T("Boma engel klerensi"), fL(clearance.clearance_to_obstacle, 2), clearance.clearance_to_obstacle < 0);
      kv(doc, cur, T("Boma yük klerensi"), fL(clearance.clearance_to_load, 2), clearance.clearance_to_load < 0);
      kv(doc, cur, T("Maks kanca yüksekliği"), fL(clearance.max_hook_height, 2));
    } else if (jibClr) {
      doc.setFontSize(8);
      doc.setTextColor(170, 40, 30);
      doc.text(T("(YAKLAŞIK — jib mafsal geometrisi tahmini)"), L + 2, cur.y);
      cur.y += 5;
      kv(doc, cur, T("Bom/jib engel klerensi"), (jibClr.clearance_to_obstacle == null ? T("— (engel yok)") : fL(jibClr.clearance_to_obstacle, 2)), (jibClr.clearance_to_obstacle ?? 1) < 0);
      kv(doc, cur, T("Bom/jib yük klerensi"), fL(jibClr.clearance_to_load, 2), jibClr.clearance_to_load < 0);
      kv(doc, cur, T("Maks kanca yüksekliği (jib ucu)"), fL(jibClr.max_hook_height, 2));
    } else {
      kv(doc, cur, T("Jib modu"), T("Klerens hesaplanmaz"), true);
    }
    hr(doc, cur);
  }

  if (S.outrigger) {
    checkSpace(doc, cur, 45, SUBTITLE);
    sectionTitle(doc, cur, T("Ayak Reaksiyonu"));
    if (outrigger) {
      kv(doc, cur, T("Bileşke düşey kuvvet"), fM(outrigger.V, 1));
      kv(doc, cur, T("En kritik köşe yükü"), `${fM(outrigger.max_corner_load, 1)} (${outrigger.max_corner_label})`, outrigger.max_outrigger_force_exceeded === true);
      kv(doc, cur, T("Kritik dönme açısı"), `${outrigger.critical_angle.toFixed(0)} ${DEG()}`);
      if (outrigger.ground_pressure != null) kv(doc, cur, T("Zemin basıncı"), fP(outrigger.ground_pressure, 1), outrigger.bearing_ok === false);
      if (outrigger.bearing_ok != null) kv(doc, cur, T("Zemin taşıma kontrolü"), outrigger.bearing_ok ? T("GEÇER") : T("KALIR"), !outrigger.bearing_ok);
      if (outrigger.required_pad_area_m2 != null) kv(doc, cur, T("Önerilen min. takoz alanı"), fA(outrigger.required_pad_area_m2, 2), outrigger.bearing_ok === false);
      if (outrigger.tipping_risk) warnBox(doc, cur, T("DEVRİLME RİSKİ"), [T("Ağırlık merkezi destek alanının dışına çıkıyor.")], RED);
      else if (outrigger.has_uplift) warnBox(doc, cur, T("AYAK KALKMASI RİSKİ"), [T("Bazı açılarda bir ayak yüksüz kalıyor.")], RED);
    } else {
      kv(doc, cur, T("Durum"), result.outrigger_error ?? T("Hesaplanamadı"), true);
    }
    hr(doc, cur);
  }

  if (S.collision) {
    checkSpace(doc, cur, 40, SUBTITLE);
    sectionTitle(doc, cur, jibClr ? T("Çarpışma Kontrolü (YAKLAŞIK — jib)") : T("Çarpışma Kontrolü"));
    if (collision.active.length === 0) {
      kv(doc, cur, T("Sonuç"), T("Çarpışma/uyarı yok"));
    } else {
      collision.active.slice(0, 8).forEach((c) =>
        kv(doc, cur, `${T(SOURCE_TR[c.source] ?? c.source)} - ${c.target}`, `${fL(c.clearance_m, 2)} (${T(SEV_TR[c.severity])})`, c.severity === "collision"),
      );
    }
    if (cfg.objects.length > 0) kv(doc, cur, T("Çevre nesnesi sayısı"), String(cfg.objects.length));
  }

  const note = matchingOverRearNote(crane, cfg);
  if (note) {
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, T('ÜRETİCİ AMBLEMİ: "{s}"', { s: note.symbol }), [note.meaning], AMBER);
  }

  checkSpace(doc, cur, 10, SUBTITLE);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(T("Yük tablosu kaynağı: {s}", { s: crane.source ?? "—" }), L, cur.y);
  cur.y += 4;
}

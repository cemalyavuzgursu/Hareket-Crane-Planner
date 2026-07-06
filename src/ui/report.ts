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
import type { ProjectMeta, UIState, WorkStep } from "./state";
import { DEJAVU_SANS_BOLD_B64, DEJAVU_SANS_NORMAL_B64 } from "./reportFonts";

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
  boom: "Bom", load: "Yük", hook: "Kanca", rope: "Halat", tail: "Kuyruk Savrulması",
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
  doc.text(`Sayfa ${doc.getCurrentPageInfo().pageNumber}`, 105, 293, { align: "center" });
  doc.text(`Üretim: ${generatedAt.toLocaleString("tr-TR")}`, R, 293, { align: "right" });
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
function drawSignatureBlock(doc: jsPDF, cur: Cursor, meta: ProjectMeta): void {
  sectionTitle(doc, cur, "Onay ve İmza Blokları");
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  const intro = doc.splitTextToSize(
    "Bu kaldırma planı, uygulanmadan önce aşağıdaki taraflarca gözden geçirilip imzalanmalıdır.",
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
  doc.text("Görev", colRole, cur.y);
  doc.text("Ad Soyad", colName, cur.y);
  doc.text("İmza", colSign, cur.y);
  doc.text("Tarih", colDate, cur.y);
  cur.y += 2;
  doc.setDrawColor(180);
  doc.line(L, cur.y, R, cur.y);
  cur.y += 12;

  const rows: Array<{ role: string; prefill?: string }> = [
    { role: "Hazırlayan", prefill: meta.preparedBy },
    { role: "Onaylayan (Kaldırma Mühendisi)", prefill: meta.approvedBy },
    { role: "Operatör" },
    { role: "Sapancı / İşaretçi" },
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
    meta.siteLocation && `Saha: ${meta.siteLocation}`,
    meta.client && `Müşteri: ${meta.client}`,
    meta.jobNo && `İş No: ${meta.jobNo}`,
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
): Promise<void> {
  const generatedAt = new Date();
  const [sideImg, topImg] = await Promise.all([
    captureSvgContainer(drawings?.sideView),
    captureSvgContainer(drawings?.topView),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerFonts(doc);
  const cur: Cursor = { y: 20 };
  const { capacity, clearance, outrigger, collision } = result;
  const SUBTITLE = "Kaldırma Planı / Lift Plan";

  drawHeader(doc, SUBTITLE);

  // ── Başlık: proje meta + vinç/konfig özeti ──────────────────────────────
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.setTextColor(20);
  doc.text(meta.projectName ? `Proje: ${meta.projectName}` : `Vinç: ${crane.model}`, L, cur.y);
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(`Üretim: ${generatedAt.toLocaleString("tr-TR")}`, R, cur.y, { align: "right" });
  cur.y += 5.5;
  const metaLine = metaSummaryLine(meta);
  if (meta.projectName) {
    doc.setFontSize(8);
    doc.setTextColor(70);
    if (metaLine) {
      doc.text(metaLine, L, cur.y);
      cur.y += 5;
    }
    doc.text(`Vinç: ${crane.model}`, L, cur.y);
    cur.y += 5;
  }
  doc.setFontSize(9);
  doc.setTextColor(20);
  const cfgText = result.jib
    ? `Denge: ${state.counterweight}t   Bom: ${state.boom_length}m   Jib: ${result.jib.jib_length}m @ ${result.jib.jib_offset} derece`
    : `Denge: ${state.counterweight}t   Bom: ${state.boom_length}m   Kapasite: %${state.capacity_pct}`;
  doc.text(cfgText, L, cur.y);
  cur.y += 6;
  hr(doc, cur);

  // ── Yük Bilgileri ────────────────────────────────────────────────────────
  sectionTitle(doc, cur, "Yük Bilgileri");
  kv(doc, cur, "Yük ağırlığı", `${state.load_weight} t`);
  kv(doc, cur, "Kanca + Rigging", `${state.hook_weight} + ${state.rigging_weight} t`);
  kv(doc, cur, "Yük ölçüleri (yükseklik x çap)", `${state.load_height} x ${state.load_diameter} m`);
  kv(doc, cur, "Çalışma yarıçapı (radius)", `${state.radius} m`);
  kv(doc, cur, "Engel (yükseklik / uzaklık)", `${state.obstacle_height} / ${state.obstacle_distance} m`);
  hr(doc, cur);

  // ── Kapasite Kontrolü ────────────────────────────────────────────────────
  sectionTitle(doc, cur, "Kapasite Kontrolü");
  const sevLabel =
    capacity.severity === "over" ? "KAPASİTE AŞIMI" : capacity.severity === "warning" ? "KRİTİK KALDIRMA (≥ %90)" : "UYGUN";
  kv(doc, cur, "Toplam yük", `${capacity.total_load.toFixed(2)} t`);
  kv(doc, cur, "İzin verilen kapasite", `${capacity.rated_capacity.toFixed(2)} t`);
  kv(doc, cur, "Kullanım yüzdesi", `${capacity.utilization_pct.toFixed(2)} %`, capacity.severity !== "ok");
  kv(doc, cur, "Durum", sevLabel, capacity.severity !== "ok");
  hr(doc, cur);
  if (capacity.severity === "over") {
    warnBox(doc, cur, "KAPASİTE AŞIMI", [
      "Bu konfigürasyonda toplam yük izin verilen kapasiteyi aşıyor. Bu haliyle kaldırma yapılamaz.",
    ], RED);
  } else if (capacity.severity === "warning") {
    warnBox(doc, cur, "KRİTİK KALDIRMA", [
      "Kullanım oranı %90 ve üzerinde. Ek dikkat ve yetkili mühendislik onayı gerekir.",
    ], AMBER);
  }

  // ── Halat Donanımı & Rüzgâr ──────────────────────────────────────────────
  if (result.reeving || crane.max_wind_speed_ms != null || crane.wind_note) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(doc, cur, "Halat Donanımı & Rüzgâr");
    if (result.reeving) {
      kv(doc, cur, "Halat donanımı (reeving)", `${result.reeving.required_parts} kollu`, !result.reeving.feasible);
      kv(doc, cur, "Tek halat çekişi", `${result.reeving.single_line_pull_t.toFixed(1)} t`);
      if (!result.reeving.feasible) {
        warnBox(doc, cur, "DONANIM YETERSİZ", [
          "Gerekli halat donanımı vinç makarasının fiziksel sınırını aşıyor — bu yük bu konfigürasyonla kaldırılamaz.",
        ], RED);
      }
    }
    if (crane.max_wind_speed_ms != null) {
      kv(doc, cur, "Maks. çalışma rüzgârı", `${crane.max_wind_speed_ms} m/s`);
    }
    if (crane.wind_note) {
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      const wl = doc.splitTextToSize(crane.wind_note, R - L - 2) as string[];
      wl.forEach((l, i) => doc.text(l, L + 2, cur.y + i * 4));
      cur.y += wl.length * 4 + 2;
    }
    hr(doc, cur);
  }

  // ── Jib Konfigürasyonu ───────────────────────────────────────────────────
  if (result.jib) {
    checkSpace(doc, cur, 45, SUBTITLE);
    sectionTitle(doc, cur, "Jib Konfigürasyonu");
    kv(doc, cur, "Konfigürasyon", result.lift_config === "TJ_TH" ? "Bom + Jib" : "Bom + Uzatma + Jib");
    kv(doc, cur, "Jib uzunluğu", `${result.jib.jib_length} m`);
    kv(doc, cur, "Jib ofset açısı", `${result.jib.jib_offset} derece`);
    hr(doc, cur);
    warnBox(doc, cur, "KLERENS / ÇARPIŞMA KONTROLÜ YAPILMAMIŞTIR", [
      "Bu kaldırma konfigürasyonunda (jib modu) klerens ve çarpışma kontrolleri hesaplanmaz; üreticinin " +
        "broşüründe jib mafsal geometrisi bulunmamaktadır. Sahadaki gerçek geometri ve klerensler yetkili " +
        "kaldırma mühendisi tarafından ayrıca doğrulanmalıdır.",
    ], RED);
  }

  // ── Klerens / Geometri ───────────────────────────────────────────────────
  checkSpace(doc, cur, 42, SUBTITLE);
  sectionTitle(doc, cur, "Klerens / Geometri");
  if (clearance) {
    kv(doc, cur, "Maks kanca yüksekliği", `${clearance.max_hook_height.toFixed(3)} m`);
    kv(doc, cur, "Maks sapan aralığı", `${clearance.max_sling_spread.toFixed(3)} m`);
    kv(doc, cur, "Boma engel klerensi", `${clearance.clearance_to_obstacle.toFixed(3)} m`, clearance.clearance_to_obstacle < 0);
    kv(doc, cur, "Boma yük klerensi", `${clearance.clearance_to_load.toFixed(3)} m`, clearance.clearance_to_load < 0);
    kv(doc, cur, "Bom açısı (gama)", `${((clearance.gama * 180) / Math.PI).toFixed(2)} derece`);
  } else {
    kv(doc, cur, "Jib modu", "Klerens/geometri hesaplanmaz (jib mafsal geometrisi yok)", true);
  }
  hr(doc, cur);

  // ── Çarpışma Kontrolü (yalnız ana bom modunda anlamlı) ───────────────────
  if (clearance) {
    checkSpace(doc, cur, 30, SUBTITLE);
    sectionTitle(doc, cur, "Çarpışma Kontrolü");
    if (collision.active.length === 0) {
      kv(doc, cur, "Sonuç", "Çarpışma/uyarı yok");
    } else {
      collision.active.slice(0, 12).forEach((c) =>
        kv(
          doc, cur,
          `${SOURCE_TR[c.source] ?? c.source} - ${c.target}`,
          `${c.clearance_m.toFixed(2)} m (${SEV_TR[c.severity]})`,
          c.severity === "collision",
        ),
      );
    }
    if (state.objects.length > 0) kv(doc, cur, "Çevre nesnesi sayısı", String(state.objects.length));
    hr(doc, cur);
  }

  // ── Ayak Reaksiyonu (Outrigger) ───────────────────────────────────────────
  checkSpace(doc, cur, 55, SUBTITLE);
  sectionTitle(doc, cur, "Ayak Reaksiyonu (Outrigger)");
  if (outrigger) {
    kv(doc, cur, "Bileşke düşey kuvvet (V)", `${outrigger.V.toFixed(1)} t`);
    kv(
      doc, cur,
      "En kritik köşe yükü (tüm açılar)",
      `${outrigger.max_corner_load.toFixed(1)} t (${outrigger.max_corner_label})`,
      outrigger.max_outrigger_force_exceeded === true,
    );
    kv(doc, cur, "Kritik dönme açısı", `${outrigger.critical_angle.toFixed(0)} derece`);
    if (outrigger.max_outrigger_force_exceeded) {
      warnBox(doc, cur, "AYAK KUVVETİ AŞIMI", [
        `Üretici maks. ayak kuvveti (${crane.max_outrigger_force_t} t) aşıldı.`,
      ], RED);
    }
    if (outrigger.ground_pressure != null) {
      kv(doc, cur, "Zemin basıncı (mevcut takoz)", `${outrigger.ground_pressure.toFixed(1)} t/m²`, outrigger.bearing_ok === false);
    }
    if (outrigger.pad_area != null) kv(doc, cur, "Takoz temas alanı (kullanılan)", `${outrigger.pad_area.toFixed(2)} m²`);
    if (outrigger.bearing_ok != null) {
      kv(doc, cur, "Zemin taşıma kontrolü", outrigger.bearing_ok ? "GEÇER" : "KALIR", !outrigger.bearing_ok);
    }
    if (outrigger.required_pad_area_m2 != null) {
      kv(doc, cur, "Önerilen min. takoz alanı", `${outrigger.required_pad_area_m2.toFixed(2)} m²`, outrigger.bearing_ok === false);
    }
    if (outrigger.tipping_risk || outrigger.has_uplift) {
      warnBox(
        doc, cur,
        outrigger.tipping_risk ? "DEVRİLME RİSKİ" : "AYAK KALKMASI RİSKİ",
        [
          outrigger.tipping_risk
            ? "Ağırlık merkezi, ayakların oluşturduğu destek alanının dışına çıkıyor — devrilme riski."
            : "Bazı dönme açılarında bir ayak yüksüz kalıyor (kalkma riski).",
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
    sectionTitle(doc, cur, `Mevcut Yönelim (${state.slew_angle} derece) — Köşe Yükleri`);
    kv(doc, cur, "Ağırlık merkezi kayması (CoG)", `${Math.hypot(atCurrent.cog_x, atCurrent.cog_y).toFixed(2)} m`);
    atCurrent.corners.forEach((c) => kv(doc, cur, CORNER_TR[c.label] ?? c.label, `${c.load.toFixed(1)} t`));
  } else {
    kv(doc, cur, "Durum", result.outrigger_error ?? "Hesaplanamadı (self_weight eksik)", true);
  }
  hr(doc, cur);

  // ── Üretici amblemi (over_rear_notes) ─────────────────────────────────────
  const note = matchingOverRearNote(crane, state);
  if (note) {
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, `ÜRETİCİ AMBLEMİ: "${note.symbol}"`, [note.meaning], AMBER);
  }

  // ── Kaynak notu ────────────────────────────────────────────────────────────
  checkSpace(doc, cur, 12, SUBTITLE);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(`Yük tablosu kaynağı: ${crane.source ?? "—"}`, L, cur.y);
  cur.y += 4;
  doc.text("Üretici yük tablosu esastır; bu rapor yardımcı bir hesap aracıdır ve onun yerine geçmez.", L, cur.y);
  cur.y += 6;

  // ── Genel uyarı ────────────────────────────────────────────────────────────
  checkSpace(doc, cur, 24, SUBTITLE);
  warnBox(doc, cur, "MANUEL DOĞRULAMA GEREKİR", [
    "Bu plan üreticinin gerçek load chart'ına dayanır ancak yetkili kaldırma mühendisi tarafından manuel " +
      "olarak doğrulanmalıdır. Uygulama karar otoritesi değildir.",
  ], AMBER);

  // ── Çizimler ─────────────────────────────────────────────────────────────
  if (sideImg || topImg) {
    newSection(doc, cur, "Çizimler (ölçeksiz şematik)");
    if (sideImg) {
      checkSpace(doc, cur, 100, "Çizimler (ölçeksiz şematik)");
      placeImage(doc, cur, sideImg, "Yandan görünüş — ölçeksiz şematik, yalnızca referans amaçlıdır");
    }
    if (topImg) {
      checkSpace(doc, cur, 100, "Çizimler (ölçeksiz şematik)");
      placeImage(doc, cur, topImg, "Üstten şematik görünüm (ayak izi / yük / ağırlık merkezi) — ölçeksiz");
    }
  }

  // ── İmza blokları ────────────────────────────────────────────────────────
  newSection(doc, cur, "Onay / İmza");
  drawSignatureBlock(doc, cur, meta);

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
  return computeLiftFull(crane, cfg, {
    outrigger_config: cfg.outrigger_config,
    slew_angle: cfg.slew_angle,
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
export function generateMultiStepReport(steps: WorkStep[], meta: ProjectMeta): void {
  if (steps.length === 0) return;
  const generatedAt = new Date();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  registerFonts(doc);
  const results = steps.map(computeStepFull);
  const SUBTITLE = "Çok Adımlı Kaldırma Planı";

  // ── Kapak / özet tablo ────────────────────────────────────────────────────
  drawHeader(doc, SUBTITLE);
  const cur: Cursor = { y: 20 };
  doc.setFont(FONT, "normal");
  doc.setFontSize(8);
  doc.setTextColor(70);
  const metaLine = metaSummaryLine(meta);
  if (meta.projectName) {
    doc.text(`Proje: ${meta.projectName}`, L, cur.y);
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
  doc.text(`Çalışma Adımları Özeti (${steps.length} adım)`, L, cur.y);
  cur.y += 8;

  const cols: TableCol[] = [
    { x: L, w: 8, t: "#" },
    { x: L + 8, w: 40, t: "Adım" },
    { x: L + 48, w: 22, t: "Vinç" },
    { x: L + 70, w: 18, t: "Radius" },
    { x: L + 88, w: 18, t: "Bom" },
    { x: L + 106, w: 22, t: "Kullanım" },
    { x: L + 128, w: 26, t: "Durum" },
    { x: L + 154, w: 24, t: "Çarpışma" },
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
      `${s.config.radius} m`,
      `${s.config.boom_length} m`,
      `${r.capacity.utilization_pct.toFixed(1)}%`,
    ];
    cols.slice(0, 6).forEach((c, ci) => doc.text(cells[ci], c.x + 1, cur.y));
    doc.setTextColor(over ? 200 : warn ? 190 : 20, over ? 30 : warn ? 140 : 130, over ? 30 : warn ? 20 : 40);
    doc.setFont(FONT, "bold");
    doc.text(over ? "AŞIM" : warn ? "DİKKAT" : "Uygun", cols[6].x + 1, cur.y);
    doc.setTextColor(r.collision.worst === "collision" ? 200 : 80, 40, 40);
    doc.text(SEV_TR[r.collision.worst] ?? "-", cols[7].x + 1, cur.y);
    doc.setFont(FONT, "normal");
    cur.y += 6.5;
    if (cur.y > 270) {
      newSection(doc, cur, SUBTITLE);
      drawTableHeader(doc, cur, cols);
    }
  });

  cur.y += 4;
  checkSpace(doc, cur, 20, SUBTITLE);
  warnBox(doc, cur, "MANUEL DOĞRULAMA GEREKİR", [
    "Her adım, uygulanmadan önce yetkili kaldırma mühendisi tarafından doğrulanmalıdır.",
  ], AMBER);

  // ── Adım başına detay sayfaları ───────────────────────────────────────────
  steps.forEach((s, i) => {
    doc.addPage();
    drawHeader(doc, `Adım ${i + 1} / ${steps.length}`);
    const stepCur: Cursor = { y: 20 };
    drawStepDetail(doc, stepCur, s, i, results[i]);
  });

  // ── İmza blokları ────────────────────────────────────────────────────────
  doc.addPage();
  drawHeader(doc, "Onay / İmza");
  const sigCur: Cursor = { y: 20 };
  drawSignatureBlock(doc, sigCur, meta);

  // ── Alt bilgi (tüm sayfalar) ─────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, meta, generatedAt);
  }

  doc.save(`cok-adimli-plan-${steps.length}-adim.pdf`);
}

/** Tek bir adımın detay sayfasını çizer (result üretim anında computeStepFull ile hesaplanmıştır). */
function drawStepDetail(doc: jsPDF, cur: Cursor, step: WorkStep, index: number, result: FullLiftResult): void {
  const cfg = step.config;
  const crane = getCrane(cfg.craneModel);
  const { capacity, clearance, outrigger, collision } = result;
  const SUBTITLE = `Adım ${index + 1} (devam)`;

  doc.setTextColor(20);
  doc.setFont(FONT, "bold");
  doc.setFontSize(13);
  doc.text(`Adım ${index + 1}: ${step.name}`, L, cur.y);
  cur.y += 7;
  doc.setFont(FONT, "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);
  const stepCfgText = result.jib
    ? `${crane.model}  —  Denge ${cfg.counterweight}t  —  Bom ${cfg.boom_length}m  —  Jib ${result.jib.jib_length}m@${result.jib.jib_offset} derece  —  Dönme ${cfg.slew_angle} derece`
    : `${crane.model}  —  Denge ${cfg.counterweight}t  —  Bom ${cfg.boom_length}m  —  %${cfg.capacity_pct}  —  Dönme ${cfg.slew_angle} derece`;
  doc.text(stepCfgText, L, cur.y);
  cur.y += 6;
  hr(doc, cur);

  sectionTitle(doc, cur, "Kapasite");
  const sevLabel =
    capacity.severity === "over" ? "KAPASİTE AŞIMI" : capacity.severity === "warning" ? "KRİTİK KALDIRMA (≥ %90)" : "UYGUN";
  kv(doc, cur, "Toplam yük", `${capacity.total_load.toFixed(2)} t`);
  kv(doc, cur, "İzin verilen kapasite", `${capacity.rated_capacity.toFixed(2)} t`);
  kv(doc, cur, "Kullanım", `${capacity.utilization_pct.toFixed(2)} %`, capacity.severity !== "ok");
  kv(doc, cur, "Durum", sevLabel, capacity.severity !== "ok");
  hr(doc, cur);

  if (result.reeving || crane.max_wind_speed_ms != null || crane.wind_note) {
    checkSpace(doc, cur, 24, SUBTITLE);
    sectionTitle(doc, cur, "Halat Donanımı & Rüzgâr");
    if (result.reeving) {
      kv(doc, cur, "Halat donanımı (reeving)", `${result.reeving.required_parts} kollu`, !result.reeving.feasible);
    }
    if (crane.max_wind_speed_ms != null) kv(doc, cur, "Maks. çalışma rüzgârı", `${crane.max_wind_speed_ms} m/s`);
    hr(doc, cur);
  }

  if (result.jib) {
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, "KLERENS/ÇARPIŞMA KONTROLÜ YAPILMAMIŞTIR", [
      "Jib modunda klerens ve çarpışma kontrolleri hesaplanmaz (broşürde jib mafsal geometrisi yok).",
    ], RED);
  }

  checkSpace(doc, cur, 30, SUBTITLE);
  if (clearance) {
    sectionTitle(doc, cur, "Klerens / Geometri");
    kv(doc, cur, "Boma engel klerensi", `${clearance.clearance_to_obstacle.toFixed(2)} m`, clearance.clearance_to_obstacle < 0);
    kv(doc, cur, "Boma yük klerensi", `${clearance.clearance_to_load.toFixed(2)} m`, clearance.clearance_to_load < 0);
    kv(doc, cur, "Maks kanca yüksekliği", `${clearance.max_hook_height.toFixed(2)} m`);
  } else {
    sectionTitle(doc, cur, "Klerens / Geometri");
    kv(doc, cur, "Jib modu", "Klerens hesaplanmaz", true);
  }
  hr(doc, cur);

  checkSpace(doc, cur, 45, SUBTITLE);
  sectionTitle(doc, cur, "Ayak Reaksiyonu");
  if (outrigger) {
    kv(doc, cur, "Bileşke düşey kuvvet", `${outrigger.V.toFixed(1)} t`);
    kv(doc, cur, "En kritik köşe yükü", `${outrigger.max_corner_load.toFixed(1)} t (${outrigger.max_corner_label})`, outrigger.max_outrigger_force_exceeded === true);
    kv(doc, cur, "Kritik dönme açısı", `${outrigger.critical_angle.toFixed(0)} derece`);
    if (outrigger.ground_pressure != null) kv(doc, cur, "Zemin basıncı", `${outrigger.ground_pressure.toFixed(1)} t/m²`, outrigger.bearing_ok === false);
    if (outrigger.bearing_ok != null) kv(doc, cur, "Zemin taşıma kontrolü", outrigger.bearing_ok ? "GEÇER" : "KALIR", !outrigger.bearing_ok);
    if (outrigger.required_pad_area_m2 != null) kv(doc, cur, "Önerilen min. takoz alanı", `${outrigger.required_pad_area_m2.toFixed(2)} m²`, outrigger.bearing_ok === false);
    if (outrigger.tipping_risk) warnBox(doc, cur, "DEVRİLME RİSKİ", ["Ağırlık merkezi destek alanının dışına çıkıyor."], RED);
    else if (outrigger.has_uplift) warnBox(doc, cur, "AYAK KALKMASI RİSKİ", ["Bazı açılarda bir ayak yüksüz kalıyor."], RED);
  } else {
    kv(doc, cur, "Durum", result.outrigger_error ?? "Hesaplanamadı", true);
  }
  hr(doc, cur);

  checkSpace(doc, cur, 40, SUBTITLE);
  sectionTitle(doc, cur, "Çarpışma Kontrolü");
  if (collision.active.length === 0) {
    kv(doc, cur, "Sonuç", "Çarpışma/uyarı yok");
  } else {
    collision.active.slice(0, 8).forEach((c) =>
      kv(doc, cur, `${SOURCE_TR[c.source] ?? c.source} - ${c.target}`, `${c.clearance_m.toFixed(2)} m (${SEV_TR[c.severity]})`, c.severity === "collision"),
    );
  }
  if (cfg.objects.length > 0) kv(doc, cur, "Çevre nesnesi sayısı", String(cfg.objects.length));

  const note = matchingOverRearNote(crane, cfg);
  if (note) {
    checkSpace(doc, cur, 20, SUBTITLE);
    warnBox(doc, cur, `ÜRETİCİ AMBLEMİ: "${note.symbol}"`, [note.meaning], AMBER);
  }

  checkSpace(doc, cur, 10, SUBTITLE);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(`Yük tablosu kaynağı: ${crane.source ?? "—"}`, L, cur.y);
  cur.y += 4;
}

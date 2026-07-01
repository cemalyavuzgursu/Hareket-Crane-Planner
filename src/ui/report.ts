import { jsPDF } from "jspdf";
import type { CraneModel } from "../engine/types";
import { computeLiftFull, type FullLiftResult } from "../engine/index";
import { getCrane } from "../data/cranes";
import type { UIState, WorkStep } from "./state";

const TR: Record<string, string> = {
  Ç: "C", ç: "c", Ğ: "G", ğ: "g", İ: "I", ı: "i",
  Ö: "O", ö: "o", Ş: "S", ş: "s", Ü: "U", ü: "u",
};
/** jsPDF standart fontları Türkçe karakterleri desteklemez; ASCII'ye indirger. */
function tr(s: string): string {
  return s.replace(/[ÇçĞğİıÖöŞşÜü]/g, (m) => TR[m] ?? m);
}

export function generateReport(
  crane: CraneModel,
  state: UIState,
  result: FullLiftResult,
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const { capacity, clearance, outrigger } = result;
  let y = 16;
  const L = 16;
  const R = 194;

  const line = () => {
    doc.setDrawColor(200);
    doc.line(L, y, R, y);
    y += 5;
  };
  const h = (t: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20);
    y += 2;
    doc.text(tr(t), L, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(40);
  };
  const row = (k: string, v: string, warn = false) => {
    doc.setTextColor(80);
    doc.text(tr(k), L + 2, y);
    doc.setTextColor(warn ? 200 : 20, warn ? 30 : 20, warn ? 30 : 20);
    doc.setFont("helvetica", "bold");
    doc.text(tr(v), R, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 5.5;
  };

  // Başlık
  doc.setFillColor(12, 14, 17);
  doc.rect(0, 0, 210, 11, "F");
  doc.setTextColor(255, 186, 32);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("HAREKET CRANE PLANNER", L, 7.6);
  doc.setTextColor(180);
  doc.setFontSize(8);
  doc.text("Kaldirma Plani / Lift Plan", R, 7.6, { align: "right" });
  y = 20;

  doc.setTextColor(20);
  doc.setFontSize(9);
  doc.text(tr(`Vinç: ${crane.model}`), L, y);
  const cfgText =
    result.jib
      ? `Denge: ${state.counterweight}t   Bom: ${state.boom_length}m   Jib: ${result.jib.jib_length}m @ ${result.jib.jib_offset} derece`
      : `Denge: ${state.counterweight}t   Bom: ${state.boom_length}m   Kapasite: %${state.capacity_pct}`;
  doc.text(tr(cfgText), R, y, { align: "right" });
  y += 6;
  line();

  h("Yuk Bilgileri");
  row("Yuk agirligi", `${state.load_weight} t`);
  row("Koca + Rigging", `${state.hook_weight} + ${state.rigging_weight} t`);
  row("Yuk olculeri (yukseklik x cap)", `${state.load_height} x ${state.load_diameter} m`);
  row("Calisma yaricapi (radius)", `${state.radius} m`);
  row("Engel (yukseklik / uzaklik)", `${state.obstacle_height} / ${state.obstacle_distance} m`);
  line();

  h("Kapasite Kontrolu");
  row("Toplam yuk", `${capacity.total_load.toFixed(2)} t`);
  row("Izin verilen kapasite", `${capacity.rated_capacity.toFixed(2)} t`);
  row("Kullanim yuzdesi", `${capacity.utilization_pct.toFixed(2)} %`, capacity.status === "KAPASİTE AŞIMI");
  row("Durum", capacity.status, capacity.status === "KAPASİTE AŞIMI");
  line();

  if (clearance) {
    h("Klerens / Geometri");
    row("Maks koca yuksekligi", `${clearance.max_hook_height.toFixed(3)} m`);
    row("Maks sapan araligi", `${clearance.max_sling_spread.toFixed(3)} m`);
    row("Boma engel klerensi", `${clearance.clearance_to_obstacle.toFixed(3)} m`, clearance.clearance_to_obstacle < 0);
    row("Boma yuk klerensi", `${clearance.clearance_to_load.toFixed(3)} m`, clearance.clearance_to_load < 0);
    row("Bom acisi (gama)", `${((clearance.gama * 180) / Math.PI).toFixed(2)} derece`);
    line();
  } else {
    h("Klerens / Geometri");
    row("Jib modu", "Klerens/geometri hesaplanmaz (jib mafsal geometrisi yok)", true);
    line();
  }

  h("Ayak Reaksiyonu (Outrigger)");
  if (outrigger) {
    row("Bileske dusey kuvvet (V)", `${outrigger.V.toFixed(1)} t`);
    row("En kritik kose yuku", `${outrigger.max_corner_load.toFixed(1)} t (${outrigger.max_corner_label})`);
    row("Kritik donme acisi", `${outrigger.critical_angle.toFixed(0)} derece`);
    if (outrigger.ground_pressure != null) row("Zemin basinci", `${outrigger.ground_pressure.toFixed(1)} t/m2`);
    if (outrigger.tipping_risk) row("Stabilite", "DEVRILME RISKI (CoG destek alani disinda)", true);
    else if (outrigger.has_uplift) row("Stabilite", "AYAK KALKMASI riski (bir ayak yuksuz)", true);
  } else {
    row("Durum", "Hesaplanamadi (self_weight eksik)", true);
  }
  line();

  // Uyarı kutusu
  y += 2;
  doc.setFillColor(255, 244, 230);
  doc.setDrawColor(255, 103, 0);
  doc.roundedRect(L, y, R - L, 18, 2, 2, "FD");
  doc.setTextColor(150, 60, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("MANUEL DOGRULAMA GEREKIR", L + 3, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 50, 10);
  doc.text(
    tr("Bu plan ureticinin load chart'ina dayanir ancak yetkili kaldirma muhendisi"),
    L + 3, y + 11,
  );
  doc.text(
    tr("tarafindan manuel olarak dogrulanmalidir. Uygulama karar otoritesi degildir."),
    L + 3, y + 15,
  );
  y += 24;

  doc.setTextColor(140);
  doc.setFontSize(7.5);
  doc.text(tr(`Kaynak: ${crane.source ?? "-"}`), L, 288);

  doc.save(`lift-plan-${crane.model.replace(/\s+/g, "_")}.pdf`);
}

const SEV_TR: Record<string, string> = {
  ok: "Uygun",
  warning: "Uyari",
  collision: "CARPISMA",
};

/**
 * Çok adımlı kaldırma raporu (Crane Planner 2.0 "report designer / working
 * steps" benzeri). Her adım için tam hesap yeniden yapılır; başta tüm adımları
 * kıyaslayan bir özet tablo, ardından adım başına detay sayfaları gelir.
 */
export function generateMultiStepReport(steps: WorkStep[]): void {
  if (steps.length === 0) return;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 16;
  const R = 194;

  const header = (subtitle: string) => {
    doc.setFillColor(12, 14, 17);
    doc.rect(0, 0, 210, 11, "F");
    doc.setTextColor(255, 186, 32);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("HAREKET CRANE PLANNER", L, 7.6);
    doc.setTextColor(180);
    doc.setFontSize(8);
    doc.text(tr(subtitle), R, 7.6, { align: "right" });
  };

  // ── Kapak / özet tablo ──────────────────────────────────────────────────────
  header("Cok Adimli Kaldirma Plani");
  let y = 22;
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(tr(`Calisma Adimlari Ozeti (${steps.length} adim)`), L, y);
  y += 8;

  // Tablo başlığı
  const cols = [
    { x: L, w: 8, t: "#" },
    { x: L + 8, w: 40, t: "Adim" },
    { x: L + 48, w: 22, t: "Vinc" },
    { x: L + 70, w: 18, t: "Radius" },
    { x: L + 88, w: 18, t: "Bom" },
    { x: L + 106, w: 22, t: "Kullanim" },
    { x: L + 128, w: 26, t: "Durum" },
    { x: L + 154, w: 24, t: "Carpisma" },
  ];
  doc.setFillColor(28, 30, 34);
  doc.rect(L, y - 4, R - L, 7, "F");
  doc.setTextColor(200);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  cols.forEach((c) => doc.text(tr(c.t), c.x + 1, y));
  y += 6;

  doc.setFont("helvetica", "normal");
  steps.forEach((s, i) => {
    const sm = s.summary;
    const over = sm.status === "KAPASİTE AŞIMI";
    if (i % 2 === 0) {
      doc.setFillColor(245, 246, 248);
      doc.rect(L, y - 4, R - L, 6.5, "F");
    }
    doc.setTextColor(40);
    doc.setFontSize(8);
    const cells = [
      String(i + 1),
      s.name,
      s.config.craneModel.replace(/LIEBHERR\s*/i, ""),
      `${s.config.radius} m`,
      `${s.config.boom_length} m`,
      `${sm.utilization_pct.toFixed(1)}%`,
    ];
    cols.slice(0, 6).forEach((c, ci) => doc.text(tr(cells[ci]), c.x + 1, y));
    // Durum renkli
    doc.setTextColor(over ? 200 : 20, over ? 30 : 130, over ? 30 : 40);
    doc.setFont("helvetica", "bold");
    doc.text(tr(over ? "ASIM" : "Uygun"), cols[6].x + 1, y);
    doc.setTextColor(sm.worst_collision === "collision" ? 200 : 80, 40, 40);
    doc.text(tr(SEV_TR[sm.worst_collision] ?? "-"), cols[7].x + 1, y);
    doc.setFont("helvetica", "normal");
    y += 6.5;
    if (y > 270) {
      doc.addPage();
      header("Cok Adimli Kaldirma Plani");
      y = 22;
    }
  });

  // Uyarı kutusu (özet sayfası altı)
  y += 4;
  doc.setFillColor(255, 244, 230);
  doc.setDrawColor(255, 103, 0);
  doc.roundedRect(L, y, R - L, 16, 2, 2, "FD");
  doc.setTextColor(150, 60, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("MANUEL DOGRULAMA GEREKIR", L + 3, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 50, 10);
  doc.setFontSize(8);
  doc.text(
    tr("Her adim yetkili kaldirma muhendisi tarafindan dogrulanmalidir."),
    L + 3, y + 11,
  );

  // ── Adım başına detay sayfaları ─────────────────────────────────────────────
  steps.forEach((s, i) => {
    doc.addPage();
    header(`Adim ${i + 1} / ${steps.length}`);
    drawStepDetail(doc, s, i);
  });

  doc.save(`cok-adimli-plan-${steps.length}-adim.pdf`);
}

/** Tek bir adımın detay bloğunu çizer (yeniden hesaplar). */
function drawStepDetail(doc: jsPDF, step: WorkStep, index: number): void {
  const L = 16;
  const R = 194;
  let y = 20;
  const cfg = step.config;
  const crane = getCrane(cfg.craneModel);
  const result: FullLiftResult = computeLiftFull(crane, cfg, {
    outrigger_config: cfg.outrigger_config,
    slew_angle: cfg.slew_angle,
    pad_area: 1.0, // App.PAD_AREA ile aynı — zemin basıncı tek adımlı raporla tutarlı
    objects: cfg.objects,
    jib:
      cfg.lift_config !== "T"
        ? { config: cfg.lift_config, jib_length: cfg.jib_length, jib_offset: cfg.jib_offset }
        : undefined,
  });
  const { capacity, clearance, outrigger, collision } = result;

  const h = (t: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20);
    y += 2;
    doc.text(tr(t), L, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
  };
  const row = (k: string, v: string, warn = false) => {
    doc.setTextColor(80);
    doc.text(tr(k), L + 2, y);
    doc.setTextColor(warn ? 200 : 20, warn ? 30 : 20, warn ? 30 : 20);
    doc.setFont("helvetica", "bold");
    doc.text(tr(v), R, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 5.5;
  };
  const line = () => {
    doc.setDrawColor(200);
    doc.line(L, y, R, y);
    y += 5;
  };

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(tr(`Adim ${index + 1}: ${step.name}`), L, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);
  const stepCfgText = result.jib
    ? `${crane.model}  ·  Denge ${cfg.counterweight}t  ·  Bom ${cfg.boom_length}m  ·  Jib ${result.jib.jib_length}m@${result.jib.jib_offset}°  ·  Donme ${cfg.slew_angle}°`
    : `${crane.model}  ·  Denge ${cfg.counterweight}t  ·  Bom ${cfg.boom_length}m  ·  %${cfg.capacity_pct}  ·  Donme ${cfg.slew_angle}°`;
  doc.text(tr(stepCfgText), L, y);
  y += 6;
  line();

  h("Kapasite");
  row("Toplam yuk", `${capacity.total_load.toFixed(2)} t`);
  row("Izin verilen kapasite", `${capacity.rated_capacity.toFixed(2)} t`);
  row("Kullanim", `${capacity.utilization_pct.toFixed(2)} %`, capacity.status === "KAPASİTE AŞIMI");
  row("Durum", capacity.status, capacity.status === "KAPASİTE AŞIMI");
  line();

  if (clearance) {
    h("Klerens / Geometri");
    row("Boma engel klerensi", `${clearance.clearance_to_obstacle.toFixed(2)} m`, clearance.clearance_to_obstacle < 0);
    row("Boma yuk klerensi", `${clearance.clearance_to_load.toFixed(2)} m`, clearance.clearance_to_load < 0);
    row("Maks koca yuksekligi", `${clearance.max_hook_height.toFixed(2)} m`);
    line();
  } else {
    h("Klerens / Geometri");
    row("Jib modu", "Klerens hesaplanmaz", true);
    line();
  }

  h("Ayak Reaksiyonu");
  if (outrigger) {
    row("Bileske dusey kuvvet", `${outrigger.V.toFixed(1)} t`);
    row("En kritik kose yuku", `${outrigger.max_corner_load.toFixed(1)} t (${outrigger.max_corner_label})`);
    row("Kritik donme acisi", `${outrigger.critical_angle.toFixed(0)} derece`);
    if (outrigger.ground_pressure != null) row("Zemin basinci", `${outrigger.ground_pressure.toFixed(1)} t/m2`);
    if (outrigger.tipping_risk) row("Stabilite", "DEVRILME RISKI", true);
    else if (outrigger.has_uplift) row("Stabilite", "AYAK KALKMASI riski", true);
  } else {
    row("Durum", "Hesaplanamadi", true);
  }
  line();

  h("Carpisma Kontrolu");
  if (collision.active.length === 0) {
    row("Sonuc", "Carpisma/uyari yok", false);
  } else {
    collision.active.slice(0, 8).forEach((c) =>
      row(`${c.source} - ${c.target}`, `${c.clearance_m.toFixed(2)} m (${SEV_TR[c.severity]})`, c.severity === "collision"),
    );
  }
  if (cfg.objects.length > 0) row("Cevre nesnesi sayisi", String(cfg.objects.length));
}

import { jsPDF } from "jspdf";
import type { CraneModel } from "../engine/types";
import type { FullLiftResult } from "../engine/index";
import type { UIState } from "./state";

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
  doc.text(tr(`Denge: ${state.counterweight}t   Bom: ${state.boom_length}m   Kapasite: %${state.capacity_pct}`), R, y, { align: "right" });
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

  h("Klerens / Geometri");
  row("Maks koca yuksekligi", `${clearance.max_hook_height.toFixed(3)} m`);
  row("Maks sapan araligi", `${clearance.max_sling_spread.toFixed(3)} m`);
  row("Boma engel klerensi", `${clearance.clearance_to_obstacle.toFixed(3)} m`, clearance.clearance_to_obstacle < 0);
  row("Boma yuk klerensi", `${clearance.clearance_to_load.toFixed(3)} m`, clearance.clearance_to_load < 0);
  row("Bom acisi (gama)", `${((clearance.gama * 180) / Math.PI).toFixed(2)} derece`);
  line();

  h("Ayak Reaksiyonu (Outrigger)");
  if (outrigger) {
    row("Bileske dusey kuvvet (V)", `${outrigger.V.toFixed(1)} t`);
    row("En kritik kose yuku", `${outrigger.max_corner_load.toFixed(1)} t (${outrigger.max_corner_label})`);
    row("Kritik donme acisi", `${outrigger.critical_angle.toFixed(0)} derece`);
    if (outrigger.ground_pressure != null) row("Zemin basinci", `${outrigger.ground_pressure.toFixed(1)} t/m2`);
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

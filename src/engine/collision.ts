// (D) ÇARPIŞMA ALGILAMA — YENİ. Crane Planner 2.0 "collision detection".
//
// Katmanlar:
//   1) Bom ↔ ana engel / yük: mevcut klerens sonuçlarından (clearance.ts) türetilir.
//   2) Bom / yük / kanca / halat ↔ çevre nesneleri (nesne kütüphanesi): nesnenin
//      rotationY'si dikkate alınarak nesnenin yerel çerçevesinde AABB mesafesi
//      (bom/kanca/halat için) ya da kutu↔kutu (OBB) mesafesi (yük için).
//   3) Kuyruk savrulması: karşı ağırlığın slew merkezi etrafında süpürdüğü
//      dairesel bant ile çevre nesneleri.
//
// Çıktı saf bir uyarı listesidir; UI renklendirme ve raporlama için kullanır.
// Hiçbir şey atmaz (yalnızca alan-dışı geometrik girdiler clearance.ts'te hata
// fırlatır): geçersiz girdi burada "ok" gibi ele alınır.

import type { GeometryConstants, SceneObject } from "./types.js";
import type { ClearanceResult } from "./clearance.js";

/** Negatif = çarpışma; bu eşiğin altındaki pozitif klerens = uyarı (m). Genel
 * nesneler ve ana engel/yük için varsayılan. Enerji hatları için marginForObject
 * gerilime göre daha büyük bir değer döner. */
export const SAFETY_MARGIN_M = 0.5;

export type CollisionSeverity = "ok" | "warning" | "collision";

export interface CollisionItem {
  id: string;
  /** Hangi vinç parçası: bom / yük / kanca / kaldırma halatı / kuyruk savrulması. */
  source: "boom" | "jib" | "load" | "hook" | "rope" | "tail";
  /** Neyle: ana engel, zemin, ya da çevre nesnesi etiketi. */
  target: string;
  severity: CollisionSeverity;
  /** Boşluk (m); negatifse çakışma derinliği. */
  clearance_m: number;
  message: string;
}

export interface CollisionReport {
  worst: CollisionSeverity;
  items: CollisionItem[];
  /** Yalnızca çakışma/uyarı içerenler (UI rozet sayısı için). */
  active: CollisionItem[];
}

export interface CollisionInputs {
  g: GeometryConstants;
  boom_length: number;
  radius: number;
  gama: number; // bom yükselme açısı (rad) — clearance.gama
  slew_angle: number; // derece, 0 = +X
  load_height: number;
  load_diameter: number;
  /** Yük merkezinin yerel x'i (slew merkezinden). Verilmezse eski Excel
   * konvansiyonu radius − load_diameter/2. computeLiftFull bunu klerens
   * sonucundan (load_center_x) geçirir. */
  load_center_x?: number;
  hook_height: number; // kanca bloğu yüksekliği (klerens.max_hook_height yakını)
  /** Jib modu: bom ucu ve jib ucu (slew-yerel x,y). Verilirse bom ucu gama'dan
   * hesaplanmaz, jib parçası da nesnelere karşı kontrol edilir; halat jib
   * ucundan iner. */
  jib_points?: { boomTip: { x: number; y: number }; jibTip: { x: number; y: number } };
  /** Aparat (sapan/traverse) yüksekliği (m) — kaldırma yüksekliği payından düşülür. */
  rigging_height?: number;
  /** Yükün alt yüzünün zeminden yüksekliği (m) — klerens sonucundan. Verilmezse 0 (zeminde). */
  load_bottom?: number;
  objects: SceneObject[];
  /** Kuyruk (karşı ağırlık) dönme yarıçapı (m). Verilmezse kuyruk savrulma
   * kontrolü atlanır. */
  tail_radius_m?: number;
  /** Üst yapı güverte yüksekliği (m) — kuyruğun süpürdüğü düşey bandın alt
   * sınırı (bant: [bu değer, bu değer+2.5m]). Verilmezse kontrol atlanır. */
  superstructure_height_m?: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** (x,z) düzlemini slew açısı kadar Y ekseni etrafında döndürür. */
function rotY(x: number, z: number, rad: number): { x: number; z: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** Slew-yerel (x,y,z) noktayı dünya çerçevesine çevirir (Y yukarı, sabit). */
function toWorld(lx: number, ly: number, lz: number, slewRad: number): Vec3 {
  const r = rotY(lx, lz, slewRad);
  return { x: r.x, y: ly, z: r.z };
}

/**
 * Vinç geometrisinin dünya-çerçevesi anahtar noktaları (Crane3D ile aynı kabul):
 * bom dibi (-boom_offset, machine+crib), bom ucu, yük merkezi.
 *
 * Yük merkezi klerens modeliyle hizalıdır (inp.load_center_x): gerçek
 * ("centered") modelde kanca yükün ağırlık merkezinin üstünde (x = radius);
 * eski Excel modelinde yük [radius−d, radius] aralığında (merkez radius−d/2).
 */
export function craneWorldGeometry(inp: CollisionInputs): {
  boomFoot: Vec3;
  boomTip: Vec3;
  /** Halatın indiği uç (jib modunda jib ucu, aksi halde bom ucu). */
  ropeTip: Vec3;
  jibTip: Vec3 | null;
  loadCenter: Vec3;
  hookCenter: Vec3;
} {
  const { g, boom_length, radius, gama, slew_angle, load_height, load_diameter } = inp;
  const slewRad = slew_angle * DEG;
  const footY = g.machine_ground_height + g.cribbing_height;
  const footX = -g.boom_offset;
  const jp = inp.jib_points;
  const tipXLocal = jp ? jp.boomTip.x : footX + boom_length * Math.cos(gama);
  const tipYLocal = jp ? jp.boomTip.y : footY + boom_length * Math.sin(gama);
  const boomTip = toWorld(tipXLocal, tipYLocal, 0, slewRad);
  const jibTip = jp ? toWorld(jp.jibTip.x, jp.jibTip.y, 0, slewRad) : null;

  return {
    boomFoot: toWorld(footX, footY, 0, slewRad),
    boomTip,
    ropeTip: jibTip ?? boomTip,
    jibTip,
    loadCenter: toWorld(inp.load_center_x ?? radius - load_diameter / 2, (inp.load_bottom ?? 0) + Math.max(load_height, 0.1) / 2, 0, slewRad),
    // Kanca bloğu yük üstünden hook_height kadar yukarı uzanır; merkezi ortası.
    hookCenter: toWorld(radius, (inp.load_bottom ?? 0) + load_height + (inp.rigging_height ?? 0) + inp.hook_height / 2, 0, slewRad),
  };
}

/** Bir noktanın eksen hizalı kutuya (merkez + yarı-ölçüler) en kısa mesafesi. */
function pointToBoxDistance(p: Vec3, center: Vec3, half: Vec3): number {
  const dx = Math.max(Math.abs(p.x - center.x) - half.x, 0);
  const dy = Math.max(Math.abs(p.y - center.y) - half.y, 0);
  const dz = Math.max(Math.abs(p.z - center.z) - half.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Bir doğru parçası (a→b) örneklenerek kutuya en kısa mesafe bulunur. */
function segmentToBoxDistance(a: Vec3, b: Vec3, center: Vec3, half: Vec3, samples = 28): number {
  let min = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p: Vec3 = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const d = pointToBoxDistance(p, center, half);
    if (d < min) min = d;
  }
  return min;
}

/** Nesnenin yerel çerçevesi: merkez orijinde (taban kotu dahil), yarı-ölçüler
 * width/depth/height'tan. rotationY bu çerçeveye göre dünya çerçevesine döner. */
function objectLocalFrame(o: SceneObject): { center: Vec3; half: Vec3 } {
  return {
    center: { x: 0, y: (o.y ?? 0) + o.height / 2, z: 0 },
    half: { x: o.width / 2, y: o.height / 2, z: o.depth / 2 },
  };
}

/** Dünya çerçevesindeki bir noktayı nesnenin yerel (rotationY'siz) çerçevesine
 * çevirir: merkeze göre kaydır, sonra -rotationY kadar döndür. */
function toObjectLocal(p: Vec3, o: SceneObject): Vec3 {
  const rot = (o.rotationY ?? 0) * DEG;
  const dx = p.x - o.x;
  const dz = p.z - o.z;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return { x: dx * c - dz * s, y: p.y, z: dx * s + dz * c };
}

/** Yatay düzlemde döndürülmüş dikdörtgen taban × düşey aralık (dikey prizma).
 * Yük kutusu (slew'e göre döner) ve çevre nesneleri (rotationY'ye göre döner)
 * bu ortak temsille karşılaştırılır. */
interface Prism {
  cx: number;
  cz: number;
  hx: number; // yerel x ekseni yarı-genişlik
  hz: number; // yerel z ekseni yarı-genişlik
  rot: number; // yerel x ekseninin dünya X eksenine göre açısı (rad)
  yMin: number;
  yMax: number;
}

function prismFromObject(o: SceneObject): Prism {
  return {
    cx: o.x,
    cz: o.z,
    hx: o.width / 2,
    hz: o.depth / 2,
    rot: (o.rotationY ?? 0) * DEG,
    yMin: o.y ?? 0,
    yMax: (o.y ?? 0) + o.height,
  };
}

function loadPrism(inp: CollisionInputs): Prism {
  const slewRad = inp.slew_angle * DEG;
  const half = Math.max(inp.load_diameter, 0.3) / 2;
  const localX = inp.load_center_x ?? inp.radius - inp.load_diameter / 2;
  const c = toWorld(localX, 0, 0, slewRad);
  return {
    cx: c.x,
    cz: c.z,
    hx: half,
    hz: half,
    rot: slewRad,
    yMin: inp.load_bottom ?? 0,
    yMax: (inp.load_bottom ?? 0) + Math.max(inp.load_height, 0.1),
  };
}

/**
 * İki dikey prizma arasında en yakın mesafe (SAT: her prizmanın 2 yatay eksen
 * normali + düşey eksen — toplam 5 aday eksen). Bir eksende ayrım varsa
 * prizmalar kesin olarak ayrıktır (bu yön tam/exact); ayrık durumda mesafe en
 * büyük ayrım ekseninin değeridir (kenar-kenar durumunda tam, köşe-köşe
 * durumunda muhafazakâr bir alt sınırdır — güvenlik uygulaması için kabul
 * edilir). Tüm eksenlerde örtüşüyorsa negatif değer (en küçük yerleştirme
 * derinliği, standart MTV) döner.
 */
function prismDistance(a: Prism, b: Prism): number {
  const dcx = b.cx - a.cx;
  const dcz = b.cz - a.cz;

  const axisSep = (axisRad: number): number => {
    const ax = Math.cos(axisRad);
    const az = Math.sin(axisRad);
    const centerProj = dcx * ax + dcz * az;
    const halfA =
      a.hx * Math.abs(Math.cos(axisRad - a.rot)) + a.hz * Math.abs(Math.sin(axisRad - a.rot));
    const halfB =
      b.hx * Math.abs(Math.cos(axisRad - b.rot)) + b.hz * Math.abs(Math.sin(axisRad - b.rot));
    return Math.abs(centerProj) - (halfA + halfB);
  };

  const horizSep = Math.max(
    axisSep(a.rot),
    axisSep(a.rot + Math.PI / 2),
    axisSep(b.rot),
    axisSep(b.rot + Math.PI / 2),
  );
  const vGap = Math.max(a.yMin - b.yMax, b.yMin - a.yMax);

  if (horizSep <= 0 && vGap <= 0) {
    // Her iki boyutta da örtüşme: en küçük çıkış derinliği (standart MTV).
    return Math.max(horizSep, vGap);
  }
  return Math.sqrt(Math.max(horizSep, 0) ** 2 + Math.max(vGap, 0) ** 2);
}

/** Enerji hattı (powerline) için mevzuata göre yaklaşık emniyet marjı (m);
 * diğer nesne türleri için sabit SAFETY_MARGIN_M kullanılır. voltage_kv
 * verilmemişse muhafazakâr (yüksek) bir varsayım uygulanır. */
function marginForObject(o: SceneObject): number {
  if (o.kind !== "powerline") return SAFETY_MARGIN_M;
  const kv = o.voltage_kv;
  if (kv == null) return 6.1; // gerilim bilinmiyor → muhafazakâr varsayım
  if (kv <= 50) return 3.05;
  if (kv <= 200) return 4.6;
  if (kv <= 350) return 6.1;
  return 7.6;
}

function marginNote(margin: number): string {
  return margin !== SAFETY_MARGIN_M ? ` (emniyet marjı ${margin.toFixed(2)}m)` : "";
}

function severityFor(clearance: number, margin: number = SAFETY_MARGIN_M): CollisionSeverity {
  if (clearance < 0) return "collision";
  if (clearance < margin) return "warning";
  return "ok";
}

function worstOf(a: CollisionSeverity, b: CollisionSeverity): CollisionSeverity {
  const rank = { ok: 0, warning: 1, collision: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Tam çarpışma raporu. Ana engel/yük klerensini (clearance.ts'ten) ve çevre
 * nesnelerini (3D) birleştirir.
 */
/** computeCollisions'ın ana engel/yük satırları için ihtiyaç duyduğu klerens alanları
 * (ClearanceResult ve jib modu JibClearance ikisi de sağlar). */
export interface MainClearance {
  /** null → ana engel yok (jib modu, engel yüksekliği 0) — satır üretilmez. */
  clearance_to_obstacle: number | null;
  clearance_to_load: number;
  max_sling_spread: number;
}

export function computeCollisions(
  inp: CollisionInputs,
  clearance: MainClearance | ClearanceResult,
): CollisionReport {
  const items: CollisionItem[] = [];

  // ── 1) Bom ↔ ana engel ─────────────────────────────────────────────────────
  if (clearance.clearance_to_obstacle != null) items.push({
    id: "boom-main-obstacle",
    source: "boom",
    target: "Ana engel",
    severity: severityFor(clearance.clearance_to_obstacle),
    clearance_m: clearance.clearance_to_obstacle,
    message:
      clearance.clearance_to_obstacle < 0
        ? "Bom ana engele çarpıyor"
        : "Bom ↔ ana engel klerensi",
  });

  // ── 2) Bom ↔ yük ───────────────────────────────────────────────────────────
  items.push({
    id: "boom-main-load",
    source: "boom",
    target: "Yük",
    severity: severityFor(clearance.clearance_to_load),
    clearance_m: clearance.clearance_to_load,
    message:
      clearance.clearance_to_load < 0
        ? "Bom yüke çarpıyor"
        : "Bom ↔ yük klerensi",
  });

  // ── 3) Kaldırma yüksekliği (yük engeli geçebiliyor mu) ──────────────────────
  // max_sling_spread < 0 → yük + sapan, makara altına sığmıyor.
  // Aparat (sapan/traverse/kiriş) yüksekliği verilirse bu paydan düşülür.
  const liftRoom = clearance.max_sling_spread - (inp.rigging_height ?? 0);
  items.push({
    id: "lift-height",
    source: "load",
    target: "Kaldırma yüksekliği",
    severity: severityFor(liftRoom),
    clearance_m: liftRoom,
    message:
      liftRoom < 0
        ? inp.rigging_height
          ? `Yük + aparatlar (${inp.rigging_height.toFixed(2)} m) kaldırma yüksekliğine sığmıyor`
          : "Yük + sapan kaldırma yüksekliğine sığmıyor"
        : inp.rigging_height
          ? "Aparatlar sonrası kalan kaldırma yüksekliği"
          : "Sapan/kaldırma yüksekliği payı",
  });

  // ── 4) Çevre nesneleri ↔ bom / yük / kanca / halat / kuyruk ─────────────────
  const geo = craneWorldGeometry(inp);
  const loadPr = loadPrism(inp);
  const boomHalfThick = inp.g.boom_thickness / 2;
  const HOOK_HALF = 0.3; // kanca bloğu yaklaşık yarı-ölçüsü (m)
  const ROPE_HALF = 0.05; // halat yarıçap payı (m)
  const tailActive = inp.tail_radius_m != null && inp.superstructure_height_m != null;

  for (const o of inp.objects) {
    // Yer altı yapıları bom/yük ile çarpışmaz — riskleri ayak tablası yakınlığıdır (engine/ground.ts).
    if (o.kind === "underground") continue;
    const { center, half } = objectLocalFrame(o);
    const margin = marginForObject(o);
    const note = marginNote(margin);

    // Bom (kalınlık payı düşülür) — nesnenin rotationY'si hesaba katılır:
    // uç noktaları nesnenin yerel çerçevesine çevrilip AABB mesafesi alınır.
    const bFoot = toObjectLocal(geo.boomFoot, o);
    const bTip = toObjectLocal(geo.boomTip, o);
    const dBoom = segmentToBoxDistance(bFoot, bTip, center, half) - boomHalfThick;
    items.push({
      id: `obj-${o.id}-boom`,
      source: "boom",
      target: o.label,
      severity: severityFor(dBoom, margin),
      clearance_m: dBoom,
      message: dBoom < 0 ? `Bom "${o.label}" ile çakışıyor` : `Bom ↔ ${o.label}${note}`,
    });

    // Jib (varsa) — kafes gövde, yaklaşık yarı kesit 0,45 m.
    if (geo.jibTip) {
      const jTip = toObjectLocal(geo.jibTip, o);
      const dJib = segmentToBoxDistance(bTip, jTip, center, half) - 0.45;
      items.push({
        id: `obj-${o.id}-jib`,
        source: "jib",
        target: o.label,
        severity: severityFor(dJib, margin),
        clearance_m: dJib,
        message: dJib < 0 ? `Jib "${o.label}" ile çakışıyor` : `Jib ↔ ${o.label}${note}`,
      });
    }

    // Yük (kutu ↔ kutu; klerens konvansiyonuyla hizalı [radius−d, radius] kutusu,
    // slew'e göre döner) — nesnenin rotationY'siyle birlikte OBB-OBB mesafesi.
    const dLoad = prismDistance(loadPr, prismFromObject(o));
    items.push({
      id: `obj-${o.id}-load`,
      source: "load",
      target: o.label,
      severity: severityFor(dLoad, margin),
      clearance_m: dLoad,
      message: dLoad < 0 ? `Yük "${o.label}" ile çakışıyor` : `Yük ↔ ${o.label}${note}`,
    });

    // Kanca bloğu (yük üstünde asılı) — özellikle enerji hattı gibi
    // yükseklikteki tehlikeler için bom/yük kontrolünün kaçırdığı bölge.
    const hookLocal = toObjectLocal(geo.hookCenter, o);
    const dHook = pointToBoxDistance(hookLocal, center, half) - HOOK_HALF;
    items.push({
      id: `obj-${o.id}-hook`,
      source: "hook",
      target: o.label,
      severity: severityFor(dHook, margin),
      clearance_m: dHook,
      message: dHook < 0 ? `Kanca "${o.label}" ile çakışıyor` : `Kanca ↔ ${o.label}${note}`,
    });

    // Kaldırma halatı (bom ucu → kanca, ~düşey doğru parçası)
    const dRope = segmentToBoxDistance(toObjectLocal(geo.ropeTip, o), hookLocal, center, half) - ROPE_HALF;
    items.push({
      id: `obj-${o.id}-rope`,
      source: "rope",
      target: o.label,
      severity: severityFor(dRope, margin),
      clearance_m: dRope,
      message: dRope < 0 ? `Kaldırma halatı "${o.label}" ile çakışıyor` : `Halat ↔ ${o.label}${note}`,
    });

    // Kuyruk savrulması (tail swing): karşı ağırlık, slew merkezi etrafında
    // tail_radius_m yarıçapında, üst yapı güverte bandında ([h, h+2.5m]) döner.
    // Basit/muhafazakâr model: mevcut slew açısından bağımsız olarak, nesne bu
    // düşey bantla kesişiyorsa (her an oraya dönebileceği için) yatay mesafe
    // kontrol edilir.
    if (tailActive) {
      const bandMin = inp.superstructure_height_m as number;
      const bandMax = bandMin + 2.5;
      const oMin = o.y ?? 0;
      const oMax = oMin + o.height;
      const yGap = Math.max(bandMin - oMax, oMin - bandMax, 0);
      if (yGap > 0) {
        items.push({
          id: `obj-${o.id}-tail`,
          source: "tail",
          target: o.label,
          severity: "ok",
          clearance_m: yGap,
          message:
            `"${o.label}" kuyruk savrulma bandının (${bandMin.toFixed(1)}–${bandMax.toFixed(1)}m) ` +
            `dışında (düşey boşluk ${yGap.toFixed(2)}m)`,
        });
      } else {
        const horizDist = Math.hypot(o.x, o.z);
        const halfDiag = Math.hypot(o.width / 2, o.depth / 2);
        const dTail = horizDist - halfDiag - (inp.tail_radius_m as number);
        items.push({
          id: `obj-${o.id}-tail`,
          source: "tail",
          target: o.label,
          severity: severityFor(dTail, margin),
          clearance_m: dTail,
          message:
            dTail < 0
              ? `Kuyruk savrulması "${o.label}" ile çakışıyor`
              : `Kuyruk savrulması ↔ ${o.label}${note}`,
        });
      }
    }
  }

  const worst = items.reduce<CollisionSeverity>((w, it) => worstOf(w, it.severity), "ok");
  const active = items.filter((it) => it.severity !== "ok");
  return { worst, items, active };
}

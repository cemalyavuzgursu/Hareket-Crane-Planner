// Tüm vinçler için ölçekli yandan görünüş (Liebherr Crane Planner tarzı).
// Geometri craneRig.ts'ten gelir (3B ile aynı kaynak). Klerens/çarpışma
// görselleştirmesi clearance.ts ile birebir: kritik yük/engel köşesinden bom
// güvenlik zarfına dik mesafe çizilir.
//
// Arka planda çalışma alanı diyagramı: radius × yükseklik ızgarası + seçili bom
// uzunluğunun makara yayı ve yay üzerinde yük tablosu kapasiteleri.

import type { ChartPoint, CraneModel } from "../engine/types";
import type { RiggingItem } from "./state";
import type { ClearanceResult } from "../engine/clearance";
import { sideGeometry, jibGeometry, type Pt } from "./craneGeometry";
import { buildRig, hookPlacement, drawnFalls, projectU } from "./craneRig";
import { useI18n } from "./i18n";
import { useUnits } from "./units";

export interface CraneSideView2DProps {
  crane: CraneModel;
  clearance: ClearanceResult | null; // jib modunda null
  boom_length: number;
  radius: number;
  counterweight: number;
  slew_angle: number; // derece
  Lx: number;
  Ly: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
  obstacle_width: number;
  /** Seçili bom uzunluğunun yük eğrisi (çalışma alanı diyagramı için). */
  chart?: ChartPoint[] | null;
  /** Halat donanımı (kol) sayısı. */
  falls?: number;
  jib?: { jib_length: number; jib_offset: number } | null;
  /** Aparat yüksekliği (m) — kanca ile yük arası. */
  rigging_height?: number;
  /** Aparat listesi (kancadan aşağı sırayla) — varsa gerçek şekilleriyle çizilir. */
  rigging_items?: RiggingItem[];
  /** Jib modu klerensi (YAKLAŞIK) — rozet + dikmeler için. */
  jib_clearance?: { clearance_to_load: number; clearance_to_obstacle: number | null; load_corner_x: number; obstacle_corner_x: number } | null;
}

const DEG = Math.PI / 180;

export default function CraneSideView2D(p: CraneSideView2DProps) {
  const { t } = useI18n();
  const u = useUnits();
  const fL = (m: number, dgt = 2) => u.fmtLen(m, dgt);
  const { crane, clearance, radius, jib } = p;
  const g = crane.geometry_constants;
  const inJib = !!jib;
  const base = g.cribbing_height + g.machine_ground_height;

  // ── Bom açısı ────────────────────────────────────────────────────────────────
  const jg = inJib && jib ? jibGeometry(g.boom_offset, base, p.boom_length, jib.jib_length, jib.jib_offset, radius) : null;
  const gama = jg ? jg.boomAngle : clearance?.gama ?? Math.PI / 4;
  const rig = buildRig({
    crane,
    boom_length: p.boom_length,
    gama,
    withSheaveOffset: !jg,
    counterweight: p.counterweight,
    Lx: p.Lx,
    Ly: p.Ly,
  });
  const d = rig.dims;
  const boom = rig.boom;
  const tipPt: Pt = jg ? jg.jibTip : boom.sheave; // halatın indiği nokta

  // ── Yük / kanca konumu (clearance.ts konvansiyonu) ────────────────────────────
  let loadX0: number, loadX1: number, loadY0: number;
  if (clearance && !inJib) {
    // Yük merkezi klerens modelinden (gerçek geometride = radius, kanca üstünde).
    loadX0 = clearance.load_center_x - p.load_diameter / 2;
    loadX1 = clearance.load_center_x + p.load_diameter / 2;
    loadY0 = p.obstacle_height;
  } else {
    loadX0 = radius - p.load_diameter / 2;
    loadX1 = radius + p.load_diameter / 2;
    // Jib modunda da yük engel üstünden geçirilir (jib klerensi bu konumla hesaplanır).
    loadY0 = inJib && p.jib_clearance ? p.obstacle_height : 0;
  }
  const loadY1 = loadY0 + p.load_height;
  const hookX = radius;
  const hk = hookPlacement(g, tipPt.y, loadY1, p.load_diameter, p.rigging_height);

  const sg = clearance && !inJib
    ? sideGeometry(g, clearance, p.boom_length, p.load_height, p.obstacle_height)
    : null;
  const loadBad = !!clearance && !inJib && clearance.clearance_to_load < 0;
  const obsBad = !!clearance && !inJib && clearance.clearance_to_obstacle < 0;
  const warn = loadBad || obsBad;

  // ── Çalışma alanı yayı (seçili bom, ana bom modu) ───────────────────────────
  const z = p.boom_length / Math.cos(Math.atan(g.sheave_offset / p.boom_length));
  const arcAt = (r: number): Pt | null => {
    const c = (r + g.boom_offset) / z;
    if (c > 1 || c < -1) return null;
    return { x: r, y: base + z * Math.sin(Math.acos(c)) };
  };
  const chart = !inJib && p.chart && p.chart.length > 0 ? p.chart : null;
  const arcR0 = chart ? chart[0][0] : Math.max(2, (z * Math.cos(82 * DEG)) - g.boom_offset);
  const arcR1 = chart ? chart[chart.length - 1][0] : z * Math.cos(15 * DEG) - g.boom_offset;
  const arcPts: Pt[] = [];
  if (!inJib) {
    for (let i = 0; i <= 48; i++) {
      const q = arcAt(arcR0 + ((arcR1 - arcR0) * i) / 48);
      if (q) arcPts.push(q);
    }
  }

  // ── Slew'e göre şasi görünüşü ────────────────────────────────────────────────
  const a = p.slew_angle * DEG;
  const ca = Math.cos(a);
  const sideView = Math.abs(ca) >= 0.5;
  const car = rig.carrier;
  const U = (x: number) => x * ca; // şasi ekseni noktası (Z=0) → u
  const carrierU0 = sideView ? Math.min(U(car.frontX), U(car.rearX)) : -car.width / 2;
  const carrierU1 = sideView ? Math.max(U(car.frontX), U(car.rearX)) : car.width / 2;
  const padUs = Array.from(new Set(rig.outriggers.pads.map((q) => Math.round(projectU(q.x, q.z, a) * 100) / 100)));

  // ── Dünya sınırları → ekran ölçeği ──────────────────────────────────────────
  const topY = Math.max(boom.tip.y + 1, jg?.jibTip.y ?? 0, ...arcPts.map((q) => q.y), p.obstacle_height, loadY1, d.cab_height_m) + 2.5;
  const minX = Math.min(carrierU0, -d.tail_radius_m, ...padUs, loadX0) - 2.5;
  const maxX = Math.max(carrierU1, ...padUs, loadX1, boom.tip.x, jg?.jibTip.x ?? 0, arcR1) + 3;
  const W = 1000, H = 600, padL = 46, padR = 30, padT = 18, padB = 62;
  const s = Math.min((W - padL - padR) / (maxX - minX), (H - padT - padB) / topY);
  const ox = padL + ((W - padL - padR) - (maxX - minX) * s) / 2;
  const X = (x: number) => ox + (x - minX) * s;
  const Y = (y: number) => H - padB - y * s;
  const gnd = Y(0);

  // ── Renkler ──────────────────────────────────────────────────────────────────
  const look = rig.look;
  const yellow = look?.colors.body ?? d.color;
  const yellowDk = shade(yellow, -0.25);
  const boomCol = look?.colors.boom ?? yellow;
  const cwCol = look?.colors.cw;
  const ink = "#15191e";
  const dim = "#5f86ad";
  const dimText = "#9ec3ea";
  const gridC = "rgba(120,160,200,.10)";
  const warnC = "#ff5a4d";
  const okC = "#00e475";

  const poly = (pts: Pt[]) => pts.map((q) => `${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(" ");
  const rectPts = (u0: number, u1: number, y0: number, y1: number): Pt[] => [
    { x: u0, y: y0 }, { x: u1, y: y0 }, { x: u1, y: y1 }, { x: u0, y: y1 },
  ];
  // Bom ekseni boyunca [s0,s1] × [−h/2, h/2] dikdörtgeni.
  const alongAxis = (s0: number, s1: number, h0: number, h1: number, ang = boom.axisAngle, from: Pt = boom.foot): Pt[] => {
    const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
    const P = (t: number, o: number) => ({ x: from.x + t * ux + o * nx, y: from.y + t * uy + o * ny });
    return [P(s0, -h0 / 2), P(s1, -h1 / 2), P(s1, h1 / 2), P(s0, h0 / 2)];
  };

  // ── Izgara adımı ────────────────────────────────────────────────────────────
  const span = Math.max(maxX - minX, topY);
  // Izgara adımı görüntü biriminde (m: 10/5/2 — ft: 30/20/5); çizgiler dünya koordinatına çevrilir.
  const stepD = u.imperial ? (span > 90 ? 30 : span > 40 ? 20 : 5) : (span > 90 ? 10 : span > 40 ? 5 : 2);

  const falls = drawnFalls(p.falls);
  const hookW = 0.55 + 0.06 * falls;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <defs>
        <linearGradient id="csvBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1627" />
          <stop offset="100%" stopColor="#0d2034" />
        </linearGradient>
        <linearGradient id="csvBoom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(boomCol, 0.18)} />
          <stop offset="100%" stopColor={shade(boomCol, -0.25)} />
        </linearGradient>
        <pattern id="csvHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#6b5a3a" strokeWidth="1.6" />
        </pattern>
        <marker id="csvArr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6" fill="none" stroke={dim} strokeWidth="1.2" />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#csvBg)" />

      {/* ── Çalışma alanı ızgarası ─────────────────────────────────────────── */}
      <g>
        {range(Math.ceil(u.len(minX) / stepD) * stepD, u.len(maxX), stepD).map((gd) => {
          const gx = u.fromLen(gd);
          return (
            <g key={`gx${gd}`}>
              <line x1={X(gx)} y1={Y(0)} x2={X(gx)} y2={Y(topY)} stroke={gridC} strokeWidth={1} />
              {gd >= 0 && (
                <text x={X(gx)} y={gnd + 13} fill="#4d6b8a" fontSize={9} textAnchor="middle" fontFamily="monospace">{gd}</text>
              )}
            </g>
          );
        })}
        {range(stepD, u.len(topY), stepD).map((gd) => {
          const gy = u.fromLen(gd);
          return (
            <g key={`gy${gd}`}>
              <line x1={X(minX)} y1={Y(gy)} x2={X(maxX)} y2={Y(gy)} stroke={gridC} strokeWidth={1} />
              <text x={X(minX) + 3} y={Y(gy) - 3} fill="#4d6b8a" fontSize={9} fontFamily="monospace">{gd} {u.lenU}</text>
            </g>
          );
        })}
      </g>

      {/* Bom yayı + kapasite işaretleri */}
      {arcPts.length > 1 && (
        <g>
          <polyline points={poly(arcPts)} fill="none" stroke="#5ad1ff" strokeOpacity={0.55} strokeWidth={1.3} strokeDasharray="5 4" />
          {chart && pickTicks(chart, 7).map(([r, c]) => {
            const q = arcAt(r);
            if (!q) return null;
            return (
              <g key={`t${r}`}>
                <circle cx={X(q.x)} cy={Y(q.y)} r={2.4} fill="#5ad1ff" fillOpacity={0.8} />
                <text x={X(q.x) + 4} y={Y(q.y) - 5} fill="#7fdcff" fillOpacity={0.85} fontSize={9} fontFamily="monospace">
                  {u.imperial ? `${u.len(r).toFixed(0)}ft·${u.fmtMassN(c)}lb` : `${r}m·${fmtT(c)}t`}
                </text>
              </g>
            );
          })}
          <text x={X(arcPts[arcPts.length - 1].x)} y={Y(arcPts[arcPts.length - 1].y) + 14} fill="#5ad1ff" fillOpacity={0.7} fontSize={9.5} textAnchor="middle">
            {t("{len} bom", { len: u.imperial ? fL(p.boom_length, 1) : `${p.boom_length} m` })}
          </text>
        </g>
      )}

      {/* Zemin */}
      <line x1={0} y1={gnd} x2={W} y2={gnd} stroke="#9fb1c4" strokeWidth={1.6} />

      {/* ── ŞASİ ──────────────────────────────────────────────────────────── */}
      {sideView && look ? (
        <g>
          {/* Çizimden şasi profili: önce alt şasi, sonra tekerlekler, sonra gövde/kabin */}
          {look.carrier.slice(0, 1).map((pt, i) => (
            <polygon key={`c${i}`} points={poly(pt.pts.map((q) => ({ x: U(q.x), y: q.y })))} fill={pt.color} stroke={ink} strokeWidth={1} strokeLinejoin="round" />
          ))}
          {car.axleXs.map((ax, i) => (
            <g key={i}>
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s} fill="#1d2126" stroke="#050607" strokeWidth={1} />
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s * 0.5} fill="#5b646e" stroke="#2b3036" strokeWidth={1} />
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s * 0.14} fill="#2b3036" />
            </g>
          ))}
          {look.carrier.slice(1).map((pt, i) => (
            <polygon key={`c${i + 1}`} points={poly(pt.pts.map((q) => ({ x: U(q.x), y: q.y })))} fill={pt.color} stroke={ink} strokeWidth={1} strokeLinejoin="round" />
          ))}
        </g>
      ) : sideView ? (
        <g>
          {/* Tekerlekler (ayaklar açık → yerden kalkık) */}
          {car.axleXs.map((ax, i) => (
            <g key={i}>
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s} fill="#1d2126" stroke="#050607" strokeWidth={1} />
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s * 0.5} fill="#5b646e" stroke="#2b3036" strokeWidth={1} />
              <circle cx={X(U(ax))} cy={Y(car.tireY)} r={car.tireR * s * 0.14} fill="#2b3036" />
            </g>
          ))}
          {/* Şasi gövdesi */}
          <polygon
            points={poly(rectPts(carrierU0, carrierU1, car.bottomY + 0.35, car.deckY))}
            fill={yellow} stroke={ink} strokeWidth={1.2} />
          {/* Çamurluk bandı */}
          <line x1={X(carrierU0)} y1={Y(car.bottomY + car.tireR * 1.25)} x2={X(carrierU1)} y2={Y(car.bottomY + car.tireR * 1.25)} stroke={yellowDk} strokeWidth={1.5} />
          {/* Sürücü kabini */}
          {(() => {
            const u0 = U(car.cab.x0), u1 = U(car.cab.x1);
            const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
            const frontIsLeft = u0 < u1;
            const slope = 0.45;
            const pts: Pt[] = frontIsLeft
              ? [{ x: lo, y: car.deckY - 0.3 }, { x: hi, y: car.deckY - 0.3 }, { x: hi, y: car.cab.y1 }, { x: lo + slope, y: car.cab.y1 }, { x: lo, y: car.cab.y1 - 0.9 }]
              : [{ x: lo, y: car.deckY - 0.3 }, { x: hi, y: car.deckY - 0.3 }, { x: hi, y: car.cab.y1 - 0.9 }, { x: hi - slope, y: car.cab.y1 }, { x: lo, y: car.cab.y1 }];
            const wx0 = frontIsLeft ? lo + 0.2 : lo + 0.9;
            const wx1 = frontIsLeft ? hi - 0.9 : hi - 0.2;
            return (
              <g>
                <polygon points={poly(pts)} fill={yellow} stroke={ink} strokeWidth={1.2} />
                <polygon points={poly(rectPts(wx0, wx1, car.deckY + 0.25, car.cab.y1 - 0.25))} fill="#26394d" stroke={ink} strokeWidth={0.8} />
              </g>
            );
          })()}
        </g>
      ) : (
        <g>
          {/* Uç görünüş: gövde kesiti + iki lastik */}
          {[-1, 1].map((sd) => (
            <rect key={sd} x={X(sd * (car.width / 2 - 0.35) - 0.3)} y={Y(car.tireY + car.tireR)} width={0.6 * s} height={2 * car.tireR * s}
              rx={3} fill="#1d2126" stroke="#050607" />
          ))}
          <polygon points={poly(rectPts(-car.width / 2 + 0.1, car.width / 2 - 0.1, car.bottomY + 0.35, car.deckY))} fill={yellow} stroke={ink} strokeWidth={1.2} />
        </g>
      )}

      {/* ── AYAKLAR: kiriş + silindir + tabla + takoz ─────────────────────────── */}
      {padUs.map((pu) => {
        const nearU = pu > 0 ? Math.min(pu, carrierU1) : Math.max(pu, carrierU0);
        const beamY = rig.outriggers.beamY;
        const ps = rig.outriggers.padSize;
        const crib = rig.outriggers.cribbing;
        return (
          <g key={`pad${pu}`}>
            <line x1={X(nearU)} y1={Y(beamY)} x2={X(pu)} y2={Y(beamY)} stroke={yellowDk} strokeWidth={Math.max(3, 0.34 * s)} />
            <rect x={X(pu) - 0.14 * s} y={Y(beamY + 0.25)} width={0.28 * s} height={Y(crib + rig.outriggers.padH) - Y(beamY + 0.25)} fill="#9aa4ae" stroke={ink} strokeWidth={0.8} />
            <rect x={X(pu - ps / 2)} y={Y(crib + rig.outriggers.padH)} width={ps * s} height={rig.outriggers.padH * s} fill="#3a4148" stroke={ink} strokeWidth={0.8} />
            {crib > 0 && (
              <rect x={X(pu - ps * 0.8)} y={Y(crib)} width={ps * 1.6 * s} height={crib * s} fill="url(#csvHatch)" stroke="#8a7447" strokeWidth={0.8} />
            )}
          </g>
        );
      })}

      {/* ── ÜST YAPI ───────────────────────────────────────────────────────── */}
      {look ? (
        <g>
          <polygon points={poly(rectPts(-1.3, 1.3, car.deckY, rig.superstructure.y0))} fill="#3a4148" stroke={ink} strokeWidth={1} />
          {rig.counterweight.plates > 0 && (() => {
            const cw = rig.counterweight;
            const n = cw.plates;
            const h = (cw.y1 - cw.y0) / n;
            return Array.from({ length: n }).map((_, i) => (
              <polygon key={i} points={poly(rectPts(cw.u0, cw.u1, cw.y0 + i * h, cw.y0 + (i + 1) * h))}
                fill={shade(cwCol ?? "#565f69", i % 2 ? -0.12 : 0)} stroke={ink} strokeWidth={0.9} />
            ));
          })()}
          {look.superstructure.map((pt, i) => (
            <polygon key={`s${i}`} points={poly(pt.pts)} fill={pt.color} stroke={ink} strokeWidth={1.1} strokeLinejoin="round" />
          ))}
        </g>
      ) : (() => {
        const ss = rig.superstructure;
        return (
          <g>
            {/* Döner tabla */}
            <polygon points={poly(rectPts(-1.3, 1.3, car.deckY, ss.y0))} fill="#3a4148" stroke={ink} strokeWidth={1} />
            {/* Üst yapı gövdesi */}
            <polygon points={poly([
              { x: ss.u0, y: ss.y0 }, { x: ss.u1, y: ss.y0 }, { x: ss.u1, y: ss.y0 + 0.9 },
              { x: ss.u1 - 0.8, y: ss.y1 }, { x: ss.u0, y: ss.y1 },
            ])} fill={yellow} stroke={ink} strokeWidth={1.2} />
            {/* Denge ağırlığı plakaları */}
            {rig.counterweight.plates > 0 && (() => {
              const cw = rig.counterweight;
              const n = cw.plates;
              const h = (cw.y1 - cw.y0) / n;
              return Array.from({ length: n }).map((_, i) => (
                <polygon key={i} points={poly(rectPts(cw.u0, cw.u1, cw.y0 + i * h, cw.y0 + (i + 1) * h))}
                  fill={i % 2 ? "#4b535c" : "#555e68"} stroke={ink} strokeWidth={0.9} />
              ));
            })()}
            {/* Vinç operatör kabini */}
            <polygon points={poly([
              { x: ss.cab.u0, y: ss.cab.y0 }, { x: ss.cab.u1, y: ss.cab.y0 }, { x: ss.cab.u1 + 0.35, y: ss.cab.y1 - 0.4 },
              { x: ss.cab.u1, y: ss.cab.y1 }, { x: ss.cab.u0, y: ss.cab.y1 },
            ])} fill={yellow} stroke={ink} strokeWidth={1.1} />
            <polygon points={poly(rectPts(ss.cab.u0 + 0.9, ss.cab.u1 + 0.1, ss.cab.y0 + 0.5, ss.cab.y1 - 0.25))} fill="#26394d" stroke={ink} strokeWidth={0.7} />
          </g>
        );
      })()}

      {/* Kuyruk yarıçapı */}
      <line x1={X(0)} y1={Y(rig.counterweight.y1 + 0.5)} x2={X(-d.tail_radius_m)} y2={Y(rig.counterweight.y1 + 0.5)} stroke={dim} strokeWidth={0.9} markerEnd="url(#csvArr)" />
      <text x={X(-d.tail_radius_m / 2)} y={Y(rig.counterweight.y1 + 0.5) - 4} fill={dimText} fontSize={9} textAnchor="middle">{t("R kuyruk {len}", { len: u.imperial ? fL(d.tail_radius_m, 1) : `${d.tail_radius_m} m` })}</text>

      {/* ── KLERENS ZARFI (bom altında, yük tarafında) ─────────────────────── */}
      {sg && (() => {
        const bt = g.boom_thickness;
        const a0 = sg.foot;
        const a1 = { x: sg.tip.x + 3 * sg.ux, y: sg.tip.y + 3 * sg.uy };
        const e0 = { x: a0.x + bt * sg.nx, y: a0.y + bt * sg.ny };
        const e1 = { x: a1.x + bt * sg.nx, y: a1.y + bt * sg.ny };
        return (
          <g>
            <polygon points={poly([a0, a1, e1, e0])} fill={warn ? "rgba(255,90,77,.14)" : "rgba(0,228,117,.07)"} />
            <line x1={X(e0.x)} y1={Y(e0.y)} x2={X(e1.x)} y2={Y(e1.y)} stroke={warn ? warnC : okC} strokeWidth={1.1} strokeDasharray="6 4" opacity={0.85} />
            <text x={X(e1.x)} y={Y(e1.y) + 12} fill={warn ? "#ff8a80" : "#8ff0c0"} fontSize={8.5} textAnchor="end">{t("güvenlik zarfı ({len})", { len: u.imperial ? fL(bt) : `${bt} m` })}</text>
          </g>
        );
      })()}

      {/* ── BOM ────────────────────────────────────────────────────────────── */}
      {/* Kaldırma silindiri */}
      {(() => {
        const s0 = boom.sections[0];
        const att = Math.min(s0.s1 * 0.42, p.boom_length * 0.4);
        const ux = Math.cos(boom.axisAngle), uy = Math.sin(boom.axisAngle);
        const bot = { x: boom.foot.x + att * ux + (s0.depth / 2) * uy, y: boom.foot.y + att * uy - (s0.depth / 2) * ux };
        const baseP = { x: 0.9, y: rig.superstructure.y0 + 0.45 };
        return (
          <g>
            <line x1={X(baseP.x)} y1={Y(baseP.y)} x2={X(bot.x)} y2={Y(bot.y)} stroke="#6d7780" strokeWidth={Math.max(4, 0.42 * s)} strokeLinecap="round" />
            <line x1={X(baseP.x)} y1={Y(baseP.y)} x2={X((baseP.x + bot.x) / 2)} y2={Y((baseP.y + bot.y) / 2)} stroke="#3c434a" strokeWidth={Math.max(6, 0.6 * s)} strokeLinecap="round" />
          </g>
        );
      })()}
      {/* Teleskop bölümleri: uçtan tabana (baz bölüm en üstte görünür) */}
      {[...boom.sections].reverse().map((sec, i) => (
        <polygon key={i} points={poly(alongAxis(sec.s0, sec.s1, sec.depth, sec.depth * 0.97))}
          fill={warn ? "rgba(255,90,77,.85)" : "url(#csvBoom)"} stroke={ink} strokeWidth={1} strokeLinejoin="round" />
      ))}
      {/* Bom başı + makara */}
      {(() => {
        const last = boom.sections[boom.sections.length - 1];
        const head = alongAxis(boom.length - 0.2, boom.length + 0.5, last.depth, last.depth * 0.8);
        const sr = Math.max(g.sheave_diameter / 2, 0.3);
        return (
          <g>
            <polygon points={poly([...head.slice(0, 2), boom.sheave, ...head.slice(2)])} fill="#3a4148" stroke={ink} strokeWidth={1} />
            <circle cx={X(boom.sheave.x)} cy={Y(boom.sheave.y)} r={sr * s} fill="#2b3036" stroke="#9aa4ae" strokeWidth={1} />
          </g>
        );
      })()}
      {/* Bom mafsalı */}
      <circle cx={X(boom.foot.x)} cy={Y(boom.foot.y)} r={Math.max(3, 0.32 * s)} fill="#2b3036" stroke="#c9d2db" strokeWidth={1.2} />

      {/* ── JİB (kafes) ────────────────────────────────────────────────────── */}
      {jg && jib && (() => {
        const L = jib.jib_length;
        const h = 0.9;
        const n = Math.max(3, Math.round(L / 2.5));
        const top = alongAxis(0, L, h * 1.2, h * 0.5, jg.jibAngle, jg.boomTip);
        const lines: Array<[Pt, Pt]> = [];
        const ux = Math.cos(jg.jibAngle), uy = Math.sin(jg.jibAngle), nx = -uy, ny = ux;
        for (let i = 0; i < n; i++) {
          const t0 = (i / n) * L, t1 = ((i + 1) / n) * L;
          const h0 = (h * 1.2 - (h * 0.7 * t0) / L) / 2, h1 = (h * 1.2 - (h * 0.7 * t1) / L) / 2;
          const P = (t: number, o: number) => ({ x: jg.boomTip.x + t * ux + o * nx, y: jg.boomTip.y + t * uy + o * ny });
          lines.push(i % 2 ? [P(t0, -h0), P(t1, h1)] : [P(t0, h0), P(t1, -h1)]);
        }
        return (
          <g>
            <polygon points={poly(top)} fill="none" stroke={yellow} strokeWidth={1.8} />
            {lines.map(([q0, q1], i) => (
              <line key={i} x1={X(q0.x)} y1={Y(q0.y)} x2={X(q1.x)} y2={Y(q1.y)} stroke={yellow} strokeWidth={1} />
            ))}
            <circle cx={X(jg.jibTip.x)} cy={Y(jg.jibTip.y)} r={3} fill="#2b3036" stroke="#9aa4ae" />
            <text x={X((jg.boomTip.x + jg.jibTip.x) / 2)} y={Y((jg.boomTip.y + jg.jibTip.y) / 2) - 10} fill="#5ad1ff" fontSize={10} textAnchor="middle">
              jib {u.imperial ? fL(jib.jib_length, 1) : `${jib.jib_length} m`} · {jib.jib_offset}°
            </text>
          </g>
        );
      })()}

      {/* ── HALAT + KANCA BLOĞU ─────────────────────────────────────────────── */}
      {Array.from({ length: falls }).map((_, i) => {
        const off = falls === 1 ? 0 : ((i / (falls - 1)) - 0.5) * (hookW * 0.7);
        return (
          <line key={i} x1={X(tipPt.x + off * 0.6)} y1={Y(tipPt.y)} x2={X(hookX + off)} y2={Y(hk.top)} stroke="#c7ced6" strokeWidth={0.8} />
        );
      })}
      <polygon points={poly(rectPts(hookX - hookW / 2, hookX + hookW / 2, hk.bottom + 0.25, hk.top))} fill={yellow} stroke={ink} strokeWidth={1} />
      <path d={`M ${X(hookX)} ${Y(hk.bottom + 0.25)} L ${X(hookX)} ${Y(hk.bottom + 0.05)}
                 q ${0.25 * s} 0 ${0.25 * s} ${-0.12 * s}`} fill="none" stroke="#c7ced6" strokeWidth={2} />
      {/* Sapanlar / aparatlar (kancadan aşağı sırayla) */}
      {p.rigging_items && p.rigging_items.length > 0 ? (
        <RiggingStack items={p.rigging_items} hookX={hookX} top={hk.bottom} loadX0={loadX0} loadX1={loadX1} loadTop={loadY1} X={X} Y={Y} s={s} />
      ) : (
        <>
          <line x1={X(hookX)} y1={Y(hk.bottom)} x2={X(loadX0 + 0.1)} y2={Y(loadY1)} stroke="#e2c275" strokeWidth={1.1} />
          <line x1={X(hookX)} y1={Y(hk.bottom)} x2={X(loadX1 - 0.1)} y2={Y(loadY1)} stroke="#e2c275" strokeWidth={1.1} />
        </>
      )}

      {/* ── YÜK ──────────────────────────────────────────────────────────── */}
      <polygon points={poly(rectPts(loadX0, loadX1, loadY0, loadY1))}
        fill={loadBad ? "rgba(255,90,77,.25)" : "rgba(122,143,168,.35)"} stroke={loadBad ? warnC : "#b8c6d6"} strokeWidth={1.5} />
      <text x={(X(loadX0) + X(loadX1)) / 2} y={(Y(loadY0) + Y(loadY1)) / 2 + 4} fill="#e6edf5" fontSize={11} fontWeight={700} textAnchor="middle">{t("YÜK")}</text>

      {/* ── ENGEL ────────────────────────────────────────────────────────── */}
      {p.obstacle_height > 0 && (() => {
        const ow = Math.max(0.3, p.obstacle_width);
        const oc = radius - p.obstacle_distance;
        return (
          <g>
            <polygon points={poly(rectPts(oc - ow / 2, oc + ow / 2, 0, p.obstacle_height))}
              fill="rgba(255,138,61,.12)" stroke={obsBad ? warnC : "#ff8a3d"} strokeWidth={1.4} />
            <text x={X(oc)} y={Y(p.obstacle_height) - 6} fill="#ff8a3d" fontSize={10} textAnchor="middle">{t("ENGEL")}</text>
          </g>
        );
      })()}

      {/* ── KLERENS DİKMELERİ ──────────────────────────────────────────────── */}
      {sg && clearance && (() => {
        const bt = g.boom_thickness;
        const lf = { x: sg.loadFoot.x + bt * sg.nx, y: sg.loadFoot.y + bt * sg.ny };
        return (
          <g>
            <line x1={X(sg.loadCorner.x)} y1={Y(sg.loadCorner.y)} x2={X(lf.x)} y2={Y(lf.y)} stroke={loadBad ? warnC : okC} strokeWidth={1.6} markerEnd="url(#csvArr)" />
            <circle cx={X(sg.loadCorner.x)} cy={Y(sg.loadCorner.y)} r={3.2} fill={loadBad ? warnC : okC} />
            <text x={(X(sg.loadCorner.x) + X(lf.x)) / 2 + 6} y={(Y(sg.loadCorner.y) + Y(lf.y)) / 2} fill={loadBad ? warnC : "#8ff0c0"} fontSize={10} fontFamily="monospace" fontWeight={700}>
              {fL(clearance.clearance_to_load)}
            </text>
            {sg.obstacleCorner && sg.obstacleFoot && (() => {
              const of = { x: sg.obstacleFoot.x + bt * sg.nx, y: sg.obstacleFoot.y + bt * sg.ny };
              return (
                <g>
                  <line x1={X(sg.obstacleCorner.x)} y1={Y(sg.obstacleCorner.y)} x2={X(of.x)} y2={Y(of.y)} stroke={obsBad ? warnC : okC} strokeWidth={1.3} strokeDasharray="4 3" markerEnd="url(#csvArr)" />
                  <circle cx={X(sg.obstacleCorner.x)} cy={Y(sg.obstacleCorner.y)} r={2.6} fill={obsBad ? warnC : okC} />
                </g>
              );
            })()}
          </g>
        );
      })()}

      {/* ── ÖLÇÜLER ────────────────────────────────────────────────────────── */}
      {/* Bom açısı yayı */}
      {(() => {
        const r = 3.2;
        const ang = boom.axisAngle;
        const x0 = X(boom.foot.x + r), y0 = Y(boom.foot.y);
        const x1 = X(boom.foot.x + r * Math.cos(ang)), y1 = Y(boom.foot.y + r * Math.sin(ang));
        return (
          <g>
            <line x1={X(boom.foot.x)} y1={Y(boom.foot.y)} x2={X(boom.foot.x + r + 0.8)} y2={Y(boom.foot.y)} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
            <path d={`M ${x0} ${y0} A ${r * s} ${r * s} 0 0 0 ${x1} ${y1}`} fill="none" stroke="#ffba20" strokeWidth={1.2} />
            <text x={X(boom.foot.x + r + 0.9)} y={Y(boom.foot.y + 0.9)} fill="#ffba20" fontSize={11} fontWeight={700}>
              {(ang / DEG).toFixed(1)}°
            </text>
          </g>
        );
      })()}
      {/* Radius */}
      <line x1={X(0)} y1={gnd + 30} x2={X(radius)} y2={gnd + 30} stroke={dim} strokeWidth={1} markerEnd="url(#csvArr)" markerStart="url(#csvArr)" />
      <line x1={X(0)} y1={Y(rig.superstructure.y0)} x2={X(0)} y2={gnd + 34} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <line x1={X(radius)} y1={Y(hk.bottom)} x2={X(radius)} y2={gnd + 34} stroke={dim} strokeWidth={0.6} strokeDasharray="2 4" />
      <text x={(X(0) + X(radius)) / 2} y={gnd + 45} fill={dimText} fontSize={11} textAnchor="middle" fontWeight={600}>R = {fL(radius, 1)}</text>
      {/* Maks kanca yüksekliği */}
      {clearance && !inJib && (() => {
        const hx = X(Math.max(radius, boom.tip.x) + 1.6);
        return (
          <g>
            <line x1={hx} y1={gnd} x2={hx} y2={Y(clearance.max_hook_height)} stroke="#5ad1ff" strokeWidth={0.9} markerEnd="url(#csvArr)" />
            <text x={hx + 4} y={Y(clearance.max_hook_height / 2)} fill="#5ad1ff" fontSize={9.5} transform={`rotate(-90 ${hx + 4} ${Y(clearance.max_hook_height / 2)})`} textAnchor="middle">
              {t("maks kanca {len}", { len: fL(clearance.max_hook_height) })}
            </text>
          </g>
        );
      })()}
      {/* Şasi uzunluğu */}
      {sideView && (
        <g>
          <line x1={X(carrierU0)} y1={gnd + 54} x2={X(carrierU1)} y2={gnd + 54} stroke="#4d6b8a" strokeWidth={0.8} markerEnd="url(#csvArr)" markerStart="url(#csvArr)" />
          <text x={(X(carrierU0) + X(carrierU1)) / 2} y={gnd + 51} fill="#6f8fb0" fontSize={9} textAnchor="middle">
            {u.imperial
              ? t("şasi {len} · {axles} aks · ayak {lx}×{ly}", { len: fL(d.carrier_length_m, 1), axles: d.axle_count, lx: u.fmtLenN(p.Lx, 1), ly: fL(p.Ly, 1) })
              : t("şasi {len} · {axles} aks · ayak {lx}×{ly}", { len: `${d.carrier_length_m} m`, axles: d.axle_count, lx: p.Lx, ly: `${p.Ly} m` })}
          </text>
        </g>
      )}

      {/* ── Bilgi rozeti ───────────────────────────────────────────────────── */}
      <g>
        <rect x={W - 248} y={12} width={232} height={inJib && !p.jib_clearance ? 50 : 66} rx={8} fill="rgba(8,18,32,.92)" stroke="#23425f" />
        <text x={W - 236} y={30} fontSize={11} fill="#dbe8f5" fontWeight={700}>{crane.model}</text>
        <text x={W - 236} y={46} fontSize={9.5} fill={dimText}>
          {t("Bom {boom} · CW {cw} · dönme {slew}°", {
            boom: u.imperial ? fL(p.boom_length, 1) : `${p.boom_length} m`,
            cw: u.imperial ? u.fmtMass(p.counterweight) : `${p.counterweight} t`,
            slew: p.slew_angle,
          })}
        </text>
        {inJib && p.jib_clearance ? (
          <>
            <text x={W - 236} y={62} fontSize={9.5} fill="#ffba20">{t("Jib klerensi (yaklaşık)")}</text>
            <text x={W - 26} y={62} fontSize={11} textAnchor="end" fontFamily="monospace" fontWeight={700}
              fill={p.jib_clearance.clearance_to_load < 0 || (p.jib_clearance.clearance_to_obstacle ?? 1) < 0 ? warnC : okC}>
              {u.fmtLenN(p.jib_clearance.clearance_to_load)} / {p.jib_clearance.clearance_to_obstacle == null ? "—" : u.fmtLenN(p.jib_clearance.clearance_to_obstacle)} {u.lenU}
            </text>
          </>
        ) : inJib ? (
          <text x={W - 236} y={58} fontSize={9.5} fill="#ffba20">{t("Jib modu: klerens hesaplanmaz")}</text>
        ) : clearance ? (
          <>
            <text x={W - 236} y={62} fontSize={10} fill={dimText}>{t("Yük / engel klerensi")}</text>
            <text x={W - 26} y={62} fontSize={11} textAnchor="end" fontFamily="monospace" fontWeight={700} fill={warn ? warnC : okC}>
              {u.fmtLenN(clearance.clearance_to_load)} / {u.fmtLenN(clearance.clearance_to_obstacle)} {u.lenU}
            </text>
          </>
        ) : null}
      </g>
    </svg>
  );
}

/**
 * Aparat yığını: her öğe kendi yüksekliğini kaplar. Sapanlar üst bağlantı
 * noktalarından alttakinin uçlarına iner; traverse/kiriş yatay çubuk olarak
 * çizilir (traverse yüksekliği üst sapanlarını da içerir); mapa küçük halka.
 */
function RiggingStack(props: {
  items: RiggingItem[]; hookX: number; top: number; loadX0: number; loadX1: number; loadTop: number;
  X: (x: number) => number; Y: (y: number) => number; s: number;
}) {
  const { items, hookX, loadX0, loadX1, loadTop, X, Y, s } = props;
  const sling = "#e2c275";
  const out: JSX.Element[] = [];
  // Üst bağlantı noktaları (başta kanca).
  let upper: number[] = [hookX];
  let y = props.top;
  items.forEach((it, i) => {
    const h = Math.max(0.05, it.height_m);
    const yBot = y - h;
    const isLast = i === items.length - 1;
    const half = Math.max(0.1, it.length_m / 2);
    if (it.kind === "spreader" || it.kind === "beam") {
      const barH = Math.min(0.45, h * 0.4);
      const barTop = yBot + barH;
      // Traverse: üst sapanlar bar uçlarına; kiriş: tek noktadan (orta) askı.
      if (it.kind === "spreader") {
        upper.forEach((ux) => {
          out.push(<line key={`${i}a${ux}`} x1={X(ux)} y1={Y(y)} x2={X(hookX - half)} y2={Y(barTop)} stroke={sling} strokeWidth={1.1} />);
          out.push(<line key={`${i}b${ux}`} x1={X(ux)} y1={Y(y)} x2={X(hookX + half)} y2={Y(barTop)} stroke={sling} strokeWidth={1.1} />);
        });
      } else {
        upper.forEach((ux) => out.push(<line key={`${i}c${ux}`} x1={X(ux)} y1={Y(y)} x2={X(hookX)} y2={Y(barTop)} stroke={sling} strokeWidth={1.1} />));
      }
      out.push(
        <rect key={`${i}bar`} x={X(hookX - half)} y={Y(barTop)} width={2 * half * s} height={Math.max(2, barH * s)}
          fill="#f2b705" stroke="#15191e" strokeWidth={1} />,
      );
      upper = [hookX - half * 0.9, hookX + half * 0.9];
    } else if (it.kind === "shackle") {
      const cy = (y + yBot) / 2;
      upper.forEach((ux) => out.push(<circle key={`${i}s${ux}`} cx={X(ux)} cy={Y(cy)} r={Math.max(2.5, (h / 2) * s)} fill="none" stroke="#c7ced6" strokeWidth={1.4} />));
    } else {
      // Sapan (2/4 kollu, özel): son öğeyse yük köşelerine, değilse bir alttakinin bağlantısına.
      const targets = isLast ? [loadX0 + 0.1, loadX1 - 0.1] : [hookX - half, hookX + half];
      const yEnd = isLast ? loadTop : yBot;
      upper.forEach((ux) =>
        targets.forEach((tx) =>
          out.push(<line key={`${i}l${ux}-${tx}`} x1={X(ux)} y1={Y(y)} x2={X(tx)} y2={Y(yEnd)} stroke={sling} strokeWidth={1.1} />),
        ),
      );
      upper = isLast ? upper : targets;
    }
    y = yBot;
  });
  // Son öğe sapan değilse (traverse/kiriş/mapa) yüke dik sapanlar.
  const last = items[items.length - 1];
  if (last.kind === "spreader" || last.kind === "beam" || last.kind === "shackle") {
    upper.forEach((ux, k) => {
      const tx = upper.length === 1 ? ux : k === 0 ? loadX0 + 0.1 : loadX1 - 0.1;
      out.push(<line key={`end${k}`} x1={X(ux)} y1={Y(y)} x2={X(tx)} y2={Y(loadTop)} stroke={sling} strokeWidth={1.1} />);
    });
  }
  return <g>{out}</g>;
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Eğriden ~n adet eşit aralıklı kapasite noktası seç (tam sayı radius tercih). */
function pickTicks(chart: ChartPoint[], n: number): ChartPoint[] {
  const ints = chart.filter(([r]) => Math.abs(r - Math.round(r)) < 1e-9);
  const pool = ints.length >= n ? ints : chart;
  if (pool.length <= n) return pool;
  const out: ChartPoint[] = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
  return out;
}

function fmtT(c: number): string {
  return c >= 10 ? c.toFixed(0) : c.toFixed(1);
}

/** Hex rengi açar (+) / koyulaştırır (−). */
function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

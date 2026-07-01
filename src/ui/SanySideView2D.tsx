// SANY SAC2500E'ye ÖZGÜ yandan görünüş — broşür (Overall Dimensions s.18)
// ölçüleriyle ölçekli. Klerens/çarpışma SONUCUYLA birebir tutarlı: kritik yük/
// engel köşesinden bom güvenlik zarfına dik mesafe çizilir (yeşil/kırmızı), böylece
// "çarpışma var" derken çizimde de görülür. Jib modunda bom+jib geometrisi çizilir.

import type { CraneDimensions, GeometryConstants } from "../engine/types";
import type { ClearanceResult } from "../engine/clearance";
import { sideGeometry, jibGeometry, type Pt } from "./craneGeometry";

export interface SanySideView2DProps {
  dims: CraneDimensions;
  g: GeometryConstants;
  clearance: ClearanceResult | null; // jib modunda null
  boom_length: number;
  radius: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
  obstacle_width: number;
  jib?: { jib_length: number; jib_offset: number } | null;
}

export default function SanySideView2D(props: SanySideView2DProps) {
  const {
    dims, g, clearance, boom_length, radius,
    load_height, load_diameter, obstacle_height, obstacle_distance, obstacle_width, jib,
  } = props;

  const base = g.cribbing_height + g.machine_ground_height; // bom mafsalı yüksekliği

  // ── Şasi yerleşimi (slew merkezi x=0) ───────────────────────────────────────
  const carrierRearX = -dims.tail_radius_m - 0.6; // kuyruk arkası
  const carrierFrontX = carrierRearX + dims.carrier_length_m;
  const deckY = dims.deck_height_m ?? 2.4;
  const tireR = dims.tire_diameter_m / 2;
  const axlePos = dims.axle_positions_m ?? [3, 5.7, 8.45, 10.1, 12.6];
  const axleXs = axlePos.map((p) => carrierFrontX - p);

  // ── Bom / jib geometrisi ────────────────────────────────────────────────────
  const inJib = !!jib;
  let boomFoot: Pt = { x: g.boom_offset * -1, y: base };
  let boomTip: Pt = boomFoot;
  let jibTip: Pt | null = null;
  let boomAngleDeg = 0;
  let tipPt: Pt = boomFoot; // yükün asıldığı uç (bom veya jib ucu)

  // Yük kutusu köşeleri [x0,x1] × [y0,y1] ve kanca noktası.
  let loadX0: number, loadX1: number, loadY0: number, loadY1: number;
  let hook: Pt;

  if (inJib && jib) {
    const jg = jibGeometry(g.boom_offset, base, boom_length, jib.jib_length, jib.jib_offset, radius);
    boomFoot = jg.foot;
    boomTip = jg.boomTip;
    jibTip = jg.jibTip;
    tipPt = jg.jibTip;
    boomAngleDeg = (jg.boomAngle * 180) / Math.PI;
    // Jib modu: yük jib ucundan sarkar, radius'ta yerde.
    loadX0 = radius - load_diameter / 2;
    loadX1 = radius + load_diameter / 2;
    loadY0 = 0;
    loadY1 = load_height;
    hook = { x: radius, y: load_height };
  } else if (clearance) {
    const sg0 = sideGeometry(g, clearance, boom_length, radius, load_height, load_diameter, obstacle_height, obstacle_distance);
    boomFoot = sg0.foot;
    boomTip = sg0.tip;
    tipPt = sg0.tip;
    boomAngleDeg = (clearance.gama * 180) / Math.PI;
    // clearance.ts konvansiyonu: yük iç köşesi (radius−load_diameter, load_height+obstacle_height),
    // engel üstünden geçirilmiş konumda. Kutuyu buna göre çiz → kritik köşe kutunun üst-iç köşesi.
    loadX0 = radius - load_diameter;
    loadX1 = radius;
    loadY0 = obstacle_height;
    loadY1 = obstacle_height + load_height;
    hook = { x: radius, y: loadY1 };
  } else {
    loadX0 = radius - load_diameter / 2;
    loadX1 = radius + load_diameter / 2;
    loadY0 = 0;
    loadY1 = load_height;
    hook = { x: radius, y: load_height };
  }

  // ── Klerens görselleştirme noktaları (yalnız non-jib) ────────────────────────
  const sg = clearance && !inJib
    ? sideGeometry(g, clearance, boom_length, radius, load_height, load_diameter, obstacle_height, obstacle_distance)
    : null;
  const loadBad = !!clearance && clearance.clearance_to_load < 0;
  const obsBad = !!clearance && clearance.clearance_to_obstacle < 0;
  const warn = loadBad || obsBad;

  // ── Dünya sınırları → ekran ölçeği ──────────────────────────────────────────
  const topY = Math.max(boomTip.y, jibTip?.y ?? 0, clearance?.max_hook_height ?? 0, obstacle_height, loadY1, dims.cab_height_m ?? 4) + 3;
  const minX = Math.min(carrierRearX, loadX0) - 2;
  const maxX = Math.max(carrierFrontX, loadX1, boomTip.x, jibTip?.x ?? 0) + 3;
  const minY = 0;
  const maxY = topY;

  const W = 860, H = 520, padL = 44, padR = 66, padT = 20, padB = 54;
  const s = Math.min((W - padL - padR) / (maxX - minX), (H - padT - padB) / (maxY - minY));
  const X = (x: number) => padL + (x - minX) * s;
  const Y = (y: number) => H - padB - (y - minY) * s;
  const gnd = Y(0);

  const steel = "#aebfd4", steelDim = "#6f86a6", dim = "#5f86ad", dimText = "#9ec3ea";
  const boomStroke = warn ? "#ff5a4d" : "#ff8a3d";
  const boomFill = warn ? "rgba(255,90,77,.16)" : "rgba(255,138,61,.14)";

  // Bom gövde poligonu (gerçekçi yarı-kalınlık) — merkez çizgisi foot→tip.
  const half = 0.62; // görsel bom yarı-yüksekliği (m)
  const dirX = (boomTip.x - boomFoot.x), dirY = (boomTip.y - boomFoot.y);
  const dl = Math.hypot(dirX, dirY) || 1;
  const bnx = -dirY / dl, bny = dirX / dl; // normal
  const boomPoly = [
    `${X(boomFoot.x + half * bnx)},${Y(boomFoot.y + half * bny)}`,
    `${X(boomTip.x + half * 0.6 * bnx)},${Y(boomTip.y + half * 0.6 * bny)}`,
    `${X(boomTip.x - half * 0.6 * bnx)},${Y(boomTip.y - half * 0.6 * bny)}`,
    `${X(boomFoot.x - half * bnx)},${Y(boomFoot.y - half * bny)}`,
  ].join(" ");

  // Jib poligonu
  let jibPoly = "";
  if (jibTip) {
    const jx = jibTip.x - boomTip.x, jy = jibTip.y - boomTip.y;
    const jl = Math.hypot(jx, jy) || 1;
    const jnx = -jy / jl, jny = jx / jl;
    const jh = 0.4;
    jibPoly = [
      `${X(boomTip.x + jh * jnx)},${Y(boomTip.y + jh * jny)}`,
      `${X(jibTip.x + jh * 0.7 * jnx)},${Y(jibTip.y + jh * 0.7 * jny)}`,
      `${X(jibTip.x - jh * 0.7 * jnx)},${Y(jibTip.y - jh * 0.7 * jny)}`,
      `${X(boomTip.x - jh * jnx)},${Y(boomTip.y - jh * jny)}`,
    ].join(" ");
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <linearGradient id="sbp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#091626" />
          <stop offset="100%" stopColor="#0c2036" />
        </linearGradient>
        <pattern id="shatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#33506f" strokeWidth="1" />
        </pattern>
        <marker id="sah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6" fill="none" stroke={dim} strokeWidth="1.2" />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#sbp)" />

      {/* Zemin */}
      <line x1={0} y1={gnd} x2={W} y2={gnd} stroke={steel} strokeWidth={1.6} />
      {Array.from({ length: 70 }).map((_, i) => (
        <line key={i} x1={i * 14} y1={gnd} x2={i * 14 - 7} y2={gnd + 7} stroke="#22405c" strokeWidth={1} />
      ))}

      {/* ── ŞASİ (16 m, 5 aks) ─────────────────────────────────────────────── */}
      {/* Şasi kirişi */}
      <path
        d={`M ${X(carrierRearX)} ${Y(deckY - 0.15)} L ${X(carrierFrontX)} ${Y(deckY - 0.15)}
            L ${X(carrierFrontX)} ${Y(dims.ground_clearance_m ?? 0.3)}
            L ${X(carrierRearX)} ${Y(dims.ground_clearance_m ?? 0.3)} Z`}
        fill="#11293f" stroke={steel} strokeWidth={1.5} />
      {/* Tekerlekler */}
      {axleXs.map((ax, i) => (
        <g key={i}>
          <circle cx={X(ax)} cy={Y(tireR)} r={tireR * s} fill="#0e2236" stroke={steel} strokeWidth={1.4} />
          <circle cx={X(ax)} cy={Y(tireR)} r={tireR * s * 0.42} fill="none" stroke={steelDim} strokeWidth={1.1} />
        </g>
      ))}

      {/* Sürücü kabini (ön, +x) */}
      <path d={`M ${X(carrierFrontX - 2.6)} ${Y(deckY - 0.15)} L ${X(carrierFrontX - 0.2)} ${Y(deckY - 0.15)}
                L ${X(carrierFrontX - 0.2)} ${Y(dims.cab_height_m ?? 3.6)} L ${X(carrierFrontX - 2.6)} ${Y(dims.cab_height_m ?? 3.6)} Z`}
        fill="#13314a" stroke={steel} strokeWidth={1.4} />
      <rect x={X(carrierFrontX - 2.3)} y={Y((dims.cab_height_m ?? 3.6) - 0.25)}
        width={X(carrierFrontX - 0.7) - X(carrierFrontX - 2.3)} height={Y(deckY + 0.2) - Y((dims.cab_height_m ?? 3.6) - 0.25)}
        fill="rgba(120,170,210,.18)" stroke={steelDim} strokeWidth={1} />

      {/* Döner platform (üst yapı) */}
      <path d={`M ${X(-4.4)} ${Y(deckY - 0.15)} L ${X(2.4)} ${Y(deckY - 0.15)} L ${X(2.0)} ${Y(base - 0.1)} L ${X(-4.0)} ${Y(base - 0.1)} Z`}
        fill="#16344e" stroke={steel} strokeWidth={1.5} />

      {/* Denge ağırlığı (arka, kuyruk yarıçapı içinde) */}
      <rect x={X(-dims.tail_radius_m)} y={Y(base + (dims.counterweight_height_m ?? 2.8) - 0.3)}
        width={X(-3.2) - X(-dims.tail_radius_m)} height={Y(deckY) - Y(base + (dims.counterweight_height_m ?? 2.8) - 0.3)}
        rx={2} fill="#1c2c3e" stroke={steel} strokeWidth={1.5} />
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={X(-dims.tail_radius_m)} y1={Y(deckY) + (Y(base + (dims.counterweight_height_m ?? 2.8) - 0.3) - Y(deckY)) * t}
          x2={X(-3.2)} y2={Y(deckY) + (Y(base + (dims.counterweight_height_m ?? 2.8) - 0.3) - Y(deckY)) * t} stroke={steelDim} strokeWidth={1} />
      ))}
      {/* Kuyruk dönme yarıçapı işareti */}
      <line x1={X(0)} y1={Y(base)} x2={X(-dims.tail_radius_m)} y2={Y(base)} stroke={dim} strokeWidth={0.8} strokeDasharray="4 4" opacity={0.7} />
      <text x={X(-dims.tail_radius_m / 2)} y={Y(base) - 5} fill={dimText} fontSize={9.5} textAnchor="middle">kuyruk R{dims.tail_radius_m}m</text>

      {/* Takoz (cribbing) */}
      <rect x={X(-4.0)} y={Y(g.cribbing_height)} width={X(2.0) - X(-4.0)} height={Y(0) - Y(g.cribbing_height)} fill="url(#shatch)" stroke={steelDim} strokeWidth={1} />

      {/* ── BOM ───────────────────────────────────────────────────────────── */}
      <polygon points={boomPoly} fill={boomFill} stroke={boomStroke} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={X(boomFoot.x)} cy={Y(boomFoot.y)} r={4} fill="#0c1f38" stroke={steel} strokeWidth={1.5} />
      <text x={X(boomFoot.x) + 12} y={Y(boomFoot.y) - 6} fill={boomStroke} fontSize={11.5} fontWeight={700}>
        {inJib ? "θ" : "γ"} {boomAngleDeg.toFixed(1)}°
      </text>

      {/* ── JİB (varsa) ───────────────────────────────────────────────────── */}
      {jibTip && (
        <>
          <polygon points={jibPoly} fill="rgba(120,200,255,.14)" stroke="#5ad1ff" strokeWidth={1.8} strokeLinejoin="round" />
          <circle cx={X(boomTip.x)} cy={Y(boomTip.y)} r={3} fill="#0c1f38" stroke="#5ad1ff" strokeWidth={1.4} />
          <text x={X((boomTip.x + jibTip.x) / 2)} y={Y((boomTip.y + jibTip.y) / 2) - 6} fill="#5ad1ff" fontSize={10} textAnchor="middle">
            jib {jib?.jib_length}m @{jib?.jib_offset}°
          </text>
        </>
      )}

      {/* Bom/jib ucu makara + hoist halatı → kanca */}
      <circle cx={X(tipPt.x)} cy={Y(tipPt.y)} r={3.2} fill="#0c1f38" stroke={boomStroke} strokeWidth={1.4} />
      <line x1={X(tipPt.x)} y1={Y(tipPt.y)} x2={X(hook.x)} y2={Y(hook.y + 0.8)} stroke={steel} strokeWidth={1.2} />
      <rect x={X(hook.x) - 5} y={Y(hook.y + 0.8)} width={10} height={9} rx={2} fill="#16314b" stroke={steel} strokeWidth={1.1} />

      {/* ── YÜK (clearance.ts konumuyla uyumlu kutu) ───────────────────────── */}
      <rect x={X(loadX0)} y={Y(loadY1)} width={X(loadX1) - X(loadX0)} height={Y(loadY0) - Y(loadY1)}
        rx={2} fill={loadBad ? "rgba(255,90,77,.18)" : "rgba(110,134,166,.18)"} stroke={loadBad ? "#ff5a4d" : steel} strokeWidth={1.6} />
      <text x={(X(loadX0) + X(loadX1)) / 2} y={(Y(loadY1) + Y(loadY0)) / 2 + 4} fill="#dbe6f2" fontSize={11} textAnchor="middle" fontWeight={600}>YÜK</text>
      {loadY0 > 0.05 && (
        <text x={(X(loadX0) + X(loadX1)) / 2} y={Y(loadY0) + 12} fill={steelDim} fontSize={8.5} textAnchor="middle">
          (engel üstünden kaldırılmış)
        </text>
      )}

      {/* ── ENGEL ─────────────────────────────────────────────────────────── */}
      {obstacle_height > 0 && (() => {
        const ow = Math.max(0.3, obstacle_width);
        const oxC = radius - obstacle_distance;
        const ox0 = X(oxC - ow / 2);
        const owPx = X(oxC + ow / 2) - ox0;
        const oTop = Y(obstacle_height);
        return (
          <g>
            <rect x={ox0} y={oTop} width={owPx} height={gnd - oTop} fill="rgba(255,138,61,.08)" stroke={obsBad ? "#ff5a4d" : "#ff8a3d"} strokeWidth={1.4} />
            <text x={ox0 + owPx / 2} y={oTop - 6} fill="#ff8a3d" fontSize={10} textAnchor="middle">ENGEL</text>
          </g>
        );
      })()}

      {/* ── KLERENS GÖRSELLEŞTİRME (non-jib) — sonuçla birebir ──────────────── */}
      {sg && (() => {
        const bt = g.boom_thickness; // güvenlik zarfı (klerens formülü boom_thickness çıkarır)
        // Bom ekseni ve güvenlik zarfı kenarı (yük tarafına bt kadar ötelenmiş).
        const a0 = { x: sg.foot.x, y: sg.foot.y };
        const a1 = { x: sg.tip.x + 3 * sg.ux, y: sg.tip.y + 3 * sg.uy };
        const e0 = { x: a0.x + bt * sg.nx, y: a0.y + bt * sg.ny };
        const e1 = { x: a1.x + bt * sg.nx, y: a1.y + bt * sg.ny };
        return (
        <>
          {/* Bom güvenlik zarfı bandı (eksen → bt kadar yük tarafı) */}
          <polygon points={`${X(a0.x)},${Y(a0.y)} ${X(a1.x)},${Y(a1.y)} ${X(e1.x)},${Y(e1.y)} ${X(e0.x)},${Y(e0.y)}`}
            fill={warn ? "rgba(255,90,77,.12)" : "rgba(0,228,117,.08)"} stroke="none" />
          {/* Eksen çizgisi */}
          <line x1={X(a0.x)} y1={Y(a0.y)} x2={X(a1.x)} y2={Y(a1.y)} stroke={boomStroke} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.55} />
          {/* Güvenlik zarfı kenarı (bu çizgiyi geçen köşe = çarpışma) */}
          <line x1={X(e0.x)} y1={Y(e0.y)} x2={X(e1.x)} y2={Y(e1.y)} stroke={warn ? "#ff5a4d" : "#00e475"} strokeWidth={1.1} strokeDasharray="6 4" opacity={0.85} />
          <text x={X(e1.x)} y={Y(e1.y) + 12} fill={warn ? "#ff8a80" : "#8ff0c0"} fontSize={8.5} textAnchor="end">güvenlik zarfı ({bt}m)</text>
          {/* Yük kritik köşesi → güvenlik zarfı kenarına dik (uzunluk = |klerens|) */}
          {(() => {
            const lf = { x: sg.loadFoot.x + bt * sg.nx, y: sg.loadFoot.y + bt * sg.ny };
            return (
              <g>
                <line x1={X(sg.loadCorner.x)} y1={Y(sg.loadCorner.y)} x2={X(lf.x)} y2={Y(lf.y)}
                  stroke={loadBad ? "#ff5a4d" : "#00e475"} strokeWidth={1.6} markerEnd="url(#sah)" />
                <circle cx={X(sg.loadCorner.x)} cy={Y(sg.loadCorner.y)} r={3.2} fill={loadBad ? "#ff5a4d" : "#00e475"} />
                <text x={(X(sg.loadCorner.x) + X(lf.x)) / 2 + 6} y={(Y(sg.loadCorner.y) + Y(lf.y)) / 2}
                  fill={loadBad ? "#ff5a4d" : "#8ff0c0"} fontSize={10} fontFamily="monospace" fontWeight={700}>
                  yük {clearance!.clearance_to_load.toFixed(2)}m
                </text>
              </g>
            );
          })()}
          {/* Engel kritik köşesi → güvenlik zarfı kenarına dik */}
          {sg.obstacleCorner && sg.obstacleFoot && (() => {
            const of = { x: sg.obstacleFoot!.x + bt * sg.nx, y: sg.obstacleFoot!.y + bt * sg.ny };
            return (
              <g>
                <line x1={X(sg.obstacleCorner!.x)} y1={Y(sg.obstacleCorner!.y)} x2={X(of.x)} y2={Y(of.y)}
                  stroke={obsBad ? "#ff5a4d" : "#00e475"} strokeWidth={1.4} strokeDasharray="4 3" markerEnd="url(#sah)" />
                <circle cx={X(sg.obstacleCorner!.x)} cy={Y(sg.obstacleCorner!.y)} r={2.6} fill={obsBad ? "#ff5a4d" : "#00e475"} />
              </g>
            );
          })()}
        </>
        );
      })()}

      {/* ── ÖLÇÜLER ───────────────────────────────────────────────────────── */}
      {/* Radius */}
      <line x1={X(0)} y1={gnd + 20} x2={X(radius)} y2={gnd + 20} stroke={dim} strokeWidth={1} markerEnd="url(#sah)" markerStart="url(#sah)" />
      <line x1={X(0)} y1={gnd} x2={X(0)} y2={gnd + 24} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <text x={(X(0) + X(radius)) / 2} y={gnd + 34} fill={dimText} fontSize={10.5} textAnchor="middle">RADIUS {radius.toFixed(1)} m</text>

      {/* Şasi uzunluğu */}
      <line x1={X(carrierRearX)} y1={gnd + 42} x2={X(carrierFrontX)} y2={gnd + 42} stroke={steelDim} strokeWidth={0.8} markerEnd="url(#sah)" markerStart="url(#sah)" />
      <text x={(X(carrierRearX) + X(carrierFrontX)) / 2} y={gnd + 52} fill={steelDim} fontSize={9.5} textAnchor="middle">şasi {dims.carrier_length_m} m · {dims.axle_count} aks</text>

      {/* Klerens rozeti */}
      <g>
        <rect x={W - 236} y={12} width={220} height={inJib ? 30 : 48} rx={8} fill="rgba(8,18,32,.92)" stroke="#23425f" />
        <text x={W - 224} y={29} fontSize={10.5} fill={dimText} fontWeight={700}>SANY SAC2500E</text>
        {inJib ? (
          <text x={W - 24} y={29} fontSize={10} textAnchor="end" fill="#ffba20">Jib modu — klerens N/A</text>
        ) : clearance ? (
          <>
            <text x={W - 224} y={44} fontSize={10.5} fill={dimText}>Yük klerensi</text>
            <text x={W - 24} y={44} fontSize={12} textAnchor="end" fontFamily="monospace" fontWeight={700}
              fill={loadBad ? "#ff5a4d" : clearance.clearance_to_load < 1 ? "#ffba20" : "#00e475"}>
              {clearance.clearance_to_load.toFixed(2)} m
            </text>
          </>
        ) : null}
      </g>
    </svg>
  );
}

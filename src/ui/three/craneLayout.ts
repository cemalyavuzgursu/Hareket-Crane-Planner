// 3B vinç yerleşimi — tek bir vincin (ana veya tandem 2. vinç) çizim ve
// etkileşim tutamaçları için ihtiyaç duyduğu tüm türetilmiş ölçüler.
// Saf fonksiyonlar; React/three bağımlılığı yok.
//
// Konvansiyon (bkz. craneRig.ts): üst yapı yerel çerçevesi +u = bom yönü, y yukarı;
// bom mafsalı (−boom_offset, cribbing+machine_ground). γ = mafsal→makara doğrusu,
// bom ekseni = γ + α, α = atan(sheave_offset/L). z = L / cos α.
//   radius = z·cosγ − boom_offset   ⇔   cosγ = (radius + boom_offset) / z

import type { CraneModel, GeometryConstants } from '../../engine/types';
import { jibGeometry, type JibGeometry } from '../craneGeometry';
import { buildRig, hookPlacement, type CraneRig, type Pt } from '../craneRig';

/** v sonlu ise v, değilse fallback. */
export function safe(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
/** v sonlu VE pozitif ise v, değilse fallback. */
export function safePos(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const DEG = Math.PI / 180;

/** Açıyı [0, 360) aralığına getirir. */
export function norm360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface CraneLayoutInput {
  crane: CraneModel;
  boomLength: number;
  radius: number;
  gama: number;
  slewAngleDeg: number;
  loadHeight: number;
  loadDiameter: number;
  obstacleHeight?: number;
  /** Yük alt kotu (m). Verilmezse ana bomda engel yüksekliği, jibde 0 (eski davranış). */
  loadBottomHeight?: number;
  outrigger: { Lx: number; Ly: number };
  counterweight: number;
  jib?: { jib_length: number; jib_offset: number } | null;
  riggingHeight?: number;
}

export interface CraneLayout {
  g: GeometryConstants;
  rig: CraneRig;
  boomLen: number;
  radius: number;
  slewRad: number;
  jg: JibGeometry | null;
  jibLen: number;
  /** Jib'in bom eksenine göre yerel açısı (rad). */
  jibLocalAngle: number;
  /** Halat çıkış noktası (makara veya jib ucu), üst yapı yerel (u, y). */
  tip: Pt;
  loadD: number;
  loadH: number;
  loadX0: number;
  loadX1: number;
  loadY0: number;
  loadY1: number;
  hk: { bottom: number; top: number };
  /** Sapan/aparat boyu (kanca altı ↔ yük üstü). */
  sling: number;
  /** Yük alt kotunun alabileceği en büyük değer (kanca makaraya dayanana dek). */
  maxLoadBottom: number;
  /** α = atan(sheave_offset/L) (jib modunda 0). */
  alfa: number;
  /** Mafsal → makara mesafesi z. */
  zSheave: number;
  topExtent: number;
}

export function computeCraneLayout(inp: CraneLayoutInput): CraneLayout {
  const g = inp.crane.geometry_constants;
  const boomLen = safePos(inp.boomLength, 10);
  const radius = safePos(inp.radius, 5);
  const gama = safe(inp.gama, Math.PI / 4);
  const slewRad = safe(inp.slewAngleDeg, 0) * DEG;
  const loadH = Math.max(0.1, safePos(inp.loadHeight, 1));
  const loadD = Math.max(0.1, safePos(inp.loadDiameter, 1));
  const obsH = Math.max(0, safe(inp.obstacleHeight ?? 0, 0));
  const Lx = Math.max(2, safePos(inp.outrigger.Lx, 6));
  const Ly = Math.max(2, safePos(inp.outrigger.Ly, 6));
  const base = g.cribbing_height + g.machine_ground_height;

  const jibActive = !!inp.jib && inp.jib.jib_length > 0;
  const jg = jibActive && inp.jib ? jibGeometry(g.boom_offset, base, boomLen, inp.jib.jib_length, inp.jib.jib_offset, radius) : null;
  const rig = buildRig({
    crane: inp.crane,
    boom_length: boomLen,
    gama: jg ? jg.boomAngle : gama,
    withSheaveOffset: !jg,
    counterweight: safe(inp.counterweight, 0),
    Lx,
    Ly,
  });
  const boom = rig.boom;
  const tip = jg ? jg.jibTip : boom.sheave;

  const sling = inp.riggingHeight && inp.riggingHeight > 0 ? inp.riggingHeight : Math.max(1.2, Math.min(3.5, loadD * 0.5));
  const maxHookBottom = tip.y - g.sheave_diameter - g.hook_height;
  const maxLoadBottom = Math.max(0, maxHookBottom - sling - loadH);
  const lbRaw = inp.loadBottomHeight;
  const loadY0 =
    lbRaw != null && Number.isFinite(lbRaw)
      ? Math.max(0, Math.min(lbRaw, maxLoadBottom))
      : jg
        ? 0
        : obsH;
  const loadY1 = loadY0 + loadH;
  const hk = hookPlacement(g, tip.y, loadY1, loadD, inp.riggingHeight);

  const alfa = jg ? 0 : Math.atan(g.sheave_offset / boomLen);
  return {
    g,
    rig,
    boomLen,
    radius,
    slewRad,
    jg,
    jibLen: jg && inp.jib ? inp.jib.jib_length : 0,
    jibLocalAngle: jg ? jg.jibAngle - jg.boomAngle : 0,
    tip,
    loadD,
    loadH,
    loadX0: radius - loadD / 2,
    loadX1: radius + loadD / 2,
    loadY0,
    loadY1,
    hk,
    sling,
    maxLoadBottom,
    alfa,
    zSheave: boomLen / Math.cos(alfa),
    topExtent: Math.max(boom.tip.y, tip.y),
  };
}

/** Bom EKSEN açısından (rad) radius (ana bom modu). */
export function radiusFromAxisAngle(g: GeometryConstants, boomLen: number, axisAngle: number): number {
  const alfa = Math.atan(g.sheave_offset / boomLen);
  const z = boomLen / Math.cos(alfa);
  return z * Math.cos(axisAngle - alfa) - g.boom_offset;
}

/** Enerji hattı emniyet mesafesi (m) — gerilime göre (OSHA 1926.1408 Tablo A benzeri). */
export function powerlineMargin(kv: number | undefined): number {
  const v = kv ?? 0;
  if (v <= 50) return 3.05;
  if (v <= 200) return 4.6;
  if (v <= 350) return 6.1;
  return 7.6;
}

/** İki #rrggbb rengi t oranında karıştırır. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = /^#?([0-9a-f]{6})$/i.exec(a);
  const pb = /^#?([0-9a-f]{6})$/i.exec(b);
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const ch = (s: number) => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** #rrggbb rengini k oranında koyulaştırır. */
export function darken(hex: string, k: number): string {
  return mixHex(hex, '#000000', k);
}

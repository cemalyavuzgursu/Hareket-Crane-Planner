/**
 * CraneBody — tek bir vincin 3B çizimi (şasi + ayaklar + üst yapı + bom/jib +
 * halat + kanca + aparat + yük + basit engel). Ana vinç ve tandem 2. vinç için
 * ortak. Konum/yön (heading) dıştaki grup tarafından verilir; bu bileşen slew
 * merkezini orijin kabul eder (+X = şasi arkası).
 */
import { useMemo, type ReactNode } from 'react';
import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide, Shape } from 'three';
import type { RiggingItem } from '../state';
import { drawnFalls, type RigPart } from '../craneRig';
import { darken, mixHex, safe, type CraneLayout } from './craneLayout';

type PDown = (e: ThreeEvent<PointerEvent>) => void;

/** İki nokta arasında (x-y düzleminde) silindir — kaldırma pistonu vb. */
function Strut({ a, b, r, color }: { a: [number, number]; b: [number, number]; r: number; color: string }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 0.01;
  return (
    <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]} rotation={[0, 0, Math.atan2(dy, dx) - Math.PI / 2]}>
      <cylinderGeometry args={[r, r, len, 14]} />
      <meshStandardMaterial color={color} metalness={0.6} roughness={0.35} />
    </mesh>
  );
}

/** Eksen hizalı kutu: [x0,x1]×[y0,y1]×[z0,z1]. */
export function Block({ x0, x1, y0, y1, z0, z1, color, metal = 0.25, rough = 0.6, opacity }: {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  color: string; metal?: number; rough?: number; opacity?: number;
}) {
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]}>
      <boxGeometry args={[Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0)]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={rough}
        transparent={opacity != null} opacity={opacity ?? 1} />
    </mesh>
  );
}

/** Aparat yığını (3B) — 2B CraneSideView2D.RiggingStack ile aynı mantık. */
function RiggingStack3D({ items, hookX, top, loadCorners, loadTop, barColor }: {
  items: RiggingItem[]; hookX: number; top: number; loadCorners: Array<[number, number]>; loadTop: number; barColor: string;
}) {
  const sling = '#e2c275';
  const els: ReactNode[] = [];
  let upper: Array<[number, number]> = [[hookX, 0]];
  let y = top;
  items.forEach((it, i) => {
    const h = Math.max(0.05, it.height_m);
    const yBot = y - h;
    const half = Math.max(0.1, it.length_m / 2);
    // Son öğe sapan ise kolları (aşağıdaki son bağlantılar) ÜST noktasından yüke iner.
    if (i === items.length - 1 && it.kind !== 'spreader' && it.kind !== 'beam' && it.kind !== 'shackle') return;
    if (it.kind === 'spreader' || it.kind === 'beam') {
      const barH = Math.min(0.45, h * 0.4);
      const barTop = yBot + barH;
      const ends: Array<[number, number]> = [[hookX - half, 0], [hookX + half, 0]];
      const tops = it.kind === 'spreader' ? ends : [[hookX, 0] as [number, number]];
      upper.forEach((u, a) => tops.forEach((t, b) =>
        els.push(<Line key={`r${i}-${a}-${b}`} points={[[u[0], y, u[1]], [t[0], barTop, t[1]]]} color={sling} lineWidth={1.2} />)));
      els.push(
        <mesh key={`bar${i}`} position={[hookX, yBot + barH / 2, 0]}>
          <boxGeometry args={[2 * half, barH, 0.3]} />
          <meshStandardMaterial color={barColor} metalness={0.3} roughness={0.5} />
        </mesh>,
      );
      upper = [[hookX - half * 0.9, 0], [hookX + half * 0.9, 0]];
    } else if (it.kind !== 'shackle' && i < items.length - 1) {
      const targets: Array<[number, number]> = [[hookX - half, 0], [hookX + half, 0]];
      upper.forEach((u, a) => targets.forEach((t, b) =>
        els.push(<Line key={`s${i}-${a}-${b}`} points={[[u[0], y, u[1]], [t[0], yBot, t[1]]]} color={sling} lineWidth={1.2} />)));
      upper = targets;
    }
    y = yBot;
  });
  // Son bağlantılar → yük üst köşeleri (en yakın üst noktadan).
  loadCorners.forEach(([x, z], k) => {
    const u = upper.reduce((b, p) => (Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b), upper[0]);
    els.push(<Line key={`l${k}`} points={[[u[0], y, u[1]], [x, loadTop, z]]} color={sling} lineWidth={1.2} />);
  });
  return <>{els}</>;
}

/** Yan profil poligonunu (x-y düzleminde) z boyunca [z0, z0+depth] uzatır. */
function Extruded({ pts, z0, depth, color, glass = false }: {
  pts: { x: number; y: number }[]; z0: number; depth: number; color: string; glass?: boolean;
}) {
  const shape = useMemo(() => {
    const sh = new Shape();
    pts.forEach((p, i) => (i === 0 ? sh.moveTo(p.x, p.y) : sh.lineTo(p.x, p.y)));
    sh.closePath();
    return sh;
  }, [pts]);
  return (
    <mesh position={[0, 0, z0]}>
      <extrudeGeometry args={[shape, { depth: Math.max(0.01, depth), bevelEnabled: false }]} />
      <meshStandardMaterial color={color} side={DoubleSide}
        metalness={glass ? 0.8 : 0.28} roughness={glass ? 0.15 : 0.55} />
    </mesh>
  );
}

/**
 * Profil parçalarını yanal yerleşimleriyle çizer. half = yan kenarın |z|'si.
 * leftSign: "left" tarafının z işareti (şasi: sürücü solu = +Z; üst yapı:
 * bom yönüne bakan operatörün solu = −Z). Cam parçaları bir önceki parçayla
 * eş merkezli çizilir (yan yüzlerde pencere olarak görünür).
 */
function ProfileParts({ parts, half, leftSign, tint }: { parts: RigPart[]; half: number; leftSign: 1 | -1; tint: (c: string) => string }) {
  let lastC = 0;
  return (
    <>
      {parts.map((p, i) => {
        const isGlass = p.glass;
        let zc: number;
        if (isGlass) zc = lastC;
        else if (p.side === 'left') zc = leftSign * (half - p.width / 2);
        else if (p.side === 'right') zc = -leftSign * (half - p.width / 2);
        else zc = 0;
        if (!isGlass) lastC = zc;
        return <Extruded key={i} pts={p.pts} z0={zc - p.width / 2} depth={p.width} color={isGlass ? p.color : tint(p.color)} glass={isGlass} />;
      })}
    </>
  );
}

export interface CraneBodyProps {
  layout: CraneLayout;
  clearanceWarning?: boolean;
  falls?: number;
  riggingItems?: RiggingItem[];
  obstacleHeight?: number;
  obstacleDistance?: number;
  obstacleWidth?: number;
  /** false → yük + aparat çizilmez (ör. tandem 2. vinç), yalnız kanca. */
  showLoad?: boolean;
  /** Renk tonu (#hex) — gövde renkleri bu renge doğru karıştırılır. */
  tint?: string | null;
  /** Bom vurgusu (seçili/etkileşim modu). */
  boomHighlight?: boolean;
  /** Üst yapı yerel çerçevesinde (x = u, bom yönü) çizilecek ek öğeler. */
  superChildren?: ReactNode;
  /** Şasi çerçevesinde (slew'den bağımsız) çizilecek ek öğeler. */
  carrierChildren?: ReactNode;
  onBoomPointerDown?: PDown;
  onBoomClick?: (e: ThreeEvent<MouseEvent>) => void;
  onHookPointerDown?: PDown;
}

export default function CraneBody({
  layout: L,
  clearanceWarning = false,
  falls: fallsRaw,
  riggingItems,
  obstacleHeight,
  obstacleDistance,
  obstacleWidth,
  showLoad = true,
  tint = null,
  boomHighlight = false,
  superChildren,
  carrierChildren,
  onBoomPointerDown,
  onBoomClick,
  onHookPointerDown,
}: CraneBodyProps) {
  const { g, rig, boomLen, radius, tip, hk, loadD, loadX0, loadX1, loadY0, loadY1 } = L;
  const d = rig.dims;
  const car = rig.carrier;
  const ss = rig.superstructure;
  const cw = rig.counterweight;
  const boom = rig.boom;

  const tintC = (c: string) => (tint ? mixHex(c, tint, 0.45) : c);
  const bodyYellow = tintC(rig.look?.colors.body ?? d.color);
  const yellow = clearanceWarning ? '#ef4444' : boomHighlight ? '#fde047' : tintC(rig.look?.colors.boom ?? d.color);
  const dark = '#3a4148';
  const tireC = '#1b1e22';

  const obsH = Math.max(0, safe(obstacleHeight ?? 0, 0));
  const obsDist = safe(obstacleDistance ?? 0, 0);
  const obsW = Math.max(0.3, Number.isFinite(obstacleWidth) && (obstacleWidth ?? 0) > 0 ? (obstacleWidth as number) : 2.5);

  const falls = drawnFalls(fallsRaw);
  const hookW = 0.5 + 0.05 * falls;

  // Bom yerel çerçevesinde makara noktası
  const ca = Math.cos(boom.axisAngle), sa = Math.sin(boom.axisAngle);
  const shLocal: [number, number] = [
    (boom.sheave.x - boom.foot.x) * ca + (boom.sheave.y - boom.foot.y) * sa,
    -(boom.sheave.x - boom.foot.x) * sa + (boom.sheave.y - boom.foot.y) * ca,
  ];

  // Kaldırma pistonu: üst yapıdan bom tabanı altına
  const s0 = boom.sections[0];
  const att = Math.min(s0.s1 * 0.42, boomLen * 0.4);
  const pistonTop: [number, number] = [boom.foot.x + att * ca + (s0.depth / 2) * sa, boom.foot.y + att * sa - (s0.depth / 2) * ca];
  const pistonBase: [number, number] = [0.9, ss.y0 + 0.45];

  const jibActive = !!L.jg;
  const jibLen = L.jibLen;
  const hw = d.body_width_m / 2;
  const tz = car.width / 2 - 0.3;

  return (
    <group>
      {/* ── ŞASİ (şasi çerçevesi, +X = arka) ──────────────────────────────── */}
      {rig.look ? (
        <ProfileParts parts={rig.look.carrier} half={car.width / 2 - 0.05} leftSign={1} tint={tintC} />
      ) : (<>
        <Block x0={car.frontX + 0.2} x1={car.rearX} y0={car.bottomY + 0.35} y1={car.deckY} z0={-hw} z1={hw} color={bodyYellow} />
        {/* Şasi alt kirişi */}
        <Block x0={car.frontX + 0.6} x1={car.rearX - 0.3} y0={car.bottomY} y1={car.bottomY + 0.4} z0={-0.7} z1={0.7} color={dark} />
        {/* Sürücü kabini (ön-sol) */}
        <Block x0={car.cab.x0} x1={car.cab.x1} y0={car.deckY - 0.4} y1={car.cab.y1} z0={hw - 1.35} z1={hw} color={bodyYellow} />
        <Block x0={car.cab.x0 - 0.02} x1={car.cab.x0 + 0.05} y0={car.deckY + 0.3} y1={car.cab.y1 - 0.25} z0={hw - 1.25} z1={hw - 0.1} color="#26394d" metal={0.8} rough={0.15} />
      </>)}
      {/* Lastikler */}
      {car.axleXs.map((ax, i) =>
        [1, -1].map((sz) => (
          <group key={`${i}-${sz}`} position={[ax, car.tireY, sz * tz]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh>
              <cylinderGeometry args={[car.tireR, car.tireR, 0.55, 24]} />
              <meshStandardMaterial color={tireC} roughness={0.95} />
            </mesh>
            <mesh position={[0, sz * -0.28, 0]}>
              <cylinderGeometry args={[car.tireR * 0.5, car.tireR * 0.5, 0.02, 18]} />
              <meshStandardMaterial color="#6b7580" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        )),
      )}

      {/* ── AYAKLAR: kiriş + silindir + tabla + takoz ─────────────────────── */}
      {rig.outriggers.pads.map((pd, i) => {
        const sz = Math.sign(pd.z) || 1;
        const ps = rig.outriggers.padSize;
        const crib = rig.outriggers.cribbing;
        const padTop = crib + rig.outriggers.padH;
        const by = rig.outriggers.beamY;
        return (
          <group key={i}>
            <Block x0={pd.x - 0.35} x1={pd.x + 0.35} y0={by - 0.3} y1={by + 0.3} z0={-hw} z1={hw} color={dark} />
            <Block x0={pd.x - 0.22} x1={pd.x + 0.22} y0={by - 0.2} y1={by + 0.2}
              z0={sz > 0 ? hw : pd.z} z1={sz > 0 ? pd.z : -hw} color={bodyYellow} />
            <mesh position={[pd.x, (by + padTop) / 2, pd.z]}>
              <cylinderGeometry args={[0.13, 0.13, Math.max(0.05, by - padTop), 12]} />
              <meshStandardMaterial color="#b9c2cb" metalness={0.8} roughness={0.2} />
            </mesh>
            <Block x0={pd.x - ps / 2} x1={pd.x + ps / 2} y0={crib} y1={padTop} z0={pd.z - ps / 2} z1={pd.z + ps / 2} color="#2f353b" />
            {crib > 0 && (
              <Block x0={pd.x - ps * 0.85} x1={pd.x + ps * 0.85} y0={0} y1={crib} z0={pd.z - ps * 0.85} z1={pd.z + ps * 0.85} color="#8a6a3c" rough={0.9} />
            )}
          </group>
        );
      })}

      {carrierChildren}

      {/* ── ÜST YAPI (slew ile döner) ─────────────────────────────────────────
          Motor konvansiyonu: slew a → dünya (x=r·cosa, z=r·sina). three.js'te
          rotation.y=+a yerel +X'i (cosa, −sina)'ya götürür (ayna) → negatif. */}
      <group rotation={[0, -L.slewRad, 0]}>
        {/* Döner tabla */}
        <mesh position={[0, (car.deckY + ss.y0) / 2, 0]}>
          <cylinderGeometry args={[1.3, 1.3, Math.max(0.05, ss.y0 - car.deckY), 28]} />
          <meshStandardMaterial color={dark} metalness={0.4} roughness={0.5} />
        </mesh>
        {rig.look ? (
          <ProfileParts parts={rig.look.superstructure} half={Math.min(car.width / 2, 1.5)} leftSign={-1} tint={tintC} />
        ) : (
          <Block x0={ss.u0} x1={ss.u1} y0={ss.y0} y1={ss.y1} z0={-ss.width / 2 + 1.2} z1={ss.width / 2} color={bodyYellow} />
        )}
        {/* Denge ağırlığı plakaları */}
        {Array.from({ length: cw.plates }).map((_, i) => {
          const h = (cw.y1 - cw.y0) / Math.max(1, cw.plates);
          const base = rig.look ? rig.look.colors.cw : '#565f69';
          const c = rig.look ? (i % 2 ? darken(base, 0.14) : base) : (i % 2 ? '#4b535c' : '#565f69');
          return (
            <Block key={i} x0={cw.u0} x1={cw.u1} y0={cw.y0 + i * h + 0.02} y1={cw.y0 + (i + 1) * h}
              z0={-cw.width / 2} z1={cw.width / 2} color={tintC(c)} metal={0.3} rough={0.7} />
          );
        })}
        {!rig.look && (<>
          <Block x0={ss.cab.u0} x1={ss.cab.u1} y0={ss.cab.y0} y1={ss.cab.y1} z0={-ss.width / 2 - 0.1} z1={-ss.width / 2 + 1.0} color={bodyYellow} />
          <Block x0={ss.cab.u1} x1={ss.cab.u1 + 0.04} y0={ss.cab.y0 + 0.5} y1={ss.cab.y1 - 0.2} z0={-ss.width / 2} z1={-ss.width / 2 + 0.9} color="#26394d" metal={0.8} rough={0.15} />
        </>)}

        {/* Kaldırma pistonu */}
        <Strut a={pistonBase} b={[(pistonBase[0] + pistonTop[0]) / 2, (pistonBase[1] + pistonTop[1]) / 2]} r={0.24} color="#4a525b" />
        <Strut a={pistonBase} b={pistonTop} r={0.14} color="#c2cad2" />

        {/* ── Teleskop bom (mafsalda, eksen açısıyla) ─────────────────────── */}
        <group position={[boom.foot.x, boom.foot.y, 0]} rotation={[0, 0, boom.axisAngle]} onPointerDown={onBoomPointerDown} onClick={onBoomClick}>
          {boom.sections.map((sec, i) => (
            <mesh key={i} position={[(sec.s0 + sec.s1) / 2, 0, 0]}>
              <boxGeometry args={[Math.max(0.05, sec.s1 - sec.s0), sec.depth, sec.width]} />
              <meshStandardMaterial color={yellow} metalness={0.3} roughness={0.45} />
            </mesh>
          ))}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.35, 0.35, s0.width + 0.3, 16]} />
            <meshStandardMaterial color={dark} metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[boomLen + 0.15, shLocal[1] / 2, 0]}>
            <boxGeometry args={[0.9, Math.abs(shLocal[1]) + 0.5, boom.sections[boom.sections.length - 1].width * 0.9]} />
            <meshStandardMaterial color={dark} metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[shLocal[0], shLocal[1], 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[Math.max(0.3, g.sheave_diameter / 2), Math.max(0.3, g.sheave_diameter / 2), 0.6, 20]} />
            <meshStandardMaterial color="#2b3036" metalness={0.6} roughness={0.35} />
          </mesh>
          {/* ── JİB (kafes) ─────────────────────────────────────────────── */}
          {jibActive && (
            <group position={[boomLen, 0, 0]} rotation={[0, 0, L.jibLocalAngle]}>
              {[[0.35, 0.35], [0.35, -0.35], [-0.35, 0.35], [-0.35, -0.35]].map(([oy, oz], i) => (
                <mesh key={i} position={[jibLen / 2, oy, oz]}>
                  <boxGeometry args={[jibLen, 0.09, 0.09]} />
                  <meshStandardMaterial color={yellow} metalness={0.3} roughness={0.5} />
                </mesh>
              ))}
              {Array.from({ length: Math.max(3, Math.round(jibLen / 2)) }).map((_, i, arr) => {
                const t0 = (i / arr.length) * jibLen;
                const t1 = ((i + 1) / arr.length) * jibLen;
                const sgn = i % 2 ? 1 : -1;
                return [0.35, -0.35].map((oz) => (
                  <Line key={`${i}-${oz}`} points={[[t0, 0.35 * sgn, oz], [t1, -0.35 * sgn, oz]]} color={yellow} lineWidth={1.4} />
                ));
              })}
              <mesh position={[jibLen, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.28, 0.28, 0.4, 12]} />
                <meshStandardMaterial color="#2b3036" metalness={0.4} roughness={0.5} />
              </mesh>
            </group>
          )}
        </group>

        {/* ── Halat kolları ──────────────────────────────────────────────── */}
        {Array.from({ length: falls }).map((_, i) => {
          const off = falls === 1 ? 0 : (i / (falls - 1) - 0.5) * hookW * 0.7;
          return (
            <Line key={`fall-${i}`} points={[[tip.x, tip.y, off * 0.5], [radius, hk.top, off]]} color="#c7ced6" lineWidth={1} />
          );
        })}

        {/* ── Kanca bloğu + aparat + yük (kanca modunda birlikte sürüklenir) ── */}
        <group onPointerDown={onHookPointerDown}>
          <Block x0={radius - 0.3} x1={radius + 0.3} y0={hk.bottom + 0.3} y1={hk.top} z0={-hookW / 2} z1={hookW / 2} color={bodyYellow} />
          <mesh position={[radius, hk.bottom + 0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.16, 0.05, 8, 16, Math.PI * 1.5]} />
            <meshStandardMaterial color="#c2cad2" metalness={0.8} roughness={0.2} />
          </mesh>
          {showLoad && (<>
            <RiggingStack3D
              items={riggingItems ?? []}
              hookX={radius}
              top={hk.bottom}
              loadCorners={[[loadX1, loadD / 2], [loadX1, -loadD / 2], [loadX0, loadD / 2], [loadX0, -loadD / 2]]}
              loadTop={loadY1}
              barColor={bodyYellow}
            />
            <Block x0={loadX0} x1={loadX1} y0={loadY0} y1={loadY1} z0={-loadD / 2} z1={loadD / 2}
              color={clearanceWarning ? '#ef4444' : '#7a8fa8'} metal={0.2} rough={0.7} />
          </>)}
        </group>

        {/* ── Engel ───────────────────────────────────────────────────────── */}
        {showLoad && obsH > 0 && (
          <Block x0={radius - obsDist - obsW / 2} x1={radius - obsDist + obsW / 2} y0={0} y1={obsH}
            z0={-obsW / 2} z1={obsW / 2} color="#f59e0b" opacity={0.45} />
        )}

        {superChildren}
      </group>
    </group>
  );
}

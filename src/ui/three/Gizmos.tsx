/**
 * Doğrudan manipülasyon tutamaçları (Liebherr Crane Planner benzeri):
 *   - Bom açısı iletkisi (radius) + bom ucu uzunluk tutamacı
 *   - Dönme halkası (slew)
 *   - Kanca yüksekliği (yük alt kotu)
 *   - Vinç konumu (zeminde taşıma)
 *   - Çevre nesnesi taşıma / döndürme
 * Tüm sürüklemeler drag.ts → useDragOnPlane üzerinden yardımcı düzlemlerle yapılır.
 */
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Vector3, type Mesh } from 'three';
import type { SceneObject } from '../../engine/types';
import { DEG, norm360, round1, type CraneLayout } from './craneLayout';
import { horizontalPlane, useDragOnPlane, verticalPlane } from './drag';
import { useI18n } from '../i18n';
import { useUnits } from '../units';

type PDown = (e: ThreeEvent<PointerEvent>) => void;

/** Vincin sahadaki çerçevesi: slew merkezi (cx, cz), yön (heading) ve slew (°). */
export interface CraneFrame {
  cx: number;
  cz: number;
  headingDeg: number;
  slewDeg: number;
}

const CYAN = '#22d3ee';
const RED = '#ef4444';
const labelStyle = (color = CYAN): CSSProperties => ({
  background: 'rgba(8,18,32,.92)', border: `1px solid ${color}`, borderRadius: 6,
  padding: '3px 7px', color: '#e6f6fb', font: '600 11.5px/1.35 JetBrains Mono, monospace', whiteSpace: 'nowrap',
  pointerEvents: 'none', userSelect: 'none',
});

export function Label({ position, children, color }: { position: [number, number, number]; children: ReactNode; color?: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
      <div style={labelStyle(color)}>{children}</div>
    </Html>
  );
}

/** Sürüklenebilir küre tutamacı (hover'da büyür). */
function Knob({ position, color, r = 0.45, onPointerDown }: { position: [number, number, number]; color: string; r?: number; onPointerDown: PDown }) {
  const ref = useRef<Mesh>(null);
  return (
    <mesh
      ref={ref}
      position={position}
      onPointerDown={onPointerDown}
      onPointerOver={(e) => { e.stopPropagation(); ref.current?.scale.setScalar(1.3); document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { ref.current?.scale.setScalar(1); document.body.style.cursor = ''; }}
    >
      <sphereGeometry args={[r, 18, 14]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sürükleme mantığı (dünya çerçevesinde) — tutamaçlar ve vinç parçaları kullanır.
// ─────────────────────────────────────────────────────────────────────────────
export interface CraneDragOptions {
  layout: CraneLayout;
  frame: CraneFrame;
  loadBottom: number;
  boomLengths?: number[];
  onRadiusChange?: (r: number) => void;
  onBoomLengthChange?: (L: number) => void;
  onSlewChange?: (deg: number) => void;
  onLoadBottomChange?: (h: number) => void;
  onCranePositionChange?: (x: number, z: number) => void;
}

export interface CraneDrags {
  angle: PDown;
  length: PDown;
  slew: PDown;
  hook: PDown;
  move: PDown;
}

/** Bom eksen açısından (rad) radius — ana bomda γ/α formülü, jibde erişim formülü. */
export function radiusForAxisAngle(L: CraneLayout, theta: number): number {
  const g = L.g;
  if (L.jg) {
    // x_tip = −bo + B·cosθ + J·cos(θ − ofs); jibLocalAngle = −ofs
    return -g.boom_offset + L.boomLen * Math.cos(theta) + L.jibLen * Math.cos(theta + L.jibLocalAngle);
  }
  return L.zSheave * Math.cos(theta - L.alfa) - g.boom_offset;
}

export function useCraneDrags(opts: CraneDragOptions): CraneDrags {
  const startDrag = useDragOnPlane();
  const camera = useThree((s) => s.camera);
  // Güncel geri çağırmalar (sürükleme sırasında üst bileşen yeniden çizilebilir).
  const ref = useRef(opts);
  ref.current = opts;

  const planAngle = () => (opts.frame.headingDeg + opts.frame.slewDeg) * DEG;
  const toLocal = (p: Vector3, phi: number, cx: number, cz: number) => ({
    u: (p.x - cx) * Math.cos(phi) + (p.z - cz) * Math.sin(phi),
    y: p.y,
  });

  const angle: PDown = (e) => {
    const o = ref.current;
    if (!o.onRadiusChange) return;
    const L = o.layout;
    const { cx, cz } = o.frame;
    const phi = planAngle();
    const foot = L.rig.boom.foot;
    let last = NaN;
    startDrag(e, verticalPlane(cx, cz, -Math.sin(phi), Math.cos(phi)), {
      onMove: (p) => {
        const q = toLocal(p, phi, cx, cz);
        let th = Math.atan2(q.y - foot.y, q.u - foot.x);
        th = Math.min(88 * DEG, Math.max(1 * DEG, th));
        const r = Math.max(0.1, round1(radiusForAxisAngle(L, th)));
        if (r !== last) {
          last = r;
          ref.current.onRadiusChange?.(r);
        }
      },
    });
  };

  const length: PDown = (e) => {
    const o = ref.current;
    if (!o.onBoomLengthChange) return;
    const L = o.layout;
    const { cx, cz } = o.frame;
    const phi = planAngle();
    const foot = L.rig.boom.foot;
    const th = L.rig.boom.axisAngle;
    const along = (p: Vector3) => {
      const q = toLocal(p, phi, cx, cz);
      return (q.u - foot.x) * Math.cos(th) + (q.y - foot.y) * Math.sin(th);
    };
    const lens = (o.boomLengths ?? []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    let s0 = 0;
    let last = L.boomLen;
    startDrag(e, verticalPlane(cx, cz, -Math.sin(phi), Math.cos(phi)), {
      onStart: (p) => { s0 = along(p); },
      onMove: (p) => {
        const want = L.boomLen + (along(p) - s0);
        let v: number;
        if (lens.length) v = lens.reduce((b, c) => (Math.abs(c - want) < Math.abs(b - want) ? c : b), lens[0]);
        else v = Math.max(1, round1(want));
        if (v !== last) {
          last = v;
          ref.current.onBoomLengthChange?.(v);
        }
      },
    });
  };

  const slew: PDown = (e) => {
    const o = ref.current;
    if (!o.onSlewChange) return;
    const { cx, cz, slewDeg } = o.frame;
    const ringY = o.layout.rig.carrier.deckY + 0.15;
    const psi = (p: Vector3) => Math.atan2(p.z - cz, p.x - cx) / DEG;
    let psi0 = 0;
    let last = NaN;
    startDrag(e, horizontalPlane(ringY), {
      onStart: (p) => { psi0 = psi(p); },
      onMove: (p) => {
        const v = norm360(Math.round(slewDeg + (psi(p) - psi0))) % 360;
        if (v !== last) {
          last = v;
          ref.current.onSlewChange?.(v);
        }
      },
    });
  };

  const hook: PDown = (e) => {
    const o = ref.current;
    if (!o.onLoadBottomChange) return;
    const L = o.layout;
    const { cx, cz } = o.frame;
    const phi = planAngle();
    const hx = cx + L.radius * Math.cos(phi);
    const hz = cz + L.radius * Math.sin(phi);
    // Kameraya bakan düşey düzlem (kanca noktasından geçer).
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    const nx = Math.abs(dir.x) + Math.abs(dir.z) < 1e-4 ? 1 : dir.x;
    const nz = Math.abs(dir.x) + Math.abs(dir.z) < 1e-4 ? 0 : dir.z;
    const lb0 = o.loadBottom;
    const max = L.maxLoadBottom;
    let y0 = 0;
    let last = lb0;
    startDrag(e, verticalPlane(hx, hz, nx, nz), {
      onStart: (p) => { y0 = p.y; },
      onMove: (p) => {
        const v = round1(Math.min(max, Math.max(0, lb0 + (p.y - y0))));
        if (v !== last) {
          last = v;
          ref.current.onLoadBottomChange?.(v);
        }
      },
    });
  };

  const move: PDown = (e) => {
    const o = ref.current;
    if (!o.onCranePositionChange) return;
    const { cx, cz } = o.frame;
    let p0: Vector3 | null = null;
    let lx = cx, lz = cz;
    startDrag(e, horizontalPlane(0), {
      onStart: (p) => { p0 = p.clone(); },
      onMove: (p) => {
        if (!p0) return;
        const x = round1(cx + (p.x - p0.x));
        const z = round1(cz + (p.z - p0.z));
        if (x !== lx || z !== lz) {
          lx = x; lz = z;
          ref.current.onCranePositionChange?.(x, z);
        }
      },
    });
  };

  return { angle, length, slew, hook, move };
}

// ─────────────────────────────────────────────────────────────────────────────
// Görsel tutamaçlar
// ─────────────────────────────────────────────────────────────────────────────

/** Bom açısı iletkisi — üst yapı yerel çerçevesinde (x = u) çizilir. */
export function BoomAngleGizmo({ layout: L, radiusRange, drags, lengthEnabled, angleEnabled }: {
  layout: CraneLayout;
  radiusRange?: [number, number] | null;
  drags: CraneDrags;
  angleEnabled: boolean;
  lengthEnabled: boolean;
}) {
  const { t } = useI18n();
  const u = useUnits();
  const boom = L.rig.boom;
  const f = boom.foot;
  const th = boom.axisAngle;
  const rho = Math.min(14, Math.max(3.5, L.boomLen * 0.32));
  const out = !!radiusRange && (L.radius < radiusRange[0] - 1e-6 || L.radius > radiusRange[1] + 1e-6);
  const col = out ? RED : CYAN;
  const zOff = boom.sections[0].width / 2 + 0.25; // bom yan yüzünün hemen dışında

  const arc: [number, number, number][] = [];
  for (let a = 0; a <= 90; a += 2) arc.push([f.x + rho * Math.cos(a * DEG), f.y + rho * Math.sin(a * DEG), zOff]);
  const ticks: ReactNode[] = [];
  for (let a = 0; a <= 90; a += 5) {
    const major = a % 15 === 0;
    const r0 = rho - (major ? 0.9 : 0.45);
    const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    ticks.push(
      <Line key={`t${a}`} points={[[f.x + r0 * c, f.y + r0 * s, zOff], [f.x + rho * c, f.y + rho * s, zOff]]} color={col} lineWidth={major ? 2 : 1} />,
    );
    if (major) {
      ticks.push(
        <Html key={`l${a}`} position={[f.x + (rho + 0.9) * c, f.y + (rho + 0.9) * s, zOff]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <span style={{ color: col, font: '600 10px JetBrains Mono, monospace', textShadow: '0 0 3px #000' }}>{a}°</span>
        </Html>,
      );
    }
  }
  const kx = f.x + rho * Math.cos(th), ky = f.y + rho * Math.sin(th);
  // Uzunluk tutamacı: bom ekseni ucunun biraz ötesinde, eksen yönünde koni.
  const tipExt = L.boomLen + 1.4;
  const lx = f.x + tipExt * Math.cos(th), ly = f.y + tipExt * Math.sin(th);

  return (
    <group>
      {angleEnabled && (<>
        <Line points={arc} color={col} lineWidth={2.5} />
        {ticks}
        <Line points={[[f.x, f.y, zOff], [kx, ky, zOff]]} color={col} lineWidth={1.5} dashed dashSize={0.4} gapSize={0.25} />
        <Line points={[[f.x, f.y, zOff], [f.x + rho + 1, f.y, zOff]]} color={col} lineWidth={1} />
        <Knob position={[kx, ky, zOff]} color={col} r={0.5} onPointerDown={drags.angle} />
        <Label position={[kx + 1.2, ky + 1.6, zOff]} color={col}>
          {(th / DEG).toFixed(1)}° · R {u.fmtLen(L.radius, 1)}
          {out && radiusRange && (
            <div style={{ fontWeight: 400, fontSize: 10, color: '#fca5a5' }}>
              {t('tablo dışı ({min}–{max})', { min: u.fmtLenN(radiusRange[0], 1), max: u.fmtLen(radiusRange[1], 1) })}
            </div>
          )}
        </Label>
      </>)}
      {lengthEnabled && (<>
        <group position={[lx, ly, 0]} rotation={[0, 0, th - Math.PI / 2]}>
          <mesh
            onPointerDown={drags.length}
            onPointerOver={() => { document.body.style.cursor = 'grab'; }}
            onPointerOut={() => { document.body.style.cursor = ''; }}
          >
            <coneGeometry args={[0.55, 1.4, 16]} />
            <meshBasicMaterial color="#f59e0b" />
          </mesh>
        </group>
        <Label position={[lx, ly + 1.5, 0]} color="#f59e0b">L {u.fmtLen(L.boomLen, 1)}</Label>
      </>)}
    </group>
  );
}

/** Dönme halkası — şasi çerçevesinde (heading dahil, slew hariç). */
export function SlewRingGizmo({ layout: L, slewDeg, drags }: { layout: CraneLayout; slewDeg: number; drags: CraneDrags }) {
  const y = L.rig.carrier.deckY + 0.15;
  const R = L.rig.dims.tail_radius_m + 1.4;
  const a = slewDeg * DEG;
  const ticks: ReactNode[] = [];
  for (let d = 0; d < 360; d += 15) {
    const major = d % 90 === 0;
    const c = Math.cos(d * DEG), s = Math.sin(d * DEG);
    const r0 = R - (major ? 0.8 : 0.4);
    ticks.push(<Line key={d} points={[[r0 * c, y, r0 * s], [R * c, y, R * s]]} color={CYAN} lineWidth={major ? 2 : 1} />);
  }
  const { t } = useI18n();
  const names: Array<[number, string]> = [[0, t('Arka 0°')], [90, '90°'], [180, t('Ön 180°')], [270, '270°']];
  return (
    <group>
      <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} onPointerDown={drags.slew}
        onPointerOver={() => { document.body.style.cursor = 'grab'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}>
        <torusGeometry args={[R, 0.18, 10, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.85} />
      </mesh>
      {ticks}
      {names.map(([d, nm]) => (
        <Html key={d} position={[(R + 1.3) * Math.cos(d * DEG), y, (R + 1.3) * Math.sin(d * DEG)]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <span style={{ color: '#9ecfe0', font: '600 10px JetBrains Mono, monospace', textShadow: '0 0 3px #000' }}>{nm}</span>
        </Html>
      ))}
      <Line points={[[0, y, 0], [R * Math.cos(a), y, R * Math.sin(a)]]} color={CYAN} lineWidth={1.5} dashed dashSize={0.4} gapSize={0.25} />
      <Knob position={[R * Math.cos(a), y, R * Math.sin(a)]} color="#fde047" r={0.55} onPointerDown={drags.slew} />
      <Label position={[(R + 1.6) * Math.cos(a), y + 1.2, (R + 1.6) * Math.sin(a)]}>{t('Dönme {deg}°', { deg: Math.round(slewDeg) })}</Label>
    </group>
  );
}

/** Kanca tutamacı — üst yapı yerel çerçevesinde. */
export function HookGizmo({ layout: L, drags }: { layout: CraneLayout; drags: CraneDrags }) {
  const { t } = useI18n();
  const u = useUnits();
  const x = L.radius;
  const yTop = L.hk.top + 0.9;
  const yBot = L.loadY0 - 0.9;
  return (
    <group>
      <mesh position={[x, yTop, 0]} onPointerDown={drags.hook}>
        <coneGeometry args={[0.45, 0.9, 14]} />
        <meshBasicMaterial color={CYAN} />
      </mesh>
      <mesh position={[x, Math.max(0.5, yBot), 0]} rotation={[Math.PI, 0, 0]} onPointerDown={drags.hook}>
        <coneGeometry args={[0.45, 0.9, 14]} />
        <meshBasicMaterial color={CYAN} />
      </mesh>
      <Line points={[[x + L.loadD / 2 + 0.6, 0, 0], [x + L.loadD / 2 + 0.6, L.loadY0, 0]]} color={CYAN} lineWidth={1} dashed dashSize={0.3} gapSize={0.2} />
      <Label position={[x + L.loadD / 2 + 2.2, L.loadY0 + L.loadH / 2, 0]}>
        {t('Yük alt kotu {len}', { len: u.fmtLen(L.loadY0, 1) })}
        <div style={{ fontWeight: 400, fontSize: 10, color: '#9ecfe0' }}>{t('maks {len}', { len: u.fmtLen(L.maxLoadBottom, 1) })}</div>
      </Label>
    </group>
  );
}

/** Konum tutamacı — şasi çerçevesinde zemin halkası + oklar. */
export function MoveGizmo({ layout: L, frame, drags }: { layout: CraneLayout; frame: CraneFrame; drags: CraneDrags }) {
  const u = useUnits();
  const pads = L.rig.outriggers.pads;
  const R = Math.max(...pads.map((p) => Math.hypot(p.x, p.z))) + 1.2;
  const arrows = [0, 90, 180, 270];
  return (
    <group>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={drags.move}
        onPointerOver={() => { document.body.style.cursor = 'move'; }}
        onPointerOut={() => { document.body.style.cursor = ''; }}>
        <ringGeometry args={[R - 0.5, R, 72]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={drags.move}>
        <circleGeometry args={[R - 0.5, 48]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.08} depthWrite={false} />
      </mesh>
      {arrows.map((d) => (
        <mesh key={d} position={[(R + 0.8) * Math.cos(d * DEG), 0.05, (R + 0.8) * Math.sin(d * DEG)]}
          rotation={[0, -d * DEG, -Math.PI / 2]} onPointerDown={drags.move}>
          <coneGeometry args={[0.5, 1.1, 12]} />
          <meshBasicMaterial color={CYAN} />
        </mesh>
      ))}
      <Label position={[0, L.rig.carrier.deckY + 3, 0]}>
        X {u.fmtLenN(frame.cx, 1)} · Z {u.fmtLen(frame.cz, 1)}
      </Label>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Çevre nesnesi: taşıma (zemin düzlemi) + döndürme (halka tutamacı)
// ─────────────────────────────────────────────────────────────────────────────
export function useObjectDrags(onObjectChange?: (o: SceneObject) => void) {
  const startDrag = useDragOnPlane();
  const cb = useRef(onObjectChange);
  cb.current = onObjectChange;

  const move = (e: ThreeEvent<PointerEvent>, o: SceneObject) => {
    if (!cb.current) return;
    let p0: Vector3 | null = null;
    let lx = o.x, lz = o.z;
    startDrag(e, horizontalPlane(0), {
      onStart: (p) => { p0 = p.clone(); },
      onMove: (p) => {
        if (!p0) return;
        const x = round1(o.x + (p.x - p0.x));
        const z = round1(o.z + (p.z - p0.z));
        if (x !== lx || z !== lz) {
          lx = x; lz = z;
          cb.current?.({ ...o, x, z });
        }
      },
    });
  };

  const rotate = (e: ThreeEvent<PointerEvent>, o: SceneObject) => {
    if (!cb.current) return;
    const psi = (p: Vector3) => Math.atan2(p.z - o.z, p.x - o.x) / DEG;
    let psi0 = 0;
    const r0 = o.rotationY ?? 0;
    let last = r0;
    startDrag(e, horizontalPlane(Math.max(0, o.y ?? 0)), {
      onStart: (p) => { psi0 = psi(p); },
      onMove: (p) => {
        // three rotation.y = θ yerel +X'i plan açısı −θ'ya götürür → işaret ters.
        const v = norm360(Math.round(r0 - (psi(p) - psi0))) % 360;
        if (v !== last) {
          last = v;
          cb.current?.({ ...o, rotationY: v });
        }
      },
    });
  };

  return { move, rotate };
}

export function ObjectGizmo({ o, onRotateDown }: { o: SceneObject; onRotateDown: PDown }) {
  const u = useUnits();
  const w = Math.max(0.1, o.width), d = Math.max(0.1, o.depth), h = Math.max(0.1, o.height);
  const baseY = Math.max(0, o.y ?? 0);
  const rot = (o.rotationY ?? 0) * DEG;
  const R = Math.hypot(w, d) / 2 + 1;
  // Tutamaç nesnenin yerel +X yönünde: three rotation.y = rot → (cos rot, −sin rot)
  const kx = o.x + R * Math.cos(rot), kz = o.z - R * Math.sin(rot);
  const hw = w / 2 + 0.05, hd = d / 2 + 0.05;
  const y1 = baseY + h + 0.05;
  const box: [number, number, number][] = [
    [-hw, baseY, -hd], [hw, baseY, -hd], [hw, baseY, hd], [-hw, baseY, hd], [-hw, baseY, -hd],
    [-hw, y1, -hd], [hw, y1, -hd], [hw, y1, hd], [-hw, y1, hd], [-hw, y1, -hd],
  ];
  return (
    <group onClick={(e) => e.stopPropagation()}>
      <group position={[o.x, 0, o.z]} rotation={[0, rot, 0]}>
        <Line points={box} color="#fde047" lineWidth={2} />
        <Line points={[[hw, y1, -hd], [hw, baseY, -hd]]} color="#fde047" lineWidth={2} />
        <Line points={[[hw, y1, hd], [hw, baseY, hd]]} color="#fde047" lineWidth={2} />
        <Line points={[[-hw, y1, hd], [-hw, baseY, hd]]} color="#fde047" lineWidth={2} />
      </group>
      <mesh position={[o.x, baseY + 0.04, o.z]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onRotateDown}>
        <ringGeometry args={[R - 0.18, R + 0.18, 64]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.7} />
      </mesh>
      <Knob position={[kx, baseY + 0.3, kz]} color="#fde047" r={0.45} onPointerDown={onRotateDown} />
      <Label position={[o.x, baseY + h + 1.4, o.z]} color="#fde047">
        {o.label} · X {u.fmtLenN(o.x, 1)} Z {u.fmtLen(o.z, 1)} · {Math.round(o.rotationY ?? 0)}°
      </Label>
    </group>
  );
}

/**
 * Crane3D.tsx — Parametric 3D crane visualisation + doğrudan manipülasyon.
 * Stack: @react-three/fiber 8.17, @react-three/drei 9, three 0.169, react 18.
 *
 * Y is UP · dünya = SAHA çerçevesi (x, z). Ground plane sits at y = 0.
 * Vinç slew merkezi sahada (craneX, craneZ); vinç yönü h (°) tüm vinci (şasi +
 * üst yapı) planda döndürür; bom plan açısı = h + slew. Plan (x, z) = three (x, z);
 * plan açısı a → three rotation.y = −a (ayna konvansiyonu).
 * Çevre nesneleri (SceneObject x, z) saha çerçevesindedir.
 *
 * Vinç çizimi: three/CraneBody.tsx (ana vinç + tandem 2. vinç ortak).
 * Etkileşim tutamaçları: three/Gizmos.tsx · kamera ön ayarları: three/CameraController.tsx.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, useGLTF, Html, Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Box3, Vector3, type WebGLRenderer } from 'three';
import type { CraneModel, SceneObject, SceneObjectKind } from '../engine/types';
import type { RiggingItem } from './state';
import CraneBody from './three/CraneBody';
import { computeCraneLayout, powerlineMargin, safe, safePos, DEG, type CraneLayout } from './three/craneLayout';
import {
  BoomAngleGizmo, HookGizmo, Label, MoveGizmo, ObjectGizmo, SlewRingGizmo,
  useCraneDrags, useObjectDrags, type CraneFrame,
} from './three/Gizmos';
import CameraController, { type CamCommand, type CamView } from './three/CameraController';
import { useI18n } from './i18n';
import { useUnits } from './units';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
export interface SecondCrane {
  crane: CraneModel;
  boomLength: number;
  radius: number;
  gama: number;
  slewAngleDeg: number;
  heading: number;
  x: number;
  z: number;
  counterweight: number;
  outrigger: { Lx: number; Ly: number };
}

export interface LiftPath3D {
  points: Array<[number, number, number]>;
  critical?: [number, number, number] | null;
}

export interface Crane3DProps {
  boomLength: number;          // m
  radius: number;              // m, horizontal distance slew-center → hook
  boomOffset: number;          // m, horizontal offset slew center → boom foot
  machineGroundHeight: number; // m, boom foot height above ground
  cribbingHeight: number;      // m
  gama: number;                // mafsal→makara doğrusu açısı (RAD, motor γ)
  slewAngleDeg: number;        // üst yapı dönüşü (şasiye göre), 0 = bom +X (arka)
  loadHeight: number;          // m
  loadDiameter: number;        // m
  obstacleHeight: number;      // m
  obstacleDistance: number;    // m horizontal position of obstacle from load
  obstacleWidth?: number;      // m obstacle width (drawing only)
  outrigger: { Lx: number; Ly: number }; // outrigger span (m)
  clearanceWarning?: boolean;  // if true tint boom/load red
  objects?: SceneObject[];     // environment objects (nesne kütüphanesi), SAHA çerçevesi
  collidingIds?: string[];     // çakışan nesne id'leri → kırmızı tint
  loadDiameterReal?: number;   // gerçek yük çapı (sapan çizimi için)
  crane: CraneModel;           // vinç verisi → gerçek ölçülü şasi/üst yapı/bom (craneRig)
  counterweight: number;       // t — denge plakası yığını
  falls?: number;              // halat donanımı kol sayısı
  heading?: number;            // ° — şasi arkasının (+X) plan açısı (vinç yönü)
  riggingHeight?: number;      // m — aparat yüksekliği (kanca ↔ yük arası)
  riggingItems?: RiggingItem[]; // aparat listesi (kancadan aşağı)
  jib?: { jib_length: number; jib_offset: number } | null; // jib modu → bom+jib çizimi

  // ── Saha konumu + doğrudan manipülasyon ──────────────────────────────────
  craneX?: number;             // slew merkezinin saha X'i (m)
  craneZ?: number;             // slew merkezinin saha Z'si (m)
  loadBottomHeight?: number;   // kaldırma durumu: yük alt kotu (m); yoksa obstacleHeight
  onRadiusChange?: (r: number) => void;          // bom açısı iletkisi
  onBoomLengthChange?: (L: number) => void;      // bom ucu sürükleme (boomLengths'e yapışır)
  boomLengths?: number[];                        // mevcut bom uzunlukları
  radiusRange?: [number, number] | null;         // geçerli tablo radius aralığı → dışında kırmızı
  onSlewChange?: (deg: number) => void;          // dönme halkası (şasiye göre, 0..360)
  onLoadBottomChange?: (h: number) => void;      // kanca yukarı/aşağı
  onCranePositionChange?: (x: number, z: number) => void; // vinci zeminde taşı
  onObjectChange?: (o: SceneObject) => void;     // nesneyi taşı/döndür
  powerlineEnvelopes?: boolean;                  // enerji hattı emniyet zarfı
  secondCrane?: SecondCrane | null;              // tandem: 2. vinç
  liftPath?: LiftPath3D | null;                  // kanca yolu (saha çerçevesi) + kritik nokta
}

// ─────────────────────────────────────────────────────────────────────────────
// İçe aktarılmış 3B model (glTF/GLB) — drei useGLTF ile yüklenir, sınırlayıcı
// kutuya (width×depth×height) sığacak şekilde tek tip ölçeklenir ve tabanı yere
// oturacak biçimde konumlanır.
// ─────────────────────────────────────────────────────────────────────────────
interface GltfModelProps {
  url: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationY: number; // derece
  baseY: number; // taban kotu, zeminden yükseklik (m) — ör. asılı enerji hattı
  hit: boolean;
}

function GltfModel({ url, x, z, width, depth, height, rotationY, baseY, hit }: GltfModelProps) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  const { scale, offset } = useMemo(() => {
    const box = new Box3().setFromObject(cloned);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const sx = size.x > 1e-6 ? width / size.x : 1;
    const sy = size.y > 1e-6 ? height / size.y : 1;
    const sz = size.z > 1e-6 ? depth / size.z : 1;
    const s = Math.min(sx, sy, sz); // tek tip ölçek — modeli kutuya sığdır
    return {
      scale: s,
      offset: new Vector3(-center.x * s, -box.min.y * s, -center.z * s),
    };
  }, [cloned, width, depth, height]);

  return (
    <group position={[x, baseY, z]} rotation={[0, (rotationY * Math.PI) / 180, 0]}>
      <group position={offset.toArray()} scale={scale}>
        <primitive object={cloned} />
      </group>
      {hit && (
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color="#ef4444" transparent opacity={0.3} />
        </mesh>
      )}
    </group>
  );
}

/** Model yüklenemezse (bozuk/eksik dosya) sahneyi çökertmeden yedek gösterir. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Etkileşim modları
// ─────────────────────────────────────────────────────────────────────────────
export type InteractionMode = 'orbit' | 'boom' | 'slew' | 'hook' | 'move' | 'object';

const noRaycast = () => null;

/** Üst yapı yerel (u, y) → dünya. */
function toWorld(f: CraneFrame, u: number, y: number): [number, number, number] {
  const phi = (f.headingDeg + f.slewDeg) * DEG;
  return [f.cx + u * Math.cos(phi), y, f.cz + u * Math.sin(phi)];
}

/** Kadraj noktaları: slew merkezi, ayak uçları, bom ucu, kanca/yük. */
function framePoints(L: CraneLayout, f: CraneFrame): Array<[number, number, number]> {
  const h = f.headingDeg * DEG;
  const pads = L.rig.outriggers.pads.map((p): [number, number, number] => [
    f.cx + p.x * Math.cos(h) - p.z * Math.sin(h), 0, f.cz + p.x * Math.sin(h) + p.z * Math.cos(h),
  ]);
  return [
    [f.cx, 0, f.cz],
    ...pads,
    toWorld(f, L.rig.boom.tip.x, L.rig.boom.tip.y),
    toWorld(f, L.tip.x, L.tip.y),
    toWorld(f, L.radius, 0),
    toWorld(f, -L.rig.dims.tail_radius_m, 0),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CraneScene — all 3D geometry; must be rendered inside a <Canvas>
// ─────────────────────────────────────────────────────────────────────────────
interface SceneExtra {
  measure?: MeasureState;
  mode: InteractionMode;
  setMode: (m: InteractionMode) => void;
  camCmd: CamCommand | null;
  initialTarget: [number, number, number];
}

function CraneScene(props: Crane3DProps & SceneExtra) {
  const { t } = useI18n();
  const u = useUnits();
  const {
    crane, clearanceWarning = false, objects = [], collidingIds = [], heading = 0,
    riggingItems, measure, mode, setMode, camCmd, initialTarget,
    radiusRange, boomLengths, powerlineEnvelopes = false, secondCrane = null, liftPath = null,
    onRadiusChange, onBoomLengthChange, onSlewChange, onLoadBottomChange, onCranePositionChange, onObjectChange,
  } = props;

  // ── Ana vinç yerleşimi ─────────────────────────────────────────────────────
  const L = computeCraneLayout({
    crane,
    boomLength: props.boomLength,
    radius: props.radius,
    gama: props.gama,
    slewAngleDeg: props.slewAngleDeg,
    loadHeight: props.loadHeight,
    loadDiameter: props.loadDiameter,
    obstacleHeight: props.obstacleHeight,
    loadBottomHeight: props.loadBottomHeight,
    outrigger: props.outrigger,
    counterweight: props.counterweight,
    jib: props.jib,
    riggingHeight: props.riggingHeight,
  });
  const frame: CraneFrame = {
    cx: safe(props.craneX ?? 0, 0),
    cz: safe(props.craneZ ?? 0, 0),
    headingDeg: safe(heading, 0),
    slewDeg: safe(props.slewAngleDeg, 0),
  };

  const drags = useCraneDrags({
    layout: L,
    frame,
    loadBottom: L.loadY0,
    boomLengths,
    onRadiusChange,
    onBoomLengthChange,
    onSlewChange,
    onLoadBottomChange,
    onCranePositionChange,
  });
  const objDrags = useObjectDrags(onObjectChange);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = mode === 'object' ? objects.find((o) => o.id === selectedId) ?? null : null;

  // ── 2. vinç (tandem) ───────────────────────────────────────────────────────
  const L2 = secondCrane
    ? computeCraneLayout({
      crane: secondCrane.crane,
      boomLength: secondCrane.boomLength,
      radius: secondCrane.radius,
      gama: secondCrane.gama,
      slewAngleDeg: secondCrane.slewAngleDeg,
      loadHeight: L.loadH,
      loadDiameter: L.loadD,
      loadBottomHeight: L.loadY0,
      outrigger: secondCrane.outrigger,
      counterweight: secondCrane.counterweight,
      riggingHeight: props.riggingHeight,
    })
    : null;
  const frame2: CraneFrame | null = secondCrane
    ? { cx: safe(secondCrane.x, 0), cz: safe(secondCrane.z, 0), headingDeg: safe(secondCrane.heading, 0), slewDeg: safe(secondCrane.slewAngleDeg, 0) }
    : null;

  // ── Kamera kadrajı ─────────────────────────────────────────────────────────
  const camPoints = [
    ...framePoints(L, frame),
    ...(L2 && frame2 ? framePoints(L2, frame2) : []),
    ...(liftPath?.points ?? []),
  ];

  // ── Çevre nesneleri renkleri ────────────────────────────────────────────────
  const collSet = new Set(collidingIds);
  const objColor = (kind: SceneObjectKind, hit: boolean): string => {
    if (hit) return '#ef4444';
    switch (kind) {
      case 'building': return '#475569';
      case 'truck': return '#6d28d9';
      case 'person': return '#10b981';
      case 'powerline': return '#eab308';
      default: return '#64748b';
    }
  };

  // Ölçüm modu: sahnedeki ilk isabet noktası (zemin/vinç/nesne) alınır. Sürükleme
  // (kamera döndürme) tıklama sayılmaz (delta eşiği).
  const onPick = (e: ThreeEvent<MouseEvent>) => {
    if (!measure?.active || e.delta > 4) return;
    e.stopPropagation();
    measure.add([e.point.x, e.point.y, e.point.z]);
  };

  const headingRad = frame.headingDeg * DEG;
  const boomMode = mode === 'boom' && (!!onRadiusChange || !!onBoomLengthChange);

  return (
    <group onClick={onPick}>
      {/* ── Işık ─────────────────────────────────────────────────────────── */}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#dbe8ff', '#1a2433', 0.45]} />
      <directionalLight position={[35, 60, 25]} intensity={1.25} />
      <directionalLight position={[-25, 20, -30]} intensity={0.35} color="#93c5fd" />

      {/* ── Zemin ────────────────────────────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
        onClick={(e) => { if (mode === 'object' && e.delta <= 4 && !measure?.active) setSelectedId(null); }}
      >
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#1b2633" roughness={1} />
      </mesh>
      <gridHelper args={[200, 100, '#3b4c61', '#253244']} position={[0, 0, 0]} />

      {/* ── ANA VİNÇ: sahada (craneX, craneZ) + yön. Plan açısı h → rotation.y = −h ── */}
      <group
        position={[frame.cx, 0, frame.cz]}
        rotation={[0, -headingRad, 0]}
        onPointerDown={mode === 'move' && onCranePositionChange ? drags.move : undefined}
      >
        <CraneBody
          layout={L}
          clearanceWarning={clearanceWarning}
          falls={props.falls}
          riggingItems={riggingItems}
          obstacleHeight={props.obstacleHeight}
          obstacleDistance={props.obstacleDistance}
          obstacleWidth={props.obstacleWidth}
          boomHighlight={boomMode}
          onBoomPointerDown={boomMode && onRadiusChange ? drags.angle : undefined}
          onBoomClick={mode === 'orbit' && (onRadiusChange || onBoomLengthChange) && !measure?.active
            ? (e) => { if (e.delta <= 4) { e.stopPropagation(); setMode('boom'); } }
            : undefined}
          onHookPointerDown={mode === 'hook' && onLoadBottomChange ? drags.hook : undefined}
          carrierChildren={<>
            {mode === 'slew' && onSlewChange && <SlewRingGizmo layout={L} slewDeg={frame.slewDeg} drags={drags} />}
            {mode === 'move' && onCranePositionChange && <MoveGizmo layout={L} frame={frame} drags={drags} />}
          </>}
          superChildren={<>
            {boomMode && (
              <BoomAngleGizmo layout={L} radiusRange={radiusRange} drags={drags}
                angleEnabled={!!onRadiusChange} lengthEnabled={!!onBoomLengthChange} />
            )}
            {mode === 'hook' && onLoadBottomChange && <HookGizmo layout={L} drags={drags} />}
          </>}
        />
      </group>

      {/* ── 2. VİNÇ (tandem) ─────────────────────────────────────────────── */}
      {L2 && frame2 && (
        <group position={[frame2.cx, 0, frame2.cz]} rotation={[0, -frame2.headingDeg * DEG, 0]}>
          <CraneBody layout={L2} showLoad={false} tint="#60a5fa" />
          <Label position={[0, L2.topExtent + 2.5, 0]} color="#60a5fa">{t('Vinç 2')}</Label>
        </group>
      )}

      {/* ── Kaldırma yolu + kritik nokta ─────────────────────────────────── */}
      {liftPath && liftPath.points.length >= 2 && (
        <group raycast={noRaycast}>
          <Line points={liftPath.points} color="#a78bfa" lineWidth={2.5} dashed dashSize={0.8} gapSize={0.4} />
          {[liftPath.points[0], liftPath.points[liftPath.points.length - 1]].map((p, i) => (
            <mesh key={i} position={p} raycast={noRaycast}>
              <sphereGeometry args={[0.35, 14, 10]} />
              <meshBasicMaterial color="#a78bfa" />
            </mesh>
          ))}
          {liftPath.critical && (<>
            <mesh position={liftPath.critical} raycast={noRaycast}>
              <sphereGeometry args={[0.55, 16, 12]} />
              <meshBasicMaterial color="#ef4444" />
            </mesh>
            <Label position={[liftPath.critical[0], liftPath.critical[1] + 1.4, liftPath.critical[2]]} color="#ef4444">
              {t('Kritik nokta')}
            </Label>
          </>)}
        </group>
      )}

      {/* ── Ölçüm aracı: iki nokta arası mesafe ─────────────────────────────── */}
      {measure && <MeasureOverlay m={measure} />}

      {/* ── Çevre nesneleri (saha çerçevesi) ─────────────────────────────── */}
      {objects.map((o) => {
        const hit = collSet.has(o.id);
        const w = safePos(o.width, 1);
        const d = safePos(o.depth, 1);
        const hgt = safePos(o.height, 1);
        const ox = safe(o.x, 0);
        const oz = safe(o.z, 0);
        const rotY = safe(o.rotationY ?? 0, 0);
        const baseY = Math.max(0, safe(o.y ?? 0, 0));
        const interactive = mode === 'object' && !!onObjectChange && !measure?.active;

        const boxMesh = (
          <mesh position={[ox, baseY + hgt / 2, oz]} rotation={[0, (rotY * Math.PI) / 180, 0]}>
            <boxGeometry args={[w, hgt, d]} />
            <meshStandardMaterial
              color={objColor(o.kind, hit)}
              metalness={0.2}
              roughness={0.8}
              transparent
              opacity={hit ? 0.85 : 0.7}
            />
          </mesh>
        );

        const body = o.kind === 'model' && o.modelUrl ? (
          <ModelBoundary fallback={boxMesh}>
            <Suspense fallback={boxMesh}>
              <GltfModel url={o.modelUrl} x={ox} z={oz} width={w} depth={d} height={hgt} rotationY={rotY} baseY={baseY} hit={hit} />
            </Suspense>
          </ModelBoundary>
        ) : boxMesh;

        return (
          <group
            key={o.id}
            onPointerDown={interactive ? (e) => { setSelectedId(o.id); objDrags.move(e, o); } : undefined}
            onClick={interactive ? (e) => e.stopPropagation() : undefined}
          >
            {body}
          </group>
        );
      })}

      {/* ── Enerji hattı emniyet zarfları ────────────────────────────────── */}
      {powerlineEnvelopes && objects.filter((o) => o.kind === 'powerline').map((o) => {
        const m = powerlineMargin(o.voltage_kv);
        const w = safePos(o.width, 1) + 2 * m;
        const d = safePos(o.depth, 1) + 2 * m;
        const baseY = Math.max(0, safe(o.y ?? 0, 0));
        const y0 = Math.max(0, baseY - m);
        const y1 = baseY + safePos(o.height, 1) + m;
        return (
          <group key={`env-${o.id}`}>
            <mesh
              position={[safe(o.x, 0), (y0 + y1) / 2, safe(o.z, 0)]}
              rotation={[0, (safe(o.rotationY ?? 0, 0) * Math.PI) / 180, 0]}
              raycast={noRaycast}
              renderOrder={2}
            >
              <boxGeometry args={[w, Math.max(0.1, y1 - y0), d]} />
              <meshBasicMaterial color="#f97316" transparent opacity={0.13} depthWrite={false} />
              <Edges color="#fb923c" />
            </mesh>
            <Label position={[safe(o.x, 0), y1 + 0.8, safe(o.z, 0)]} color="#fb923c">
              {t('Emniyet {len}', { len: u.fmtLen(m) })}{o.voltage_kv != null ? ` · ${o.voltage_kv} kV` : ''}
            </Label>
          </group>
        );
      })}

      {/* ── Seçili nesne tutamaçları ─────────────────────────────────────── */}
      {selected && onObjectChange && (
        <ObjectGizmo o={selected} onRotateDown={(e) => objDrags.rotate(e, selected)} />
      )}

      {/* ── Kamera ─────────────────────────────────────────────────────────── */}
      <OrbitControls makeDefault target={initialTarget} />
      <CameraController cmd={camCmd} frame={{ points: camPoints, headingDeg: frame.headingDeg }} />
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ölçüm aracı (Crane Planner "measuring"): iki nokta arası 3B mesafe + yatay /
// düşey bileşenler. Üçüncü tık yeni ölçüme başlar.
// ─────────────────────────────────────────────────────────────────────────────
type P3 = [number, number, number];
export interface MeasureState {
  active: boolean;
  points: P3[];
  add: (p: P3) => void;
}

function MeasureOverlay({ m }: { m: MeasureState }) {
  const { t } = useI18n();
  const u = useUnits();
  const [a, b] = m.points;
  return (
    <>
      {m.points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.18, 14, 10]} />
          <meshBasicMaterial color="#22d3ee" />
        </mesh>
      ))}
      {a && b && (() => {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const d = Math.hypot(dx, dy, dz);
        const h = Math.hypot(dx, dz);
        const sub = t('yatay {h} · düşey {v}', { h: u.fmtLenN(h), v: `${dy >= 0 ? '+' : ''}${u.fmtLenN(dy)}` });
        const main = u.fmtLen(d);
        const mid: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return (
          <>
            <Line points={[a, b]} color="#22d3ee" lineWidth={2.5} />
            <Line points={[a, [b[0], a[1], b[2]], b]} color="#22d3ee" lineWidth={1} dashed dashSize={0.4} gapSize={0.3} />
            <Html position={mid} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(8,18,32,.92)', border: '1px solid #22d3ee', borderRadius: 6,
                padding: '4px 8px', color: '#e6f6fb', font: '600 12px/1.35 JetBrains Mono, monospace', whiteSpace: 'nowrap',
              }}>
                {main}
                <div style={{ fontWeight: 400, fontSize: 10.5, color: '#9ecfe0' }}>
                  {sub}
                </div>
              </div>
            </Html>
          </>
        );
      })()}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Araç çubuğu düğmesi (Ölç düğmesiyle aynı stil)
// ─────────────────────────────────────────────────────────────────────────────
function ToolBtn({ active = false, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 'auto', margin: 0, lineHeight: 1.2,
        padding: '5px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
        background: active ? '#22d3ee' : 'rgba(8,18,32,.85)', color: active ? '#04121a' : '#cfe3f2',
        border: '1px solid #2b4a66', fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

const MODE_HINT: Record<InteractionMode, string> = {
  orbit: '',
  boom: 'Açı: iletki tutamacını veya bomu sürükleyin · Uzunluk: bom ucundaki turuncu oku sürükleyin',
  slew: 'Halkayı veya sarı tutamacı sürükleyerek üst yapıyı döndürün',
  hook: 'Kancayı / yükü yukarı-aşağı sürükleyin',
  move: 'Vinci zeminde sürükleyerek taşıyın',
  object: 'Nesneye tıklayıp sürükleyin · sarı halka ile döndürün',
};

// ─────────────────────────────────────────────────────────────────────────────
// Default export — wraps scene in a Canvas that fills its parent
// ─────────────────────────────────────────────────────────────────────────────
export default function Crane3D(props: Crane3DProps) {
  const { t } = useI18n();
  const cx = safe(props.craneX ?? 0, 0);
  const cz = safe(props.craneZ ?? 0, 0);
  // Scale initial camera distance to the crane's approximate envelope.
  // Jib modunda bom neredeyse dikey (yükseklik ≈ boomLength) → kamerayı yukarı al.
  const safeBL = safePos(props.boomLength, 20);
  const safeR = safePos(props.radius, 10);
  const jibTall = !!props.jib && props.jib.jib_length > 0;
  const span = Math.max(safeBL, safeR * 1.5, 14) * (jibTall ? 1.55 : 1.35);
  const camPos: [number, number, number] = jibTall
    ? [cx + span * 0.75, span * 0.95, cz + span * 1.0]
    : [cx + span * 0.9, span * 0.7, cz + span * 1.05];
  // İlk hedef — sabit dizi (her çizimde kamerayı sıfırlamasın).
  const [initialTarget] = useState<[number, number, number]>(() => [cx, Math.min(Math.max(safeBL * 0.3, 4), 50), cz]);

  const [measuring, setMeasuring] = useState(false);
  const [points, setPoints] = useState<P3[]>([]);
  const measure: MeasureState = {
    active: measuring,
    points,
    add: (p) => setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p])),
  };

  const [mode, setModeRaw] = useState<InteractionMode>('orbit');
  const setMode = (m: InteractionMode) => {
    setModeRaw(m);
    if (m !== 'orbit') { setMeasuring(false); setPoints([]); }
  };
  const [camCmd, setCamCmd] = useState<CamCommand | null>(null);
  const cam = (view: CamView) => setCamCmd((c) => ({ view, n: (c?.n ?? 0) + 1 }));
  const glRef = useRef<WebGLRenderer | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModeRaw('orbit');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveImage = () => {
    const gl = glRef.current;
    if (!gl) return;
    try {
      const url = gl.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      a.href = url;
      a.download = `vinc-3b-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* güvenlik kısıtı (tainted canvas) — sessizce yoksay */
    }
  };

  const modes: Array<{ m: InteractionMode; label: string; title: string; show: boolean }> = [
    { m: 'orbit', label: `↔ ${t('Seç/Taşı')}`, title: t('Kamerayı döndür / kaydır (Esc)'), show: true },
    { m: 'boom', label: `📐 ${t('Bom açısı')}`, title: t('Bom açısı (radius) ve bom uzunluğunu sürükleyerek değiştirin'), show: !!(props.onRadiusChange || props.onBoomLengthChange) },
    { m: 'slew', label: `⟳ ${t('Dönme')}`, title: t('Üst yapıyı döndürün'), show: !!props.onSlewChange },
    { m: 'hook', label: `⇕ ${t('Kanca')}`, title: t('Kanca / yük yüksekliği'), show: !!props.onLoadBottomChange },
    { m: 'move', label: `✥ ${t('Konum')}`, title: t('Vinci sahada taşıyın'), show: !!props.onCranePositionChange },
    { m: 'object', label: `▣ ${t('Nesne')}`, title: t('Çevre nesnelerini taşıyın / döndürün'), show: !!props.onObjectChange },
  ];
  const views: Array<{ v: CamView; label: string }> = [
    { v: 'top', label: t('Üst') },
    { v: 'front', label: t('Ön') },
    { v: 'side', label: t('Yan') },
    { v: 'iso', label: t('İzometrik') },
    { v: 'fit', label: t('Sığdır') },
  ];
  const hint = MODE_HINT[mode] ? t(MODE_HINT[mode]) : '';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        style={{ width: '100%', height: '100%', cursor: measuring ? 'crosshair' : undefined }}
        camera={{ position: camPos, fov: 45, near: 0.1, far: 2000 }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => { glRef.current = gl; }}
      >
        <color attach="background" args={['#0f172a']} />
        <CraneScene {...props} measure={measure} mode={mode} setMode={setMode} camCmd={camCmd} initialTarget={initialTarget} />
      </Canvas>

      {/* Sol üst: ölçüm + etkileşim modları */}
      <div style={{ position: 'absolute', top: 10, left: 10, right: 290, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'auto', width: 'fit-content' }}>
          <ToolBtn
            active={measuring}
            onClick={() => { setMeasuring((v) => !v); setPoints([]); setModeRaw('orbit'); }}
            title={t('İki noktaya tıklayarak mesafe ölçün')}
          >
            📏 {measuring ? t('Ölçüm açık') : t('Ölç')}
          </ToolBtn>
          {modes.filter((x) => x.show).map((x) => (
            <ToolBtn key={x.m} active={mode === x.m && !measuring} onClick={() => setMode(x.m)} title={x.title}>
              {x.label}
            </ToolBtn>
          ))}
        </div>
        {(measuring || hint) && (
          <span style={{ fontSize: 11.5, color: '#9ecfe0', background: 'rgba(8,18,32,.8)', padding: '3px 8px', borderRadius: 5, width: 'fit-content' }}>
            {measuring
              ? (points.length === 0 ? t('1. noktaya tıklayın') : points.length === 1 ? t('2. noktaya tıklayın') : t('Yeni ölçüm için tıklayın'))
              : hint}
          </span>
        )}
      </div>

      {/* Sağ üst: kamera ön ayarları + görüntü kaydet */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 280 }}>
        {views.map((x) => (
          <ToolBtn key={x.v} onClick={() => cam(x.v)} title={t('Kamera: {view}', { view: x.label })}>{x.label}</ToolBtn>
        ))}
        <ToolBtn onClick={saveImage} title={t('3B görünümü PNG olarak kaydet')}>📷 {t('Görüntü')}</ToolBtn>
      </div>
    </div>
  );
}

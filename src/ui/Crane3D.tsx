/**
 * Crane3D.tsx — Parametric 3D crane visualisation.
 * Stack: @react-three/fiber 8.17, @react-three/drei 9.114, three 0.169, react 18.
 *
 * Y is UP  ·  X is the boom-luffing-plane horizontal axis  ·  Z is lateral.
 * Ground plane sits at y = 0.
 */
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import type { CraneDimensions, SceneObject, SceneObjectKind } from '../engine/types';
import { jibGeometry } from './craneGeometry';

// ─────────────────────────────────────────────────────────────────────────────
// Props interface (verbatim from specification)
// ─────────────────────────────────────────────────────────────────────────────
export interface Crane3DProps {
  boomLength: number;          // m
  radius: number;              // m, horizontal distance slew-center → hook
  boomOffset: number;          // m, horizontal offset slew center → boom foot
  machineGroundHeight: number; // m, boom foot height above ground
  cribbingHeight: number;      // m
  gama: number;                // boom elevation angle in RADIANS (already computed)
  slewAngleDeg: number;        // superstructure rotation, 0 = boom points to +X (rear)
  loadHeight: number;          // m
  loadDiameter: number;        // m
  obstacleHeight: number;      // m
  obstacleDistance: number;    // m horizontal position of obstacle from load
  obstacleWidth?: number;      // m obstacle width (drawing only)
  outrigger: { Lx: number; Ly: number }; // outrigger span (m)
  clearanceWarning?: boolean;  // if true tint boom/load red
  objects?: SceneObject[];     // environment objects (nesne kütüphanesi)
  collidingIds?: string[];     // çakışan nesne id'leri → kırmızı tint
  loadDiameterReal?: number;   // gerçek yük çapı (sapan çizimi için)
  dimensions?: CraneDimensions; // vinçe özgü gerçek ölçüler (SANY) → doğru şasi
  jib?: { jib_length: number; jib_offset: number } | null; // jib modu → bom+jib çizimi
}

// ─────────────────────────────────────────────────────────────────────────────
// Safety guard helpers — prevent NaN / Infinity from reaching Three.js
// ─────────────────────────────────────────────────────────────────────────────
/** Return v if finite, else fallback */
function safe(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
/** Return v if finite AND strictly positive, else fallback */
function safePos(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
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
  hit: boolean;
}

function GltfModel({ url, x, z, width, depth, height, rotationY, hit }: GltfModelProps) {
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
    // Modeli yatayda ortala, tabanı yere (y=0) getir.
    return {
      scale: s,
      offset: new Vector3(-center.x * s, -box.min.y * s, -center.z * s),
    };
  }, [cloned, width, depth, height]);

  return (
    <group position={[x, 0, z]} rotation={[0, (rotationY * Math.PI) / 180, 0]}>
      <group position={offset.toArray()} scale={scale}>
        <primitive object={cloned} />
      </group>
      {/* Çakışma varsa yarı saydam kırmızı sınırlayıcı kutu kaplaması */}
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
// CraneScene — all 3D geometry; must be rendered inside a <Canvas>
// ─────────────────────────────────────────────────────────────────────────────
function CraneScene({
  boomLength: boomLenRaw,
  radius: radiusRaw,
  boomOffset: boomOffRaw,
  machineGroundHeight: mgHRaw,
  cribbingHeight: crHRaw,
  gama: gamaRaw,
  slewAngleDeg: slewDegRaw,
  loadHeight: loadHRaw,
  loadDiameter: loadDRaw,
  obstacleHeight: obsHRaw,
  obstacleDistance: obsDistRaw,
  obstacleWidth: obsWRaw,
  outrigger,
  clearanceWarning = false,
  objects = [],
  collidingIds = [],
  dimensions,
  jib = null,
}: Crane3DProps) {
  // ── Sanitise inputs ────────────────────────────────────────────────────────
  const boomLen  = safePos(boomLenRaw, 10);
  const radius   = safePos(radiusRaw, 5);
  const boomOff  = safe(boomOffRaw, 1);
  const machineH = Math.max(0, safe(mgHRaw, 1));
  const crH      = Math.max(0, safe(crHRaw, 0));
  const gama     = safe(gamaRaw, Math.PI / 4);
  const slewRad  = (safe(slewDegRaw, 0) * Math.PI) / 180;
  const loadH    = Math.max(0.1, safePos(loadHRaw, 1));
  const loadD    = Math.max(0.1, safePos(loadDRaw, 1));
  const obsH     = Math.max(0.5, safe(obsHRaw, 3));
  const obsDist  = safe(obsDistRaw, 0);
  const obsW     = Math.max(0.3, safePos(obsWRaw ?? 2.5, 2.5));
  const Lx       = Math.max(2, safePos(outrigger.Lx, 6));
  const Ly       = Math.max(2, safePos(outrigger.Ly, 6));

  // ── Derived boom geometry (slew-local, Y-up) ───────────────────────────────
  // Boom foot sits BEHIND the slew centre by boomOff (−X), elevated to
  // machineH + crH. With this, the boom tip lands at horizontal ~radius,
  // so the hoist rope hangs vertically over the load.
  const boomFootX = -boomOff;
  const boomFootY = machineH + crH;

  // ── Jib modu: bom açısını jib ucu radius'a düşecek şekilde çöz ───────────────
  const jibActive = !!jib && jib.jib_length > 0;
  const jg = jibActive
    ? jibGeometry(boomOff, boomFootY, boomLen, jib!.jib_length, jib!.jib_offset, radius)
    : null;
  const boomAngle = jg ? jg.boomAngle : gama;

  const cosG = Math.cos(boomAngle);
  const sinG = Math.sin(boomAngle);

  // Tip = foot + boomLen × (cos, sin, 0)
  const boomTipX = jg ? jg.boomTip.x : boomFootX + boomLen * cosG;
  const boomTipY = jg ? jg.boomTip.y : boomFootY + boomLen * sinG;
  // Jib ucu (yük burada asılı) — jib yoksa bom ucu.
  const tipX = jg ? jg.jibTip.x : boomTipX;
  const tipY = jg ? jg.jibTip.y : boomTipY;
  // Jib yön/uzunluk (yerel bom çerçevesinde çizim için)
  const jibLocalAngle = jg ? jg.jibAngle - boomAngle : 0; // bom eksenine göre
  const jibLen = jibActive ? jib!.jib_length : 0;

  // ── Colours ────────────────────────────────────────────────────────────────
  const boomColor = clearanceWarning ? '#ef4444' : '#f59e0b';
  const loadColor = clearanceWarning ? '#ef4444' : '#64748b';

  // ── Denge ağırlığı (SANY: kuyruk yarıçapında) ──────────────────────────────
  const cwX = dimensions ? -(dimensions.tail_radius_m - 1.4) : -2.8;
  const cwH = dimensions?.counterweight_height_m ?? 1.4;

  // ── Carrier / truck dimensions (SANY: broşür ölçüleri) ─────────────────────
  const truckLen = dimensions ? dimensions.carrier_length_m : Lx * 0.6;
  const truckW   = dimensions ? dimensions.carrier_width_m : Ly * 0.5;
  const carrierRearX = dimensions ? -dimensions.tail_radius_m - 0.6 : -truckLen / 2;
  const carrierCenterX = carrierRearX + truckLen / 2;
  const tireR = dimensions ? dimensions.tire_diameter_m / 2 : 0.85;
  const deckY = dimensions?.deck_height_m ?? 1.5;
  // Aks x konumları (slew merkezine göre). Broşür: ön uçtan; carrierFront = carrierRearX+len.
  const axleXsWorld = dimensions?.axle_positions_m
    ? dimensions.axle_positions_m.map((p) => carrierRearX + truckLen - p)
    : [-0.4, -0.22, 0.16, 0.32, 0.46].map((f) => f * truckLen);

  // ── Hoist rope endpoints (in slew-local space) ─────────────────────────────
  // Rope hangs from boom/jib tip down to the top of the load.
  const ropeStart: [number, number, number] = [tipX, tipY, 0];
  const ropeEnd:   [number, number, number] = [radius, loadH, 0];

  // ── Outrigger corner positions ─────────────────────────────────────────────
  const corners: [number, number][] = [
    [ Lx / 2,  Ly / 2],
    [ Lx / 2, -Ly / 2],
    [-Lx / 2,  Ly / 2],
    [-Lx / 2, -Ly / 2],
  ];

  // OrbitControls target: yapının orta yüksekliği (dik jib bomlarında yükselir)
  const topExtent = Math.max(boomTipY, tipY);
  const targetY = Math.min(Math.max(topExtent * 0.5, 5), 55);

  // ── Sapan (sling) hatları: kanca → yük üst köşeleri ──────────────────────────
  const hookPt: [number, number, number] = [radius, loadH + 0.65, 0];
  const half = loadD / 2;
  const slingTops: Array<[number, number, number]> = [
    [radius + half, loadH, half],
    [radius + half, loadH, -half],
    [radius - half, loadH, half],
    [radius - half, loadH, -half],
  ];

  // ── Çevre nesneleri (dünya çerçevesi, slew'den bağımsız) ─────────────────────
  const collSet = new Set(collidingIds);
  const objColor = (kind: SceneObjectKind, hit: boolean): string => {
    if (hit) return '#ef4444';
    switch (kind) {
      case 'building': return '#475569';
      case 'truck': return '#6d28d9';
      case 'person': return '#10b981';
      case 'powerline': return '#eab308';
      default: return '#64748b'; // obstacle
    }
  };

  return (
    <>
      {/* ── Lighting ─────────────────────────────────────────────────────── */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[30, 50, 30]} intensity={1.1} />
      <directionalLight position={[-15, 15, -20]} intensity={0.3} color="#93c5fd" />

      {/* ── Ground plane + grid ───────────────────────────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#0d1b2e" />
      </mesh>
      {/* Three.js GridHelper intrinsic — always type-safe in R3F */}
      <gridHelper args={[200, 100, '#334155', '#1e293b']} position={[0, 0, 0]} />

      {/* ── Carrier truck body ───────────────────────────────────────────── */}
      <mesh position={[carrierCenterX, deckY - 0.55, 0]}>
        <boxGeometry args={[truckLen, 1.1, truckW * 0.92]} />
        <meshStandardMaterial color="#1e3a5f" metalness={0.3} roughness={0.7} />
      </mesh>
      {/* Operatör kabini (ön, +X ucu) */}
      <mesh position={[carrierRearX + truckLen - 1.3, deckY + 0.55, truckW * 0.28]}>
        <boxGeometry args={[1.9, (dimensions?.cab_height_m ?? 3.6) - deckY, 1.6]} />
        <meshStandardMaterial color="#16344e" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Tekerlekler (broşür: aks konumları, iki yan) */}
      {axleXsWorld.map((ax, i) =>
        [1, -1].map((sz) => (
          <mesh
            key={`${i}-${sz}`}
            position={[ax, tireR, (sz * truckW) / 2]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[tireR, tireR, 0.5, 18]} />
            <meshStandardMaterial color="#0f1c2c" metalness={0.1} roughness={0.9} />
          </mesh>
        )),
      )}

      {/* ── Outrigger cross beams (+ shape from above) ──────────────────── */}
      {/* Longitudinal (X) */}
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[Lx, 0.18, 0.22]} />
        <meshStandardMaterial color="#2d4a6b" />
      </mesh>
      {/* Lateral (Z) */}
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.22, 0.18, Ly]} />
        <meshStandardMaterial color="#2d4a6b" />
      </mesh>

      {/* ── Corner outrigger pads ─────────────────────────────────────────── */}
      {corners.map(([px, pz], i) => (
        <mesh key={i} position={[px, 0.05, pz]}>
          <cylinderGeometry args={[0.45, 0.55, 0.1, 12]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
      ))}

      {/* ── Slewing superstructure ────────────────────────────────────────
          Motor konvansiyonu: slew a → dünya (x=r·cosa, z=r·sina) (collision.ts,
          SitePlan, GroundForceDiagram ile aynı). three.js'te rotation.y=+a yerel
          +X'i (cosa, −sina)'ya götürür (ayna); bu yüzden negatif uygulanır. */}
      <group rotation={[0, -slewRad, 0]}>

        {/* Superstructure platform */}
        <mesh position={[0, boomFootY + 0.15, 0]}>
          <boxGeometry args={[3.5, 0.3, 2.2]} />
          <meshStandardMaterial color="#1e3a5f" />
        </mesh>

        {/* Counterweight — at the rear (−X); SANY: kuyruk yarıçapında */}
        <mesh position={[cwX, boomFootY + cwH / 2, 0]}>
          <boxGeometry args={[dimensions ? 2.6 : 2.2, cwH, dimensions ? 2.6 : 1.8]} />
          <meshStandardMaterial color="#374151" />
        </mesh>

        {/* ── Teleskopik bom ───────────────────────────────────────────────
            Bom dibinde (foot) konumlanan, gama kadar eğik bir grup.
            İç içe geçmiş 3 bölüm (kesit + yükseklik gittikçe incelir) →
            teleskopik kol görünümü. Yerel +X bom ekseni boyunca uzar.
        ─────────────────────────────────────────────────────────────────── */}
        <group position={[boomFootX, boomFootY, 0]} rotation={[0, 0, boomAngle]}>
          {[
            { c: 0.78, w: 0.0, l: 0.42 },
            { c: 0.60, w: 0.40, l: 0.40 },
            { c: 0.44, w: 0.78, l: 0.30 },
          ].map((seg, i) => (
            <mesh key={i} position={[boomLen * (seg.w + seg.l / 2), 0, 0]}>
              <boxGeometry args={[boomLen * seg.l, seg.c, seg.c]} />
              <meshStandardMaterial color={boomColor} metalness={0.35} roughness={0.5} />
            </mesh>
          ))}
          {/* Bom dibi pivot mafsalı */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.9, 16]} />
            <meshStandardMaterial color="#374151" metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Uç makara başlığı */}
          <mesh position={[boomLen, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.5, 14]} />
            <meshStandardMaterial color="#2b3645" metalness={0.4} roughness={0.5} />
          </mesh>
          {/* ── JİB (bom ucundan, ofset açısıyla aşağı) ─────────────────── */}
          {jibActive && (
            <group position={[boomLen, 0, 0]} rotation={[0, 0, jibLocalAngle]}>
              <mesh position={[jibLen / 2, 0, 0]}>
                <boxGeometry args={[jibLen, 0.42, 0.42]} />
                <meshStandardMaterial color="#38bdf8" metalness={0.3} roughness={0.5} />
              </mesh>
              {/* Jib ucu makara */}
              <mesh position={[jibLen, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.32, 0.32, 0.42, 12]} />
                <meshStandardMaterial color="#2b3645" metalness={0.4} roughness={0.5} />
              </mesh>
            </group>
          )}
        </group>

        {/* Kanca bloğu (yük üstünde) */}
        <mesh position={[radius, loadH + 1.0, 0]}>
          <boxGeometry args={[0.5, 0.7, 0.5]} />
          <meshStandardMaterial color="#374151" metalness={0.5} roughness={0.4} />
        </mesh>

        {/* ── Hoist rope (thin line from boom tip to load top) ─────────── */}
        <Line
          points={[ropeStart, ropeEnd]}
          color="#9ca3af"
          lineWidth={1.5}
        />

        {/* ── Sapanlar (kanca → yük 4 üst köşesi) ───────────────────────── */}
        {slingTops.map((top, i) => (
          <Line key={`sling-${i}`} points={[hookPt, top]} color="#cbd5e1" lineWidth={1.2} />
        ))}

        {/* ── Load box ─────────────────────────────────────────────────────
            Centred at (radius, loadH/2, 0) so its base sits on the ground
            and its top is at loadH (reached by the hook).
        ─────────────────────────────────────────────────────────────────── */}
        <mesh position={[radius, loadH / 2, 0]}>
          <boxGeometry args={[loadD, loadH, loadD]} />
          <meshStandardMaterial color={loadColor} />
        </mesh>

        {/* ── Obstacle ─────────────────────────────────────────────────────
            Positioned at (radius − obstacleDistance) from slew centre,
            between crane and load, amber and semi-transparent.
        ─────────────────────────────────────────────────────────────────── */}
        <mesh position={[radius - obsDist, obsH / 2, 0]}>
          <boxGeometry args={[obsW, obsH, obsW]} />
          <meshStandardMaterial color="#f59e0b" transparent opacity={0.45} />
        </mesh>

      </group>

      {/* ── Çevre nesneleri (nesne kütüphanesi) ──────────────────────────────
          Dünya çerçevesinde sabit; üst yapı slew'inden etkilenmez. Çakışan
          nesneler kırmızıya boyanır. Etiket için ufak bir işaret yok (3D),
          renk + boyut yeterli.
      ─────────────────────────────────────────────────────────────────── */}
      {objects.map((o) => {
        const hit = collSet.has(o.id);
        const w = safePos(o.width, 1);
        const d = safePos(o.depth, 1);
        const hgt = safePos(o.height, 1);
        const ox = safe(o.x, 0);
        const oz = safe(o.z, 0);
        const rotY = safe(o.rotationY ?? 0, 0);

        // Sınırlayıcı kutu (model yüklenemezse yedek + primitif nesneler).
        const boxMesh = (
          <mesh position={[ox, hgt / 2, oz]} rotation={[0, (rotY * Math.PI) / 180, 0]}>
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

        if (o.kind === 'model' && o.modelUrl) {
          return (
            <ModelBoundary key={o.id} fallback={boxMesh}>
              <Suspense fallback={boxMesh}>
                <GltfModel
                  url={o.modelUrl}
                  x={ox}
                  z={oz}
                  width={w}
                  depth={d}
                  height={hgt}
                  rotationY={rotY}
                  hit={hit}
                />
              </Suspense>
            </ModelBoundary>
          );
        }
        return <group key={o.id}>{boxMesh}</group>;
      })}

      {/* ── Orbit camera controls ─────────────────────────────────────────── */}
      <OrbitControls makeDefault target={[0, targetY, 0]} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export — wraps scene in a Canvas that fills its parent
// ─────────────────────────────────────────────────────────────────────────────
export default function Crane3D(props: Crane3DProps) {
  // Scale initial camera distance to the crane's approximate envelope.
  // Jib modunda bom neredeyse dikey (yükseklik ≈ boomLength) → kamerayı yukarı al.
  const safeBL = safePos(props.boomLength, 20);
  const safeR  = safePos(props.radius,     10);
  const jibTall = !!props.jib && props.jib.jib_length > 0;
  const span   = Math.max(safeBL, safeR * 1.5, 14) * (jibTall ? 1.55 : 1.35);
  const camPos: [number, number, number] = jibTall
    ? [span * 0.75, span * 0.95, span * 1.0]
    : [span * 0.9, span * 0.7, span * 1.05];

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: camPos, fov: 45, near: 0.1, far: 2000 }}
    >
      {/* Scene background colour */}
      <color attach="background" args={['#0f172a']} />

      <CraneScene {...props} />
    </Canvas>
  );
}

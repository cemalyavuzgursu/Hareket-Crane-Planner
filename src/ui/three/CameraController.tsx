// Kamera ön ayarları (Üst / Ön / Yan / İzometrik / Sığdır) — kamera konumu ve
// OrbitControls hedefi ~0.45 s içinde yumuşak geçişle taşınır.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { asControls } from './drag';

export type CamView = 'top' | 'front' | 'side' | 'iso' | 'fit';

export interface CamCommand {
  view: CamView;
  /** Her tıklamada artan sayaç — aynı görünüm tekrar istenebilsin. */
  n: number;
}

export interface CamFrame {
  /** Kadrajlanacak noktalar (dünya). */
  points: Array<[number, number, number]>;
  /** Vinç yönü (°) — ön/yan görünüm yönleri buna göre. */
  headingDeg: number;
}

interface Anim {
  t: number;
  fromPos: Vector3;
  toPos: Vector3;
  fromTgt: Vector3;
  toTgt: Vector3;
}

export default function CameraController({ cmd, frame }: { cmd: CamCommand | null; frame: CamFrame }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const anim = useRef<Anim | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    const ctrl = asControls(controls);
    if (!cmd || !ctrl) return;
    const f = frameRef.current;
    const pts = f.points.length ? f.points : [[0, 0, 0] as [number, number, number]];
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    pts.forEach(([x, y, z]) => { min.min(new Vector3(x, y, z)); max.max(new Vector3(x, y, z)); });
    min.y = Math.min(min.y, 0);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(8, max.clone().sub(min).length() / 2 + 3);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 45;
    const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 1.5;
    const vHalf = (fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const dist = radius / Math.sin(Math.min(vHalf, hHalf)) * 1.02;

    const h = (f.headingDeg * Math.PI) / 180;
    const rear = new Vector3(Math.cos(h), 0, Math.sin(h)); // şasi arkası (+X yerel)
    const side = new Vector3(-Math.sin(h), 0, Math.cos(h));
    let dir: Vector3;
    switch (cmd.view) {
      case 'top': dir = new Vector3(0, 1, 0).addScaledVector(rear.clone().negate(), 0.002); break;
      case 'front': dir = rear.clone().negate().add(new Vector3(0, 0.12, 0)); break;
      case 'side': dir = side.clone().add(new Vector3(0, 0.12, 0)); break;
      case 'iso': dir = rear.clone().negate().add(side).add(new Vector3(0, 1.1, 0)); break;
      default: {
        dir = camera.position.clone().sub(ctrl.target);
        if (dir.lengthSq() < 1e-6) dir = new Vector3(1, 0.8, 1);
      }
    }
    dir.normalize();
    anim.current = {
      t: 0,
      fromPos: camera.position.clone(),
      toPos: center.clone().addScaledVector(dir, dist),
      fromTgt: ctrl.target.clone(),
      toTgt: center,
    };
    // Yalnızca yeni komutta çalışır (cmd.n değişince).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.n]);

  useFrame((_, dt) => {
    const a = anim.current;
    const ctrl = asControls(controls);
    if (!a || !ctrl) return;
    a.t = Math.min(1, a.t + dt / 0.45);
    const k = 1 - Math.pow(1 - a.t, 3); // ease-out
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    ctrl.target.lerpVectors(a.fromTgt, a.toTgt, k);
    ctrl.update();
    if (a.t >= 1) anim.current = null;
  });

  return null;
}

// Sürükleme yardımcısı: tutamaçta pointerdown → yardımcı bir düzlemle (zemin,
// bom düşey düzlemi, güverte…) işaretçi ışınının kesişimi pencere düzeyinde
// dinlenir. Kamera kontrolü (OrbitControls) sürükleme boyunca kapatılır;
// geri çağırma animasyon karesi başına en fazla bir kez yapılır (rAF kısma).
import { useCallback } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';

/** drei OrbitControls (makeDefault) için kullandığımız asgari arayüz. */
export interface ControlsLike {
  enabled: boolean;
  target: Vector3;
  update: () => void;
}

export function asControls(c: unknown): ControlsLike | null {
  if (c && typeof c === 'object' && 'target' in c && 'enabled' in c) return c as ControlsLike;
  return null;
}

export interface DragHandlers {
  /** Düzlemdeki ilk kesişim noktası (başlangıç). */
  onStart?: (p: Vector3) => void;
  onMove: (p: Vector3) => void;
  onEnd?: () => void;
}

/**
 * Döndürülen fonksiyon bir r3f pointerdown olayından çağrılır:
 *   onPointerDown={(e) => startDrag(e, plane, { onMove })}
 */
export function useDragOnPlane() {
  const get = useThree((s) => s.get);
  return useCallback(
    (e: ThreeEvent<PointerEvent>, plane: Plane, h: DragHandlers) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const { camera, gl, controls } = get();
      const ctrl = asControls(controls);
      if (ctrl) ctrl.enabled = false;
      const el = gl.domElement;
      const ray = new Raycaster();
      const ndc = new Vector2();
      const hit = new Vector3();
      const intersect = (clientX: number, clientY: number): Vector3 | null => {
        const r = el.getBoundingClientRect();
        ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
      };
      const p0 = intersect(e.nativeEvent.clientX, e.nativeEvent.clientY) ?? e.point.clone();
      h.onStart?.(p0);

      let raf = 0;
      let pending: Vector3 | null = null;
      const move = (ev: PointerEvent) => {
        const p = intersect(ev.clientX, ev.clientY);
        if (!p) return;
        pending = p;
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (pending) h.onMove(pending);
            pending = null;
          });
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (raf) cancelAnimationFrame(raf);
        if (pending) h.onMove(pending);
        const c = asControls(get().controls);
        if (c) c.enabled = true;
        el.style.cursor = '';
        h.onEnd?.();
      };
      el.style.cursor = 'grabbing';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [get],
  );
}

/** Yatay düzlem y = h. */
export function horizontalPlane(h: number): Plane {
  return new Plane(new Vector3(0, 1, 0), -h);
}

/** Düşey düzlem: p noktasından geçer, normal = (nx, 0, nz). */
export function verticalPlane(px: number, pz: number, nx: number, nz: number): Plane {
  const n = new Vector3(nx, 0, nz).normalize();
  return new Plane().setFromNormalAndCoplanarPoint(n, new Vector3(px, 0, pz));
}

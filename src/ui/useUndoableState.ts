/**
 * useUndoableState — sınırlı (50 adım) geri al/yinele geçmişi olan state hook'u.
 * `set` her çağrıldığında önceki değeri geçmişe iter (limit aşılırsa en eskisi
 * atılır) ve yinele yığınını temizler. `replace`, geçmişe dokunmadan mevcut
 * değeri değiştirir (ör. localStorage'dan ilk yükleme, proje dosyası açma —
 * bunlar "geri alınabilir bir düzenleme" değil, yeni bir başlangıç noktasıdır).
 */
import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;
/** Bu süreden (ms) kısa aralıklarla gelen değişiklikler TEK geçmiş adımı sayılır
 * (3B sürükleme her karede set çağırır — tek Ctrl+Z tüm sürüklemeyi geri almalı). */
const COALESCE_MS = 400;

export function useUndoableState<T>(initial: T | (() => T)) {
  const [present, setPresent] = useState<T>(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const lastSetAt = useRef(0);

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    const now = Date.now();
    const coalesce = now - lastSetAt.current < COALESCE_MS;
    lastSetAt.current = now;
    setPresent((prev) => {
      const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
      if (next === prev) return prev;
      if (!coalesce) {
        setPast((p) => {
          const np = [...p, prev];
          return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
        });
      }
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prevState = p[p.length - 1];
      setPresent((cur) => {
        setFuture((f) => [cur, ...f]);
        return prevState;
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextState = f[0];
      setPresent((cur) => {
        setPast((p) => {
          const np = [...p, cur];
          return np.length > MAX_HISTORY ? np.slice(np.length - MAX_HISTORY) : np;
        });
        return nextState;
      });
      return f.slice(1);
    });
  }, []);

  /** Geçmişe dokunmadan değeri değiştirir (yeni "temiz" başlangıç noktası). */
  const replace = useCallback((next: T) => {
    setPresent(next);
    setPast([]);
    setFuture([]);
  }, []);

  return {
    state: present,
    set,
    undo,
    redo,
    replace,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  } as const;
}

/**
 * ZoomPan — SVG tabanlı görünümler (2B yan, üstten, kapasite haritası) için
 * yakınlaştırma/kaydırma sarmalayıcısı.
 *  - Fare tekerleği: imleç etrafında yakınlaştır/uzaklaştır
 *  - Sürükle: kaydır (4 px'ten az hareket tıklama sayılır → alt bileşenin
 *    onClick'i, ör. kapasite haritasında hücre seçimi, çalışmaya devam eder)
 *  - Çift tıklama / "Sığdır": sıfırla
 *  - +/− düğmeleri, dokunmatik/klavye erişimi için
 * Dönüşüm CSS transform ile uygulanır; içerik yeniden hesaplanmaz.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";

const MIN_K = 0.5;
const MAX_K = 12;
const DRAG_THRESHOLD = 4;

interface View {
  k: number;
  x: number;
  y: number;
}

export default function ZoomPan({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const [v, setV] = useState<View>({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  // Görünüm/sekme değişince sıfırla.
  useEffect(() => setV({ k: 1, x: 0, y: 0 }), [resetKey]);

  /** (cx, cy) kutu-yerel noktası sabit kalacak şekilde ölçeği f ile çarp. */
  const zoomAt = useCallback((f: number, cx: number, cy: number) => {
    setV((p) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, p.k * f));
      const r = k / p.k;
      return { k, x: cx - (cx - p.x) * r, y: cy - (cy - p.y) * r };
    });
  }, []);

  // Tekerlek: pasif olmayan dinleyici (sayfa kaymasını engellemek için).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const center = () => {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? { cx: r.width / 2, cy: r.height / 2 } : { cx: 0, cy: 0 };
  };

  const btn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 6, border: "1px solid #2b4a66", cursor: "pointer",
    background: "rgba(8,18,32,.88)", color: "#cfe3f2", fontSize: 16, fontWeight: 700, lineHeight: "28px", padding: 0,
  };

  return (
    <div
      ref={boxRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", touchAction: "none", cursor: drag.current?.moved ? "grabbing" : "grab" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!d.moved) {
          d.moved = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }
        setV((p) => ({ ...p, x: d.vx + dx, y: d.vy + dy }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (d && d.moved) suppressClick.current = true;
        drag.current = null;
        try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* yakalanmamış */ }
      }}
      onClickCapture={(e) => {
        // Sürükleme sonrası tıklama, alttaki bileşene (ör. harita hücresi seçimi) iletilmez.
        if (suppressClick.current) {
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onDoubleClick={() => setV({ k: 1, x: 0, y: 0 })}
    >
      <div style={{ width: "100%", height: "100%", transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "0 0" }}>
        {children}
      </div>
      <div
        style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 4, zIndex: 6 }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button type="button" style={btn} title={t("Yakınlaştır")} onClick={() => { const c = center(); zoomAt(1.25, c.cx, c.cy); }}>+</button>
        <button type="button" style={btn} title={t("Uzaklaştır")} onClick={() => { const c = center(); zoomAt(0.8, c.cx, c.cy); }}>−</button>
        <button type="button" style={{ ...btn, fontSize: 13 }} title={t("Sığdır")} onClick={() => setV({ k: 1, x: 0, y: 0 })}>⤢</button>
        <span style={{ fontSize: 10.5, color: "#9ecfe0", textAlign: "center", fontFamily: "monospace" }}>{Math.round(v.k * 100)}%</span>
      </div>
    </div>
  );
}

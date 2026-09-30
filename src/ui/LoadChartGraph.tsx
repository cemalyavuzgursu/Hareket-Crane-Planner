// Kompakt yük eğrisi grafiği (yan panel, ~260×180). Motor "step-down" okuma
// kullanır: r'deki kapasite, r'ye eşit ya da büyük ilk tablo noktasının
// değeridir → eğri basamak olarak çizilir. Renkler theme.css değişkenlerinden.

import { useId, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { useUnits } from "./units";

export interface LoadChartGraphProps {
  curve: Array<[number, number]>;
  radius: number;
  totalLoad: number;
  boomLength: number;
  counterweight: number;
  capacityPct: number;
  secondCurves?: Array<{ label: string; curve: Array<[number, number]> }>;
}

const W = 260;
const H = 180;
const M = { l: 34, r: 8, t: 22, b: 26 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

// Durum renkleri (dataviz status paleti) — ikon/etiketle birlikte kullanılır.
const OK = "var(--lc-good, #0ca30c)";
const WARN = "var(--lc-warn, #fab219)";
const OVER = "var(--lc-crit, #d03b3b)";

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function ticks(max: number, target: number): { step: number; max: number; values: number[] } {
  const step = niceStep(max, target);
  const top = Math.ceil(max / step - 1e-9) * step;
  const values: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) values.push(+v.toFixed(6));
  return { step, max: top, values };
}

/** Step-down kapasite (motorla aynı); aralık dışında null. */
function capAt(pts: Array<[number, number]>, r: number): number | null {
  if (!pts.length || r < pts[0][0] - 1e-9 || r > pts[pts.length - 1][0] + 1e-9) return null;
  for (const [rr, c] of pts) if (rr >= r - 1e-9) return c;
  return null;
}

function stepPath(pts: Array<[number, number]>, sx: (v: number) => number, sy: (v: number) => number): string {
  if (!pts.length) return "";
  let d = `M${sx(pts[0][0]).toFixed(1)},${sy(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `V${sy(pts[i][1]).toFixed(1)}H${sx(pts[i][0]).toFixed(1)}`;
  }
  return d;
}

let fmtLocale = "tr-TR";
const fmt = (v: number, d = 1) => v.toLocaleString(fmtLocale, { maximumFractionDigits: d });

export default function LoadChartGraph({
  curve,
  radius,
  totalLoad,
  boomLength,
  counterweight,
  capacityPct,
  secondCurves,
}: LoadChartGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { t, lang } = useI18n();
  const u = useUnits();
  fmtLocale = lang === "en" ? "en-US" : "tr-TR";
  /** Ağırlık metni: metrik "12,5 t" / imperial "27,558 lb". */
  const fm = (tons: number) => (u.imperial ? `${fmt(u.mass(tons), 0)} lb` : `${fmt(tons)} t`);
  const [hoverR, setHoverR] = useState<number | null>(null);
  const clipId = `lc-clip-${useId().replace(/:/g, "")}`;

  const pts = useMemo(() => [...curve].sort((a, b) => a[0] - b[0]), [curve]);
  const others = useMemo(
    () => (secondCurves ?? []).map((s) => ({ ...s, curve: [...s.curve].sort((a, b) => a[0] - b[0]) })),
    [secondCurves],
  );

  const scale = useMemo(() => {
    let rMax = pts.length ? pts[pts.length - 1][0] : 10;
    let cMax = pts.length ? Math.max(...pts.map((p) => p[1])) : 10;
    rMax = Math.max(rMax, radius);
    cMax = Math.max(cMax, totalLoad);
    for (const o of others) {
      if (o.curve.length) rMax = Math.max(rMax, o.curve[o.curve.length - 1][0]);
    }
    // Tikler görüntü biriminde (ft / lb) hesaplanır → "güzel" değerler.
    const xt = ticks(u.len(rMax), 5);
    const yt = ticks(u.mass(cMax * 1.05), 4);
    const sxD = (v: number) => M.l + (v / xt.max) * PW;
    const syD = (v: number) => M.t + PH - (v / yt.max) * PH;
    const sx = (v: number) => sxD(u.len(v));
    const sy = (v: number) => syD(u.mass(v));
    return { xt, yt, sx, sy, sxD, syD };
  }, [pts, others, radius, totalLoad, u]);
  const { xt, yt, sx, sy, sxD, syD } = scale;

  const capNow = capAt(pts, radius);
  const util = capNow != null && capNow > 0 ? (totalLoad / capNow) * 100 : null;
  const opColor = util == null || util > 100 ? OVER : util >= 90 ? WARN : OK;
  const opLabel = t(util == null ? "Tablo dışı" : util > 100 ? "Aşım" : util >= 90 ? "Sınırda" : "Uygun");
  const opIcon = util == null || util > 100 ? "✕" : util >= 90 ? "!" : "✓";

  // Kapasitenin toplam yükün altında kaldığı basamaklar (aşım bölgesi).
  const overRects: Array<{ x0: number; x1: number; c: number }> = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] < totalLoad) overRects.push({ x0: pts[i - 1][0], x1: pts[i][0], c: pts[i][1] });
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const rD = ((p.x - M.l) / PW) * xt.max;
    setHoverR(rD >= 0 && rD <= xt.max ? u.fromLen(rD) : null);
  }

  const hoverCap = hoverR != null ? capAt(pts, hoverR) : null;
  const title = t("Yük Eğrisi — {boom} · {cw}", {
    boom: `${fmt(u.len(boomLength))} ${u.lenU}`,
    cw: fm(counterweight),
  });

  return (
    <div className="lc-graph" style={{ position: "relative", width: "100%" }}>
      <style>{`
        .lc-graph { --lc-good:#0ca30c; --lc-warn:#fab219; --lc-crit:#d03b3b; }
        .lc-graph text { font-family: var(--mono, monospace); }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={
          `${title}. ` +
          t("Radius {r}, toplam yük {load}, kapasite {cap}", {
            r: `${fmt(u.len(radius))} ${u.lenU}`,
            load: fm(totalLoad),
            cap: capNow != null ? fm(capNow) : t("tablo dışı"),
          }) +
          (util != null ? t(", kullanım %{p}", { p: fmt(util, 0) }) : "") +
          "."
        }
        style={{ display: "block", overflow: "visible" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverR(null)}
      >
        <text x={M.l} y={12} fontSize={10.5} fontWeight={700} fill="var(--text, #e2e2e6)">
          {title}
        </text>
        <text x={W - M.r} y={12} fontSize={9} textAnchor="end" fill="var(--text-faint, #6b7280)">
          %{capacityPct}
        </text>

        {/* Izgara + eksenler (geri planda) */}
        {yt.values.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={M.l + PW} y1={syD(v)} y2={syD(v)} stroke="var(--border, #282a2d)" strokeWidth={v === 0 ? 1 : 0.6} />
            <text x={M.l - 4} y={syD(v) + 3} fontSize={8.5} textAnchor="end" fill="var(--text-faint, #6b7280)">
              {u.imperial ? fmt(v / 1000, 1) : fmt(v, 0)}
            </text>
          </g>
        ))}
        {xt.values.map((v) => (
          <text key={`x${v}`} x={sxD(v)} y={M.t + PH + 11} fontSize={8.5} textAnchor="middle" fill="var(--text-faint, #6b7280)">
            {fmt(v, 0)}
          </text>
        ))}
        <text x={M.l + PW} y={H - 3} fontSize={8.5} textAnchor="end" fill="var(--text-dim, #9ca3af)">
          {t("Radius")} ({u.lenU})
        </text>
        <text x={4} y={M.t - 5} fontSize={8.5} fill="var(--text-dim, #9ca3af)">
          {u.imperial ? "klb" : "t"}
        </text>

        {/* Aşım bölgesi */}
        {overRects.map((o, i) => (
          <rect
            key={i}
            x={sx(o.x0)}
            width={Math.max(0.5, sx(o.x1) - sx(o.x0))}
            y={sy(totalLoad)}
            height={Math.max(0, sy(o.c) - sy(totalLoad))}
            fill={OVER}
            opacity={0.18}
          />
        ))}

        <clipPath id={clipId}>
          <rect x={M.l} y={M.t} width={PW} height={PH} />
        </clipPath>

        {/* Diğer bom uzunlukları (soluk) — çizim alanına kırpılır */}
        <g clipPath={`url(#${clipId})`}>
        {others.map((o) => (
          <path
            key={o.label}
            d={stepPath(o.curve, sx, sy)}
            fill="none"
            stroke="var(--text-faint, #6b7280)"
            strokeWidth={1}
            opacity={0.45}
          >
            <title>{o.label}</title>
          </path>
        ))}
        </g>

        {/* Kapasite eğrisi */}
        <path d={stepPath(pts, sx, sy)} fill="none" stroke="var(--blue, #5ad1ff)" strokeWidth={2} strokeLinejoin="round" />

        {/* Toplam yük çizgisi */}
        <line
          x1={M.l}
          x2={M.l + PW}
          y1={sy(totalLoad)}
          y2={sy(totalLoad)}
          stroke="var(--text-dim, #9ca3af)"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
        <text x={M.l + PW - 2} y={sy(totalLoad) - 3} fontSize={8.5} textAnchor="end" fill="var(--text-dim, #9ca3af)">
          {t("Yük")} {fm(totalLoad)}
        </text>

        {/* Mevcut radius */}
        {radius >= 0 && radius <= xt.max && (
          <g>
            <line x1={sx(radius)} x2={sx(radius)} y1={M.t} y2={M.t + PH} stroke="var(--accent, #ffba20)" strokeWidth={1} opacity={0.7} />
            {capNow != null && (
              <circle cx={sx(radius)} cy={sy(capNow)} r={2.5} fill="var(--blue, #5ad1ff)" stroke="var(--panel, #15171b)" strokeWidth={1} />
            )}
            <circle cx={sx(radius)} cy={sy(totalLoad)} r={4.5} fill={opColor} stroke="var(--panel, #15171b)" strokeWidth={2} />
          </g>
        )}

        {/* Hover crosshair */}
        {hoverR != null && (
          <line x1={sx(hoverR)} x2={sx(hoverR)} y1={M.t} y2={M.t + PH} stroke="var(--text-faint, #6b7280)" strokeWidth={0.8} />
        )}
        {hoverR != null && hoverCap != null && (
          <circle cx={sx(hoverR)} cy={sy(hoverCap)} r={3} fill="var(--blue, #5ad1ff)" stroke="var(--panel, #15171b)" strokeWidth={1.5} />
        )}
      </svg>

      {hoverR != null && (
        <div
          style={{
            position: "absolute",
            left: `${(Math.min(sx(hoverR), W - 90) / W) * 100}%`,
            top: 18,
            pointerEvents: "none",
            background: "var(--panel-2, #1a1c1f)",
            border: "1px solid var(--border-2, #37393d)",
            borderRadius: 6,
            padding: "3px 7px",
            fontSize: 11,
            fontFamily: "var(--mono, monospace)",
            color: "var(--text, #e2e2e6)",
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ color: "var(--text-dim, #9ca3af)" }}>R {fmt(u.len(hoverR))} {u.lenU}</div>
          <div>{hoverCap != null ? fm(hoverCap) : t("Tablo dışı")}</div>
          {hoverCap != null && hoverCap > 0 && (
            <div style={{ color: "var(--text-dim, #9ca3af)" }}>%{fmt((totalLoad / hoverCap) * 100, 0)}</div>
          )}
        </div>
      )}

      {/* Lejant + çalışma noktası özeti (renk tek başına anlam taşımaz) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          fontSize: 10.5,
          color: "var(--text-dim, #9ca3af)",
          marginTop: 2,
          alignItems: "center",
        }}
      >
        <span>
          <svg width="14" height="6" aria-hidden="true">
            <line x1="0" x2="14" y1="3" y2="3" stroke="var(--blue, #5ad1ff)" strokeWidth="2" />
          </svg>{" "}
          {t("Kapasite")}
        </span>
        <span>
          <svg width="14" height="6" aria-hidden="true">
            <line x1="0" x2="14" y1="3" y2="3" stroke="var(--text-dim, #9ca3af)" strokeWidth="1.2" strokeDasharray="4 3" />
          </svg>{" "}
          {t("Toplam yük")}
        </span>
        {others.length > 0 && (
          <span>
            <svg width="14" height="6" aria-hidden="true">
              <line x1="0" x2="14" y1="3" y2="3" stroke="var(--text-faint, #6b7280)" strokeWidth="1" opacity="0.6" />
            </svg>{" "}
            {t("Diğer bomlar")}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: "var(--text, #e2e2e6)", fontFamily: "var(--mono, monospace)" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 12,
              height: 12,
              borderRadius: 6,
              background: opColor,
              color: "#111",
              fontSize: 8,
              fontWeight: 800,
              marginRight: 4,
              verticalAlign: "-1px",
            }}
          >
            {opIcon}
          </span>
          {capNow != null ? `${fm(capNow)} · %${fmt(util ?? 0, 0)}` : ""} {opLabel}
        </span>
      </div>
    </div>
  );
}

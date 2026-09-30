// Üstten kapasite haritası — SitePlan ile aynı yönlendirme: saha +X = kuzey
// (yukarı), +Z = doğu (sağ). SVG: ekran x = site z, ekran y = −site x (metre).
// Hücreler durum renginde; çarpışma hücreleri ayrıca taralı (renk tek başına
// anlam taşımaz). Hover: ipucu; tıklama: onPick(siteX, siteZ).

import { useMemo, useRef, useState } from "react";
import type { ReachMap, ReachCell, ReachStatus } from "../engine/reachMap.js";
import type { SceneObject } from "../engine/types.js";
import { useI18n } from "./i18n";
import { useUnits } from "./units";

export interface ReachMapViewProps {
  map: ReachMap;
  craneX: number;
  craneZ: number;
  heading: number;
  slewAngle: number;
  radius: number;
  Lx: number;
  Ly: number;
  rearFraction: number;
  objects: SceneObject[];
  onPick?: (x: number, z: number) => void;
}

const DEG = Math.PI / 180;

const STATUS_META: Record<Exclude<ReachStatus, "unreachable">, { label: string; fill: string; icon: string }> = {
  ok: { label: "Uygun", fill: "var(--rm-good)", icon: "✓" },
  warn: { label: "Sınırda (≥%90)", fill: "var(--rm-warn)", icon: "!" },
  over: { label: "Aşım / devrilme", fill: "var(--rm-crit)", icon: "✕" },
  collision: { label: "Çarpışma", fill: "var(--rm-coll)", icon: "⚠" },
};
const ORDER: Array<Exclude<ReachStatus, "unreachable">> = ["ok", "warn", "over", "collision"];

/** Site (x,z) → SVG (sx, sy). */
const P = (x: number, z: number): [number, number] => [z, -x];
const pt = (x: number, z: number) => {
  const [a, b] = P(x, z);
  return `${a.toFixed(2)},${b.toFixed(2)}`;
};

/** Şasi/nesne yerel (lx, lz) → site, açı (°) kadar döndürülmüş (collision.ts ile aynı işaret). */
function rot(lx: number, lz: number, deg: number): [number, number] {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [lx * c - lz * s, lx * s + lz * c];
}

let fmtLocale = "tr-TR";
const fmt = (v: number, d = 1) => v.toLocaleString(fmtLocale, { maximumFractionDigits: d });

export default function ReachMapView({
  map,
  craneX,
  craneZ,
  heading,
  slewAngle,
  radius,
  Lx,
  Ly,
  rearFraction,
  objects,
  onPick,
}: ReachMapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { t, lang } = useI18n();
  const un = useUnits();
  fmtLocale = lang === "en" ? "en-US" : "tr-TR";
  const [hover, setHover] = useState<{ cell: ReachCell | null; px: number; py: number } | null>(null);

  const half = Math.max(map.extent, radius + 2, 5) + 1.5;
  const [vx, vy] = P(craneX, craneZ);
  const viewBox = `${(vx - half).toFixed(2)} ${(vy - half).toFixed(2)} ${(2 * half).toFixed(2)} ${(2 * half).toFixed(2)}`;
  const c = map.cell;

  // Hücreler: durum başına tek path (5000+ rect yerine hızlı).
  const { paths, index } = useMemo(() => {
    const d: Record<string, string[]> = { ok: [], warn: [], over: [], collision: [] };
    const idx = new Map<string, ReachCell>();
    for (const cell of map.cells) {
      idx.set(`${Math.floor((cell.x - craneX) / c)}|${Math.floor((cell.z - craneZ) / c)}`, cell);
      if (cell.status === "unreachable") continue;
      const [sx, sy] = P(cell.x, cell.z);
      d[cell.status].push(`M${(sx - c / 2).toFixed(2)} ${(sy - c / 2).toFixed(2)}h${c}v${c}h${-c}z`);
    }
    return { paths: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.join("")])), index: idx };
  }, [map, craneX, craneZ, c]);

  const present = useMemo(() => {
    const s = new Set<ReachStatus>();
    map.cells.forEach((cell) => s.add(cell.status));
    return s;
  }, [map]);

  // Halka aralığı: 5 m (büyük haritada 10 m); etiket her 10 m.
  // Imperial: 20 ft (büyük haritada 50 ft); etiket her 100 ft / 20 ft.
  // rings: [site metre yarıçapı, görüntü birimi değeri]
  const ringStepD = un.imperial ? (un.len(map.max_radius) > 130 ? 50 : 20) : map.max_radius > 40 ? 10 : 5;
  const labelEvery = un.imperial ? (ringStepD === 50 ? 100 : ringStepD) : 10;
  const rings: Array<{ r: number; d: number }> = [];
  const maxD = un.len(Math.max(map.max_radius, radius)) + 1e-9;
  for (let d = ringStepD; d <= maxD; d += ringStepD) rings.push({ r: un.fromLen(d), d });

  // Ayak dikdörtgeni (şasiye sabit): arka = f·Lx (+X), ön = (1−f)·Lx.
  const rear = Lx * rearFraction;
  const front = Lx * (1 - rearFraction);
  const foot = [
    [rear, Ly / 2],
    [rear, -Ly / 2],
    [-front, -Ly / 2],
    [-front, Ly / 2],
  ].map(([a, b]) => {
    const [x, z] = rot(a, b, heading);
    return pt(craneX + x, craneZ + z);
  });
  const frontTip = rot(-front - 1.5, 0, heading);
  const frontBase = rot(-front + 0.2, 0, heading);

  const boomAng = heading + slewAngle;
  const hookX = craneX + radius * Math.cos(boomAng * DEG);
  const hookZ = craneZ + radius * Math.sin(boomAng * DEG);

  // Ölçeğe bağlı çizgi kalınlıkları (viewBox metre cinsinden).
  const u = (2 * half) / 500; // ~1 px (500 px'lik görünümde)

  function toSite(e: React.MouseEvent): { x: number; z: number; px: number; py: number } | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const rect = svg.getBoundingClientRect();
    return { x: -p.y, z: p.x, px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function onMove(e: React.MouseEvent) {
    const s = toSite(e);
    if (!s) return;
    const cell = index.get(`${Math.floor((s.x - craneX) / c)}|${Math.floor((s.z - craneZ) / c)}`) ?? null;
    setHover({ cell, px: s.px, py: s.py });
  }

  function onClick(e: React.MouseEvent) {
    if (!onPick) return;
    const s = toSite(e);
    if (!s) return;
    const cell = index.get(`${Math.floor((s.x - craneX) / c)}|${Math.floor((s.z - craneZ) / c)}`);
    if (cell) onPick(cell.x, cell.z);
    else onPick(s.x, s.z);
  }

  const hc = hover?.cell;
  const hcR = hc ? Math.hypot(hc.x - craneX, hc.z - craneZ) : 0;
  let hcAng = hc ? Math.atan2(hc.z - craneZ, hc.x - craneX) / DEG - heading : 0;
  hcAng = ((hcAng % 360) + 360) % 360;

  return (
    <div className="reach-map" style={{ position: "relative", width: "100%", height: "100%", minHeight: 200 }}>
      <style>{`
        .reach-map { --rm-good:#0ca30c; --rm-warn:#fab219; --rm-crit:#d03b3b; --rm-coll:#9085e9; }
        .reach-map text { font-family: var(--mono, monospace); }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={
          t("Üstten kapasite haritası. Erişim {min}–{max} {u}", {
            min: fmt(un.len(map.min_radius)),
            max: fmt(un.len(map.max_radius)),
            u: un.lenU,
          }) +
          (map.best_utilization != null ? t(", en düşük kullanım %{p}", { p: fmt(map.best_utilization, 0) }) : "") +
          "."
        }
        style={{ display: "block", background: "var(--bg, #0c0e11)", cursor: onPick ? "crosshair" : "default" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        <defs>
          <pattern id="rm-hatch" patternUnits="userSpaceOnUse" width={c} height={c} patternTransform="rotate(45)">
            <rect width={c} height={c} fill="var(--rm-coll)" opacity={0.55} />
            <line x1={0} y1={0} x2={0} y2={c} stroke="var(--bg, #0c0e11)" strokeWidth={c * 0.35} />
          </pattern>
        </defs>

        {/* Hücreler */}
        <g opacity={0.72}>
          {(["ok", "warn", "over"] as const).map((k) =>
            paths[k] ? <path key={k} d={paths[k]} fill={STATUS_META[k].fill} /> : null,
          )}
          {paths.collision ? <path d={paths.collision} fill="url(#rm-hatch)" /> : null}
        </g>

        {/* Radius halkaları */}
        <g fill="none" stroke="var(--border-2, #37393d)" strokeWidth={u}>
          {rings.map(({ r, d }) => (
            <circle key={d} cx={vx} cy={vy} r={r} strokeDasharray={`${3 * u} ${3 * u}`} />
          ))}
          <circle cx={vx} cy={vy} r={map.max_radius} stroke="var(--text-faint, #6b7280)" strokeWidth={1.2 * u} />
          {map.min_radius > 0 && <circle cx={vx} cy={vy} r={map.min_radius} stroke="var(--text-faint, #6b7280)" strokeWidth={u} />}
        </g>
        <g fontSize={11 * u} fill="var(--text-dim, #9ca3af)">
          {rings
            .filter(({ d }) => d % labelEvery === 0 || (!un.imperial && ringStepD === 5))
            .map(({ r, d }) => (
              <text key={d} x={vx + r * Math.SQRT1_2 + 0.3} y={vy - r * Math.SQRT1_2 - 0.3} paintOrder="stroke" stroke="var(--bg, #0c0e11)" strokeWidth={3 * u}>
                {d} {un.lenU}
              </text>
            ))}
        </g>

        {/* Çevre nesneleri */}
        {objects.map((o) => {
          const w2 = Math.max(o.width, 0.1) / 2;
          const d2 = Math.max(o.depth, 0.1) / 2;
          const poly = [
            [w2, d2],
            [w2, -d2],
            [-w2, -d2],
            [-w2, d2],
          ]
            .map(([a, b]) => {
              const [x, z] = rot(a, b, o.rotationY ?? 0);
              return pt(o.x + x, o.z + z);
            })
            .join(" ");
          const [lx, ly] = P(o.x, o.z);
          const under = o.kind === "underground";
          return (
            <g key={o.id}>
              <polygon
                points={poly}
                fill="var(--text-faint, #6b7280)"
                fillOpacity={under ? 0.1 : 0.45}
                stroke="var(--text-dim, #9ca3af)"
                strokeWidth={1.2 * u}
                strokeDasharray={under ? `${4 * u} ${3 * u}` : undefined}
              />
              <text x={lx} y={ly} fontSize={10 * u} textAnchor="middle" dominantBaseline="middle" fill="var(--text, #e2e2e6)" paintOrder="stroke" stroke="var(--bg, #0c0e11)" strokeWidth={3 * u}>
                {o.label}
              </text>
            </g>
          );
        })}

        {/* Ayak izi + kirişler */}
        <polygon points={foot.join(" ")} fill="var(--accent, #ffba20)" fillOpacity={0.12} stroke="var(--accent, #ffba20)" strokeWidth={1.5 * u} />
        <g stroke="var(--accent, #ffba20)" strokeWidth={u} opacity={0.7}>
          {foot.map((f, i) => {
            const [a, b] = f.split(",");
            return <line key={i} x1={vx} y1={vy} x2={a} y2={b} />;
          })}
        </g>
        {/* Şasi önü oku */}
        {(() => {
          const [ax, ay] = P(craneX + frontBase[0], craneZ + frontBase[1]);
          const [bx, by] = P(craneX + frontTip[0], craneZ + frontTip[1]);
          return (
            <g>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--accent, #ffba20)" strokeWidth={1.5 * u} />
              <text x={bx} y={by} fontSize={10 * u} textAnchor="middle" dominantBaseline="middle" fill="var(--accent, #ffba20)" paintOrder="stroke" stroke="var(--bg, #0c0e11)" strokeWidth={3 * u}>
                {t("Ön")}
              </text>
            </g>
          );
        })()}

        {/* Bom + kanca */}
        {(() => {
          const [hx, hy] = P(hookX, hookZ);
          return (
            <g>
              <line x1={vx} y1={vy} x2={hx} y2={hy} stroke="var(--orange, #ff6700)" strokeWidth={2.5 * u} strokeLinecap="round" />
              <circle cx={hx} cy={hy} r={5 * u} fill="var(--orange, #ff6700)" stroke="var(--bg, #0c0e11)" strokeWidth={2 * u} />
              <circle cx={hx} cy={hy} r={9 * u} fill="none" stroke="var(--orange, #ff6700)" strokeWidth={u} />
            </g>
          );
        })()}
        <circle cx={vx} cy={vy} r={3.5 * u} fill="var(--text, #e2e2e6)" stroke="var(--bg, #0c0e11)" strokeWidth={1.5 * u} />

        {/* Hover hücre çerçevesi */}
        {hc && (
          <rect
            x={P(hc.x, hc.z)[0] - c / 2}
            y={P(hc.x, hc.z)[1] - c / 2}
            width={c}
            height={c}
            fill="none"
            stroke="var(--text, #e2e2e6)"
            strokeWidth={1.5 * u}
            pointerEvents="none"
          />
        )}

        {/* Kuzey oku */}
        <g transform={`translate(${vx + half - 2.2}, ${vy - half + 2.2})`}>
          <text fontSize={12 * u} textAnchor="middle" fill="var(--text-dim, #9ca3af)" y={-4 * u}>
            {t("K")} ↑
          </text>
        </g>
      </svg>

      {/* Lejant */}
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          background: "var(--panel, #15171b)",
          border: "1px solid var(--border, #282a2d)",
          borderRadius: 7,
          padding: "6px 8px",
          fontSize: 11,
          color: "var(--text-dim, #9ca3af)",
          display: "grid",
          gap: 3,
          pointerEvents: "none",
        }}
      >
        {ORDER.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, opacity: present.has(k) ? 1 : 0.5 }}>
            <svg width="12" height="12" aria-hidden="true">
              {k === "collision" ? (
                <>
                  <rect width="12" height="12" rx="2" fill="#9085e9" opacity="0.6" />
                  <path d="M0 12L12 0M-3 3L3 -3M9 15L15 9" stroke="var(--panel, #15171b)" strokeWidth="2.5" />
                </>
              ) : (
                <rect width="12" height="12" rx="2" fill={STATUS_META[k].fill} opacity="0.8" />
              )}
            </svg>
            <span>{t(STATUS_META[k].label)}</span>
          </div>
        ))}
        {map.best_utilization != null && (
          <div style={{ marginTop: 2, color: "var(--text, #e2e2e6)", fontFamily: "var(--mono, monospace)" }}>
            {t("En iyi %{p}", { p: fmt(map.best_utilization, 0) })}
          </div>
        )}
        {map.tail_warnings?.map((w, i) => (
          <div key={i} style={{ color: "var(--text, #e2e2e6)", maxWidth: 200 }}>
            ⚠ {w}
          </div>
        ))}
        {map.error && <div style={{ color: "var(--text, #e2e2e6)", maxWidth: 200 }}>⚠ {map.error}</div>}
      </div>

      {/* İpucu */}
      {hover && hc && (
        <div
          style={{
            position: "absolute",
            left: hover.px + 14,
            top: hover.py + 14,
            transform: hover.px > (svgRef.current?.clientWidth ?? 600) / 2 ? "translateX(calc(-100% - 28px))" : undefined,
            pointerEvents: "none",
            background: "var(--panel-2, #1a1c1f)",
            border: "1px solid var(--border-2, #37393d)",
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 11.5,
            color: "var(--text, #e2e2e6)",
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {hc.status === "unreachable" ? t("Erişilemez") : `${STATUS_META[hc.status].icon} ${t(STATUS_META[hc.status].label)}`}
          </div>
          <div style={{ fontFamily: "var(--mono, monospace)", color: "var(--text-dim, #9ca3af)" }}>
            R {fmt(un.len(hcR))} {un.lenU} · {t("Dönme")} {fmt(hcAng, 0)}°
          </div>
          {hc.utilization_pct != null && (
            <div style={{ fontFamily: "var(--mono, monospace)" }}>{t("Kullanım %{p}", { p: fmt(hc.utilization_pct, 0) })}</div>
          )}
          {hc.reason && <div style={{ color: "var(--text-dim, #9ca3af)", maxWidth: 260, whiteSpace: "normal" }}>{hc.reason}</div>}
          {onPick && hc.status !== "unreachable" && (
            <div style={{ color: "var(--text-faint, #6b7280)", fontSize: 10.5 }}>{t("Tıkla: bu noktaya ayarla")}</div>
          )}
        </div>
      )}
    </div>
  );
}

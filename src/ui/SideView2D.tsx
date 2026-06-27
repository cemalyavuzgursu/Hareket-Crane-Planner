import type { ClearanceResult } from "../engine/clearance";
import type { GeometryConstants } from "../engine/types";

export interface SideView2DProps {
  g: GeometryConstants;
  clearance: ClearanceResult;
  boom_length: number;
  radius: number;
  load_height: number;
  load_diameter: number;
  obstacle_height: number;
  obstacle_distance: number;
  obstacle_width: number;
}

/**
 * Gerçek mobil teleskopik vinç yan görünüşü (blueprint stili).
 * Geometri: slew merkezi x=0. Bom dibi x=-boom_offset (merkez gerisinde) →
 * bom ucu yatayda ~radius'a düşer (z*cos(gama)=radius+boom_offset).
 */
export default function SideView2D(props: SideView2DProps) {
  const { g, clearance, boom_length, radius, load_height, load_diameter, obstacle_height, obstacle_distance, obstacle_width } = props;

  const base = g.cribbing_height + g.machine_ground_height; // bom dibi yüksekliği
  const gama = clearance.gama;
  const ux = Math.cos(gama), uy = Math.sin(gama); // bom yön vektörü
  const nx = -Math.sin(gama), ny = Math.cos(gama); // normal

  const foot = { x: -g.boom_offset, y: base };
  const tip = { x: foot.x + boom_length * ux, y: foot.y + boom_length * uy };
  const loadX = radius;
  const obstacleX = radius - obstacle_distance;
  const warn = clearance.clearance_to_load < 0 || clearance.clearance_to_obstacle < 0;

  // Dünya sınırları → ekran
  const span = Math.max(radius, tip.x) + Math.max(load_diameter, 3);
  const minX = -g.boom_offset - 4;
  const maxX = span + 2;
  const minY = 0;
  const maxY = Math.max(tip.y, clearance.max_hook_height, obstacle_height, load_height) + 3;

  const W = 820, H = 500, padL = 50, padR = 70, padT = 24, padB = 56;
  const s = Math.min((W - padL - padR) / (maxX - minX), (H - padT - padB) / (maxY - minY));
  const X = (x: number) => padL + (x - minX) * s;
  const Y = (y: number) => H - padB - (y - minY) * s;
  const gnd = Y(0);

  // Bom polygonu (teleskopik, hafif konik)
  const wb = 0.62, wt = 0.34; // dip/uç yarı-kalınlık (m)
  const bp = (px: number, py: number, w: number, sign: number) => `${X(px + sign * w * nx)},${Y(py + sign * w * ny)}`;
  const boomPoly = [bp(foot.x, foot.y, wb, 1), bp(tip.x, tip.y, wt, 1), bp(tip.x, tip.y, wt, -1), bp(foot.x, foot.y, wb, -1)].join(" ");
  // Teleskop bölme çizgileri
  const sections = [0.28, 0.52, 0.74].map((t) => {
    const px = foot.x + boom_length * t * ux, py = foot.y + boom_length * t * uy;
    const w = wb + (wt - wb) * t;
    return { x1: X(px + w * nx), y1: Y(py + w * ny), x2: X(px - w * nx), y2: Y(py - w * ny) };
  });

  const steel = "#aebfd4", steelDim = "#6f86a6", dim = "#5f86ad", dimText = "#90b4d8";
  const boomStroke = warn ? "#ff5a4d" : "#f5b942";
  const boomFill = warn ? "rgba(255,90,77,.14)" : "rgba(245,185,66,.13)";

  // Tekerlekler (5 aks)
  const wheelR = 0.78;
  const axleXs = [-4.4, -2.7, 1.0, 2.7, 4.4];
  // Outrigger pad x (±Lx/2 yaklaşık) — carrier dışına
  const outX = Math.max(radius * 0.0 + 5.5, 5.5);

  // Radius yay (bom ucunun luffing yörüngesi) — bom dibi merkezli
  const arcR = boom_length;
  const arcA0 = 18 * Math.PI / 180; // alt açı
  const arcStart = { x: foot.x + arcR * Math.cos(arcA0), y: foot.y + arcR * Math.sin(arcA0) };
  const arcEnd = { x: tip.x, y: tip.y };
  const largeArc = gama - arcA0 > Math.PI ? 1 : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <linearGradient id="bp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1a2f" />
          <stop offset="100%" stopColor="#0c1f38" />
        </linearGradient>
        <pattern id="hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#33506f" strokeWidth="1" />
        </pattern>
        <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6" fill="none" stroke={dim} strokeWidth="1.2" />
        </marker>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#bp)" />

      {/* Zemin */}
      <line x1={0} y1={gnd} x2={W} y2={gnd} stroke={steel} strokeWidth={1.6} />
      {Array.from({ length: 60 }).map((_, i) => (
        <line key={i} x1={i * 16} y1={gnd} x2={i * 16 - 7} y2={gnd + 7} stroke="#24405c" strokeWidth={1} />
      ))}

      {/* ===== ŞASİ / CARRIER ===== */}
      {/* Outrigger ayakları (ön + arka, çapraz + pad) */}
      {[-1, 1].map((sgn) => {
        const px = sgn * outX;
        const top = { x: sgn * 1.6, y: 1.5 };
        return (
          <g key={sgn}>
            <line x1={X(top.x)} y1={Y(top.y)} x2={X(px)} y2={Y(0.35)} stroke={steel} strokeWidth={3} strokeLinecap="round" />
            <rect x={X(px) - 12} y={Y(0.35)} width={24} height={Math.max(4, Y(0) - Y(0.35))} rx={2} fill="#16314b" stroke={steel} strokeWidth={1.3} />
          </g>
        );
      })}

      {/* Tekerlekler */}
      {axleXs.map((ax, i) => (
        <g key={i}>
          <circle cx={X(ax)} cy={Y(wheelR)} r={wheelR * s} fill="#0e2236" stroke={steel} strokeWidth={1.4} />
          <circle cx={X(ax)} cy={Y(wheelR)} r={wheelR * s * 0.42} fill="none" stroke={steelDim} strokeWidth={1.2} />
        </g>
      ))}

      {/* Şasi gövdesi */}
      <path
        d={`M ${X(-6.2)} ${Y(1.35)} L ${X(4.4)} ${Y(1.35)} L ${X(5.6)} ${Y(2.0)} L ${X(5.6)} ${Y(2.55)} L ${X(-6.2)} ${Y(2.55)} Z`}
        fill="#11293f" stroke={steel} strokeWidth={1.5}
      />
      {/* Operatör kabini (ön) */}
      <path d={`M ${X(3.0)} ${Y(2.55)} L ${X(5.4)} ${Y(2.55)} L ${X(5.4)} ${Y(3.9)} L ${X(4.4)} ${Y(4.3)} L ${X(3.0)} ${Y(4.3)} Z`}
        fill="#13314a" stroke={steel} strokeWidth={1.4} />
      <rect x={X(3.4)} y={Y(4.05)} width={X(5.0) - X(3.4)} height={Y(2.95) - Y(4.05)} fill="rgba(120,170,210,.18)" stroke={steelDim} strokeWidth={1} />

      {/* ===== ÜST YAPI (slewing) ===== */}
      {/* Turntable / döner platform */}
      <path d={`M ${X(-5.2)} ${Y(2.55)} L ${X(2.2)} ${Y(2.55)} L ${X(1.4)} ${Y(base - 0.1)} L ${X(-4.6)} ${Y(base - 0.1)} Z`}
        fill="#16344e" stroke={steel} strokeWidth={1.5} />
      {/* Denge ağırlığı (arka, plakalar) */}
      <rect x={X(-6.0)} y={Y(base + 0.9)} width={X(-4.2) - X(-6.0)} height={Y(2.4) - Y(base + 0.9)} rx={2}
        fill="#1c2c3e" stroke={steel} strokeWidth={1.5} />
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={X(-6.0)} y1={Y(2.4) + (Y(base + 0.9) - Y(2.4)) * t} x2={X(-4.2)} y2={Y(2.4) + (Y(base + 0.9) - Y(2.4)) * t} stroke={steelDim} strokeWidth={1} />
      ))}

      {/* Takoz (cribbing) altında */}
      <rect x={X(-4.6)} y={Y(g.cribbing_height)} width={X(1.4) - X(-4.6)} height={Y(0) - Y(g.cribbing_height)} fill="url(#hatch)" stroke={steelDim} strokeWidth={1} />

      {/* ===== BOM (teleskopik) ===== */}
      <polygon points={boomPoly} fill={boomFill} stroke={boomStroke} strokeWidth={2} strokeLinejoin="round" />
      {sections.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={boomStroke} strokeWidth={1.1} opacity={0.7} />
      ))}
      {/* Bom dibi pivot */}
      <circle cx={X(foot.x)} cy={Y(foot.y)} r={4} fill="#0c1f38" stroke={steel} strokeWidth={1.5} />

      {/* Bom ucu makara + kanca bloğu */}
      <circle cx={X(tip.x)} cy={Y(tip.y)} r={3.5} fill="#0c1f38" stroke={boomStroke} strokeWidth={1.5} />
      <line x1={X(tip.x)} y1={Y(tip.y)} x2={X(loadX)} y2={Y(load_height + 1.0)} stroke={steel} strokeWidth={1.3} />
      {/* Kanca bloğu */}
      <rect x={X(loadX) - 5} y={Y(load_height + 1.0)} width={10} height={11} rx={2} fill="#16314b" stroke={steel} strokeWidth={1.2} />
      <path d={`M ${X(loadX)} ${Y(load_height + 1.0) + 11} q 5 4 0 8 q -5 -4 0 -8`} fill="none" stroke={steel} strokeWidth={1.3} />

      {/* ===== YÜK + spreader ===== */}
      {/* Spreader bar (kaldırma çerçevesi) */}
      <line x1={X(loadX)} y1={Y(load_height + 0.55)} x2={X(loadX - load_diameter / 2 + 0.3)} y2={Y(load_height)} stroke={steel} strokeWidth={1.2} />
      <line x1={X(loadX)} y1={Y(load_height + 0.55)} x2={X(loadX + load_diameter / 2 - 0.3)} y2={Y(load_height)} stroke={steel} strokeWidth={1.2} />
      <rect x={X(loadX - load_diameter / 2)} y={Y(load_height)} width={X(load_diameter) - X(0)} height={gnd - Y(load_height)}
        rx={2} fill={warn ? "rgba(255,90,77,.16)" : "rgba(110,134,166,.18)"} stroke={warn ? "#ff5a4d" : steel} strokeWidth={1.6} />
      <line x1={X(loadX - load_diameter / 2)} y1={Y(load_height)} x2={X(loadX + load_diameter / 2)} y2={gnd} stroke={steelDim} strokeWidth={0.8} opacity={0.5} />
      <line x1={X(loadX + load_diameter / 2)} y1={Y(load_height)} x2={X(loadX - load_diameter / 2)} y2={gnd} stroke={steelDim} strokeWidth={0.8} opacity={0.5} />
      <text x={X(loadX)} y={(Y(load_height) + gnd) / 2 + 4} fill="#dbe6f2" fontSize={11} textAnchor="middle" fontWeight={600}>YÜK</text>

      {/* ===== ENGEL (bina) ===== */}
      {obstacle_height > 0 && (() => {
        const ow = Math.max(0.3, obstacle_width);
        const ox0 = X(obstacleX - ow / 2);
        const owPx = X(obstacleX + ow / 2) - ox0;
        const oTop = Y(obstacle_height);
        const oH = gnd - oTop;
        const cols = Math.max(1, Math.round(ow / 1.6));
        const rows = Math.max(1, Math.round(obstacle_height / 1.4));
        return (
          <g>
            <rect x={ox0} y={oTop} width={owPx} height={oH} fill="rgba(245,185,66,.07)" stroke="#f5b942" strokeWidth={1.4} />
            {Array.from({ length: rows }).map((_, r) =>
              Array.from({ length: cols }).map((_, c) => (
                <rect key={`${r}-${c}`}
                  x={ox0 + (owPx / cols) * c + owPx / cols * 0.22}
                  y={oTop + (oH / rows) * r + (oH / rows) * 0.2}
                  width={(owPx / cols) * 0.56} height={(oH / rows) * 0.55}
                  fill="none" stroke="#a9802f" strokeWidth={0.8} />
              )),
            )}
            <text x={(ox0 + owPx / 2)} y={oTop - 6} fill="#f5b942" fontSize={10} textAnchor="middle">ENGEL</text>
          </g>
        );
      })()}

      {/* ===== ÖLÇÜ ÇİZGİLERİ ===== */}
      {/* Luffing yayı */}
      <path d={`M ${X(arcStart.x)} ${Y(arcStart.y)} A ${arcR * s} ${arcR * s} 0 ${largeArc} 0 ${X(arcEnd.x)} ${Y(arcEnd.y)}`}
        fill="none" stroke={dim} strokeWidth={1} strokeDasharray="5 5" opacity={0.7} />
      {/* Bom açısı */}
      <text x={X(foot.x) + 16} y={Y(foot.y) - 6} fill={boomStroke} fontSize={12} fontWeight={700}>γ {(gama * 180 / Math.PI).toFixed(1)}°</text>

      {/* Radius ölçüsü (zeminde) */}
      <line x1={X(0)} y1={gnd + 22} x2={X(radius)} y2={gnd + 22} stroke={dim} strokeWidth={1} markerEnd="url(#ah)" markerStart="url(#ah)" />
      <line x1={X(0)} y1={gnd} x2={X(0)} y2={gnd + 26} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <line x1={X(radius)} y1={Y(load_height)} x2={X(radius)} y2={gnd + 26} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <text x={(X(0) + X(radius)) / 2} y={gnd + 36} fill={dimText} fontSize={10.5} textAnchor="middle">RADIUS {radius.toFixed(1)} m</text>

      {/* Maks koça yüksekliği (sağ dikey ölçü) */}
      <line x1={X(maxX - 1.2)} y1={gnd} x2={X(maxX - 1.2)} y2={Y(clearance.max_hook_height)} stroke={dim} strokeWidth={1} markerEnd="url(#ah)" markerStart="url(#ah)" />
      <line x1={X(tip.x)} y1={Y(clearance.max_hook_height)} x2={X(maxX - 1.2)} y2={Y(clearance.max_hook_height)} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <text x={X(maxX - 1.2) + 4} y={Y(clearance.max_hook_height / 2)} fill={dimText} fontSize={10} transform={`rotate(90 ${X(maxX - 1.2) + 4} ${Y(clearance.max_hook_height / 2)})`} textAnchor="middle">
        maks koça {clearance.max_hook_height.toFixed(2)} m
      </text>

      {/* Klerens rozeti */}
      <g>
        <rect x={W - 232} y={14} width={216} height={46} rx={8} fill="rgba(8,18,32,.9)" stroke="#23425f" />
        <text x={W - 220} y={31} fontSize={11} fill={dimText}>Engel klerensi</text>
        <text x={W - 24} y={31} fontSize={12.5} textAnchor="end" fontFamily="monospace" fontWeight={700}
          fill={clearance.clearance_to_obstacle < 0 ? "#ff5a4d" : "#00e475"}>{clearance.clearance_to_obstacle.toFixed(2)} m</text>
        <text x={W - 220} y={49} fontSize={11} fill={dimText}>Yük klerensi</text>
        <text x={W - 24} y={49} fontSize={12.5} textAnchor="end" fontFamily="monospace" fontWeight={700}
          fill={clearance.clearance_to_load < 0 ? "#ff5a4d" : clearance.clearance_to_load < 1 ? "#ffba20" : "#00e475"}>{clearance.clearance_to_load.toFixed(2)} m</text>
      </g>
    </svg>
  );
}

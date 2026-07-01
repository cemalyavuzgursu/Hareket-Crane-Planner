// Vinç yandan görünüş (2D) — react-native-svg. Masaüstü SideView2D'nin
// mobil uyarlaması; geometri matematiği birebir aynıdır (bom açısı, klerens).
import React from "react";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  Line,
  Circle,
  Polygon,
  Path,
  G,
  Text as SvgText,
} from "react-native-svg";
import type { ClearanceResult } from "../shared/engine/clearance";
import type { GeometryConstants } from "../shared/engine/types";
import { C } from "../theme";

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
  width: number; // ekran genişliği (px)
}

const VBW = 820;
const VBH = 500;

export default function SideView2D(props: SideView2DProps) {
  const {
    g, clearance, boom_length, radius, load_height, load_diameter,
    obstacle_height, obstacle_distance, obstacle_width, width,
  } = props;

  const height = (width * VBH) / VBW;

  const base = g.cribbing_height + g.machine_ground_height; // bom dibi yüksekliği
  const gama = clearance.gama;
  const ux = Math.cos(gama), uy = Math.sin(gama);
  const nx = -Math.sin(gama), ny = Math.cos(gama);

  const foot = { x: -g.boom_offset, y: base };
  const tip = { x: foot.x + boom_length * ux, y: foot.y + boom_length * uy };
  const loadX = radius;
  const obstacleX = radius - obstacle_distance;
  // clearance.ts (Excel) konvansiyonu: kanca yükün UZAK kenarında (x=radius),
  // kritik iç köşe (radius−load_diameter); yük engel ÜSTÜNDEN geçirilir.
  const loadL = radius - load_diameter;
  const loadBot = obstacle_height;
  const loadTop = obstacle_height + load_height;
  const warn = clearance.clearance_to_load < 0 || clearance.clearance_to_obstacle < 0;

  const span = Math.max(radius, tip.x) + Math.max(load_diameter, 3);
  const minX = Math.min(-g.boom_offset - 4, loadL - 2);
  const maxX = span + 2;
  const minY = 0;
  const maxY = Math.max(tip.y, clearance.max_hook_height, obstacle_height, loadTop) + 3;

  const padL = 46, padR = 60, padT = 20, padB = 52;
  const s = Math.min((VBW - padL - padR) / (maxX - minX), (VBH - padT - padB) / (maxY - minY));
  const X = (x: number) => padL + (x - minX) * s;
  const Y = (y: number) => VBH - padB - (y - minY) * s;
  const gnd = Y(0);

  const wb = 0.62, wt = 0.34;
  const bp = (px: number, py: number, w: number, sign: number) =>
    `${X(px + sign * w * nx)},${Y(py + sign * w * ny)}`;
  const boomPoly = [
    bp(foot.x, foot.y, wb, 1), bp(tip.x, tip.y, wt, 1),
    bp(tip.x, tip.y, wt, -1), bp(foot.x, foot.y, wb, -1),
  ].join(" ");
  const sections = [0.3, 0.55, 0.78].map((t) => {
    const px = foot.x + boom_length * t * ux, py = foot.y + boom_length * t * uy;
    const w = wb + (wt - wb) * t;
    return { x1: X(px + w * nx), y1: Y(py + w * ny), x2: X(px - w * nx), y2: Y(py - w * ny) };
  });

  const boomStroke = warn ? C.red : C.accent;
  const boomFill = warn ? "rgba(255,90,77,0.14)" : "rgba(255,186,32,0.13)";
  const steel = C.steel, steelDim = C.steelDim, dim = "#5f86ad", dimText = "#90b4d8";

  const wheelR = 0.78;
  const axleXs = [-4.4, -2.7, 1.0, 2.7, 4.4];
  const outX = 5.5;

  // Radius ölçü ok başı (küçük üçgen)
  const arrow = (cx: number, cyv: number, dir: 1 | -1) =>
    `${cx},${cyv} ${cx + dir * 7},${cyv - 3.5} ${cx + dir * 7},${cyv + 3.5}`;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VBW} ${VBH}`}>
      <Defs>
        <LinearGradient id="bp" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#0a1a2f" />
          <Stop offset="100%" stopColor="#0c1f38" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={VBW} height={VBH} fill="url(#bp)" />

      {/* Zemin */}
      <Line x1={0} y1={gnd} x2={VBW} y2={gnd} stroke={steel} strokeWidth={1.6} />
      {Array.from({ length: 54 }).map((_, i) => (
        <Line key={`gh${i}`} x1={i * 16} y1={gnd} x2={i * 16 - 7} y2={gnd + 7} stroke="#24405c" strokeWidth={1} />
      ))}

      {/* Outrigger ayakları */}
      {[-1, 1].map((sgn) => {
        const px = sgn * outX;
        const top = { x: sgn * 1.6, y: 1.5 };
        return (
          <G key={`o${sgn}`}>
            <Line x1={X(top.x)} y1={Y(top.y)} x2={X(px)} y2={Y(0.35)} stroke={steel} strokeWidth={3} strokeLinecap="round" />
            <Rect x={X(px) - 12} y={Y(0.35)} width={24} height={Math.max(4, Y(0) - Y(0.35))} rx={2} fill="#16314b" stroke={steel} strokeWidth={1.3} />
          </G>
        );
      })}

      {/* Tekerlekler */}
      {axleXs.map((ax, i) => (
        <G key={`w${i}`}>
          <Circle cx={X(ax)} cy={Y(wheelR)} r={wheelR * s} fill="#0e2236" stroke={steel} strokeWidth={1.4} />
          <Circle cx={X(ax)} cy={Y(wheelR)} r={wheelR * s * 0.42} fill="none" stroke={steelDim} strokeWidth={1.2} />
        </G>
      ))}

      {/* Şasi gövdesi */}
      <Path
        d={`M ${X(-6.2)} ${Y(1.35)} L ${X(4.4)} ${Y(1.35)} L ${X(5.6)} ${Y(2.0)} L ${X(5.6)} ${Y(2.55)} L ${X(-6.2)} ${Y(2.55)} Z`}
        fill="#11293f" stroke={steel} strokeWidth={1.5}
      />
      {/* Kabin */}
      <Path d={`M ${X(3.0)} ${Y(2.55)} L ${X(5.4)} ${Y(2.55)} L ${X(5.4)} ${Y(3.9)} L ${X(4.4)} ${Y(4.3)} L ${X(3.0)} ${Y(4.3)} Z`}
        fill="#13314a" stroke={steel} strokeWidth={1.4} />

      {/* Döner platform */}
      <Path d={`M ${X(-5.2)} ${Y(2.55)} L ${X(2.2)} ${Y(2.55)} L ${X(1.4)} ${Y(base - 0.1)} L ${X(-4.6)} ${Y(base - 0.1)} Z`}
        fill="#16344e" stroke={steel} strokeWidth={1.5} />
      {/* Denge ağırlığı */}
      <Rect x={X(-6.0)} y={Y(base + 0.9)} width={X(-4.2) - X(-6.0)} height={Y(2.4) - Y(base + 0.9)} rx={2}
        fill="#1c2c3e" stroke={steel} strokeWidth={1.5} />

      {/* Takoz */}
      <Rect x={X(-4.6)} y={Y(g.cribbing_height)} width={X(1.4) - X(-4.6)} height={Y(0) - Y(g.cribbing_height)}
        fill="rgba(51,80,111,0.35)" stroke={steelDim} strokeWidth={1} />

      {/* Bom */}
      <Polygon points={boomPoly} fill={boomFill} stroke={boomStroke} strokeWidth={2} strokeLinejoin="round" />
      {sections.map((l, i) => (
        <Line key={`sec${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={boomStroke} strokeWidth={1.1} opacity={0.7} />
      ))}
      <Circle cx={X(foot.x)} cy={Y(foot.y)} r={4} fill="#0c1f38" stroke={steel} strokeWidth={1.5} />

      {/* Bom ucu + kanca halatı */}
      <Circle cx={X(tip.x)} cy={Y(tip.y)} r={3.5} fill="#0c1f38" stroke={boomStroke} strokeWidth={1.5} />
      <Line x1={X(tip.x)} y1={Y(tip.y)} x2={X(loadX)} y2={Y(loadTop + 1.0)} stroke={steel} strokeWidth={1.3} />
      <Rect x={X(loadX) - 5} y={Y(loadTop + 1.0)} width={10} height={11} rx={2} fill="#16314b" stroke={steel} strokeWidth={1.2} />

      {/* Yük — kanca uzak kenar üstünde, kutu engel üstünden geçer */}
      <Line x1={X(loadX)} y1={Y(loadTop + 0.55)} x2={X(loadL + 0.3)} y2={Y(loadTop)} stroke={steel} strokeWidth={1.2} />
      <Line x1={X(loadX)} y1={Y(loadTop + 0.55)} x2={X(loadX - 0.3)} y2={Y(loadTop)} stroke={steel} strokeWidth={1.2} />
      <Rect x={X(loadL)} y={Y(loadTop)} width={X(load_diameter) - X(0)} height={Y(loadBot) - Y(loadTop)}
        rx={2} fill={warn ? "rgba(255,90,77,0.16)" : "rgba(110,134,166,0.18)"} stroke={warn ? C.red : steel} strokeWidth={1.6} />
      <SvgText x={X(loadX - load_diameter / 2)} y={(Y(loadTop) + Y(loadBot)) / 2 + 4} fill="#dbe6f2" fontSize={12} textAnchor="middle" fontWeight="600">YÜK</SvgText>

      {/* Engel */}
      {obstacle_height > 0 && (() => {
        const ow = Math.max(0.3, obstacle_width);
        const ox0 = X(obstacleX - ow / 2);
        const owPx = X(obstacleX + ow / 2) - ox0;
        const oTop = Y(obstacle_height);
        const oH = gnd - oTop;
        return (
          <G>
            <Rect x={ox0} y={oTop} width={owPx} height={oH} fill="rgba(255,186,32,0.07)" stroke={C.accent} strokeWidth={1.4} />
            <SvgText x={ox0 + owPx / 2} y={oTop - 6} fill={C.accent} fontSize={11} textAnchor="middle">ENGEL</SvgText>
          </G>
        );
      })()}

      {/* Bom açısı */}
      <SvgText x={X(foot.x) + 16} y={Y(foot.y) - 6} fill={boomStroke} fontSize={13} fontWeight="700">
        {"γ " + ((gama * 180) / Math.PI).toFixed(1) + "°"}
      </SvgText>

      {/* Radius ölçüsü */}
      <Line x1={X(0)} y1={gnd + 22} x2={X(radius)} y2={gnd + 22} stroke={dim} strokeWidth={1} />
      <Polygon points={arrow(X(0), gnd + 22, 1)} fill={dim} />
      <Polygon points={arrow(X(radius), gnd + 22, -1)} fill={dim} />
      <Line x1={X(0)} y1={gnd} x2={X(0)} y2={gnd + 26} stroke={dim} strokeWidth={0.8} strokeDasharray="3 3" />
      <SvgText x={(X(0) + X(radius)) / 2} y={gnd + 38} fill={dimText} fontSize={11} textAnchor="middle">
        {"RADIUS " + radius.toFixed(1) + " m"}
      </SvgText>

      {/* Klerens rozeti */}
      <G>
        <Rect x={VBW - 236} y={14} width={220} height={48} rx={8} fill="rgba(8,18,32,0.9)" stroke="#23425f" />
        <SvgText x={VBW - 224} y={32} fontSize={12} fill={dimText}>Engel klerensi</SvgText>
        <SvgText x={VBW - 24} y={32} fontSize={13} textAnchor="end" fontWeight="700"
          fill={clearance.clearance_to_obstacle < 0 ? C.red : C.green}>
          {clearance.clearance_to_obstacle.toFixed(2) + " m"}
        </SvgText>
        <SvgText x={VBW - 224} y={51} fontSize={12} fill={dimText}>Yük klerensi</SvgText>
        <SvgText x={VBW - 24} y={51} fontSize={13} textAnchor="end" fontWeight="700"
          fill={clearance.clearance_to_load < 0 ? C.red : clearance.clearance_to_load < 1 ? C.accent : C.green}>
          {clearance.clearance_to_load.toFixed(2) + " m"}
        </SvgText>
      </G>
    </Svg>
  );
}

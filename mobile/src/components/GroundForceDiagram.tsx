// Ağırlık merkezi (CoG) + zemin kuvveti diyagramı (üstten plan) — react-native-svg.
// Masaüstü GroundForceDiagram'ın mobil uyarlaması. 4 ayak yükü renk kodlu,
// bileşke ağırlık merkezi işaretli; slew açısıyla canlı değişir.
import React from "react";
import { View } from "react-native";
import Svg, { Line, Rect, Circle, Text as SvgText, G } from "react-native-svg";
import type { OutriggerAtAngle } from "../shared/engine/outrigger";
import { C } from "../theme";

export interface GroundForceDiagramProps {
  Lx: number;
  Ly: number;
  atAngle: OutriggerAtAngle;
  V: number;
  padArea?: number;
  radius: number;
  slewAngle: number;
  width: number;
}

const CORNER_TR: Record<string, string> = {
  FR: "ÖN SAĞ", FL: "ÖN SOL", RR: "ARKA SAĞ", RL: "ARKA SOL",
};
const CORNER_SIGNS: Record<string, { sx: 1 | -1; sy: 1 | -1 }> = {
  FR: { sx: +1, sy: +1 }, FL: { sx: -1, sy: +1 },
  RR: { sx: +1, sy: -1 }, RL: { sx: -1, sy: -1 },
};
const DEG = Math.PI / 180;
const finite = (n: number, f: number) => (Number.isFinite(n) ? n : f);

export default function GroundForceDiagram(props: GroundForceDiagramProps) {
  const Lx = Math.max(finite(props.Lx, 2), 2);
  const Ly = Math.max(finite(props.Ly, 2), 2);
  const radius = Math.max(finite(props.radius, 0), 0);
  const V = finite(props.V, 0);
  const slewAngle = finite(props.slewAngle, 0);
  const padArea = props.padArea && props.padArea > 0 ? props.padArea : undefined;

  const corners = props.atAngle?.corners ?? [];
  const maxCornerLoad = finite(props.atAngle?.max_corner?.load ?? 0, 0);
  const cogX = finite(props.atAngle?.cog_x ?? 0, 0);
  const cogY = finite(props.atAngle?.cog_y ?? 0, 0);

  const VB = 360;
  const cx = VB / 2, cy = VB / 2, margin = 66;
  const span = Math.max(Lx, Ly, 2 * radius, 1);
  const scale = (VB - 2 * margin) / span;
  const px = (wx: number, wy: number) => ({ x: cx + wy * scale, y: cy - wx * scale });

  const halfLx = Lx / 2, halfLy = Ly / 2;
  const rectTL = px(+halfLx, -halfLy);
  const rectBR = px(-halfLx, +halfLy);
  const rectX = Math.min(rectTL.x, rectBR.x);
  const rectY = Math.min(rectTL.y, rectBR.y);
  const rectW = Math.abs(rectBR.x - rectTL.x);
  const rectH = Math.abs(rectBR.y - rectTL.y);

  const cornerColor = (load: number): string => {
    const ratio = maxCornerLoad > 0 ? load / maxCornerLoad : 0;
    if (ratio > 0.95) return C.red;
    if (ratio > 0.8) return C.accent;
    return C.green;
  };

  const a = slewAngle * DEG;
  const loadPt = px(radius * Math.cos(a), radius * Math.sin(a));
  const cogPt = px(cogX, cogY);
  const cogOutside = Math.abs(cogX) > halfLx || Math.abs(cogY) > halfLy;

  const labelOffset = (label: string) => {
    const s = CORNER_SIGNS[label] ?? { sx: 1, sy: 1 };
    return { dx: s.sy * 14, dy: -s.sx * 14 };
  };

  const size = Math.min(props.width, 400);

  return (
    <View style={{ alignItems: "center", width: "100%" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        {/* Eksen çizgileri */}
        <Line x1={rectX} y1={cy} x2={rectX + rectW} y2={cy} stroke={C.border2} strokeWidth={1} strokeDasharray="2 4" />
        <Line x1={cx} y1={rectY} x2={cx} y2={rectY + rectH} stroke={C.border2} strokeWidth={1} strokeDasharray="2 4" />

        {/* Ayak dikdörtgeni */}
        <Rect x={rectX} y={rectY} width={rectW} height={rectH} fill="rgba(255,186,32,0.04)"
          stroke={C.accent} strokeOpacity={0.5} strokeWidth={1.5} rx={4} />

        <SvgText x={cx} y={rectY - 10} fill={C.textFaint} fontSize={11} textAnchor="middle">ÖN ↑</SvgText>

        {/* Radius vektörü */}
        {radius > 0 && (
          <Line x1={cx} y1={cy} x2={loadPt.x} y2={loadPt.y} stroke={C.blue} strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="4 3" />
        )}

        {/* 4 köşe */}
        {corners.map((c) => {
          const s = CORNER_SIGNS[c.label] ?? { sx: 1, sy: 1 };
          const p = px(s.sx * halfLx, s.sy * halfLy);
          const col = cornerColor(finite(c.load, 0));
          const off = labelOffset(c.label);
          const anchor = s.sy > 0 ? "start" : "end";
          const tx = p.x + off.dx, ty = p.y + off.dy;
          return (
            <G key={c.label}>
              <Circle cx={p.x} cy={p.y} r={9} fill={col} stroke="#0c0e11" strokeWidth={2} />
              <Circle cx={p.x} cy={p.y} r={9} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={6} />
              <SvgText x={tx} y={ty} fill={C.textFaint} fontSize={10} textAnchor={anchor}>
                {CORNER_TR[c.label] ?? c.label}
              </SvgText>
              <SvgText x={tx} y={ty + 14} fill={col} fontSize={13} fontWeight="700" textAnchor={anchor}>
                {finite(c.load, 0).toFixed(1) + " t"}
              </SvgText>
              {padArea && (
                <SvgText x={tx} y={ty + 27} fill={C.textDim} fontSize={10} textAnchor={anchor}>
                  {(finite(c.load, 0) / padArea).toFixed(1) + " t/m²"}
                </SvgText>
              )}
            </G>
          );
        })}

        {/* Yük konumu */}
        <Circle cx={loadPt.x} cy={loadPt.y} r={7} fill={C.blue} stroke="#0c0e11" strokeWidth={1.5} />
        <SvgText x={loadPt.x} y={loadPt.y - 11} fill={C.blue} fontSize={11} fontWeight="700" textAnchor="middle">YÜK</SvgText>

        {/* CoG işareti */}
        <Circle cx={cogPt.x} cy={cogPt.y} r={8} fill="none" stroke={cogOutside ? C.red : C.orange} strokeWidth={2} />
        <Line x1={cogPt.x - 11} y1={cogPt.y} x2={cogPt.x + 11} y2={cogPt.y} stroke={cogOutside ? C.red : C.orange} strokeWidth={2} />
        <Line x1={cogPt.x} y1={cogPt.y - 11} x2={cogPt.x} y2={cogPt.y + 11} stroke={cogOutside ? C.red : C.orange} strokeWidth={2} />
        <SvgText x={cogPt.x + 12} y={cogPt.y + 16} fill={cogOutside ? C.red : C.orange} fontSize={11} fontWeight="700">CoG</SvgText>
      </Svg>
    </View>
  );
}

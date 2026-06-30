// Zemin kuvveti / ağırlık merkezi (CoG) diyagramı — üstten (plan) bakış.
// Liebherr Crane Planner 2.0 "ground force" görselleştirmesine benzer.
// 4 ayağa (outrigger) düşen kuvvetleri renk kodlu gösterir, bileşke ağırlık
// merkezini işaretler ve yükün plan konumunu çizer. Slew açısıyla canlı değişir.

import type { OutriggerAtAngle } from "../engine/outrigger";

export interface GroundForceDiagramProps {
  Lx: number; // ayak açıklığı X (m) — ileri/arka
  Ly: number; // ayak açıklığı Y (m) — yanal
  atAngle: OutriggerAtAngle; // mevcut slew açısındaki köşe yükleri + CoG
  V: number; // bileşke düşey kuvvet (t)
  padArea?: number; // takoz temas alanı (m²) — köşe basıncı için (t/m²)
  radius: number; // yük yarıçapı (m)
  slewAngle: number; // mevcut dönme açısı (derece)
}

// Köşe etiketlerinin Türkçe karşılıkları.
const CORNER_TR: Record<string, string> = {
  FR: "ÖN SAĞ",
  FL: "ÖN SOL",
  RR: "ARKA SAĞ",
  RL: "ARKA SOL",
};

// Köşe etiketinin slew-yerel plan konumundaki işaretleri (sx: ±Lx/2, sy: ±Ly/2).
// FR=(+Lx/2,+Ly/2), FL=(-Lx/2,+Ly/2), RR=(+Lx/2,-Ly/2), RL=(-Lx/2,-Ly/2)
const CORNER_SIGNS: Record<string, { sx: 1 | -1; sy: 1 | -1 }> = {
  FR: { sx: +1, sy: +1 },
  FL: { sx: -1, sy: +1 },
  RR: { sx: +1, sy: -1 },
  RL: { sx: -1, sy: -1 },
};

/** Sonlu değilse fallback'e düş. */
function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

const DEG = Math.PI / 180;

export default function GroundForceDiagram(props: GroundForceDiagramProps): JSX.Element {
  // --- Girdileri sağlamlaştır (NaN guard, Lx/Ly<=0 ise minimum 2) ---
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

  // --- Ölçekleme ---
  // Dünya birimi: metre. Plan diyagramında +X (ileri) yukarı, +Y (sağ) sağa.
  // Yük dikdörtgeni aşabilir; ölçeği max(Lx, Ly, 2*radius) baz alarak hesapla.
  const VB = 360; // viewBox kenar uzunluğu
  const cx = VB / 2; // merkez (px)
  const cy = VB / 2;
  const margin = 64; // kenar payı (etiketler için)
  const span = Math.max(Lx, Ly, 2 * radius, 1); // dünya genişliği (m)
  const scale = (VB - 2 * margin) / span; // px / m

  // Dünya (m) -> SVG (px) dönüşümü.
  // +X (ileri) yukarı = SVG'de -y;  +Y (sağ) sağa = SVG'de +x.
  const px = (wx: number, wy: number): { x: number; y: number } => ({
    x: cx + wy * scale,
    y: cy - wx * scale,
  });

  // --- Outrigger dikdörtgeni köşe pikselleri ---
  const halfLx = Lx / 2;
  const halfLy = Ly / 2;
  const rectTL = px(+halfLx, -halfLy); // ön sol (üst sol)
  const rectBR = px(-halfLx, +halfLy); // arka sağ (alt sağ)
  const rectX = Math.min(rectTL.x, rectBR.x);
  const rectY = Math.min(rectTL.y, rectBR.y);
  const rectW = Math.abs(rectBR.x - rectTL.x);
  const rectH = Math.abs(rectBR.y - rectTL.y);

  // --- Köşe rengi kuralı: yükün max_corner.load'a oranına göre ---
  const cornerColor = (load: number): string => {
    const ratio = maxCornerLoad > 0 ? load / maxCornerLoad : 0;
    if (ratio > 0.95) return "var(--red)";
    if (ratio > 0.8) return "var(--accent)";
    return "var(--green)";
  };

  // --- Yük plan konumu (slew-yerel, atAngle ile tutarlı) ---
  const a = slewAngle * DEG;
  const loadWx = radius * Math.cos(a); // ileri/+X bileşeni
  const loadWy = radius * Math.sin(a); // yanal/+Y bileşeni
  const loadPt = px(loadWx, loadWy);

  // --- CoG işareti ---
  const cogPt = px(cogX, cogY);
  const cogOutside = Math.abs(cogX) > halfLx || Math.abs(cogY) > halfLy;

  // Köşe etiketlerinin dikdörtgen dışına doğru kayması için yön.
  const labelOffset = (label: string): { dx: number; dy: number } => {
    const s = CORNER_SIGNS[label] ?? { sx: 1, sy: 1 };
    return { dx: s.sy * 14, dy: -s.sx * 14 };
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%", flex: 1, minHeight: 0, display: "block" }}
        role="img"
        aria-label="Zemin kuvveti ve ağırlık merkezi diyagramı (üstten görünüm)"
      >
        {/* Merkez ekseni çizgileri (artı işareti, soluk) */}
        <line x1={rectX} y1={cy} x2={rectX + rectW} y2={cy} stroke="var(--border-2)" strokeWidth={1} strokeDasharray="2 4" />
        <line x1={cx} y1={rectY} x2={cx} y2={rectY + rectH} stroke="var(--border-2)" strokeWidth={1} strokeDasharray="2 4" />

        {/* Outrigger dikdörtgeni: ince amber/gri çerçeve */}
        <rect
          x={rectX}
          y={rectY}
          width={rectW}
          height={rectH}
          fill="rgba(255,186,32,0.04)"
          stroke="var(--accent)"
          strokeOpacity={0.5}
          strokeWidth={1.5}
          rx={4}
        />

        {/* Yön etiketi: ÖN (yukarı) */}
        <text x={cx} y={rectY - 10} fill="var(--text-faint)" fontSize={10} textAnchor="middle" style={{ letterSpacing: 1 }}>
          ÖN ↑
        </text>

        {/* Slew merkezinden yüke ince kesik çizgi (radius vektörü) */}
        {radius > 0 && (
          <line
            x1={cx}
            y1={cy}
            x2={loadPt.x}
            y2={loadPt.y}
            stroke="var(--blue)"
            strokeOpacity={0.6}
            strokeWidth={1.2}
            strokeDasharray="4 3"
          />
        )}

        {/* 4 köşe (pad) — renk yüke göre */}
        {corners.map((c) => {
          const s = CORNER_SIGNS[c.label] ?? { sx: 1, sy: 1 };
          const p = px(s.sx * halfLx, s.sy * halfLy);
          const col = cornerColor(finite(c.load, 0));
          const off = labelOffset(c.label);
          // Metin hizalaması köşenin dikdörtgendeki konumuna göre.
          const anchor = s.sy > 0 ? "start" : "end";
          const baseTextX = p.x + off.dx;
          const baseTextY = p.y + off.dy;
          return (
            <g key={c.label}>
              <circle cx={p.x} cy={p.y} r={9} fill={col} stroke="#0c0e11" strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={9} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={6} />
              {/* Köşe başlığı (Türkçe, küçük punto) */}
              <text x={baseTextX} y={baseTextY} fill="var(--text-faint)" fontSize={9} textAnchor={anchor} style={{ letterSpacing: 0.5 }}>
                {CORNER_TR[c.label] ?? c.label}
              </text>
              {/* Yük değeri (mono) */}
              <text
                x={baseTextX}
                y={baseTextY + 13}
                fill={col}
                fontSize={12}
                fontWeight={700}
                textAnchor={anchor}
                style={{ fontFamily: "var(--mono)" }}
              >
                {finite(c.load, 0).toFixed(1)} t
              </text>
              {/* Köşe basıncı (padArea verilmişse) */}
              {padArea && (
                <text
                  x={baseTextX}
                  y={baseTextY + 25}
                  fill="var(--text-dim)"
                  fontSize={9.5}
                  textAnchor={anchor}
                  style={{ fontFamily: "var(--mono)" }}
                >
                  {(finite(c.load, 0) / padArea).toFixed(1)} t/m²
                </text>
              )}
            </g>
          );
        })}

        {/* Yük plan konumu: mavi içi dolu daire + "YÜK" etiketi */}
        <g>
          <circle cx={loadPt.x} cy={loadPt.y} r={7} fill="var(--blue)" stroke="#0c0e11" strokeWidth={1.5} />
          <text
            x={loadPt.x}
            y={loadPt.y - 11}
            fill="var(--blue)"
            fontSize={10}
            fontWeight={700}
            textAnchor="middle"
            style={{ letterSpacing: 0.5 }}
          >
            YÜK
          </text>
        </g>

        {/* CoG işareti: hedef/artı (kırmızımsı turuncu) */}
        <g>
          <circle
            cx={cogPt.x}
            cy={cogPt.y}
            r={8}
            fill="none"
            stroke={cogOutside ? "var(--red)" : "var(--orange)"}
            strokeWidth={2}
          />
          <line x1={cogPt.x - 11} y1={cogPt.y} x2={cogPt.x + 11} y2={cogPt.y} stroke={cogOutside ? "var(--red)" : "var(--orange)"} strokeWidth={2} />
          <line x1={cogPt.x} y1={cogPt.y - 11} x2={cogPt.x} y2={cogPt.y + 11} stroke={cogOutside ? "var(--red)" : "var(--orange)"} strokeWidth={2} />
          <text
            x={cogPt.x + 12}
            y={cogPt.y + 16}
            fill={cogOutside ? "var(--red)" : "var(--orange)"}
            fontSize={10}
            fontWeight={700}
            textAnchor="start"
            style={{ letterSpacing: 0.5 }}
          >
            CoG
          </text>
        </g>
      </svg>

      {/* Üst/alt açıklama: bileşke V ve mevcut açı + CoG durumu */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          padding: "8px 4px 2px",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span style={{ fontFamily: "var(--mono)" }}>
          V = {V.toFixed(1)} t · Açı = {slewAngle.toFixed(0)}°
        </span>
        <span
          style={{
            fontWeight: 700,
            color: cogOutside ? "var(--red)" : "var(--green)",
          }}
        >
          {cogOutside ? "⚠ CoG ayak alanı dışında — DEVRİLME RİSKİ" : "✓ CoG ayak alanı içinde"}
        </span>
      </div>
    </div>
  );
}

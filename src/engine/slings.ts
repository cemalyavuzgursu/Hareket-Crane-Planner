// SAPAN KOL KUVVETLERİ — eksantrik (kaçık) ağırlık merkezli yük.
//
// Koordinatlar yük yerel çerçevesinde, yükün GEOMETRİK MERKEZİNE göredir
// (x = bom yönü, z = yanal), metre. Serbest asılı yük kendiliğinden hizalanır:
// kanca, ağırlık merkezinin (CoG) tam DÜŞEY üzerinde durur. Bağlantı noktaları
// aynı kottadır (yükün küçük eğilmesi ihmal edilir), kanca bu kotun height_m
// üzerindedir.
//
// Denge (kanca düğümü): Σ V_i = W, Σ V_i·(a_i − c) = 0 (yatay denge, her kolun
// yatay bileşeni V_i·d_i/h). 2 kolda bu kaldıraç kuralıdır (statik belirli).
// 4 kolda 3 denklem / 4 bilinmeyen → statik belirsiz. İki yaklaşım raporlanır:
//   (1) MUHAFAZAKÂR: yükü yalnızca bir köşegen çifti taşır (sapan boy toleransı
//       nedeniyle yaygın saha pratiği; EN 13414 / LEEA). İki köşegen için ayrı
//       kaldıraç kuralı uygulanır, en büyük kol kuvveti esas alınır.
//   (2) RİJİT DAĞILIM: tüm kollar eşit esnek + yük rijit kabulüyle en küçük
//       normlu denge çözümü (dış merkezli temel formülü gibi). Bir kol çekme
//       dışı (negatif) çıkarsa gevşer, yük kalan 3 kola statik dengeyle dağıtılır
//       ("3 kol taşır" durumu).

export interface SlingPoint {
  x: number;
  z: number;
}

export interface SlingLeg {
  /** Kol sırası (0..n-1). */
  index: number;
  /** Bağlantı noktası (yük yerel, m). */
  attach: SlingPoint;
  /** Kanca ekseninden bağlantıya yatay mesafe (m). */
  horizontal_m: number;
  /** Kolun düşeyle yaptığı açı (°). */
  angle_deg: number;
  /** Kolun taşıdığı düşey kuvvet (t). */
  vertical_t: number;
  /** Kol çekme kuvveti (t) = düşey / cos(açı). */
  tension_t: number;
}

export interface SlingDistribution {
  legs: SlingLeg[];
  max_tension_t: number;
  /** Bu dağılımı taşıyan kol sayısı (gevşek kollar hariç). */
  active_legs: number;
}

export interface SlingResult {
  load_t: number;
  legs_count: 2 | 4;
  /** Esas (muhafazakâr) dağılım: 2 kolda kaldıraç kuralı, 4 kolda tek köşegen çifti. */
  conservative: SlingDistribution;
  /** 4 kol için rijit (en küçük normlu / 3 kol) alternatif. 2 kolda conservative ile aynı. */
  rigid: SlingDistribution;
  /** Esas alınacak en büyük kol kuvveti (t) = conservative.max_tension_t. */
  max_tension_t: number;
  /** En büyük kol açısı (düşeyden, °). */
  max_angle_deg: number;
  /** CoG bağlantı çokgeni (2 kolda doğru parçası) dışında → yük devrilir/kayar. */
  cog_outside: boolean;
  /** 60° üstü açı → izin verilmez. */
  angle_not_allowed: boolean;
  warnings: string[];
}

const RAD = 180 / Math.PI;

function defaultAttach(legs: 2 | 4, spread: number): SlingPoint[] {
  if (legs === 2) return [{ x: spread, z: 0 }, { x: -spread, z: 0 }];
  const s = spread / Math.SQRT2;
  // Sıra çevresel: 0 ve 2 bir köşegen, 1 ve 3 diğer köşegen.
  return [
    { x: s, z: s },
    { x: -s, z: s },
    { x: -s, z: -s },
    { x: s, z: -s },
  ];
}

function makeLeg(index: number, a: SlingPoint, cog: SlingPoint, h: number, V: number): SlingLeg {
  const horiz = Math.hypot(a.x - cog.x, a.z - cog.z);
  const angle = Math.atan2(horiz, h);
  const cos = Math.cos(angle);
  const vertical = Math.max(0, V);
  return {
    index,
    attach: a,
    horizontal_m: horiz,
    angle_deg: angle * RAD,
    vertical_t: vertical,
    tension_t: vertical > 0 ? (cos > 1e-9 ? vertical / cos : Infinity) : 0,
  };
}

function dist(legs: SlingLeg[]): SlingDistribution {
  return {
    legs,
    max_tension_t: legs.reduce((m, l) => Math.max(m, l.tension_t), 0),
    active_legs: legs.filter((l) => l.vertical_t > 1e-9).length,
  };
}

/** p1–p2 doğrusu üzerinde kaldıraç kuralı: CoG izdüşümüne göre [V1, V2] (negatif olabilir). */
function leverRule(W: number, p1: SlingPoint, p2: SlingPoint, c: SlingPoint): { v: [number, number]; t: number; perp: number } {
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1e-12) return { v: [W / 2, W / 2], t: 0.5, perp: Math.hypot(c.x - p1.x, c.z - p1.z) };
  const t = ((c.x - p1.x) * dx + (c.z - p1.z) * dz) / L2;
  const perp = Math.abs((c.x - p1.x) * dz - (c.z - p1.z) * dx) / Math.sqrt(L2);
  return { v: [W * (1 - t), W * t], t, perp };
}

/** 3×3 doğrusal sistem (Cramer). Tekilse null. */
function solve3(m: number[][], b: number[]): number[] | null {
  const det3 = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det3(m);
  if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map((col) => {
    const mm = m.map((row, r) => row.map((v, c) => (c === col ? b[r] : v)));
    return det3(mm) / D;
  });
}

/** Denge: Σ V = W, Σ V·x = W·cx, Σ V·z = W·cz — en küçük normlu çözüm V = Aᵀ(AAᵀ)⁻¹b. */
function minNormVertical(W: number, pts: SlingPoint[], c: SlingPoint): number[] | null {
  const A = [pts.map(() => 1), pts.map((p) => p.x), pts.map((p) => p.z)];
  const b = [W, W * c.x, W * c.z];
  const AAt = A.map((ri) => A.map((rj) => ri.reduce((s, v, k) => s + v * rj[k], 0)));
  const y = solve3(AAt, b);
  if (!y) return null;
  return pts.map((_, k) => A[0][k] * y[0] + A[1][k] * y[1] + A[2][k] * y[2]);
}

/** Nokta dışbükey çokgen içinde mi (kenar dahil; köşeler çevresel sırada). */
function insideConvex(pts: SlingPoint[], c: SlingPoint): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cr = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Eksantrik CoG'li sapan kol kuvvetleri.
 * @param load_t   kanca altı yük (t) — sapanın taşıdığı toplam
 * @param legs     2 veya 4 kol
 * @param spread_m kanca ekseninden (simetrik durumda yük merkezinden) bağlantı noktasına yatay mesafe (m)
 * @param height_m kanca ile bağlantı noktaları arası düşey mesafe (m)
 * @param cog      CoG'nin geometrik merkeze göre kaçıklığı (m)
 * @param attach   özel bağlantı noktaları (yük yerel, geometrik merkeze göre); verilmezse simetrik
 */
export function slingLegForces(
  load_t: number,
  legs: 2 | 4,
  spread_m: number,
  height_m: number,
  cog: SlingPoint = { x: 0, z: 0 },
  attach?: SlingPoint[],
): SlingResult {
  const W = Number.isFinite(load_t) ? Math.max(0, load_t) : 0;
  const c = { x: Number.isFinite(cog?.x) ? cog.x : 0, z: Number.isFinite(cog?.z) ? cog.z : 0 };
  const spread = Number.isFinite(spread_m) ? Math.max(0, spread_m) : 0;
  const pts = attach && attach.length === legs ? attach : defaultAttach(legs, spread);
  const warnings: string[] = [];

  if (!Number.isFinite(height_m) || height_m <= 0) {
    const bad = pts.map((a, i) => ({
      index: i,
      attach: a,
      horizontal_m: Math.hypot(a.x - c.x, a.z - c.z),
      angle_deg: 90,
      vertical_t: W / legs,
      tension_t: W > 0 ? Infinity : 0,
    }));
    const d = dist(bad);
    warnings.push("Sapan yüksekliği sıfır veya negatif — kol kuvveti hesaplanamaz (açı 90°).");
    return {
      load_t: W, legs_count: legs, conservative: d, rigid: d, max_tension_t: d.max_tension_t,
      max_angle_deg: 90, cog_outside: false, angle_not_allowed: true, warnings,
    };
  }
  const h = height_m;

  let conservative: SlingDistribution;
  let rigid: SlingDistribution;
  let cog_outside = false;

  if (legs === 2) {
    const lr = leverRule(W, pts[0], pts[1], c);
    cog_outside = lr.t < -1e-9 || lr.t > 1 + 1e-9;
    if (lr.perp > 1e-6) {
      warnings.push(
        `CoG sapan hattının ${lr.perp.toFixed(2)} m yanında — 2 kollu sapanda yük bu eksen etrafında yan yatar.`,
      );
    }
    conservative = dist(pts.map((a, i) => makeLeg(i, a, c, h, lr.v[i])));
    rigid = conservative;
  } else {
    cog_outside = !insideConvex(pts, c);
    // (1) Köşegen çiftleri: (0,2) ve (1,3).
    const diagLegs = [
      [0, 2],
      [1, 3],
    ].map(([i, j]) => {
      const lr = leverRule(W, pts[i], pts[j], c);
      const V = [0, 0, 0, 0];
      V[i] = lr.v[0];
      V[j] = lr.v[1];
      return pts.map((a, k) => makeLeg(k, a, c, h, V[k]));
    });
    const d1 = dist(diagLegs[0]);
    const d2 = dist(diagLegs[1]);
    conservative = d1.max_tension_t >= d2.max_tension_t ? d1 : d2;

    // (2) Rijit dağılım (+ gevşeyen kol → 3 kol).
    let V = minNormVertical(W, pts, c) ?? pts.map(() => W / 4);
    const minV = Math.min(...V);
    if (minV < -1e-9) {
      const slack = V.indexOf(minV);
      const rest = pts.map((p, i) => ({ p, i })).filter(({ i }) => i !== slack);
      const s = solve3(
        [rest.map(() => 1), rest.map((r) => r.p.x), rest.map((r) => r.p.z)],
        [W, W * c.x, W * c.z],
      );
      V = pts.map(() => 0);
      if (s) rest.forEach(({ i }, k) => (V[i] = s[k]));
    }
    rigid = dist(pts.map((a, k) => makeLeg(k, a, c, h, V[k])));
    if (rigid.active_legs === 3 && !cog_outside) {
      warnings.push("Rijit dağılımda bir kol gevşiyor — yük fiilen 3 kolla taşınıyor.");
    }
  }

  if (cog_outside) {
    warnings.push(
      legs === 2
        ? "CoG iki bağlantı noktası arasında değil — yük devrilir/kayar. Bağlantı noktalarını değiştirin."
        : "CoG bağlantı noktalarının oluşturduğu alanın dışında — yük devrilir. Bağlantı noktalarını değiştirin.",
    );
  }

  const allLegs = [...conservative.legs, ...rigid.legs];
  const max_angle_deg = allLegs.reduce((m, l) => Math.max(m, l.angle_deg), 0);
  const angle_not_allowed = max_angle_deg > 60 + 1e-9;
  if (angle_not_allowed) {
    warnings.push(`Kol açısı ${max_angle_deg.toFixed(1)}° > 60° (düşeyden) — izin verilmez. Sapan boyunu uzatın.`);
  } else if (max_angle_deg > 45 + 1e-9) {
    warnings.push(`Kol açısı ${max_angle_deg.toFixed(1)}° > 45° (düşeyden) — sapan kapasitesi önemli ölçüde düşer; dikkat.`);
  }

  return {
    load_t: W,
    legs_count: legs,
    conservative,
    rigid,
    max_tension_t: conservative.max_tension_t,
    max_angle_deg,
    cog_outside,
    angle_not_allowed,
    warnings,
  };
}

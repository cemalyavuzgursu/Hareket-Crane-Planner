/**
 * dxfImport.ts — AutoCAD DXF dosyalarını 3B sahne nesnesine dönüştürme.
 *
 * Akış: DXF metni → dxf-parser (MIT) → saf geometri dizileri (üçgen + çizgi
 * parçaları, metre, three Y-yukarı) → THREE.Group. GLB'ye dönüştürme
 * bimImport.ts'deki ortak GLTFExporter yolunda yapılır; bu dosya WebGL/DOM
 * gerektirmez (node'da test edilebilir).
 *
 * Desteklenenler:
 *   - 3DFACE, SOLID, POLYFACE mesh (POLYLINE bayrak 64)  → üçgenler
 *   - LINE, LWPOLYLINE (bulge yayları dahil), POLYLINE, CIRCLE, ARC,
 *     ELLIPSE, SPLINE (kontrol/uydurma noktaları üzerinden kaba yaklaşım)
 *                                                        → çizgi parçaları
 *   - Kalınlığı (thickness, grup 39) olan kapalı LWPOLYLINE/POLYLINE/CIRCLE
 *     → dikey olarak ekstrüde edilmiş prizma (duvarlar + alt/üst kapak).
 *     Kalınlık 0 ise ve options.extrude2dHeight verilmişse o yükseklik kullanılır.
 *   - INSERT (blok referansı): konum/ölçek/dönüş + satır/sütun dizisi, iç içe
 *     (en fazla 8 seviye).
 *
 * Birimler: $INSUNITS başlığına göre metreye çevrilir; bilinmiyorsa kapsam
 * > 1000 ise mm, değilse m varsayılır. DXF Z-yukarı → three Y-yukarı:
 * (x, y, z)_dxf → (x, z, −y)_three. Sonuç yatayda (XZ) orijine ortalanır ve
 * tabanı y=0'a oturtulur.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  DoubleSide,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import DxfParser from "dxf-parser";
import { tStatic } from "./i18n";
import type { IDxf, IEntity, IPoint } from "dxf-parser";

export interface DxfImportOptions {
  /**
   * Kalınlığı 0 olan kapalı 2B polylineları bu yüksekliğe (m) ekstrüde et.
   * ("2B çizimi 3 m yüksekliğe çıkar" → 3). Verilmezse/0 ise yalnız çizgi.
   */
  extrude2dHeight?: number;
}

export interface DxfSize {
  /** X yönü (m) */
  width: number;
  /** Z yönü (m) — DXF'in Y ekseni */
  depth: number;
  /** Y yönü (m) — DXF'in Z ekseni; en az 0.1 m */
  height: number;
}

export interface DxfGeometryData {
  /** Üçgen köşeleri, düz dizi [x,y,z, x,y,z, ...] — metre, three Y-yukarı. */
  triangles: number[];
  /** Çizgi parçaları, düz dizi (her 2 köşe bir parça) — metre, Y-yukarı. */
  lines: number[];
  /** Sınırlayıcı kutu boyutu (m), en az 0.1 m. */
  size: DxfSize;
  /** DXF biriminden metreye çarpan. */
  unitScale: number;
  /** Kullanılan birim etiketi (bilgi amaçlı). */
  units: string;
  /** Birim $INSUNITS'ten mi okundu, yoksa kapsamdan mı tahmin edildi. */
  unitsGuessed: boolean;
  stats: { faces: number; segments: number; extruded: number; skipped: number };
}

const MIN_DIM = 0.1;
const MAX_INSERT_DEPTH = 8;
/** Tam daire için segment sayısı. */
const CIRCLE_SEGMENTS = 48;

/** $INSUNITS kodu → metre çarpanı. */
const INSUNITS: Record<number, [number, string]> = {
  1: [0.0254, "inç"],
  2: [0.3048, "fit"],
  4: [0.001, "mm"],
  5: [0.01, "cm"],
  6: [1, "m"],
  7: [1000, "km"],
  14: [0.1, "dm"],
};

/** DXF metnini ayrıştır (hata durumunda Türkçe mesajla fırlatır). */
export function parseDxfText(text: string): IDxf {
  let dxf: IDxf | null = null;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch (e) {
    throw new Error(
      tStatic("DXF dosyası okunamadı: {msg}", { msg: e instanceof Error ? e.message : String(e) }),
    );
  }
  if (!dxf) throw new Error(tStatic("DXF dosyası okunamadı (boş veya geçersiz)."));
  return dxf;
}

// ── Ham toplayıcı (DXF uzayında, birim dönüşümü öncesi) ─────────────────────

interface RawCollector {
  tris: number[]; // DXF uzayı, Z-yukarı
  lines: number[];
  stats: DxfGeometryData["stats"];
}

type P3 = [number, number, number];

function tp(m: Matrix4, x: number, y: number, z: number): P3 {
  const v = new Vector3(x, y, z).applyMatrix4(m);
  return [v.x, v.y, v.z];
}

function isFiniteP(p: IPoint | undefined): p is IPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function pz(p: IPoint): number {
  return Number.isFinite(p.z) ? p.z : 0;
}

function pushTri(c: RawCollector, a: P3, b: P3, d: P3): void {
  c.tris.push(...a, ...b, ...d);
}

function pushSeg(c: RawCollector, a: P3, b: P3): void {
  c.lines.push(...a, ...b);
  c.stats.segments++;
}

/** Nokta dizisini (yerel koordinatlarda) çizgi parçaları olarak ekle. */
function pushPolyline(c: RawCollector, m: Matrix4, pts: P3[], closed: boolean): void {
  const w = pts.map((p) => tp(m, p[0], p[1], p[2]));
  for (let i = 0; i + 1 < w.length; i++) pushSeg(c, w[i], w[i + 1]);
  if (closed && w.length > 2) pushSeg(c, w[w.length - 1], w[0]);
}

/**
 * Kapalı bir 2B konturu (yerel XY + taban z) h kadar ekstrüde et:
 * yan duvarlar + alt/üst kapak üçgenleri.
 */
function pushExtrusion(c: RawCollector, m: Matrix4, contour: P3[], h: number): boolean {
  // Ardışık yinelenen / kapanış noktasını temizle
  const pts: P3[] = [];
  for (const p of contour) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push(p);
  }
  if (pts.length > 2) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-9) pts.pop();
  }
  if (pts.length < 3) return false;

  const bot = pts.map((p) => tp(m, p[0], p[1], p[2]));
  const top = pts.map((p) => tp(m, p[0], p[1], p[2] + h));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushTri(c, bot[i], bot[j], top[j]);
    pushTri(c, bot[i], top[j], top[i]);
  }
  const faces = ShapeUtils.triangulateShape(
    pts.map((p) => new Vector2(p[0], p[1])),
    [],
  );
  for (const [a, b, d] of faces) {
    pushTri(c, bot[a], bot[d], bot[b]);
    pushTri(c, top[a], top[b], top[d]);
  }
  c.stats.faces += 2 * n + 2 * faces.length;
  c.stats.extruded++;
  return true;
}

/** Yay noktaları (yerel), açılar radyan, CCW. */
function arcPoints(
  cx: number, cy: number, z: number, r: number, a0: number, a1: number,
): P3[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const segs = Math.max(4, Math.ceil((CIRCLE_SEGMENTS * sweep) / (Math.PI * 2)));
  const out: P3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (sweep * i) / segs;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
  }
  return out;
}

/** p0→p1 arasındaki bulge yayının ara noktaları (p0 dahil değil, p1 dahil). */
function bulgePoints(p0: P3, p1: P3, bulge: number): P3[] {
  if (!bulge || Math.abs(bulge) < 1e-9) return [p1];
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [p1];
  const theta = 4 * Math.atan(bulge); // işaretli merkez açı (+ = CCW)
  // Merkez = kiriş ortası + ((1−b²)/(4b))·(−dy, dx)  (sol normal yönünde)
  const k = (1 - bulge * bulge) / (4 * bulge);
  const cx = (p0[0] + p1[0]) / 2 - k * dy;
  const cy = (p0[1] + p1[1]) / 2 + k * dx;
  const r = Math.hypot(p0[0] - cx, p0[1] - cy);
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  const segs = Math.max(2, Math.ceil((CIRCLE_SEGMENTS * Math.abs(theta)) / (Math.PI * 2)));
  const out: P3[] = [];
  for (let i = 1; i <= segs; i++) {
    const a = a0 + (theta * i) / segs;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), p0[2] + ((p1[2] - p0[2]) * i) / segs]);
  }
  out[out.length - 1] = p1;
  return out;
}

/** Bulge'lı köşe listesinden tessellate edilmiş kontur. */
function bulgeContour(verts: { x: number; y: number; z: number; bulge?: number }[], closed: boolean, z0: number): P3[] {
  const pts: P3[] = verts.map((v) => [v.x, v.y, Number.isFinite(v.z) ? v.z : z0]);
  if (pts.length === 0) return [];
  const out: P3[] = [pts[0]];
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(...bulgePoints(a, b, verts[i].bulge ?? 0));
  }
  return out;
}

/**
 * OCS → WCS (yalnız yaygın durum): ekstrüzyon yönü (0,0,−1) ise X aynalanır
 * (Arbitrary Axis Algorithm'in bu özel durumu). Diğer eğik OCS'ler yok sayılır.
 */
function ocsMatrix(ez: number | undefined): Matrix4 {
  return ez != null && ez < 0 ? new Matrix4().makeScale(-1, 1, -1) : new Matrix4();
}

function processEntities(
  entities: IEntity[],
  dxf: IDxf,
  m: Matrix4,
  c: RawCollector,
  opts: DxfImportOptions,
  depth: number,
): void {
  const extrudeDefault = opts.extrude2dHeight && opts.extrude2dHeight > 0 ? opts.extrude2dHeight : 0;

  for (const ent of entities ?? []) {
    const e = ent as any;
    if (!e || e.inPaperSpace || e.visible === false) continue;
    try {
      switch (e.type) {
        case "3DFACE": {
          const v: IPoint[] = (e.vertices ?? []).filter(isFiniteP);
          if (v.length < 3) break;
          const w = v.map((p) => tp(m, p.x, p.y, pz(p)));
          pushTri(c, w[0], w[1], w[2]);
          c.stats.faces++;
          if (w.length >= 4 && !samePt(w[3], w[2])) {
            pushTri(c, w[0], w[2], w[3]);
            c.stats.faces++;
          }
          break;
        }
        case "SOLID": {
          const v: IPoint[] = (e.points ?? []).filter(isFiniteP);
          if (v.length < 3) break;
          const mm = m.clone().multiply(ocsMatrix(e.extrusionDirection?.z));
          const w = v.map((p) => tp(mm, p.x, p.y, pz(p)));
          // SOLID köşe sırası: 1-2-3-4 → dörtgen 1-2-4-3
          pushTri(c, w[0], w[1], w[2]);
          c.stats.faces++;
          if (w.length >= 4 && !samePt(w[3], w[2])) {
            pushTri(c, w[1], w[3], w[2]);
            c.stats.faces++;
          }
          break;
        }
        case "LINE": {
          const v: IPoint[] = e.vertices ?? [];
          if (v.length >= 2 && isFiniteP(v[0]) && isFiniteP(v[1])) {
            pushSeg(c, tp(m, v[0].x, v[0].y, pz(v[0])), tp(m, v[1].x, v[1].y, pz(v[1])));
          }
          break;
        }
        case "LWPOLYLINE": {
          const verts = (e.vertices ?? []).filter(isFiniteP);
          if (verts.length < 2) break;
          const z0 = Number.isFinite(e.elevation) ? e.elevation : 0;
          const vz = verts.map((v: any) => ({ ...v, z: z0 }));
          const closed = !!e.shape;
          const mm = m.clone().multiply(ocsMatrix(e.extrusionDirectionZ));
          const contour = bulgeContour(vz, closed, z0);
          const h = Number(e.depth) || 0 || extrudeDefault; // depth = thickness (39)
          if (closed && h !== 0 && pushExtrusion(c, mm, contour, h)) break;
          pushPolyline(c, mm, contour, false);
          break;
        }
        case "POLYLINE": {
          const all: any[] = e.vertices ?? [];
          if (e.isPolyfaceMesh) {
            const pos = all.filter((v) => v.threeDPolylineMesh || !(v.faceA || v.faceB || v.faceC));
            const faces = all.filter((v) => v.polyfaceMeshVertex && !v.threeDPolylineMesh && (v.faceA || v.faceB || v.faceC));
            const P = pos.map((v) => tp(m, v.x, v.y, pz(v)));
            for (const f of faces) {
              const idx = [f.faceA, f.faceB, f.faceC, f.faceD]
                .map((i) => Math.abs(Number(i) || 0))
                .filter((i) => i > 0 && i <= P.length)
                .map((i) => P[i - 1]);
              if (idx.length >= 3) {
                pushTri(c, idx[0], idx[1], idx[2]);
                c.stats.faces++;
                if (idx.length === 4) {
                  pushTri(c, idx[0], idx[2], idx[3]);
                  c.stats.faces++;
                }
              }
            }
            break;
          }
          const verts = all.filter(isFiniteP);
          if (verts.length < 2) break;
          const closed = !!e.shape || !!e.is3dPolygonMeshClosed;
          if (e.is3dPolyline || e.is3dPolygonMesh) {
            // 3B polyline / M×N poligon mesh (M,N ayrıştırıcıda yok) → çizgi
            pushPolyline(c, m, verts.map((v: any) => [v.x, v.y, pz(v)] as P3), closed);
            break;
          }
          const mm = m.clone().multiply(ocsMatrix(e.extrusionDirection?.z));
          const contour = bulgeContour(verts, closed, 0);
          const h = Number(e.thickness) || 0 || extrudeDefault;
          if (closed && h !== 0 && pushExtrusion(c, mm, contour, h)) break;
          pushPolyline(c, mm, contour, false);
          break;
        }
        case "CIRCLE":
        case "ARC": {
          if (!isFiniteP(e.center) || !(e.radius > 0)) break;
          const mm = m.clone().multiply(ocsMatrix(e.extrusionDirectionZ));
          const full = e.type === "CIRCLE";
          const a0 = full ? 0 : e.startAngle ?? 0;
          const a1 = full ? Math.PI * 2 : e.endAngle ?? Math.PI * 2;
          const pts = arcPoints(e.center.x, e.center.y, pz(e.center), e.radius, a0, a1);
          if (full) {
            const h = Number(e.thickness) || 0 || extrudeDefault;
            if (h !== 0 && pushExtrusion(c, mm, pts.slice(0, -1), h)) break;
          }
          pushPolyline(c, mm, pts, false);
          break;
        }
        case "ELLIPSE": {
          if (!isFiniteP(e.center) || !isFiniteP(e.majorAxisEndPoint)) break;
          const mx = e.majorAxisEndPoint.x;
          const my = e.majorAxisEndPoint.y;
          const a = Math.hypot(mx, my);
          if (!(a > 0)) break;
          const b = a * (e.axisRatio || 1);
          const rot = Math.atan2(my, mx);
          const t0 = e.startAngle ?? 0;
          let t1 = e.endAngle ?? Math.PI * 2;
          while (t1 <= t0) t1 += Math.PI * 2;
          const segs = Math.max(8, Math.ceil((CIRCLE_SEGMENTS * (t1 - t0)) / (Math.PI * 2)));
          const pts: P3[] = [];
          for (let i = 0; i <= segs; i++) {
            const t = t0 + ((t1 - t0) * i) / segs;
            const lx = a * Math.cos(t);
            const ly = b * Math.sin(t);
            pts.push([
              e.center.x + lx * Math.cos(rot) - ly * Math.sin(rot),
              e.center.y + lx * Math.sin(rot) + ly * Math.cos(rot),
              pz(e.center),
            ]);
          }
          pushPolyline(c, m, pts, false);
          break;
        }
        case "SPLINE": {
          const src: IPoint[] = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) ?? [];
          const pts = src.filter(isFiniteP).map((p) => [p.x, p.y, pz(p)] as P3);
          if (pts.length >= 2) pushPolyline(c, m, pts, !!e.closed);
          break;
        }
        case "INSERT": {
          if (depth >= MAX_INSERT_DEPTH) break;
          const block = dxf.blocks?.[e.name];
          if (!block || !block.entities?.length) break;
          const base = block.position ?? { x: 0, y: 0, z: 0 };
          const pos = e.position ?? { x: 0, y: 0, z: 0 };
          const sx = e.xScale ?? 1;
          const sy = e.yScale ?? 1;
          const sz = e.zScale ?? 1;
          const rot = ((e.rotation ?? 0) * Math.PI) / 180;
          const cols = Math.max(1, e.columnCount ?? 1);
          const rows = Math.max(1, e.rowCount ?? 1);
          for (let r = 0; r < rows; r++) {
            for (let k = 0; k < cols; k++) {
              const ox = k * (e.columnSpacing ?? 0);
              const oy = r * (e.rowSpacing ?? 0);
              const local = new Matrix4()
                .multiply(ocsMatrix(e.extrusionDirection?.z))
                .multiply(new Matrix4().makeTranslation(pos.x, pos.y, pz(pos)))
                .multiply(new Matrix4().makeRotationZ(rot))
                .multiply(new Matrix4().makeTranslation(ox, oy, 0))
                .multiply(new Matrix4().makeScale(sx, sy, sz))
                .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -pz(base)));
              processEntities(block.entities, dxf, m.clone().multiply(local), c, opts, depth + 1);
            }
          }
          break;
        }
        default:
          c.stats.skipped++; // TEXT, MTEXT, DIMENSION, HATCH, POINT…
      }
    } catch {
      c.stats.skipped++; // bozuk tek varlık tüm içe aktarmayı düşürmesin
    }
  }
}

function samePt(a: P3, b: P3): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;
}

/**
 * Saf dönüştürücü: ayrıştırılmış DXF → metre cinsinden, Y-yukarı, XZ'de
 * ortalanmış, tabanı y=0'da üçgen/çizgi dizileri. WebGL gerektirmez.
 */
export function dxfToGeometryData(dxf: IDxf, opts: DxfImportOptions = {}): DxfGeometryData {
  const c: RawCollector = {
    tris: [],
    lines: [],
    stats: { faces: 0, segments: 0, extruded: 0, skipped: 0 },
  };
  // Ekstrüzyon yüksekliği metre cinsinden verilir; DXF birimine çevirmek için
  // birimi önce belirlememiz gerekir → iki geçiş: önce ölçek, sonra toplama.
  const insunits = Number((dxf.header as any)?.["$INSUNITS"]);
  let unitScale: number;
  let units: string;
  let unitsGuessed = false;
  if (INSUNITS[insunits]) {
    [unitScale, units] = INSUNITS[insunits];
  } else {
    // Kapsamı ölçmek için ekstrüzyonsuz ön geçiş
    const probe: RawCollector = { tris: [], lines: [], stats: { ...c.stats } };
    processEntities(dxf.entities ?? [], dxf, new Matrix4(), probe, {}, 0);
    const ext = rawExtent([...probe.tris, ...probe.lines]);
    unitsGuessed = true;
    if (ext > 1000) [unitScale, units] = [0.001, "mm (tahmini)"];
    else [unitScale, units] = [1, "m (tahmini)"];
  }

  const rawOpts: DxfImportOptions = {
    extrude2dHeight: opts.extrude2dHeight ? opts.extrude2dHeight / unitScale : undefined,
  };
  processEntities(dxf.entities ?? [], dxf, new Matrix4(), c, rawOpts, 0);

  // Birim + eksen dönüşümü: (x,y,z)_dxf → (x, z, −y)_three, metre
  const conv = (src: number[]): number[] => {
    const out = new Array<number>(src.length);
    for (let i = 0; i < src.length; i += 3) {
      out[i] = src[i] * unitScale;
      out[i + 1] = src[i + 2] * unitScale;
      out[i + 2] = -src[i + 1] * unitScale;
    }
    return out;
  };
  const triangles = conv(c.tris);
  const lines = conv(c.lines);

  if (triangles.length === 0 && lines.length === 0) {
    throw new Error(tStatic("DXF dosyasında görüntülenebilir geometri bulunamadı (yalnız metin/ölçü olabilir)."));
  }

  // Sınırlayıcı kutu → XZ ortala, taban y=0
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const arr of [triangles, lines]) {
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = arr[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const arr of [triangles, lines]) {
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] -= off[0];
      arr[i + 1] -= off[1];
      arr[i + 2] -= off[2];
    }
  }

  return {
    triangles,
    lines,
    size: {
      width: Math.max(MIN_DIM, max[0] - min[0]),
      depth: Math.max(MIN_DIM, max[2] - min[2]),
      height: Math.max(MIN_DIM, max[1] - min[1]),
    },
    unitScale,
    units,
    unitsGuessed,
    stats: c.stats,
  };
}

function rawExtent(arr: number[]): number {
  let ext = 0;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = k; i < arr.length; i += 3) {
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    if (hi > lo) ext = Math.max(ext, hi - lo);
  }
  return ext;
}

/** Geometri dizilerinden three Group (Mesh + LineSegments). WebGL gerektirmez. */
export function geometryDataToObject(data: DxfGeometryData): Group {
  const root = new Group();
  root.name = "DXF";
  if (data.triangles.length) {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(data.triangles, 3));
    g.computeVertexNormals();
    const mesh = new Mesh(
      g,
      new MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.85, side: DoubleSide }),
    );
    mesh.name = "DXF_Yuzeyler";
    root.add(mesh);
  }
  if (data.lines.length) {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(data.lines, 3));
    const ls = new LineSegments(g, new LineBasicMaterial({ color: 0x1f2937 }));
    ls.name = "DXF_Cizgiler";
    root.add(ls);
  }
  return root;
}

/** DXF metni → { three Group, geometri verisi } (tek adım, saf). */
export function dxfTextToObject(
  text: string,
  opts: DxfImportOptions = {},
): { object: Group; data: DxfGeometryData } {
  const data = dxfToGeometryData(parseDxfText(text), opts);
  return { object: geometryDataToObject(data), data };
}

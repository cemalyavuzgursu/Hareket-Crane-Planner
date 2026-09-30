import { describe, it, expect } from "vitest";
import {
  parseDxfText,
  dxfToGeometryData,
  dxfTextToObject,
} from "../ui/dxfImport";

/** Grup kodu/değer çiftlerinden DXF metni üret. */
function dxf(insunits: number | null, entities: (string | number)[][], blocks: (string | number)[][] = []): string {
  const pairs: (string | number)[] = [];
  const add = (arr: (string | number)[]) => pairs.push(...arr);
  add([0, "SECTION", 2, "HEADER"]);
  if (insunits != null) add([9, "$INSUNITS", 70, insunits]);
  add([0, "ENDSEC"]);
  if (blocks.length) {
    add([0, "SECTION", 2, "BLOCKS"]);
    for (const b of blocks) add(b);
    add([0, "ENDSEC"]);
  }
  add([0, "SECTION", 2, "ENTITIES"]);
  for (const e of entities) add(e);
  add([0, "ENDSEC", 0, "EOF"]);
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) lines.push(String(pairs[i]), String(pairs[i + 1]));
  return lines.join("\n") + "\n";
}

const line = (x1: number, y1: number, x2: number, y2: number, z = 0) => [
  0, "LINE", 8, "0", 10, x1, 20, y1, 30, z, 11, x2, 21, y2, 31, z,
];

const lwpoly = (pts: [number, number][], closed: boolean, thickness = 0, bulges: number[] = []) => {
  const out: (string | number)[] = [0, "LWPOLYLINE", 8, "0", 90, pts.length, 70, closed ? 1 : 0];
  if (thickness) out.push(39, thickness);
  pts.forEach(([x, y], i) => {
    out.push(10, x, 20, y);
    if (bulges[i]) out.push(42, bulges[i]);
  });
  return out;
};

const face3d = (p: [number, number, number][]) => {
  const out: (string | number)[] = [0, "3DFACE", 8, "0"];
  p.forEach(([x, y, z], i) => out.push(10 + i, x, 20 + i, y, 30 + i, z));
  return out;
};

function bounds(arr: number[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], arr[i + k]);
      max[k] = Math.max(max[k], arr[i + k]);
    }
  return { min, max };
}

describe("dxfImport", () => {
  it("mm birimli yalnız-çizgi çizim: metreye çevrilir, ortalanır, min yükseklik 0.1", () => {
    const d = dxfToGeometryData(
      parseDxfText(dxf(4, [line(0, 0, 10000, 0), line(10000, 0, 10000, 4000)])),
    );
    expect(d.unitScale).toBe(0.001);
    expect(d.triangles.length).toBe(0);
    expect(d.lines.length).toBe(4 * 3);
    expect(d.size.width).toBeCloseTo(10);
    expect(d.size.depth).toBeCloseTo(4);
    expect(d.size.height).toBeCloseTo(0.1);
    const b = bounds(d.lines);
    expect(b.min[0]).toBeCloseTo(-5);
    expect(b.max[0]).toBeCloseTo(5);
    expect(b.min[2]).toBeCloseTo(-2);
    expect(b.max[2]).toBeCloseTo(2);
    expect(b.min[1]).toBeCloseTo(0);
  });

  it("Z-yukarı → Y-yukarı: DXF +Y three −Z olur, DXF Z three Y olur", () => {
    const d = dxfToGeometryData(
      parseDxfText(dxf(6, [face3d([[0, 0, 0], [1, 0, 0], [1, 2, 5], [1, 2, 5]])])),
    );
    expect(d.triangles.length).toBe(9); // tek üçgen (4. köşe = 3.)
    expect(d.size.height).toBeCloseTo(5);
    expect(d.size.depth).toBeCloseTo(2);
    // Yüksekliği 5 olan köşe (DXF y=2) three'de en küçük z'ye sahip olmalı
    let topZ = 0;
    for (let i = 0; i < d.triangles.length; i += 3) if (d.triangles[i + 1] > 4.9) topZ = d.triangles[i + 2];
    expect(topZ).toBeCloseTo(-1);
  });

  it("kalınlıklı kapalı LWPOLYLINE ekstrüde edilir", () => {
    const d = dxfToGeometryData(
      parseDxfText(dxf(6, [lwpoly([[0, 0], [4, 0], [4, 3], [0, 3]], true, 2.5)])),
    );
    expect(d.stats.extruded).toBe(1);
    // 4 duvar × 2 + 2 kapak × 2 = 12 üçgen
    expect(d.triangles.length).toBe(12 * 9);
    expect(d.size.width).toBeCloseTo(4);
    expect(d.size.depth).toBeCloseTo(3);
    expect(d.size.height).toBeCloseTo(2.5);
  });

  it("kalınlıksız kapalı çizim: extrude2dHeight ile 3 m'ye çıkar (mm dosyada da metre)", () => {
    const text = dxf(4, [lwpoly([[0, 0], [5000, 0], [5000, 5000], [0, 5000]], true)]);
    const flat = dxfToGeometryData(parseDxfText(text));
    expect(flat.triangles.length).toBe(0);
    expect(flat.lines.length).toBe(4 * 2 * 3);
    const ext = dxfToGeometryData(parseDxfText(text), { extrude2dHeight: 3 });
    expect(ext.size.height).toBeCloseTo(3);
    expect(ext.size.width).toBeCloseTo(5);
    expect(ext.triangles.length).toBeGreaterThan(0);
  });

  it("açık polyline extrude2dHeight ile ekstrüde edilmez", () => {
    const d = dxfToGeometryData(
      parseDxfText(dxf(6, [lwpoly([[0, 0], [4, 0], [4, 3]], false)])),
      { extrude2dHeight: 3 },
    );
    expect(d.triangles.length).toBe(0);
    expect(d.size.height).toBeCloseTo(0.1);
  });

  it("bulge=1 yarım daire yayı doğru tessellate edilir", () => {
    const d = dxfToGeometryData(
      parseDxfText(dxf(6, [lwpoly([[0, 0], [2, 0]], false, 0, [1]), line(0, 1, 2, 1)])),
    );
    // Yarıçap 1, merkez (1,0). CCW (bulge > 0) p0=(0,0)→p1=(2,0): yay DXF −y
    // tarafında (y=−1'e iner). Referans çizgisi y=+1 → toplam derinlik 2 m.
    expect(d.size.width).toBeCloseTo(2);
    expect(d.size.depth).toBeCloseTo(2, 3);
    // Yay birden çok parçaya bölünmüş olmalı
    const arcPts = d.lines.length / 3 - 2;
    expect(arcPts).toBeGreaterThan(8);
  });

  it("CIRCLE / ARC çizgiye dönüşür; birimsiz küçük kapsam metre sayılır", () => {
    const d = dxfToGeometryData(
      parseDxfText(
        dxf(null, [
          [0, "CIRCLE", 8, "0", 10, 0, 20, 0, 30, 0, 40, 2],
          [0, "ARC", 8, "0", 10, 10, 20, 0, 30, 0, 40, 1, 50, 0, 51, 90],
        ]),
      ),
    );
    expect(d.unitScale).toBe(1);
    expect(d.unitsGuessed).toBe(true);
    expect(d.size.width).toBeCloseTo(13, 1); // −2..11
    expect(d.lines.length).toBeGreaterThan(0);
  });

  it("birimsiz büyük kapsam mm varsayılır", () => {
    const d = dxfToGeometryData(parseDxfText(dxf(null, [line(0, 0, 20000, 0)])));
    expect(d.unitScale).toBe(0.001);
    expect(d.size.width).toBeCloseTo(20);
  });

  it("SOLID iki üçgen üretir; inç birimi", () => {
    const d = dxfToGeometryData(
      parseDxfText(
        dxf(1, [[0, "SOLID", 8, "0", 10, 0, 20, 0, 30, 0, 11, 10, 21, 0, 31, 0, 12, 0, 22, 10, 32, 0, 13, 10, 23, 10, 33, 0]]),
      ),
    );
    expect(d.triangles.length).toBe(18);
    expect(d.size.width).toBeCloseTo(0.254);
  });

  it("POLYFACE mesh üçgenlere dönüşür", () => {
    const v = (x: number, y: number, z: number) => [0, "VERTEX", 8, "0", 10, x, 20, y, 30, z, 70, 192];
    const f = (a: number, b: number, c: number, d: number) => [0, "VERTEX", 8, "0", 10, 0, 20, 0, 30, 0, 70, 128, 71, a, 72, b, 73, c, 74, d];
    const ents = [
      [0, "POLYLINE", 8, "0", 66, 1, 10, 0, 20, 0, 30, 0, 70, 64, 71, 4, 72, 1],
      v(0, 0, 0), v(1, 0, 0), v(1, 1, 1), v(0, 1, 1),
      f(1, 2, 3, 4),
      [0, "SEQEND", 8, "0"],
    ];
    const d = dxfToGeometryData(parseDxfText(dxf(6, ents)));
    expect(d.triangles.length).toBe(18);
    expect(d.size.height).toBeCloseTo(1);
  });

  it("INSERT blok referansı konum ve ölçekle açılır", () => {
    const blocks = [
      [0, "BLOCK", 8, "0", 2, "KUTU", 70, 0, 10, 0, 20, 0, 30, 0, 3, "KUTU"],
      line(0, 0, 1, 0),
      [0, "ENDBLK", 8, "0"],
    ];
    const ents = [
      [0, "INSERT", 8, "0", 2, "KUTU", 10, 100, 20, 0, 30, 0, 41, 5, 42, 5, 43, 5, 50, 0],
      line(0, 0, 1, 0),
    ];
    const d = dxfToGeometryData(parseDxfText(dxf(6, ents, blocks)));
    expect(d.lines.length).toBe(4 * 3);
    expect(d.size.width).toBeCloseTo(105); // 0..105
  });

  it("geometrisi olmayan dosya Türkçe hata verir", () => {
    expect(() =>
      dxfToGeometryData(parseDxfText(dxf(6, [[0, "TEXT", 8, "0", 10, 0, 20, 0, 30, 0, 40, 1, 1, "merhaba"]]))),
    ).toThrow(/geometri bulunamadı/);
  });

  it("dxfTextToObject Mesh + LineSegments içeren Group döndürür", () => {
    const { object, data } = dxfTextToObject(
      dxf(6, [line(0, 0, 3, 0), lwpoly([[0, 0], [1, 0], [1, 1]], true, 1)]),
    );
    const types = object.children.map((c) => c.type).sort();
    expect(types).toEqual(["LineSegments", "Mesh"]);
    expect(data.size.height).toBeCloseTo(1);
  });
});

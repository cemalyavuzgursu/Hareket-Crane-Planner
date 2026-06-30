/**
 * bimImport.ts — BIM/CAD dosyalarını (.ifc, .obj) içe aktarma.
 *
 * Strateji: her formatı bir THREE.Object3D'ye çözüp GLTFExporter ile bir GLB
 * blob URL'ine dönüştürürüz. Böylece sahnedeki render tek (doğrulanmış) glTF
 * yolundan geçer — Crane3D'deki useGLTF bunu doğrudan yükler.
 *
 *   - .glb / .gltf : doğrudan object URL (dönüştürme gerekmez)
 *   - .obj         : three OBJLoader → GLB
 *   - .ifc         : web-ifc (WASM) geometri çıkarımı → GLB
 *
 * Not: web-ifc WASM dosyası unpkg CDN'den yüklenir (çevrimiçi gerekir). IFC
 * koordinatları gerçek-dünya ölçeğinde olabilir; Crane3D modeli ilan edilen
 * sınırlayıcı kutuya ölçeklediği için bu sorun olmaz.
 */
import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Color,
  Matrix4,
  Group,
  Object3D,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

export type ImportableExt = "glb" | "gltf" | "obj" | "ifc";

/** Dosya adından desteklenen uzantıyı çıkar (yoksa null). */
export function importableExt(name: string): ImportableExt | null {
  const m = name.toLowerCase().match(/\.(glb|gltf|obj|ifc)$/);
  return m ? (m[1] as ImportableExt) : null;
}

/** Bir Object3D'yi GLB blob URL'ine aktar. */
function objectToGlbUrl(obj: Object3D): Promise<string> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      obj,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
        resolve(URL.createObjectURL(blob));
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true },
    );
  });
}

/** .obj → GLB blob URL. */
async function objToGlbUrl(file: File): Promise<string> {
  const text = await file.text();
  const group = new OBJLoader().parse(text);
  // OBJLoader varsayılan olarak MeshPhongMaterial atar; glTF için MeshStandard'a
  // çevir (varsa rengi koru) — hem uyarıyı önler hem tutarlı render sağlar.
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!(mesh as any).isMesh) return;
    const prev = mesh.material as any;
    const color = prev && prev.color ? prev.color.clone() : new Color(0x9ca3af);
    mesh.material = new MeshStandardMaterial({ color, roughness: 0.8 });
  });
  return objectToGlbUrl(group);
}

// web-ifc API örneği (tek sefer init edilir).
let ifcApiPromise: Promise<any> | null = null;
async function getIfcApi(): Promise<any> {
  if (ifcApiPromise) return ifcApiPromise;
  ifcApiPromise = (async () => {
    const { IfcAPI } = await import("web-ifc");
    const api = new IfcAPI();
    // WASM'ı CDN'den, sürüme kilitli mutlak yol ile yükle.
    api.SetWasmPath("https://unpkg.com/web-ifc@0.0.57/", true);
    await api.Init();
    return api;
  })();
  return ifcApiPromise;
}

/** .ifc → GLB blob URL (web-ifc geometri çıkarımı). */
async function ifcToGlbUrl(file: File): Promise<string> {
  const api = await getIfcApi();
  const data = new Uint8Array(await file.arrayBuffer());
  const modelID = api.OpenModel(data);
  const root = new Group();

  try {
    api.StreamAllMeshes(modelID, (flatMesh: any) => {
      const placed = flatMesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);

        const verts: Float32Array = api.GetVertexArray(
          geom.GetVertexData(),
          geom.GetVertexDataSize(),
        );
        const indices: Uint32Array = api.GetIndexArray(
          geom.GetIndexData(),
          geom.GetIndexDataSize(),
        );

        // verts: vertex başına 6 float → [px,py,pz, nx,ny,nz]
        const n = verts.length / 6;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let v = 0; v < n; v++) {
          pos[v * 3] = verts[v * 6];
          pos[v * 3 + 1] = verts[v * 6 + 1];
          pos[v * 3 + 2] = verts[v * 6 + 2];
          nor[v * 3] = verts[v * 6 + 3];
          nor[v * 3 + 1] = verts[v * 6 + 4];
          nor[v * 3 + 2] = verts[v * 6 + 5];
        }

        const bg = new BufferGeometry();
        bg.setAttribute("position", new BufferAttribute(pos, 3));
        bg.setAttribute("normal", new BufferAttribute(nor, 3));
        bg.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
        // Yerleşim dönüşümünü doğrudan geometriye bak (export için en sağlamı).
        bg.applyMatrix4(new Matrix4().fromArray(pg.flatTransformation));

        const c = pg.color;
        const mat = new MeshStandardMaterial({
          color: new Color(c.x, c.y, c.z),
          transparent: c.w < 1,
          opacity: c.w,
          roughness: 0.8,
        });
        root.add(new Mesh(bg, mat));
        geom.delete?.();
      }
    });
  } finally {
    api.CloseModel(modelID);
  }

  if (root.children.length === 0) {
    throw new Error("IFC dosyasında görüntülenebilir geometri bulunamadı.");
  }
  return objectToGlbUrl(root);
}

/**
 * Bir dosyayı içe aktarılabilir GLB/glTF object URL'ine çevirir.
 * .glb/.gltf doğrudan; .obj/.ifc dönüştürülerek.
 */
export async function fileToModelUrl(file: File): Promise<string> {
  const ext = importableExt(file.name);
  if (!ext) throw new Error(`Desteklenmeyen dosya türü: ${file.name}`);
  switch (ext) {
    case "glb":
    case "gltf":
      return URL.createObjectURL(file);
    case "obj":
      return objToGlbUrl(file);
    case "ifc":
      return ifcToGlbUrl(file);
  }
}

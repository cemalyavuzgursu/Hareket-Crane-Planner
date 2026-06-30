import { useEffect, useState } from "react";
import type { SceneObject, SceneObjectKind } from "../engine/types";
import { fileToModelUrl, importableExt } from "./bimImport";

export interface ObjectLibraryProps {
  objects: SceneObject[];
  onChange: (objects: SceneObject[]) => void;
}

/** Tür meta verisi: ikon, Türkçe etiket ve varsayılan ölçü/konum. */
interface KindMeta {
  kind: SceneObjectKind;
  icon: string;
  label: string;
  defaults: Pick<
    SceneObject,
    "x" | "z" | "width" | "depth" | "height"
  >;
}

const KIND_META: KindMeta[] = [
  {
    kind: "building",
    icon: "🏢",
    label: "Bina",
    defaults: { x: 12, z: 8, width: 6, depth: 6, height: 12 },
  },
  {
    kind: "obstacle",
    icon: "⬛",
    label: "Engel",
    defaults: { x: 6, z: 0, width: 2, depth: 2, height: 3 },
  },
  {
    kind: "truck",
    icon: "🚚",
    label: "Kamyon",
    defaults: { x: -12, z: 6, width: 8, depth: 2.5, height: 3 },
  },
  {
    kind: "person",
    icon: "🧍",
    label: "Personel",
    defaults: { x: 8, z: -6, width: 0.6, depth: 0.6, height: 1.8 },
  },
  {
    kind: "powerline",
    icon: "⚡",
    label: "Enerji Hattı",
    defaults: { x: 14, z: 0, width: 0.3, depth: 20, height: 10 },
  },
];

/** Tür anahtarından meta verisini bul. */
function metaFor(kind: SceneObjectKind): KindMeta {
  return KIND_META.find((m) => m.kind === kind) ?? KIND_META[0];
}

/** Benzersiz id üret: crypto.randomUUID varsa onu, yoksa basit fallback. */
function makeId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return String(Date.now()) + Math.random().toString(16).slice(2);
}

interface MiniNumProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}

/**
 * Kompakt sayı girişi (mono). Kullanıcı alanı geçici olarak boşaltabilir;
 * geçersizse onBlur'da eski değere döner. State yukarıda tutulur.
 */
function MiniNum({ label, value, step = 0.5, min, onChange }: MiniNumProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    const cur = parseFloat(text);
    if (!Number.isFinite(cur) || cur !== value) {
      setText(Number.isFinite(value) ? String(value) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        fontSize: 10,
        color: "var(--text-faint)",
      }}
    >
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        style={{ padding: "4px 6px", fontSize: 12 }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const n = parseFloat(t);
          if (Number.isFinite(n)) onChange(min != null ? Math.max(min, n) : n);
        }}
        onBlur={() => {
          if (!Number.isFinite(parseFloat(text))) setText(String(value));
        }}
      />
    </label>
  );
}

export default function ObjectLibrary({
  objects,
  onChange,
}: ObjectLibraryProps): JSX.Element {
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");

  /** Verilen türden yeni nesne ekle (varsayılan ölçülerle). */
  function addObject(kind: SceneObjectKind): void {
    const meta = metaFor(kind);
    // Aynı türden kaç tane var → etiket sıra numarası.
    const sameKindCount = objects.filter((o) => o.kind === kind).length;
    // Üst üste binmesin diye z'ye küçük bir kayma ver.
    const zOffset = 2 * objects.length;
    const obj: SceneObject = {
      id: makeId(),
      kind,
      label: `${meta.label} ${sameKindCount + 1}`,
      x: meta.defaults.x,
      z: meta.defaults.z + zOffset,
      width: meta.defaults.width,
      depth: meta.defaults.depth,
      height: meta.defaults.height,
    };
    onChange([...objects, obj]);
  }

  /** İçe aktarılan 3B/BIM dosyasından model nesnesi ekle (.glb/.gltf/.obj/.ifc). */
  async function importModel(file: File): Promise<void> {
    if (!importableExt(file.name)) {
      setImportErr(`Desteklenmeyen tür: ${file.name} (.glb .gltf .obj .ifc)`);
      return;
    }
    setImportErr("");
    setImporting(true);
    try {
      const url = await fileToModelUrl(file);
      const obj: SceneObject = {
        id: makeId(),
        kind: "model",
        label: file.name.replace(/\.(glb|gltf|obj|ifc)$/i, ""),
        x: 0,
        z: 14 + 2 * objects.length,
        width: 6,
        depth: 6,
        height: 6,
        rotationY: 0,
        modelUrl: url,
        modelName: file.name,
      };
      onChange([...objects, obj]);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  /** Bir nesneyi kısmi yama ile güncelle. */
  function updateObject(id: string, patch: Partial<SceneObject>): void {
    onChange(objects.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  /** Bir nesneyi sil. */
  function removeObject(id: string): void {
    onChange(objects.filter((o) => o.id !== id));
  }

  return (
    <div className="card">
      <h3>🏗 Nesne Kütüphanesi / Çevre</h3>

      <div
        className="section-title"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Çevre Nesneleri Ekle</span>
        <span
          style={{
            fontFamily: "var(--mono)",
            color: "var(--text-dim)",
            border: "1px solid var(--border-2)",
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 11,
          }}
        >
          {objects.length}
        </span>
      </div>

      {/* Ekleme satırı: tür butonları */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          marginBottom: 12,
        }}
      >
        {KIND_META.map((m) => (
          <div
            key={m.kind}
            className="toggle"
            title={`${m.label} ekle`}
            onClick={() => addObject(m.kind)}
            style={{ fontSize: 12, padding: "7px 4px" }}
          >
            {m.icon} {m.label}
          </div>
        ))}
      </div>

      {/* 3B / BIM model içe aktarma (glTF/GLB/OBJ/IFC) */}
      <label
        className="btn ghost"
        style={{
          display: "block", textAlign: "center", marginBottom: importErr ? 6 : 12,
          fontSize: 12, padding: "8px 4px",
          cursor: importing ? "wait" : "pointer", opacity: importing ? 0.6 : 1,
        }}
        title="3B/BIM model içe aktar — glTF, GLB, OBJ veya IFC (DWG: önce glTF/IFC'e dönüştürün)"
      >
        {importing ? "⏳ İçe aktarılıyor…" : "📦 3B / BIM Model İçe Aktar (.glb .gltf .obj .ifc)"}
        <input
          type="file"
          accept=".glb,.gltf,.obj,.ifc,model/gltf-binary,model/gltf+json"
          disabled={importing}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importModel(f);
            e.target.value = ""; // aynı dosya tekrar seçilebilsin
          }}
        />
      </label>
      {importErr && (
        <div className="error-box" style={{ marginBottom: 12, fontSize: 12 }}>⚠ {importErr}</div>
      )}

      {/* Yerleştirilmiş nesneler listesi */}
      {objects.length === 0 ? (
        <div className="disclaimer">
          Henüz nesne yok. Yukarıdan ekleyin.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {objects.map((o) => {
            const meta = metaFor(o.kind);
            const isModel = o.kind === "model";
            const icon = isModel ? "📦" : meta.icon;
            return (
              <div
                key={o.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  background: "var(--bg)",
                }}
              >
                {/* Üst satır: ikon + düzenlenebilir etiket + sil */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 14 }} title={isModel ? "3B Model" : meta.label}>
                    {icon}
                  </span>
                  <input
                    type="text"
                    value={o.label}
                    onChange={(e) =>
                      updateObject(o.id, { label: e.target.value })
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "5px 8px",
                      background: "var(--panel)",
                      border: "1px solid var(--border-2)",
                      borderRadius: 6,
                      color: "var(--text)",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    title="Sil"
                    onClick={() => removeObject(o.id)}
                    style={{
                      flex: "0 0 auto",
                      width: 26,
                      height: 26,
                      lineHeight: "1",
                      borderRadius: 6,
                      cursor: "pointer",
                      border: "1px solid rgba(255,90,77,.45)",
                      background: "rgba(255,90,77,.12)",
                      color: "var(--red)",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {isModel && o.modelName && (
                  <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 6, fontFamily: "var(--mono)" }}>
                    {o.modelName} · sınırlayıcı kutu çarpışma için kullanılır
                  </div>
                )}

                {/* Alt satır: ölçü/konum/dönüş girişleri */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 6,
                  }}
                >
                  <MiniNum
                    label="x (m)"
                    value={o.x}
                    onChange={(v) => updateObject(o.id, { x: v })}
                  />
                  <MiniNum
                    label="z (m)"
                    value={o.z}
                    onChange={(v) => updateObject(o.id, { z: v })}
                  />
                  <MiniNum
                    label="En (m)"
                    value={o.width}
                    min={0.1}
                    onChange={(v) => updateObject(o.id, { width: v })}
                  />
                  <MiniNum
                    label="Boy (m)"
                    value={o.depth}
                    min={0.1}
                    onChange={(v) => updateObject(o.id, { depth: v })}
                  />
                  <MiniNum
                    label="Yük (m)"
                    value={o.height}
                    min={0.1}
                    onChange={(v) => updateObject(o.id, { height: v })}
                  />
                  <MiniNum
                    label="Dön (°)"
                    value={o.rotationY ?? 0}
                    step={15}
                    onChange={(v) => updateObject(o.id, { rotationY: v })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

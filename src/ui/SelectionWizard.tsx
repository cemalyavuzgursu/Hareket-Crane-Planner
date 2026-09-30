/**
 * SelectionWizard.tsx — "Makine Seçim Sihirbazı" modalı. Verilen kaldırma
 * (yük, radius, engel, aparat) için tüm vinç × denge ağırlığı × kapasite modu ×
 * ana bom kombinasyonlarını tarar (bkz. engine/selection.ts findConfigurations)
 * ve uygun konfigürasyonu tek tıkla plana uygular.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CraneModel } from "../engine/types";
import { findConfigurations, type SelectionQuery } from "../engine/selection";
import { useI18n } from "./i18n";
import { inputDisplay, makeUnits, useUnits, type Units } from "./units";
import { fromDisplay, toDisplay, unitLabel, type UnitKind } from "./UnitInput";

interface Props {
  cranes: CraneModel[];
  initial: {
    total_load: number;
    radius: number;
    load_height: number;
    load_diameter: number;
    obstacle_height: number;
    obstacle_distance: number;
    obstacle_width: number;
    rigging_height: number;
  };
  onApply: (c: {
    crane_model: string;
    counterweight: number;
    capacity_pct: number;
    boom_length: number;
    radius: number;
  }) => void;
  onClose: () => void;
}

type FieldKey =
  | "total_load"
  | "radius"
  | "load_height"
  | "load_diameter"
  | "obstacle_height"
  | "obstacle_width"
  | "obstacle_distance"
  | "rigging_height"
  | "required_hook_height"
  | "max_utilization_pct"
  | "min_clearance_m";

type Draft = Record<FieldKey, string>;

/** Etiketler Türkçe kaynak; render'da t() ile çevrilir. kind: görüntü birimi dönüşümü. */
const FIELDS: Array<{ key: FieldKey; label: string; kind: UnitKind | "pct"; placeholder?: string }> = [
  { key: "total_load", label: "Toplam kanca yükü", kind: "mass" },
  { key: "radius", label: "Radius", kind: "len" },
  { key: "load_height", label: "Yük yüksekliği", kind: "len" },
  { key: "load_diameter", label: "Yük çapı", kind: "len" },
  { key: "obstacle_height", label: "Engel yüksekliği", kind: "len" },
  { key: "obstacle_width", label: "Engel genişliği", kind: "len" },
  { key: "obstacle_distance", label: "Engel uzaklığı", kind: "len" },
  { key: "rigging_height", label: "Aparat yüksekliği", kind: "len" },
  { key: "required_hook_height", label: "Gerekli min. kanca yüksekliği", kind: "len", placeholder: "boş = kontrol yok" },
  { key: "max_utilization_pct", label: "Maks. kapasite kullanımı", kind: "pct" },
  { key: "min_clearance_m", label: "Min. klerens", kind: "len" },
];

const KIND_OF = Object.fromEntries(FIELDS.map((f) => [f.key, f.kind])) as Record<FieldKey, UnitKind | "pct">;

/** Taslak metnini (görüntü birimi) SI sayıya çevirir. */
function numSI(u: Units, d: Draft, k: FieldKey): number | null {
  const v = num(d[k]);
  if (v == null) return null;
  const kind = KIND_OF[k];
  return kind === "pct" ? v : fromDisplay(u, kind, v);
}

const ROW_LIMIT = 60;

/** Metni sayıya çevirir; boş/geçersiz → null. Virgül ondalık ayırıcı kabul edilir. */
function num(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** SI değeri taslak metnine (görüntü birimi) çevirir. */
function str(u: Units, kind: UnitKind | "pct", v: number): string {
  if (!Number.isFinite(v)) return "";
  return kind === "pct" ? String(v) : inputDisplay(toDisplay(u, kind, v));
}

function fmt(v: number | null, digits: number): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function utilColor(u: number | null): string {
  if (u == null || !Number.isFinite(u)) return "var(--text-dim)";
  if (u <= 85) return "var(--green)";
  if (u <= 100) return "var(--accent)";
  return "var(--red)";
}

function buildQuery(u: Units, d: Draft): SelectionQuery | null {
  const n = (k: FieldKey) => numSI(u, d, k);
  const total_load = n("total_load");
  const radius = n("radius");
  if (total_load == null || radius == null || total_load <= 0 || radius <= 0) return null;
  const q: SelectionQuery = {
    total_load,
    radius,
    load_height: n("load_height") ?? 0,
    load_diameter: n("load_diameter") ?? 0,
    obstacle_height: n("obstacle_height") ?? 0,
    obstacle_distance: n("obstacle_distance") ?? 0,
    obstacle_width: n("obstacle_width") ?? 0,
    rigging_height: n("rigging_height") ?? 0,
    max_utilization_pct: n("max_utilization_pct") ?? 100,
    min_clearance_m: n("min_clearance_m") ?? 0,
  };
  const hook = n("required_hook_height");
  if (hook != null) q.required_hook_height = hook;
  return q;
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-dim)",
  borderBottom: "1px solid var(--border)",
  position: "sticky",
  top: 0,
  background: "var(--panel)",
  whiteSpace: "nowrap",
};
const tdStyle: CSSProperties = {
  padding: "5px 8px",
  fontSize: 12.5,
  borderBottom: "1px dashed var(--border)",
  whiteSpace: "nowrap",
};
const numTd: CSSProperties = { ...tdStyle, fontFamily: "var(--mono)", textAlign: "right" };

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "rgba(255,186,32,.1)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-faint)",
  };
}

export default function SelectionWizard({ cranes, initial, onApply, onClose }: Props) {
  const { t } = useI18n();
  const u = useUnits();
  const [draft, setDraft] = useState<Draft>(() => ({
    total_load: str(u, "mass", initial.total_load),
    radius: str(u, "len", initial.radius),
    load_height: str(u, "len", initial.load_height),
    load_diameter: str(u, "len", initial.load_diameter),
    obstacle_height: str(u, "len", initial.obstacle_height),
    obstacle_width: str(u, "len", initial.obstacle_width),
    obstacle_distance: str(u, "len", initial.obstacle_distance),
    rigging_height: str(u, "len", initial.rigging_height),
    required_hook_height: "",
    max_utilization_pct: "100",
    min_clearance_m: str(u, "len", 0.5),
  }));

  // Birim sistemi değişirse taslak metinlerini yeni birime çevir.
  const prevSys = useRef(u.system);
  useEffect(() => {
    if (prevSys.current === u.system) return;
    const prevU = makeUnits(prevSys.current);
    prevSys.current = u.system;
    setDraft((d) => {
      const next = { ...d };
      for (const f of FIELDS) {
        const si = numSI(prevU, d, f.key);
        if (si != null) next[f.key] = str(u, f.kind, si);
      }
      return next;
    });
  }, [u]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const query = useMemo(() => buildQuery(u, draft), [u, draft]);
  const activeCranes = useMemo(() => cranes.filter((c) => !excluded.has(c.model)), [cranes, excluded]);

  const results = useMemo(() => {
    if (!query || activeCranes.length === 0) return [];
    try {
      return findConfigurations(activeCranes, query);
    } catch {
      return [];
    }
  }, [query, activeCranes]);

  const feasibleCount = results.filter((r) => r.feasible).length;
  const rows = showAll ? results : results.slice(0, ROW_LIMIT);

  const set = (k: FieldKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setShowAll(false);
  };
  const toggleCrane = (model: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
    setShowAll(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card card"
        style={{ width: "95vw", maxWidth: 980, display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ margin: 0 }}>🧭 {t("Makine Seçim Sihirbazı")}</h3>
          <button className="btn ghost" type="button" style={{ width: "auto", margin: 0, padding: "6px 12px" }} onClick={onClose}>
            {t("Kapat")}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShowAll(false);
          }}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
            gap: "0 10px",
            marginTop: 12,
          }}
        >
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>
                {t(f.label)} <span className="unit">({f.kind === "pct" ? "%" : unitLabel(u, f.kind)})</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={draft[f.key]}
                placeholder={f.placeholder ? t(f.placeholder) : undefined}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.key === "max_utilization_pct" && (
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  {[85, 90, 100].map((p) => (
                    <button
                      key={p}
                      type="button"
                      style={chipStyle(num(draft.max_utilization_pct) === p)}
                      onClick={() => set("max_utilization_pct", String(p))}
                    >
                      %{p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn primary" type="submit">
              {t("Ara")}
            </button>
          </div>
        </form>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "4px 0 10px" }}>
          <span style={{ fontSize: 12, color: "var(--text-dim)", marginRight: 4 }}>{t("Vinçler:")}</span>
          {cranes.map((c) => (
            <button key={c.model} type="button" style={chipStyle(!excluded.has(c.model))} onClick={() => toggleCrane(c.model)}>
              {c.model}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          {query ? (
            <>
              <span style={{ color: feasibleCount > 0 ? "var(--green)" : "var(--red)" }}>
                {t("{n} uygun konfigürasyon", { n: feasibleCount })}
              </span>
              <span style={{ color: "var(--text-dim)", fontWeight: 400 }}> / {t("{n} denendi", { n: results.length })}</span>
            </>
          ) : (
            <span style={{ color: "var(--red)" }}>{t("Geçerli bir yük ve radius girin.")}</span>
          )}
        </div>

        <div style={{ overflow: "auto", maxHeight: "50vh", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("Vinç")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Denge")} ({u.massU})</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Mod")} (%)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Bom")} ({u.lenU})</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Kapasite")} ({u.massU})</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Kullanım")} %</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Yük klerensi")} ({u.lenU})</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Maks kanca")} ({u.lenU})</th>
                <th style={thStyle}>{t("Durum")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={`${c.crane_model}|${c.counterweight}|${c.capacity_pct}|${c.boom_length}`}
                  style={c.feasible ? undefined : { opacity: 0.55 }}
                >
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{c.crane_model}</td>
                  <td style={numTd}>{u.imperial ? u.fmtMassN(c.counterweight) : fmt(c.counterweight, 1)}</td>
                  <td style={numTd}>{c.capacity_pct}</td>
                  <td style={numTd}>{u.imperial ? u.fmtLenN(c.boom_length, 1) : String(+c.boom_length.toFixed(2))}</td>
                  <td style={numTd}>{u.imperial ? (c.rated_capacity == null ? "—" : u.fmtMassN(c.rated_capacity)) : fmt(c.rated_capacity, 1)}</td>
                  <td style={{ ...numTd, color: utilColor(c.utilization_pct), fontWeight: 700 }}>
                    {fmt(c.utilization_pct, 0)}
                  </td>
                  <td style={numTd}>{fmt(c.clearance_to_load == null ? null : u.len(c.clearance_to_load), 2)}</td>
                  <td style={numTd}>{fmt(c.max_hook_height == null ? null : u.len(c.max_hook_height), 1)}</td>
                  <td style={{ ...tdStyle, whiteSpace: "normal" }}>
                    {c.feasible ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--green)", fontWeight: 800 }}>✓</span>
                        <button
                          className="btn primary"
                          type="button"
                          style={{ width: "auto", margin: 0, padding: "4px 12px", fontSize: 12 }}
                          onClick={() => {
                            if (!query) return;
                            onApply({
                              crane_model: c.crane_model,
                              counterweight: c.counterweight,
                              capacity_pct: c.capacity_pct,
                              boom_length: c.boom_length,
                              radius: query.radius,
                            });
                            onClose();
                          }}
                        >
                          {t("Uygula")}
                        </button>
                      </span>
                    ) : (
                      <span style={{ color: "var(--red)", fontSize: 12 }}>✗ {c.reasons.join(", ")}</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "var(--text-faint)", padding: 16 }}>
                    {t("Bu radius için yük tablosunda konfigürasyon bulunamadı.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {results.length > ROW_LIMIT && (
          <button
            className="btn ghost"
            type="button"
            style={{ width: "auto", alignSelf: "flex-start", marginTop: 8, padding: "6px 12px", fontSize: 12 }}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? t("İlk {n} satırı göster", { n: ROW_LIMIT }) : t("Tümünü göster ({n})", { n: results.length })}
          </button>
        )}

        <div className="disclaimer">
          {t("Ana bom (jibsiz) konfigürasyonları taranır. Sonuçlar yük tablosu, klerens (gerçek geometri) ve kanca yüksekliği kontrollerine dayanır; nihai plan için tam hesap panelini kontrol edin.")}
        </div>
      </div>
    </div>
  );
}

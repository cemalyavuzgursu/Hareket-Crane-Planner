import { type CSSProperties } from "react";
import { riggingTotals, type RiggingItem, type RiggingKind } from "./state";
import { RIGGING_TEMPLATES, newRiggingItem, slingLegTension } from "./rigging";
import { useI18n } from "./i18n";
import { useUnits } from "./units";
import UnitInput, { type UnitKind } from "./UnitInput";

interface Props {
  items: RiggingItem[];
  onChange: (items: RiggingItem[]) => void;
  hookLoad_t: number; // load weight (t) hanging below rigging, for sling tension display
}

const KINDS: RiggingKind[] = ["sling2", "sling4", "spreader", "beam", "shackle", "custom"];

/** EN 13414: düşeyden > 60° yasak; > 45° uyarı. */
const ANGLE_WARN_DEG = 45;
const ANGLE_MAX_DEG = 60;

const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : "∞");

interface NumProps {
  label: string;
  kind: UnitKind;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}

/** Kompakt sayı girişi (SI değer; görüntü birimine çevrilir). */
function Num({ label, kind, value, step = 0.1, onChange }: NumProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--text-faint)", minWidth: 0 }}>
      {label}
      <UnitInput
        kind={kind}
        value={value}
        step={step}
        min={0}
        style={{ padding: "4px 5px", fontSize: 12, width: "100%", minWidth: 0, boxSizing: "border-box" }}
        onChange={onChange}
      />
    </label>
  );
}

const smallBtn: CSSProperties = {
  flex: "0 0 auto",
  width: 22,
  height: 22,
  lineHeight: "1",
  padding: 0,
  borderRadius: 5,
  cursor: "pointer",
  border: "1px solid var(--border-2)",
  background: "var(--panel)",
  color: "var(--text-dim)",
  fontSize: 11,
};

export default function RiggingEditor({ items, onChange, hookLoad_t }: Props): JSX.Element {
  const { t } = useI18n();
  const u = useUnits();
  const totals = riggingTotals(items);

  const add = (kind: RiggingKind): void => onChange([...items, newRiggingItem(kind)]);
  const update = (id: string, patch: Partial<RiggingItem>): void =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id: string): void => onChange(items.filter((it) => it.id !== id));
  const move = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const load = Number.isFinite(hookLoad_t) ? Math.max(0, hookLoad_t) : 0;

  return (
    <div>
      {/* Şablon butonları */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 8 }}>
        {KINDS.map((k) => {
          const tp = RIGGING_TEMPLATES[k];
          return (
            <div
              key={k}
              className="toggle"
              title={t("{label} ekle — {desc}", { label: t(tp.label), desc: t(tp.desc) })}
              onClick={() => add(k)}
              style={{ fontSize: 10, padding: "5px 2px", textAlign: "center", lineHeight: 1.2 }}
            >
              <div style={{ fontSize: 14 }}>{tp.icon}</div>
              {t(tp.label)}
            </div>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="disclaimer">{t("Aparat yok — şablondan ekleyin. (Boşsa Rigging ağırlığı alanı kullanılır.)")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>▼ {t("Kanca (üstten aşağı asılma sırası)")}</div>
          {items.map((it, idx) => {
            const tpl = RIGGING_TEMPLATES[it.kind] ?? RIGGING_TEMPLATES.custom;
            const isSling = it.kind === "sling2" || it.kind === "sling4";
            // Sapanın altında asılı yük: kanca yükü + listede altındaki aparatlar.
            const below = items.slice(idx + 1).reduce((a, b) => a + (Number.isFinite(b.weight_t) ? b.weight_t : 0), 0);
            const sling = isSling
              ? slingLegTension(load + below, it.kind === "sling4" ? 4 : 2, it.height_m, it.length_m)
              : null;
            const slingColor = !sling
              ? undefined
              : sling.angle_deg > ANGLE_MAX_DEG
                ? "var(--red)"
                : sling.angle_deg > ANGLE_WARN_DEG
                  ? "var(--warning)"
                  : "var(--text-dim)";
            return (
              <div
                key={it.id}
                style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 6, background: "var(--bg)" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
                  <span style={{ fontSize: 12, width: 16, textAlign: "center" }} title={t(tpl.label)}>
                    {tpl.icon}
                  </span>
                  <input
                    type="text"
                    value={it.label}
                    onChange={(e) => update(it.id, { label: e.target.value })}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "3px 6px",
                      background: "var(--panel)",
                      border: "1px solid var(--border-2)",
                      borderRadius: 5,
                      color: "var(--text)",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                  <button type="button" title={t("Yukarı taşı")} style={smallBtn} disabled={idx === 0} onClick={() => move(idx, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    title={t("Aşağı taşı")}
                    style={smallBtn}
                    disabled={idx === items.length - 1}
                    onClick={() => move(idx, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title={t("Sil")}
                    onClick={() => remove(it.id)}
                    style={{
                      ...smallBtn,
                      border: "1px solid rgba(255,90,77,.45)",
                      background: "rgba(255,90,77,.12)",
                      color: "var(--red)",
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  <Num label={`${t("Ağırlık")} (${u.massU})`} kind="mass" value={it.weight_t} step={0.01} onChange={(v) => update(it.id, { weight_t: v })} />
                  <Num label={`${t("Yükseklik")} (${u.lenU})`} kind="len" value={it.height_m} onChange={(v) => update(it.id, { height_m: v })} />
                  <Num label={`${t("Uzunluk")} (${u.lenU})`} kind="len" value={it.length_m} onChange={(v) => update(it.id, { length_m: v })} />
                </div>
                {sling && (
                  <div style={{ fontSize: 10, marginTop: 5, fontFamily: "var(--mono)", color: slingColor }}>
                    {t("Ayak açısı {a}° (düşeyden) · Ayak kuvveti {f}", {
                      a: fmt(sling.angle_deg, 1),
                      f: Number.isFinite(sling.tension_t) ? u.fmtMass(sling.tension_t, u.imperial ? 0 : 2) : "∞",
                    })}
                    {it.kind === "sling4" && ` ${t("(2 ayak taşır kabulü)")}`}
                    {sling.angle_deg > ANGLE_MAX_DEG && (
                      <div style={{ fontWeight: 700 }}>⚠ {t("Açı > {n}° — izin verilmez (EN 13414)", { n: ANGLE_MAX_DEG })}</div>
                    )}
                    {sling.angle_deg > ANGLE_WARN_DEG && sling.angle_deg <= ANGLE_MAX_DEG && (
                      <div>⚠ {t("Açı > {n}° — sapanı uzatın / açıklığı azaltın", { n: ANGLE_WARN_DEG })}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>▲ {t("Yük")}</div>
        </div>
      )}

      {/* Özet */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          fontFamily: "var(--mono)",
          color: "var(--text)",
        }}
      >
        {t("Toplam ağırlık {w} · Toplam yükseklik {h}", { w: u.fmtMass(totals.weight, u.imperial ? 0 : 2), h: u.fmtLen(totals.height) })}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>
        {t("Aparat ağırlığı toplam yüke, yüksekliği kaldırma yüksekliği kontrolüne eklenir.")}
      </div>
    </div>
  );
}

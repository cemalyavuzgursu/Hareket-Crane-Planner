import type { CraneModel } from "../engine/types";
import { getCapacityCurve } from "../engine/capacity";
import type { TandemCraneResult, TandemResult } from "../engine/tandem";
import type { TandemState } from "./state";
import { useI18n } from "./i18n";
import { useUnits } from "./units";
import UnitInput from "./UnitInput";

/** TandemState + isteğe bağlı kanca aralığı (m) — state'te alan yoksa 4 m varsayılır. */
type TandemLike = TandemState & { hook_spacing?: number };

interface Props {
  tandem: TandemState | undefined;
  cranes: CraneModel[];
  mainHookSite: { x: number; z: number };
  craneX: number;
  craneZ: number;
  result: TandemResult | null;
  onChange: (t: TandemState) => void;
}

const DEG = 180 / Math.PI;
/** TR: virgül ondalık; EN: nokta. */
const fmtDec = (n: number, d: number, comma: boolean) => (comma ? n.toFixed(d).replace(".", ",") : n.toFixed(d));

/** Hedefe bakan plan açısı (°), [0,360). */
function headingToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const a = Math.atan2(to.z - from.z, to.x - from.x) * DEG;
  return Math.round(((a % 360) + 360) % 360);
}

/** Seçili modelden tutarlı varsayılan config alanları. */
function modelDefaults(c: CraneModel) {
  const pcts = c.capacity_pct_options ?? [75, 85];
  return {
    craneModel: c.model,
    counterweight: c.counterweight_options[c.counterweight_options.length - 1],
    capacity_pct: pcts.includes(75) ? 75 : pcts[0],
    boom_length: c.boom_lengths[0],
    outrigger_config: c.outrigger_configs[0],
  };
}

function utilClass(u: number | null): string {
  if (u == null) return "bad";
  if (u > 100) return "bad";
  if (u >= 90) return "warn";
  return "ok";
}

function CraneBlock({ title, r }: { title: string; r: TandemCraneResult }) {
  const { t, lang } = useI18n();
  const u = useUnits();
  const fmt = (n: number, d = 1) => fmtDec(n, d, lang === "tr");
  const fm = (n: number) => fmt(u.mass(n), u.imperial ? 0 : 1);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", margin: "6px 0 2px" }}>
        {title}{" "}
        <span className={r.ok ? "ok" : "bad"}>{r.ok ? t("UYGUN") : t("AŞIM / HATA")}</span>
      </div>
      <div className="kv"><span className="k">{t("Yük payı")}</span><span className="v">{fm(r.share_t)} <small>{u.massU}</small></span></div>
      <div className="kv"><span className="k">{t("Kancada toplam")}</span><span className="v">{fm(r.total_on_hook_t)} <small>{u.massU}</small></span></div>
      <div className="kv"><span className="k">{t("Radüs / dönme")}</span><span className="v">{fmt(u.len(r.radius))} <small>{u.lenU}</small> · {fmt(r.slew, 0)}<small>°</small></span></div>
      <div className="kv"><span className="k">{t("Tablo kapasitesi")}</span><span className="v">{r.rated_t == null ? "—" : fm(r.rated_t)} <small>{u.massU}</small></span></div>
      <div className="kv"><span className="k">{t("İzinli (düşürülmüş)")}</span><span className="v">{r.allowed_t == null ? "—" : fm(r.allowed_t)} <small>{u.massU}</small></span></div>
      <div className="kv">
        <span className="k">{t("Kullanım")}</span>
        <span className={`v ${utilClass(r.utilization_pct)}`}>
          {r.utilization_pct == null ? "—" : `%${fmt(r.utilization_pct, 0)}`}
        </span>
      </div>
      {!r.ok && <div className="error-box" style={{ marginTop: 6, fontSize: 12 }}>{r.message}</div>}
    </div>
  );
}

export default function TandemPanel({ tandem, cranes, mainHookSite, craneX, craneZ, result, onChange }: Props) {
  const { t, lang } = useI18n();
  const u = useUnits();
  const fmt = (n: number, d = 1) => fmtDec(n, d, lang === "tr");
  const tdm = tandem as TandemLike | undefined;

  const enable = () => {
    if (tdm) {
      onChange({ ...tdm, enabled: true });
      return;
    }
    const c = cranes[0];
    if (!c) return;
    // Ana vinçten ana kancaya doğru yön; vinç 2 kancanın öte tarafında, kendi
    // kancası (ana kancadan 4 m) varsayılan konfigürasyonunun tablo aralığının
    // ORTASINA düşecek mesafede → açılışta hesaplanabilir/çizilebilir olur.
    let dx = mainHookSite.x - craneX;
    let dz = mainHookSite.z - craneZ;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
    const defs = modelDefaults(c);
    let targetR = 10;
    try {
      const curve = getCapacityCurve(c, defs.counterweight, defs.capacity_pct, defs.boom_length);
      if (curve.length > 0) targetR = (curve[0][0] + curve[curve.length - 1][0]) / 2;
    } catch {
      /* tablo yoksa 10 m */
    }
    const dist = targetR + 4;
    const pos = { x: mainHookSite.x + dx * dist, z: mainHookSite.z + dz * dist };
    const init: TandemLike = {
      enabled: true,
      ...defs,
      x: Math.round(pos.x * 10) / 10,
      z: Math.round(pos.z * 10) / 10,
      heading: headingToward(pos, mainHookSite),
      cog_ratio: 0.5,
      derate_pct: 75,
      hook_spacing: 4,
    };
    onChange(init);
  };

  if (!tdm || !tdm.enabled) {
    return (
      <div className="cfg-fields">
        <div className="field">
          <label>{t("Tandem (iki vinçli) kaldırma")}</label>
          <div className="toggle-group">
            <div className="toggle active">{t("Kapalı")}</div>
            <div className="toggle" onClick={enable}>{t("Aç")}</div>
          </div>
        </div>
      </div>
    );
  }

  const crane = cranes.find((c) => c.model === tdm.craneModel) ?? cranes[0];
  const set = (patch: Partial<TandemLike>) => onChange({ ...tdm, ...patch });
  const num = (v: string, fb: number) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const pcts = crane?.capacity_pct_options ?? [75, 85];
  const cog = Math.min(1, Math.max(0, tdm.cog_ratio));

  return (
    <div className="cfg-fields">
      <div className="field">
        <label>{t("Tandem (iki vinçli) kaldırma")}</label>
        <div className="toggle-group">
          <div className="toggle" onClick={() => set({ enabled: false })}>{t("Kapalı")}</div>
          <div className="toggle active">{t("Açık")}</div>
        </div>
      </div>

      {result && (
        <div className={`banner ${result.ok ? "ok" : "bad"}`}>
          {result.ok ? `✓ ${t("Tandem UYGUN")}` : `✕ ${t("Tandem UYGUN DEĞİL")}`}
        </div>
      )}

      <div className="field">
        <label>{t("Vinç 2 Modeli")}</label>
        <select
          value={tdm.craneModel}
          onChange={(e) => {
            const c = cranes.find((x) => x.model === e.target.value);
            if (c) set(modelDefaults(c));
          }}
        >
          {cranes.map((c) => (
            <option key={c.model} value={c.model}>{c.model}</option>
          ))}
        </select>
      </div>

      {crane && (
        <>
          <div className="field">
            <label>{t("Denge Ağırlığı")}</label>
            <select value={tdm.counterweight} onChange={(e) => set({ counterweight: parseFloat(e.target.value) })}>
              {crane.counterweight_options.map((cw) => (
                <option key={cw} value={cw}>{u.imperial ? u.fmtMass(cw) : `${cw} t`}</option>
              ))}
            </select>
          </div>
          {pcts.length > 1 && (
            <div className="field">
              <label>{t("Kapasite Oranı")}</label>
              <div className="toggle-group">
                {pcts.map((p) => (
                  <div key={p} className={`toggle ${tdm.capacity_pct === p ? "active" : ""}`} onClick={() => set({ capacity_pct: p })}>
                    %{p}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid2">
            <div className="field">
              <label>{t("Bom")} ({u.lenU})</label>
              <select value={tdm.boom_length} onChange={(e) => set({ boom_length: parseFloat(e.target.value) })}>
                {crane.boom_lengths.map((b) => (
                  <option key={b} value={b}>{u.imperial ? u.fmtLenN(b, 1) : b}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t("Ayak")}</label>
              <select value={tdm.outrigger_config} onChange={(e) => set({ outrigger_config: e.target.value })}>
                {crane.outrigger_configs.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="grid2">
        <div className="field">
          <label>{t("Konum X")} <span className="unit">({u.lenU})</span></label>
          <UnitInput kind="len" step={0.5} value={tdm.x} onChange={(v) => set({ x: v })} />
        </div>
        <div className="field">
          <label>{t("Konum Z")} <span className="unit">({u.lenU})</span></label>
          <UnitInput kind="len" step={0.5} value={tdm.z} onChange={(v) => set({ z: v })} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>{t("Yön")} <span className="unit">(°)</span></label>
          <input type="number" step={5} value={tdm.heading} onChange={(e) => set({ heading: num(e.target.value, tdm.heading) })} />
        </div>
        <div className="field">
          <label>{t("Kanca aralığı")} <span className="unit">({u.lenU})</span></label>
          <UnitInput
            kind="len" step={0.5} min={0}
            value={tdm.hook_spacing ?? 4}
            onChange={(v) => set({ hook_spacing: Math.max(0, v) })}
          />
        </div>
      </div>
      <button
        className="btn ghost"
        style={{ marginBottom: 10, padding: 8, fontSize: 12 }}
        onClick={() => set({ heading: headingToward({ x: tdm.x, z: tdm.z }, mainHookSite) })}
      >
        {t("Yükü ortala (vinç 2'yi ana kancaya çevir)")}
      </button>

      <div className="field">
        <label>
          {t("Ağırlık merkezi konumu:")} {fmt(cog, 2)} <span className="unit">{t("(0 = vinç 1 kancası, 1 = vinç 2)")}</span>
        </label>
        <input
          type="range" min={0} max={1} step={0.01} value={cog} style={{ width: "100%" }}
          onChange={(e) => set({ cog_ratio: parseFloat(e.target.value) })}
        />
        <div className="kv"><span className="k">{t("Pay oranı V1 / V2")}</span><span className="v">%{fmt((1 - cog) * 100, 0)} / %{fmt(cog * 100, 0)}</span></div>
      </div>

      <div className="field">
        <label>{t("Tandem düşürme")} <span className="unit">{t("(% tablo kapasitesi — tipik 75–80)")}</span></label>
        <input
          type="number" min={1} max={100} step={1} value={tdm.derate_pct}
          onChange={(e) => set({ derate_pct: Math.min(100, Math.max(1, num(e.target.value, tdm.derate_pct))) })}
        />
      </div>

      {result ? (
        <>
          <CraneBlock title={t("Vinç 1 (ana)")} r={result.crane1} />
          <CraneBlock title={t("Vinç 2")} r={result.crane2} />
          <div className="kv"><span className="k">{t("Kancalar arası mesafe")}</span><span className="v">{fmt(u.len(result.hook_distance_m))} <small>{u.lenU}</small></span></div>
          <div className="disclaimer" style={{ marginTop: 6 }}>{result.summary}</div>
        </>
      ) : (
        <div className="disclaimer">{t("Tandem sonucu henüz hesaplanmadı.")}</div>
      )}

      <div className="disclaimer">
        {t("Tandem kaldırma özel planlama gerektirir; senkron hareket, eğik çekme ve dinamik etkiler bu hesapta yok. Kanca aralığının yükün kaldırma noktalarıyla uyumu kullanıcı sorumluluğundadır.")}
      </div>
    </div>
  );
}

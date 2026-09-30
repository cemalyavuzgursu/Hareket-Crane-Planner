import type { CraneModel, LiftConfig } from "../engine/types";
import { getJibCapacityCurve } from "../engine/capacity";
import type { UIState } from "./state";
import { useI18n, type TFn } from "./i18n";
import { useUnits, type Units } from "./units";
import UnitInput from "./UnitInput";

interface Props {
  cranes: CraneModel[];
  crane: CraneModel;
  state: UIState;
  set: (patch: Partial<UIState>) => void;
}

/**
 * Bazı vinç verilerinde aynı görünen bom uzunluğu için 0.01 ötelenmiş ikinci
 * bir anahtar bulunur (ör. 29.4 / 29.41) — bunlar üreticinin FARKLI yük
 * tablosuna sahip iki ayrı bom varyantıdır (veri modelinde anahtar aynı
 * kalmalı, yalnızca kullanıcıya gösterilen etiket ayrıştırılır).
 */
function boomLabel(b: number, allBooms: number[], u: Units, t: TFn): string {
  // Metrik: "29.4 m"; imperial: "96.5 ft" (değer SI kalır, yalnızca etiket).
  const show = (m: number) => (u.imperial ? `${u.len(m).toFixed(1)} ft` : `${m} m`);
  const rounded = Math.round(b * 10) / 10;
  const group = allBooms
    .filter((x) => Math.abs(Math.round(x * 10) / 10 - rounded) < 1e-9)
    .sort((a, c) => a - c);
  if (group.length <= 1) return show(b);
  const idx = group.findIndex((x) => Math.abs(x - b) < 1e-9);
  return `${show(rounded)} (${t("varyant {n}", { n: idx + 1 })})`;
}

export default function ConfigSidebar({ cranes, crane, state, set }: Props) {
  const { t } = useI18n();
  const u = useUnits();
  const jibMeta = crane.jib_configs;
  const activeJib = jibMeta?.configs.find((c) => c.key === state.lift_config);
  const inJib = !!activeJib;

  // Seçili jib eğrisinin radüs aralığı (yoksa null).
  const jibRange = (
    cfg: LiftConfig,
    jl: number,
    bl: number,
    off: number,
  ): [number, number] | null => {
    try {
      const curve = getJibCapacityCurve(crane, cfg, jl, bl, off);
      const rs = curve.map((p) => p[0]);
      return [Math.min(...rs), Math.max(...rs)];
    } catch {
      return null;
    }
  };
  // Radüsü seçili jib eğrisinin aralığına sıkıştır (geçersiz radüs → tablo hatası önlenir).
  const clampRadius = (cfg: LiftConfig, jl: number, bl: number, off: number, r: number) => {
    const range = jibRange(cfg, jl, bl, off);
    if (!range) return r;
    return Math.min(range[1], Math.max(range[0], r));
  };

  // Kaldırma konfigürasyonu değişimi — bağımlı alanları tutarlı kur.
  const changeConfig = (key: LiftConfig) => {
    if (key === "T" || !jibMeta) {
      set({ lift_config: "T" });
      return;
    }
    const meta = jibMeta.configs.find((c) => c.key === key);
    if (!meta) return;
    const boom = meta.boom_lengths.includes(state.boom_length)
      ? state.boom_length
      : meta.boom_lengths[meta.boom_lengths.length - 1];
    const jl = meta.jib_lengths[0];
    const off = meta.offsets[0];
    set({
      lift_config: key,
      counterweight: jibMeta.counterweight_required,
      boom_length: boom,
      jib_length: jl,
      jib_offset: off,
      radius: clampRadius(key, jl, boom, off, state.radius),
    });
  };

  // Bom uzunluğu seçenekleri — jib modunda jib'e özgü bomlar.
  const boomOptions = activeJib ? activeJib.boom_lengths : crane.boom_lengths;

  return (
    <div className="cfg-fields">
      <div className="field">
        <label>{t("Vinç Modeli")}</label>
        <select
          value={state.craneModel}
          onChange={(e) => set({ craneModel: e.target.value })}
        >
          {cranes.map((c) => (
            <option key={c.model} value={c.model}>
              {c.model}
            </option>
          ))}
        </select>
      </div>

      {jibMeta && (
        <div className="field">
          <label>{t("Kaldırma Konfigürasyonu")}</label>
          <select
            value={state.lift_config}
            onChange={(e) => changeConfig(e.target.value as LiftConfig)}
          >
            <option value="T">{t("Ana Bom (T) — jibsiz")}</option>
            {jibMeta.configs.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {activeJib?.desc && (
            <div className="disclaimer" style={{ marginTop: 4 }}>{activeJib.desc}</div>
          )}
        </div>
      )}

      <div className="field">
        <label>{t("Denge Ağırlığı (Counterweight)")}</label>
        {inJib ? (
          <div className="toggle-group">
            <div className="toggle active">{u.imperial ? u.fmtMass(jibMeta!.counterweight_required) : `${jibMeta!.counterweight_required}t`} ({t("jib gereği")})</div>
          </div>
        ) : (
          <div className="toggle-group">
            {crane.counterweight_options.map((cw) => (
              <div
                key={cw}
                className={`toggle ${state.counterweight === cw ? "active" : ""}`}
                onClick={() => set({ counterweight: cw })}
              >
                {u.imperial ? u.fmtMass(cw) : `${cw}t`}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>{t("Bom Uzunluğu")} ({u.lenU})</label>
        <select
          value={state.boom_length}
          onChange={(e) => {
            const b = parseFloat(e.target.value);
            set(
              activeJib
                ? {
                    boom_length: b,
                    radius: clampRadius(state.lift_config, state.jib_length, b, state.jib_offset, state.radius),
                  }
                : { boom_length: b },
            );
          }}
        >
          {boomOptions.map((b) => (
            <option key={b} value={b}>
              {boomLabel(b, boomOptions, u, t)}
            </option>
          ))}
        </select>
      </div>

      {activeJib && (
        <>
          <div className="field">
            <label>{t("Jib Uzunluğu")} ({u.lenU})</label>
            <select
              value={state.jib_length}
              onChange={(e) => {
                const j = parseFloat(e.target.value);
                set({
                  jib_length: j,
                  radius: clampRadius(state.lift_config, j, state.boom_length, state.jib_offset, state.radius),
                });
              }}
            >
              {activeJib.jib_lengths.map((j) => (
                <option key={j} value={j}>
                  {u.imperial ? `${u.len(j).toFixed(1)} ft` : `${j} m`}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>{t("Jib Ofset Açısı")} (°)</label>
            <div className="toggle-group">
              {activeJib.offsets.map((o) => (
                <div
                  key={o}
                  className={`toggle ${state.jib_offset === o ? "active" : ""}`}
                  onClick={() =>
                    set({
                      jib_offset: o,
                      radius: clampRadius(state.lift_config, state.jib_length, state.boom_length, o, state.radius),
                    })
                  }
                >
                  {o}°
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t("Çalışma Yarıçapı (Radius)")} ({u.lenU})</label>
            <UnitInput
              kind="len"
              value={state.radius}
              step={0.5}
              onChange={(v) => set({ radius: v || 0 })}
            />
            {(() => {
              const rng = jibRange(state.lift_config, state.jib_length, state.boom_length, state.jib_offset);
              return rng ? (
                <div className="disclaimer" style={{ marginTop: 4 }}>
                  {t("Geçerli radüs aralığı")}: {u.imperial ? `${u.len(rng[0]).toFixed(1)}–${u.len(rng[1]).toFixed(1)} ft` : `${rng[0]}–${rng[1]} m`}
                </div>
              ) : null;
            })()}
          </div>
        </>
      )}

      <div className="field">
        <label>{t("Ayak Açıklığı (Outrigger)")}</label>
        <select
          value={state.outrigger_config}
          onChange={(e) => set({ outrigger_config: e.target.value })}
        >
          {crane.outrigger_configs.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      {!inJib && (
        <div className="field">
          <label>
            {t("Kapasite Modu")} {(crane.capacity_pct_options ?? [75, 85]).length === 1 ? "" : "(%)"}
          </label>
          <div className="toggle-group">
            {(crane.capacity_pct_options ?? [75, 85]).map((p) => (
              <div
                key={p}
                className={`toggle ${state.capacity_pct === p ? "active" : ""}`}
                onClick={() => set({ capacity_pct: p })}
              >
                {p === 100 ? t("360° Tam Tablo") : `%${p}`}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>{t("Dönme Açısı (°) — 0 = arka")}</label>
        <input
          type="number"
          value={state.slew_angle}
          min={0}
          max={360}
          onChange={(e) => set({ slew_angle: parseFloat(e.target.value) || 0 })}
        />
      </div>

      <div className="field">
        <label>{t("Vinç Yönü (°) — şasi arkasının sahadaki açısı")}</label>
        <input
          type="number"
          value={state.crane_heading ?? 0}
          min={-360}
          max={360}
          step={5}
          onChange={(e) => set({ crane_heading: parseFloat(e.target.value) || 0 })}
        />
      </div>

      <div className="disclaimer">
        {t("Veri kaynağı")}: {crane.source ?? "—"}.<br />
        self_weight: {crane.self_weight == null ? t("tanımsız") + " t" : u.imperial ? u.fmtMass(crane.self_weight) : `${crane.self_weight} t`}
        {crane.datasheet_substitute ? ` (${t("datasheet ikamesi")})` : ""}
        {crane.geometry_source ? (
          <>
            <br />
            <span style={{ color: "var(--warn, #d97706)" }}>
              ⚠ {t("Klerens geometrisi")}: {crane.geometry_source}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

import { BEARING_PRESETS, riggingTotals, type UIState } from "./state";
import { useI18n } from "./i18n";
import { useUnits } from "./units";
import UnitInput, { unitLabel, type UnitKind } from "./UnitInput";

interface Props {
  state: UIState;
  set: (patch: Partial<UIState>) => void;
  /** Aparat listesi doluysa rigging ağırlığı listeden gelir (alan kilitlenir). */
  riggingFromItems?: boolean;
}

interface NumFieldProps {
  label: string;
  /** Birim türü — değer/onChange daima SI; kutuda görüntü birimi gösterilir. */
  kind: UnitKind;
  /** kind "none" iken gösterilecek birim etiketi. */
  unit?: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}

/**
 * Sağlam, birim duyarlı sayı girişi (UnitInput üzerine). Kullanıcı alanı
 * tamamen silebilir; state'e yalnızca geçerli sayı (SI) yazılır.
 */
function NumField({ label, kind, unit, value, step = 0.1, min, onChange }: NumFieldProps) {
  const u = useUnits();
  return (
    <div className="field">
      <label>
        {label} <span className="unit">({kind === "none" ? unit : unitLabel(u, kind)})</span>
      </label>
      <UnitInput kind={kind} value={value} step={step} min={min} onChange={onChange} />
    </div>
  );
}

export default function InputForm({ state, set, riggingFromItems = false }: Props) {
  const rig = riggingTotals(state.rigging_items);
  const { t } = useI18n();
  const u = useUnits();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
      <div className="card" style={{ margin: 0 }}>
        <h3>⚖ {t("Yük Bilgileri")}</h3>
        <NumField label={t("Yük Ağırlığı")} kind="mass" min={0} value={state.load_weight} onChange={(v) => set({ load_weight: v })} />
        <div className="grid2">
          <NumField label={t("Koça Ağırlığı")} kind="mass" min={0} value={state.hook_weight} onChange={(v) => set({ hook_weight: v })} />
          {riggingFromItems ? (
            <div className="field">
              <label>Rigging <span className="unit">({u.massU})</span></label>
              <input value={u.imperial ? u.fmtMassN(rig.weight) : rig.weight.toFixed(2)} disabled title={t("Kaldırma Aparatları listesinden")} />
            </div>
          ) : (
            <NumField label="Rigging" kind="mass" min={0} value={state.rigging_weight} onChange={(v) => set({ rigging_weight: v })} />
          )}
        </div>
        {riggingFromItems && (
          <div className="disclaimer" style={{ marginTop: 4 }}>
            ⛓ {t("Rigging ağırlığı ({w}) ve aparat yüksekliği ({h}) \"Kaldırma Aparatları\" listesinden alınıyor.", {
              w: u.imperial ? u.fmtMass(rig.weight) : `${rig.weight.toFixed(2)} t`,
              h: u.fmtLen(rig.height),
            })}
          </div>
        )}
        <div className="grid2">
          <NumField label={t("Yük Yüksekliği")} kind="len" min={0} value={state.load_height} onChange={(v) => set({ load_height: v })} />
          <NumField label={t("Yük Çapı")} kind="len" min={0} value={state.load_diameter} onChange={(v) => set({ load_diameter: v })} />
        </div>
        <div className="grid2">
          <NumField
            label={t("Rüzgâr Yüzeyi A (0 = yok)")}
            kind="area"
            min={0}
            step={1}
            value={state.load_wind_area_m2 ?? 0}
            onChange={(v) => set({ load_wind_area_m2: v > 0 ? v : undefined })}
          />
          <NumField
            label={t("Direnç Katsayısı cw")}
            kind="none"
            unit="—"
            min={0.1}
            step={0.1}
            value={state.load_drag_coefficient ?? 1.2}
            onChange={(v) => set({ load_drag_coefficient: v })}
          />
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <h3>📐 {t("Geometri & Engel")}</h3>
        <NumField label={t("Çalışma Yarıçapı (Radius)")} kind="len" min={0} value={state.radius} onChange={(v) => set({ radius: v })} />
        <div className="grid2">
          <NumField label={t("Engel Yüksekliği")} kind="len" min={0} value={state.obstacle_height} onChange={(v) => set({ obstacle_height: v })} />
          <NumField label={t("Engel Genişliği")} kind="len" min={0} value={state.obstacle_width} onChange={(v) => set({ obstacle_width: v })} />
        </div>
        <NumField label={t("Engel Yatay Uzaklığı (kanca → engel merkezi)")} kind="len" min={0} value={state.obstacle_distance} onChange={(v) => set({ obstacle_distance: v })} />
      </div>

      <div className="card" style={{ margin: 0 }}>
        <h3>🧱 {t("Zemin & Takoz")}</h3>
        <NumField
          label={t("Takoz Temas Alanı (Pad)")}
          kind="area"
          min={0.01}
          step={0.1}
          value={state.pad_area_m2}
          onChange={(v) => set({ pad_area_m2: v })}
        />
        <div className="field">
          <label>{t("Zemin Sınıfı (hızlı seçim)")}</label>
          <select
            value={
              BEARING_PRESETS.some((p) => p.value === state.allowable_bearing_t_m2)
                ? String(state.allowable_bearing_t_m2)
                : "custom"
            }
            onChange={(e) => {
              if (e.target.value === "custom") return;
              set({ allowable_bearing_t_m2: parseFloat(e.target.value) });
            }}
          >
            {BEARING_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {`${t(p.label.replace(/\s*\(.*\)\s*$/, ""))} (${u.fmtPressure(p.value, 0)})`}
              </option>
            ))}
            <option value="custom">{t("Özel (aşağıda gir)")}</option>
          </select>
        </div>
        <NumField
          label={t("İzin Verilen Zemin Taşıma Basıncı")}
          kind="pressure"
          min={0.1}
          step={1}
          value={state.allowable_bearing_t_m2}
          onChange={(v) => set({ allowable_bearing_t_m2: v })}
        />
      </div>
    </div>
  );
}

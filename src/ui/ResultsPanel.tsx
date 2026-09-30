import type { CraneModel } from "../engine/types";
import type { FullLiftResult } from "../engine/index";
import type { UIState } from "./state";
import { useI18n } from "./i18n";
import { useUnits } from "./units";

interface Props {
  result: FullLiftResult;
  state: UIState;
  crane: CraneModel;
  onPdf: () => void;
}

const CORNER_TR: Record<string, string> = {
  FL: "ÖN SOL",
  FR: "ÖN SAĞ",
  RL: "ARKA SOL",
  RR: "ARKA SAĞ",
};

function Ring({ pct, severity }: { pct: number; severity: "ok" | "warning" | "over" }) {
  const { t } = useI18n();
  const R = 70;
  const C = 2 * Math.PI * R;
  const frac = Number.isFinite(pct) ? Math.min(pct / 100, 1) : 1;
  const color =
    severity === "over" ? "var(--red)" : severity === "warning" ? "var(--accent)" : "var(--green)";
  const label = !Number.isFinite(pct)
    ? t("TABLO DIŞI")
    : severity === "over" ? t("KAPASİTE AŞIMI") : severity === "warning" ? t("DİKKAT ≥ %90") : t("UYGUN");
  return (
    <div className="ring-wrap">
      <div className="ring">
        <svg width="170" height="170" viewBox="0 0 170 170">
          <circle cx="85" cy="85" r={R} fill="none" stroke="#23262b" strokeWidth="12" />
          <circle
            cx="85"
            cy="85"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
          />
        </svg>
        <div className="center">
          <div className="pct" style={{ color }}>
            {Number.isFinite(pct) ? `${pct.toFixed(2)}%` : "—"}
          </div>
          <div className="lbl" style={{ color }}>
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

const SEV_LABEL: Record<string, string> = {
  ok: "Uygun",
  warning: "Uyarı",
  collision: "ÇARPIŞMA",
};

const SOURCE_TR: Record<string, string> = {
  boom: "Bom",
  load: "Yük",
  hook: "Kanca",
  rope: "Halat",
  jib: "Jib",
  tail: "Kuyruk Savrulması",
};

export default function ResultsPanel({ result, state, crane, onPdf }: Props) {
  const { capacity, clearance, outrigger, collision } = result;
  const { t } = useI18n();
  const u = useUnits();
  // Metrik çıktı birebir korunur; imperial'de lb/ft/psf/ft²/mph.
  const M = (v: number, d: number) => (u.imperial ? u.fmtMassN(v) : v.toFixed(d));
  const L = (v: number, d = 2) => u.fmtLenN(v, d);
  const A = (v: number, d: number) => (u.imperial ? u.area(v).toFixed(d) : v.toFixed(d));
  const P = (v: number) => (u.imperial ? Math.round(u.pressure(v)).toLocaleString("en-US") : v.toFixed(1));
  const W = (v: number) => u.wind(v).toFixed(1);

  const obsBad = !!clearance && clearance.clearance_to_obstacle < 0;
  const loadBad = !!clearance && clearance.clearance_to_load < 0;
  const anyClearanceBad = obsBad || loadBad;

  // İstenen dönme açısındaki köşe yükleri (mevcut yönelim). slew_angle 360°
  // dışına çıkabilir (ör. 370°) — per_angle taraması [0,360) aralığındadır,
  // bu yüzden karşılaştırmadan önce normalize edilir.
  const normalizedSlew = ((state.slew_angle % 360) + 360) % 360;
  const atCurrent =
    outrigger?.per_angle.reduce((best, a) =>
      Math.abs(a.slew_angle - normalizedSlew) < Math.abs(best.slew_angle - normalizedSlew) ? a : best,
    outrigger.per_angle[0]) ?? null;

  const bannerCls = capacity.severity === "over" ? "bad" : capacity.severity === "warning" ? "" : "ok";
  const bannerStyle =
    capacity.severity === "warning"
      ? { background: "rgba(255,186,32,.12)", border: "1px solid rgba(255,186,32,.45)", color: "#ffd479" }
      : undefined;
  const bannerText =
    capacity.severity === "over"
      ? "⛔ " + t("KALDIRMA İŞLEMİ ENGELLENDİ")
      : capacity.severity === "warning"
        ? "⚠ " + t("DİKKAT: kullanım ≥ %90 — kritik kaldırma")
        : "✓ " + t("Kaldırma sınırlar içinde");

  return (
    <div className="results-stack">
      <div className="card">
        <h3>{t("Kapasite Kullanımı")}</h3>
        <Ring pct={capacity.utilization_pct} severity={capacity.severity} />
        <div className={`banner ${bannerCls}`} style={bannerStyle}>
          {bannerText}
        </div>
        {capacity.out_of_range && (
          <div className="error-box" style={{ marginBottom: 10 }}>
            ⚠ {t("Yük tablosu dışında — bu konfigürasyonda kaldırma yapılamaz.")}
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 4 }}>{capacity.out_of_range}</div>
          </div>
        )}
        {result.clearance?.warning && (
          <div className="error-box" style={{ marginBottom: 10 }}>⚠ {result.clearance.warning}</div>
        )}
        <div className="kv">
          <span className="k">{t("Toplam Yük")}</span>
          <span className="v">{M(capacity.total_load, 2)} <small>{u.massU}</small></span>
        </div>
        <div className="kv">
          <span className="k">{t("İzin Verilen Kapasite")}</span>
          <span className="v">{M(capacity.rated_capacity, 2)} <small>{u.massU}</small></span>
        </div>
      </div>

      {(result.reeving || crane.max_wind_speed_ms !== undefined || !!crane.wind_note) && (
        <div className="card">
          <h3>{t("Halat Donanımı & Rüzgâr")}</h3>
          {result.reeving && (
            <>
              <div className="kv">
                <span className="k">{t("Halat Donanımı (Reeving)")}</span>
                <span className={`v ${result.reeving.feasible ? "" : "bad"}`}>
                  {result.reeving.required_parts} <small>{t("kollu")}</small>
                </span>
              </div>
              <div className="kv">
                <span className="k">{t("Tek Halat Çekişi")}</span>
                <span className="v">{M(result.reeving.single_line_pull_t, 1)} <small>{u.massU}</small></span>
              </div>
              {!result.reeving.feasible && (
                <div className="banner bad" style={{ marginTop: 8, marginBottom: 0 }}>
                  ⛔ {t("Gerekli donanım vinç makarasının fiziksel sınırını aşıyor — bu yük bu konfigürasyonla kaldırılamaz.")}
                </div>
              )}
            </>
          )}
          {crane.max_wind_speed_ms != null ? (
            <div className="disclaimer" style={{ marginTop: result.reeving ? 10 : 0 }}>
              💨 {t("Maks. çalışma rüzgârı")}: {u.imperial ? u.fmtWind(crane.max_wind_speed_ms) : `${crane.max_wind_speed_ms} m/s`}
              {crane.wind_note ? ` — ${crane.wind_note}` : ` (${t("EN13000 tablo varsayımı")})`}
            </div>
          ) : crane.wind_note ? (
            <div className="disclaimer" style={{ marginTop: result.reeving ? 10 : 0 }}>
              💨 {t("Rüzgâr limiti")}: {crane.wind_note}
            </div>
          ) : null}
          {result.wind && (
            <>
              <div className="kv" style={{ marginTop: 10 }}>
                <span className="k">{t("Yük rüzgâr yüzeyi A·cw")}</span>
                <span className="v">{A(result.wind.wind_area_m2, 1)} <small>{u.areaU}</small></span>
              </div>
              <div className="kv">
                <span className="k">{t("Tablo varsayımı (1,2 m²/t)")}</span>
                <span className="v">{A(result.wind.reference_area_m2, 1)} <small>{u.areaU}</small></span>
              </div>
              <div className="kv">
                <span className="k">{t("Bu yük için izinli rüzgâr")}</span>
                <span className={`v ${result.wind.reduced ? "warn" : "ok"}`}>
                  {result.wind.allowed_wind_ms != null ? W(result.wind.allowed_wind_ms) : "—"} <small>{u.windU}</small>
                </span>
              </div>
              {result.wind.reduced && (
                <div className="disclaimer" style={{ color: "var(--warn, #d97706)" }}>
                  ⚠ {t("Yük yüzeyi tablo varsayımını aşıyor → izinli rüzgâr hızı düşer")}
                  (v = v<sub>tablo</sub>·√(1,2·m<sub>H</sub> / A·c<sub>w</sub>), EN 13000).
                  {result.wind.allowed_wind_ms == null ? " " + t("Vinç verisinde tablo rüzgârı yok — üreticiye danışın.") : ""}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {result.jib && (
        <div className="card">
          <h3>{t("Jib Konfigürasyonu")}</h3>
          <div className="kv">
            <span className="k">{t("Konfigürasyon")}</span>
            <span className="v">
              {result.lift_config === "TJ_TH" ? t("Bom + Jib") : t("Bom + Uzatma + Jib")}
            </span>
          </div>
          <div className="kv">
            <span className="k">{t("Jib Uzunluğu")}</span>
            <span className="v">{u.imperial ? L(result.jib.jib_length, 1) : result.jib.jib_length} <small>{u.lenU}</small></span>
          </div>
          <div className="kv">
            <span className="k">{t("Jib Ofset Açısı")}</span>
            <span className="v">{result.jib.jib_offset} <small>°</small></span>
          </div>
          {result.jib_clearance && (
            <>
              <div className="kv">
                <span className="k">{t("Yük ↔ bom/jib klerensi")}</span>
                <span className={`v ${result.jib_clearance.clearance_to_load < 0 ? "bad" : result.jib_clearance.clearance_to_load < 1 ? "warn" : "ok"}`}>
                  {L(result.jib_clearance.clearance_to_load)} <small>{u.lenU}</small>
                </span>
              </div>
              <div className="kv">
                <span className="k">{t("Engel ↔ bom/jib klerensi")}</span>
                <span className={`v ${(result.jib_clearance.clearance_to_obstacle ?? 1) < 0 ? "bad" : "ok"}`}>
                  {result.jib_clearance.clearance_to_obstacle == null ? "— (" + t("engel yok") + ")" : L(result.jib_clearance.clearance_to_obstacle)} <small>{result.jib_clearance.clearance_to_obstacle == null ? "" : u.lenU}</small>
                </span>
              </div>
              <div className="kv">
                <span className="k">{t("Maks. kanca yüksekliği")}</span>
                <span className="v">{L(result.jib_clearance.max_hook_height)} <small>{u.lenU}</small></span>
              </div>
            </>
          )}
          <div className="banner" style={{ background: "rgba(255,186,32,.12)", border: "1px solid rgba(255,186,32,.45)", color: "#ffd479", marginBottom: 0 }}>
            ⚠ {t("Jib modu: klerens ve çarpışma YAKLAŞIKTIR — broşürde jib mafsal geometrisi yok, jib bom ucundan ofset açısıyla uzanan düz çubuk kabul edilir. Kapasite ve ayak reaksiyonu tablodan birebirdir.")}
          </div>
        </div>
      )}

      {clearance && (<>
      <div className="card">
        <h3>{t("Bölgesel Mesafeler (Klerens)")}</h3>
        <div className="kv">
          <span className="k">{t("Boma Engel Klerensi")}</span>
          <span className={`v ${obsBad ? "bad" : "ok"}`}>{L(clearance.clearance_to_obstacle)} <small>{u.lenU}</small></span>
        </div>
        <div className="kv">
          <span className="k">{t("Boma Yük Klerensi")}</span>
          <span className={`v ${loadBad ? "bad" : clearance.clearance_to_load < 1 ? "warn" : "ok"}`}>
            {L(clearance.clearance_to_load)} <small>{u.lenU}</small>
          </span>
        </div>
        {anyClearanceBad && (
          <div className="banner bad" style={{ marginBottom: 0 }}>⚠ {t("Bom çarpma riski — klerens negatif")}</div>
        )}
      </div>

      <div className="card">
        <h3>{t("Çarpışma Kontrolü")}</h3>
        <div className={`banner ${collision.worst === "collision" ? "bad" : collision.worst === "warning" ? "" : "ok"}`}
             style={collision.worst === "warning" ? { background: "rgba(255,186,32,.12)", border: "1px solid rgba(255,186,32,.45)", color: "#ffd479" } : undefined}>
          {collision.worst === "collision"
            ? "⛔ " + t("ÇARPIŞMA TESPİT EDİLDİ")
            : collision.worst === "warning"
              ? "⚠ " + t("Güvenlik payı düşük")
              : "✓ " + t("Çarpışma yok")}
        </div>
        {collision.active.length === 0 ? (
          <div className="kv">
            <span className="k">{t("Tüm mesafeler güvenli")}</span>
            <span className="v ok">✓</span>
          </div>
        ) : (
          collision.active.map((c) => (
            <div className="kv" key={c.id}>
              <span className="k" style={{ fontSize: 12 }}>
                {SOURCE_TR[c.source] ? t(SOURCE_TR[c.source]) : c.source} → {c.target}
              </span>
              <span className={`v ${c.severity === "collision" ? "bad" : "warn"}`} style={{ fontSize: 13 }}>
                {L(c.clearance_m)}<small>{u.lenU}</small> · {t(SEV_LABEL[c.severity])}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>{t("Geometri Detayları")}</h3>
        <div className="kv">
          <span className="k">{t("Maks Koça Yüksekliği")}</span>
          <span className="v">{L(clearance.max_hook_height)} <small>{u.lenU}</small></span>
        </div>
        <div className="kv">
          <span className="k">{t("Maks Sapan Aralığı")}</span>
          <span className="v">{L(clearance.max_sling_spread)} <small>{u.lenU}</small></span>
        </div>
        <div className="kv">
          <span className="k">{t("Bom Açısı (γ)")}</span>
          <span className="v">{((clearance.gama * 180) / Math.PI).toFixed(1)} <small>°</small></span>
        </div>
      </div>
      </>)}

      <div className="card">
        <h3>{t("Ayak Reaksiyonu (Outrigger)")}</h3>
        {outrigger ? (
          <>
            <div className="kv">
              <span className="k">{t("Bileşke Düşey Kuvvet (V)")}</span>
              <span className="v">{M(outrigger.V, 1)} <small>{u.massU}</small></span>
            </div>
            <div className="kv">
              <span className="k">{t("En Kritik Köşe Yükü")}</span>
              <span className={`v ${outrigger.max_outrigger_force_exceeded ? "bad" : ""}`}>
                {M(outrigger.max_corner_load, 1)} <small>{u.massU}</small>
              </span>
            </div>
            <div className="kv">
              <span className="k">{t("Kritik Dönme Açısı")}</span>
              <span className="v">{outrigger.critical_angle.toFixed(0)} <small>°</small></span>
            </div>
            {outrigger.max_outrigger_force_exceeded && (
              <div className="banner bad" style={{ marginTop: 4, marginBottom: 8 }}>
                ⛔ {t("Üretici maks. ayak kuvveti ({f}) aşıldı!", { f: u.imperial && crane.max_outrigger_force_t != null ? u.fmtMass(crane.max_outrigger_force_t) : `${crane.max_outrigger_force_t} t` })}
              </div>
            )}
            {outrigger.ground_pressure != null && (
              <div className="kv">
                <span className="k">{t("Maks Zemin Basıncı")}</span>
                <span className={`v ${outrigger.bearing_ok === false ? "bad" : ""}`}>
                  {P(outrigger.ground_pressure)} <small>{u.pressureU}</small>
                </span>
              </div>
            )}
            {outrigger.bearing_ok != null && (
              <div className="kv">
                <span className="k">{t("Zemin Taşıma Kontrolü")}</span>
                <span className={`v ${outrigger.bearing_ok ? "ok" : "bad"}`}>
                  {outrigger.bearing_ok ? "✓ " + t("Geçer") : "⛔ " + t("Kalır")}
                </span>
              </div>
            )}
            {outrigger.required_pad_area_m2 != null && (
              <div className="kv">
                <span className="k">{t("Önerilen Min. Takoz Alanı")}</span>
                <span className={`v ${outrigger.bearing_ok === false ? "bad" : ""}`}>
                  {A(outrigger.required_pad_area_m2, 2)} <small>{u.areaU}</small>
                </span>
              </div>
            )}
            {(outrigger.tipping_risk || outrigger.has_uplift) && (
              <div className="banner bad" style={{ marginTop: 8, marginBottom: 0 }}>
                {outrigger.tipping_risk
                  ? "⛔ " + t("DEVRİLME RİSKİ — ağırlık merkezi destek alanı dışına çıkıyor")
                  : "⚠ " + t("AYAK KALKMASI riski — bazı açılarda bir ayak yüksüz kalıyor")}
              </div>
            )}
            {atCurrent && (
              <div className="kv">
                <span className="k">{t("Ağırlık Merkezi Kayması (CoG)")}</span>
                <span className="v">
                  {L(Math.hypot(atCurrent.cog_x, atCurrent.cog_y))} <small>{u.lenU}</small>
                </span>
              </div>
            )}
            {atCurrent && (
              <div style={{ marginTop: 10 }}>
                <div className="section-title" style={{ margin: "4px 0 6px" }}>
                  {t("Mevcut Yönelim ({a}°)", { a: state.slew_angle })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {atCurrent.corners.map((c) => (
                    <div key={c.label} className="kv" style={{ borderBottom: "none", padding: "2px 0" }}>
                      <span className="k" style={{ fontSize: 11 }}>{t(CORNER_TR[c.label])}</span>
                      <span className="v" style={{ fontSize: 13 }}>{M(c.load, 1)}<small>{u.massU}</small></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="error-box" style={{ marginBottom: 0 }}>
            {result.outrigger_error ?? t("Ayak reaksiyonu hesaplanamadı.")}
          </div>
        )}
      </div>

      <button className="btn primary" onClick={onPdf}>
        ⬇ {t("PDF Rapor Oluştur")}
      </button>

      <div className="disclaimer">
        ⚠ {t("Bu plan üreticinin gerçek load chart'ına dayanır ancak")} <b>{t("yetkili kaldırma mühendisi tarafından manuel olarak doğrulanmalıdır")}</b>. {t("Uygulama karar otoritesi değildir.")}
      </div>
    </div>
  );
}

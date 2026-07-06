import type { CraneModel } from "../engine/types";
import type { FullLiftResult } from "../engine/index";
import type { UIState } from "./state";

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
  const R = 70;
  const C = 2 * Math.PI * R;
  const frac = Math.min(pct / 100, 1);
  const color =
    severity === "over" ? "var(--red)" : severity === "warning" ? "var(--accent)" : "var(--green)";
  const label =
    severity === "over" ? "KAPASİTE AŞIMI" : severity === "warning" ? "DİKKAT ≥ %90" : "UYGUN";
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
            {pct.toFixed(2)}%
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
  tail: "Kuyruk Savrulması",
};

export default function ResultsPanel({ result, state, crane, onPdf }: Props) {
  const { capacity, clearance, outrigger, collision } = result;

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
      ? "⛔ KALDIRMA İŞLEMİ ENGELLENDİ"
      : capacity.severity === "warning"
        ? "⚠ DİKKAT: kullanım ≥ %90 — kritik kaldırma"
        : "✓ Kaldırma sınırlar içinde";

  return (
    <div className="results-stack">
      <div className="card">
        <h3>Kapasite Kullanımı</h3>
        <Ring pct={capacity.utilization_pct} severity={capacity.severity} />
        <div className={`banner ${bannerCls}`} style={bannerStyle}>
          {bannerText}
        </div>
        <div className="kv">
          <span className="k">Toplam Yük</span>
          <span className="v">{capacity.total_load.toFixed(2)} <small>t</small></span>
        </div>
        <div className="kv">
          <span className="k">İzin Verilen Kapasite</span>
          <span className="v">{capacity.rated_capacity.toFixed(2)} <small>t</small></span>
        </div>
      </div>

      {(result.reeving || crane.max_wind_speed_ms !== undefined || !!crane.wind_note) && (
        <div className="card">
          <h3>Halat Donanımı & Rüzgâr</h3>
          {result.reeving && (
            <>
              <div className="kv">
                <span className="k">Halat Donanımı (Reeving)</span>
                <span className={`v ${result.reeving.feasible ? "" : "bad"}`}>
                  {result.reeving.required_parts} <small>kollu</small>
                </span>
              </div>
              <div className="kv">
                <span className="k">Tek Halat Çekişi</span>
                <span className="v">{result.reeving.single_line_pull_t.toFixed(1)} <small>t</small></span>
              </div>
              {!result.reeving.feasible && (
                <div className="banner bad" style={{ marginTop: 8, marginBottom: 0 }}>
                  ⛔ Gerekli donanım vinç makarasının fiziksel sınırını aşıyor — bu yük bu
                  konfigürasyonla kaldırılamaz.
                </div>
              )}
            </>
          )}
          {crane.max_wind_speed_ms != null ? (
            <div className="disclaimer" style={{ marginTop: result.reeving ? 10 : 0 }}>
              💨 Maks. çalışma rüzgârı: {crane.max_wind_speed_ms} m/s
              {crane.wind_note ? ` — ${crane.wind_note}` : " (EN13000 tablo varsayımı)"}
            </div>
          ) : crane.wind_note ? (
            <div className="disclaimer" style={{ marginTop: result.reeving ? 10 : 0 }}>
              💨 Rüzgâr limiti: {crane.wind_note}
            </div>
          ) : null}
        </div>
      )}

      {result.jib && (
        <div className="card">
          <h3>Jib Konfigürasyonu</h3>
          <div className="kv">
            <span className="k">Konfigürasyon</span>
            <span className="v">
              {result.lift_config === "TJ_TH" ? "Bom + Jib" : "Bom + Uzatma + Jib"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Jib Uzunluğu</span>
            <span className="v">{result.jib.jib_length} <small>m</small></span>
          </div>
          <div className="kv">
            <span className="k">Jib Ofset Açısı</span>
            <span className="v">{result.jib.jib_offset} <small>°</small></span>
          </div>
          <div className="banner" style={{ background: "rgba(255,186,32,.12)", border: "1px solid rgba(255,186,32,.45)", color: "#ffd479", marginBottom: 0 }}>
            ⚠ Jib modu: klerens/çarpışma ve 2B/3B geometri hesaplanmaz (broşürde jib mafsal
            geometrisi yok). Kapasite ve ayak reaksiyonu geçerlidir.
          </div>
        </div>
      )}

      {clearance && (<>
      <div className="card">
        <h3>Bölgesel Mesafeler (Klerens)</h3>
        <div className="kv">
          <span className="k">Boma Engel Klerensi</span>
          <span className={`v ${obsBad ? "bad" : "ok"}`}>{clearance.clearance_to_obstacle.toFixed(2)} <small>m</small></span>
        </div>
        <div className="kv">
          <span className="k">Boma Yük Klerensi</span>
          <span className={`v ${loadBad ? "bad" : clearance.clearance_to_load < 1 ? "warn" : "ok"}`}>
            {clearance.clearance_to_load.toFixed(2)} <small>m</small>
          </span>
        </div>
        {anyClearanceBad && (
          <div className="banner bad" style={{ marginBottom: 0 }}>⚠ Bom çarpma riski — klerens negatif</div>
        )}
      </div>

      <div className="card">
        <h3>Çarpışma Kontrolü</h3>
        <div className={`banner ${collision.worst === "collision" ? "bad" : collision.worst === "warning" ? "" : "ok"}`}
             style={collision.worst === "warning" ? { background: "rgba(255,186,32,.12)", border: "1px solid rgba(255,186,32,.45)", color: "#ffd479" } : undefined}>
          {collision.worst === "collision"
            ? "⛔ ÇARPIŞMA TESPİT EDİLDİ"
            : collision.worst === "warning"
              ? "⚠ Güvenlik payı düşük"
              : "✓ Çarpışma yok"}
        </div>
        {collision.active.length === 0 ? (
          <div className="kv">
            <span className="k">Tüm mesafeler güvenli</span>
            <span className="v ok">✓</span>
          </div>
        ) : (
          collision.active.map((c) => (
            <div className="kv" key={c.id}>
              <span className="k" style={{ fontSize: 12 }}>
                {SOURCE_TR[c.source] ?? c.source} → {c.target}
              </span>
              <span className={`v ${c.severity === "collision" ? "bad" : "warn"}`} style={{ fontSize: 13 }}>
                {c.clearance_m.toFixed(2)}<small>m</small> · {SEV_LABEL[c.severity]}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h3>Geometri Detayları</h3>
        <div className="kv">
          <span className="k">Maks Koça Yüksekliği</span>
          <span className="v">{clearance.max_hook_height.toFixed(2)} <small>m</small></span>
        </div>
        <div className="kv">
          <span className="k">Maks Sapan Aralığı</span>
          <span className="v">{clearance.max_sling_spread.toFixed(2)} <small>m</small></span>
        </div>
        <div className="kv">
          <span className="k">Bom Açısı (γ)</span>
          <span className="v">{((clearance.gama * 180) / Math.PI).toFixed(1)} <small>°</small></span>
        </div>
      </div>
      </>)}

      <div className="card">
        <h3>Ayak Reaksiyonu (Outrigger)</h3>
        {outrigger ? (
          <>
            <div className="kv">
              <span className="k">Bileşke Düşey Kuvvet (V)</span>
              <span className="v">{outrigger.V.toFixed(1)} <small>t</small></span>
            </div>
            <div className="kv">
              <span className="k">En Kritik Köşe Yükü</span>
              <span className={`v ${outrigger.max_outrigger_force_exceeded ? "bad" : ""}`}>
                {outrigger.max_corner_load.toFixed(1)} <small>t</small>
              </span>
            </div>
            <div className="kv">
              <span className="k">Kritik Dönme Açısı</span>
              <span className="v">{outrigger.critical_angle.toFixed(0)} <small>°</small></span>
            </div>
            {outrigger.max_outrigger_force_exceeded && (
              <div className="banner bad" style={{ marginTop: 4, marginBottom: 8 }}>
                ⛔ Üretici maks. ayak kuvveti ({crane.max_outrigger_force_t} t) aşıldı!
              </div>
            )}
            {outrigger.ground_pressure != null && (
              <div className="kv">
                <span className="k">Maks Zemin Basıncı</span>
                <span className={`v ${outrigger.bearing_ok === false ? "bad" : ""}`}>
                  {outrigger.ground_pressure.toFixed(1)} <small>t/m²</small>
                </span>
              </div>
            )}
            {outrigger.bearing_ok != null && (
              <div className="kv">
                <span className="k">Zemin Taşıma Kontrolü</span>
                <span className={`v ${outrigger.bearing_ok ? "ok" : "bad"}`}>
                  {outrigger.bearing_ok ? "✓ Geçer" : "⛔ Kalır"}
                </span>
              </div>
            )}
            {outrigger.required_pad_area_m2 != null && (
              <div className="kv">
                <span className="k">Önerilen Min. Takoz Alanı</span>
                <span className={`v ${outrigger.bearing_ok === false ? "bad" : ""}`}>
                  {outrigger.required_pad_area_m2.toFixed(2)} <small>m²</small>
                </span>
              </div>
            )}
            {(outrigger.tipping_risk || outrigger.has_uplift) && (
              <div className="banner bad" style={{ marginTop: 8, marginBottom: 0 }}>
                {outrigger.tipping_risk
                  ? "⛔ DEVRİLME RİSKİ — ağırlık merkezi destek alanı dışına çıkıyor"
                  : "⚠ AYAK KALKMASI riski — bazı açılarda bir ayak yüksüz kalıyor"}
              </div>
            )}
            {atCurrent && (
              <div className="kv">
                <span className="k">Ağırlık Merkezi Kayması (CoG)</span>
                <span className="v">
                  {Math.hypot(atCurrent.cog_x, atCurrent.cog_y).toFixed(2)} <small>m</small>
                </span>
              </div>
            )}
            {atCurrent && (
              <div style={{ marginTop: 10 }}>
                <div className="section-title" style={{ margin: "4px 0 6px" }}>
                  Mevcut Yönelim ({state.slew_angle}°)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {atCurrent.corners.map((c) => (
                    <div key={c.label} className="kv" style={{ borderBottom: "none", padding: "2px 0" }}>
                      <span className="k" style={{ fontSize: 11 }}>{CORNER_TR[c.label]}</span>
                      <span className="v" style={{ fontSize: 13 }}>{c.load.toFixed(1)}<small>t</small></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="error-box" style={{ marginBottom: 0 }}>
            {result.outrigger_error ?? "Ayak reaksiyonu hesaplanamadı."}
          </div>
        )}
      </div>

      <button className="btn primary" onClick={onPdf}>
        ⬇ PDF Rapor Oluştur
      </button>

      <div className="disclaimer">
        ⚠ Bu plan üreticinin gerçek load chart'ına dayanır ancak <b>yetkili kaldırma mühendisi
        tarafından manuel olarak doğrulanmalıdır</b>. Uygulama karar otoritesi değildir.
      </div>
    </div>
  );
}

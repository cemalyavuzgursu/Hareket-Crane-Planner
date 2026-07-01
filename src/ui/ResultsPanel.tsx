import type { FullLiftResult } from "../engine/index";
import type { UIState } from "./state";

interface Props {
  result: FullLiftResult;
  state: UIState;
  onPdf: () => void;
}

const CORNER_TR: Record<string, string> = {
  FL: "ÖN SOL",
  FR: "ÖN SAĞ",
  RL: "ARKA SOL",
  RR: "ARKA SAĞ",
};

function Ring({ pct, over }: { pct: number; over: boolean }) {
  const R = 70;
  const C = 2 * Math.PI * R;
  const frac = Math.min(pct / 100, 1);
  const color = over ? "var(--red)" : pct > 90 ? "var(--accent)" : "var(--green)";
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
            {over ? "KAPASİTE AŞIMI" : "UYGUN"}
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

export default function ResultsPanel({ result, state, onPdf }: Props) {
  const { capacity, clearance, outrigger, collision } = result;
  const over = capacity.status === "KAPASİTE AŞIMI";

  const obsBad = !!clearance && clearance.clearance_to_obstacle < 0;
  const loadBad = !!clearance && clearance.clearance_to_load < 0;
  const anyClearanceBad = obsBad || loadBad;

  // İstenen dönme açısındaki köşe yükleri (mevcut yönelim)
  const atCurrent =
    outrigger?.per_angle.reduce((best, a) =>
      Math.abs(a.slew_angle - state.slew_angle) < Math.abs(best.slew_angle - state.slew_angle) ? a : best,
    outrigger.per_angle[0]) ?? null;

  return (
    <div className="results-stack">
      <div className="card">
        <h3>Kapasite Kullanımı</h3>
        <Ring pct={capacity.utilization_pct} over={over} />
        <div className={`banner ${over ? "bad" : "ok"}`}>
          {over ? "⛔ KALDIRMA İŞLEMİ ENGELLENDİ" : "✓ Kaldırma sınırlar içinde"}
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
                {c.source} → {c.target}
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
              <span className="v warn">
                {outrigger.max_corner_load.toFixed(1)} <small>t</small>
              </span>
            </div>
            <div className="kv">
              <span className="k">Kritik Dönme Açısı</span>
              <span className="v">{outrigger.critical_angle.toFixed(0)} <small>°</small></span>
            </div>
            {outrigger.ground_pressure != null && (
              <div className="kv">
                <span className="k">Maks Zemin Basıncı</span>
                <span className="v warn">{outrigger.ground_pressure.toFixed(1)} <small>t/m²</small></span>
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

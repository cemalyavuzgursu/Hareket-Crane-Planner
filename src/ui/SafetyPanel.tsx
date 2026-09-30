import { useMemo, useState, type ReactNode } from "react";
import type { CraneModel } from "../engine/types";
import type { FullLiftResult } from "../engine/index";
import type { UIState } from "./state";
import { slingLegForces } from "../engine/slings";
import { hookBlocksFor, maxPartsFor, selectHookBlock } from "../engine/hookBlocks";
import { matSizing, slopeCheck, undergroundProximity, type GroundLevel } from "../engine/ground";
import { fetchWind, windAtHeight, type WindData } from "./weather";
import { useI18n } from "./i18n";
import { useUnits } from "./units";
import UnitInput, { type UnitKind } from "./UnitInput";

export interface SafetyPanelProps {
  state: UIState;
  crane: CraneModel;
  result: FullLiftResult | null;
  /** Ayak takozu merkezleri (saha çerçevesi). */
  padSitePositions: Array<{ x: number; z: number }>;
  /** Saha konumu (saha planından). Yoksa canlı rüzgâr alınamaz. */
  siteLatLon: { lat: number; lon: number } | null;
  set: (patch: Partial<UIState>) => void;
}

const fmtDec = (n: number | null | undefined, d: number, comma: boolean) =>
  n == null || !Number.isFinite(n) ? "—" : comma ? n.toFixed(d).replace(".", ",") : n.toFixed(d);

const lvlClass = (l: GroundLevel | "collision") => (l === "ok" ? "ok" : l === "warn" ? "warn" : "bad");

/** Birime duyarlı sayı girişi (değer SI; kind="none" ise birimsiz). */
function Num({
  label,
  unit,
  kind = "none",
  value,
  onChange,
  step = 0.1,
  min,
}: {
  label: string;
  unit: string;
  kind?: UnitKind;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <div className="field">
      <label>
        {label} <span className="unit">({unit})</span>
      </label>
      <UnitInput kind={kind} value={value} step={step} min={min} onChange={onChange} />
    </div>
  );
}

function Kv({ k, v, cls }: { k: string; v: ReactNode; cls?: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v ${cls ?? ""}`}>{v}</span>
    </div>
  );
}

export default function SafetyPanel({ state, crane, result, padSitePositions, siteLatLon, set }: SafetyPanelProps) {
  const { t, lang } = useI18n();
  const u = useUnits();
  const comma = lang === "tr";
  const f = (n: number | null | undefined, d = 1) => fmtDec(n, d, comma);
  /** Ağırlık (t → görüntü birimi, imperial'de lb tam sayı). */
  const fm = (n: number | null | undefined, d = 1) => (n == null ? "—" : f(u.mass(n), u.imperial ? 0 : d));
  const fl = (n: number | null | undefined, d = 1) => (n == null ? "—" : f(u.len(n), d));
  const fw = (n: number | null | undefined, d = 1) => (n == null ? "—" : f(u.wind(n), d));
  // ─── (a) Kanca bloğu ───
  const blocks = useMemo(() => hookBlocksFor(crane.model), [crane.model]);
  const selBlock = blocks.find((b) => b.id === state.hook_block_id) ?? null;
  const pull = crane.single_line_pull_t;
  const hoistLoad = state.load_weight + state.rigging_weight + state.hook_weight;
  const reqParts = pull && pull > 0 ? Math.ceil(hoistLoad / pull) : null;
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);

  const suggest = () => {
    // Blok ağırlığı toplam yüke eklenir → seçilen bloğun kendi ağırlığıyla tekrar kontrol.
    const base = state.load_weight + state.rigging_weight;
    let sel = selectHookBlock(crane.model, base, pull);
    for (let i = 0; i < 4 && sel.block; i++) {
      const again = selectHookBlock(crane.model, base + sel.block.weight_t, pull);
      if (again.block?.id === sel.block.id) break;
      sel = again;
    }
    if (sel.block) {
      const withBlock = selectHookBlock(crane.model, base + sel.block.weight_t, pull);
      set({ hook_block_id: sel.block.id, hook_weight: sel.block.weight_t });
      setSuggestMsg(withBlock.reason);
    } else {
      setSuggestMsg(sel.reason);
    }
  };

  // ─── (b) Sapan / CoG kaçıklığı ───
  const cog = state.load_cog_offset ?? { x: 0, z: 0 };
  const slingItem = (state.rigging_items ?? []).find((r) => r.kind === "sling2" || r.kind === "sling4");
  const legs: 2 | 4 = slingItem ? (slingItem.kind === "sling2" ? 2 : 4) : 4;
  const slingH = slingItem?.height_m ?? 3.0;
  const slingSpread = (slingItem?.length_m ?? 2.5) / 2;
  const sling = useMemo(
    () => slingLegForces(state.load_weight, legs, slingSpread, slingH, cog),
    [state.load_weight, legs, slingSpread, slingH, cog.x, cog.z], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ─── (c) Zemin ───
  const slope = slopeCheck(state.ground_slope_pct ?? 0);
  const [matT, setMatT] = useState(0);
  const mat = result?.outrigger
    ? matSizing(result.outrigger.max_corner_load, state.allowable_bearing_t_m2, state.pad_area_m2, matT > 0 ? matT : undefined)
    : null;
  const padSize = Math.sqrt(Math.max(0, state.pad_area_m2));
  const underground = useMemo(
    () => undergroundProximity(padSitePositions, state.objects, padSize),
    [padSitePositions, state.objects, padSize],
  );
  const ugIssues = underground.filter((h) => h.level !== "ok");
  const ugCount = state.objects.filter((o) => o.kind === "underground").length;

  // ─── (d) Canlı rüzgâr ───
  const [wind, setWind] = useState<WindData | null>(null);
  const [windErr, setWindErr] = useState<string | null>(null);
  const [windBusy, setWindBusy] = useState(false);
  const tipH = result?.jib_clearance?.max_hook_height ?? result?.clearance?.max_hook_height ?? null;
  const limit = result?.wind?.allowed_wind_ms ?? crane.max_wind_speed_ms ?? null;
  const toTip = (v: number) => (tipH != null ? windAtHeight(v, tipH) : v);
  const getWind = async () => {
    if (!siteLatLon) return;
    setWindBusy(true);
    setWindErr(null);
    try {
      setWind(await fetchWind(siteLatLon.lat, siteLatLon.lon));
    } catch (e) {
      setWindErr((e as Error).message ? t((e as Error).message) : t("Hava durumu alınamadı."));
    } finally {
      setWindBusy(false);
    }
  };
  const tipGust = wind ? toTip(Math.max(wind.gust_ms, wind.current_ms)) : null;
  const windOk = tipGust != null && limit != null ? tipGust <= limit : null;

  return (
    <div className="safety-panel" style={{ fontSize: 13 }}>
      {/* (a) Kanca bloğu */}
      <div className="section-title">{t("Kanca Bloğu")}</div>
      <div className="field">
        <label>{t("Blok")}</label>
        <select
          value={selBlock?.id ?? ""}
          onChange={(e) => {
            const b = blocks.find((x) => x.id === e.target.value);
            if (b) set({ hook_block_id: b.id, hook_weight: b.weight_t });
            else set({ hook_block_id: undefined });
            setSuggestMsg(null);
          }}
        >
          <option value="">{t("Elle (kanca ağırlığı girdiden)")}</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} — {fm(b.weight_t, 2)} {u.massU}
            </option>
          ))}
        </select>
        {blocks.length === 0 && <div className="disclaimer" style={{ marginTop: 4 }}>{t("Bu vinç için kanca bloğu verisi yok.")}</div>}
      </div>
      {selBlock && (
        <>
          <Kv k={t("Blok kapasitesi")} v={<>{fm(selBlock.capacity_t, 1)} <small>{u.massU}</small></>} cls={selBlock.capacity_t >= hoistLoad ? "ok" : "bad"} />
          <Kv k={t("Maks. donanım")} v={maxPartsFor(selBlock)} />
          {reqParts != null && (
            <Kv k={t("Gerekli donanım")} v={reqParts} cls={reqParts <= maxPartsFor(selBlock) ? "ok" : "bad"} />
          )}
          <Kv k={t("Blok ağırlığı")} v={<>{fm(selBlock.weight_t, 2)} <small>{u.massU}</small></>} />
          <div className="disclaimer" style={{ marginTop: 4 }}>{t("Kaynak: {src}", { src: selBlock.source })}</div>
        </>
      )}
      {!selBlock && reqParts != null && <Kv k={t("Gerekli donanım")} v={reqParts} />}
      {blocks.length > 0 && (
        <button className="btn ghost" onClick={suggest}>
          {t("Uygun bloğu öner")}
        </button>
      )}
      {suggestMsg && <div className="disclaimer" style={{ marginTop: 6 }}>{suggestMsg}</div>}

      {/* (b) CoG kaçıklığı + sapan kolları */}
      <div className="section-title" style={{ marginTop: 16 }}>{t("Yük Ağırlık Merkezi Kaçıklığı")}</div>
      <div className="grid2">
        <Num label={t("x (bom yönü)")} unit={u.lenU} kind="len" value={cog.x} onChange={(v) => set({ load_cog_offset: { ...cog, x: v } })} />
        <Num label={t("z (yanal)")} unit={u.lenU} kind="len" value={cog.z} onChange={(v) => set({ load_cog_offset: { ...cog, z: v } })} />
      </div>
      <div className="disclaimer" style={{ marginTop: 0, marginBottom: 8 }}>
        {slingItem
          ? t("Sapan: {label} — {legs} kol, yükseklik {h} {lu}, açıklık {s} {lu}.", {
              label: slingItem.label, legs, h: fl(slingH, 2), s: fl(slingSpread * 2, 2), lu: u.lenU,
            })
          : t("Aparat listesinde sapan yok — varsayılan 4 kol, yükseklik {h} {lu}, açıklık {s} {lu}.", {
              h: fl(slingH, 1), s: fl(slingSpread * 2, 1), lu: u.lenU,
            })}
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", fontFamily: "var(--mono)" }}>
        <thead>
          <tr style={{ color: "var(--text-dim)" }}>
            <th style={{ textAlign: "left" }}>{t("Kol")}</th>
            <th style={{ textAlign: "right" }}>{t("Açı °")}</th>
            <th style={{ textAlign: "right" }}>{t("Düşey")} {u.massU}</th>
            <th style={{ textAlign: "right" }}>{t("Çekme")} {u.massU}</th>
          </tr>
        </thead>
        <tbody>
          {sling.conservative.legs.map((l) => (
            <tr key={l.index}>
              <td>{l.index + 1}</td>
              <td style={{ textAlign: "right" }} className={l.angle_deg > 60 ? "bad" : l.angle_deg > 45 ? "warn" : ""}>
                {f(l.angle_deg, 1)}
              </td>
              <td style={{ textAlign: "right" }}>{fm(l.vertical_t, 2)}</td>
              <td style={{ textAlign: "right" }}>{fm(l.tension_t, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Kv k={legs === 4 ? t("Maks. kol (2 köşegen kolu)") : t("Maks. kol kuvveti")} v={<>{fm(sling.max_tension_t, 2)} <small>{u.massU}</small></>} />
      {legs === 4 && (
        <Kv
          k={t("Rijit dağılım ({n} kol)", { n: sling.rigid.active_legs })}
          v={<>{fm(sling.rigid.max_tension_t, 2)} <small>{u.massU}</small></>}
        />
      )}
      {sling.warnings.map((w, i) => (
        <div key={i} className={`banner ${sling.angle_not_allowed || sling.cog_outside ? "bad" : ""}`} style={{ fontWeight: 600 }}>
          {w}
        </div>
      ))}

      {/* (c) Zemin */}
      <div className="section-title" style={{ marginTop: 16 }}>{t("Zemin")}</div>
      <Num label={t("Zemin eğimi")} unit="%" value={state.ground_slope_pct ?? 0} step={0.1} min={0} onChange={(v) => set({ ground_slope_pct: v })} />
      <div className={lvlClass(slope.level)} style={{ fontSize: 12, marginBottom: 8 }}>
        {slope.message}
      </div>
      {mat ? (
        <>
          <Kv k={t("Maks. ayak yükü")} v={<>{fm(mat.max_corner_t, 1)} <small>{u.massU}</small></>} />
          <Kv k={t("Gerekli alan")} v={<>{f(u.area(mat.required_area_m2), 2)} <small>{u.areaU}</small></>} />
          <Kv k={t("Önerilen plaka")} v={mat.pad_ok ? t("Gerekmez") : mat.mat?.label ?? t("Standart yok")} cls={lvlClass(mat.level)} />
          <Num label={t("Plaka kalınlığı (45° yayılma, 0 = rijit)")} unit={u.lenU} kind="len" value={matT} step={0.05} min={0} onChange={setMatT} />
          {mat.messages.map((m, i) => (
            <div key={i} className={i === 0 ? lvlClass(mat.level) : "disclaimer"} style={{ fontSize: 12, marginTop: i === 0 ? 0 : 4 }}>
              {m}
            </div>
          ))}
        </>
      ) : (
        <div className="disclaimer">{t("Plaka boyutlandırma için ayak reaksiyonu gerekli")}{result?.outrigger_error ? `: ${result.outrigger_error}` : "."}</div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>{t("Yer altı yapıları ({n})", { n: ugCount })}</div>
      {ugCount === 0 ? (
        <div className="disclaimer" style={{ marginTop: 4 }}>{t("Nesne kütüphanesinden yer altı yapısı ekleyerek takoz yakınlığı kontrol edilebilir.")}</div>
      ) : ugIssues.length === 0 ? (
        <div className="ok" style={{ fontSize: 12 }}>{t("Tüm takozlar yer altı yapılarından yeterince uzak.")}</div>
      ) : (
        ugIssues.map((h) => (
          <div key={`${h.object_id}-${h.pad_index}`} className={lvlClass(h.level)} style={{ fontSize: 12, marginTop: 4 }}>
            {h.message}
          </div>
        ))
      )}

      {/* (d) Canlı rüzgâr */}
      <div className="section-title" style={{ marginTop: 16 }}>{t("Canlı Rüzgâr")}</div>
      {!siteLatLon ? (
        <div className="disclaimer" style={{ marginTop: 0 }}>{t("Saha planında konum seçin.")}</div>
      ) : (
        <>
          <button className="btn ghost" onClick={getWind} disabled={windBusy}>
            {windBusy ? t("Alınıyor…") : t("Hava durumunu getir")}
          </button>
          {windErr && <div className="error-box" style={{ marginTop: 6 }}>{windErr}</div>}
          {wind && (
            <>
              <Kv k={t("Rüzgâr / hamle ({h})", { h: u.fmtLen(10, 0) })} v={<>{fw(wind.current_ms)} / {fw(wind.gust_ms)} <small>{u.windU}</small></>} />
              {tipH != null && (
                <Kv
                  k={t("Bom ucu (~{h} {lu})", { h: fl(tipH, 0), lu: u.lenU })}
                  v={<>{fw(toTip(wind.current_ms))} / {fw(toTip(wind.gust_ms))} <small>{u.windU}</small></>}
                />
              )}
              <Kv k={t("İzinli rüzgâr")} v={limit != null ? <>{fw(limit)} <small>{u.windU}</small></> : t("Veri yok")} />
              {windOk != null && (
                <div className={`banner ${windOk ? "ok" : "bad"}`}>
                  {windOk ? t("Rüzgâr limit içinde") : t("Rüzgâr limiti aşılıyor — kaldırma yapılmamalı")}
                </div>
              )}
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", fontFamily: "var(--mono)", marginTop: 6 }}>
                <thead>
                  <tr style={{ color: "var(--text-dim)" }}>
                    <th style={{ textAlign: "left" }}>{t("Saat")}</th>
                    <th style={{ textAlign: "right" }}>{t("Rüzgâr")}*</th>
                    <th style={{ textAlign: "right" }}>{t("Hamle")}*</th>
                  </tr>
                </thead>
                <tbody>
                  {wind.hourly.map((h) => {
                    const g = toTip(h.gust_ms);
                    const over = limit != null && g > limit;
                    return (
                      <tr key={h.time} className={over ? "bad" : ""} style={over ? { background: "rgba(255,90,77,.1)" } : undefined}>
                        <td>{h.time.slice(11, 16)}</td>
                        <td style={{ textAlign: "right" }}>{fw(toTip(h.wind_ms))}</td>
                        <td style={{ textAlign: "right" }}>{fw(g)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="disclaimer">
                * {tipH != null ? t("Bom ucu yüksekliğine") : t("10 m'de")} {u.windU}.{" "}
                {t("Yükseklik dönüşümü güç kanunu (üs 0,14) ile YAKLAŞIKTIR; EN 13000'e göre bom ucundaki 3 s hamle esas alınır — sahada anemometre ile doğrulayın.")}
              </div>
            </>
          )}
          <div className="disclaimer">{t("Konum Open-Meteo'ya gönderilir.")}</div>
        </>
      )}
    </div>
  );
}

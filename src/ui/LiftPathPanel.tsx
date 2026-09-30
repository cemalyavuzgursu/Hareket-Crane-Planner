// Kaldırma güzergâhı paneli: alma/bırakma noktaları, seyir yüksekliği,
// simülasyon özeti, durum çizelgesi (timeline) ve oynatma/scrub.

import { useEffect, useRef, useState } from "react";
import type { LiftPathState, SitePoint } from "./state";
import type { LiftPathResult, LiftPose, PoseStatus } from "../engine/liftPath";
import { useI18n } from "./i18n";
import { useUnits } from "./units";
import UnitInput from "./UnitInput";

interface Props {
  path: LiftPathState | undefined;
  craneX: number;
  craneZ: number;
  heading: number;
  /** Mevcut kanca saha konumu (h = yük alt yüksekliği). */
  currentHook: { x: number; z: number; h: number };
  result: LiftPathResult | null;
  onChange: (p: LiftPathState) => void;
  /** Önizleme pozu (null = önizlemeyi kapat, plana dön). */
  onPreviewPose: (pose: LiftPose | null) => void;
}

const PLAY_MS = 6000;

const STATUS_COLOR: Record<PoseStatus, string> = {
  ok: "var(--green)",
  warning: "var(--accent)",
  collision: "var(--red)",
  over: "#ff3d8a",
  unreachable: "#6b7280",
};

const STATUS_LABEL: Record<PoseStatus, string> = {
  ok: "Uygun",
  warning: "Uyarı",
  collision: "Çarpışma",
  over: "Kapasite aşımı",
  unreachable: "Erişilemez",
};

const PHASE_LABEL: Record<LiftPose["phase"], string> = {
  hoist: "Kaldırma",
  slew: "Dönme",
  lower: "İndirme",
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const u = useUnits();
  return (
    <div className="field" style={{ marginBottom: 6 }}>
      <label>
        {label} <span className="unit">({u.lenU})</span>
      </label>
      <UnitInput kind="len" step={0.1} value={Number.isFinite(value) ? value : 0} onChange={onChange} />
    </div>
  );
}

function PointEditor({
  title,
  p,
  onChange,
  onTakeHook,
}: {
  title: string;
  p: SitePoint;
  onChange: (p: SitePoint) => void;
  onTakeHook: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="section-title" style={{ margin: "4px 0 6px" }}>
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <NumField label="X" value={p.x} onChange={(x) => onChange({ ...p, x })} />
        <NumField label="Z" value={p.z} onChange={(z) => onChange({ ...p, z })} />
        <NumField label={t("Alt h")} value={p.h} onChange={(h) => onChange({ ...p, h })} />
      </div>
      <button
        className="btn ghost"
        style={{ padding: 6, fontSize: 12 }}
        onClick={onTakeHook}
        title={t("Yükün mevcut plan konumunu ve alt yüksekliğini al")}
      >
        {t("Mevcut kanca konumunu al")}
      </button>
    </div>
  );
}

export default function LiftPathPanel({
  path,
  craneX,
  craneZ,
  currentHook,
  result,
  onChange,
  onPreviewPose,
}: Props) {
  const { t, lang } = useI18n();
  const u = useUnits();
  const pct = (v: string) => (lang === "en" ? `${v}%` : `%${v}`);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const previewRef = useRef(onPreviewPose);
  previewRef.current = onPreviewPose;
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const checks = result?.poses ?? [];
  const hook: SitePoint = { x: r2(currentHook.x), z: r2(currentHook.z), h: r2(currentHook.h) };

  const cancelRaf = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  // Unmount: animasyonu durdur, önizlemeyi kapat.
  useEffect(
    () => () => {
      cancelRaf();
      previewRef.current(null);
    },
    [],
  );

  // Sonuç değişirse (poz sayısı) geçersiz indeksleri temizle.
  useEffect(() => {
    if (previewIdx != null && previewIdx >= checks.length) {
      cancelRaf();
      setPlaying(false);
      setPreviewIdx(null);
      previewRef.current(null);
    }
  }, [checks.length, previewIdx]);

  const idxAtT = (tt: number) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < checks.length; i++) {
      const d = Math.abs(checks[i].pose.t - tt);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };

  const showIdx = (i: number) => {
    const c = checks[i];
    if (!c) return;
    setPreviewIdx(i);
    previewRef.current(c.pose);
  };

  const stop = () => {
    cancelRaf();
    setPlaying(false);
    setPreviewIdx(null);
    previewRef.current(null);
  };

  const play = () => {
    if (!checks.length) return;
    cancelRaf();
    const startT = previewIdx != null && previewIdx < checks.length - 1 ? checks[previewIdx].pose.t : 0;
    const t0 = performance.now() - startT * PLAY_MS;
    setPlaying(true);
    const frame = (now: number) => {
      const tt = Math.min(1, (now - t0) / PLAY_MS);
      showIdx(idxAtT(tt));
      if (tt < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        setPlaying(false); // son pozda kalır; "Durdur" ile plana dönülür
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  };

  const scrubAt = (clientX: number) => {
    const el = barRef.current;
    if (!el || !checks.length) return;
    const rect = el.getBoundingClientRect();
    const tt = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
    cancelRaf();
    setPlaying(false);
    showIdx(idxAtT(tt));
  };

  if (!path) {
    const createDefault = () => {
      const dx = hook.x - craneX;
      const dz = hook.z - craneZ;
      const r = Math.hypot(dx, dz);
      // 90° döndürülmüş bırakma noktası (vinç merkezi etrafında).
      const place: SitePoint =
        r > 0.5
          ? { x: r2(craneX - dz), z: r2(craneZ + dx), h: hook.h }
          : { x: r2(craneX), z: r2(craneZ + 10), h: hook.h };
      onChange({ pick: { ...hook }, place, travel_height: r2(Math.max(hook.h, 0) + 5) });
    };
    return (
      <div>
        <div className="section-title">{t("Kaldırma güzergâhı")}</div>
        <button className="btn primary" onClick={createDefault}>
          {t("Güzergâh tanımla")}
        </button>
        <div className="disclaimer">
          {t("Alma ve bırakma noktası arasında kaldır → dön → indir hareketini simüle eder; her anda kapasite, çarpışma ve erişim kontrol edilir.")}
        </div>
      </div>
    );
  }

  const crit = result && result.critical_index >= 0 ? checks[result.critical_index] : null;
  const cur = previewIdx != null ? checks[previewIdx] : null;

  // Timeline segment genişlikleri: pozlar arası zaman aralığına orantılı.
  const weights = checks.map((c, i) => {
    const prev = i > 0 ? checks[i - 1].pose.t : c.pose.t;
    const next = i < checks.length - 1 ? checks[i + 1].pose.t : c.pose.t;
    return Math.max((next - prev) / 2, 0.002);
  });

  return (
    <div>
      <div className="section-title">{t("Kaldırma güzergâhı")}</div>

      <PointEditor
        title={t("Alma noktası")}
        p={path.pick}
        onChange={(pick) => onChange({ ...path, pick })}
        onTakeHook={() => onChange({ ...path, pick: { ...hook } })}
      />
      <PointEditor
        title={t("Bırakma noktası")}
        p={path.place}
        onChange={(place) => onChange({ ...path, place })}
        onTakeHook={() => onChange({ ...path, place: { ...hook } })}
      />
      <NumField
        label={t("Seyir yüksekliği (yük altı)")}
        value={path.travel_height}
        onChange={(travel_height) => onChange({ ...path, travel_height })}
      />

      {result && (
        <div style={{ marginTop: 8 }}>
          <div className="kv">
            <span className="k">{t("Durum")}</span>
            <span className="v" style={{ color: result.feasible ? "var(--green)" : "var(--red)" }}>
              {result.feasible ? `✓ ${t("Uygun")}` : `✗ ${t("Uygun değil")}`}
            </span>
          </div>
          <div className="kv">
            <span className="k">{t("Maks. kullanım")}</span>
            <span className="v">
              {result.max_utilization != null ? pct(result.max_utilization.toFixed(1)) : "—"}
            </span>
          </div>
          {crit && (
            <div className="kv">
              <span className="k">{t("Kritik an")}</span>
              <span className="v" style={{ color: STATUS_COLOR[crit.worst], fontSize: 13 }}>
                {pct((crit.pose.t * 100).toFixed(0))} · {t(STATUS_LABEL[crit.worst])}
              </span>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-dim)", margin: "6px 0 8px", lineHeight: 1.4 }}>
            {result.summary}
          </div>

          {/* Durum çizelgesi — tıkla/sürükle ile scrub */}
          <div
            ref={barRef}
            role="slider"
            aria-label={t("Güzergâh zaman çizelgesi")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={cur ? Math.round(cur.pose.t * 100) : 0}
            style={{
              position: "relative",
              display: "flex",
              height: 18,
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid var(--border)",
              cursor: "pointer",
              touchAction: "none",
              userSelect: "none",
            }}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              scrubAt(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) scrubAt(e.clientX);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
          >
            {checks.map((c, i) => (
              <div
                key={i}
                title={`${pct((c.pose.t * 100).toFixed(0))} ${t(PHASE_LABEL[c.pose.phase])} — ${t(STATUS_LABEL[c.worst])}`}
                style={{ flexGrow: weights[i], flexBasis: 0, background: STATUS_COLOR[c.worst] }}
              />
            ))}
            {cur && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `calc(${(cur.pose.t * 100).toFixed(2)}% - 1px)`,
                  width: 2,
                  background: "#fff",
                  boxShadow: "0 0 3px #000",
                  pointerEvents: "none",
                }}
              />
            )}
            {crit && (
              <div
                style={{
                  position: "absolute",
                  top: -1,
                  left: `calc(${(crit.pose.t * 100).toFixed(2)}% - 4px)`,
                  width: 0,
                  height: 0,
                  borderLeft: "4px solid transparent",
                  borderRight: "4px solid transparent",
                  borderTop: "6px solid #fff",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: "var(--text-faint)",
              marginTop: 2,
            }}
          >
            <span>{t("Alma")}</span>
            <span>{t("Bırakma")}</span>
          </div>

          {cur && (
            <div style={{ fontSize: 12, marginTop: 6, fontFamily: "var(--mono)", lineHeight: 1.5 }}>
              <div>
                {pct((cur.pose.t * 100).toFixed(0))} · {t(PHASE_LABEL[cur.pose.phase])} ·{" "}
                <span style={{ color: STATUS_COLOR[cur.worst] }}>{t(STATUS_LABEL[cur.worst])}</span>
              </div>
              <div>
                {t("dönme")} {cur.pose.slew.toFixed(0)}° · R {u.fmtLen(cur.pose.radius, 1)} · h{" "}
                {u.fmtLen(cur.pose.load_bottom_height, 1)}
              </div>
              <div>
                {t("kullanım")} {cur.utilization_pct != null ? pct(cur.utilization_pct.toFixed(0)) : "—"} · {t("klerens")}{" "}
                {cur.clearance_to_load != null ? u.fmtLen(cur.clearance_to_load, 2) : "—"}
              </div>
              {cur.message && (
                <div style={{ color: "var(--text-dim)", fontFamily: "inherit" }}>{cur.message}</div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            {playing ? (
              <button
                className="btn ghost"
                style={{ padding: 8, fontSize: 13 }}
                onClick={() => {
                  cancelRaf();
                  setPlaying(false);
                }}
              >
                ⏸ {t("Duraklat")}
              </button>
            ) : (
              <button
                className="btn primary"
                style={{ padding: 8, fontSize: 13 }}
                onClick={play}
                disabled={!checks.length}
              >
                ▶ {t("Oynat")}
              </button>
            )}
            <button
              className="btn ghost"
              style={{ padding: 8, fontSize: 13 }}
              onClick={stop}
              disabled={!playing && previewIdx == null}
            >
              ⏹ {t("Durdur")}
            </button>
          </div>
          <button
            className="btn ghost"
            style={{ padding: 8, fontSize: 13 }}
            disabled={!crit}
            onClick={() => {
              if (!result || result.critical_index < 0) return;
              cancelRaf();
              setPlaying(false);
              showIdx(result.critical_index);
            }}
          >
            {t("Kritik ana git")}
          </button>
        </div>
      )}

      <div className="disclaimer">
        {t("Model: alma noktasında düşey kaldırma → seyir yüksekliğinde dönme + radius değişimi → bırakma noktasında indirme. 2B ana engel güzergâhta uygulanmaz; engeller sahne nesneleriyle kontrol edilir. Yük salınımı ve rüzgâr dikkate alınmaz.")}
      </div>
    </div>
  );
}

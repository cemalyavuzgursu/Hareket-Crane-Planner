/**
 * MachinesDialog.tsx — "Makinelerim" modalı. Yerleşik vinçleri listeler,
 * kullanıcının kendi vinçlerini JSON'dan içe aktarmasına veya form + CSV yük
 * tablosundan oluşturmasına izin verir. Kalıcılık üst bileşendedir (onChange).
 */
import { useEffect, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import type { CraneModel, GeometryConstants } from "../engine/types";
import {
  GEOMETRY_KEYS,
  GEOMETRY_LABELS,
  buildCraneFromForm,
  craneTemplateJson,
  isBuiltInModel,
  validateCraneModel,
} from "../data/customCranes";
import { useI18n } from "./i18n";
import { useUnits } from "./units";

interface Props {
  builtIn: CraneModel[];
  custom: CraneModel[];
  onChange: (custom: CraneModel[]) => void; // persist + parent updates registry
  onClose: () => void;
}

/** LTM1160 değerleri — örnek olarak önceden doldurulur. */
const EXAMPLE_GEOMETRY: GeometryConstants = {
  cribbing_height: 0.3,
  machine_ground_height: 3.475,
  boom_offset: 3.33,
  sheave_diameter: 0.417,
  hook_height: 1.0,
  sheave_offset: 1.321,
  boom_thickness: 1.25,
};

const CSV_PLACEHOLDER = [
  "denge_t;kapasite_%;bom_m;radius_m;kapasite_t",
  "10;100;12;3;60",
  "10;100;12;5;42",
  "10;100;20;4;40",
].join("\n");

function download(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* indirme desteklenmiyor */
  }
}

function safeFileName(model: string): string {
  return (model.trim().replace(/[^\w\-.ğüşöçıİĞÜŞÖÇ]+/g, "_") || "vinc") + ".json";
}

function parseNum(s: string): number {
  const t = s.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}

const pillStyle = (bg: string, fg: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 7px",
  borderRadius: 999,
  background: bg,
  color: fg,
  border: `1px solid ${fg}55`,
  whiteSpace: "nowrap",
});

const sectionTitle: CSSProperties = { margin: "16px 0 8px", fontSize: 13, fontWeight: 700 };

export default function MachinesDialog({ builtIn, custom, onChange, onClose }: Props) {
  const { t } = useI18n();
  const u = useUnits();
  // Satır içi onay: aynı adlı özel vinç değiştirilecekse.
  const [pendingReplace, setPendingReplace] = useState<CraneModel | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Form
  const [model, setModel] = useState("");
  const [geo, setGeo] = useState<Record<keyof GeometryConstants, string>>(
    () =>
      Object.fromEntries(GEOMETRY_KEYS.map((k) => [k, String(EXAMPLE_GEOMETRY[k])])) as Record<
        keyof GeometryConstants,
        string
      >,
  );
  const [selfWeight, setSelfWeight] = useState("");
  const [outrigger, setOutrigger] = useState("9x7,8");
  const [pcts, setPcts] = useState("100");
  const [csv, setCsv] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Ekleme akışı: yerleşik çakışmayı reddet, özel çakışmada onay iste. */
  const tryAdd = (c: CraneModel, setErrors: (e: string[]) => void): boolean => {
    setMessage(null);
    if (isBuiltInModel(c.model, builtIn)) {
      setErrors([t("\"{m}\" adı yerleşik bir vinçle çakışıyor — farklı bir model adı verin.", { m: c.model })]);
      return false;
    }
    if (custom.some((x) => x.model === c.model)) {
      setPendingReplace(c);
      setErrors([]);
      return false;
    }
    onChange([...custom, c]);
    setErrors([]);
    setMessage(t("\"{m}\" Makinelerim'e eklendi.", { m: c.model }));
    return true;
  };

  const confirmReplace = () => {
    if (!pendingReplace) return;
    const c = pendingReplace;
    onChange(custom.map((x) => (x.model === c.model ? c : x)));
    setPendingReplace(null);
    setMessage(t("\"{m}\" güncellendi.", { m: c.model }));
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingReplace(null);
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setImportErrors([t("\"{f}\" geçerli bir JSON dosyası değil.", { f: file.name })]);
      return;
    }
    const v = validateCraneModel(data);
    if (!v.ok) {
      setImportErrors(v.errors);
      return;
    }
    tryAdd({ ...v.crane, model: v.crane.model.trim() }, setImportErrors);
  };

  const onCsvFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setCsv(await file.text());
    } catch {
      setFormErrors([t("\"{f}\" okunamadı.", { f: file.name })]);
    }
  };

  const onSubmitForm = () => {
    setPendingReplace(null);
    const errs: string[] = [];
    const g = {} as GeometryConstants;
    for (const k of GEOMETRY_KEYS) {
      const n = parseNum(geo[k]);
      if (!Number.isFinite(n)) errs.push(t("{l} sayısal olmalı.", { l: t(GEOMETRY_LABELS[k]) }));
      g[k] = n;
    }
    let sw: number | null = null;
    if (selfWeight.trim() !== "") {
      sw = parseNum(selfWeight);
      if (!Number.isFinite(sw)) errs.push(t("Öz ağırlık sayısal olmalı (veya boş bırakın)."));
    }
    const pctList = pcts
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(parseNum);
    if (pctList.length === 0 || pctList.some((p) => !Number.isFinite(p))) {
      errs.push(t("Kapasite modları virgülle ayrılmış sayılar olmalı (ör. 100 veya 75, 85)."));
    }
    if (errs.length > 0) {
      setFormErrors(errs);
      return;
    }
    const res = buildCraneFromForm({
      model,
      geometry_constants: g,
      self_weight: sw,
      outrigger_config: outrigger,
      csv,
      capacity_pct_options: pctList,
    });
    if (!res.ok) {
      setFormErrors(res.errors);
      return;
    }
    if (tryAdd(res.crane, setFormErrors)) {
      setModel("");
      setCsv("");
    }
  };

  const doDelete = (name: string) => {
    onChange(custom.filter((x) => x.model !== name));
    setPendingDelete(null);
    setMessage(t("\"{m}\" silindi.", { m: name }));
  };

  const summary = (c: CraneModel) =>
    `${t("{n} bom", { n: c.boom_lengths.length })} · ${t("{n} denge", { n: c.counterweight_options.length })} · %${(c.capacity_pct_options ?? [75, 85]).join("/%")}`;

  const errorBox = (errs: string[]) =>
    errs.length > 0 ? (
      <div className="error-box" style={{ maxHeight: 160, overflowY: "auto" }}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {errs.slice(0, 50).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
          {errs.length > 50 && <li>{t("… ve {n} hata daha", { n: errs.length - 50 })}</li>}
        </ul>
      </div>
    ) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card card" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>🏗️ {t("Makinelerim")}</h3>
          <button className="btn ghost" type="button" onClick={() => download("vinc-sablonu.json", craneTemplateJson())}>
            {t("Şablon indir")}
          </button>
        </div>

        <div className="banner bad" style={{ marginTop: 12 }}>
          ⚠ {t("Yük tablosu değerleri doğrudan güvenliği etkiler — üreticinin orijinal tablosundan girin ve iki kez kontrol edin.")}
        </div>

        {message && <div className="banner ok">{message}</div>}

        {pendingReplace && (
          <div className="banner bad" style={{ flexWrap: "wrap" }}>
            <span style={{ flex: 1 }}>
              {t("\"{m}\" adlı bir özel vinç zaten var. Değiştirilsin mi?", { m: pendingReplace.model })}
            </span>
            <button className="btn primary" type="button" onClick={confirmReplace}>
              {t("Evet, değiştir")}
            </button>
            <button className="btn ghost" type="button" onClick={() => setPendingReplace(null)}>
              {t("Vazgeç")}
            </button>
          </div>
        )}

        {/* a) Liste */}
        <div style={sectionTitle}>{t("Vinç listesi")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {builtIn.map((c) => (
            <div key={`b-${c.model}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{c.model}</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{summary(c)}</span>
              <span style={pillStyle("rgba(90,209,255,.1)", "#5ad1ff")}>{t("Yerleşik")}</span>
            </div>
          ))}
          {custom.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{t("Henüz özel vinç eklenmedi.")}</div>
          )}
          {custom.map((c) => (
            <div key={`c-${c.model}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{c.model}</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{summary(c)}</span>
              <span style={pillStyle("rgba(255,186,32,.1)", "#ffba20")}>{t("Özel")}</span>
              <button
                className="btn ghost"
                type="button"
                style={{ padding: "3px 8px", fontSize: 12 }}
                onClick={() => download(safeFileName(c.model), JSON.stringify(c, null, 2))}
              >
                {t("JSON indir")}
              </button>
              {pendingDelete === c.model ? (
                <>
                  <button
                    className="btn primary"
                    type="button"
                    style={{ padding: "3px 8px", fontSize: 12 }}
                    onClick={() => doDelete(c.model)}
                  >
                    {t("Silmeyi onayla")}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    style={{ padding: "3px 8px", fontSize: 12 }}
                    onClick={() => setPendingDelete(null)}
                  >
                    {t("Vazgeç")}
                  </button>
                </>
              ) : (
                <button
                  className="btn ghost"
                  type="button"
                  style={{ padding: "3px 8px", fontSize: 12 }}
                  onClick={() => setPendingDelete(c.model)}
                >
                  {t("Sil")}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* b) JSON içe aktar */}
        <div style={sectionTitle}>{t("JSON'dan içe aktar")}</div>
        <input type="file" accept=".json,application/json" onChange={onImportFile} />
        {errorBox(importErrors)}

        {/* c) CSV ile yeni vinç */}
        <div style={sectionTitle}>{t("Yeni vinç (CSV yük tablosu)")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>{t("Model adı")}</label>
            <input type="text" value={model} placeholder={t("ör. Tadano GR-1000")} onChange={(e) => setModel(e.target.value)} />
          </div>
          {GEOMETRY_KEYS.map((k) => (
            <div className="field" key={k}>
              <label>{t(GEOMETRY_LABELS[k])}</label>
              <input
                type="text"
                inputMode="decimal"
                value={geo[k]}
                onChange={(e) => setGeo((g) => ({ ...g, [k]: e.target.value }))}
              />
            </div>
          ))}
          <div className="field">
            <label>{t("Öz ağırlık (t)")}</label>
            <input
              type="text"
              inputMode="decimal"
              value={selfWeight}
              placeholder={t("bilinmiyorsa boş")}
              onChange={(e) => setSelfWeight(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t("Ayak açıklığı (Lx x Ly, m)")}</label>
            <input type="text" value={outrigger} placeholder="9x7,8" onChange={(e) => setOutrigger(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("Kapasite modları (%)")}</label>
            <input type="text" value={pcts} placeholder={t("100 veya 75, 85")} onChange={(e) => setPcts(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>
              {t("Yük tablosu CSV — satır: denge (t), kapasite %, bom (m), radius (m), kapasite (t). Ayraç \",\" veya \";\" (\";\" ile ondalık virgül kullanılabilir). Başlık satırı opsiyonel.")}
            </label>
            <textarea
              value={csv}
              rows={8}
              placeholder={CSV_PLACEHOLDER}
              style={{ fontFamily: "var(--mono)", fontSize: 12, width: "100%", resize: "vertical" }}
              onChange={(e) => setCsv(e.target.value)}
            />
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onCsvFile} style={{ marginTop: 6 }} />
          </div>
        </div>
        <div className="disclaimer" style={{ marginTop: 8 }}>
          {t("Geometri alanları örnek olarak LIEBHERR LTM 1160 değerleriyle doldurulmuştur — kendi vincinizin değerleriyle değiştirin.")}
          {u.imperial ? " " + t("Vinç verileri daima SI birimlerinde (m, t) girilir.") : ""}
        </div>
        {errorBox(formErrors)}
        <button className="btn primary" type="button" style={{ marginTop: 10, width: "100%" }} onClick={onSubmitForm}>
          {t("Doğrula ve Ekle")}
        </button>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} type="button">
            {t("Kapat")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hareket Crane Planner — saha mobil uygulaması.
// Basit, dokunmatik dostu: vinç seç → girdiler → 2D / ağırlık merkezi / çarpışma.
import React from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, StatusBar as RNStatusBar,
  Modal, Platform, ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native";

import { CRANES } from "./src/shared/cranes";
import { computeLiftFull, getJibCapacityCurve } from "./src/shared/engine";
import { cornerLoadsAtAngle, parseOutriggerConfig, type OutriggerResult } from "./src/shared/engine/outrigger";
import type { CapacityResult, ReevingResult } from "./src/shared/engine/capacity";
import type { CraneModel, LiftConfig } from "./src/shared/engine/types";

import { AppState, defaultState, reconcileForCrane } from "./src/state";
import { C, mono, severityColor } from "./src/theme";
import { Stepper, Segmented, Section } from "./src/components/Controls";
import SideView2D from "./src/components/SideView2D";
import GroundForceDiagram from "./src/components/GroundForceDiagram";
import { parseDesktopProject, importParsedProject, type ParsedDesktopProject } from "./src/projectImport";

/** Proje içe aktarma bildirimi (başlık altındaki kapatılabilir banner). */
type ImportNotice =
  | { kind: "ok"; projectName: string; warnings: string[] }
  | { kind: "error"; message: string };

/** Makul üst sınır — masaüstü proje dosyaları tipik olarak birkaç yüz KB'dir. */
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;

type Tab = "girdi" | "2d" | "cog" | "carpisma";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "girdi", label: "Girdiler", icon: "▤" },
  { key: "2d", label: "2D", icon: "◨" },
  { key: "cog", label: "Ağırlık M.", icon: "◎" },
  { key: "carpisma", label: "Çarpışma", icon: "⚠" },
];

export default function App() {
  const { width } = useWindowDimensions();
  const [state, setState] = React.useState<AppState>(() => defaultState(CRANES[0]));
  const [tab, setTab] = React.useState<Tab>("girdi");

  const crane: CraneModel = React.useMemo(
    () => CRANES.find((c) => c.model === state.craneModel) ?? CRANES[0],
    [state.craneModel],
  );

  const set = <K extends keyof AppState>(k: K, v: AppState[K]) =>
    setState((p) => ({ ...p, [k]: v }));

  const patch = (p: Partial<AppState>) => setState((prev) => ({ ...prev, ...p }));

  const selectCrane = (c: CraneModel) =>
    setState((p) => reconcileForCrane(p, c));

  const isJibMode = state.lift_config !== "T";

  // --- Masaüstü projesi açma ---
  const [notice, setNotice] = React.useState<ImportNotice | null>(null);
  const [pending, setPending] = React.useState<ParsedDesktopProject | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadFromProject = (project: ParsedDesktopProject, stepIndex: number | null) => {
    setPending(null);
    try {
      const r = importParsedProject(project, CRANES, stepIndex);
      setState(r.state);
      setNotice({ kind: "ok", projectName: r.projectName, warnings: r.warnings });
      setTab("girdi");
    } catch (e) {
      setNotice({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const openProject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Paylaşım uygulamaları (WhatsApp, e-posta, Drive) .json dosyasını farklı MIME ile
      // kaydedebilir → yalnız application/json'a kısıtlamak dosyayı gizleyebilir.
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/json", "text/plain", "application/octet-stream"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (asset.size != null && asset.size > MAX_PROJECT_BYTES) {
        setNotice({ kind: "error", message: "Dosya çok büyük — bir proje dosyası (.json) seçin." });
        return;
      }
      const text =
        Platform.OS === "web" && asset.file
          ? await asset.file.text()
          : await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = parseDesktopProject(text, asset.name);
      if (!parsed.ok) {
        setNotice({ kind: "error", message: parsed.error });
        return;
      }
      if (parsed.project.steps.length > 0) {
        setPending(parsed.project); // adım seçimi modalı
      } else {
        loadFromProject(parsed.project, null);
      }
    } catch (e) {
      setNotice({ kind: "error", message: "Dosya okunamadı: " + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  };

  // --- Hesap (hata olursa yakala) ---
  const calc = React.useMemo(() => {
    try {
      const result = computeLiftFull(crane, state, {
        outrigger_config: state.outrigger_config,
        slew_angle: state.slew_angle,
        // Mobil uygulama çevre nesnesi kütüphanesi taşımaz — bina/enerji hattı gibi
        // dış engeller yalnızca masaüstü uygulamada tanımlanıp kontrol edilir.
        objects: [],
        jib: isJibMode
          ? { config: state.lift_config, jib_length: state.jib_length, jib_offset: state.jib_offset }
          : undefined,
      });
      return { result, error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [crane, state]);

  const result = calc.result;
  const cap = result?.capacity;
  const pct = cap?.utilization_pct ?? NaN;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <View style={{ height: RNStatusBar.currentHeight ?? 0 }} />

      {/* Başlık + vinç seçimi */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.brand}>HAREKET</Text>
          <Text style={s.brandSub}>Crane Planner</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={openProject}
            disabled={busy}
            style={({ pressed }) => [s.openBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Masaüstü projesi aç"
          >
            {busy ? <ActivityIndicator size="small" color={C.accent} /> : <Text style={s.openBtnText}>📂 Proje Aç</Text>}
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {CRANES.map((c) => {
            const active = c.model === state.craneModel;
            return (
              <Pressable key={c.model} onPress={() => selectCrane(c)} style={[s.craneChip, active && s.craneChipActive]}>
                <Text style={[s.craneChipText, active && s.craneChipTextActive]}>{c.model}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {notice && <ImportBanner notice={notice} onClose={() => setNotice(null)} />}

      <StepPickerModal
        project={pending}
        onPick={(i) => pending && loadFromProject(pending, i)}
        onCancel={() => setPending(null)}
      />

      {/* Durum banner'ı */}
      <StatusBanner
        error={calc.error}
        pct={pct}
        cap={cap}
        worst={result?.collision.worst ?? "ok"}
        reeving={result?.reeving}
        crane={crane}
      />

      {/* Sekme içeriği */}
      <View style={{ flex: 1 }}>
        {tab === "girdi" && (
          <InputsTab crane={crane} state={state} set={set} patch={patch} />
        )}
        {tab === "2d" && (
          <ScrollView contentContainerStyle={s.pad}>
            {isJibMode && <JibScopeNotice />}
            {result?.clearance ? (
              <View style={s.card}>
                <SideView2D
                  g={crane.geometry_constants}
                  clearance={result.clearance}
                  boom_length={state.boom_length}
                  radius={state.radius}
                  load_height={state.load_height}
                  load_diameter={state.load_diameter}
                  obstacle_height={state.obstacle_height}
                  obstacle_distance={state.obstacle_distance}
                  obstacle_width={state.obstacle_width}
                  width={width - 24}
                />
              </View>
            ) : (
              <Empty
                text={
                  isJibMode
                    ? "Jib modunda 2D yan görünüm çizilmez — broşürde jib mafsal geometrisi tanımlı değildir."
                    : (calc.error ?? "Bu konfigürasyonda 2D geometri hesaplanamadı.")
                }
              />
            )}
            <QuickReadout state={state} />
          </ScrollView>
        )}
        {tab === "cog" && (
          <CogTab crane={crane} state={state} width={width} outriggerError={result?.outrigger_error} totalLoad={cap?.total_load ?? 0} outrigger={result?.outrigger ?? null} />
        )}
        {tab === "carpisma" && (
          <CollisionTab
            items={result?.collision.items ?? []}
            error={calc.error}
            isJibMode={isJibMode}
          />
        )}
      </View>

      {/* Alt sekme çubuğu */}
      <View style={s.tabbar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          const badge = t.key === "carpisma" ? (result?.collision.active.length ?? 0) : 0;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={s.tabBtn}>
              <View>
                <Text style={[s.tabIcon, active && s.tabIconActive]}>{t.icon}</Text>
                {badge > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>
                )}
              </View>
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StatusBanner(props: {
  error: string | null;
  pct: number;
  cap?: CapacityResult;
  worst: "ok" | "warning" | "collision";
  reeving?: ReevingResult;
  crane: CraneModel;
}) {
  const { error, pct, cap, worst, reeving, crane } = props;
  if (error || !cap) {
    return (
      <View style={[s.banner, { backgroundColor: "rgba(255,90,77,0.12)", borderColor: C.red }]}>
        <Text style={[s.bannerBig, { color: C.red }]}>HESAPLANAMADI</Text>
        <Text style={s.bannerMsg} numberOfLines={2}>{error ?? "Girdileri kontrol edin."}</Text>
      </View>
    );
  }
  const over = cap.severity === "over";
  const critical = cap.severity === "warning";
  const col = over ? C.red : critical ? C.orange : C.green;
  const bigLabel = over ? "KAPASİTE AŞIMI" : critical ? "KRİTİK KALDIRMA" : "UYGUN";
  return (
    <View
      style={[
        s.banner,
        { borderColor: col, backgroundColor: over ? "rgba(255,90,77,0.12)" : critical ? "rgba(255,138,61,0.12)" : "rgba(0,228,117,0.08)" },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.bannerBig, { color: col }]}>{bigLabel}</Text>
        <Text style={s.bannerMsg}>
          Yük {cap.total_load.toFixed(1)} t · İzin {cap.rated_capacity.toFixed(1)} t
          {worst !== "ok" ? (worst === "collision" ? "  ·  ⚠ ÇARPIŞMA" : "  ·  ⚠ yakın") : ""}
        </Text>
        {reeving && (
          <Text style={[s.bannerMsg, !reeving.feasible && { color: C.red }]}>
            {reeving.required_parts} kollu donanım · tek halat {reeving.single_line_pull_t.toFixed(1)} t
            {!reeving.feasible ? "  ·  ⚠ makara kapasitesi yetersiz" : ""}
          </Text>
        )}
        {crane.max_wind_speed_ms != null && (
          <Text style={s.bannerMsg}>
            Rüzgâr limiti {crane.max_wind_speed_ms} m/s{crane.wind_note ? ` — ${crane.wind_note}` : ""}
          </Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.pctBig, { color: col }]}>{Number.isFinite(pct) ? pct.toFixed(0) : "—"}%</Text>
        <Text style={s.pctSub}>kullanım</Text>
      </View>
    </View>
  );
}

/** Proje açma sonucu: proje adı + düşürülen masaüstü özellikleri (kapatılabilir). */
function ImportBanner(props: { notice: ImportNotice; onClose: () => void }) {
  const { notice, onClose } = props;
  const [expanded, setExpanded] = React.useState(false);
  const isErr = notice.kind === "error";
  const col = isErr ? C.red : C.accent;
  const warnings = notice.kind === "ok" ? notice.warnings : [];
  const shown = expanded ? warnings : warnings.slice(0, 2);
  return (
    <View style={[s.importBanner, { borderColor: col, backgroundColor: isErr ? "rgba(255,90,77,0.12)" : "rgba(255,186,32,0.08)" }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: col, fontSize: 13.5, fontWeight: "800" }} numberOfLines={2}>
          {notice.kind === "error" ? "Proje açılamadı" : `📂 ${notice.projectName}`}
        </Text>
        {notice.kind === "error" ? (
          <Text style={s.importLine}>{notice.message}</Text>
        ) : warnings.length === 0 ? (
          <Text style={s.importLine}>Masaüstü projesi yüklendi.</Text>
        ) : (
          <>
            {shown.map((w, i) => (
              <Text key={i} style={s.importLine}>• {w}</Text>
            ))}
            {warnings.length > 2 && (
              <Pressable onPress={() => setExpanded((x) => !x)} hitSlop={8}>
                <Text style={[s.importLine, { color: C.accent, fontWeight: "700" }]}>
                  {expanded ? "Daha az göster" : `+${warnings.length - 2} uyarı daha`}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
      <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Kapat" style={s.importClose}>
        <Text style={{ color: C.textDim, fontSize: 18, fontWeight: "800" }}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Proje çalışma adımları içeriyorsa hangi planın yükleneceğini seçtirir. */
function StepPickerModal(props: {
  project: ParsedDesktopProject | null;
  onPick: (stepIndex: number | null) => void;
  onCancel: () => void;
}) {
  const { project, onPick, onCancel } = props;
  return (
    <Modal visible={!!project} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: "800" }} numberOfLines={2}>
            {project?.projectName}
          </Text>
          <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4, marginBottom: 10 }}>
            Bu projede {project?.steps.length ?? 0} çalışma adımı var. Hangisini yükleyelim?
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <Pressable onPress={() => onPick(null)} style={({ pressed }) => [s.stepItem, pressed && { opacity: 0.7 }]}>
              <Text style={s.stepItemText}>Güncel plan (kaydedildiği hâli)</Text>
              <Text style={s.stepItemSub}>{String(project?.current.craneModel ?? "")}</Text>
            </Pressable>
            {project?.steps.map((st, i) => (
              <Pressable key={i} onPress={() => onPick(i)} style={({ pressed }) => [s.stepItem, pressed && { opacity: 0.7 }]}>
                <Text style={s.stepItemText}>{i + 1}. {st.name}</Text>
                <Text style={s.stepItemSub}>
                  {String(st.config.craneModel ?? "")}
                  {typeof st.config.radius === "number" ? ` · R ${st.config.radius} m` : ""}
                  {typeof st.config.load_weight === "number" ? ` · ${st.config.load_weight} t` : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={onCancel} style={s.modalCancel}>
            <Text style={{ color: C.textDim, fontSize: 14, fontWeight: "700" }}>Vazgeç</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Jib modunda 2D/çarpışma sekmelerinde gösterilen kapsam uyarısı. */
function JibScopeNotice() {
  return (
    <View style={[s.card, { borderColor: C.orange, backgroundColor: "rgba(255,138,61,0.1)" }]}>
      <Text style={{ color: C.orange, fontSize: 13.5, fontWeight: "700" }}>
        ⚠ Jib modunda klerens/çarpışma hesaplanmaz
      </Text>
      <Text style={{ color: C.textDim, fontSize: 12.5, marginTop: 4 }}>
        Broşürde jib mafsal geometrisi tanımlı olmadığından bu konfigürasyonda yalnızca
        kapasite ve ayak reaksiyonu hesaplanır.
      </Text>
    </View>
  );
}

function InputsTab(props: {
  crane: CraneModel;
  state: AppState;
  set: <K extends keyof AppState>(k: K, v: AppState[K]) => void;
  patch: (p: Partial<AppState>) => void;
}) {
  const { crane, state, set, patch } = props;
  const pctOpts = crane.capacity_pct_options ?? [75, 85];
  const jibMeta = crane.jib_configs;
  const activeJib = jibMeta?.configs.find((c) => c.key === state.lift_config);
  const inJib = !!activeJib;
  const boomOptions = activeJib ? activeJib.boom_lengths : crane.boom_lengths;

  // Seçili jib eğrisinin geçerli radius aralığı (yoksa null).
  const jibRange = (cfg: LiftConfig, jl: number, bl: number, off: number): [number, number] | null => {
    try {
      const curve = getJibCapacityCurve(crane, cfg, jl, bl, off);
      const rs = curve.map((p) => p[0]);
      return [Math.min(...rs), Math.max(...rs)];
    } catch {
      return null;
    }
  };
  // Radius'u seçili jib eğrisinin aralığına sıkıştırır (geçersiz radius → tablo hatası önlenir).
  const clampRadius = (cfg: LiftConfig, jl: number, bl: number, off: number, r: number) => {
    const range = jibRange(cfg, jl, bl, off);
    if (!range) return r;
    return Math.min(range[1], Math.max(range[0], r));
  };

  // Kaldırma konfigürasyonu değişimi — bağımlı alanları (denge, bom, jib, radius) tutarlı kurar.
  const changeConfig = (key: LiftConfig) => {
    if (key === "T" || !jibMeta) {
      patch({ lift_config: "T" });
      return;
    }
    const meta = jibMeta.configs.find((c) => c.key === key);
    if (!meta) return;
    const boom = meta.boom_lengths.includes(state.boom_length)
      ? state.boom_length
      : meta.boom_lengths[meta.boom_lengths.length - 1];
    const jl = meta.jib_lengths[0];
    const off = meta.offsets[0];
    patch({
      lift_config: key,
      counterweight: jibMeta.counterweight_required,
      boom_length: boom,
      jib_length: jl,
      jib_offset: off,
      radius: clampRadius(key, jl, boom, off, state.radius),
    });
  };

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Section title="Yük">
        <Stepper label="Yük ağırlığı" unit="t" value={state.load_weight} step={0.5} onChange={(v) => set("load_weight", v)} />
        <Stepper label="Kanca bloğu" unit="t" value={state.hook_weight} step={0.1} onChange={(v) => set("hook_weight", v)} />
        <Stepper label="Sapan / ekipman" unit="t" value={state.rigging_weight} step={0.1} onChange={(v) => set("rigging_weight", v)} />
      </Section>

      {jibMeta && (
        <Section title="Kaldırma Konfigürasyonu">
          <Segmented
            label="Konfigürasyon"
            options={["T" as LiftConfig, ...jibMeta.configs.map((c) => c.key)]}
            value={state.lift_config}
            format={(v) => (v === "T" ? "Ana Bom (jibsiz)" : jibMeta.configs.find((c) => c.key === v)?.label ?? v)}
            onChange={changeConfig}
          />
          {activeJib?.desc && (
            <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 4 }}>{activeJib.desc}</Text>
          )}
          {jibMeta.note && (
            <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 4 }}>{jibMeta.note}</Text>
          )}
        </Section>
      )}

      <Section title="Bom & Radius">
        <Segmented
          label="Bom uzunluğu (m)"
          options={boomOptions}
          value={state.boom_length}
          onChange={(v) =>
            patch(
              inJib
                ? { boom_length: v, radius: clampRadius(state.lift_config, state.jib_length, v, state.jib_offset, state.radius) }
                : { boom_length: v },
            )
          }
        />
        <Stepper label="Radius" unit="m" value={state.radius} step={0.5} min={1} onChange={(v) => set("radius", v)} />

        {inJib ? (
          <View style={{ marginBottom: 14 }}>
            <Text style={{ color: C.textDim, fontSize: 13, marginBottom: 6, fontWeight: "600" }}>Denge ağırlığı (t)</Text>
            <View style={{ backgroundColor: C.accent, borderRadius: 22, height: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, alignSelf: "flex-start" }}>
              <Text style={{ color: "#1a1200", fontSize: 15, fontWeight: "800" }}>{jibMeta!.counterweight_required}t (jib gereği)</Text>
            </View>
          </View>
        ) : (
          <Segmented label="Denge ağırlığı (t)" options={crane.counterweight_options} value={state.counterweight} onChange={(v) => set("counterweight", v)} />
        )}

        {!inJib && pctOpts.length > 1 && (
          <Segmented label="Kapasite oranı (%)" options={pctOpts} value={state.capacity_pct} onChange={(v) => set("capacity_pct", v)} />
        )}

        {activeJib && (
          <>
            <Segmented
              label="Jib uzunluğu (m)"
              options={activeJib.jib_lengths}
              value={state.jib_length}
              onChange={(v) =>
                patch({ jib_length: v, radius: clampRadius(state.lift_config, v, state.boom_length, state.jib_offset, state.radius) })
              }
            />
            <Segmented
              label="Jib ofset açısı (°)"
              options={activeJib.offsets}
              value={state.jib_offset}
              onChange={(v) =>
                patch({ jib_offset: v, radius: clampRadius(state.lift_config, state.jib_length, state.boom_length, v, state.radius) })
              }
            />
            {(() => {
              const rng = jibRange(state.lift_config, state.jib_length, state.boom_length, state.jib_offset);
              return rng ? (
                <Text style={{ color: C.textFaint, fontSize: 12 }}>Geçerli radius aralığı: {rng[0]}–{rng[1]} m</Text>
              ) : null;
            })()}
          </>
        )}
      </Section>

      <Section title="Kurulum">
        <Segmented label="Ayak açıklığı (Lx × Ly)" options={crane.outrigger_configs} value={state.outrigger_config} onChange={(v) => set("outrigger_config", v)} />
        <Stepper label="Dönme açısı (slew)" unit="°" value={state.slew_angle} step={15} min={0} max={360} decimals={0} onChange={(v) => set("slew_angle", v)} />
      </Section>

      {inJib && (
        <View style={[s.card, { borderColor: C.orange, backgroundColor: "rgba(255,138,61,0.1)" }]}>
          <Text style={{ color: C.orange, fontSize: 13, fontWeight: "700" }}>
            ⚠ Jib modunda klerens/çarpışma hesaplanmaz — 2D ve Çarpışma sekmelerine bakın.
          </Text>
        </View>
      )}

      <Section title="Yük & Engel geometrisi">
        <Stepper label="Yük yüksekliği" unit="m" value={state.load_height} step={0.5} onChange={(v) => set("load_height", v)} />
        <Stepper label="Yük çapı/genişliği" unit="m" value={state.load_diameter} step={0.5} min={0.1} onChange={(v) => set("load_diameter", v)} />
        <Stepper label="Engel yüksekliği" unit="m" value={state.obstacle_height} step={0.5} onChange={(v) => set("obstacle_height", v)} />
        <Stepper label="Engel yatay uzaklığı" unit="m" value={state.obstacle_distance} step={0.5} onChange={(v) => set("obstacle_distance", v)} />
        <Stepper label="Engel genişliği" unit="m" value={state.obstacle_width} step={0.5} min={0.1} onChange={(v) => set("obstacle_width", v)} />
      </Section>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

function CogTab(props: {
  crane: CraneModel;
  state: AppState;
  width: number;
  outriggerError?: string;
  totalLoad: number;
  /** Motorun tam ayak sonucu (bom ağırlığı, CW yarıçapı, asimetrik ayak dahil) — masaüstüyle aynı. */
  outrigger: OutriggerResult | null;
}) {
  const { crane, state, width, outriggerError, totalLoad, outrigger } = props;
  const selfW = crane.self_weight;

  const data = React.useMemo(() => {
    if (selfW == null) return null;
    try {
      if (outrigger && outrigger.per_angle.length > 0) {
        const { Lx, Ly } = parseOutriggerConfig(state.outrigger_config);
        const target = ((state.slew_angle % 360) + 360) % 360;
        const at = outrigger.per_angle.reduce((b, a) =>
          Math.abs(a.slew_angle - target) < Math.abs(b.slew_angle - target) ? a : b,
        );
        return { Lx, Ly, at, V: outrigger.V, rectCenterX: outrigger.rect_center_x ?? 0 };
      }
      const { Lx, Ly } = parseOutriggerConfig(state.outrigger_config);
      const at = cornerLoadsAtAngle(
        {
          crane_self_weight: selfW,
          counterweight: state.counterweight,
          total_load: totalLoad,
          radius: state.radius,
          Lx,
          Ly,
        },
        state.slew_angle,
      );
      const V = selfW + state.counterweight + totalLoad;
      return { Lx, Ly, at, V, rectCenterX: 0 };
    } catch {
      return null;
    }
  }, [crane, state, selfW, totalLoad, outrigger]);

  if (!data) {
    return <ScrollView contentContainerStyle={s.pad}><Empty text={outriggerError ?? "Ağırlık merkezi hesaplanamadı (vinç ağırlığı/ayak tanımı eksik)."} /></ScrollView>;
  }

  const outside =
    Math.abs(data.at.cog_x) > data.Lx / 2 ||
    Math.abs(data.at.cog_y) > data.Ly / 2 ||
    data.at.tipping;
  const uplift = data.at.uplift && !outside;

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <View style={s.card}>
        <GroundForceDiagram Lx={data.Lx} Ly={data.Ly} atAngle={data.at} V={data.V} radius={state.radius} slewAngle={state.slew_angle} width={width - 24} rectCenterX={data.rectCenterX} />
        <View style={[s.cogVerdict, { backgroundColor: outside ? "rgba(255,90,77,0.12)" : uplift ? "rgba(255,186,32,0.12)" : "rgba(0,228,117,0.1)" }]}>
          <Text style={[s.cogVerdictText, { color: outside ? C.red : uplift ? C.accent : C.green }]}>
            {outside
              ? "⚠ CoG ayak alanı DIŞINDA — DEVRİLME RİSKİ"
              : uplift
                ? "⚠ Ayak kalkması — bir ayak yüksüz"
                : "✓ CoG ayak alanı içinde"}
          </Text>
        </View>
        <View style={s.row}>
          <ReadItem label="Bileşke V" value={`${data.V.toFixed(1)} t`} />
          <ReadItem label="Maks köşe" value={`${data.at.max_corner.load.toFixed(1)} t`} />
          <ReadItem label="Açı" value={`${state.slew_angle.toFixed(0)}°`} />
        </View>
      </View>
    </ScrollView>
  );
}

function CollisionTab(props: {
  items: { id: string; source: string; target: string; severity: "ok" | "warning" | "collision"; clearance_m: number; message: string }[];
  error: string | null;
  isJibMode: boolean;
}) {
  const { items, error, isJibMode } = props;
  const scopeNote = (
    <View style={[s.card, { backgroundColor: C.bg2 }]}>
      <Text style={{ color: C.textDim, fontSize: 12.5 }}>
        ℹ Bu kontrol yalnız vinç iç klerenslerini kapsar (bom/yük/kanca/halat). Çevre nesneleri
        (bina, enerji hattı vb.) bu uygulamada tanımlanmaz — masaüstü uygulamada kontrol edilir.
      </Text>
    </View>
  );

  if (isJibMode) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <JibScopeNotice />
        {scopeNote}
      </ScrollView>
    );
  }

  if (error) return <ScrollView contentContainerStyle={s.pad}><Empty text={error} /></ScrollView>;
  const active = items.filter((i) => i.severity !== "ok");
  const ok = items.filter((i) => i.severity === "ok");
  const order = { collision: 0, warning: 1, ok: 2 } as const;
  const sorted = [...active].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <ScrollView contentContainerStyle={s.pad}>
      {scopeNote}
      {active.length === 0 ? (
        <View style={[s.card, { alignItems: "center", paddingVertical: 28 }]}>
          <Text style={{ fontSize: 40 }}>✓</Text>
          <Text style={{ color: C.green, fontSize: 18, fontWeight: "800", marginTop: 8 }}>Çarpışma yok</Text>
          <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>Tüm klerensler güvenli.</Text>
        </View>
      ) : (
        sorted.map((it) => (
          <View key={it.id} style={[s.collItem, { borderLeftColor: severityColor(it.severity) }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.collMsg}>{it.message}</Text>
              <Text style={s.collSub}>{sourceTr(it.source)} → {it.target}</Text>
            </View>
            <Text style={[s.collVal, { color: severityColor(it.severity) }]}>
              {it.clearance_m >= 0 ? "+" : ""}{it.clearance_m.toFixed(2)} m
            </Text>
          </View>
        ))
      )}

      {ok.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={s.collGroupTitle}>Güvenli klerensler</Text>
          {ok.map((it) => (
            <View key={it.id} style={s.collItemOk}>
              <Text style={s.collOkMsg}>{it.message}</Text>
              <Text style={[s.collVal, { color: C.green }]}>+{it.clearance_m.toFixed(2)} m</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function QuickReadout(props: { state: AppState }) {
  const { state } = props;
  return (
    <View style={s.row}>
      <ReadItem label="Radius" value={`${state.radius.toFixed(1)} m`} />
      <ReadItem label="Bom" value={`${state.boom_length} m`} />
      <ReadItem label="Denge" value={`${state.counterweight} t`} />
    </View>
  );
}

function ReadItem(props: { label: string; value: string }) {
  return (
    <View style={s.readItem}>
      <Text style={s.readVal}>{props.value}</Text>
      <Text style={s.readLabel}>{props.label}</Text>
    </View>
  );
}

function Empty(props: { text: string }) {
  return (
    <View style={[s.card, { alignItems: "center", paddingVertical: 28 }]}>
      <Text style={{ fontSize: 34 }}>⚠</Text>
      <Text style={{ color: C.textDim, fontSize: 14, marginTop: 10, textAlign: "center" }}>{props.text}</Text>
    </View>
  );
}

function sourceTr(s: string) {
  return s === "boom" ? "Bom" : s === "load" ? "Yük" : s === "hook" ? "Kanca" : s === "rope" ? "Halat" : s;
}

// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTop: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8 },
  brand: { color: C.accent, fontSize: 20, fontWeight: "900", letterSpacing: 1 },
  brandSub: { color: C.textDim, fontSize: 13, fontWeight: "600" },
  openBtn: { paddingHorizontal: 12, height: 34, minWidth: 100, borderRadius: 17, borderWidth: 1, borderColor: C.accent, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  openBtnText: { color: C.accent, fontSize: 13, fontWeight: "800" },
  importBanner: { flexDirection: "row", alignItems: "flex-start", marginHorizontal: 12, marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  importLine: { color: C.textDim, fontSize: 12, marginTop: 3 },
  importClose: { paddingHorizontal: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: C.panel, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  stepItem: { backgroundColor: C.panel2, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  stepItemText: { color: C.text, fontSize: 15, fontWeight: "700" },
  stepItemSub: { color: C.textFaint, fontSize: 12, marginTop: 3, fontFamily: mono },
  modalCancel: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  craneChip: { paddingHorizontal: 14, height: 38, borderRadius: 19, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  craneChipActive: { backgroundColor: C.panel2, borderColor: C.accent },
  craneChipText: { color: C.textDim, fontSize: 13, fontWeight: "700" },
  craneChipTextActive: { color: C.accent },

  banner: { flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginTop: 10, padding: 14, borderRadius: 14, borderWidth: 1.5, gap: 12 },
  bannerBig: { fontSize: 19, fontWeight: "900", letterSpacing: 0.5 },
  bannerMsg: { color: C.textDim, fontSize: 12.5, marginTop: 3, fontFamily: mono },
  pctBig: { fontSize: 30, fontWeight: "900", fontFamily: mono, lineHeight: 32 },
  pctSub: { color: C.textFaint, fontSize: 11 },

  pad: { padding: 12 },
  card: { backgroundColor: C.panel, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12 },

  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  readItem: { flex: 1, backgroundColor: C.panel2, borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: C.border },
  readVal: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: mono },
  readLabel: { color: C.textFaint, fontSize: 11, marginTop: 3 },

  cogVerdict: { marginTop: 10, padding: 12, borderRadius: 12, alignItems: "center" },
  cogVerdictText: { fontSize: 14, fontWeight: "800", textAlign: "center" },

  collItem: { flexDirection: "row", alignItems: "center", backgroundColor: C.panel, borderRadius: 12, padding: 14, marginBottom: 8, borderLeftWidth: 4, borderWidth: 1, borderColor: C.border, gap: 10 },
  collMsg: { color: C.text, fontSize: 14.5, fontWeight: "700" },
  collSub: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  collVal: { fontSize: 15, fontWeight: "800", fontFamily: mono },
  collGroupTitle: { color: C.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 6, marginLeft: 4 },
  collItemOk: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.bg2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6 },
  collOkMsg: { color: C.textDim, fontSize: 13 },

  tabbar: { flexDirection: "row", backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 6, paddingTop: 6 },
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 4 },
  tabIcon: { fontSize: 20, color: C.textFaint },
  tabIconActive: { color: C.accent },
  tabLabel: { fontSize: 11, color: C.textFaint, fontWeight: "600" },
  tabLabelActive: { color: C.accent, fontWeight: "800" },
  badge: { position: "absolute", top: -4, right: -12, backgroundColor: C.red, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});

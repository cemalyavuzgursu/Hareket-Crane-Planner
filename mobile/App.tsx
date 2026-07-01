// Hareket Crane Planner — saha mobil uygulaması.
// Basit, dokunmatik dostu: vinç seç → girdiler → 2D / ağırlık merkezi / çarpışma.
import React from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions, StatusBar as RNStatusBar,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native";

import { CRANES } from "./src/shared/cranes";
import { computeLiftFull } from "./src/shared/engine";
import { cornerLoadsAtAngle, parseOutriggerConfig } from "./src/shared/engine/outrigger";
import type { CraneModel } from "./src/shared/engine/types";

import { AppState, defaultState, reconcileForCrane } from "./src/state";
import { C, mono, utilColor, severityColor } from "./src/theme";
import { Stepper, Segmented, Section } from "./src/components/Controls";
import SideView2D from "./src/components/SideView2D";
import GroundForceDiagram from "./src/components/GroundForceDiagram";

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

  const selectCrane = (c: CraneModel) =>
    setState((p) => reconcileForCrane(p, c));

  // --- Hesap (hata olursa yakala) ---
  const calc = React.useMemo(() => {
    try {
      const result = computeLiftFull(crane, state, {
        outrigger_config: state.outrigger_config,
        slew_angle: state.slew_angle,
        objects: [],
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

      {/* Durum banner'ı */}
      <StatusBanner error={calc.error} pct={pct} cap={cap} worst={result?.collision.worst ?? "ok"} />

      {/* Sekme içeriği */}
      <View style={{ flex: 1 }}>
        {tab === "girdi" && (
          <InputsTab crane={crane} state={state} set={set} />
        )}
        {tab === "2d" && (
          <ScrollView contentContainerStyle={s.pad}>
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
              <Empty text={calc.error ?? "Bu konfigürasyonda 2D geometri hesaplanamadı."} />
            )}
            <QuickReadout state={state} />
          </ScrollView>
        )}
        {tab === "cog" && (
          <CogTab crane={crane} state={state} width={width} outriggerError={result?.outrigger_error} totalLoad={cap?.total_load ?? 0} />
        )}
        {tab === "carpisma" && (
          <CollisionTab items={result?.collision.items ?? []} error={calc.error} />
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
  cap?: { rated_capacity: number; total_load: number; status: string };
  worst: "ok" | "warning" | "collision";
}) {
  const { error, pct, cap, worst } = props;
  if (error || !cap) {
    return (
      <View style={[s.banner, { backgroundColor: "rgba(255,90,77,0.12)", borderColor: C.red }]}>
        <Text style={[s.bannerBig, { color: C.red }]}>HESAPLANAMADI</Text>
        <Text style={s.bannerMsg} numberOfLines={2}>{error ?? "Girdileri kontrol edin."}</Text>
      </View>
    );
  }
  const col = utilColor(pct);
  const over = pct > 100;
  return (
    <View style={[s.banner, { borderColor: col, backgroundColor: over ? "rgba(255,90,77,0.12)" : "rgba(0,228,117,0.08)" }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.bannerBig, { color: col }]}>{over ? "KAPASİTE AŞIMI" : "UYGUN"}</Text>
        <Text style={s.bannerMsg}>
          Yük {cap.total_load.toFixed(1)} t · İzin {cap.rated_capacity.toFixed(1)} t
          {worst !== "ok" ? (worst === "collision" ? "  ·  ⚠ ÇARPIŞMA" : "  ·  ⚠ yakın") : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.pctBig, { color: col }]}>{Number.isFinite(pct) ? pct.toFixed(0) : "—"}%</Text>
        <Text style={s.pctSub}>kullanım</Text>
      </View>
    </View>
  );
}

function InputsTab(props: {
  crane: CraneModel;
  state: AppState;
  set: <K extends keyof AppState>(k: K, v: AppState[K]) => void;
}) {
  const { crane, state, set } = props;
  const pctOpts = crane.capacity_pct_options ?? [75, 85];
  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Section title="Yük">
        <Stepper label="Yük ağırlığı" unit="t" value={state.load_weight} step={0.5} onChange={(v) => set("load_weight", v)} />
        <Stepper label="Kanca bloğu" unit="t" value={state.hook_weight} step={0.1} onChange={(v) => set("hook_weight", v)} />
        <Stepper label="Sapan / ekipman" unit="t" value={state.rigging_weight} step={0.1} onChange={(v) => set("rigging_weight", v)} />
      </Section>

      <Section title="Bom & Radius">
        <Segmented label="Bom uzunluğu (m)" options={crane.boom_lengths} value={state.boom_length} onChange={(v) => set("boom_length", v)} />
        <Stepper label="Radius" unit="m" value={state.radius} step={0.5} min={1} onChange={(v) => set("radius", v)} />
        <Segmented label="Denge ağırlığı (t)" options={crane.counterweight_options} value={state.counterweight} onChange={(v) => set("counterweight", v)} />
        {pctOpts.length > 1 && (
          <Segmented label="Kapasite oranı (%)" options={pctOpts} value={state.capacity_pct} onChange={(v) => set("capacity_pct", v)} />
        )}
      </Section>

      <Section title="Kurulum">
        <Segmented label="Ayak açıklığı (Lx × Ly)" options={crane.outrigger_configs} value={state.outrigger_config} onChange={(v) => set("outrigger_config", v)} />
        <Stepper label="Dönme açısı (slew)" unit="°" value={state.slew_angle} step={15} min={0} max={360} decimals={0} onChange={(v) => set("slew_angle", v)} />
      </Section>

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
}) {
  const { crane, state, width, outriggerError, totalLoad } = props;
  const selfW = crane.self_weight;

  const data = React.useMemo(() => {
    if (selfW == null) return null;
    try {
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
      return { Lx, Ly, at, V };
    } catch {
      return null;
    }
  }, [crane, state, selfW, totalLoad]);

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
        <GroundForceDiagram Lx={data.Lx} Ly={data.Ly} atAngle={data.at} V={data.V} radius={state.radius} slewAngle={state.slew_angle} width={width - 24} />
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
}) {
  const { items, error } = props;
  if (error) return <ScrollView contentContainerStyle={s.pad}><Empty text={error} /></ScrollView>;
  const active = items.filter((i) => i.severity !== "ok");
  const ok = items.filter((i) => i.severity === "ok");
  const order = { collision: 0, warning: 1, ok: 2 } as const;
  const sorted = [...active].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <ScrollView contentContainerStyle={s.pad}>
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

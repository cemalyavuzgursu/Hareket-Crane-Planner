// Saha dostu girdi kontrolleri — büyük dokunmatik alanlar.
import React from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
} from "react-native";
import { C, mono } from "../theme";

/** Artı/eksi stepper + ortada elle giriş. */
export function Stepper(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  decimals?: number;
}) {
  const { label, value, onChange, step = 1, min = 0, max = Infinity, unit, decimals = 2 } = props;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(fmt(value, decimals)), [value, decimals]);

  return (
    <View style={s.field}>
      <Text style={s.label}>{label}{unit ? `  (${unit})` : ""}</Text>
      <View style={s.stepperRow}>
        <Pressable style={s.stepBtn} onPress={() => onChange(clamp(round(value - step)))} hitSlop={8}>
          <Text style={s.stepBtnText}>−</Text>
        </Pressable>
        <TextInput
          style={s.stepInput}
          value={text}
          onChangeText={setText}
          onEndEditing={() => {
            const n = parseFloat(text.replace(",", "."));
            onChange(Number.isFinite(n) ? clamp(n) : value);
          }}
          keyboardType="numeric"
          selectTextOnFocus
        />
        <Pressable style={s.stepBtn} onPress={() => onChange(clamp(round(value + step)))} hitSlop={8}>
          <Text style={s.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Yatay seçenek çipleri (bom, denge, ayak vs). */
export function Segmented<T extends string | number>(props: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  const { label, options, value, onChange, format } = props;
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((o) => {
          const active = o === value;
          return (
            <Pressable key={String(o)} onPress={() => onChange(o)} style={[s.chip, active && s.chipActive]}>
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {format ? format(o) : String(o)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Bölüm başlığı. */
export function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{props.title}</Text>
      {props.children}
    </View>
  );
}

function fmt(v: number, d: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(d).replace(/\.?0+$/, "");
}
function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

const s = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { color: C.textDim, fontSize: 13, marginBottom: 6, fontWeight: "600" },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 52, height: 52, borderRadius: 12, backgroundColor: C.panel2,
    borderWidth: 1, borderColor: C.border2, alignItems: "center", justifyContent: "center",
  },
  stepBtnText: { color: C.accent, fontSize: 28, fontWeight: "700", lineHeight: 30 },
  stepInput: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.border, color: C.text, fontSize: 20,
    textAlign: "center", fontFamily: mono, fontWeight: "700",
  },
  chip: {
    paddingHorizontal: 16, height: 44, borderRadius: 22, backgroundColor: C.panel2,
    borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center",
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.textDim, fontSize: 15, fontWeight: "600" },
  chipTextActive: { color: "#1a1200", fontWeight: "800" },
  section: {
    backgroundColor: C.panel, borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: C.border,
  },
  sectionTitle: {
    color: C.text, fontSize: 15, fontWeight: "800", marginBottom: 12,
    letterSpacing: 0.3, textTransform: "uppercase",
  },
});

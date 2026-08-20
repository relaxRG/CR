import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { monthLabel } from "@/lib/labor/types";

export type LaborCompareMode = "none" | "lastMonth" | "lastYear" | "custom";

type LaborCompareToggleProps = {
  mode: LaborCompareMode;
  customMonth?: string;
  baseMonth: string;
  onChange: (mode: LaborCompareMode) => void;
  onCustomMonthChange?: (month: string) => void;
  colors: { primary: string; surface: string; border: string; muted: string; foreground: string };
  compact?: boolean;
};

export function getLaborCompareMonth(base: string, mode: LaborCompareMode, customMonth?: string): string | null {
  if (mode === "none") return null;
  if (mode === "custom") return customMonth ?? null;
  const [year, month] = base.split("-").map(Number);
  if (mode === "lastMonth") {
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${year - 1}-${String(month).padStart(2, "0")}`;
}

export function laborCompareModeLabel(mode: LaborCompareMode, customMonth?: string): string {
  if (mode === "lastMonth") return "上月";
  if (mode === "lastYear") return "去年同期";
  if (mode === "custom") return customMonth ? monthLabel(customMonth) : "筛选月";
  return "不对比";
}

function recentMonths(base: string, count = 24): string[] {
  const [year, month] = base.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 2 - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** 员工总览和薪资区共用的对比筛选控件；状态封装在自身，月份与业务结果仍由父工作台控制。 */
export function LaborCompareToggle({ mode, customMonth, baseMonth, onChange, onCustomMonthChange, colors, compact = false }: LaborCompareToggleProps) {
  const [open, setOpen] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const months = recentMonths(baseMonth);
  const tap = () => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={{ position: "relative", flex: compact ? 1 : undefined, minWidth: 0 }}>
      <TouchableOpacity
        onPress={() => { tap(); setOpen((value) => !value); setShowMonthPicker(false); }}
        style={[styles.button, compact && styles.compactButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <IconSymbol name="chart.bar.xaxis" size={compact ? 12 : 16} color={mode !== "none" ? colors.primary : colors.muted} />
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ fontSize: compact ? 11 : 12, fontWeight: "600", color: mode !== "none" ? colors.primary : colors.foreground }}>{mode !== "none" ? laborCompareModeLabel(mode, customMonth) : "对比"}</Text>
      </TouchableOpacity>

      {open && !showMonthPicker ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(["none", "lastMonth", "lastYear"] as LaborCompareMode[]).map((candidate) => (
            <TouchableOpacity key={candidate} onPress={() => { tap(); onChange(candidate); setOpen(false); }} style={[styles.option, { backgroundColor: mode === candidate ? colors.primary : "transparent" }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: mode === candidate ? "#fff" : colors.foreground }}>{laborCompareModeLabel(candidate)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { tap(); setShowMonthPicker(true); }} style={[styles.option, { backgroundColor: mode === "custom" ? colors.primary : "transparent", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "custom" ? "#fff" : colors.foreground }}>{mode === "custom" && customMonth ? monthLabel(customMonth) : "筛选月"}</Text>
            <IconSymbol name="chevron.right" size={10} color={mode === "custom" ? "#fff" : colors.muted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {open && showMonthPicker ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border, width: 130 }]}>
          <TouchableOpacity onPress={() => setShowMonthPicker(false)} style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <IconSymbol name="chevron.left" size={12} color={colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>返回</Text>
          </TouchableOpacity>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {months.map((candidate) => (
              <TouchableOpacity key={candidate} onPress={() => { tap(); onCustomMonthChange?.(candidate); onChange("custom"); setOpen(false); setShowMonthPicker(false); }} style={[styles.option, { backgroundColor: mode === "custom" && customMonth === candidate ? colors.primary : "transparent" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "custom" && customMonth === candidate ? "#fff" : colors.foreground }}>{monthLabel(candidate)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  compactButton: { minWidth: 0, paddingHorizontal: 4, gap: 3 },
  panel: { position: "absolute", right: 0, top: 34, borderRadius: 10, borderWidth: 1, zIndex: 100, minWidth: 110, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  option: { paddingHorizontal: 12, paddingVertical: 9 },
});

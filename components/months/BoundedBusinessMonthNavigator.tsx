import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import {
  addInventoryMonths,
  canNavigateInventoryMonth,
  getCurrentInventoryMonth,
  inventoryMonthLabel,
  inventoryMonthsForYear,
} from "@/lib/inventory-core/month-browser";
import type { ReportMonth, ReportMonthBounds } from "@/lib/reporting/month-navigation";

interface BoundedBusinessMonthNavigatorProps {
  month: ReportMonth;
  bounds: ReportMonthBounds;
  onChange: (month: ReportMonth) => void;
  subject: string;
  testID?: string;
}

/** 适用于报表、账户与分析页面的受限月份导航。 */
export function BoundedBusinessMonthNavigator({
  month,
  bounds,
  onChange,
  subject,
  testID = "business-month-navigator",
}: BoundedBusinessMonthNavigatorProps) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const canPrevious = canNavigateInventoryMonth(month, -1, bounds);
  const canNext = canNavigateInventoryMonth(month, 1, bounds);
  const available = useMemo(() => inventoryMonthsForYear(year, bounds), [year, bounds]);
  const firstYear = Number(bounds.min.slice(0, 4));
  const lastYear = Number(bounds.max.slice(0, 4));
  const current = getCurrentInventoryMonth();

  useEffect(() => {
    if (visible) setYear(Number(month.slice(0, 4)));
  }, [visible, month]);

  const select = (next: ReportMonth) => {
    onChange(next);
    setVisible(false);
  };

  return (
    <>
      <View testID={testID} style={S.row}>
        <Pressable
          testID={`${testID}-previous`}
          accessibilityRole="button"
          accessibilityLabel={`上一个${subject}月份`}
          accessibilityState={{ disabled: !canPrevious }}
          disabled={!canPrevious}
          onPress={() => onChange(addInventoryMonths(month, -1))}
          style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: !canPrevious ? 0.32 : pressed ? 0.55 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={15} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-picker`}
          accessibilityRole="button"
          accessibilityLabel={`选择${subject}月份，当前${inventoryMonthLabel(month)}`}
          onPress={() => setVisible(true)}
          style={({ pressed }) => [S.monthButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[S.monthText, { color: colors.foreground }]}>{inventoryMonthLabel(month)}</Text>
          <IconSymbol name="chevron.down" size={14} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-next`}
          accessibilityRole="button"
          accessibilityLabel={`下一个${subject}月份`}
          accessibilityState={{ disabled: !canNext }}
          disabled={!canNext}
          onPress={() => onChange(addInventoryMonths(month, 1))}
          style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: !canNext ? 0.32 : pressed ? 0.55 : 1 }]}
        >
          <IconSymbol name="chevron.right" size={15} color={colors.muted} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable style={S.backdrop} onPress={() => setVisible(false)}>
          <Pressable style={[S.sheet, { backgroundColor: colors.background }]} onPress={() => undefined}>
            <View style={[S.handle, { backgroundColor: colors.border }]} />
            <View style={S.header}>
              <Text style={[S.title, { color: colors.foreground }]}>选择{subject}月份</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭月份选择" onPress={() => setVisible(false)} hitSlop={10}>
                <Text style={{ color: colors.muted, fontWeight: "600" }}>关闭</Text>
              </Pressable>
            </View>
            <View style={S.yearRow}>
              <Pressable disabled={year <= firstYear} onPress={() => setYear((value) => value - 1)} style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: year <= firstYear ? 0.3 : pressed ? 0.55 : 1 }]}>
                <IconSymbol name="chevron.left" size={15} color={colors.muted} />
              </Pressable>
              <Text style={[S.yearText, { color: colors.foreground }]}>{year}年</Text>
              <Pressable disabled={year >= lastYear} onPress={() => setYear((value) => value + 1)} style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: year >= lastYear ? 0.3 : pressed ? 0.55 : 1 }]}>
                <IconSymbol name="chevron.right" size={15} color={colors.muted} />
              </Pressable>
            </View>
            <View style={S.grid}>
              {Array.from({ length: 12 }, (_, index) => {
                const candidate = `${year}-${String(index + 1).padStart(2, "0")}` as ReportMonth;
                const enabled = available.includes(candidate);
                const active = candidate === month;
                return (
                  <TouchableOpacity
                    key={candidate}
                    testID={`${testID}-month-${candidate}`}
                    disabled={!enabled}
                    activeOpacity={0.72}
                    onPress={() => select(candidate)}
                    style={[S.monthCell, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border, opacity: enabled ? 1 : 0.28 }]}
                  >
                    <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 14, fontWeight: "600" }}>{index + 1}月</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {current >= bounds.min && current <= bounds.max && current !== month && (
              <TouchableOpacity onPress={() => select(current)} activeOpacity={0.75} style={[S.current, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>回到本月：{inventoryMonthLabel(current)}</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const S = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 16 },
  arrow: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  monthButton: { minWidth: 164, minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12 },
  monthText: { fontSize: 16, fontWeight: "600", letterSpacing: -0.3 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000066" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingBottom: 34 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  title: { fontSize: 18, fontWeight: "700" },
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 18 },
  yearText: { minWidth: 90, textAlign: "center", fontSize: 16, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  monthCell: { width: "22.8%", minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  current: { minHeight: 42, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 20 },
});

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
  type InventoryMonth,
  type InventoryMonthBounds,
} from "@/lib/inventory-core/month-browser";

interface BoundedMonthNavigatorProps {
  month: InventoryMonth;
  bounds: InventoryMonthBounds;
  onChange: (month: InventoryMonth) => void;
  testID?: string;
}

/** 库存、店铺与其他模块共用的库存风格紧凑上浮月份卡片。 */
export function BoundedMonthNavigator({ month, bounds, onChange, testID = "inventory-month-navigator" }: BoundedMonthNavigatorProps) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const canPrevious = canNavigateInventoryMonth(month, -1, bounds);
  const canNext = canNavigateInventoryMonth(month, 1, bounds);
  const available = useMemo(() => inventoryMonthsForYear(year, bounds), [year, bounds]);
  const firstYear = Number(bounds.min.slice(0, 4));
  const lastYear = Number(bounds.max.slice(0, 4));
  const current = getCurrentInventoryMonth();

  useEffect(() => { if (visible) setYear(Number(month.slice(0, 4))); }, [visible, month]);
  const select = (next: InventoryMonth) => { onChange(next); setVisible(false); };

  return (
    <>
      <View testID={testID} style={S.row}>
        <Pressable testID={`${testID}-previous`} accessibilityRole="button" accessibilityLabel="上一个库存月份" accessibilityState={{ disabled: !canPrevious }} disabled={!canPrevious} onPress={() => onChange(addInventoryMonths(month, -1))} style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: !canPrevious ? 0.32 : pressed ? 0.55 : 1 }]}>
          <IconSymbol name="chevron.left" size={15} color={colors.muted} />
        </Pressable>
        <Pressable testID={`${testID}-picker`} accessibilityRole="button" accessibilityLabel={`选择库存月份，当前${inventoryMonthLabel(month)}`} onPress={() => setVisible(true)} style={({ pressed }) => [S.monthButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[S.monthText, { color: colors.foreground }]}>{inventoryMonthLabel(month)}</Text>
        </Pressable>
        <Pressable testID={`${testID}-next`} accessibilityRole="button" accessibilityLabel="下一个库存月份" accessibilityState={{ disabled: !canNext }} disabled={!canNext} onPress={() => onChange(addInventoryMonths(month, 1))} style={({ pressed }) => [S.arrow, { backgroundColor: colors.border + "55", opacity: !canNext ? 0.32 : pressed ? 0.55 : 1 }]}>
          <IconSymbol name="chevron.right" size={15} color={colors.muted} />
        </Pressable>
      </View>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable testID={`${testID}-backdrop`} accessibilityLabel="关闭月份选择" style={S.backdrop} onPress={() => setVisible(false)}>
          <Pressable testID={`${testID}-floating-card`} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => undefined}>
            <Text style={[S.cardTitle, { color: colors.foreground }]}>选择库存月份</Text>
            <View style={S.cardHeader}>
              <Pressable disabled={year <= firstYear} onPress={() => setYear((value) => value - 1)} hitSlop={8} style={({ pressed }) => [S.yearArrow, { opacity: year <= firstYear ? 0.28 : pressed ? 0.55 : 1 }]}><IconSymbol name="chevron.left" size={15} color={colors.muted} /></Pressable>
              <Text style={[S.yearText, { color: colors.foreground }]}>{year}年</Text>
              <Pressable disabled={year >= lastYear} onPress={() => setYear((value) => value + 1)} hitSlop={8} style={({ pressed }) => [S.yearArrow, { opacity: year >= lastYear ? 0.28 : pressed ? 0.55 : 1 }]}><IconSymbol name="chevron.right" size={15} color={colors.muted} /></Pressable>
            </View>
            <View style={S.grid}>
              {Array.from({ length: 12 }, (_, index) => {
                const candidate = `${year}-${String(index + 1).padStart(2, "0")}` as InventoryMonth;
                const enabled = available.includes(candidate);
                const active = candidate === month;
                return <TouchableOpacity key={candidate} testID={`${testID}-month-${candidate}`} disabled={!enabled} activeOpacity={0.72} onPress={() => select(candidate)} style={[S.monthCell, { backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border, opacity: enabled ? 1 : 0.28 }]}><Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "700" }}>{index + 1}月</Text></TouchableOpacity>;
              })}
            </View>
            {current >= bounds.min && current <= bounds.max && current !== month ? <TouchableOpacity onPress={() => select(current)} activeOpacity={0.75} style={[S.current, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "0d" }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>回到本月 · {inventoryMonthLabel(current)}</Text></TouchableOpacity> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const S = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 16 },
  arrow: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  monthButton: { minWidth: 164, minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  monthText: { fontSize: 16, fontWeight: "600", letterSpacing: -0.3 },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "flex-start", paddingTop: 112, paddingHorizontal: 16, backgroundColor: "#00000033" },
  card: { width: "100%", maxWidth: 336, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 14, shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  cardTitle: { textAlign: "center", fontSize: 13, fontWeight: "700", marginBottom: 6 },
  cardHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 10 },
  yearArrow: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  yearText: { minWidth: 84, textAlign: "center", fontSize: 16, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell: { width: "31.4%", minHeight: 38, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  current: { minHeight: 34, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 10 },
});

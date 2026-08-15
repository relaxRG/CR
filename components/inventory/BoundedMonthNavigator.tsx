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

export function BoundedMonthNavigator({ month, bounds, onChange, testID = "inventory-month-navigator" }: BoundedMonthNavigatorProps) {
  const colors = useColors();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(Number(month.slice(0, 4)));
  const canGoPrevious = canNavigateInventoryMonth(month, -1, bounds);
  const canGoNext = canNavigateInventoryMonth(month, 1, bounds);
  const firstYear = Number(bounds.min.slice(0, 4));
  const lastYear = Number(bounds.max.slice(0, 4));
  const selectableMonths = useMemo(() => inventoryMonthsForYear(pickerYear, bounds), [pickerYear, bounds]);
  const canGoPreviousYear = pickerYear > firstYear;
  const canGoNextYear = pickerYear < lastYear;
  const currentNaturalMonth = getCurrentInventoryMonth();
  const canReturnToCurrent = currentNaturalMonth >= bounds.min && currentNaturalMonth <= bounds.max && currentNaturalMonth !== month;

  useEffect(() => {
    if (pickerVisible) setPickerYear(Number(month.slice(0, 4)));
  }, [pickerVisible, month]);

  const changeBy = (offset: -1 | 1) => {
    if (!canNavigateInventoryMonth(month, offset, bounds)) return;
    onChange(addInventoryMonths(month, offset));
  };

  const select = (nextMonth: InventoryMonth) => {
    onChange(nextMonth);
    setPickerVisible(false);
  };

  return (
    <>
      <View testID={testID} style={S.row}>
        <Pressable
          testID={`${testID}-previous`}
          accessibilityRole="button"
          accessibilityLabel="上一个库存月份"
          accessibilityState={{ disabled: !canGoPrevious }}
          disabled={!canGoPrevious}
          onPress={() => changeBy(-1)}
          style={({ pressed }) => [S.arrow, {
            backgroundColor: colors.border + "55",
            opacity: !canGoPrevious ? 0.32 : pressed ? 0.55 : 1,
          }]}
        >
          <IconSymbol name="chevron.left" size={15} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-picker`}
          accessibilityRole="button"
          accessibilityLabel={`选择库存月份，当前${inventoryMonthLabel(month)}`}
          onPress={() => setPickerVisible(true)}
          style={({ pressed }) => [S.monthButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[S.monthText, { color: colors.foreground }]}>{inventoryMonthLabel(month)}</Text>
          <IconSymbol name="chevron.down" size={14} color={colors.muted} />
        </Pressable>

        <Pressable
          testID={`${testID}-next`}
          accessibilityRole="button"
          accessibilityLabel="下一个库存月份"
          accessibilityState={{ disabled: !canGoNext }}
          disabled={!canGoNext}
          onPress={() => changeBy(1)}
          style={({ pressed }) => [S.arrow, {
            backgroundColor: colors.border + "55",
            opacity: !canGoNext ? 0.32 : pressed ? 0.55 : 1,
          }]}
        >
          <IconSymbol name="chevron.right" size={15} color={colors.muted} />
        </Pressable>
      </View>

      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={S.backdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={[S.sheet, { backgroundColor: colors.background }]} onPress={() => undefined}>
            <View style={[S.handle, { backgroundColor: colors.border }]} />
            <View style={S.sheetHeader}>
              <Text style={[S.sheetTitle, { color: colors.foreground }]}>选择库存月份</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭月份选择" onPress={() => setPickerVisible(false)} hitSlop={10}>
                <Text style={[S.closeText, { color: colors.muted }]}>关闭</Text>
              </Pressable>
            </View>

            <View style={S.yearRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="上一年"
                accessibilityState={{ disabled: !canGoPreviousYear }}
                disabled={!canGoPreviousYear}
                onPress={() => setPickerYear((year) => year - 1)}
                style={({ pressed }) => [S.yearArrow, { backgroundColor: colors.border + "55", opacity: !canGoPreviousYear ? 0.3 : pressed ? 0.55 : 1 }]}
              >
                <IconSymbol name="chevron.left" size={15} color={colors.muted} />
              </Pressable>
              <Text style={[S.yearText, { color: colors.foreground }]}>{pickerYear}年</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="下一年"
                accessibilityState={{ disabled: !canGoNextYear }}
                disabled={!canGoNextYear}
                onPress={() => setPickerYear((year) => year + 1)}
                style={({ pressed }) => [S.yearArrow, { backgroundColor: colors.border + "55", opacity: !canGoNextYear ? 0.3 : pressed ? 0.55 : 1 }]}
              >
                <IconSymbol name="chevron.right" size={15} color={colors.muted} />
              </Pressable>
            </View>

            <View style={S.monthGrid}>
              {Array.from({ length: 12 }, (_, index) => {
                const candidate = `${pickerYear}-${String(index + 1).padStart(2, "0")}` as InventoryMonth;
                const enabled = selectableMonths.includes(candidate);
                const active = candidate === month;
                return (
                  <TouchableOpacity
                    key={candidate}
                    testID={`${testID}-month-${candidate}`}
                    disabled={!enabled}
                    activeOpacity={0.72}
                    onPress={() => select(candidate)}
                    style={[S.monthCell, {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: enabled ? 1 : 0.28,
                    }]}
                  >
                    <Text style={[S.monthCellText, { color: active ? "#fff" : colors.foreground }]}>{index + 1}月</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {canReturnToCurrent && (
              <TouchableOpacity onPress={() => select(currentNaturalMonth)} activeOpacity={0.75} style={[S.currentButton, { borderColor: colors.primary, backgroundColor: colors.primary + "12" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>回到本月：{inventoryMonthLabel(currentNaturalMonth)}</Text>
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
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  closeText: { fontSize: 15, fontWeight: "600" },
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 18 },
  yearArrow: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  yearText: { minWidth: 90, textAlign: "center", fontSize: 16, fontWeight: "700" },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  monthCell: { width: "22.8%", minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  monthCellText: { fontSize: 14, fontWeight: "600" },
  currentButton: { minHeight: 42, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 20 },
});

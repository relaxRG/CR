/**
 * 期初库存录入 Modal 通用组件
 * 功能：
 * 1. 首月手动填写期初库存量和单位成本
 * 2. 有上月快照时自动带入，允许人工修改
 * 3. 保存后更新商品当前库存
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { GenericInventoryContextValue } from "@/lib/inventory-core/store";
import { getCurrentMonth, getPrevMonth } from "@/lib/inventory-core/types";

interface Props {
  visible: boolean;
  onClose: () => void;
  store: GenericInventoryContextValue;
  categoryLabel: string;
  accentColor: string;
  /** 目标月份，默认当前月 */
  targetMonth?: string;
}

export function OpeningStockModal({ visible, onClose, store, categoryLabel, accentColor, targetMonth }: Props) {
  const colors = useColors();
  const month = targetMonth ?? getCurrentMonth();
  const prevMonth = getPrevMonth(month);

  // 检查上月快照
  const lastSnapshot = useMemo(() => store.getSnapshotByMonth(prevMonth), [store, prevMonth]);
  const hasLastSnapshot = !!lastSnapshot;

  // 期初数据（qty + unitCost）
  const [openingData, setOpeningData] = useState<Record<string, { qty: string; unitCost: string }>>({});
  // 仅在打开/月份/库存快照切换时初始化；Provider命令引用变化不应重置用户正在录入的期初数据。
  const getOpeningDataRef = useRef(store.getOpeningData);
  getOpeningDataRef.current = store.getOpeningData;

  // 初始化：从上月快照自动带入，或使用当前库存
  useEffect(() => {
    if (!visible) return;
    const initial: Record<string, { qty: string; unitCost: string }> = {};
    store.items.filter((i) => i.active).forEach((item) => {
      if (hasLastSnapshot) {
        const data = getOpeningDataRef.current(item.id, month);
        initial[item.id] = {
          qty: String(data.qty),
          unitCost: String(data.unitCost || item.latestCostPrice),
        };
      } else {
        initial[item.id] = {
          qty: String(item.currentStock),
          unitCost: String(item.latestCostPrice),
        };
      }
    });
    setOpeningData(initial);
  }, [visible, store.items, hasLastSnapshot, month]);

  const handleSave = useCallback(() => {
    // 将期初数据保存为一个特殊的"期初快照"（month 格式：YYYY-MM-opening）
    // 实际上通过更新 items 的 currentStock 来反映期初状态
    store.items.filter((i) => i.active).forEach((item) => {
      const data = openingData[item.id];
      if (!data) return;
      const qty = Number(data.qty) || 0;
      const unitCost = Number(data.unitCost) || 0;
      store.updateItem(item.id, {
        currentStock: qty,
        latestCostPrice: unitCost > 0 ? unitCost : item.latestCostPrice,
      });
    });
    onClose();
  }, [openingData, store, onClose]);

  const activeItems = store.items.filter((i) => i.active);
  const totalOpeningCost = useMemo(() => {
    return activeItems.reduce((s, item) => {
      const data = openingData[item.id];
      if (!data) return s;
      return s + (Number(data.qty) || 0) * (Number(data.unitCost) || 0);
    }, 0);
  }, [activeItems, openingData]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[S.title, { color: colors.foreground }]}>{month} 期初录入</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>{categoryLabel}</Text>
            </View>
            <Pressable onPress={handleSave}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: accentColor }}>保存</Text>
            </Pressable>
          </View>

          {/* 提示 */}
          <View style={[S.hint, {
            backgroundColor: hasLastSnapshot ? accentColor + "0a" : colors.warning + "0a",
            borderColor: hasLastSnapshot ? accentColor + "22" : colors.warning + "22",
          }]}>
            <Text style={{ fontSize: 12, color: hasLastSnapshot ? accentColor : colors.warning }}>
              {hasLastSnapshot
                ? `✅ 已从 ${prevMonth} 月结自动带入期末数据，可人工修改`
                : `📝 首次录入，请手动填写 ${month} 月初实际库存量和单位成本`}
            </Text>
          </View>

          {/* 汇总 */}
          <View style={[S.summary, { backgroundColor: accentColor + "08", borderColor: accentColor + "22" }]}>
            <Text style={{ fontSize: 12, color: colors.muted }}>期初库存总成本</Text>
            <Text style={{ fontSize: 20, fontWeight: "700", color: accentColor }}>¥{totalOpeningCost.toFixed(0)}</Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {activeItems.map((item) => {
              const data = openingData[item.id] ?? { qty: "0", unitCost: "0" };
              const cost = (Number(data.qty) || 0) * (Number(data.unitCost) || 0);
              return (
                <View key={item.id} style={[S.itemRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    {item.spec ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.spec}</Text> : null}
                    {cost > 0 && <Text style={{ fontSize: 11, color: accentColor }}>成本：¥{cost.toFixed(2)}</Text>}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 10, color: colors.muted }}>数量</Text>
                      <TextInput
                        value={data.qty}
                        onChangeText={(v) => setOpeningData((prev) => ({ ...prev, [item.id]: { ...prev[item.id], qty: v } }))}
                        keyboardType="decimal-pad"
                        style={[S.input, { color: colors.foreground, borderColor: colors.border }]}
                      />
                      <Text style={{ fontSize: 10, color: colors.muted }}>{item.unit}</Text>
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ fontSize: 10, color: colors.muted }}>单位成本</Text>
                      <TextInput
                        value={data.unitCost}
                        onChangeText={(v) => setOpeningData((prev) => ({ ...prev, [item.id]: { ...prev[item.id], unitCost: v } }))}
                        keyboardType="decimal-pad"
                        style={[S.input, { color: colors.foreground, borderColor: colors.border }]}
                      />
                      <Text style={{ fontSize: 10, color: colors.muted }}>元/{item.unit}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  hint: { margin: 16, borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 8 },
  summary: { marginHorizontal: 16, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center", marginBottom: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  input: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15, textAlign: "center", minWidth: 64 },
});

/**
 * 月结 Modal 通用组件
 * 功能：
 * 1. 展示本月台账汇总（期初/进货/消耗/期末）
 * 2. 支持人工修改期末库存量（盘点调整）
 * 3. 确认月结后生成 MonthlySnapshot，期末自动带入下月期初
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { GenericInventoryItem, GenericInventoryContextValue } from "@/lib/inventory-core/store";
import {
  MonthlyLedgerItem, MonthlySnapshot,
  calcClosingUnitCost, calcClosingQty, getCurrentMonth
} from "@/lib/inventory-core/types";

interface Props {
  visible: boolean;
  onClose: () => void;
  store: GenericInventoryContextValue;
  categoryId: string;
  categoryLabel: string;
  accentColor: string;
  /** 是否显示损耗列 */
  showLoss?: boolean;
  /** 自定义分类标签获取函数 */
  getCategoryLabel?: (item: GenericInventoryItem) => string;
}

export function MonthCloseModal({
  visible, onClose, store, categoryId, categoryLabel, accentColor, showLoss = false, getCategoryLabel
}: Props) {
  const colors = useColors();
  const currentMonth = getCurrentMonth();

  // 构建本月台账数据
  const ledgerItems = useMemo((): (MonthlyLedgerItem & { _manualClose?: number })[] => {
    const purchases = store.getMonthPurchases(currentMonth);
    const consumes = store.getMonthConsumes(currentMonth);

    return store.items.filter((i) => i.active).map((item) => {
      const opening = store.getOpeningData(item.id, currentMonth);
      const itemPurchases = purchases.filter((p) => p.itemId === item.id);
      const itemConsumes = consumes.filter((c) => c.itemId === item.id);
      const itemLosses = consumes.filter((c) => c.itemId === item.id && c.reason === "loss");

      const purchaseQty = itemPurchases.reduce((s, p) => s + p.quantity, 0);
      const purchaseCost = itemPurchases.reduce((s, p) => s + p.totalAmount, 0);
      const consumeQty = itemConsumes.filter((c) => c.reason !== "loss").reduce((s, c) => s + c.quantity, 0);
      const consumeCost = itemConsumes.filter((c) => c.reason !== "loss").reduce((s, c) => s + c.totalCost, 0);
      const lossQty = itemLosses.reduce((s, c) => s + c.quantity, 0);
      const lossCost = itemLosses.reduce((s, c) => s + c.totalCost, 0);

      const closingUnitCost = calcClosingUnitCost(opening.qty, opening.unitCost, purchaseQty, purchaseCost);
      const closingQty = calcClosingQty(opening.qty, purchaseQty, consumeQty, lossQty);

      return {
        itemId: item.id,
        name: item.name,
        nameEn: item.nameEn,
        category: getCategoryLabel ? getCategoryLabel(item) : item.category,
        spec: item.spec,
        unit: item.unit,
        openingQty: opening.qty,
        openingUnitCost: opening.unitCost,
        openingCost: opening.qty * opening.unitCost,
        purchaseQty,
        purchaseCost,
        consumeQty,
        consumeCost,
        lossQty,
        lossCost,
        closingQty,
        closingUnitCost,
        closingCost: closingQty * closingUnitCost,
        notes: "",
      };
    });
  }, [store, currentMonth, getCategoryLabel]);

  // 人工调整期末库存（盘点）
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});

  const getFinalClosingQty = useCallback((item: MonthlyLedgerItem) => {
    const adj = adjustments[item.itemId];
    if (adj !== undefined && adj !== "") return Number(adj) || 0;
    return item.closingQty;
  }, [adjustments]);

  const totalPurchaseCost = useMemo(() => ledgerItems.reduce((s, i) => s + i.purchaseCost, 0), [ledgerItems]);
  const totalConsumeCost = useMemo(() => ledgerItems.reduce((s, i) => s + i.consumeCost, 0), [ledgerItems]);
  const totalLossCost = useMemo(() => ledgerItems.reduce((s, i) => s + i.lossCost, 0), [ledgerItems]);
  const totalClosingCost = useMemo(() => ledgerItems.reduce((s, i) => {
    const qty = getFinalClosingQty(i);
    return s + qty * i.closingUnitCost;
  }, 0), [ledgerItems, getFinalClosingQty]);

  const handleConfirm = () => {
    Alert.alert(
      "确认月结",
      `确认完成 ${currentMonth} 月结？\n期末库存将自动带入下月期初。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认月结",
          onPress: () => {
            const finalItems: MonthlyLedgerItem[] = ledgerItems.map((item) => {
              const finalQty = getFinalClosingQty(item);
              return {
                ...item,
                closingQty: finalQty,
                closingCost: finalQty * item.closingUnitCost,
              };
            });

            const snapshot: Omit<MonthlySnapshot, "id" | "createdAt"> = {
              month: currentMonth,
              category: categoryId,
              items: finalItems,
              totalPurchaseCost,
              totalConsumeCost,
              totalClosingCost,
              totalLossCost,
              notes: "",
            };

            store.addSnapshot(snapshot);
            // 同步更新各商品当前库存
            finalItems.forEach((item) => {
              store.updateItem(item.itemId, { currentStock: item.closingQty });
            });

            setAdjustments({});
            onClose();
            Alert.alert("月结完成", `${currentMonth} 月结已完成，期末库存已自动带入下月期初。`);
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[S.title, { color: colors.foreground }]}>{currentMonth} 月结</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>{categoryLabel}</Text>
            </View>
            <Pressable onPress={handleConfirm}>
              <Text style={{ fontSize: 17, fontWeight: "600", color: accentColor }}>确认月结</Text>
            </Pressable>
          </View>

          {/* 汇总卡片 */}
          <View style={[S.summary, { backgroundColor: accentColor + "0a", borderColor: accentColor + "22" }]}>
            {[
              { label: "本月进货总额", value: `¥${totalPurchaseCost.toFixed(0)}`, color: accentColor },
              { label: "本月消耗成本", value: `¥${totalConsumeCost.toFixed(0)}`, color: colors.warning },
              ...(showLoss ? [{ label: "本月损耗金额", value: `¥${totalLossCost.toFixed(0)}`, color: colors.error }] : []),
              { label: "期末库存成本", value: `¥${totalClosingCost.toFixed(0)}`, color: accentColor },
            ].map((item, i) => (
              <View key={i} style={{ alignItems: "center", flex: 1 }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{item.label}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: item.color }}>{item.value}</Text>
              </View>
            ))}
          </View>

          <View style={[S.hint, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "22", marginHorizontal: 16 }]}>
            <Text style={{ fontSize: 12, color: colors.warning }}>
              💡 期末库存量已根据期初+进货-消耗自动计算。如实际盘点有差异，可在下方手动修改。
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {ledgerItems.map((item) => {
              const finalQty = getFinalClosingQty(item);
              const hasAdj = adjustments[item.itemId] !== undefined && adjustments[item.itemId] !== "";
              return (
                <View key={item.itemId} style={[S.itemRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      期初 {item.openingQty} → 进货 +{item.purchaseQty} → 消耗 -{item.consumeQty}
                      {showLoss && item.lossQty > 0 ? ` → 损耗 -${item.lossQty}` : ""}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      系统期末：{item.closingQty} {item.unit} · 单位成本 ¥{item.closingUnitCost.toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 10, color: colors.muted }}>期末库存（可改）</Text>
                    <TextInput
                      value={adjustments[item.itemId] ?? String(item.closingQty)}
                      onChangeText={(v) => setAdjustments((prev) => ({ ...prev, [item.itemId]: v }))}
                      keyboardType="decimal-pad"
                      style={[S.adjInput, {
                        color: hasAdj ? accentColor : colors.foreground,
                        borderColor: hasAdj ? accentColor : colors.border,
                      }]}
                    />
                    <Text style={{ fontSize: 10, color: hasAdj ? accentColor : colors.muted }}>
                      {item.unit} {hasAdj ? "（已调整）" : ""}
                    </Text>
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
  summary: { flexDirection: "row", margin: 16, borderRadius: 12, borderWidth: 1, padding: 12 },
  hint: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  adjInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, fontSize: 16, fontWeight: "700", textAlign: "center", minWidth: 60 },
});

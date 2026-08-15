/**
 * 日用品进销存独立页面
 * 特点：SKU 多，高频消耗，按场所分组，批量快速录入，关联备用金 D 类
 */
import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useDailyInventoryStore, DAILY_CATEGORIES, DAILY_EXCEL_HINT, parseDailyExcel } from "@/lib/daily/inventory-store";
import { GenericInventoryItem, GenericInventoryContextValue } from "@/lib/inventory-core/store";

const DAILY_COLOR = "#F59E0B";

function getGroupLabel(item: GenericInventoryItem): string {
  const c = DAILY_CATEGORIES.find((g) => g.value === item.category);
  return c?.label ?? "其他";
}

// ─── 批量快速录入 Modal（日用品专用）─────────────────────────────────────────
function BatchEntryModal({ visible, store, onClose }: {
  visible: boolean; store: GenericInventoryContextValue; onClose: () => void;
}) {
  const colors = useColors();
  const activeItems = store.items.filter((i) => i.active);
  const [entries, setEntries] = useState<Record<string, { qty: string; price: string }>>({});
  const [mode, setMode] = useState<"in" | "out">("in");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const total = activeItems.reduce((s, item) => {
    const e = entries[item.id];
    if (!e?.qty || Number(e.qty) <= 0) return s;
    return s + (Number(e.qty) || 0) * (Number(e.price) || item.latestCostPrice || 0);
  }, 0);

  const handleSave = () => {
    const toSave = activeItems.filter((item) => {
      const e = entries[item.id];
      return e?.qty && Number(e.qty) > 0;
    });
    if (toSave.length === 0) { Alert.alert("请至少填写一项数量"); return; }

    toSave.forEach((item) => {
      const e = entries[item.id]!;
      const qty = Number(e.qty);
      const price = Number(e.price) || item.latestCostPrice || 0;
      if (mode === "in") {
        store.addPurchase({ itemId: item.id, itemName: item.name, quantity: qty, unitPrice: price, totalAmount: qty * price, supplier: item.supplier, date, notes: "" });
      } else {
        store.addConsume({ itemId: item.id, itemName: item.name, quantity: qty, unitCost: price, totalCost: qty * price, reason: "normal", date, notes: "" });
      }
    });

    setEntries({});
    onClose();
    Alert.alert("保存成功", `已批量${mode === "in" ? "入库" : "出库"} ${toSave.length} 项`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>批量{mode === "in" ? "入库" : "出库"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: DAILY_COLOR }}>保存</Text></Pressable>
          </View>

          {/* 模式切换 */}
          <View style={{ flexDirection: "row", margin: 12, gap: 8 }}>
            {(["in", "out"] as const).map((m) => (
              <TouchableOpacity key={m} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => setMode(m)} style={[S.modeBtn, {
                backgroundColor: mode === m ? (m === "in" ? DAILY_COLOR : colors.error) : colors.surface,
                borderColor: mode === m ? (m === "in" ? DAILY_COLOR : colors.error) : colors.border,
              }]}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: mode === m ? "#fff" : colors.muted }}>
                  {m === "in" ? "📦 批量入库" : "📤 批量出库"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 日期 */}
          <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
          </View>

          {/* 合计 */}
          {total > 0 && (
            <View style={[S.totalRow, { backgroundColor: DAILY_COLOR + "0a", marginHorizontal: 12, marginBottom: 8 }]}>
              <Text style={{ fontSize: 13, color: colors.muted }}>本次合计</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: DAILY_COLOR }}>¥{formatMoney(total)}</Text>
            </View>
          )}

          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 6 }}>
            {activeItems.map((item) => {
              const e = entries[item.id] ?? { qty: "", price: String(item.latestCostPrice || "") };
              const hasQty = e.qty && Number(e.qty) > 0;
              return (
                <View key={item.id} style={[S.batchRow, {
                  backgroundColor: hasQty ? DAILY_COLOR + "0a" : colors.surface,
                  borderColor: hasQty ? DAILY_COLOR : colors.border,
                }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>库存 {item.currentStock}{item.unit}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <TextInput
                      value={e.qty}
                      onChangeText={(v) => setEntries((prev) => ({ ...prev, [item.id]: { ...prev[item.id] ?? { price: String(item.latestCostPrice || "") }, qty: v } }))}
                      placeholder="数量"
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={[S.batchInput, { color: colors.foreground, borderColor: hasQty ? DAILY_COLOR : colors.border }]}
                    />
                    <Text style={{ fontSize: 11, color: colors.muted }}>{item.unit}</Text>
                    <TextInput
                      value={e.price}
                      onChangeText={(v) => setEntries((prev) => ({ ...prev, [item.id]: { ...prev[item.id] ?? { qty: "" }, price: v } }))}
                      placeholder="单价"
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={[S.batchInput, { color: colors.foreground, borderColor: colors.border }]}
                    />
                    <Text style={{ fontSize: 11, color: colors.muted }}>元</Text>
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

export interface DailyInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function DailyInventoryScreen({ month, embedded = false }: DailyInventoryScreenProps) {
  const store = useDailyInventoryStore();
  const [showBatch, setShowBatch] = useState(false);

  return (
    <>
      <BaseInventoryScreen
        store={store}
        title="日用品进销存"
        emoji="🧴"
        accentColor={DAILY_COLOR}
        categoryId="daily"
        categoryLabel="日用品"
        pettyHint="D 类（日用耗材）"
        categoryOptions={DAILY_CATEGORIES.map((c) => ({ value: c.value, label: c.label, color: c.color }))}
        defaultUnit="个"
        getGroupLabel={getGroupLabel}
        parseExcel={parseDailyExcel}
        excelFormatHint={DAILY_EXCEL_HINT}
        month={month}
        embedded={embedded}
        extraTabs={[{ key: "batch", label: "批量录入" }]}
        renderExtraTabContent={(tab) => {
          if (tab !== "batch") return null;
          return (
            <View style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setShowBatch(true)}
                style={{ backgroundColor: DAILY_COLOR, borderRadius: 12, padding: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>⚡ 批量入库/出库</Text>
              </TouchableOpacity>
              <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: DAILY_COLOR + "33", backgroundColor: DAILY_COLOR + "08" }}>
                <Text style={{ fontSize: 12, color: "#888" }}>
                  💡 批量录入适合每周采购后一次性录入多个日用品的进货情况，效率更高
                </Text>
              </View>
            </View>
          );
        }}
      />
      <BatchEntryModal visible={showBatch} store={store} onClose={() => setShowBatch(false)} />
    </>
  );
}

const S = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  modeBtn: { flex: 1, minHeight: 44, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  totalRow: { borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  batchRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 10, gap: 8 },
  batchInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, textAlign: "center", width: 60 },
});

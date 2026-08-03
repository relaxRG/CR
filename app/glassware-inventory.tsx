/**
 * 杯具进销存独立页面
 * 特点：按杯型分组，损耗录入是核心，低频进货，关联备用金 C 类
 */
import React, { useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useGlasswareInventoryStore, GLASSWARE_TYPES, GLASSWARE_EXCEL_HINT, parseGlasswareExcel } from "@/lib/glassware/inventory-store";
import { GenericInventoryItem, GenericInventoryContextValue } from "@/lib/inventory-core/store";

const GLASS_COLOR = "#6366F1";

function getGroupLabel(item: GenericInventoryItem): string {
  const t = GLASSWARE_TYPES.find((g) => g.value === item.category);
  return t?.label ?? "其他杯具";
}

// ─── 损耗录入 Modal（杯具专用）────────────────────────────────────────────────
function LossEntryModal({ visible, store, onClose }: {
  visible: boolean; store: GenericInventoryContextValue; onClose: () => void;
}) {
  const colors = useColors();
  const [selectedItemId, setSelectedItemId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const activeItems = store.items.filter((i) => i.active);
  const selectedItem = activeItems.find((i) => i.id === selectedItemId);

  const LOSS_REASONS = ["正常使用损耗", "意外打碎", "盘点差异", "其他"];

  const handleSave = () => {
    if (!selectedItemId) { Alert.alert("请选择杯具"); return; }
    if (!qty || Number(qty) <= 0) { Alert.alert("请填写损耗数量"); return; }
    const qtyNum = Number(qty);
    const unitCost = selectedItem?.latestCostPrice ?? 0;
    store.addConsume({
      itemId: selectedItemId,
      itemName: selectedItem?.name ?? "",
      quantity: qtyNum,
      unitCost,
      totalCost: qtyNum * unitCost,
      reason: "loss",
      lossReason: reason,
      date,
      notes: reason,
    });
    setSelectedItemId(""); setQty(""); setReason(""); onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>损耗录入</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.error }}>记录</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View style={[S.hint, { backgroundColor: colors.error + "0a", borderColor: colors.error + "22" }]}>
              <Text style={{ fontSize: 12, color: colors.error }}>⚠️ 记录杯具破损、丢失等损耗情况，用于月度损耗率统计</Text>
            </View>
            {/* 选择杯具 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>选择杯具 *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {activeItems.map((item) => (
                    <TouchableOpacity key={item.id} onPress={() => setSelectedItemId(item.id)}
                      style={[S.chip, {
                        backgroundColor: selectedItemId === item.id ? colors.error : colors.surface,
                        borderColor: selectedItemId === item.id ? colors.error : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, color: selectedItemId === item.id ? "#fff" : colors.foreground }}>{item.name}</Text>
                      <Text style={{ fontSize: 10, color: selectedItemId === item.id ? "#ffffffaa" : colors.muted }}>库存 {item.currentStock}个</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            {/* 损耗数量 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>损耗数量（个）*</Text>
              <TextInput value={qty} onChangeText={setQty} placeholder="0"
                placeholderTextColor={colors.muted} keyboardType="number-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
            {/* 损耗原因 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>损耗原因</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {LOSS_REASONS.map((r) => (
                  <TouchableOpacity key={r} onPress={() => setReason(r)}
                    style={[S.chip, {
                      backgroundColor: reason === r ? colors.error : colors.surface,
                      borderColor: reason === r ? colors.error : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, color: reason === r ? "#fff" : colors.muted }}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput value={reason} onChangeText={setReason} placeholder="或手动输入原因"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border, marginTop: 8 }]} />
            </View>
            {/* 日期 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>日期</Text>
              <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
            {/* 损耗金额预览 */}
            {selectedItem && Number(qty) > 0 && (
              <View style={[S.totalRow, { backgroundColor: colors.error + "0a" }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>损耗金额</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.error }}>
                  ¥{(Number(qty) * (selectedItem.latestCostPrice || 0)).toFixed(2)}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function GlasswareInventoryScreen() {
  const store = useGlasswareInventoryStore();
  const [showLoss, setShowLoss] = useState(false);

  return (
    <>
      <BaseInventoryScreen
        store={store}
        title="杯具进销存"
        emoji="🥂"
        accentColor={GLASS_COLOR}
        categoryId="glassware"
        categoryLabel="杯具"
        pettyHint="C 类（杯具耗材）"
        showLoss={true}
        categoryOptions={GLASSWARE_TYPES.map((t) => ({ value: t.value, label: t.label, color: t.color }))}
        defaultUnit="个"
        getGroupLabel={getGroupLabel}
        parseExcel={parseGlasswareExcel}
        excelFormatHint={GLASSWARE_EXCEL_HINT}
        extraTabs={[{ key: "loss", label: "损耗记录" }]}
        renderExtraTabContent={(tab) => {
          if (tab !== "loss") return null;
          const lossRecords = store.consumes.filter((c) => c.reason === "loss");
          const colors_inner = { muted: "#888" };
          return (
            <View style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setShowLoss(true)}
                style={{ backgroundColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>⚠️ 录入损耗</Text>
              </TouchableOpacity>
              {lossRecords.length === 0 ? (
                <Text style={{ textAlign: "center", padding: 20, color: "#888" }}>暂无损耗记录</Text>
              ) : (
                lossRecords.map((r) => (
                  <View key={r.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#EF444433", backgroundColor: "#FEF2F2", padding: 12, flexDirection: "row", justifyContent: "space-between" }}>
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: "#1F2937" }}>{r.itemName}</Text>
                      <Text style={{ fontSize: 12, color: "#888" }}>{r.date} · {r.lossReason || "损耗"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#EF4444" }}>-{r.quantity} 个</Text>
                      <Text style={{ fontSize: 12, color: "#888" }}>¥{r.totalCost.toFixed(2)}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          );
        }}
      />
      <LossEntryModal visible={showLoss} store={store} onClose={() => setShowLoss(false)} />
    </>
  );
}

const S = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", minWidth: 80 },
  hint: { borderRadius: 8, borderWidth: 1, padding: 10 },
  totalRow: { borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});

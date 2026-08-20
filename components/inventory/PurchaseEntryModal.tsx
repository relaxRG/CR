/**
 * 通用进货录入 Modal
 * 支持：选择商品 → 填写数量/单价 → 保存
 * 各品类通过 props 定制颜色、提示文案、备用金关联提示
 */
import React, { useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { GenericInventoryContextValue } from "@/lib/inventory-core/store";

interface Props {
  visible: boolean;
  onClose: () => void;
  store: GenericInventoryContextValue;
  accentColor: string;
  /** 备用金关联提示（如 "B1 酒水现结"） */
  pettyHint?: string;
  /** 预选商品 ID */
  preselectedItemId?: string;
  /** 操作类型：in=进货入库, out=出库消耗 */
  mode?: "in" | "out";
}

export function PurchaseEntryModal({ visible, onClose, store, accentColor, pettyHint, preselectedItemId, mode = "in" }: Props) {
  const colors = useColors();
  const [selectedItemId, setSelectedItemId] = useState(preselectedItemId ?? "");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const activeItems = store.items.filter((i) => i.active);
  const selectedItem = activeItems.find((i) => i.id === selectedItemId) ?? null;
  const total = (Number(qty) || 0) * (Number(unitPrice) || 0);

  React.useEffect(() => {
    if (visible) {
      setSelectedItemId(preselectedItemId ?? "");
      setQty("");
      setUnitPrice(selectedItem ? String(selectedItem.latestCostPrice) : "");
      setSupplier(selectedItem?.supplier ?? "");
      setNotes("");
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [visible, preselectedItemId]);

  React.useEffect(() => {
    if (selectedItem) {
      setUnitPrice(String(selectedItem.latestCostPrice || ""));
      setSupplier(selectedItem.supplier ?? "");
    }
  }, [selectedItemId]);

  const handleSave = () => {
    if (!selectedItemId) { Alert.alert("请选择商品"); return; }
    if (!qty || Number(qty) <= 0) { Alert.alert("请填写数量"); return; }

    const qtyNum = Number(qty);
    const priceNum = Number(unitPrice) || 0;
    const today = date || new Date().toISOString().slice(0, 10);

    if (mode === "in") {
      store.addPurchase({
        itemId: selectedItemId,
        itemName: selectedItem?.name ?? "",
        quantity: qtyNum,
        unitPrice: priceNum,
        totalAmount: qtyNum * priceNum,
        supplier: supplier.trim(),
        date: today,
        notes: notes.trim(),
      });
    } else {
      store.addConsume({
        itemId: selectedItemId,
        itemName: selectedItem?.name ?? "",
        quantity: qtyNum,
        unitCost: priceNum,
        totalCost: qtyNum * priceNum,
        reason: "normal",
        date: today,
        notes: notes.trim(),
      });
    }

    onClose();
  };

  const isIn = mode === "in";
  const actionLabel = isIn ? "入库" : "出库";
  const actionColor = isIn ? accentColor : colors.error;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>{actionLabel}录入</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: actionColor }}>保存</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {/* 商品选择 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>选择商品 *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {activeItems.map((item) => (
                    <TouchableOpacity key={item.id} onPress={() => setSelectedItemId(item.id)}
                      style={[S.chip, {
                        backgroundColor: selectedItemId === item.id ? accentColor : colors.surface,
                        borderColor: selectedItemId === item.id ? accentColor : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, color: selectedItemId === item.id ? "#fff" : colors.foreground, fontWeight: "500" }}>
                        {item.name}
                      </Text>
                      <Text style={{ fontSize: 10, color: selectedItemId === item.id ? "#ffffffaa" : colors.muted }}>
                        库存 {item.currentStock}{item.unit}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {selectedItem && (
              <View style={[S.infoCard, { backgroundColor: accentColor + "0a", borderColor: accentColor + "22" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: accentColor }}>{selectedItem.name}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {selectedItem.spec ? `${selectedItem.spec} · ` : ""}当前库存 {selectedItem.currentStock} {selectedItem.unit}
                  {isIn ? ` · 最近进价 ¥${selectedItem.latestCostPrice}` : ""}
                </Text>
              </View>
            )}

            {/* 数量 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>数量（{selectedItem?.unit ?? "单位"}）*</Text>
              <TextInput value={qty} onChangeText={setQty} placeholder="0"
                placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            {/* 单价（出库时为成本价，可选） */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>{isIn ? "进货单价" : "单位成本"}（元/{selectedItem?.unit ?? "单位"}）</Text>
              <TextInput value={unitPrice} onChangeText={setUnitPrice} placeholder="0.00"
                placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            {/* 合计 */}
            {total > 0 && (
              <View style={[S.totalRow, { backgroundColor: actionColor + "0a" }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>本次{isIn ? "进货" : "出库"}金额</Text>
                <Text style={{ fontSize: 20, fontWeight: "700", color: actionColor }}>¥{total.toFixed(2)}</Text>
              </View>
            )}

            {/* 供应商（仅入库） */}
            {isIn && (
              <View>
                <Text style={[S.label, { color: colors.muted }]}>供应商</Text>
                <TextInput value={supplier} onChangeText={setSupplier} placeholder="可选"
                  placeholderTextColor={colors.muted}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            )}

            {/* 日期 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>日期</Text>
              <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            {/* 备用金提示 */}
            {isIn && pettyHint && (
              <View style={[S.pettyHint, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "22" }]}>
                <Text style={{ fontSize: 12, color: colors.warning }}>
                  💡 入库后请同时在备用金中录入 {pettyHint} 支出
                </Text>
              </View>
            )}

            {/* 备注 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="可选"
                placeholderTextColor={colors.muted} multiline numberOfLines={2}
                style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
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
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 60 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", minWidth: 80 },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  totalRow: { borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pettyHint: { borderRadius: 8, borderWidth: 1, padding: 10 },
});

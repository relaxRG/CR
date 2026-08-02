/**
 * 进销存系统（烈酒/葡萄酒/食材/设备/杯具餐具/日用品）
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useInventoryStore, InventoryCategory, INVENTORY_CATEGORY_LABELS, InventoryItem } from "@/lib/store/inventory-store";
import { IconSymbol } from "@/components/ui/icon-symbol";

const CATS: { key: InventoryCategory; label: string }[] = [
  { key: "spirit", label: "烈酒" },
  { key: "wine", label: "葡萄酒" },
  { key: "food", label: "食材" },
  { key: "equipment", label: "设备" },
  { key: "tableware", label: "杯具餐具" },
  { key: "daily", label: "日用品" },
];

function ItemCard({ item, onIn, onOut, onDelete }: {
  item: InventoryItem;
  onIn: () => void; onOut: () => void; onDelete: () => void;
}) {
  const colors = useColors();
  const lowStock = item.currentStock <= item.alertThreshold;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
          {[item.spec, item.supplier].filter(Boolean).join(" · ")}
        </Text>
        {lowStock && <Text style={[styles.alertText, { color: colors.error }]}>库存不足（预警线：{item.alertThreshold}）</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={[styles.stockNum, { color: lowStock ? colors.error : colors.foreground }]}>
          {item.currentStock} {item.unit}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={onIn} style={[styles.stockBtn, { backgroundColor: colors.success + "22" }]}>
            <IconSymbol name="plus" size={14} color={colors.success} />
          </Pressable>
          <Pressable onPress={onOut} style={[styles.stockBtn, { backgroundColor: colors.error + "22" }]}>
            <IconSymbol name="minus" size={14} color={colors.error} />
          </Pressable>
          <Pressable onPress={onDelete} style={[styles.stockBtn, { backgroundColor: colors.border }]}>
            <IconSymbol name="trash" size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function StoreInventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [cat, setCat] = usePersistedState<InventoryCategory>("store.inventory.cat.v1", "spirit");
  const { items, addItem, deleteItem, addTransaction } = useInventoryStore();
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSpec, setAddSpec] = useState("");
  const [addUnit, setAddUnit] = useState("瓶");
  const [addStock, setAddStock] = useState("0");
  const [addAlert, setAddAlert] = useState("5");
  const [addSupplier, setAddSupplier] = useState("");
  const [addCostPrice, setAddCostPrice] = useState("");
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const filtered = useMemo(() => items.filter((i) => i.category === cat), [items, cat]);
  const lowStockCount = filtered.filter((i) => i.currentStock <= i.alertThreshold).length;

  const handleAdd = () => {
    if (!addName.trim()) { Alert.alert("请输入名称"); return; }
    addItem({
      name: addName.trim(), category: cat, spec: addSpec.trim(), unit: addUnit.trim(),
      currentStock: parseInt(addStock) || 0, alertThreshold: parseInt(addAlert) || 0,
      costPrice: addCostPrice ? parseFloat(addCostPrice) : null,
      supplier: addSupplier.trim(), notes: "",
    });
    setAddName(""); setAddSpec(""); setAddUnit("瓶"); setAddStock("0"); setAddAlert("5"); setAddSupplier(""); setAddCostPrice("");
    setShowAdd(false);
  };

  const handleStockChange = (item: InventoryItem, delta: number) => {
    addTransaction({ itemId: item.id, type: delta > 0 ? "in" : "out", quantity: delta, date: new Date().toISOString().slice(0, 10), notes: "" });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 分类切换 */}
      <View style={{ backgroundColor: colors.background }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          {CATS.map((c) => (
            <Pressable key={c.key} onPress={() => { tap(); setCat(c.key); }}
              style={[styles.catChip, { backgroundColor: cat === c.key ? colors.primary : colors.surface, borderColor: cat === c.key ? colors.primary : colors.border }]}>
              <Text style={{ color: cat === c.key ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={[styles.countText, { color: colors.muted }]}>共 {filtered.length} 项</Text>
          {lowStockCount > 0 && (
            <View style={[styles.alertBadge, { backgroundColor: colors.error + "22" }]}>
              <Text style={[styles.alertBadgeText, { color: colors.error }]}>{lowStockCount} 项库存不足</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => { tap(); setShowAdd(true); }} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="plus" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            onIn={() => {
              Alert.prompt("入库", "入库数量", (v) => {
                const n = parseInt(v ?? "1");
                if (!isNaN(n) && n > 0) handleStockChange(item, n);
              }, "plain-text", "1", "number-pad");
            }}
            onOut={() => {
              Alert.prompt("出库", "出库数量", (v) => {
                const n = parseInt(v ?? "1");
                if (!isNaN(n) && n > 0) handleStockChange(item, -n);
              }, "plain-text", "1", "number-pad");
            }}
            onDelete={() => Alert.alert("删除", `确认删除「${item.name}」？`, [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteItem(item.id) }])}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <IconSymbol name="shippingbox" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无库存</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>点击右上角 + 添加</Text>
          </View>
        }
      />

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={() => setShowAdd(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>添加库存</Text>
            <Pressable onPress={handleAdd}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            {[
              { label: "名称 *", value: addName, onChange: setAddName, placeholder: "品名" },
              { label: "规格", value: addSpec, onChange: setAddSpec, placeholder: "如：750ml/瓶" },
              { label: "单位", value: addUnit, onChange: setAddUnit, placeholder: "瓶/kg/个" },
              { label: "当前库存", value: addStock, onChange: setAddStock, placeholder: "0", keyboardType: "number-pad" as const },
              { label: "预警线", value: addAlert, onChange: setAddAlert, placeholder: "5", keyboardType: "number-pad" as const },
              { label: "采购价（元）", value: addCostPrice, onChange: setAddCostPrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
              { label: "供应商", value: addSupplier, onChange: setAddSupplier, placeholder: "可选" },
            ].map((f) => (
              <View key={f.label}>
                <Text style={[styles.fieldLabel, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder} placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  keyboardType={(f as any).keyboardType} returnKeyType="next" />
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  countText: { fontSize: 13, marginRight: 8 },
  alertBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  alertBadgeText: { fontSize: 12, fontWeight: "600" },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  alertText: { fontSize: 12, marginTop: 4, fontWeight: "500" },
  stockNum: { fontSize: 18, fontWeight: "700" },
  stockBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});

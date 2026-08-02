/**
 * 采购清单（鸡尾酒 / 葡萄酒 / 餐食）
 * 支持供应商记录 + 自己采购（附链接一键跳转）
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useRouter } from "expo-router";

type PurchaseCat = "cocktail" | "wine" | "food";
type PurchaseType = "supplier" | "self";

export interface PurchaseItem {
  id: string;
  category: PurchaseCat;
  name: string;
  quantity: string;
  unit: string;
  supplier: string;
  purchaseType: PurchaseType;
  link: string;
  price: number | null;
  notes: string;
  done: boolean;
  createdAt: string;
}

const STORAGE_KEY = "store.purchase.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function usePurchaseStore() {
  const [items, setItems] = React.useState<PurchaseItem[]>([]);
  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { setItems(JSON.parse(raw)); } catch {} }
    });
  }, []);
  const save = (next: PurchaseItem[]) => {
    setItems(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  };
  const addItem = (data: Omit<PurchaseItem, "id" | "createdAt">) => {
    save([{ ...data, id: uuid(), createdAt: new Date().toISOString() }, ...items]);
  };
  const toggleDone = (id: string) => save(items.map((i) => i.id === id ? { ...i, done: !i.done } : i));
  const deleteItem = (id: string) => save(items.filter((i) => i.id !== id));
  return { items, addItem, toggleDone, deleteItem };
}

const CATS: { key: PurchaseCat; label: string }[] = [
  { key: "cocktail", label: "鸡尾酒" },
  { key: "wine", label: "葡萄酒" },
  { key: "food", label: "餐食" },
];

function AddSheet({ visible, category, onClose, onAdd }: {
  visible: boolean; category: PurchaseCat; onClose: () => void;
  onAdd: (data: Omit<PurchaseItem, "id" | "createdAt">) => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchaseType, setPurchaseType] = useState<PurchaseType>("supplier");
  const [link, setLink] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => { setName(""); setQuantity(""); setUnit(""); setSupplier(""); setPurchaseType("supplier"); setLink(""); setPrice(""); setNotes(""); };

  const handleAdd = () => {
    if (!name.trim()) { Alert.alert("请输入品名"); return; }
    onAdd({ category, name: name.trim(), quantity: quantity.trim(), unit: unit.trim(), supplier: supplier.trim(), purchaseType, link: link.trim(), price: price ? parseFloat(price) : null, notes: notes.trim(), done: false });
    reset(); onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={() => { reset(); onClose(); }}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>添加采购</Text>
          <Pressable onPress={handleAdd}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          {[
            { label: "品名 *", value: name, onChange: setName, placeholder: "采购品名" },
            { label: "数量", value: quantity, onChange: setQuantity, placeholder: "如：2瓶" },
            { label: "单位", value: unit, onChange: setUnit, placeholder: "如：瓶、kg、箱" },
            { label: "参考价（元）", value: price, onChange: setPrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
            { label: "备注", value: notes, onChange: setNotes, placeholder: "可选" },
          ].map((f) => (
            <View key={f.label}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>{f.label}</Text>
              <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder} placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                keyboardType={(f as any).keyboardType} returnKeyType="next" />
            </View>
          ))}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>采购方式</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["supplier", "self"] as PurchaseType[]).map((t) => (
                <Pressable key={t} onPress={() => setPurchaseType(t)}
                  style={[styles.typeBtn, { borderColor: purchaseType === t ? colors.primary : colors.border, backgroundColor: purchaseType === t ? colors.primary + "22" : colors.surface }]}>
                  <Text style={{ color: purchaseType === t ? colors.primary : colors.muted, fontWeight: "600" }}>
                    {t === "supplier" ? "供应商" : "自己采购"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {purchaseType === "supplier" ? (
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>供应商</Text>
              <TextInput value={supplier} onChangeText={setSupplier} placeholder="供应商名称" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" />
            </View>
          ) : (
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>购买链接</Text>
              <TextInput value={link} onChangeText={setLink} placeholder="https://..." placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                keyboardType="url" autoCapitalize="none" returnKeyType="done" />
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function StorePurchaseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [cat, setCat] = usePersistedState<PurchaseCat>("store.purchase.cat.v1", "cocktail");
  const [showAdd, setShowAdd] = useState(false);
  const { items, addItem, toggleDone, deleteItem } = usePurchaseStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const router = useRouter();

  const filtered = useMemo(() => items.filter((i) => i.category === cat), [items, cat]);
  const pending = filtered.filter((i) => !i.done);
  const done = filtered.filter((i) => i.done);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[styles.segContainer, { backgroundColor: colors.border + "55", flex: 1 }]}>
            {CATS.map((item) => {
              const active = cat === item.key;
              return (
                <Pressable key={item.key} onPress={() => { tap(); setCat(item.key); }}
                  style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}>
                  <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginLeft: 10 }}>
            {/* 供应商 Excel 导入 */}
            <Pressable onPress={() => { tap(); router.push("/supplier-import" as any); }}
              style={[styles.addBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
              <IconSymbol name="square.and.arrow.down.fill" size={16} color={colors.primary} />
            </Pressable>
            <Pressable onPress={() => { tap(); setShowAdd(true); }} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="plus" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
        {/* 供应商导入提示条 */}
        <Pressable onPress={() => { tap(); router.push("/supplier-import" as any); }}
          style={[styles.importBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
          <IconSymbol name="tray.2.fill" size={14} color={colors.primary} />
          <Text style={[styles.importBannerText, { color: colors.primary }]}>
            导入供应商进货单（支持创略商贸 Excel 格式）
          </Text>
          <IconSymbol name="chevron.right" size={14} color={colors.primary} />
        </Pressable>
      </View>

      <FlatList
        data={[...pending, ...done]}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { tap(); toggleDone(item.id); }}
            onLongPress={() => Alert.alert("删除", `确认删除「${item.name}」？`, [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteItem(item.id) }])}
            style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
          >
            <View style={[styles.checkbox, { borderColor: item.done ? colors.success : colors.border, backgroundColor: item.done ? colors.success : "transparent" }]}>
              {item.done && <IconSymbol name="checkmark" size={12} color="#fff" />}
            </View>
            <View style={{ flex: 1, opacity: item.done ? 0.5 : 1 }}>
              <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
                {[item.quantity && item.unit ? `${item.quantity} ${item.unit}` : item.quantity,
                  item.purchaseType === "supplier" ? item.supplier : "自采",
                  item.price != null ? `¥${item.price}` : null
                ].filter(Boolean).join(" · ")}
              </Text>
            </View>
            {item.purchaseType === "self" && item.link ? (
              <Pressable onPress={() => Linking.openURL(item.link)} style={[styles.linkBtn, { backgroundColor: colors.primary + "22" }]}>
                <IconSymbol name="link" size={14} color={colors.primary} />
              </Pressable>
            ) : null}
          </Pressable>
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无采购项</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>点击右上角 + 添加</Text>
          </View>
        }
      />

      <AddSheet visible={showAdd} category={cat} onClose={() => setShowAdd(false)} onAdd={addItem} />
    </View>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  importBanner: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  importBannerText: { flex: 1, fontSize: 13, fontWeight: "500" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  linkBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
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
  typeBtn: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});

/**
 * 食材进销存独立页面
 * 特点：打通 lib/food/ingredient-store 档案，按食材类别分组，
 * 价格波动追踪，月度台账，关联备用金 A1-A4
 * 注意：不关联鸡尾酒原料库
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useFoodIngredientStore } from "@/lib/food/ingredient-store";
import { FoodIngredient, INGREDIENT_CATEGORY_LABELS, IngredientCategory } from "@/lib/food/types";
import { getCurrentMonth, getPrevMonth } from "@/lib/inventory-core/types";

const FOOD_COLOR = "#10B981";
type Tab = "ledger" | "purchase" | "summary";

const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  "meat", "seafood", "vegetable", "fruit", "grain", "dairy", "spice", "sauce", "frozen", "other"
];

const CATEGORY_COLORS: Record<IngredientCategory, string> = {
  meat: "#EF4444",
  seafood: "#0EA5E9",
  vegetable: "#22C55E",
  fruit: "#F59E0B",
  grain: "#D97706",
  dairy: "#A78BFA",
  spice: "#EC4899",
  sauce: "#F97316",
  frozen: "#00BCD4",
  other: "#94A3B8",
};

// ─── 进货录入 Modal ───────────────────────────────────────────────────────────
function PurchaseModal({ visible, ingredients, colors, onSave, onClose }: {
  visible: boolean; ingredients: FoodIngredient[]; colors: any;
  onSave: (ingredientId: string, qty: number, price: number, supplier: string, notes: string) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const selected = ingredients.find((i) => i.id === selectedId);
  const total = (Number(qty) || 0) * (Number(price) || 0);

  React.useEffect(() => {
    if (selected) {
      setPrice(String(selected.costPrice ?? ""));
      setSupplier(selected.supplier ?? "");
    }
  }, [selectedId]);

  const handleSave = () => {
    if (!selectedId) { Alert.alert("请选择食材"); return; }
    if (!qty || Number(qty) <= 0) { Alert.alert("请填写数量"); return; }
    onSave(selectedId, Number(qty), Number(price) || 0, supplier, notes);
    setSelectedId(""); setQty(""); setPrice(""); setSupplier(""); setNotes("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>食材进货录入</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: FOOD_COLOR }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View>
              <Text style={[S.label, { color: colors.muted }]}>选择食材 *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {ingredients.map((item) => (
                    <TouchableOpacity key={item.id} onPress={() => setSelectedId(item.id)}
                      style={[S.chip, {
                        backgroundColor: selectedId === item.id ? FOOD_COLOR : colors.surface,
                        borderColor: selectedId === item.id ? FOOD_COLOR : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, color: selectedId === item.id ? "#fff" : colors.foreground }}>{item.name}</Text>
                      <Text style={{ fontSize: 10, color: selectedId === item.id ? "#ffffffaa" : colors.muted }}>库存 {item.stock}{item.unit}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            {selected && (
              <View style={[S.infoCard, { backgroundColor: FOOD_COLOR + "0a", borderColor: FOOD_COLOR + "22" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: FOOD_COLOR }}>{selected.name}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {selected.spec ? `${selected.spec} · ` : ""}当前库存 {selected.stock}{selected.unit}
                  {selected.costPrice ? ` · 上次进价 ¥${selected.costPrice}/${selected.unit}` : ""}
                </Text>
              </View>
            )}
            {[
              { label: `数量（${selected?.unit ?? "单位"}）*`, value: qty, onChange: setQty, placeholder: "0", kb: "decimal-pad" as const },
              { label: `进货单价（元/${selected?.unit ?? "单位"}）`, value: price, onChange: setPrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "可选" },
              { label: "日期", value: date, onChange: setDate, placeholder: "YYYY-MM-DD" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}
            {total > 0 && (
              <View style={[S.totalRow, { backgroundColor: FOOD_COLOR + "0a" }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>本次进货金额</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: FOOD_COLOR }}>¥{formatMoney(total)}</Text>
              </View>
            )}
            <View style={[S.pettyHint, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "22" }]}>
              <Text style={{ fontSize: 12, color: colors.warning }}>
                💡 入库后请同时在备用金中录入 A1-A4（食材采购）支出
              </Text>
            </View>
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

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export interface FoodInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function FoodInventoryScreen({ month, embedded = false }: FoodInventoryScreenProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { ingredients, updateIngredient } = useFoodIngredientStore();

  const [tab, setTab] = useState<Tab>("ledger");
  const [showPurchase, setShowPurchase] = useState(false);
  const [filterCat, setFilterCat] = useState<IngredientCategory | "all">("all");
  const [importLoading, setImportLoading] = useState(false);

  const currentMonth = month ?? getCurrentMonth();

  // 按类别分组
  const byCategory = useMemo(() => {
    const map: Record<string, FoodIngredient[]> = {};
    ingredients.forEach((ing) => {
      if (!map[ing.category]) map[ing.category] = [];
      map[ing.category].push(ing);
    });
    return map;
  }, [ingredients]);

  const totalStockValue = useMemo(() =>
    ingredients.reduce((s, i) => s + i.stock * (i.costPrice ?? 0), 0),
    [ingredients]
  );

  const handlePurchase = (ingredientId: string, qty: number, price: number, supplier: string, notes: string) => {
    // 更新库存和价格
    const ing = ingredients.find((i) => i.id === ingredientId);
    if (!ing) return;
    updateIngredient(ingredientId, {
      stock: ing.stock + qty,
      costPrice: price > 0 ? price : ing.costPrice,
      supplier: supplier || ing.supplier,
    });
    // 进货记录（通过 updateIngredient 更新价格历史即可）
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "summary", label: "📊 总结" },
    { key: "ledger", label: "📋 库存管理" },
    { key: "purchase", label: "📦 当月进货" },
  ];

  return (
    <ScreenContainer edges={embedded ? [] : undefined}>
      {/* 独立路由才保留返回导航；工作台已提供分类与月份层级。 */}
      {!embedded && <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>🥩 食材进销存</Text>
        <Pressable onPress={() => router.push("/food-ingredient-form/new" as any)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={FOOD_COLOR} />
        </Pressable>
      </View>}

      {/* Tab */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
            style={[S.tabChip, {
              backgroundColor: tab === t.key ? FOOD_COLOR : colors.surface,
              borderColor: tab === t.key ? FOOD_COLOR : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 汇总行 */}
      <View style={[S.summaryRow, { borderBottomColor: colors.border }]}>
        {[
          { label: "食材种数", value: `${ingredients.length}`, color: FOOD_COLOR },
          { label: "库存总值", value: `¥${formatMoney(totalStockValue)}`, color: FOOD_COLOR },
        ].map((c, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 10, color: colors.muted }}>{c.label}</Text>
            <Text style={{ fontSize: 15, fontWeight: "700", color: c.color }}>{c.value}</Text>
          </View>
        ))}
      </View>

      {/* 快捷操作 */}
      <View style={[S.actionRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => { tap(); setShowPurchase(true); }}
          style={[S.actionBtn, { backgroundColor: FOOD_COLOR + "15", borderColor: FOOD_COLOR + "33" }]}>
          <Text style={{ fontSize: 12, color: FOOD_COLOR, fontWeight: "600" }}>📦 录入进货</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 台账 Tab */}
        {tab === "ledger" && (
          ingredients.length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 48 }}>🥩</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有食材档案</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
                点击右上角 + 添加食材，或在「门店 → 食材」导入 Excel
              </Text>
            </View>
          ) : (
            INGREDIENT_CATEGORIES.filter((cat) => byCategory[cat]?.length).map((cat) => {
              const catColor = CATEGORY_COLORS[cat];
              const items = byCategory[cat] ?? [];
              return (
                <View key={cat} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: catColor }} />
                    <Text style={{ fontSize: 14, fontWeight: "700", color: catColor }}>{INGREDIENT_CATEGORY_LABELS[cat]}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>({items.length} 种)</Text>
                  </View>
                  {items.map((ing) => {
                    const priceHistory = ing.priceHistory ?? [];
                    const lastTwo = priceHistory.slice(0, 2);
                    const priceDelta = lastTwo.length >= 2 ? lastTwo[0].price - lastTwo[1].price : 0;
                    return (
                      <View key={ing.id} style={[S.foodCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{ing.name}</Text>
                            {priceDelta !== 0 && (
                              <View style={[S.tag, { backgroundColor: priceDelta > 0 ? colors.error + "22" : colors.success + "22" }]}>
                                <Text style={{ fontSize: 10, color: priceDelta > 0 ? colors.error : colors.success }}>
                                  {priceDelta > 0 ? `↑¥${formatMoney(priceDelta)}` : `↓¥${formatMoney(Math.abs(priceDelta))}`}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 12, color: colors.muted }}>
                            {ing.spec ? `${ing.spec} · ` : ""}¥{ing.costPrice?.toFixed(2) ?? "-"}/{ing.unit}
                            {ing.supplier ? ` · ${ing.supplier}` : ""}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 16, fontWeight: "700", color: FOOD_COLOR }}>
                            {ing.stock} {ing.unit}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            ¥{formatMoney(((ing.costPrice ?? 0) * ing.stock))}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })
          )
        )}

        {/* 进货录入 Tab */}
        {tab === "purchase" && (
          <View style={{ gap: 8 }}>
            <TouchableOpacity onPress={() => { tap(); setShowPurchase(true); }}
              style={{ backgroundColor: FOOD_COLOR, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>+ 录入进货</Text>
            </TouchableOpacity>
            <View style={[S.hintCard, { backgroundColor: FOOD_COLOR + "08", borderColor: FOOD_COLOR + "22" }]}>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                💡 录入进货后自动更新食材库存和最新进价，并记录价格历史。如有涨价/降价，台账中会自动标注。
              </Text>
            </View>
          </View>
        )}

        {/* 月度汇总 Tab */}
        {tab === "summary" && (
          <View style={{ gap: 12 }}>
            <View style={[S.summaryCard, { backgroundColor: FOOD_COLOR + "0a", borderColor: FOOD_COLOR + "22" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: FOOD_COLOR, marginBottom: 8 }}>{currentMonth} 食材概况</Text>
              {[
                { label: "食材种数", value: `${ingredients.length} 种`, color: FOOD_COLOR },
                { label: "库存总成本", value: `¥${formatMoney(totalStockValue)}`, color: FOOD_COLOR },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: row.color }}>{row.value}</Text>
                </View>
              ))}
            </View>
            {/* 价格波动提醒 */}
            {ingredients.filter((i) => {
              const h = i.priceHistory ?? [];
              return h.length >= 2 && h[0].price !== h[1].price;
            }).length > 0 && (
              <View>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8 }}>价格波动提醒</Text>
                {ingredients.filter((i) => {
                  const h = i.priceHistory ?? [];
                  return h.length >= 2 && h[0].price !== h[1].price;
                }).map((ing) => {
                  const h = ing.priceHistory!;
                  const delta = h[0].price - h[1].price;
                  return (
                    <View key={ing.id} style={[S.foodCard, { backgroundColor: colors.surface, borderColor: delta > 0 ? colors.error + "44" : colors.success + "44" }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{ing.name}</Text>
                        <Text style={{ fontSize: 12, color: colors.muted }}>
                          {h[1].price.toFixed(2)} → {h[0].price.toFixed(2)} 元/{ing.unit}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: delta > 0 ? colors.error : colors.success }}>
                        {delta > 0 ? `↑¥${formatMoney(delta)}` : `↓¥${formatMoney(Math.abs(delta))}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <PurchaseModal visible={showPurchase} ingredients={ingredients} colors={colors}
        onSave={handlePurchase} onClose={() => setShowPurchase(false)} />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  summaryRow: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  actionRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  actionBtn: { flexShrink: 0, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  foodCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
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
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  hintCard: { borderRadius: 10, borderWidth: 1, padding: 12 },
});

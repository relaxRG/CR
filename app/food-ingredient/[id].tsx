/**
 * 食材详情页
 */
import React, { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useFoodIngredientStore } from "@/lib/food/ingredient-store";
import { INGREDIENT_CATEGORY_LABELS } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { PriceHistoryChart, SupplierPriceCompare } from "@/components/price-history-chart";

export default function FoodIngredientDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ingredients, updateIngredient, deleteIngredient } = useFoodIngredientStore();
  const item = ingredients.find((i) => i.id === id);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = screenWidth - 64; // 16px padding * 2 + 16px card padding * 2

  // 从 ingredient-store 的 priceHistory map 中取当前原料的价格历史
  const { priceHistory: priceHistoryMap } = useFoodIngredientStore();
  const priceHistory = useMemo(
    () => (priceHistoryMap[id] ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [priceHistoryMap, id]
  );

  // 供应商最新价格对比
  const supplierPrices = useMemo(() => {
    const map: Record<string, { latestPrice: number; date: string; count: number }> = {};
    for (const entry of priceHistory) {
      if (!map[entry.supplier] || entry.date > map[entry.supplier].date) {
        map[entry.supplier] = { latestPrice: entry.price, date: entry.date, count: 0 };
      }
      map[entry.supplier].count++;
    }
    return Object.entries(map).map(([supplier, v]) => ({ supplier, ...v }));
  }, [priceHistory]);

  const [priceTab, setPriceTab] = useState<"chart" | "compare">("chart");

  if (!item) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>食材不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  const adjustStock = (delta: number) => {
    tap();
    const next = Math.max(0, item.stock + delta);
    updateIngredient(item.id, { stock: next });
  };

  const handleDelete = () => {
    Alert.alert("删除食材", `确定删除「${item.name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteIngredient(item.id); router.back(); } },
    ]);
  };

  const isLow = item.stock <= item.alertThreshold && item.alertThreshold > 0;

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { tap(); router.push(`/food-ingredient-form?id=${item.id}` as any); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={[styles.editBtn, { color: colors.primary }]}>编辑</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 12 }}>
        {/* 名称与分类 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.bigName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <View style={[styles.tag, { backgroundColor: colors.primary + "22" }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>{INGREDIENT_CATEGORY_LABELS[item.category]}</Text>
            </View>
            {item.spec ? (
              <View style={[styles.tag, { backgroundColor: colors.border }]}>
                <Text style={[styles.tagText, { color: colors.muted }]}>{item.spec}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* 库存 */}
        <View style={[styles.card, { backgroundColor: isLow ? colors.warning + "11" : colors.surface, borderColor: isLow ? colors.warning : colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 12 }}>
            <View style={{ alignItems: "center" }}>
              <Text style={[styles.priceLabel, { color: colors.muted }]}>当前库存</Text>
              <Text style={[styles.priceValue, { color: isLow ? colors.warning : colors.foreground }]}>
                {item.stock} {item.unit || ""}
              </Text>
            </View>
            {item.alertThreshold > 0 && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>预警线</Text>
                <Text style={[styles.priceValue, { color: colors.muted }]}>{item.alertThreshold}</Text>
              </View>
            )}
            {item.costPrice != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>采购价</Text>
                <Text style={[styles.priceValue, { color: colors.foreground }]}>¥{item.costPrice}</Text>
              </View>
            )}
          </View>
          {isLow && <Text style={{ color: colors.warning, fontSize: 13, textAlign: "center", marginBottom: 8 }}>⚠️ 库存低于预警线，请及时补货</Text>}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={() => adjustStock(1)}
              style={[styles.stockBtn, { backgroundColor: colors.success + "22", flex: 1 }]}>
              <IconSymbol name="plus" size={16} color={colors.success} />
              <Text style={{ color: colors.success, fontWeight: "600", marginLeft: 4 }}>入库 +1</Text>
            </Pressable>
            <Pressable onPress={() => adjustStock(-1)}
              style={[styles.stockBtn, { backgroundColor: colors.error + "22", flex: 1 }]}>
              <IconSymbol name="minus" size={16} color={colors.error} />
              <Text style={{ color: colors.error, fontWeight: "600", marginLeft: 4 }}>出库 -1</Text>
            </Pressable>
          </View>
        </View>

        {/* 供应商 */}
        {item.supplier ? (
          <View style={[styles.detailRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>供应商</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{item.supplier}</Text>
          </View>
        ) : null}

        {/* 价格历史 & 供应商对比 */}
        {priceHistory.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* Tab 切换 */}
            <View style={[styles.tabRow, { backgroundColor: colors.border + "33" }]}>
              {(["chart", "compare"] as const).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => { tap(); setPriceTab(tab); }}
                  style={[styles.tabBtn, priceTab === tab && { backgroundColor: colors.background }]}
                >
                  <Text style={[styles.tabText, { color: priceTab === tab ? colors.foreground : colors.muted, fontWeight: priceTab === tab ? "600" : "400" }]}>
                    {tab === "chart" ? "价格走势" : "供应商对比"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {priceTab === "chart" ? (
              <View style={{ marginTop: 8 }}>
                <PriceHistoryChart
                  history={priceHistory}
                  width={chartWidth}
                  height={160}
                  unit={item.unit}
                  showLegend={true}
                />
                {/* 最近一次涨跌 */}
                {priceHistory.length >= 2 && (() => {
                  const last = priceHistory[priceHistory.length - 1];
                  const prev = priceHistory[priceHistory.length - 2];
                  const delta = last.price - prev.price;
                  const pct = prev.price > 0 ? (delta / prev.price * 100).toFixed(1) : "0";
                  return (
                    <View style={[styles.deltaRow, { backgroundColor: delta > 0 ? "#EF444411" : delta < 0 ? "#22C55E11" : colors.border + "22" }]}>
                      <Text style={{ fontSize: 12, color: delta > 0 ? "#EF4444" : delta < 0 ? "#22C55E" : colors.muted }}>
                        {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} 最近一次
                        {delta > 0 ? "涨价" : delta < 0 ? "降价" : "持平"}
                        {delta !== 0 ? ` ¥${Math.abs(delta).toFixed(2)} (${Math.abs(Number(pct))}%)` : ""}
                        {" · "}{last.date} · {last.supplier}
                      </Text>
                    </View>
                  );
                })()}
              </View>
            ) : (
              <View style={{ marginTop: 12 }}>
                <SupplierPriceCompare
                  supplierPrices={supplierPrices}
                  unit={item.unit}
                  width={chartWidth}
                />
                {/* 进货次数统计 */}
                <View style={{ marginTop: 12, gap: 4 }}>
                  {supplierPrices.map((s) => (
                    <View key={s.supplier} style={[styles.supplierStatRow, { borderColor: colors.border }]}>
                      <Text style={[styles.supplierStatName, { color: colors.foreground }]}>{s.supplier}</Text>
                      <Text style={[styles.supplierStatCount, { color: colors.muted }]}>进货 {s.count} 次</Text>
                      <Text style={[styles.supplierStatDate, { color: colors.muted }]}>最近 {s.date}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* 备注 */}
        {item.notes ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>备注</Text>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{item.notes}</Text>
          </View>
        ) : null}

        {/* 删除 */}
        <Pressable onPress={handleDelete}
          style={[styles.card, { backgroundColor: colors.error + "11", borderColor: colors.error + "33", alignItems: "center" }]}>
          <Text style={{ color: colors.error, fontWeight: "600", fontSize: 15 }}>删除食材</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  navTitle: { fontSize: 17, fontWeight: "600", marginLeft: 8, flex: 1 },
  editBtn: { fontSize: 17, fontWeight: "500" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  bigName: { fontSize: 24, fontWeight: "700", lineHeight: 30 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontWeight: "500" },
  priceLabel: { fontSize: 13, marginBottom: 4 },
  priceValue: { fontSize: 20, fontWeight: "700" },
  stockBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10 },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, borderWidth: 1, padding: 14 },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14, fontWeight: "500" },
  sectionTitle: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  bodyText: { fontSize: 15, lineHeight: 22 },
  tabRow: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13, lineHeight: 18 },
  deltaRow: { marginTop: 8, padding: 8, borderRadius: 8 },
  supplierStatRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  supplierStatName: { flex: 1, fontSize: 13, fontWeight: "500" },
  supplierStatCount: { fontSize: 12, marginRight: 12 },
  supplierStatDate: { fontSize: 11 },
});

/**
 * 进销存模块导航入口（重构版）
 * 展示全部 10 个品类的入口卡片，每个品类独立页面
 */
import React, { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useSpiritsSnapshotStore } from "@/lib/spirits/store";
import { useWineSnapshotStore } from "@/lib/wine/store";
import { useFoodIngredientStore } from "@/lib/food/ingredient-store";
import { useBeerInventoryStore } from "@/lib/beer/inventory-store";
import { useIceNewInventoryStore } from "@/lib/ice/new-inventory-store";
import { useFruitNewInventoryStore } from "@/lib/fruit/new-inventory-store";
import { useGlasswareInventoryStore } from "@/lib/glassware/inventory-store";
import { useTablewareInventoryStore } from "@/lib/tableware/inventory-store";
import { useDailyInventoryStore } from "@/lib/daily/inventory-store";
import { useEquipmentInventoryStore } from "@/lib/equipment/inventory-store";

export default function StoreInventoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const spiritsStore = useSpiritsSnapshotStore();
  const wineStore = useWineSnapshotStore();
  const foodStore = useFoodIngredientStore();
  const beerStore = useBeerInventoryStore();
  const iceStore = useIceNewInventoryStore();
  const fruitStore = useFruitNewInventoryStore();
  const glasswareStore = useGlasswareInventoryStore();
  const tablewareStore = useTablewareInventoryStore();
  const dailyStore = useDailyInventoryStore();
  const equipmentStore = useEquipmentInventoryStore();

  const currentMonth = new Date().toISOString().slice(0, 7);

  const categories = useMemo(() => {
    const spiritsSnap = spiritsStore.snapshots[0];
    const wineSnap = wineStore.snapshots[0];
    const beerItems = beerStore.items.filter((i) => i.active);
    const iceItems = iceStore.items.filter((i) => i.active);
    const fruitItems = fruitStore.items.filter((i) => i.active);
    const glassItems = glasswareStore.items.filter((i) => i.active);
    const tableItems = tablewareStore.items.filter((i) => i.active);
    const dailyItems = dailyStore.items.filter((i) => i.active);
    const equipItems = equipmentStore.items.filter((i) => i.active);
    const foodLow = foodStore.ingredients.filter((i) => i.alertThreshold > 0 && i.stock <= i.alertThreshold).length;

    return [
      { emoji: "🥃", label: "烈酒", color: "#6B7280", route: "/spirits-inventory",
        sub: spiritsSnap ? `${spiritsSnap.monthLabel} · ${spiritsSnap.items.length} 款 · 期末¥${spiritsSnap.totalEndCost.toFixed(0)}` : "导入 Excel 开始使用",
        badge: spiritsSnap ? `${spiritsSnap.items.length}款` : undefined },
      { emoji: "🍷", label: "葡萄酒", color: "#9F1239", route: "/wine-inventory",
        sub: wineSnap ? `${wineSnap.monthLabel} · ${wineSnap.items.length} 款 · 期末¥${wineSnap.totalEndCost.toFixed(0)}` : "导入 Excel 开始使用",
        badge: wineSnap ? `${wineSnap.items.length}款` : undefined },
      { emoji: "🥩", label: "食材", color: "#10B981", route: "/food-inventory",
        sub: foodStore.ingredients.length > 0 ? `${foodStore.ingredients.length} 种${foodLow > 0 ? ` · ⚠ ${foodLow}种预警` : ""}` : "点击管理食材档案",
        badge: foodStore.ingredients.length > 0 ? `${foodStore.ingredients.length}种` : undefined },
      { emoji: "🍺", label: "啤酒", color: "#F4A300", route: "/beer-inventory",
        sub: beerItems.length > 0 ? `${beerItems.length} 款${beerStore.getLowStockItems().length > 0 ? ` · ⚠ ${beerStore.getLowStockItems().length}种预警` : ""}` : "点击添加啤酒档案",
        badge: beerItems.length > 0 ? `${beerItems.length}款` : undefined },
      { emoji: "🧊", label: "冰块", color: "#00BCD4", route: "/ice-inventory",
        sub: iceItems.length > 0 ? `${iceItems.length} 种${iceStore.getLowStockItems().length > 0 ? ` · ⚠ ${iceStore.getLowStockItems().length}种预警` : ""}` : "点击添加冰块档案",
        badge: iceItems.length > 0 ? `${iceItems.length}种` : undefined },
      { emoji: "🍋", label: "水果", color: "#22C55E", route: "/fruit-inventory",
        sub: fruitItems.length > 0 ? `${fruitItems.length} 种${fruitStore.getLowStockItems().length > 0 ? ` · ⚠ ${fruitStore.getLowStockItems().length}种预警` : ""}` : "点击添加水果档案",
        badge: fruitItems.length > 0 ? `${fruitItems.length}种` : undefined },
      { emoji: "🥂", label: "杯具", color: "#6366F1", route: "/glassware-inventory",
        sub: glassItems.length > 0 ? `${glassItems.length} 款 · 本月损耗${glasswareStore.consumes.filter((c) => c.reason === "loss" && c.date.startsWith(currentMonth)).length}次` : "点击添加杯具档案",
        badge: glassItems.length > 0 ? `${glassItems.length}款` : undefined },
      { emoji: "🍽️", label: "餐具", color: "#0EA5E9", route: "/tableware-inventory",
        sub: tableItems.length > 0 ? `${tableItems.length} 款 · 本月损耗${tablewareStore.consumes.filter((c) => c.reason === "loss" && c.date.startsWith(currentMonth)).length}次` : "点击添加餐具档案",
        badge: tableItems.length > 0 ? `${tableItems.length}款` : undefined },
      { emoji: "🧴", label: "日用品", color: "#F59E0B", route: "/daily-inventory",
        sub: dailyItems.length > 0 ? `${dailyItems.length} 种${dailyStore.getLowStockItems().length > 0 ? ` · ⚠ ${dailyStore.getLowStockItems().length}种预警` : ""}` : "点击添加日用品档案",
        badge: dailyItems.length > 0 ? `${dailyItems.length}种` : undefined },
      { emoji: "🔧", label: "设备", color: "#6366F1", route: "/equipment-inventory",
        sub: equipItems.length > 0 ? `${equipItems.length} 台 · 月折旧¥${equipmentStore.getTotalMonthlyDepreciation().toFixed(0)}` : "点击登记设备",
        badge: equipItems.length > 0 ? `${equipItems.length}台` : undefined },
    ];
  }, [spiritsStore, wineStore, foodStore, beerStore, iceStore, fruitStore, glasswareStore, tablewareStore, dailyStore, equipmentStore, currentMonth]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
    >
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>进销存管理</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
          共 {categories.filter((c) => c.badge).length} 个品类已有数据
        </Text>
      </View>
      <View style={{ gap: 10 }}>
        {categories.map((cat) => (
          <TouchableOpacity key={cat.label} onPress={() => { tap(); router.push(cat.route as any); }}
            activeOpacity={0.75}
            style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[S.colorBar, { backgroundColor: cat.color }]} />
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 22 }}>{cat.emoji}</Text>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{cat.label}</Text>
                {cat.badge && (
                  <View style={[S.badge, { backgroundColor: cat.color + "22" }]}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: cat.color }}>{cat.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }} numberOfLines={1}>{cat.sub}</Text>
            </View>
            <Text style={{ fontSize: 20, color: colors.muted, paddingRight: 4 }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, overflow: "hidden", minHeight: 68 },
  colorBar: { width: 5, alignSelf: "stretch" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
});

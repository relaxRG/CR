import React, { useEffect, useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { BoundedMonthNavigator } from "@/components/inventory/BoundedMonthNavigator";
import {
  clampInventoryMonth,
  deriveInventoryMonthBounds,
  getCurrentInventoryMonth,
  normalizeInventoryMonth,
  type InventoryMonth,
} from "@/lib/inventory-core/month-browser";
import { useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { useWineManualPurchaseStore, useWineSnapshotStore } from "@/lib/wine/store";
import { useFoodIngredientStore, useSupplierPurchaseStore } from "@/lib/food/ingredient-store";
import { useBeerInventoryStore } from "@/lib/beer/inventory-store";
import { useIceNewInventoryStore } from "@/lib/ice/new-inventory-store";
import { useFruitNewInventoryStore } from "@/lib/fruit/new-inventory-store";
import { useGlasswareInventoryStore } from "@/lib/glassware/inventory-store";
import { useTablewareInventoryStore } from "@/lib/tableware/inventory-store";
import { useDailyInventoryStore } from "@/lib/daily/inventory-store";
import { useEquipmentInventoryStore } from "@/lib/equipment/inventory-store";
import SpiritsInventoryScreen from "@/app/spirits-inventory";
import WineInventoryScreen from "@/app/wine-inventory";
import FruitInventoryScreen from "@/app/fruit-inventory";
import FoodInventoryScreen from "@/app/food-inventory";
import BeerInventoryScreen from "@/app/beer-inventory";
import IceInventoryScreen from "@/app/ice-inventory";
import GlasswareInventoryScreen from "@/app/glassware-inventory";
import TablewareInventoryScreen from "@/app/tableware-inventory";
import DailyInventoryScreen from "@/app/daily-inventory";
import EquipmentInventoryScreen from "@/app/equipment-inventory";

export type InventoryPortalMode = "inventory" | "shop";
type InventoryCategoryKey = "spirits" | "wine" | "fruit" | "food" | "beer" | "ice" | "glassware" | "tableware" | "daily" | "equipment";

const CATEGORIES: Array<{ key: InventoryCategoryKey; label: string; emoji: string; color: string; mode: InventoryPortalMode }> = [
  { key: "spirits", label: "烈酒", emoji: "🥃", color: "#6B7280", mode: "inventory" },
  { key: "wine", label: "葡萄酒", emoji: "🍷", color: "#9F1239", mode: "inventory" },
  { key: "fruit", label: "水果", emoji: "🍋", color: "#22C55E", mode: "inventory" },
  { key: "food", label: "食材", emoji: "🥩", color: "#10B981", mode: "inventory" },
  { key: "beer", label: "啤酒", emoji: "🍺", color: "#F4A300", mode: "inventory" },
  { key: "ice", label: "冰块", emoji: "🧊", color: "#00BCD4", mode: "inventory" },
  { key: "glassware", label: "杯具", emoji: "🥂", color: "#6366F1", mode: "shop" },
  { key: "tableware", label: "餐具", emoji: "🍽️", color: "#0EA5E9", mode: "shop" },
  { key: "daily", label: "日用品", emoji: "🧴", color: "#F59E0B", mode: "shop" },
  { key: "equipment", label: "设备", emoji: "🔧", color: "#6366F1", mode: "shop" },
];

function normalizeMany(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => normalizeInventoryMonth(value) !== null);
}

export default function StoreInventoryScreen({ mode = "inventory" }: { mode?: InventoryPortalMode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const categoryStorageKey = mode === "shop" ? "store.shop.category.v2" : "store.inventory.category.v2";
  const monthStorageKey = mode === "shop" ? "store.shop.month.v1" : "store.inventory.month.v1";
  const defaultCategory = mode === "shop" ? "glassware" : "spirits";
  const [activeCategory, setActiveCategory] = usePersistedState<InventoryCategoryKey>(categoryStorageKey, defaultCategory);
  const [persistedMonth, setPersistedMonth] = usePersistedState<string>(monthStorageKey, getCurrentInventoryMonth());

  const spiritsStore = useSpiritsInventoryStore();
  const wineSnapshots = useWineSnapshotStore();
  const wineManualPurchases = useWineManualPurchaseStore();
  const foodStore = useFoodIngredientStore();
  const foodPurchases = useSupplierPurchaseStore();
  const beerStore = useBeerInventoryStore();
  const iceStore = useIceNewInventoryStore();
  const fruitStore = useFruitNewInventoryStore();
  const glasswareStore = useGlasswareInventoryStore();
  const tablewareStore = useTablewareInventoryStore();
  const dailyStore = useDailyInventoryStore();
  const equipmentStore = useEquipmentInventoryStore();

  const categories = CATEGORIES.filter((category) => category.mode === mode);
  const currentCategory = categories.find((category) => category.key === activeCategory) ?? categories[0];

  const categoryMonths = useMemo(() => {
    const genericMonths = (store: { snapshots: Array<{ month: string }>; purchases: Array<{ date: string }>; consumes: Array<{ date: string }> }) => [
      ...store.snapshots.map((snapshot) => snapshot.month),
      ...store.purchases.map((purchase) => purchase.date),
      ...store.consumes.map((consume) => consume.date),
    ];
    const allMonths: Record<InventoryCategoryKey, string[]> = {
      spirits: [
        ...spiritsStore.ledger.map((entry) => entry.month),
        ...spiritsStore.purchases.map((purchase) => purchase.date ?? purchase.month),
      ],
      wine: [
        ...wineSnapshots.snapshots.map((snapshot) => snapshot.monthLabel),
        ...wineSnapshots.snapshots.flatMap((snapshot) => snapshot.purchaseOrders.map((purchase) => purchase.date)),
        ...wineManualPurchases.purchases.map((purchase) => purchase.date),
      ],
      fruit: genericMonths(fruitStore),
      beer: genericMonths(beerStore),
      ice: genericMonths(iceStore),
      food: [
        ...foodStore.ingredients.flatMap((ingredient) => (ingredient.priceHistory ?? []).map((entry) => entry.date)),
        ...foodPurchases.records.flatMap((record: any) => [record.importDate, ...(record.items ?? []).map((item: any) => item.date)]),
      ],
      glassware: genericMonths(glasswareStore),
      tableware: genericMonths(tablewareStore),
      daily: genericMonths(dailyStore),
      equipment: [
        ...equipmentStore.items.map((item) => item.purchaseDate),
        ...equipmentStore.maintenanceRecords.map((record) => record.date),
      ],
    };
    return allMonths;
  }, [spiritsStore, wineSnapshots, wineManualPurchases, foodStore, foodPurchases, fruitStore, beerStore, iceStore, glasswareStore, tablewareStore, dailyStore, equipmentStore]);

  const bounds = useMemo(
    () => deriveInventoryMonthBounds(categories.flatMap((category) => normalizeMany(categoryMonths[category.key]))),
    [categories, categoryMonths],
  );
  const selectedMonth = clampInventoryMonth(persistedMonth, bounds);

  useEffect(() => {
    if (persistedMonth !== selectedMonth) setPersistedMonth(selectedMonth);
  }, [persistedMonth, selectedMonth, setPersistedMonth]);

  useEffect(() => {
    if (!categories.some((category) => category.key === activeCategory)) setActiveCategory(defaultCategory);
  }, [activeCategory, categories, defaultCategory, setActiveCategory]);

  const title = mode === "shop" ? "店铺" : "库存管理";
  const description = mode === "shop" ? "杯具、餐具、日用品与设备" : "烈酒、葡萄酒、水果、食材、啤酒与冰块";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground }}>{title}</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{description}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"}
        style={{ flexGrow: 0, marginTop: 14 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {categories.map((category) => {
          const active = currentCategory?.key === category.key;
          return (
            <TouchableOpacity
              key={category.key}
              testID={`${mode}-segment-${category.key}`}
              onPress={() => { tap(); setActiveCategory(category.key); }}
              activeOpacity={0.75}
              style={[S.segment, { backgroundColor: active ? category.color : colors.surface, borderColor: active ? category.color : colors.border }]}
            >
              <Text style={[S.segmentText, { color: active ? "#fff" : colors.foreground }]}>{category.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <BoundedMonthNavigator month={selectedMonth} bounds={bounds} onChange={setPersistedMonth} testID={`${mode}-month-navigator`} />

      <View testID={`${mode}-workspace-${currentCategory.key}`} style={{ flex: 1, paddingBottom: insets.bottom }}>
        <InventoryBusinessPanel category={currentCategory.key} month={selectedMonth} />
      </View>
    </View>
  );
}

function InventoryBusinessPanel({ category, month }: { category: InventoryCategoryKey; month: InventoryMonth }) {
  switch (category) {
    case "spirits": return <SpiritsInventoryScreen month={month} />;
    case "wine": return <WineInventoryScreen month={month} embedded />;
    case "fruit": return <FruitInventoryScreen month={month} embedded />;
    case "food": return <FoodInventoryScreen month={month} embedded />;
    case "beer": return <BeerInventoryScreen month={month} embedded />;
    case "ice": return <IceInventoryScreen month={month} embedded />;
    case "glassware": return <GlasswareInventoryScreen month={month} embedded />;
    case "tableware": return <TablewareInventoryScreen month={month} embedded />;
    case "daily": return <DailyInventoryScreen month={month} embedded />;
    case "equipment": return <EquipmentInventoryScreen month={month} embedded />;
  }
}

const S = StyleSheet.create({
  segment: { minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 10, borderWidth: 1 },
  segmentText: { fontSize: 14, fontWeight: "600" },
});

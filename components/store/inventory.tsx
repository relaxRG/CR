import React, { useEffect, useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { BoundedMonthNavigator } from "@/components/inventory/BoundedMonthNavigator";
import {
  deriveInventoryMonthBounds,
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
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";
import { INVENTORY_WORKSPACE_METRICS } from "@/lib/store/inventory-workspace-ui";
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

const CATEGORIES: Array<{ key: InventoryCategoryKey; label: string; mode: InventoryPortalMode }> = [
  { key: "spirits", label: "烈酒", mode: "inventory" },
  { key: "wine", label: "葡萄酒", mode: "inventory" },
  { key: "fruit", label: "水果", mode: "inventory" },
  { key: "food", label: "食材", mode: "inventory" },
  { key: "beer", label: "啤酒", mode: "inventory" },
  { key: "ice", label: "冰块", mode: "inventory" },
  { key: "glassware", label: "杯具", mode: "shop" },
  { key: "tableware", label: "餐具", mode: "shop" },
  { key: "daily", label: "日用品", mode: "shop" },
  { key: "equipment", label: "设备", mode: "shop" },
];

const INVENTORY_CATEGORIES = CATEGORIES.filter((category) => category.mode === "inventory");
const SHOP_CATEGORIES = CATEGORIES.filter((category) => category.mode === "shop");

function normalizeMany(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => normalizeInventoryMonth(value) !== null);
}

export default function StoreInventoryScreen({ mode = "inventory" }: { mode?: InventoryPortalMode }) {
  const colors = useColors();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const categoryStorageKey = mode === "shop" ? "store.shop.category.v2" : "store.inventory.category.v2";
  const defaultCategory = mode === "shop" ? "glassware" : "spirits";
  const [activeCategory, setActiveCategory] = usePersistedState<InventoryCategoryKey>(categoryStorageKey, defaultCategory);
  const { month: globalMonth, selectMonth: selectGlobalMonth } = useGlobalBusinessMonth();

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

  const categories = mode === "shop" ? SHOP_CATEGORIES : INVENTORY_CATEGORIES;
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
        ...foodStore.ledgerEntries.map((entry) => entry.month),
        ...foodStore.ledgerMovements.flatMap((movement) => [movement.month, movement.date]),
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

  const localBounds = useMemo(
    () => deriveInventoryMonthBounds(categories.flatMap((category) => normalizeMany(categoryMonths[category.key]))),
    [categories, categoryMonths],
  );
  // 库存没有该月数据时也必须展示全局月份的空状态，不能把全局月份跳回库存数据月。
  const bounds = useMemo(() => ({
    min: globalMonth < localBounds.min ? globalMonth : localBounds.min,
    max: globalMonth > localBounds.max ? globalMonth : localBounds.max,
  }), [globalMonth, localBounds]);
  const selectedMonth = globalMonth;

  useEffect(() => {
    if (!categories.some((category) => category.key === activeCategory)) setActiveCategory(defaultCategory);
  }, [activeCategory, categories, defaultCategory, setActiveCategory]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"}
        style={{ flexGrow: 0, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: INVENTORY_WORKSPACE_METRICS.horizontalPadding, gap: INVENTORY_WORKSPACE_METRICS.horizontalGap }}
      >
        {categories.map((category) => {
          const active = currentCategory?.key === category.key;
          return (
            <TouchableOpacity
              key={category.key}
              testID={`${mode}-segment-${category.key}`}
              onPress={() => { tap(); setActiveCategory(category.key); }}
              activeOpacity={0.75}
              style={[S.segment, { backgroundColor: active ? colors.foreground : colors.surface, borderColor: active ? colors.foreground : colors.border }]}
            >
              <Text style={[S.segmentText, { color: active ? "#fff" : colors.foreground }]}>{category.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <BoundedMonthNavigator month={selectedMonth} bounds={bounds} onChange={selectGlobalMonth} testID={`${mode}-month-navigator`} />

      <View testID={`${mode}-workspace-${currentCategory.key}`} style={{ flex: 1 }}>
        <InventoryBusinessPanel category={currentCategory.key} month={selectedMonth} />
      </View>
    </View>
  );
}

function InventoryBusinessPanel({ category, month }: { category: InventoryCategoryKey; month: InventoryMonth }) {
  switch (category) {
    case "spirits": return <SpiritsInventoryScreen month={month} embedded />;
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
  segment: { minHeight: INVENTORY_WORKSPACE_METRICS.segmentHeight, justifyContent: "center", paddingHorizontal: 16, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, borderWidth: 1 },
  segmentText: { fontSize: 14, fontWeight: "600" },
});

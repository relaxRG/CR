import React, { useEffect, useMemo } from "react";
import { Platform, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { BoundedMonthNavigator } from "@/components/inventory/BoundedMonthNavigator";
import { deriveInventoryMonthBounds, normalizeInventoryMonth, type InventoryMonth } from "@/lib/inventory-core/month-browser";
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
import { StoreSegmentedTabs } from "@/components/store/store-visual-primitives";
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
type Category = { key: InventoryCategoryKey; label: string };
type MonthMap = Partial<Record<InventoryCategoryKey, string[]>>;

const INVENTORY_CATEGORIES: Category[] = [
  { key: "spirits", label: "烈酒" }, { key: "wine", label: "葡萄酒" }, { key: "fruit", label: "水果" },
  { key: "food", label: "食材" }, { key: "beer", label: "啤酒" }, { key: "ice", label: "冰块" },
];
const SHOP_CATEGORIES: Category[] = [
  { key: "glassware", label: "杯具" }, { key: "tableware", label: "餐具" },
  { key: "daily", label: "日用品" }, { key: "equipment", label: "设备" },
];

function normalizeMany(values: (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => normalizeInventoryMonth(value) !== null);
}

function genericMonths(store: { snapshots: { month: string }[]; purchases: { date: string }[]; consumes: { date: string }[] }) {
  return [...store.snapshots.map((snapshot) => snapshot.month), ...store.purchases.map((purchase) => purchase.date), ...store.consumes.map((consume) => consume.date)];
}

export default function StoreInventoryScreen({ mode = "inventory" }: { mode?: InventoryPortalMode }) {
  return mode === "shop" ? <StoreShopInventoryPortal /> : <StoreCoreInventoryPortal />;
}

function InventoryPortalShell({ mode, categories, categoryMonths }: { mode: InventoryPortalMode; categories: Category[]; categoryMonths: MonthMap }) {
  const colors = useColors();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const categoryStorageKey = mode === "shop" ? "store.shop.category.v2" : "store.inventory.category.v2";
  const defaultCategory = mode === "shop" ? "glassware" : "spirits";
  const [activeCategory, setActiveCategory] = usePersistedState<InventoryCategoryKey>(categoryStorageKey, defaultCategory);
  const { month: globalMonth, selectMonth: selectGlobalMonth } = useGlobalBusinessMonth();
  const currentCategory = categories.find((category) => category.key === activeCategory) ?? categories[0]!;
  const bounds = useMemo(
    () => deriveInventoryMonthBounds(categories.flatMap((category) => normalizeMany(categoryMonths[category.key] ?? []))),
    [categories, categoryMonths],
  );

  useEffect(() => {
    if (!categories.some((category) => category.key === activeCategory)) setActiveCategory(defaultCategory);
  }, [activeCategory, categories, defaultCategory, setActiveCategory]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StoreSegmentedTabs items={categories} active={currentCategory.key} colors={colors} testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"} onChange={(next) => { tap(); setActiveCategory(next); }} />
      <BoundedMonthNavigator month={globalMonth} bounds={bounds} onChange={selectGlobalMonth} subject={mode === "shop" ? "店铺" : "库存"} testID={`${mode}-month-navigator`} />
      <View testID={`${mode}-workspace-${currentCategory.key}`} style={{ flex: 1 }}>
        <MemoizedInventoryBusinessPanel category={currentCategory.key} month={globalMonth} />
      </View>
    </View>
  );
}

function StoreCoreInventoryPortal() {
  const spiritsStore = useSpiritsInventoryStore();
  const wineSnapshots = useWineSnapshotStore();
  const wineManualPurchases = useWineManualPurchaseStore();
  const foodStore = useFoodIngredientStore();
  const foodPurchases = useSupplierPurchaseStore();
  const beerStore = useBeerInventoryStore();
  const iceStore = useIceNewInventoryStore();
  const fruitStore = useFruitNewInventoryStore();
  const categoryMonths = useMemo<MonthMap>(() => ({
    spirits: [...spiritsStore.ledger.map((entry) => entry.month), ...spiritsStore.purchases.map((purchase) => purchase.date ?? purchase.month)],
    wine: [...wineSnapshots.snapshots.map((snapshot) => snapshot.monthLabel), ...wineSnapshots.snapshots.flatMap((snapshot) => snapshot.purchaseOrders.map((purchase) => purchase.date)), ...wineManualPurchases.purchases.map((purchase) => purchase.date)],
    food: [...foodStore.ledgerEntries.map((entry) => entry.month), ...foodStore.ledgerMovements.flatMap((movement) => [movement.month, movement.date]), ...foodStore.ingredients.flatMap((ingredient) => (ingredient.priceHistory ?? []).map((entry) => entry.date)), ...foodPurchases.records.flatMap((record: any) => [record.importDate, ...(record.items ?? []).map((item: any) => item.date)])],
    fruit: genericMonths(fruitStore), beer: genericMonths(beerStore), ice: genericMonths(iceStore),
  }), [spiritsStore, wineSnapshots, wineManualPurchases, foodStore, foodPurchases, fruitStore, beerStore, iceStore]);
  return <InventoryPortalShell mode="inventory" categories={INVENTORY_CATEGORIES} categoryMonths={categoryMonths} />;
}

function StoreShopInventoryPortal() {
  const glasswareStore = useGlasswareInventoryStore();
  const tablewareStore = useTablewareInventoryStore();
  const dailyStore = useDailyInventoryStore();
  const equipmentStore = useEquipmentInventoryStore();
  const categoryMonths = useMemo<MonthMap>(() => ({
    glassware: genericMonths(glasswareStore), tableware: genericMonths(tablewareStore), daily: genericMonths(dailyStore),
    equipment: [...equipmentStore.items.map((item) => item.purchaseDate), ...equipmentStore.maintenanceRecords.map((record) => record.date)],
  }), [glasswareStore, tablewareStore, dailyStore, equipmentStore]);
  return <InventoryPortalShell mode="shop" categories={SHOP_CATEGORIES} categoryMonths={categoryMonths} />;
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

const MemoizedInventoryBusinessPanel = React.memo(InventoryBusinessPanel);

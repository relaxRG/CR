import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("店铺顶级模块与库存分类", () => {
  it("将店铺作为报表、员工和备用金的同级主模块，并在窄屏使用横向导航", () => {
    const store = read("app/(tabs)/store.tsx");
    expect(store).toContain('type MainTab = "monthly" | "labor" | "petty" | "shop" | "inventory"');
    expect(store).toContain('{ key: "shop",      label: "店铺",  feature: "store_ops" }');
    expect(store).toContain('<ScrollView testID="store-main-tabs" horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}');
    expect(store).toContain('testID={`store-main-tab-${t.key}`}');
    expect(store).toContain('{ key: "inventory", label: "库存",  feature: "store_ops" }');
    expect(store).toContain('{ key: "shop",      label: "店铺",  feature: "store_ops" }');
    expect(store).toContain('!isAuthenticated || hasFeature(t.feature)');
    expect(store).toContain('<StoreShopScreen />');
    expect(store.indexOf('label: "报表"')).toBeLessThan(store.indexOf('label: "员工"'));
    expect(store.indexOf('label: "员工"')).toBeLessThan(store.indexOf('label: "备用金"'));
    expect(store.indexOf('label: "备用金"')).toBeLessThan(store.indexOf('label: "库存"'));
    expect(store.indexOf('label: "库存"')).toBeLessThan(store.indexOf('label: "店铺"'));
  });

  it("店铺只承载杯具、餐具、日用品和设备，普通库存不再展示这些门店物资", () => {
    const inventory = read("components/store/inventory.tsx");
    expect(inventory).toContain('export type InventoryPortalMode = "inventory" | "shop"');
    expect(inventory).toContain('const CATEGORIES: Array');
    expect(inventory).toContain('mode === "shop"');
    expect(inventory).toContain('烈酒、葡萄酒、水果、食材、啤酒与冰块');
    expect(inventory.indexOf('label: "烈酒"')).toBeLessThan(inventory.indexOf('label: "葡萄酒"'));
    expect(inventory.indexOf('label: "葡萄酒"')).toBeLessThan(inventory.indexOf('label: "水果"'));
    expect(inventory.indexOf('label: "水果"')).toBeLessThan(inventory.indexOf('label: "食材"'));
    expect(inventory.indexOf('label: "食材"')).toBeLessThan(inventory.indexOf('label: "啤酒"'));
    expect(inventory.indexOf('label: "啤酒"')).toBeLessThan(inventory.indexOf('label: "冰块"'));
    expect(inventory).toContain('杯具、餐具、日用品与设备');
    expect(inventory).toContain('testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"}');
    expect(inventory).toContain('"store.inventory.category.v2"');
    expect(inventory).toContain('"store.shop.category.v2"');
    expect(inventory).toContain('"store.inventory.month.v1"');
    expect(inventory).toContain('"store.shop.month.v1"');
    expect(inventory).toContain('BoundedMonthNavigator');
    expect(inventory).toContain('testID={`${mode}-workspace-${currentCategory.key}`}');
  });

  it("店铺聚合页复用库存数据源，不引入第二套库存持久化逻辑", () => {
    const shop = read("components/store/shop.tsx");
    const inventory = read("components/store/inventory.tsx");
    expect(shop).toContain('StoreInventoryScreen mode="shop"');
    expect(shop).toContain('杯具、餐具、日用品与设备');
    expect(inventory.indexOf('label: "杯具"')).toBeLessThan(inventory.indexOf('label: "餐具"'));
    expect(inventory.indexOf('label: "餐具"')).toBeLessThan(inventory.indexOf('label: "日用品"'));
    expect(inventory.indexOf('label: "日用品"')).toBeLessThan(inventory.indexOf('label: "设备"'));
  });
});

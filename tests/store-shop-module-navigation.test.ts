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
    expect(inventory).not.toContain('烈酒、葡萄酒、水果、食材、啤酒与冰块');
    expect(inventory).toContain('const showPortalHeader = mode === "shop"');
    expect(inventory).toContain('case "spirits": return <SpiritsInventoryScreen month={month} embedded />;');
    expect(inventory.indexOf('label: "烈酒"')).toBeLessThan(inventory.indexOf('label: "葡萄酒"'));
    expect(inventory.indexOf('label: "葡萄酒"')).toBeLessThan(inventory.indexOf('label: "水果"'));
    expect(inventory.indexOf('label: "水果"')).toBeLessThan(inventory.indexOf('label: "食材"'));
    expect(inventory.indexOf('label: "食材"')).toBeLessThan(inventory.indexOf('label: "啤酒"'));
    expect(inventory.indexOf('label: "啤酒"')).toBeLessThan(inventory.indexOf('label: "冰块"'));
    expect(inventory).toContain('杯具、餐具、日用品与设备');
    expect(inventory).toContain('testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"}');
    expect(inventory).toContain('"store.inventory.category.v2"');
    expect(inventory).toContain('"store.shop.category.v2"');
    expect(inventory).toContain('useGlobalBusinessMonth');
    expect(inventory).not.toContain('"store.inventory.month.v1"');
    expect(inventory).not.toContain('"store.shop.month.v1"');
    expect(inventory).toContain('const selectedMonth = globalMonth');
    expect(inventory).toContain('BoundedMonthNavigator');
    expect(inventory).toContain('testID={`${mode}-workspace-${currentCategory.key}`}');
    expect(inventory).toContain('marginTop: showPortalHeader ? 14 : 8');
  });

  it("烈酒嵌入工作台时删除重复安全区，并让同排操作栏可横向滚动而不裁切", () => {
    const spirits = read("app/spirits-inventory.tsx");
    expect(spirits).toContain('embedded?: boolean;');
    expect(spirits).toContain('<ScreenContainer edges={embedded ? [] : undefined}>');
    expect(spirits).toContain('同一行横向滚动，不裁切文字或图标');
    expect(spirits).toContain('minHeight: 60');
    expect(spirits).toContain('flexShrink: 0, minHeight: 44');
  });

  it("其余五类库存和店铺四类通过统一嵌入安全区与横向操作栏避免重复留白和文字裁切", () => {
    const base = read("components/inventory/BaseInventoryScreen.tsx");
    const wine = read("app/wine-inventory.tsx");
    const food = read("app/food-inventory.tsx");
    const equipment = read("app/equipment-inventory.tsx");

    for (const source of [base, wine, food, equipment]) {
      expect(source).toContain('<ScreenContainer edges={embedded ? [] : undefined}>');
    }
    expect(base).toContain('<ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}');
    expect(base).toContain('flexShrink: 0, minHeight: 44');
    expect(wine).toContain('minHeight: 60');
    expect(wine).toContain('flexShrink: 0, minHeight: 44');
    expect(food).toContain('flexShrink: 0, minHeight: 44');

    for (const wrapper of ["fruit", "beer", "ice", "glassware", "tableware", "daily"]) {
      expect(read(`app/${wrapper}-inventory.tsx`)).toContain("embedded={embedded}");
    }
  });

  it("工作台H5回归覆盖极窄到大屏手机，并在结束后关闭专用测试页", () => {
    const h5 = read("scripts/h5-store-segmented-nav-e2e.mjs");
    expect(h5).toContain("const MOBILE_VIEWPORTS = [320, 360, 375, 390, 412, 430]");
    expect(h5).toContain("for (const width of MOBILE_VIEWPORTS)");
    expect(h5).toContain("json/close/${testTarget.id}");
    expect(h5).toContain("testSocket?.close()");
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

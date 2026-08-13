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
    expect(store).toContain('<ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}');
    expect(store).toContain('<StoreShopScreen />');
  });

  it("店铺只承载杯具、餐具、日用品和设备，普通库存不再展示这些门店物资", () => {
    const inventory = read("components/store/inventory.tsx");
    expect(inventory).toContain('export type InventoryPortalMode = "inventory" | "shop"');
    expect(inventory).toContain('["杯具", "餐具", "日用品", "设备"]');
    expect(inventory).toContain('mode === "shop"');
    expect(inventory).toContain('"酒水、食材、冰块与水果库存"');
    expect(inventory).toContain('"杯具、餐具、日用品与设备资产"');
  });

  it("店铺聚合页复用库存数据源，不引入第二套库存持久化逻辑", () => {
    const shop = read("components/store/shop.tsx");
    expect(shop).toContain('StoreInventoryScreen mode="shop"');
    expect(shop).toContain('杯具、餐具、日用品与设备');
  });
});

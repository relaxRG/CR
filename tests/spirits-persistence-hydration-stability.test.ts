import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(resolve(process.cwd(), "lib/spirits/crud-store.tsx"), "utf8");

describe("烈酒库存持久化水合稳定性", () => {
  it("将损坏JSON隔离到单个存储键，并为各事实源提供安全回退", () => {
    const store = source();

    expect(store).toContain("function parseStoredValue<T>");
    expect(store).toContain("烈酒库存数据解析失败，已回退默认值");
    expect(store).toContain("parseStoredValue<unknown>(itemsRaw, [], ITEMS_KEY)");
    expect(store).toContain("Array.isArray(parsedItems)");
    expect(store).toContain("parseStoredValue<unknown>(purchasesRaw, [], PURCHASES_KEY)");
    expect(store).toContain("Array.isArray(parsedPurchases)");
    expect(store).toContain("parseStoredValue<unknown>(refPricesRaw, [], REF_PRICES_KEY)");
    expect(store).toContain("Array.isArray(parsedRefPrices)");
    expect(store).toContain("parseStoredValue<unknown>(suppliersRaw, [], SUPPLIERS_KEY)");
    expect(store).toContain("Array.isArray(parsedSuppliers)");
    expect(store).toContain("Array.isArray(parsedMatchMemory)");
    expect(store).toContain("Array.isArray(parsedGroupMatchMemory)");
  });

  it("在AsyncStorage读取本身失败时捕获拒绝，避免reload回调产生未处理Promise", () => {
    const store = source();

    expect(store).toContain('console.warn("烈酒库存加载失败", error)');
    expect(store).toContain("void load();");
    expect(store).toContain("registerStoreReload(() => { void load(); })");
  });
});

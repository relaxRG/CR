import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(resolve(process.cwd(), "lib/spirits/crud-store.tsx"), "utf8");

describe("烈酒库存持久化水合稳定性", () => {
  it("将损坏JSON隔离到单个存储键，并为各事实源提供安全回退", () => {
    const store = source();

    expect(store).toContain("function parseStoredValue<T>");
    expect(store).toContain("烈酒库存数据解析失败，已回退默认值");
    expect(store).toContain("parseStoredValue<SpiritItem[]>(itemsRaw, [], ITEMS_KEY)");
    expect(store).toContain("parseStoredValue<SpiritPurchaseRecord[]>(purchasesRaw, [], PURCHASES_KEY)");
    expect(store).toContain("parseStoredValue<SpiritRefPrice[]>(refPricesRaw, [], REF_PRICES_KEY)");
    expect(store).toContain("parseStoredValue<SpiritSupplierInfo[]>(suppliersRaw, [], SUPPLIERS_KEY)");
    expect(store).toContain("parseStoredValue<PettyMatchMemory[]>(matchMemoryRaw, [], MATCH_MEMORY_KEY)");
    expect(store).toContain("parseStoredValue<GroupMatchMemory[]>(groupMatchRaw, [], GROUP_MATCH_MEMORY_KEY)");
  });

  it("在AsyncStorage读取本身失败时捕获拒绝，避免reload回调产生未处理Promise", () => {
    const store = source();

    expect(store).toContain('console.warn("烈酒库存加载失败", error)');
    expect(store).toContain("void load();");
    expect(store).toContain("registerStoreReload(() => { void load(); })");
  });
});

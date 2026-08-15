import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const base = read("components/inventory/BaseInventoryScreen.tsx");
const table = read("components/inventory/HorizontalLedgerTable.tsx");
const fruit = read("app/fruit-inventory.tsx");
const beer = read("app/beer-inventory.tsx");
const wine = read("app/wine-inventory.tsx");
const food = read("app/food-inventory.tsx");

describe("库存直接完整台账改造", () => {
  it("通用横向台账封装局部滚动、分类分组与商品名称详情触发能力", () => {
    expect(table).toContain("export function HorizontalLedgerTable");
    expect(table).toContain("horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator");
    expect(table).toContain("HorizontalLedgerColumn<Row>");
    expect(table).toContain("onPress?: (row: Row) => void");
    expect(table).toContain("testID={column.testID?.(row)}");
  });

  it("水果和啤酒显式进入库存管理后直接展示完整横向台账，而冰块与店铺不被强制迁移", () => {
    for (const source of [fruit, beer]) {
      expect(source).toContain('defaultTab="ledger"');
      expect(source).toContain('ledgerPresentation="table"');
    }
    expect(base).toContain('ledgerPresentation?: "cards" | "table"');
    expect(base).toContain('ledgerPresentation === "table"');
    expect(base).toContain("<MonthlyLedgerDetailSheet item={selectedLedgerItem}");
  });

  it("葡萄酒删除旧展开卡片台账并使用完整横向表，保留供应商搜索结果和名称详情", () => {
    expect(wine).not.toContain("function LedgerRow");
    expect(wine).not.toContain("function NumCell");
    expect(wine).toContain('testID="wine-horizontal-ledger-table"');
    expect(wine).toContain("wineLedgerColumns");
    expect(wine).toContain("wineLedgerGroups");
    expect(wine).toContain("<MonthlyLedgerDetailSheet item={selectedLedgerItem}");
  });

  it("食材库存直接展示月度横向台账，并提供采购、消耗、盘点和月结的真实入口", () => {
    expect(food).toContain('testID="food-horizontal-ledger-table"');
    expect(food).toContain("recordPurchase({ ingredientId, quantity: qty");
    expect(food).toContain("recordConsume({ ingredientId, quantity, date, unitCost, notes })");
    expect(food).toContain("recordStocktake({ ingredientId, actualClosingQty: quantity");
    expect(food).toContain("closeMonth(currentMonth)");
    expect(food).toContain('testID="food-ledger-detail-sheet"');
  });
});

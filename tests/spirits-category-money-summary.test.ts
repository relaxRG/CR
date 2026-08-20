import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { summarizeSpiritLedgerByCategory } from "@/lib/spirits/category-summary";
import type { SpiritItem, SpiritLedgerEntry } from "@/lib/spirits/types";

const ROOT = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

function item(id: string, category: string): SpiritItem {
  return {
    id,
    name: id,
    category,
    unit: "瓶",
    refPrice: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ledger(itemId: string, patch: Partial<SpiritLedgerEntry>): SpiritLedgerEntry {
  return {
    id: `ledger-${itemId}`,
    month: "2026-01",
    itemId,
    openingQty: 0,
    openingUnitCost: 0,
    purchaseQty: 0,
    purchaseCost: 0,
    consumeQty: 0,
    consumeCost: 0,
    closingQty: 0,
    closingUnitCost: 0,
    closingCost: 0,
    isClosed: false,
    updatedAt: "2026-01-31T00:00:00.000Z",
    ...patch,
  };
}

describe("烈酒总结金额分类汇总", () => {
  it("数量账本保持不变，同时按分类精确聚合期初、进货、消耗与期末成本金额", () => {
    const result = summarizeSpiritLedgerByCategory(
      [item("orange", "利口酒"), item("fruit", "利口酒"), item("gin", "金酒")],
      [
        ledger("orange", { openingQty: 2, openingUnitCost: 100, purchaseQty: 3, purchaseCost: 330, consumeQty: 1, closingQty: 4, closingUnitCost: 110, closingCost: 440 }),
        ledger("fruit", { openingQty: 1, openingUnitCost: 80, purchaseQty: 2, purchaseCost: 190, consumeQty: 1, closingQty: 2, closingUnitCost: 90, closingCost: 180 }),
        ledger("gin", { openingQty: 1, openingUnitCost: 200, purchaseQty: 0, purchaseCost: 0, consumeQty: 0.5, closingQty: 0.5, closingUnitCost: 200, closingCost: 100 }),
      ],
    );

    expect(result["利口酒"]).toMatchObject({
      openingQty: 3,
      purchaseQty: 5,
      consumeQty: 2,
      closingQty: 6,
      openingCost: 280,
      purchaseCost: 520,
      consumeCost: 200,
      closingCost: 620,
    });
    expect(result["金酒"]).toMatchObject({ openingCost: 200, purchaseCost: 0, consumeCost: 100, closingCost: 100 });
  });

  it("总结、占比和导出统一显示金额，分类表使用紧凑 iPhone 列宽，库存明细数量列保持独立", () => {
    const workspace = source("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");
    const exporter = source("lib/spirits/export.ts");

    expect(workspace).toContain('(["openingCost", "purchaseCost", "consumeCost", "closingCost"] as const)');
    expect(workspace).toContain("value: v.purchaseCost");
    expect(workspace).toContain("{formatStoreMoney(item.value)} · {item.pct}%");
    expect(workspace).toContain("summaryTableContent: { width: \"100%\", minWidth: 380 }");
    expect(workspace).toContain("summaryTableRow: { flexDirection: \"row\", alignItems: \"center\", minHeight: 40");
    expect(workspace).toContain('testID="spirits-tab-"');
    expect(workspace).toContain("StoreSegmentedTabs");
    expect(exporter).toContain("二、分类汇总（成本金额）");
    expect(exporter).toContain("期初金额(¥)");
    expect(exporter).toContain("期末金额(¥)");
    expect(exporter).toContain("期初库存(瓶)");
  });
});

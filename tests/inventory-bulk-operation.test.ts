import { describe, expect, it } from "vitest";
import { prepareInventoryBulkOperation } from "@/lib/inventory-core/bulk-operation";

describe("共享库存批量操作预检", () => {
  const items = [
    { id: "fresh", active: true, category: "A" },
    { id: "history", active: true, category: "A" },
    { id: "archived", active: false, category: "A" },
  ];
  const getHistory = (id: string) => id === "history"
    ? { purchases: 1, consumes: 0, ledger: 0, snapshots: 0, referencePrices: 0, currentStock: 0 }
    : { purchases: 0, consumes: 0, ledger: 0, snapshots: 0, referencePrices: 0, currentStock: 0 };

  it("删除会把存在历史的项目自动降级为归档，已归档项目不会重复处理", () => {
    const result = prepareInventoryBulkOperation({
      scope: "fruit", action: "delete", selectedIds: ["fresh", "history", "archived"], items, isMonthWritable: true, getHistory,
      now: new Date("2026-08-21T00:00:00.000Z"),
    });
    expect(result.deletableIds).toEqual(["fresh"]);
    expect(result.archivableIds).toEqual(["history"]);
    expect(result.skippedIds).toEqual(["archived"]);
    expect(result.items.find((item) => item.id === "archived")?.reason).toBe("already-archived");
  });

  it("冻结月不允许任何批量分类、归档或删除写入", () => {
    const result = prepareInventoryBulkOperation({
      scope: "spirits", action: "reclassify", selectedIds: ["fresh", "history"], items, isMonthWritable: false, targetCategory: "B", getHistory,
    });
    expect(result.counts).toEqual({ selected: 2, delete: 0, archive: 0, reclassify: 0, skipped: 2 });
    expect(result.items.every((item) => item.reason === "month-locked")).toBe(true);
  });

  it("参考价和现存数量同样使项目只能归档，不能物理删除", () => {
    const result = prepareInventoryBulkOperation({
      scope: "wine", action: "delete", selectedIds: ["fresh"], items, isMonthWritable: true,
      getHistory: () => ({ purchases: 0, consumes: 0, ledger: 0, snapshots: 0, referencePrices: 1, currentStock: 2 }),
    });
    expect(result.archivableIds).toEqual(["fresh"]);
    expect(result.deletableIds).toEqual([]);
  });
});

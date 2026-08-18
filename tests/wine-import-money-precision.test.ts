import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { parseWineInventoryExcel } from "@/lib/wine/excel-import";

describe("葡萄酒导入金额精度", () => {
  it("按供应商归并采购成本并汇总期末成本时按分计算", () => {
    const sheet = utils.aoa_to_sheet([
      ["序号", "类型", "供应商", "商品名称", "期初单价", "期初数量", "期初成本", "进货数量", "进货成本", "期末数量", "期末单价", "期末成本", "消耗瓶数", "消耗数量"],
      [1, "红葡萄酒", "供应商 A", "A-1", 0, 0, 0, 1, 0.1, 1, 0.1, 0.1, 0, 0],
      [2, "红葡萄酒", "供应商 A", "A-2", 0, 0, 0, 1, 0.2, 1, 0.2, 0.2, 0, 0],
      [3, "白葡萄酒", "供应商 A", "A-3", 0, 0, 0, 1, 0.3, 1, 0.3, 0.3, 0, 0],
      [4, "白葡萄酒", "供应商 B", "B-1", 0, 0, 0, 1, 0.1, 1, 0.1, 0.1, 0, 0],
      [5, "白葡萄酒", "供应商 B", "B-2", 0, 0, 0, 1, 0.2, 1, 0.2, 0.2, 0, 0],
    ]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "葡萄酒盘点");

    const result = parseWineInventoryExcel(write(workbook, { type: "base64", bookType: "xlsx" }));

    expect(result).not.toBeNull();
    expect(result?.supplierTotals).toEqual({ "供应商 A": 0.6, "供应商 B": 0.3 });
    expect(result?.totalPurchase).toBe(0.9);
    expect(result?.totalEndCost).toBe(0.9);
  });
});

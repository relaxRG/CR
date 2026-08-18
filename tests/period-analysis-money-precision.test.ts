import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parsePeriodAnalysisExcel } from "@/lib/store/period-analysis/excel-parser";

describe("时段营业分析金额精度", () => {
  it("跨日期与同半小时槽位归并营收时按分汇总", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["时段营业分析"],
      ["营业日期", "半小时", "营业额", "优惠金额", "营业收入", "订单量", "折前单均", "折后单均", "用餐人数", "折前人均", "折后人均"],
      ["2026/07/01", "11:00-11:30", 0.1, 0, 0.1, 1, 0.1, 0.1, 1, 0.1, 0.1],
      ["2026/07/01", "11:30-12:00", 0.2, 0, 0.2, 1, 0.2, 0.2, 1, 0.2, 0.2],
      ["2026/07/02", "11:00-11:30", 0.3, 0, 0.3, 1, 0.3, 0.3, 1, 0.3, 0.3],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "营业分析");
    const encoded = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const result = parsePeriodAnalysisExcel([encoded]);

    expect(result).not.toBeNull();
    expect(result?.monthlyTotals.lunch.revenue).toBe(0.6);
    expect(result?.slotDistribution["11:00-11:30"]?.totalRevenue).toBe(0.4);
    expect(result?.slotDistribution["11:00-11:30"]?.avgRevenue).toBe(0.2);
  });
});

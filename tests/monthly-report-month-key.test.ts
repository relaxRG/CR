import { describe, expect, it } from "vitest";
import {
  normalizeMonthlyReportMonth,
  replaceMonthlyReportForBusinessMonth,
} from "@/lib/store/monthly-report/month-key";

describe("月报业务月份唯一标识", () => {
  it("将 2026/07、2026-7 和 2026-07 识别为同一业务月份", () => {
    expect(normalizeMonthlyReportMonth("2026/07")).toBe("2026-07");
    expect(normalizeMonthlyReportMonth("2026-7")).toBe("2026-07");
    expect(normalizeMonthlyReportMonth("2026-07")).toBe("2026-07");
  });

  it("新导入月报替换同一业务月份的旧快照，而不影响其他月份", () => {
    const current = [
      { id: "old-july", rawMonth: "2026/07" },
      { id: "june", rawMonth: "2026-06" },
    ];
    const next = replaceMonthlyReportForBusinessMonth(current, { id: "new-july", rawMonth: "2026-07" });

    expect(next).toEqual([
      { id: "new-july", rawMonth: "2026-07" },
      { id: "june", rawMonth: "2026-06" },
    ]);
  });

  it("无法识别月份时不删除任何历史快照", () => {
    const current = [{ id: "july", rawMonth: "2026/07" }];
    const next = replaceMonthlyReportForBusinessMonth(current, { id: "unknown", rawMonth: "未知月份" });

    expect(next.map((item) => item.id)).toEqual(["unknown", "july"]);
  });
});

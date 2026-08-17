import { describe, expect, it } from "vitest";
import {
  clampReportMonth,
  deriveReportMonthBounds,
  normalizeReportMonth,
  reportMonthHasData,
} from "@/lib/reporting/month-navigation";

describe("报表统一月份导航", () => {
  it("从总月报、经营分析、账户和流水的并集派生唯一受限边界", () => {
    const bounds = deriveReportMonthBounds([
      "2025-01",          // 总月报
      "2025/03",          // 经营分析导入
      "2025-04-18",       // 账户/收入流水
      "2025年6月",        // 薪资单
      "", null, undefined,
    ]);

    expect(bounds).toEqual({ min: "2024-12", max: "2025-07" });
    expect(normalizeReportMonth("2025/03")).toBe("2025-03");
    expect(normalizeReportMonth("2025年6月")).toBe("2025-06");
  });

  it("只在共享边界变化后钳制月份，而不因当前页面无数据改写选择", () => {
    const bounds = { min: "2025-01" as const, max: "2025-06" as const };
    const canonicalMonth = "2025-04" as const;
    const accountMonths = ["2025-02"];
    const analyticsMonths = ["2025-03"];

    expect(reportMonthHasData(accountMonths, canonicalMonth)).toBe(false);
    expect(reportMonthHasData(analyticsMonths, canonicalMonth)).toBe(false);
    // 无数据页面必须继续显示 canonicalMonth 的空状态，而不是跳回自己的最近数据月。
    expect(clampReportMonth(canonicalMonth, bounds)).toBe(canonicalMonth);
    expect(clampReportMonth("2024-12", bounds)).toBe("2025-01");
    expect(clampReportMonth("2025-07", bounds)).toBe("2025-06");
  });

  it("兼容旧路由与持久化中的斜杠月份格式，并拒绝非法月份", () => {
    const bounds = { min: "2025-01" as const, max: "2025-06" as const };
    expect(clampReportMonth("2025/05", bounds)).toBe("2025-05");
    expect(normalizeReportMonth("2025-02-30")).toBeNull();
    expect(clampReportMonth("invalid", bounds)).toBe("2025-06");
  });
});

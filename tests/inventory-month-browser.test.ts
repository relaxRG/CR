import { describe, expect, it } from "vitest";
import {
  addInventoryMonths,
  canNavigateInventoryMonth,
  clampInventoryMonth,
  deriveInventoryMonthBounds,
  inventoryMonthsForYear,
  normalizeInventoryMonth,
} from "@/lib/inventory-core/month-browser";

describe("库存统一月份浏览器", () => {
  it("所有门店模块只在业务月份并集的两端各预留一个月", () => {
    const bounds = deriveInventoryMonthBounds([
      "2024-03-15", // 烈酒采购 / 员工排班
      "2025年11月", // 葡萄酒快照 / 报表月结
      "2024-08", // 店铺台账 / 备用金流水
    ]);

    expect(bounds).toEqual({ min: "2024-02", max: "2025-12" });
    expect(canNavigateInventoryMonth("2024-02", -1, bounds)).toBe(false);
    expect(canNavigateInventoryMonth("2025-12", 1, bounds)).toBe(false);
    expect(canNavigateInventoryMonth("2024-02", 1, bounds)).toBe(true);
    expect(canNavigateInventoryMonth("2025-12", -1, bounds)).toBe(true);
  });

  it("单月数据跨年时仍只向首尾各扩展一个月", () => {
    expect(deriveInventoryMonthBounds(["2025-01-01"])).toEqual({ min: "2024-12", max: "2025-02" });
    expect(deriveInventoryMonthBounds(["2025-12-31"])).toEqual({ min: "2025-11", max: "2026-01" });
  });

  it("忽略非法日期和商品建档类非业务日期，避免错误扩大可浏览范围", () => {
    const bounds = deriveInventoryMonthBounds([
      "", null, undefined, "2024-13-01", "2024-02-30", "not-a-month", "2025-06-18",
    ]);

    expect(bounds).toEqual({ min: "2025-05", max: "2025-07" });
    expect(normalizeInventoryMonth("2024-02-30")).toBeNull();
  });

  it("在没有任何业务记录时默认选中当前自然月且前后按钮均禁用", () => {
    const bounds = deriveInventoryMonthBounds([], "2026-08");
    expect(bounds).toEqual({ min: "2026-08", max: "2026-08" });
    expect(canNavigateInventoryMonth("2026-08", -1, bounds)).toBe(false);
    expect(canNavigateInventoryMonth("2026-08", 1, bounds)).toBe(false);
  });

  it("无数据跨年默认月保持调用方给定的当前自然月", () => {
    expect(deriveInventoryMonthBounds([], "2025-01")).toEqual({ min: "2025-01", max: "2025-01" });
    expect(deriveInventoryMonthBounds([null, "invalid"], "2026-12")).toEqual({ min: "2026-12", max: "2026-12" });
  });

  it("持久化月份、路由参数或同步旧值超出新范围时必须钳制", () => {
    const bounds = { min: "2024-02" as const, max: "2025-12" as const };
    expect(clampInventoryMonth("2023-12", bounds)).toBe("2024-02");
    expect(clampInventoryMonth("2026-01", bounds)).toBe("2025-12");
    expect(clampInventoryMonth("invalid", bounds)).toBe("2025-12");
    expect(clampInventoryMonth("2025-08", bounds)).toBe("2025-08");
  });

  it("年份网格只返回边界内月份，跨年加减保持正确", () => {
    const bounds = { min: "2024-02" as const, max: "2025-12" as const };
    expect(inventoryMonthsForYear(2024, bounds)).toEqual([
      "2024-02", "2024-03", "2024-04", "2024-05", "2024-06", "2024-07",
      "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
    ]);
    expect(inventoryMonthsForYear(2026, bounds)).toEqual([]);
    expect(addInventoryMonths("2025-01", -1)).toBe("2024-12");
    expect(addInventoryMonths("2025-12", 1)).toBe("2026-01");
  });
});

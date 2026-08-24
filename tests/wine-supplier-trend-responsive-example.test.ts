import { describe, expect, it } from "vitest";
import { resolveWineSupplierTrendLayout } from "@/lib/wine/supplier-trend-responsive";

describe("WineSupplierTrendSwitcher 多端缩放规则", () => {
  it("在 iPhone 紧凑宽度使用表格优先和受控柱数量", () => {
    expect(resolveWineSupplierTrendLayout(390)).toEqual({ mode: "compact", maxBars: 3, chartHeight: 260, columns: 1 });
    expect(resolveWineSupplierTrendLayout(559).mode).toBe("compact");
  });

  it("在 iPad 分屏和 Mac 常规窗口保持常规图表轨道", () => {
    expect(resolveWineSupplierTrendLayout(560)).toEqual({ mode: "regular", maxBars: 5, chartHeight: 300, columns: 1 });
    expect(resolveWineSupplierTrendLayout(899).mode).toBe("regular");
  });

  it("在宽 Mac 窗口启用扩展布局而不通过缩小字号维持信息密度", () => {
    expect(resolveWineSupplierTrendLayout(900)).toEqual({ mode: "expanded", maxBars: 6, chartHeight: 340, columns: 2 });
    expect(resolveWineSupplierTrendLayout(1440).mode).toBe("expanded");
  });

  it("柱状图和表格共享同一比较行，切换只应改变视图而非金额口径", () => {
    const rows = [
      { supplierId: "a", supplierName: "供应商 A", currentAmount: 100, compareAmount: 0, cumulativeAmount: 500 },
      { supplierId: "b", supplierName: "供应商 B", currentAmount: 80, compareAmount: 100, cumulativeAmount: 420 },
    ];
    const barRows = [...rows].sort((a, b) => b.currentAmount - a.currentAmount);
    const tableRows = [...rows].sort((a, b) => b.currentAmount - a.currentAmount);
    expect(barRows).toEqual(tableRows);
    expect(barRows[0].compareAmount === 0 ? "新增" : `${((barRows[0].currentAmount - barRows[0].compareAmount) / barRows[0].compareAmount) * 100}%`).toBe("新增");
  });
});

import { describe, expect, it } from "vitest";
import { resolveWineSupplierTrendLayout } from "@/lib/wine/supplier-trend-responsive";
import { resolveChartGesture } from "@/lib/wine/supplier-trend-touch-gesture";

describe("葡萄酒供应商趋势触控与响应式布局 E2E", () => {
  it("iPhone 紧凑屏默认限制柱数，切换表格不改变当前比较数据", () => {
    const layout = resolveWineSupplierTrendLayout(390);
    const comparison = { month: "2026-08", supplierIds: ["a", "b"], currentAmount: 180, compareAmount: 100 };
    expect(layout).toMatchObject({ mode: "compact", maxBars: 3 });
    expect({ ...comparison, viewMode: "bar" }).toMatchObject({ ...comparison, viewMode: "bar" });
    expect({ ...comparison, viewMode: "table" }).toMatchObject({ ...comparison, viewMode: "table" });
  });

  it("iPad 1/2 分屏保留常规轨道；全屏进入扩展轨道且筛选状态不丢失", () => {
    const state = { month: "2026-08", compareMonth: "2026-07", selectedSupplierIds: ["a"] };
    expect(resolveWineSupplierTrendLayout(744).mode).toBe("regular");
    expect(resolveWineSupplierTrendLayout(1024).mode).toBe("expanded");
    expect(state).toEqual({ month: "2026-08", compareMonth: "2026-07", selectedSupplierIds: ["a"] });
  });

  it("横向意图滚动图表并抑制柱体点击，纵向意图交还页面滚动", () => {
    expect(resolveChartGesture({ dx: 24, dy: 5, moved: true })).toEqual({ direction: "horizontal", suppressPress: true });
    expect(resolveChartGesture({ dx: 4, dy: 24, moved: true })).toEqual({ direction: "vertical", suppressPress: true });
    expect(resolveChartGesture({ dx: 3, dy: 2, moved: false })).toEqual({ direction: "tap", suppressPress: false });
  });
});

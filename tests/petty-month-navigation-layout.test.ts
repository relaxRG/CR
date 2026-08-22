import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("备用金月份导航与页面操作层级", () => {
  const petty = read("components/store/petty-cash.tsx");
  const businessNavigator = read("components/months/BoundedBusinessMonthNavigator.tsx");
  const sharedNavigator = read("components/inventory/BoundedMonthNavigator.tsx");
  const labor = read("components/labor/LaborWorkspaceScreen.tsx");
  const store = read("app/(tabs)/store.tsx");
  const inventory = read("components/store/inventory.tsx");

  it("二级页签位于月份选择器之前，并使用员工Tag同层级的40pt文字分段", () => {
    expect(petty.indexOf("{renderViewTabs()}")).toBeLessThan(petty.indexOf("{renderHeader()}"));
    expect(petty).toContain("<StoreSegmentedTabs");
    expect(petty).toContain('testID="petty-workspace-tabs"');
    expect(petty).toContain("minHeight: 40");
  });

  it("备用金、报表与库存通过同一月份导航实现，且中间按钮不显示下拉箭头", () => {
    expect(businessNavigator).toContain('import { BoundedMonthNavigator }');
    expect(businessNavigator).toContain("<BoundedMonthNavigator");
    expect(sharedNavigator).toContain("subject?: string");
    expect(sharedNavigator).not.toContain('name="chevron.down"');
    expect(sharedNavigator).toContain('>选择{subject}月份</Text>');
  });

  it("报表、员工、库存和店铺均使用同一40pt层级与月份组件", () => {
    expect(labor).toContain("<BoundedBusinessMonthNavigator");
    expect(labor).toContain('testID="labor-month-navigator"');
    expect(labor).toContain("<StoreSegmentedTabs");
    expect(store).toContain('testID="report-workspace-month-navigator"');
    expect(store).toContain("<StoreSegmentedTabs");
    expect(inventory).toContain('subject={mode === "shop" ? "店铺" : "库存"}');
  });

  it("备用金总览在 iPhone 上对大额金额保持单行缩放，期间摘要不发生横向溢出或卡片拉高", () => {
    expect(petty).toContain('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}');
    expect(petty).toContain('summaryHalf: { flex: 1, minWidth: 0, padding: 16 }');
    expect(petty).toContain('summarySub: { fontSize: 12, flex: 1, minWidth: 0 }');
    expect(petty).toContain('periodItem: { flex: 1, minWidth: 0, alignItems: "center" }');
  });

  it("新增记录属于当前页面操作栏，日历选中日期会作为新增记录日期，且不存在悬浮加号", () => {
    expect(petty).toContain("const renderContextActions");
    expect(petty).toContain('label="新增记录"');
    expect(petty).toContain("selectedDay ? `${month}-${String(selectedDay).padStart(2, \"0\")}`");
    expect(petty).not.toContain("S.fab");
    expect(petty).not.toContain("fabIcon");
    expect(petty).toContain("<StoreToolbarAction");
    expect(petty).toContain("minHeight: 36");
  });
});

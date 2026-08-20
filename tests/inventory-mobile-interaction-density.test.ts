import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("库存工作台紧凑布局与移动端交互护栏", () => {
  it("食材仅在总结页保留月度概况，不再渲染常驻顶部汇总行", () => {
    const food = read("app/food-inventory.tsx");
    expect(food).toContain('{tab === "summary" && (');
    expect(food).not.toContain("{/* 汇总行 */}");
    expect(food).not.toContain("summaryRow:");
  });

  it("葡萄酒供应商使用同页标签和供货商信息工作台，不再重复渲染库存台账", () => {
    const wine = read("app/wine-inventory.tsx");
    expect(wine).toContain('testID="wine-supplier-inline-workspace"');
    expect(wine).toContain('testID="wine-supplier-tabs"');
    expect(wine).toContain("supplierInfoCard");
    expect(wine).toContain('testID="wine-supplier-record-purchase"');
    expect(wine).toContain('testID="wine-supplier-open-library"');
    expect(wine).toContain('testID={`wine-tab-${t.key}`}');
    expect(wine).not.toContain("wine-supplier-horizontal-ledger-table");
    expect(wine).not.toContain("function SupplierCard");
    expect(wine).not.toContain("supplierSummaryCard:");
  });

  it("通用库存的标签、工具栏、表格及专有弹窗统一具备滚动轴和键盘交互保护", () => {
    const base = read("components/inventory/BaseInventoryScreen.tsx");
    const table = read("components/inventory/HorizontalLedgerTable.tsx");
    const glassware = read("app/glassware-inventory.tsx");
    const tableware = read("app/tableware-inventory.tsx");
    const daily = read("app/daily-inventory.tsx");
    const equipment = read("app/equipment-inventory.tsx");

    expect(base).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
    expect(base).toContain('keyboardShouldPersistTaps="handled"');
    expect(base).toContain("<StoreSegmentedTabs");
    expect(base).toContain('testID={`${categoryId}-inventory-tabs`}');
    expect(read("components/store/store-visual-primitives.tsx")).toContain("minHeight: 40");
    expect(table).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
    expect(table).toContain("hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}");

    for (const source of [glassware, tableware]) {
      expect(source).toContain('keyboardShouldPersistTaps="handled"');
      expect(source).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
      expect(source).toContain("chip: { minHeight: 40");
    }
    expect(daily).toContain('keyboardShouldPersistTaps="handled"');
    expect(daily).toContain("modeBtn: { flex: 1, minHeight: 40");
    expect(equipment).toContain('keyboardShouldPersistTaps="handled"');
    expect(equipment).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
    expect(equipment).toContain("chip: { minHeight: 40");
  });

  it("十个库存与店铺分类的业务页签均使用40pt紧凑触控尺寸", () => {
    const spirits = read("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");
    const wine = read("app/wine-inventory.tsx");
    const food = read("app/food-inventory.tsx");
    const equipment = read("app/equipment-inventory.tsx");
    for (const source of [spirits, wine, food]) {
      expect(source).toContain("INVENTORY_WORKSPACE_METRICS.segmentHeight");
    }
    expect(equipment).toContain("minHeight: 40");
    expect(food).toContain('testID={`food-tab-${t.key}`}');
    expect(equipment).toContain('testID={`equipment-tab-${t.key}`}');
  });

  it("H5回归覆盖十类分类页签的尺寸一致性以及葡萄酒供货商信息工作台", () => {
    const h5 = read("scripts/h5-schedule-correction-e2e.mjs");
    expect(h5).toContain("葡萄酒供货商信息工作台");
    expect(h5).toContain("wine-tab-supplier");
    expect(h5).toContain("wine-supplier-open-library");
    expect(h5).toContain("wine-supplier-record-purchase");
    expect(h5).toContain("fruit-inventory-tab-summary");
    expect(h5).toContain("水果总结页签");
    expect(h5).toContain("十类分类页签尺寸一致性");
    expect(h5).toContain("categoryTabSpecs");
    for (const label of ["烈酒", "葡萄酒", "水果", "食材", "啤酒", "冰块", "杯具", "餐具", "日用品", "设备"]) {
      expect(h5).toContain(`label: \"${label}\"`);
    }
  });
});

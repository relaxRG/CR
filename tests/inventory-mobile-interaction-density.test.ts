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

  it("葡萄酒供应商使用同页标签和直接横向台账，彻底删除供应商卡片入口", () => {
    const wine = read("app/wine-inventory.tsx");
    expect(wine).toContain('testID="wine-supplier-inline-workspace"');
    expect(wine).toContain('testID="wine-supplier-tabs"');
    expect(wine).toContain('testID="wine-supplier-horizontal-ledger-table"');
    expect(wine).toContain('testID="wine-supplier-record-purchase"');
    expect(wine).toContain('testID={`wine-tab-${t.key}`}');
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
    expect(base).toContain("tabChip: { minHeight: 44");
    expect(table).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
    expect(table).toContain("hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}");

    for (const source of [glassware, tableware]) {
      expect(source).toContain('keyboardShouldPersistTaps="handled"');
      expect(source).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
      expect(source).toContain("chip: { minHeight: 44");
    }
    expect(daily).toContain('keyboardShouldPersistTaps="handled"');
    expect(daily).toContain("modeBtn: { flex: 1, minHeight: 44");
    expect(equipment).toContain('keyboardShouldPersistTaps="handled"');
    expect(equipment).toContain("horizontal nestedScrollEnabled directionalLockEnabled");
    expect(equipment).toContain("chip: { minHeight: 44");
  });

  it("H5回归覆盖葡萄酒供应商同页明细的标签、滚动、录入入口与详情卡片", () => {
    const h5 = read("scripts/h5-schedule-correction-e2e.mjs");
    expect(h5).toContain("葡萄酒供应商同页明细");
    expect(h5).toContain("wine-tab-supplier");
    expect(h5).toContain("wine-supplier-horizontal-ledger-table");
    expect(h5).toContain("wine-supplier-record-purchase");
  });
});

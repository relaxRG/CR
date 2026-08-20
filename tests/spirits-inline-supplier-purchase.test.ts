import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("烈酒当月进货供应商同页工作台", () => {
  const screen = read("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");
  const h5 = read("scripts/h5-schedule-correction-e2e.mjs");

  it("以供应商标签和同排新增入口替代重复合计卡与供应商入口卡片", () => {
    expect(screen).toContain('testID="spirits-purchase-inline-workspace"');
    expect(screen).toContain('testID="spirits-purchase-supplier-tabs"');
    expect(screen).toContain('testID="spirits-purchase-add-supplier"');
    expect(screen).toContain("新增供应商");
    expect(screen).not.toContain("当月合计卡");
    expect(screen).not.toContain("进货合计");
    expect(screen).not.toContain('accessibilityLabel="返回供应商列表"');
  });

  it("选中供应商后在当前业务页直接渲染明细，不隐藏顶部业务页签", () => {
    expect(screen).toContain("const selectedSupplier = activeSupplier ?? allSupplierNames[0] ?? null;");
    expect(screen).toContain('testID="spirits-supplier-purchase-detail"');
    expect(screen).toContain("setActiveSupplier(createdSupplierName);");
    expect(screen).not.toContain("activeSupplier === null ? (");
    expect(screen).not.toContain("onBack={() => setActiveSupplier(null)}");
  });

  it("H5回归覆盖供应商标签、直接明细、重复合计删除与窄屏防溢出", () => {
    expect(h5).toContain('spirits-purchase-supplier-tab-H5供应商');
    expect(h5).toContain('spirits-purchase-add-supplier');
    expect(h5).toContain('spirits-supplier-purchase-detail');
    expect(h5).toContain("hasLegacySummary: document.body.innerText.includes('进货合计')");
    expect(h5).toContain("未完成供应商同页标签明细改造");
  });
});

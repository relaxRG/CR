import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/spirits-inventory.tsx"), "utf8");

describe("烈酒库存双视图与完整Excel台账", () => {
  it("保留移动三列概览，并改为用户可选择的双视图而不是屏幕宽度自动替换", () => {
    expect(source).toContain('usePersistedState<"compact" | "table">("spirits.ledger.view-mode.v1", "compact")');
    expect(source).toContain('testID="spirits-ledger-compact-list"');
    expect(source).toContain('testID="spirits-ledger-view-switcher"');
    expect(source).not.toContain("useCompactLedger");
  });

  it("完整表固定包含期初、进货、期末、消耗字段并将集团置于最右", () => {
    const header = source.slice(source.indexOf('/* 14列：'), source.indexOf('/* 按分类分组'));
    expect(header).toContain('["商品名称", "name", 136]');
    expect(header).toContain('["期初库存量", "openingQty", 76]');
    expect(header).toContain('["进货数量", "purchaseQty", 76]');
    expect(header).toContain('["期末单位成本", "closingUnitCost", 82]');
    expect(header).toContain('["消耗成本", "consumeCost", 76]');
    expect(header).toContain('["集团", "group", 100]');
    expect(header.indexOf('"consumeCost"')).toBeLessThan(header.indexOf('"group"'));
  });

  it("名称点击继续打开详情卡片，完整表的筛选合计只计算可见行", () => {
    expect(source).toContain('onPress={() => { tap(); setSelectedLedgerItemId(item.id); }}');
    expect(source).toContain('calculateLedgerTableTotals(visibleLedgerRows)');
    expect(source).toContain('visibleLedgerTotals.consumeCost');
  });

  it("新增、导入、编辑期初、分类管理、月结和月末盘点在同一横向工具栏中可达", () => {
    const toolbar = source.slice(source.indexOf('/* 操作栏：同一行横向滚动，不裁切文字或图标。 */'), source.indexOf('spirits-ledger-view-switcher'));
    for (const label of ["新增酒款", "导入Excel", "编辑期初", "管理进销存分类", "月结", "月末盘点"]) expect(toolbar).toContain(label);
    expect(toolbar).toContain('horizontal showsHorizontalScrollIndicator={false}');
    expect(toolbar).toContain('minHeight: 60');
    expect(source).toContain('flexShrink: 0, minHeight: 44');
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/spirits-inventory.tsx"), "utf8");

describe("烈酒库存完整Excel台账", () => {
  it("库存管理不再提供移动概览或持久化视图切换，直接展示唯一Excel台账", () => {
    expect(source).not.toContain('spirits.ledger.view-mode.v1');
    expect(source).not.toContain('ledgerViewMode');
    expect(source).not.toContain('compactLedgerSections');
    expect(source).not.toContain('spirits-ledger-compact-list');
    expect(source).not.toContain('spirits-ledger-view-switcher');
    expect(source).toContain('库存管理直接展示完整Excel台账；商品名称点击仍打开详情卡片。');
    expect(source).toContain('ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}');
  });

  it("完整表固定包含期初、进货、期末、消耗字段并将集团置于最右", () => {
    const header = source.slice(source.indexOf('/* 14列：'), source.indexOf('/* 按分类分组'));
    expect(header).toContain('["商品名称", "name", 184]');
    expect(header).toContain('["参考价", "referencePrice", 96]');
    expect(header).toContain('["期初量", "openingQty", 88]');
    expect(header).toContain('["进货量", "purchaseQty", 88]');
    expect(header).toContain('["期末单价", "closingUnitCost", 112]');
    expect(header).toContain('["消耗成本", "consumeCost", 112]');
    expect(header).toContain('["集团", "group", 140]');
    expect(header.indexOf('"consumeCost"')).toBeLessThan(header.indexOf('"group"'));
  });

  it("名称点击继续打开详情卡片，完整表的筛选合计只计算可见行", () => {
    expect(source).toContain('testID={`spirits-ledger-table-name-${item.id}`}');
    expect(source).toContain('onPress={() => { tap(); setSelectedLedgerItemId(item.id); }}');
    expect(source).toContain('calculateLedgerTableTotals(visibleLedgerRows)');
    expect(source).toContain('visibleLedgerTotals.consumeCost');
  });

  it("新增、导入、编辑期初、分类管理、月结和月末盘点在同一横向工具栏中可达", () => {
    const toolbar = source.slice(source.indexOf('/* 操作栏：同一行横向滚动，不裁切文字或图标。 */'), source.indexOf('/* 库存管理直接展示完整Excel台账；商品名称点击仍打开详情卡片。 */'));
    for (const label of ["新增酒款", "导入Excel", "编辑期初", "管理进销存分类", "月结", "月末盘点"]) expect(toolbar).toContain(label);
    expect(toolbar).toContain('horizontal showsHorizontalScrollIndicator={false}');
    expect(toolbar).toContain('minHeight: 60');
    expect(source).toContain('flexShrink: 0, minHeight: 44');
  });
});

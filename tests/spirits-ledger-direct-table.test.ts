import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");

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
    const header = source.slice(source.indexOf('const SPIRIT_LEDGER_COLUMNS'), source.indexOf('// ─── 主页面'));
    expect(header).toContain('["商品名称", "name", 140]');
    expect(header).toContain('["参考价", "referencePrice", 62]');
    expect(header).toContain('["期初量", "openingQty", 56]');
    expect(header).toContain('["进货量", "purchaseQty", 56]');
    expect(header).toContain('["期末单价", "closingUnitCost", 68]');
    expect(header).toContain('["消耗成本", "consumeCost", 76]');
    expect(header).toContain('["集团", "group", 84]');
    expect(header.indexOf('"consumeCost"')).toBeLessThan(header.indexOf('"group"'));
  });

  it("表头、分类条、商品行和合计行共享唯一紧凑列轨道，不产生横向错位", () => {
    expect(source).toContain('const SPIRIT_LEDGER_COLUMNS');
    expect(source).toContain('resolveInventoryTableWindowLayout');
    expect(source).toContain('ledgerWindowLayout.tableWidth');
    expect(source).toContain('testID="spirits-ledger-header"');
    expect(source).toContain('testID={`spirits-ledger-category-${cat}`}');
    expect(source).toContain('testID="spirits-ledger-total"');
    expect(source).toContain('width: ledgerColumnWidths.name');
    expect(source).toContain('width: ledgerColumnWidths.group');
    expect(source).toContain('ledgerCell: { paddingHorizontal: 3');
  });

  it("名称点击继续打开详情卡片，完整表的筛选合计只计算可见行", () => {
    expect(source).toContain('testID={`spirits-ledger-table-name-${item.id}`}');
    expect(source).toContain('if (ledgerSelectMode) toggleLedgerSelection(item.id); else setSelectedLedgerItemId(item.id);');
    expect(source).toContain('testID={`spirits-ledger-select-${item.id}`}');
    expect(source).toContain('calculateLedgerTableTotals(visibleLedgerRows)');
    expect(source).toContain('visibleLedgerTotals.consumeCost');
  });

  it("采购删除以删除后的采购集重算台账，最后一笔采购删除后会显式归零", () => {
    const storeSource = readFileSync(resolve(process.cwd(), "lib/spirits/crud-store.tsx"), "utf8");
    expect(storeSource).toContain("purchaseSource: readonly SpiritPurchaseRecord[] = state.purchases");
    expect(storeSource).toContain("...getMonthLedger(month).map((entry) => entry.itemId)");
    expect(storeSource).toContain("const records = byItem[itemId] ?? [];");
    expect(source).toContain("const deletePurchasesAndResync");
    expect(source).toContain("syncLedgerFromPurchases(affectedMonth, [], remainingPurchases)");
  });

  it("新增、导入、编辑期初、分类管理、月结和月末盘点在同一横向工具栏中可达", () => {
    const toolbar = source.slice(source.indexOf('/* 操作栏：同一行横向滚动，保留完整文本操作。 */'), source.indexOf('/* 库存管理直接展示完整Excel台账；商品名称点击仍打开详情卡片。 */'));
    for (const label of ["新增酒款", "选择", "导入Excel", "编辑期初", "管理进销存分类", "月结", "月末盘点"]) expect(toolbar).toContain(label);
    expect(toolbar).toContain('horizontal showsHorizontalScrollIndicator={false}');
    expect(toolbar).not.toContain('<IconSymbol');
    expect(source).toContain('INVENTORY_WORKSPACE_METRICS.actionHeight');
    expect(source).toContain('INVENTORY_WORKSPACE_METRICS.segmentHeight');
  });
});

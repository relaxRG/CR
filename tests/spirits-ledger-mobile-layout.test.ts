import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/inventory/SpiritsInventoryWorkspaceScreen.tsx", "utf8");

describe("烈酒库存移动端Excel台账", () => {
  it("库存管理移除移动概览分区并直接渲染唯一的完整Excel台账", () => {
    expect(source).not.toContain('spirits.ledger.view-mode.v1');
    expect(source).not.toContain('spirits-ledger-compact-list');
    expect(source).not.toContain('spirits-ledger-view-switcher');
    expect(source).not.toContain('ledgerViewMode');
    expect(source).toContain('库存管理直接展示完整Excel台账；商品名称点击仍打开详情卡片。');
    expect(source).toContain('ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}');
  });

  it("点击Excel台账中的商品名称仍提供期初、进货、期末和消耗详情卡片，并复用现有写入入口", () => {
    expect(source).toContain('testID={`spirits-ledger-table-name-${item.id}`}');
    expect(source).toContain('testID="spirits-ledger-detail-sheet"');
    expect(source).toContain('title="期初"');
    expect(source).toContain('title="本月进货"');
    expect(source).toContain('title="期末库存"');
    expect(source).toContain('title="本期消耗"');
    expect(source).toContain('handleSaveOpeningQty(selectedLedgerEntry, raw)');
    expect(source).toContain('openBottleForSpiritItem(item)');
    expect(source).toContain('setShowCatPicker(true)');
  });

  it("Excel台账保持局部横向滚动并包含完整期初、进货、期末、消耗和集团字段", () => {
    expect(source).toContain('期初量');
    expect(source).toContain('进货量');
    expect(source).toContain('消耗量');
    expect(source).toContain('["集团", "group", 84]');
    expect(source).toContain('["商品名称", "name", 140]');
    expect(source).not.toContain('{label}⌄');
    expect(source).toContain('minHeight: STORE_TABLE_METRICS.rowHeight');
    expect(source).toContain('resolveInventoryTableWindowLayout');
    expect(source).toContain('ledgerWindowLayout.tableWidth, backgroundColor: colors.primary');
    expect(source).toContain('width: ledgerColumnWidths.name');
    expect(source).toContain('width: ledgerColumnWidths.group');
  });

  it("为窄屏横向滚动回归保留稳定的业务页签和操作栏定位标识", () => {
    expect(source).toContain('testID="spirits-inventory-action-toolbar"');
    expect(source).toContain('testID="spirits-ledger-select-toggle"');
    expect(source).toContain('testID="spirits-ledger-batch-toolbar"');
    expect(source).toContain('testID="spirits-tab-"');
    expect(source).toContain("StoreSegmentedTabs");
  });
});

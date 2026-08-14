import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/spirits-inventory.tsx", "utf8");

describe("烈酒库存移动端双视图", () => {
  it("保留三列移动概览，同时允许用户切换到完整Excel台账", () => {
    expect(source).toContain('usePersistedState<"compact" | "table">("spirits.ledger.view-mode.v1", "compact")');
    expect(source).toContain('testID="spirits-ledger-compact-list"');
    expect(source).toContain('testID="spirits-ledger-view-switcher"');
    expect(source).toContain('期末库存');
    expect(source).toContain('期末成本');
    expect(source).not.toContain("useCompactLedger");
  });

  it("点击移动概览名称仍提供期初、进货、期末和消耗完整详情卡片，并复用现有写入入口", () => {
    expect(source).toContain('testID="spirits-ledger-detail-sheet"');
    expect(source).toContain('title="期初"');
    expect(source).toContain('title="本月进货"');
    expect(source).toContain('title="期末库存"');
    expect(source).toContain('title="本期消耗"');
    expect(source).toContain('handleSaveOpeningQty(selectedLedgerEntry, raw)');
    expect(source).toContain('setShowItemForm(true)');
    expect(source).toContain('setShowCatPicker(true)');
  });

  it("Excel台账保持局部横向滚动并包含完整期初、进货、期末、消耗和集团字段", () => {
    expect(source).toContain('ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}');
    expect(source).toContain('期初库存量');
    expect(source).toContain('进货数量');
    expect(source).toContain('消耗瓶数');
    expect(source).toContain('["集团", "group", 100]');
  });
});

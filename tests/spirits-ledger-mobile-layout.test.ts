import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/spirits-inventory.tsx", "utf8");

describe("烈酒库存移动端紧凑台账", () => {
  it("在窄屏使用实时断点和主列紧凑列表，而不压缩14列宽表", () => {
    expect(source).toContain('const useCompactLedger = viewportWidth < 600;');
    expect(source).toContain('testID="spirits-ledger-compact-list"');
    expect(source).toContain('useCompactLedger ? (');
    expect(source).toContain('期末库存');
    expect(source).toContain('期末成本');
  });

  it("通过抽屉提供期初、进货、期末和消耗完整数据，且复用现有写入入口", () => {
    expect(source).toContain('testID="spirits-ledger-detail-sheet"');
    expect(source).toContain('title="期初"');
    expect(source).toContain('title="本月进货"');
    expect(source).toContain('title="期末库存"');
    expect(source).toContain('title="本期消耗"');
    expect(source).toContain('handleSaveOpeningQty(selectedLedgerEntry, raw)');
    expect(source).toContain('setShowItemForm(true)');
    expect(source).toContain('setShowCatPicker(true)');
  });

  it("保留宽屏横向对账表，不把局部数据表误改为整页分页", () => {
    expect(source).toContain(') : (\n          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>');
    expect(source).toContain('期初库存量');
    expect(source).toContain('本月进货量');
    expect(source).toContain('本期消耗量');
  });
});

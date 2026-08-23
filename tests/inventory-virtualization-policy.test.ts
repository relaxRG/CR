import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("通用库存长台账性能护栏", () => {
  it("超过 80 条库存时使用窗口化横向台账，短列表保留轻量普通表格", () => {
    const screen = read("components/inventory/BaseInventoryScreen.tsx");
    expect(screen).toContain('import { VirtualizedHorizontalLedgerTable } from "./VirtualizedHorizontalLedgerTable"');
    expect(screen).toContain("activeItems.length >= 80 ? (");
    expect(screen).toContain("<VirtualizedHorizontalLedgerTable");
    expect(screen).toContain("<HorizontalLedgerTable");
  });

  it("窗口化台账支持原有批量选择，固定列、表头和分类行在多选模式下保持宽度对齐", () => {
    const table = read("components/inventory/VirtualizedHorizontalLedgerTable.tsx");
    expect(table).toContain("type LedgerSelection<Row>");
    expect(table).toContain("selection?: LedgerSelection<Row>");
    expect(table).toContain("onToggleAll: () => void");
    expect(table).toContain("onToggleRow: (row: Row) => void");
    expect(table).toContain("selectionWidth");
    expect(table).toContain("testIDPrefix ? `${selection.testIDPrefix}-select-${rowKey(entry.row)}`");
  });
});

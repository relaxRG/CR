import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("葡萄酒工作台长列表性能护栏", () => {
  it("库存管理使用虚拟化横向台账，而不是同步渲染全部台账行", () => {
    const wine = read("app/wine-inventory.tsx");
    expect(wine).toContain("VirtualizedHorizontalLedgerTable");
    expect(wine).not.toContain("<HorizontalLedgerTable\n                testID=\"wine-horizontal-ledger-table\"");
  });

  it("虚拟化表格以可视区窗口和上下缓冲渲染，保留固定表头和横向滚动", () => {
    const table = read("components/inventory/VirtualizedHorizontalLedgerTable.tsx");
    expect(table).toContain("const OVERSCAN_PX = ROW_HEIGHT * 12");
    expect(table).toContain("visibleEntries");
    expect(table).toContain("const renderedEntries = visibleEntries");
    expect(table).not.toContain('Platform.OS === "web" ? entries : visibleEntries');
    expect(table).not.toContain('if (Platform.OS === "web") return;');
    expect(table).toContain("startTransition(() => setScrollTop(next))");
    expect(table).toContain("scrollEventThrottle={48}");
    expect(table).toContain("horizontal");
    expect(table).toContain('testID={source === "data" && testID ? `${testID}-virtual-list` : undefined}');
    expect(table).toContain("pinnedScrollRef");
    expect(table).toContain("dataScrollRef");
    expect(table).toContain('backgroundColor: colors.surface, borderBottomColor: colors.border');
    expect(table).toContain('fontWeight: "600"');
    expect(table).not.toContain('backgroundColor: colors.primary');
    expect(table).not.toContain('fontWeight: "800"');
  });

  it("移动端性能脚本以360条库存和180条采购做60 FPS与内存稳定性压力验证", () => {
    const script = read("scripts/h5-wine-workbench-performance-e2e.mjs");
    expect(script).toContain("length: 360");
    expect(script).toContain("purchaseCount: 180");
    expect(script).toContain("count < 120");
    expect(script).toContain("const measuredGaps = gaps.slice(6)");
    expect(script).toContain("frame.averageFrameGapMs > 17");
    expect(script).toContain("for (let cycle = 0; cycle < 12");
    expect(script).toContain('await call("HeapProfiler.enable")');
    expect(script).toContain('await call("HeapProfiler.collectGarbage")');
    expect(script).toContain("heapGrowth > 12 * 1024 * 1024");
    expect(script).toContain("liveNodeGrowth > 180");
    expect(script).toContain("beforeLiveNodeCount");
    expect(script).toContain("afterLiveNodeCount");
    expect(script).toContain('clickExpression("wine-tab-ledger")');
    expect(script).toContain("wine.manual_purchases.v1");
    expect(script).toContain("const monthLabel = year + '年' + monthNumber + '月'");
  });

  it("通用移动端回归直接采样虚拟列表，避免把静态工作台容器误判为滚动区域", () => {
    const script = read("scripts/h5-schedule-correction-e2e.mjs");
    expect(script).toContain('wine-horizontal-ledger-table-virtual-list');
    expect(script).not.toContain("workspace?.querySelector('[style*=\"overflow-y\"]') || workspace?.firstElementChild");
  });
});

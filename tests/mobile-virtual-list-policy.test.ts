import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOBILE_NESTABLE_DRAGGABLE_LIST_BASE_PROPS,
  MOBILE_VIRTUAL_LIST_BASE_PROPS,
  MOBILE_VIRTUAL_LIST_MONITORING_POLICY,
} from "../lib/performance/mobile-virtual-list-policy";

const flatListFiles = [
  "app/(tabs)/books.tsx",
  "app/(tabs)/bottles.tsx",
  "app/(tabs)/food.tsx",
  "app/(tabs)/homemade.tsx",
  "app/(tabs)/menu.tsx",
  "app/(tabs)/recipes.tsx",
  "app/(tabs)/shopping.tsx",
  "app/(tabs)/wine.tsx",
  "app/homemade-form.tsx",
  "app/lab/plan.tsx",
  "app/lab/projects.tsx",
  "app/supplier-import.tsx",
  "app/sync-log.tsx",
  "components/link-picker-sheet.tsx",
  "components/store/petty-cash.tsx",
  "components/store/purchase.tsx",
  "components/store/sale.tsx",
] as const;

const root = new URL("..", import.meta.url).pathname;
const readSource = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const flatListConfigured = (source: string) => [...source.matchAll(/<FlatList\s+\{\.\.\.MOBILE_VIRTUAL_LIST_PROPS\}/g)].length;

describe("移动端虚拟列表性能规范", () => {
  it("定义统一的移动端窗口、批处理与帧间隔门槛", () => {
    expect(MOBILE_VIRTUAL_LIST_BASE_PROPS.initialNumToRender).toBe(12);
    expect(MOBILE_VIRTUAL_LIST_BASE_PROPS.maxToRenderPerBatch).toBe(12);
    expect(MOBILE_VIRTUAL_LIST_BASE_PROPS.windowSize).toBe(7);
    expect(MOBILE_VIRTUAL_LIST_BASE_PROPS.updateCellsBatchingPeriod).toBe(40);
    expect(MOBILE_NESTABLE_DRAGGABLE_LIST_BASE_PROPS.autoscrollThreshold).toBe(80);
    expect(MOBILE_VIRTUAL_LIST_MONITORING_POLICY.fixtureSize).toBe(120);
    expect(MOBILE_VIRTUAL_LIST_MONITORING_POLICY.maxFrameGapMs).toBe(100);
  });

  it.each(flatListFiles)("%s 的所有 FlatList 都接入统一性能配置", (path) => {
    const source = readSource(path);
    const listCount = [...source.matchAll(/^\s*<FlatList(?:\s|$)/gm)].length;
    expect(listCount).toBeGreaterThan(0);
    expect(flatListConfigured(source)).toBe(listCount);
    expect(source).toContain("@/components/performance/mobile-virtual-list");
  });

  it("葡萄酒长台账使用专用的固定列窗口化组件，替代 FlatList 同样受性能策略保护", () => {
    const source = readSource("app/wine-inventory.tsx");
    const table = readSource("components/inventory/VirtualizedHorizontalLedgerTable.tsx");
    expect(source).toContain("VirtualizedHorizontalLedgerTable");
    expect(table).toContain("const OVERSCAN_PX = ROW_HEIGHT * 12");
    expect(table).toContain("scrollEventThrottle={48}");
    expect(table).toContain("pinnedScrollRef");
    expect(table).toContain("dataScrollRef");
  });

  it("嵌套拖拽列表使用专用的自动滚动与虚拟化配置", () => {
    for (const path of ["app/homemade-form.tsx", "app/recipe-form.tsx"]) {
      const source = readSource(path);
      const draggableCount = [...source.matchAll(/<NestableDraggableFlatList\s+\{\.\.\.MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS\}/g)].length;
      expect(draggableCount).toBeGreaterThan(0);
    }
  });


  it("员工长列表 H5 回归持续覆盖排序、根级宽度、真实滚动与帧间隔", () => {
    const source = readSource("scripts/h5-employee-order-mobile-e2e.mjs");
    expect(source).toContain("length: 120");
    expect(source).toContain("renderedEmployees");
    expect(source).toContain("rootScrollWidth");
    expect(source).toContain("scrollable");
    expect(source).toContain("maxFrameGapMs");
    expect(source).toContain("100");
  });
});

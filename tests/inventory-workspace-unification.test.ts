import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("库存六类与店铺四类工作台统一规范", () => {
  const portal = read("components/store/inventory.tsx");
  const base = read("components/inventory/BaseInventoryScreen.tsx");
  const spirits = read("app/spirits-inventory.tsx");
  const wine = read("app/wine-inventory.tsx");
  const metrics = read("lib/store/inventory-workspace-ui.ts");

  it("注册库存六类与店铺四类，且分类栏不再携带 emoji 或类别色", () => {
    for (const label of ["烈酒", "葡萄酒", "水果", "食材", "啤酒", "冰块", "杯具", "餐具", "日用品", "设备"]) {
      expect(portal).toContain(`label: "${label}"`);
    }
    expect(portal).not.toContain("emoji:");
    expect(portal).not.toContain("showPortalHeader");
    expect(portal).not.toContain("杯具、餐具、日用品与设备");
    expect(portal).toContain("<StoreSegmentedTabs");
    expect(read("components/store/store-visual-primitives.tsx")).toContain('const tint = selected ? storeTone(colors, "primary") : colors.muted;');
  });

  it("烈酒、葡萄酒与通用九类页面使用同一紧凑工作台尺度和纯文本结构页签", () => {
    expect(metrics).toContain("segmentHeight: 40");
    expect(metrics).toContain("actionHeight: 36");
    expect(metrics).toContain("phoneHeaderHeight: 36");
    expect(metrics).toContain("phoneRowHeight: 44");
    expect(base).toContain('label: "总结"');
    expect(base).toContain('label: "库存管理"');
    expect(base).toContain('label: "当月进货"');
    expect(spirits).toContain('label: "采购分析"');
    expect(wine).toContain('label: "供应商信息"');
    expect(spirits).not.toContain('label: "📦 当月进货"');
    expect(wine).not.toContain('label: "📦 当月进货"');
    expect(wine).toContain('tabBtn: { flex: 1, minHeight: INVENTORY_WORKSPACE_METRICS.segmentHeight');
    expect(wine).toContain('actionBtn: { flexDirection: "row", flexShrink: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight');
    const wineLedgerToolbar = wine.slice(wine.indexOf('style={{ flexGrow: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight + 12'), wine.indexOf('style={[S.filterScroll'));
    expect(wineLedgerToolbar).not.toContain('<IconSymbol');
  });

  it("当月进货使用月日、无色分类分组和整列筛选入口", () => {
    expect(spirits).toContain("purchaseDisplayGroups.map");
    expect(spirits).toContain("formatInventoryMonthDay(p.date)");
    expect(spirits).toContain("tableHeaderAccessibilityLabel");
    expect(spirits).not.toContain("{/* 分类列 */}");
    expect(base).toContain("formatInventoryMonthDay(r.date)");
  });
});

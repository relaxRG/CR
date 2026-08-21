import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("库存六类与店铺四类工作台统一规范", () => {
  const portal = read("components/store/inventory.tsx");
  const base = read("components/inventory/BaseInventoryScreen.tsx");
  const spirits = read("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");
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
    const sharedTabs = read("components/store/store-visual-primitives.tsx");
    expect(sharedTabs).toContain("fitsSingleRow = items.length <= 5");
    expect(sharedTabs).toContain('backgroundColor: selected ? colors.surface : "transparent"');
    expect(sharedTabs).toContain('color: selected ? colors.foreground : colors.muted');
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
    expect(wine).toContain('<StoreSegmentedTabs');
    expect(wine).toContain('testID="wine-workspace-tabs"');
    expect(wine).not.toContain('tabBtn: { flex: 1, minHeight: INVENTORY_WORKSPACE_METRICS.segmentHeight');
    expect(wine).toContain('actionBtn: { flexDirection: "row", flexShrink: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight');
    const wineLedgerToolbar = wine.slice(wine.indexOf('style={{ flexGrow: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight + 12'), wine.indexOf('style={[S.filterScroll'));
    expect(wineLedgerToolbar).not.toContain('<IconSymbol');
  });

  it("通用库存台账仅将分类色用于分组色点，普通进货、消耗和期末金额保持中性", () => {
    const table = read("components/inventory/HorizontalLedgerTable.tsx");
    expect(table).toContain('backgroundColor: colors.surface, borderBottomColor: colors.border');
    expect(table).toContain('fontWeight: "600"');
    expect(table).not.toContain('backgroundColor: colors.primary');
    expect(table).not.toContain('fontWeight: "800"');
    expect(base).toContain('<StoreSegmentedTabs');
    expect(base).not.toContain('backgroundColor: tab === t.key ? colors.foreground');
    expect(base).toContain('color: item.purchaseCost > 0 ? colors.foreground : colors.muted');
    expect(base).toContain('color: item.consumeCost > 0 ? colors.foreground : colors.muted');
    expect(base).toContain('color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize, fontWeight: "600"');
    expect(base).toContain('backgroundColor: colors.primary, borderColor: colors.primary');
    expect(base).toContain('r.reason === "loss" || r.reason === "adjust" ? colors.error : colors.foreground');
    expect(base).not.toContain('fontWeight: "700"');
    expect(base).not.toContain('fontWeight: "800"');
  });

  it("烈酒当月进货按完整年月日分组、以分类替换旧日期列，并保留整列筛选入口", () => {
    expect(spirits).toContain("purchaseDisplayGroups.map");
    expect(spirits).toContain('const date = /^\\d{4}-\\d{2}-\\d{2}$/.test(purchase.date) ? purchase.date : "未填写日期"');
    expect(spirits).toContain("{/* 数据行始终按完整年月日分组；分类在每条采购记录中显示。 */}");
    expect(spirits).toContain('>分类</Text>');
    expect(spirits).toContain("resolvePurchaseDisplayCategory(p, item)");
    expect(spirits).toContain("buildPurchaseCategorySelection(previewItem.id, category.name)");
    expect(spirits).toContain("tableHeaderAccessibilityLabel");
    expect(spirits).not.toContain("formatInventoryMonthDay(p.date)");
    expect(base).toContain("formatInventoryMonthDay(r.date)");
  });
});

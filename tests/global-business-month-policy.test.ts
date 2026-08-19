import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("全局业务月份与紧凑选择器规范", () => {
  const provider = read("lib/months/global-business-month.tsx");
  const rootLayout = read("app/_layout.tsx");
  const reportMonth = read("hooks/use-report-month-navigation.ts");
  const inventory = read("components/store/inventory.tsx");
  const labor = read("app/labor.tsx");
  const petty = read("components/store/petty-cash.tsx");
  const navigator = read("components/months/BoundedBusinessMonthNavigator.tsx");
  const inventoryNavigator = read("components/inventory/BoundedMonthNavigator.tsx");
  const migration = read("lib/migrations/clean-legacy-business-month-keys.ts");

  it("提供唯一全局月份状态并挂载在业务数据树内", () => {
    expect(provider).toContain('const STORAGE_KEY = "business.global-active-month.v1"');
    expect(provider).toContain("GlobalBusinessMonthProvider");
    expect(rootLayout).toContain("<GlobalBusinessMonthProvider>");
  });

  it("报表、员工、备用金、库存和店铺均读取同一全局月份", () => {
    expect(reportMonth).toContain("useGlobalBusinessMonth");
    expect(reportMonth).not.toContain("store.report.active-month.v1");
    expect(inventory).toContain("useGlobalBusinessMonth");
    expect(inventory).not.toContain("store.inventory.month.v1");
    expect(inventory).not.toContain("store.shop.month.v1");
    expect(labor).toContain("const { month: currentMonth, selectMonth: setCurrentMonth } = useGlobalBusinessMonth()");
    expect(petty).toContain("const { month, selectMonth: setMonth } = useGlobalBusinessMonth()");
  });

  it("模块无数据时保留全局月份而不是跳回自身数据月", () => {
    expect(inventory).toContain("库存没有该月数据时也必须展示全局月份的空状态");
    expect(inventory).toContain("const selectedMonth = globalMonth");
    expect(petty).toContain("min: month < pettyLocalBounds.min ? month : pettyLocalBounds.min");
    expect(reportMonth).toContain("return { month: globalMonth");
    expect(reportMonth).not.toContain("clampReportMonth(globalMonth, bounds)");
  });

  it("快速连续切月立即更新界面，并将持久化写入合并为最后一次选择", () => {
    expect(provider).toContain("BUSINESS_MONTH_PERSIST_DEBOUNCE_MS = 120");
    expect(provider).toContain("setMonth(normalized)");
    expect(provider).toContain("clearTimeout(persistTimer.current)");
    expect(provider).toContain("setStoredMonth(normalized)");
  });

  it("月份选择器使用唯一共享的紧凑上浮卡片而非大底部抽屉", () => {
    expect(navigator).toContain('import { BoundedMonthNavigator }');
    expect(navigator).toContain("<BoundedMonthNavigator");
    expect(navigator).toContain("subject={subject}");
    expect(inventoryNavigator).toContain('animationType="fade"');
    expect(inventoryNavigator).toContain('justifyContent: "flex-start"');
    expect(inventoryNavigator).toContain('maxWidth: 336');
    expect(inventoryNavigator).toContain('>选择{subject}月份</Text>');
    expect(inventoryNavigator).toContain('accessibilityLabel="关闭月份选择"');
    expect(inventoryNavigator).not.toContain('name="chevron.down"');
    expect(inventoryNavigator).not.toContain("sheetTitle");
  });

  it("旧模块私有月份键会在启动时清理，不保留兼容分支", () => {
    expect(migration).toContain('"store.report.active-month.v1"');
    expect(migration).toContain('"store.inventory.month.v1"');
    expect(migration).toContain('"store.shop.month.v1"');
    expect(migration).toContain("AsyncStorage.multiRemove");
    expect(rootLayout).toContain("cleanLegacyBusinessMonthKeys");
    expect(petty).not.toContain("MonthPickerModal");
  });
});

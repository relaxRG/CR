import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("报表统一月份导航页面接入", () => {
  it("总月报、经营分析和账户均使用同一业务月份 Hook 与导航组件", () => {
    const summary = read("app/monthly-summary.tsx");
    const analytics = read("components/store/analytics.tsx");
    const accounts = read("components/store/accounts.tsx");

    for (const source of [summary, analytics, accounts]) {
      expect(source).toContain("useReportMonthNavigation");
      expect(source).toContain("BoundedBusinessMonthNavigator");
    }

    expect(summary).toContain('testID="monthly-summary-month-navigator"');
    expect(analytics).toContain('testID="analytics-month-navigator"');
    expect(accounts).toContain('testID="accounts-month-navigator"');
  });

  it("旧固定月份横滑选择器与经营分析的本地月份状态已被删除", () => {
    const summary = read("app/monthly-summary.tsx");
    const analytics = read("components/store/analytics.tsx");
    const accounts = read("components/store/accounts.tsx");

    expect(summary).not.toContain("function MonthSelector");
    expect(accounts).not.toContain("function MonthSelector");
    expect(analytics).not.toContain("function MonthPicker");
    expect(analytics).not.toContain("const [selectedMonth, setSelectedMonth]");
  });

  it("从经营分析和报表工作台进入总月报时携带共享月份路由参数", () => {
    const store = read("app/(tabs)/store.tsx");
    const analytics = read("components/store/analytics.tsx");

    expect(store).toContain('params: { month: reportMonth }');
    expect(store).toContain('testID="store-report-tabs"');
    expect(store).toContain('testID={`store-report-tab-${t.key}`}');
    expect(analytics).toContain('params: { month: reportMonth }');
  });

  it("H5回归覆盖三页统一月份导航的六尺寸同步与防溢出", () => {
    const h5 = read("scripts/h5-schedule-correction-e2e.mjs");
    expect(h5).toContain("报表统一月份导航");
    expect(h5).toContain("monthly-summary-month-navigator");
    expect(h5).toContain("analytics-month-navigator");
    expect(h5).toContain("accounts-month-navigator");
    expect(h5).toContain("MOBILE_VIEWPORTS");
  });
});

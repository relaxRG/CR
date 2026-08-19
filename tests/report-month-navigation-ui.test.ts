import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("报表工作台四页签与统一月份导航", () => {
  it("总月报、经营分析、账户和时段经营分析均接入同一业务月份状态", () => {
    const store = read("app/(tabs)/store.tsx");
    const summary = read("app/monthly-summary.tsx");
    const analytics = read("components/store/analytics.tsx");
    const accounts = read("components/store/accounts.tsx");
    const period = read("app/period-analysis.tsx");

    expect(store).toContain("useReportMonthNavigation");
    expect(store).toContain('testID="report-workspace-month-navigator"');
    expect(store).toContain('{ key: "period",    label: "时段经营分析" }');
    for (const source of [summary, analytics, accounts, period]) {
      expect(source).toContain("embedded");
    }
    expect(period).toContain("reportWorkspaceMonth");
  });

  it("四页签只切换当前工作台内容，不再以总月报为独立路由入口", () => {
    const store = read("app/(tabs)/store.tsx");

    expect(store).toContain('<MonthlySummaryScreen embedded />');
    expect(store).toContain('<StoreAnalyticsScreen embedded />');
    expect(store).toContain('<StoreAccountsScreen embedded />');
    expect(store).toContain('<PeriodAnalysisScreen embedded />');
    expect(store).not.toContain('pathname: "/monthly-summary"');
    expect(store).not.toContain("router.push({ pathname");
    expect(store).toContain('testID="store-report-tabs"');
    expect(store).toContain("<StoreSegmentedTabs");
    expect(read("components/store/store-visual-primitives.tsx")).toContain("function storeSegmentItemTestID");
    expect(read("components/store/store-visual-primitives.tsx")).toContain('return `${testID.slice(0, -1)}-${key}`;');
  });

  it("经营分析的重复功能入口与人工成本管理跳转已删除", () => {
    const analytics = read("components/store/analytics.tsx");

    expect(analytics).not.toContain("功能入口");
    expect(analytics).not.toContain("店铺月度经营分析");
    expect(analytics).not.toContain("人工成本管理");
    expect(analytics).not.toContain('route: "/labor"');
    expect(analytics).not.toContain('route: "/period-analysis"');
  });

  it("同次月度导入直接生成时段分析报告，时段工作台内不显示重复导入按钮", () => {
    const importer = read("app/monthly-report-import.tsx");
    const period = read("app/period-analysis.tsx");

    expect(importer).toContain("usePeriodAnalysisStore");
    expect(importer).toContain("parsePeriodAnalysisExcel");
    expect(importer).toContain('file.type === "time_slot_order"');
    expect(importer).toContain('file.type === "time_slot_checkout"');
    expect(importer).not.toContain('router.replace("/monthly-report"');
    expect(period).toContain("!embedded && <Pressable onPress={handleImport}");
  });

  it("嵌入工作台时不重复渲染各子页的月份导航或独立返回导航", () => {
    const summary = read("app/monthly-summary.tsx");
    const analytics = read("components/store/analytics.tsx");
    const accounts = read("components/store/accounts.tsx");
    const period = read("app/period-analysis.tsx");

    expect(summary).toContain("!embedded && <BoundedBusinessMonthNavigator");
    expect(analytics).toContain('mode === "month" && !embedded');
    expect(accounts).toContain("!embedded && <BoundedBusinessMonthNavigator");
    expect(period).toContain("!embedded && <View style={[S.navbar");
  });
});

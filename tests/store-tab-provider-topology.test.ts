import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(`${process.cwd()}/${relative}`, "utf8");
const tabProviders = source("components/providers/StoreTabProviders.tsx");

function componentBody(name: string): string {
  const match = tabProviders.match(new RegExp(`export function ${name}\\([^]*?\\n}`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function providersIn(name: string): string[] {
  return [...componentBody(name).matchAll(/<([A-Za-z][A-Za-z0-9]+Provider)(?:\s|>)/g)].map((match) => match[1]!);
}

describe("门店顶级 Tab Provider 拓扑", () => {
  it("将稳定事实源只归属到一个可运行的 Tab 子边界", () => {
    const expected = {
      StoreShopProviders: ["GlasswareInventoryProvider", "TablewareInventoryProvider", "DailyInventoryProvider", "EquipmentInventoryProvider"],
      StorePettyProviders: ["PettyCashProvider", "PettyCategoryProvider", "PettyInventoryLinkProvider", "PettyLaborLinkProvider"],
      StoreInventoryProviders: ["SpiritsInventoryProvider", "FoodIngredientProvider", "BeerInventoryProvider", "IceNewInventoryProvider", "FruitNewInventoryProvider"],
      StoreLaborProviders: ["LaborProvider", "SalaryAdvanceCategoryProvider", "SalaryAdvanceProvider"],
    } as const;
    const all = Object.entries(expected).flatMap(([name, providers]) => {
      expect(providersIn(name)).toEqual(providers);
      return providers;
    });

    expect(new Set(all).size).toBe(all.length);
  });

  it("以 Tab key 重建 React Provider 子树，确保切换卸载旧边界", () => {
    const boundary = source("components/providers/StoreTabBoundary.tsx");
    const storeScreen = source("app/(tabs)/store.tsx");

    expect(boundary).toContain("<Provider key={tab}>{children}</Provider>");
    expect(boundary).toContain("lifecycle.current.activate(tab)");
    expect(boundary).toContain("lifecycle.current.dispose()");
    expect(storeScreen).toContain('<StoreTabBoundary tab={effectiveTab}>');
  });

  it("报表边界只装配报告自有写模型、受控月结命令与只读跨域投影", () => {
    const report = componentBody("StoreReportProviders");
    expect(providersIn("StoreReportProviders")).toEqual([
      "MonthlyReportProvider", "ScheduleProvider", "PeriodAnalysisProvider", "MonthlySummaryProvider",
      "ModuleMonthCloseProvider", "ReportMonthCloseProvider", "StoreReportReadModelProvider",
    ]);
    expect(report).toContain("<StoreReportReadModelProvider>{children}</StoreReportReadModelProvider>");
    expect(report).not.toContain("StoreFeatureProviders");
    expect(report).not.toContain("<LaborProvider>");
    expect(report).not.toContain("<PettyCashProvider>");
    expect(report).not.toContain("<SpiritsInventoryProvider>");
    expect(report).not.toContain("<FoodIngredientProvider>");
  });
});

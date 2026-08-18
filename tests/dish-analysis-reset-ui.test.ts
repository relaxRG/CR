import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("经营分析按月重置入口", () => {
  it("提供当前月份重置入口，并从同月主月报重建而不删除小类和菜品明细", () => {
    const screen = source("app/dish-analysis.tsx");
    const rebuild = source("lib/store/monthly-report/rebuild-dish-categories.ts");

    expect(screen).toContain('testID="dish-analysis-reset-current-month"');
    expect(screen).toContain("重置本月经营分析");
    expect(screen).toContain("rebuildDishCategoriesFromMonthlyReport(snapshot, report)");
    expect(screen).toContain("小类、菜品与规格明细不会被删除");
    expect(rebuild).toContain("...snapshot,");
    expect(rebuild).toContain("categories: report.dishCategories.map");
  });

  it("主解析器和菜品分析解析器都拒绝纯数字分类，且后者按表头动态定位分类列", () => {
    const reportParser = source("lib/store/monthly-report/excel-parser.ts");
    const dishParser = source("lib/store/monthly-report/dish-analysis-parser.ts");

    expect(reportParser).toContain("/^[-+]?\\d+(?:[,.]\\d+)?%?$/");
    const categoryParser = dishParser.slice(dishParser.indexOf("export function parseDishCategories"), dishParser.indexOf("// ─── 解析菜品小类"));
    expect(categoryParser).toContain('safeStr(cell) === "菜品大类"');
    expect(categoryParser).toContain("categoryColumn + 3");
    expect(categoryParser).not.toContain("const name = safeStr(row[0])");
  });
});

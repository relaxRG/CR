import type { DishAnalysisSnapshot } from "./dish-analysis-types";
import type { MonthlyReport } from "./types";

function normalizeMonth(value: string): string {
  const match = String(value ?? "").match(/(\d{4})[^\d]?(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
}

/**
 * 用同月《菜品销售统计（菜品大类）》的主月报结果重建菜品分析快照中的大类区。
 * 只替换错误的派生分类，保留同一批导入已经正确的小类、菜品、规格和收款明细。
 */
export function rebuildDishCategoriesFromMonthlyReport(
  snapshot: DishAnalysisSnapshot,
  report: MonthlyReport,
): DishAnalysisSnapshot {
  const snapshotMonth = normalizeMonth(snapshot.month);
  const reportMonth = normalizeMonth(report.rawMonth || report.monthLabel);
  if (!snapshotMonth || snapshotMonth !== reportMonth) {
    throw new Error("只能使用同月份的原始月报重建菜品大类。");
  }

  return {
    ...snapshot,
    importedAt: new Date().toISOString(),
    categories: report.dishCategories.map((category) => ({
      name: category.name,
      salesQty: category.salesQty,
      salesQtyPct: category.salesQtyPct,
      salesAmount: category.salesAmount,
      salesAmountPct: category.salesAmountPct,
      revenue: category.revenue,
      revenuePct: category.revenuePct,
      discount: category.discountAmount,
    })),
    importedReports: { ...snapshot.importedReports, categories: true },
  };
}

export function findMonthlyReportForDishAnalysis(
  reports: MonthlyReport[],
  month: string,
): MonthlyReport | undefined {
  const normalized = normalizeMonth(month);
  return reports.find((report) => normalizeMonth(report.rawMonth || report.monthLabel) === normalized);
}

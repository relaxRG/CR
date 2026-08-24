import { useMemo } from "react";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { usePeriodAnalysisStore } from "@/lib/store/period-analysis/store";
import { useStoreReportReadModel } from "@/components/providers/StoreReportReadModelProvider";
import {
  deriveReportMonthBounds,
  type ReportMonth,
} from "@/lib/reporting/month-navigation";
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";

/**
 * 三个报表页面共用一个业务月份。页面自身无数据时不会改写它，只由边界超出时执行 clamp。
 */
export function useReportMonthNavigation() {
  const { month: globalMonth, selectMonth: selectGlobalMonth } = useGlobalBusinessMonth();
  const { reports: summaryReports, balances } = useMonthlySummaryStore();
  const { reports: monthlyReports } = useMonthlyReportStore();
  const { model } = useStoreReportReadModel();
  const { reports: periodReports } = usePeriodAnalysisStore();
  const bounds = useMemo(() => deriveReportMonthBounds([
    ...summaryReports.map((report) => report.month),
    ...balances.map((balance) => balance.month),
    ...monthlyReports.map((report) => report.rawMonth ?? report.monthLabel),
    // 报表域只读取物化视图，不装配收入、备用金或人力的可写事实源。
    ...model.analyticsByDate.map((row) => row.date),
    ...model.laborDetails.paySlips.map((slip) => slip.month),
    ...periodReports.map((report) => report.month),
  ]), [summaryReports, balances, monthlyReports, model.analyticsByDate, model.laborDetails.paySlips, periodReports]);

  // 与库存一致：可选范围只由实际业务数据确定，首尾各保留一个相邻月；无数据时仅当前自然月。

  return { month: globalMonth, bounds, selectMonth: selectGlobalMonth as (month: ReportMonth) => void };
}

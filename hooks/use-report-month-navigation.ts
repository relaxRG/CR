import { useCallback, useMemo } from "react";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { useRevenueStore } from "@/lib/store/revenue-store";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { usePaySlipStore } from "@/lib/labor/store";
import {
  clampReportMonth,
  deriveReportMonthBounds,
  normalizeReportMonth,
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
  const { records: revenueRecords } = useRevenueStore();
  const { records: pettyRecords } = usePettyCashStore();
  const { paySlips } = usePaySlipStore();
  const bounds = useMemo(() => deriveReportMonthBounds([
    ...summaryReports.map((report) => report.month),
    ...balances.map((balance) => balance.month),
    ...monthlyReports.map((report) => report.rawMonth ?? report.monthLabel),
    ...revenueRecords.map((record) => record.date),
    ...pettyRecords.map((record) => record.date),
    ...(paySlips ?? []).map((slip) => slip.month),
  ]), [summaryReports, balances, monthlyReports, revenueRecords, pettyRecords, paySlips]);

  const month = useMemo(
    () => clampReportMonth(globalMonth, bounds),
    [globalMonth, bounds],
  );

  const selectMonth = useCallback((next: ReportMonth) => {
    const canonical = clampReportMonth(next, bounds);
    selectGlobalMonth(canonical);
  }, [bounds, selectGlobalMonth]);

  return { month, bounds, selectMonth };
}

import { useMemo } from "react";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { useRevenueStore } from "@/lib/store/revenue-store";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { usePaySlipStore } from "@/lib/labor/store";
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
  const { records: revenueRecords } = useRevenueStore();
  const { records: pettyRecords } = usePettyCashStore();
  const { paySlips } = usePaySlipStore();
  const localBounds = useMemo(() => deriveReportMonthBounds([
    ...summaryReports.map((report) => report.month),
    ...balances.map((balance) => balance.month),
    ...monthlyReports.map((report) => report.rawMonth ?? report.monthLabel),
    ...revenueRecords.map((record) => record.date),
    ...pettyRecords.map((record) => record.date),
    ...(paySlips ?? []).map((slip) => slip.month),
  ]), [summaryReports, balances, monthlyReports, revenueRecords, pettyRecords, paySlips]);

  // 任一模块选择的业务月必须原样保留；报表无数据时由页面展示空状态，绝不私自跳月。
  const bounds = useMemo(() => ({
    min: globalMonth < localBounds.min ? globalMonth : localBounds.min,
    max: globalMonth > localBounds.max ? globalMonth : localBounds.max,
  }), [globalMonth, localBounds]);

  return { month: globalMonth, bounds, selectMonth: selectGlobalMonth as (month: ReportMonth) => void };
}

import { useCallback, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePersistedState } from "@/hooks/use-persisted-state";
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
import { getCurrentInventoryMonth } from "@/lib/inventory-core/month-browser";

const STORAGE_KEY = "store.report.active-month.v1";

/**
 * 三个报表页面共用一个业务月份。页面自身无数据时不会改写它，只由边界超出时执行 clamp。
 */
export function useReportMonthNavigation() {
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string | string[] }>();
  const { reports: summaryReports, balances } = useMonthlySummaryStore();
  const { reports: monthlyReports } = useMonthlyReportStore();
  const { records: revenueRecords } = useRevenueStore();
  const { records: pettyRecords } = usePettyCashStore();
  const { paySlips } = usePaySlipStore();
  const [storedMonth, setStoredMonth] = usePersistedState<ReportMonth>(STORAGE_KEY, getCurrentInventoryMonth());

  const bounds = useMemo(() => deriveReportMonthBounds([
    ...summaryReports.map((report) => report.month),
    ...balances.map((balance) => balance.month),
    ...monthlyReports.map((report) => report.rawMonth ?? report.monthLabel),
    ...revenueRecords.map((record) => record.date),
    ...pettyRecords.map((record) => record.date),
    ...(paySlips ?? []).map((slip) => slip.month),
  ]), [summaryReports, balances, monthlyReports, revenueRecords, pettyRecords, paySlips]);

  const routeMonth = normalizeReportMonth(Array.isArray(params.month) ? params.month[0] : params.month);
  const month = useMemo(
    () => clampReportMonth(routeMonth ?? storedMonth, bounds),
    [routeMonth, storedMonth, bounds],
  );

  const selectMonth = useCallback((next: ReportMonth) => {
    const canonical = clampReportMonth(next, bounds);
    setStoredMonth(canonical);
    // 独立路由可从参数恢复月份；工作台内路由可忽略未知参数。
    router.setParams({ month: canonical });
  }, [bounds, router, setStoredMonth]);

  return { month, bounds, selectMonth };
}

import { Redirect } from "expo-router";

/**
 * 历史深链兼容入口。
 * 月度经营分析已合并进“报表 → 经营分析”页签，不再保留独立页面或返回层级。
 */
export default function MonthlyReportRoute() {
  return <Redirect href="/store" />;
}

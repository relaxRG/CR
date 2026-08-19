import { BoundedMonthNavigator } from "@/components/inventory/BoundedMonthNavigator";
import type { ReportMonth, ReportMonthBounds } from "@/lib/reporting/month-navigation";

interface BoundedBusinessMonthNavigatorProps {
  month: ReportMonth;
  bounds: ReportMonthBounds;
  onChange: (month: ReportMonth) => void;
  subject: string;
  testID?: string;
}

/**
 * 报表、员工、备用金与门店入口共用的业务月份导航。
 * 统一委托给库存、店铺也在使用的导航组件，保证位置、上浮选月卡片、
 * 最早/最晚月禁用逻辑和中间纯文本月份按钮完全一致。
 */
export function BoundedBusinessMonthNavigator({
  month,
  bounds,
  onChange,
  subject,
  testID = "business-month-navigator",
}: BoundedBusinessMonthNavigatorProps) {
  return (
    <BoundedMonthNavigator
      month={month}
      bounds={bounds}
      onChange={onChange}
      subject={subject}
      testID={testID}
    />
  );
}

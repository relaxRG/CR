import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("统一月度归档 UI 与旧入口清理", () => {
  const labor = read("app/labor.tsx");
  const monthlySummary = read("app/monthly-summary.tsx");
  const store = read("lib/labor/store.tsx");

  it("排班表不再提供手动存档或历史版本入口", () => {
    expect(labor).not.toContain("存档排班表");
    expect(labor).not.toContain("历史版本 Modal");
    expect(labor).not.toContain("useScheduleSnapshotStore");
    expect(labor).not.toContain("camera.fill");
    expect(labor).not.toContain("clock.arrow.circlepath");
  });

  it("月报是唯一正式归档入口，并覆盖草稿、冻结和调整中三态", () => {
    expect(monthlySummary).toContain("月度归档并确认发薪");
    expect(monthlySummary).toContain("归档本月（无发薪）");
    expect(monthlySummary).toContain("查看月度归档");
    expect(monthlySummary).toContain("进入差额调整");
    expect(monthlySummary).toContain("放弃调整");
    expect(monthlySummary).toContain("重新归档并确认");
  });

  it("冻结月差额调整必须填写原因，且归档排班恢复只能在调整草稿中进行", () => {
    expect(monthlySummary).toContain("调整原因 *");
    expect(monthlySummary).toContain("openAdjustmentSession(selectedMonth, reason, \"next_month\")");
    expect(monthlySummary).toContain("应用此归档排班到调整草稿");
    expect(store).toContain("if (!getAdjustmentSession(month)) return false;");
  });

  it("旧确认状态机、旧快照 Provider 和直接撤销冻结路径均已删除", () => {
    expect(store).not.toContain("PayrollConfirmationProvider");
    expect(store).not.toContain("ScheduleSnapshotProvider");
    expect(store).not.toContain("revokeConfirmation");
    expect(store).not.toContain("confirmPayroll:");
  });

  it("调整放弃会恢复完整排班、考勤和薪资月度基线", () => {
    expect(store).toContain("replaceMonthShifts(month, session.baseline.shifts)");
    expect(store).toContain("replaceMonthAttendances(month, session.baseline.attendances)");
    expect(store).toContain("replaceMonthPaySlips(month, session.baseline.paySlips)");
  });
});

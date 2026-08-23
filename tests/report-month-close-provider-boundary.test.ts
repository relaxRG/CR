import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(`${process.cwd()}/lib/labor/report-month-close-provider.tsx`, "utf8");

describe("报告域月结受控命令边界", () => {
  it("不装配劳动写 Context，而是在确认命令时批量读取所需快照", () => {
    expect(source).toContain("AsyncStorage.multiGet([EMPLOYEES_KEY, SHIFTS_KEY, ATTENDANCES_KEY, PAYSLIPS_KEY])");
    expect(source).toContain("buildFinalScheduleByDept(activeEmployees, facts.shifts, month)");
    expect(source).toContain("buildFrozenPayrollByEmployee(facts.employees, facts.paySlips, month)");
    expect(source).not.toContain("useEmployeeStore");
    expect(source).not.toContain("useShiftStore");
    expect(source).not.toContain("useAttendanceStore");
    expect(source).not.toContain("usePaySlipStore");
  });

  it("恢复与应用归档仅通过受控存储写入并发出对应同步通知", () => {
    expect(source).toContain("AsyncStorage.multiSet");
    expect(source).toContain("notifySyncChange(SHIFTS_KEY)");
    expect(source).toContain("notifySyncChange(ATTENDANCES_KEY)");
    expect(source).toContain("notifySyncChange(PAYSLIPS_KEY)");
    expect(source).toContain("const unregister = registerStoreReload(refresh)");
    expect(source).toContain("unregister();");
  });
});

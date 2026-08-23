import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("考勤排班工作台性能护栏", () => {
  it("为部门员工、班次和员工日期班次预建索引，避免 500 人月度网格重复扫描排班数组", () => {
    const screen = source("components/labor/LaborWorkspaceScreen.tsx");
    expect(screen).toContain("const departmentEmployeeIds = useMemo");
    expect(screen).toContain("const validMonthShiftEmployeeIdsBySession = useMemo");
    expect(screen).toContain("const shiftEntryByEmployeeDateSession = useMemo");
    expect(screen).toContain("validMonthShiftEmployeeIdsBySession.get(tpl.session)");
    expect(screen).toContain("shiftEntryByEmployeeDateSession.get(`${employeeId}|${date}|${session}`)");
    expect(screen).not.toContain("monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session)");
    expect(screen).toContain("const employeePickerRowHeight = fontScale <= 1.15 ? 44 : undefined");
    expect(screen).toContain("getItemLayout={employeePickerRowHeight");
  });

  it("浏览器移动端压力脚本覆盖 500 名员工、万级排班与万级库存采购，并在专用标签页清理测试数据", () => {
    const script = source("scripts/h5-store-large-dataset-stress-e2e.mjs");
    expect(script).toContain("employees: 500");
    expect(script).toContain("shifts: 10_000");
    expect(script).toContain("inventoryPurchases: 10_000");
    expect(script).toContain("Emulation.setDeviceMetricsOverride");
    expect(script).toContain("localStorage.removeItem(key)");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("门店员工页性能护栏", () => {
  it("草稿薪资自动对账在交互完成后运行，并以单次整月替换代替逐员工写入", () => {
    const screen = read("components/labor/LaborWorkspaceScreen.tsx");
    const start = screen.indexOf("// DRAFT 唯一对账");
    const effectClosing = "  }, [activeEmployees, advances, buildPaySlipDraft, compOffEntries, getRosterMonthStatus, globalSettings, month, paySlips, replaceMonthPaySlips, rosterAttMap, rosterSlipMap]);";
    const effectEnd = screen.indexOf(effectClosing, start);
    const effect = screen.slice(start, effectEnd + effectClosing.length);
    expect(effect).toContain("InteractionManager.runAfterInteractions");
    expect(effect).toContain("const rebuiltByEmployee = new Map<string, PaySlip>()");
    expect(effect).toContain("replaceMonthPaySlips(month, nextMonthSlips)");
    expect(effect).toContain("return () => task.cancel()");
    expect(effect).not.toContain("upsertPaySlip({ ...rebuilt, id: current.id })");
  });

  it("员工档案卡片继续通过月份索引 Map 获取薪资与考勤，避免渲染时反复线性查找", () => {
    const screen = read("components/labor/LaborWorkspaceScreen.tsx");
    expect(screen).toContain("const rosterSlipMap = useMemo");
    expect(screen).toContain("const rosterAttMap = useMemo");
    expect(screen).toContain("slip={rosterSlipMap.get(emp.id) ?? null}");
    expect(screen).toContain("att={rosterAttMap.get(emp.id) ?? null}");
  });

  it("换休余额和无来源多休提醒由员工档案页一次遍历建立索引，收起卡片不重复筛选全量数据", () => {
    const screen = read("components/labor/LaborWorkspaceScreen.tsx");
    expect(screen).toContain("const rosterCompOffSummaryMap = useMemo");
    expect(screen).toContain("const rosterRestAlertMap = useMemo");
    expect(screen).toContain("compOffSummary={rosterCompOffSummaryMap.get(emp.id)");
    expect(screen).toContain("restAlert={rosterRestAlertMap.get(emp.id) ?? null}");
    const card = screen.slice(screen.indexOf("function PaySlipMiniCard"), screen.indexOf("function EmployeeRosterPage"));
    expect(card).toContain("const compOffDays = compOffSummary.overtimeAvailable");
    expect(card).not.toContain("alerts.find((a) => a.employeeId === employee.id");
  });
});

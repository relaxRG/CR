import { describe, expect, it } from "vitest";
import {
  buildFinalScheduleByDept,
  buildFrozenPayrollSnapshot,
  calculateArchiveAdjustments,
  getCurrentMonthCloseArchive,
  getMonthCloseStatus,
} from "../lib/labor/month-close";
import type { Employee, MonthCloseArchive, PaySlip, ShiftEntry } from "../lib/labor/types";

const employee = (id: string, dept: Employee["dept"]): Employee => ({
  id,
  code: id.toUpperCase(),
  realName: id,
  dept,
  phone: "",
  type: "fulltime",
  baseSalary: 10000,
  restDaysPerMonth: 4,
  hourlyRate: 0,
  overtimeHourlyRate: 50,
  notes: "",
  active: true,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const slip = (employeeId: string, finalSalary: number, attendanceSalary = finalSalary): PaySlip => ({
  id: `slip-${employeeId}`,
  employeeId,
  month: "2026-07",
  attendanceDays: 27,
  attendanceSalary,
  mealAllowance: 0,
  transportAllowance: 0,
  otherAllowance: 0,
  performanceBonus: 0,
  workKPIBonus: 0,
  revenueKPIBonus: 0,
  salesCommission: 0,
  rewardPenalty: 0,
  grossSalary: finalSalary,
  socialInsuranceDeduction: 0,
  housingFundDeduction: 0,
  incomeTax: 0,
  advanceAmount: 0,
  finalSalary,
  notes: "",
  employerSocialInsurance: 0,
  employerHousingFund: 0,
  totalEmployerCost: finalSalary,
  updatedAt: "2026-07-31T00:00:00.000Z",
});

const archive = (overrides: Partial<MonthCloseArchive> = {}): MonthCloseArchive => ({
  id: "close-2026-07-1",
  month: "2026-07",
  version: 1,
  status: "frozen",
  createdAt: 100,
  closedBy: "manager",
  summary: { totalEmployees: 1, totalGrossSalary: 10000, totalFinalSalary: 10000, totalDeductions: 0 },
  scheduleByDept: {},
  payrollByEmployee: { e1: buildFrozenPayrollSnapshot(employee("e1", "front"), slip("e1", 10000)) },
  adjustments: [],
  ...overrides,
});

describe("月度归档与差额调整状态机", () => {
  it("DRAFT 月没有归档；存在打开调整会话时为 ADJUSTING", () => {
    expect(getMonthCloseStatus([], new Set(), "2026-07")).toBe("draft");
    expect(getMonthCloseStatus([archive()], new Set(), "2026-07")).toBe("frozen");
    expect(getMonthCloseStatus([archive()], new Set(["2026-07"]), "2026-07")).toBe("adjusting");
  });

  it("当前归档只读取最高版本且仍为 frozen 的版本，替代版本不可作为正式依据", () => {
    const v1 = { ...archive(), status: "superseded" as const, supersededByArchiveId: "close-2026-07-2" };
    const v2 = archive({ id: "close-2026-07-2", version: 2, previousArchiveId: v1.id });
    expect(getCurrentMonthCloseArchive([v1, v2], "2026-07")?.id).toBe(v2.id);
  });

  it("最终排班快照按部门隔离，并只固化目标月份有效员工的班次", () => {
    const employees = [employee("front", "front"), employee("kitchen", "kitchen"), { ...employee("left", "front"), archived: true }];
    const shifts: ShiftEntry[] = [
      { employeeId: "front", date: "2026-07-01", shift: "午班", hoursValue: 8 },
      { employeeId: "kitchen", date: "2026-07-01", shift: "晚班", hoursValue: 8 },
      { employeeId: "front", date: "2026-08-01", shift: "午班", hoursValue: 8 },
      { employeeId: "left", date: "2026-07-01", shift: "午班", hoursValue: 8 },
    ];
    const snapshots = buildFinalScheduleByDept(employees, shifts, "2026-07");
    expect(snapshots.front?.entryCount).toBe(1);
    expect(snapshots.kitchen?.entryCount).toBe(1);
    expect(snapshots.company).toBeUndefined();
  });

  it("差额以冻结归档薪资为唯一基线，精确记录字段变更和最终实发差额", () => {
    const base = archive();
    const next = buildFrozenPayrollSnapshot(employee("e1", "front"), { ...slip("e1", 10320, 10120), mealAllowance: 200 });
    const changes = calculateArchiveAdjustments(base, { e1: next }, 200);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ archiveId: base.id, employeeId: "e1", amount: 320, settled: false });
    expect(changes[0].details).toContain("考勤工资");
    expect(changes[0].details).toContain("餐补");
  });

  it("金额未变化时不生成伪差额", () => {
    const base = archive();
    const next = buildFrozenPayrollSnapshot(employee("e1", "front"), slip("e1", 10000));
    expect(calculateArchiveAdjustments(base, { e1: next })).toEqual([]);
  });

  it("新归档字段不再依赖 PaySlip 的旧 frozenSnapshot 字段", () => {
    const snapshot = buildFrozenPayrollSnapshot(employee("e1", "front"), slip("e1", 9000));
    expect(snapshot.finalSalary).toBe(9000);
    expect("frozenSnapshot" in snapshot).toBe(false);
  });
});

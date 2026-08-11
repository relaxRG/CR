import { describe, expect, it } from "vitest";
import { buildFinalScheduleByDept, buildFrozenPayrollByEmployee } from "../lib/labor/month-close";
import { createMonthCloseOperationGate } from "../lib/labor/month-close-operation-gate";
import type { Employee, PaySlip, ShiftEntry } from "../lib/labor/types";

function makeEmployee(index: number): Employee {
  const dept = index % 2 === 0 ? "front" : "kitchen";
  return {
    id: `e-${index}`, code: `E${index}`, realName: `员工${index}`, phone: "", dept,
    type: "fulltime", baseSalary: 10000, restDaysPerMonth: 4, hourlyRate: 0,
    overtimeHourlyRate: 50, notes: "", active: true, createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeSlip(employeeId: string): PaySlip {
  return {
    id: `p-${employeeId}`, employeeId, month: "2026-07", attendanceDays: 27,
    attendanceSalary: 10000, performanceBonus: 0, salesCommission: 0, mealAllowance: 0,
    transportAllowance: 0, otherAllowance: 0, rewardPenalty: 0, advanceAmount: 0,
    grossSalary: 10000, socialInsuranceDeduction: 0, housingFundDeduction: 0,
    incomeTax: 0, finalSalary: 10000, notes: "", employerSocialInsurance: 0,
    employerHousingFund: 0, totalEmployerCost: 10000, updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

describe("月度归档并发与高负载保护", () => {
  it("同一月份操作守卫拒绝重入，释放后允许下一次合法操作", () => {
    const gate = createMonthCloseOperationGate();
    expect(gate.tryAcquire("2026-07")).toBe(true);
    expect(gate.tryAcquire("2026-07")).toBe(false);
    expect(gate.tryAcquire("2026-08")).toBe(true);
    expect(gate.isActive("2026-07")).toBe(true);
    gate.release("2026-07");
    expect(gate.tryAcquire("2026-07")).toBe(true);
    gate.release("2026-07");
    gate.release("2026-08");
  });

  it("异常退出也会释放守卫，不会把某个月永久锁死", () => {
    const gate = createMonthCloseOperationGate();
    expect(() => gate.runExclusive("2026-07", () => { throw new Error("模拟失败"); })).toThrow("模拟失败");
    expect(gate.isActive("2026-07")).toBe(false);
    expect(gate.runExclusive("2026-07", () => "ok")).toBe("ok");
  });

  it("2000名员工、62000条班次可在线性时间内按部门生成结算快照", () => {
    const employees = Array.from({ length: 2000 }, (_, index) => makeEmployee(index));
    const shifts: ShiftEntry[] = [];
    for (const employee of employees) {
      for (let day = 1; day <= 31; day += 1) {
        shifts.push({ employeeId: employee.id, date: `2026-07-${String(day).padStart(2, "0")}`, shift: "正常班", hoursValue: 8 });
      }
    }

    const startedAt = Date.now();
    const result = buildFinalScheduleByDept(employees, shifts, "2026-07");
    const elapsedMs = Date.now() - startedAt;
    const count = Object.values(result).reduce((total, snapshot) => total + (snapshot?.entryCount ?? 0), 0);

    expect(count).toBe(62000);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it("2000名员工的薪资冻结快照按索引构建，完整保留员工对应薪资", () => {
    const employees = Array.from({ length: 2000 }, (_, index) => makeEmployee(index));
    const slips = employees.map((employee) => makeSlip(employee.id));

    const startedAt = Date.now();
    const snapshots = buildFrozenPayrollByEmployee(employees, slips, "2026-07");
    const elapsedMs = Date.now() - startedAt;

    expect(Object.keys(snapshots)).toHaveLength(2000);
    expect(snapshots["e-1999"].finalSalary).toBe(10000);
    expect(elapsedMs).toBeLessThan(500);
  });
});

/**
 * 确认发薪全流程 E2E 测试
 * 覆盖：确认 → 锁定 → 调整模式 → 差额计算 → 分摊
 */
import { describe, it, expect } from "vitest";
import { calculateAdjustments, buildFrozenSnapshot, getAdjustmentForMonth } from "../lib/labor/payroll-confirmation";
import type { PaySlip, Employee, MonthlyConfirmation, PayrollAdjustment } from "../lib/labor/types";

// ─── 测试数据工厂 ─────────────────────────────────────────────────────────────

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-001",
    code: "子豪",
    realName: "王琪",
    phone: "",
    dept: "front",
    type: "fulltime",
    baseSalary: 8000,
    restDaysPerMonth: 4,
    active: true,
    createdAt: "2026-01-01",
    updatedAt: Date.now(),
    ...overrides,
  } as Employee;
}

function makePaySlip(overrides: Partial<PaySlip> = {}): PaySlip {
  return {
    id: "slip-001",
    employeeId: "emp-001",
    month: "2026-07",
    attendanceSalary: 8070,
    mealAllowance: 405,
    transportAllowance: 0,
    otherAllowance: 0,
    performanceBonus: 0,
    socialInsuranceDeduction: 0,
    housingFundDeduction: 0,
    advanceAmount: 0,
    grossSalary: 8475,
    finalSalary: 8475,
    updatedAt: "2026-07-31",
    ...overrides,
  } as PaySlip;
}

// ─── Suite H：确认发薪全流程 ─────────────────────────────────────────────────

describe("Suite H：确认发薪全流程", () => {
  describe("H1. buildFrozenSnapshot", () => {
    it("正确生成快照（所有字段复制）", () => {
      const slip = makePaySlip({
        grossSalary: 8475,
        finalSalary: 8475,
        attendanceSalary: 8070,
        mealAllowance: 405,
        transportAllowance: 200,
        otherAllowance: 100,
        performanceBonus: 500,
        socialInsuranceDeduction: 300,
        housingFundDeduction: 200,
        advanceAmount: 1000,
      });
      const snapshot = buildFrozenSnapshot(slip);
      expect(snapshot).toEqual({
        grossSalary: 8475,
        finalSalary: 8475,
        attendanceSalary: 8070,
        mealAllowance: 405,
        transportAllowance: 200,
        otherAllowance: 100,
        performanceBonus: 500,
        socialInsuranceDeduction: 300,
        housingFundDeduction: 200,
        advanceAmount: 1000,
      });
    });

    it("缺失字段默认为 0", () => {
      const slip = { id: "s1", employeeId: "e1", month: "2026-07", updatedAt: "2026-07-31" } as PaySlip;
      const snapshot = buildFrozenSnapshot(slip);
      expect(snapshot!.grossSalary).toBe(0);
      expect(snapshot!.finalSalary).toBe(0);
      expect(snapshot!.mealAllowance).toBe(0);
    });
  });

  describe("H2. calculateAdjustments（差额计算）", () => {
    it("无差异时返回空数组", () => {
      const emp = makeEmployee();
      const slip = makePaySlip({ frozenSnapshot: buildFrozenSnapshot(makePaySlip()) });
      const getPaySlip = () => slip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(0);
    });

    it("餐补增加 → 正差额", () => {
      const emp = makeEmployee();
      const originalSlip = makePaySlip({ mealAllowance: 15, finalSalary: 8085 });
      const frozenSnapshot = buildFrozenSnapshot(originalSlip);
      // 修改后：餐补从 15 变为 405
      const modifiedSlip = makePaySlip({ mealAllowance: 405, finalSalary: 8475, frozenSnapshot });
      const getPaySlip = () => modifiedSlip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(1);
      expect(diffs[0].employeeId).toBe("emp-001");
      expect(diffs[0].amount).toBe(390); // 8475 - 8085
      expect(diffs[0].breakdown).toContainEqual(
        expect.objectContaining({ field: "mealAllowance", before: 15, after: 405, diff: 390 })
      );
    });

    it("排班减少 → 负差额", () => {
      const emp = makeEmployee();
      const originalSlip = makePaySlip({ attendanceSalary: 8000, finalSalary: 8405 });
      const frozenSnapshot = buildFrozenSnapshot(originalSlip);
      // 修改后：考勤工资减少
      const modifiedSlip = makePaySlip({ attendanceSalary: 7500, finalSalary: 7905, frozenSnapshot });
      const getPaySlip = () => modifiedSlip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(1);
      expect(diffs[0].amount).toBe(-500); // 7905 - 8405
    });

    it("多字段同时变化 → 汇总差额", () => {
      const emp = makeEmployee();
      const originalSlip = makePaySlip({ attendanceSalary: 8000, mealAllowance: 15, finalSalary: 8015 });
      const frozenSnapshot = buildFrozenSnapshot(originalSlip);
      const modifiedSlip = makePaySlip({ attendanceSalary: 8500, mealAllowance: 405, finalSalary: 8905, frozenSnapshot });
      const getPaySlip = () => modifiedSlip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(1);
      expect(diffs[0].amount).toBe(890); // 8905 - 8015
      expect(diffs[0].breakdown).toHaveLength(2);
    });

    it("无 frozenSnapshot 的员工被跳过", () => {
      const emp = makeEmployee();
      const slip = makePaySlip(); // 无 frozenSnapshot
      const getPaySlip = () => slip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(0);
    });

    it("精度误差 < 0.01 被忽略", () => {
      const emp = makeEmployee();
      const originalSlip = makePaySlip({ finalSalary: 8000.005 });
      const frozenSnapshot = buildFrozenSnapshot(originalSlip);
      const modifiedSlip = makePaySlip({ finalSalary: 8000.009, frozenSnapshot });
      const getPaySlip = () => modifiedSlip;
      const diffs = calculateAdjustments([emp], getPaySlip, "2026-07");
      expect(diffs).toHaveLength(0);
    });
  });

  describe("H3. getAdjustmentForMonth（差额分摊）", () => {
    it("上月无确认记录 → 返回 0", () => {
      const result = getAdjustmentForMonth([], "emp-001", "2026-08");
      expect(result).toBe(0);
    });

    it("上月有未处理的 next_month 差额 → 返回差额金额", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: 390, details: "餐补增加", settled: false, settleMethod: "next_month" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(result).toBe(390);
    });

    it("上月差额已处理 → 返回 0", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: 390, details: "", settled: true, settleMethod: "next_month", settledInMonth: "2026-08" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(result).toBe(0);
    });

    it("上月差额方式为 separate → 不计入下月", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: 390, details: "", settled: false, settleMethod: "separate" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(result).toBe(0);
    });

    it("多条未处理差额 → 汇总", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: 390, details: "", settled: false, settleMethod: "next_month" },
          { id: "adj-2", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: -100, details: "", settled: false, settleMethod: "next_month" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(result).toBe(290); // 390 + (-100)
    });

    it("跨年（1月读取上年12月）", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2025-12",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-001", employeeName: "子豪", amount: 200, details: "", settled: false, settleMethod: "next_month" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-01");
      expect(result).toBe(200);
    });

    it("其他员工的差额不影响当前员工", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        adjustments: [
          { id: "adj-1", createdAt: Date.now(), employeeId: "emp-002", employeeName: "RG", amount: 500, details: "", settled: false, settleMethod: "next_month" },
        ],
      }];
      const result = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(result).toBe(0);
    });
  });
});

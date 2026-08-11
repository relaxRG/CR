import { describe, expect, it } from "vitest";
import {
  generateSeparatePaymentSlip,
  generateSeparatePayments,
  getAdjustmentForMonth,
} from "../lib/labor/adjustment-settlement";
import type { MonthCloseArchive, PayrollAdjustment } from "../lib/labor/types";

const archive = (month: string, version: number, adjustments: PayrollAdjustment[]): MonthCloseArchive => ({
  id: `close-${month}-${version}`,
  month,
  version,
  status: "frozen",
  createdAt: 1,
  closedBy: "manager",
  summary: { totalEmployees: 1, totalGrossSalary: 10000, totalFinalSalary: 9000, totalDeductions: 1000 },
  scheduleByDept: {},
  payrollByEmployee: {},
  adjustments,
});

const adjustment = (overrides: Partial<PayrollAdjustment> = {}): PayrollAdjustment => ({
  id: "adj-1",
  archiveId: "close-2026-07-1",
  createdAt: 1,
  employeeId: "emp-1",
  employeeName: "王琪",
  amount: 300,
  details: "漏发绩效",
  settled: false,
  settleMethod: "separate",
  ...overrides,
});

describe("Suite J：独立补发与月度归档差额结算", () => {
  it("单独补发单与月度薪资单隔离", () => {
    const slip = generateSeparatePaymentSlip(adjustment(), "2026-07");
    expect(slip.sourceMonth).toBe("2026-07");
    expect(slip.paymentStatus).toBe("pending");
    expect(slip.amount).toBe(300);
  });

  it("只批量生成明确选择单独补发的未结算差额", () => {
    const slips = generateSeparatePayments([
      adjustment({ id: "a", settleMethod: "separate" }),
      adjustment({ id: "b", settleMethod: "next_month" }),
      adjustment({ id: "c", settleMethod: "separate", settled: true }),
    ], "2026-07");
    expect(slips).toHaveLength(1);
    expect(slips[0].adjustmentId).toBe("a");
  });

  it("下月只读取上一月当前冻结归档中选择计入下月的未结算差额", () => {
    const result = getAdjustmentForMonth([
      archive("2026-07", 1, [
        adjustment({ id: "a", settleMethod: "next_month", amount: 250 }),
        adjustment({ id: "b", settleMethod: "separate", amount: 100 }),
        adjustment({ id: "c", settleMethod: "next_month", settled: true, amount: 50 }),
      ]),
    ], "emp-1", "2026-08");
    expect(result).toBe(250);
  });

  it("被新版本替代的归档不参与下月差额", () => {
    const v1 = { ...archive("2026-07", 1, [adjustment({ amount: 100, settleMethod: "next_month" })]), status: "superseded" as const };
    const v2 = archive("2026-07", 2, [adjustment({ amount: 220, settleMethod: "next_month" })]);
    expect(getAdjustmentForMonth([v1, v2], "emp-1", "2026-08")).toBe(220);
  });

  it("跨年时可正确读取上一自然月归档", () => {
    expect(getAdjustmentForMonth([
      archive("2025-12", 1, [adjustment({ amount: -80, settleMethod: "next_month" })]),
    ], "emp-1", "2026-01")).toBe(-80);
  });
});

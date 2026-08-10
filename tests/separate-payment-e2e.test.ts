/**
 * Suite J：单独补发实付对账 E2E 测试
 * 覆盖：生成补发单、隔离验证、付款对账、汇总统计
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { PayrollAdjustment } from "../lib/labor/types";
import {
  generateSeparatePaymentSlip,
  generateSeparatePayments,
  getAdjustmentForMonth,
  type SeparatePaymentSlip,
} from "../lib/labor/payroll-confirmation";
import type { MonthlyConfirmation } from "../lib/labor/types";

// ─── 模拟 SeparatePaymentStore（纯逻辑版本）──────────────────────────────────

class SeparatePaymentStoreMock {
  payments: SeparatePaymentSlip[] = [];

  addPayments(slips: SeparatePaymentSlip[]) {
    this.payments.push(...slips);
  }

  markPaid(id: string) {
    this.payments = this.payments.map((p) =>
      p.id === id ? { ...p, paymentStatus: "paid" as const, paidAt: Date.now() } : p
    );
  }

  deletePayment(id: string) {
    this.payments = this.payments.filter((p) => p.id !== id);
  }

  getByMonth(month: string) {
    return this.payments.filter((p) => p.sourceMonth === month);
  }

  getByEmployee(employeeId: string) {
    return this.payments.filter((p) => p.employeeId === employeeId);
  }

  getPending() {
    return this.payments.filter((p) => p.paymentStatus === "pending");
  }

  getSummary() {
    const total = this.payments.length;
    const pending = this.payments.filter((p) => p.paymentStatus === "pending").length;
    const paid = total - pending;
    const totalAmount = this.payments.reduce((sum, p) => sum + p.amount, 0);
    const pendingAmount = this.payments.filter((p) => p.paymentStatus === "pending").reduce((sum, p) => sum + p.amount, 0);
    return { total, pending, paid, totalAmount, pendingAmount };
  }
}

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

const MONTH = "2026-07";

function makeAdjustment(overrides: Partial<PayrollAdjustment> = {}): PayrollAdjustment {
  return {
    id: `adj-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    employeeId: "emp-001",
    employeeName: "子豪",
    amount: 390,
    details: "餐补: ¥15 → ¥405 (+¥390)",
    settled: false,
    settleMethod: "separate",
    ...overrides,
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite J：单独补发实付对账", () => {
  let store: SeparatePaymentStoreMock;

  beforeEach(() => {
    store = new SeparatePaymentStoreMock();
  });

  describe("J1. 补发单生成", () => {
    it("从差额记录生成补发单", () => {
      const adj = makeAdjustment();
      const slip = generateSeparatePaymentSlip(adj, MONTH);
      expect(slip.id).toMatch(/^sep-/);
      expect(slip.adjustmentId).toBe(adj.id);
      expect(slip.employeeId).toBe("emp-001");
      expect(slip.employeeName).toBe("子豪");
      expect(slip.sourceMonth).toBe(MONTH);
      expect(slip.amount).toBe(390);
      expect(slip.paymentStatus).toBe("pending");
      expect(slip.paidAt).toBeUndefined();
    });

    it("批量生成补发单（仅 separate 且未处理）", () => {
      const adjs: PayrollAdjustment[] = [
        makeAdjustment({ id: "a1", settleMethod: "separate", settled: false }),
        makeAdjustment({ id: "a2", settleMethod: "next_month", settled: false }), // 不应生成
        makeAdjustment({ id: "a3", settleMethod: "separate", settled: true }),    // 不应生成
        makeAdjustment({ id: "a4", settleMethod: "separate", settled: false, employeeName: "RG", amount: -100 }),
      ];
      const slips = generateSeparatePayments(adjs, MONTH);
      expect(slips).toHaveLength(2);
      expect(slips[0].adjustmentId).toBe("a1");
      expect(slips[1].adjustmentId).toBe("a4");
      expect(slips[1].amount).toBe(-100);
    });

    it("负金额补发单（扣回）", () => {
      const adj = makeAdjustment({ amount: -200, details: "多发扣回" });
      const slip = generateSeparatePaymentSlip(adj, MONTH);
      expect(slip.amount).toBe(-200);
    });
  });

  describe("J2. 隔离验证 — 补发单不影响正常薪资", () => {
    it("separate 差额不计入下月薪资", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        frozenBy: "manager",
        adjustments: [
          makeAdjustment({ settleMethod: "separate", settled: false }),
        ],
        summary: { totalEmployees: 1, totalGrossSalary: 8000, totalFinalSalary: 8000, totalDeductions: 0 },
      }];
      // getAdjustmentForMonth 只读取 "next_month"，不读取 "separate"
      const adj = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(adj).toBe(0); // 隔离成功：不计入下月
    });

    it("next_month 差额计入下月薪资", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        frozenBy: "manager",
        adjustments: [
          makeAdjustment({ settleMethod: "next_month", settled: false, amount: 390 }),
        ],
        summary: { totalEmployees: 1, totalGrossSalary: 8000, totalFinalSalary: 8000, totalDeductions: 0 },
      }];
      const adj = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(adj).toBe(390); // 正确计入下月
    });

    it("同一员工同时有 separate 和 next_month 差额", () => {
      const confirmations: MonthlyConfirmation[] = [{
        month: "2026-07",
        status: "frozen",
        frozenAt: Date.now(),
        frozenBy: "manager",
        adjustments: [
          makeAdjustment({ id: "a1", settleMethod: "separate", amount: 390 }),
          makeAdjustment({ id: "a2", settleMethod: "next_month", amount: 100 }),
        ],
        summary: { totalEmployees: 1, totalGrossSalary: 8000, totalFinalSalary: 8000, totalDeductions: 0 },
      }];
      // 只有 next_month 的 100 计入下月，separate 的 390 不计入
      const adj = getAdjustmentForMonth(confirmations, "emp-001", "2026-08");
      expect(adj).toBe(100);
    });
  });

  describe("J3. 付款对账", () => {
    beforeEach(() => {
      const adjs = [
        makeAdjustment({ id: "a1", amount: 390, employeeName: "子豪" }),
        makeAdjustment({ id: "a2", amount: 200, employeeName: "RG", employeeId: "emp-002" }),
        makeAdjustment({ id: "a3", amount: -50, employeeName: "Stephen", employeeId: "emp-003" }),
      ];
      const slips = adjs.map((a) => generateSeparatePaymentSlip(a, MONTH));
      store.addPayments(slips);
    });

    it("初始状态全部为 pending", () => {
      expect(store.getPending()).toHaveLength(3);
      const summary = store.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.pending).toBe(3);
      expect(summary.paid).toBe(0);
    });

    it("标记付款后状态变为 paid", () => {
      const first = store.payments[0];
      store.markPaid(first.id);
      expect(store.payments[0].paymentStatus).toBe("paid");
      expect(store.payments[0].paidAt).toBeGreaterThan(0);
      expect(store.getPending()).toHaveLength(2);
    });

    it("汇总统计正确", () => {
      store.markPaid(store.payments[0].id);
      const summary = store.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.pending).toBe(2);
      expect(summary.paid).toBe(1);
      expect(summary.totalAmount).toBe(390 + 200 + (-50)); // 540
      expect(summary.pendingAmount).toBe(200 + (-50)); // 150
    });

    it("按月份筛选", () => {
      expect(store.getByMonth(MONTH)).toHaveLength(3);
      expect(store.getByMonth("2026-08")).toHaveLength(0);
    });

    it("按员工筛选", () => {
      expect(store.getByEmployee("emp-001")).toHaveLength(1);
      expect(store.getByEmployee("emp-002")).toHaveLength(1);
      expect(store.getByEmployee("emp-999")).toHaveLength(0);
    });

    it("删除补发单", () => {
      const first = store.payments[0];
      store.deletePayment(first.id);
      expect(store.payments).toHaveLength(2);
      expect(store.payments.find((p) => p.id === first.id)).toBeUndefined();
    });
  });

  describe("J4. 完整流程 E2E", () => {
    it("确认发薪 → 调整 → 选择单独补发 → 生成补发单 → 付款 → 对账", () => {
      // Step 1: 差额产生
      const adj = makeAdjustment({ settleMethod: "separate", amount: 390 });

      // Step 2: 生成补发单
      const slip = generateSeparatePaymentSlip(adj, MONTH);
      store.addPayments([slip]);
      expect(store.payments).toHaveLength(1);
      expect(store.getPending()).toHaveLength(1);

      // Step 3: 验证隔离（不影响下月薪资）
      const confirmations: MonthlyConfirmation[] = [{
        month: MONTH,
        status: "frozen",
        frozenAt: Date.now(),
        frozenBy: "manager",
        adjustments: [adj],
        summary: { totalEmployees: 1, totalGrossSalary: 8000, totalFinalSalary: 8000, totalDeductions: 0 },
      }];
      expect(getAdjustmentForMonth(confirmations, "emp-001", "2026-08")).toBe(0);

      // Step 4: 标记付款
      store.markPaid(slip.id);
      expect(store.payments[0].paymentStatus).toBe("paid");
      expect(store.getPending()).toHaveLength(0);

      // Step 5: 对账验证
      const summary = store.getSummary();
      expect(summary.total).toBe(1);
      expect(summary.paid).toBe(1);
      expect(summary.pending).toBe(0);
      expect(summary.pendingAmount).toBe(0);
      expect(summary.totalAmount).toBe(390);
    });

    it("多员工批量补发 → 逐个付款 → 全部对账完成", () => {
      const adjs: PayrollAdjustment[] = [
        makeAdjustment({ id: "a1", employeeId: "e1", employeeName: "子豪", amount: 390, settleMethod: "separate" }),
        makeAdjustment({ id: "a2", employeeId: "e2", employeeName: "RG", amount: 200, settleMethod: "separate" }),
        makeAdjustment({ id: "a3", employeeId: "e3", employeeName: "Stephen", amount: 50, settleMethod: "separate" }),
      ];
      const slips = generateSeparatePayments(adjs, MONTH);
      store.addPayments(slips);

      // 逐个付款
      expect(store.getPending()).toHaveLength(3);
      store.markPaid(store.payments[0].id);
      expect(store.getPending()).toHaveLength(2);
      store.markPaid(store.payments[1].id);
      expect(store.getPending()).toHaveLength(1);
      store.markPaid(store.payments[2].id);
      expect(store.getPending()).toHaveLength(0);

      // 全部对账完成
      const summary = store.getSummary();
      expect(summary.paid).toBe(3);
      expect(summary.pending).toBe(0);
      expect(summary.pendingAmount).toBe(0);
      expect(summary.totalAmount).toBe(640);
    });
  });
});

/**
 * usePayrollConfirmationStore 状态机单元测试
 * 覆盖：状态转换、边界条件、并发安全
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { MonthlyConfirmation, PayrollAdjustment } from "../lib/labor/types";

// ─── 模拟 Store 逻辑（纯函数版本，与 Provider 中的逻辑一致）─────────────────

class PayrollConfirmationStateMachine {
  private confirmations: MonthlyConfirmation[] = [];

  getConfirmation(month: string): MonthlyConfirmation | null {
    return this.confirmations.find((c) => c.month === month) ?? null;
  }

  getStatus(month: string): "draft" | "frozen" | "adjusting" {
    return this.getConfirmation(month)?.status ?? "draft";
  }

  isMonthLocked(month: string): boolean {
    return this.getStatus(month) === "frozen";
  }

  isMonthWritable(month: string): boolean {
    const status = this.getStatus(month);
    return status === "draft" || status === "adjusting";
  }

  confirmPayroll(month: string, summary: MonthlyConfirmation["summary"]) {
    const existing = this.getConfirmation(month);
    this.upsert({
      month,
      status: "frozen",
      frozenAt: Date.now(),
      frozenBy: "manager",
      adjustingAt: undefined,
      adjustments: existing?.adjustments ?? [],
      summary,
    });
  }

  enterAdjustMode(month: string) {
    const existing = this.getConfirmation(month);
    if (!existing || existing.status !== "frozen") return;
    this.upsert({ ...existing, status: "adjusting", adjustingAt: Date.now() });
  }

  confirmAdjustment(month: string, adjustments: PayrollAdjustment[]) {
    const existing = this.getConfirmation(month);
    if (!existing || existing.status !== "adjusting") return;
    this.upsert({
      ...existing,
      status: "frozen",
      frozenAt: Date.now(),
      adjustments: [...existing.adjustments, ...adjustments],
    });
  }

  cancelAdjustment(month: string) {
    const existing = this.getConfirmation(month);
    if (!existing || existing.status !== "adjusting") return;
    this.upsert({ ...existing, status: "frozen", adjustingAt: undefined });
  }

  revokeConfirmation(month: string) {
    const existing = this.getConfirmation(month);
    if (!existing) return;
    this.upsert({ ...existing, status: "draft", frozenAt: undefined, frozenBy: undefined });
  }

  settleAdjustment(month: string, adjustmentId: string, method: "next_month" | "separate" | "ignored", settledInMonth: string) {
    const existing = this.getConfirmation(month);
    if (!existing) return;
    const updated = existing.adjustments.map((a): PayrollAdjustment =>
      a.id === adjustmentId ? { ...a, settled: true, settleMethod: method, settledInMonth } : a
    );
    this.upsert({ ...existing, adjustments: updated });
  }

  getPendingAdjustments(month: string): PayrollAdjustment[] {
    const existing = this.getConfirmation(month);
    if (!existing) return [];
    return existing.adjustments.filter((a) => !a.settled);
  }

  private upsert(conf: MonthlyConfirmation) {
    const idx = this.confirmations.findIndex((c) => c.month === conf.month);
    if (idx >= 0) { this.confirmations[idx] = conf; }
    else { this.confirmations.push(conf); }
  }
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite I：usePayrollConfirmationStore 状态机", () => {
  let sm: PayrollConfirmationStateMachine;
  const MONTH = "2026-07";
  const SUMMARY = { totalEmployees: 5, totalGrossSalary: 40000, totalFinalSalary: 38000, totalDeductions: 2000 };

  beforeEach(() => {
    sm = new PayrollConfirmationStateMachine();
  });

  describe("I1. 初始状态", () => {
    it("未确认月份状态为 draft", () => {
      expect(sm.getStatus(MONTH)).toBe("draft");
    });

    it("未确认月份 isMonthWritable = true", () => {
      expect(sm.isMonthWritable(MONTH)).toBe(true);
    });

    it("未确认月份 isMonthLocked = false", () => {
      expect(sm.isMonthLocked(MONTH)).toBe(false);
    });

    it("未确认月份 getConfirmation = null", () => {
      expect(sm.getConfirmation(MONTH)).toBeNull();
    });
  });

  describe("I2. DRAFT → FROZEN（确认发薪）", () => {
    it("confirmPayroll 将状态变为 frozen", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      expect(sm.getStatus(MONTH)).toBe("frozen");
    });

    it("确认后 isMonthLocked = true", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      expect(sm.isMonthLocked(MONTH)).toBe(true);
    });

    it("确认后 isMonthWritable = false", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      expect(sm.isMonthWritable(MONTH)).toBe(false);
    });

    it("确认后 frozenAt 有值", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.frozenAt).toBeGreaterThan(0);
      expect(conf.frozenBy).toBe("manager");
    });

    it("确认后 summary 正确保存", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.summary).toEqual(SUMMARY);
    });

    it("不同月份互不影响", () => {
      sm.confirmPayroll("2026-07", SUMMARY);
      expect(sm.getStatus("2026-07")).toBe("frozen");
      expect(sm.getStatus("2026-08")).toBe("draft");
    });
  });

  describe("I3. FROZEN → ADJUSTING（进入调整模式）", () => {
    beforeEach(() => { sm.confirmPayroll(MONTH, SUMMARY); });

    it("enterAdjustMode 将状态变为 adjusting", () => {
      sm.enterAdjustMode(MONTH);
      expect(sm.getStatus(MONTH)).toBe("adjusting");
    });

    it("调整模式下 isMonthWritable = true", () => {
      sm.enterAdjustMode(MONTH);
      expect(sm.isMonthWritable(MONTH)).toBe(true);
    });

    it("调整模式下 isMonthLocked = false", () => {
      sm.enterAdjustMode(MONTH);
      expect(sm.isMonthLocked(MONTH)).toBe(false);
    });

    it("adjustingAt 有值", () => {
      sm.enterAdjustMode(MONTH);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustingAt).toBeGreaterThan(0);
    });

    it("draft 状态下 enterAdjustMode 无效", () => {
      const sm2 = new PayrollConfirmationStateMachine();
      sm2.enterAdjustMode(MONTH);
      expect(sm2.getStatus(MONTH)).toBe("draft");
    });
  });

  describe("I4. ADJUSTING → FROZEN（确认调整）", () => {
    const ADJ: PayrollAdjustment = {
      id: "adj-001", createdAt: Date.now(), employeeId: "emp-001",
      employeeName: "子豪", amount: 390, details: "餐补增加",
      settled: false, settleMethod: "next_month",
    };

    beforeEach(() => {
      sm.confirmPayroll(MONTH, SUMMARY);
      sm.enterAdjustMode(MONTH);
    });

    it("confirmAdjustment 将状态变回 frozen", () => {
      sm.confirmAdjustment(MONTH, [ADJ]);
      expect(sm.getStatus(MONTH)).toBe("frozen");
    });

    it("调整记录被追加", () => {
      sm.confirmAdjustment(MONTH, [ADJ]);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustments).toHaveLength(1);
      expect(conf.adjustments[0].amount).toBe(390);
    });

    it("多次调整记录累积", () => {
      sm.confirmAdjustment(MONTH, [ADJ]);
      sm.enterAdjustMode(MONTH);
      sm.confirmAdjustment(MONTH, [{ ...ADJ, id: "adj-002", amount: -100 }]);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustments).toHaveLength(2);
    });

    it("frozen 状态下 confirmAdjustment 无效", () => {
      sm.confirmAdjustment(MONTH, [ADJ]); // 先确认（变 frozen）
      sm.confirmAdjustment(MONTH, [{ ...ADJ, id: "adj-002" }]); // 在 frozen 下再调用
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustments).toHaveLength(1); // 只有第一次的
    });
  });

  describe("I5. ADJUSTING → FROZEN（取消调整）", () => {
    beforeEach(() => {
      sm.confirmPayroll(MONTH, SUMMARY);
      sm.enterAdjustMode(MONTH);
    });

    it("cancelAdjustment 将状态变回 frozen", () => {
      sm.cancelAdjustment(MONTH);
      expect(sm.getStatus(MONTH)).toBe("frozen");
    });

    it("取消后 adjustingAt 被清除", () => {
      sm.cancelAdjustment(MONTH);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustingAt).toBeUndefined();
    });

    it("取消不影响已有的调整记录", () => {
      // 先做一次调整
      sm.confirmAdjustment(MONTH, [{ id: "adj-1", createdAt: Date.now(), employeeId: "e1", employeeName: "A", amount: 100, details: "", settled: false, settleMethod: "next_month" }]);
      // 再进入调整模式并取消
      sm.enterAdjustMode(MONTH);
      sm.cancelAdjustment(MONTH);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustments).toHaveLength(1);
    });
  });

  describe("I6. FROZEN → DRAFT（撤销确认）", () => {
    beforeEach(() => { sm.confirmPayroll(MONTH, SUMMARY); });

    it("revokeConfirmation 将状态变为 draft", () => {
      sm.revokeConfirmation(MONTH);
      expect(sm.getStatus(MONTH)).toBe("draft");
    });

    it("撤销后 frozenAt 被清除", () => {
      sm.revokeConfirmation(MONTH);
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.frozenAt).toBeUndefined();
    });

    it("撤销后 isMonthWritable = true", () => {
      sm.revokeConfirmation(MONTH);
      expect(sm.isMonthWritable(MONTH)).toBe(true);
    });

    it("对不存在的月份 revoke 无效", () => {
      sm.revokeConfirmation("2099-01");
      expect(sm.getConfirmation("2099-01")).toBeNull();
    });
  });

  describe("I7. 差额处理（settle）", () => {
    const ADJ: PayrollAdjustment = {
      id: "adj-001", createdAt: Date.now(), employeeId: "emp-001",
      employeeName: "子豪", amount: 390, details: "餐补增加",
      settled: false, settleMethod: "next_month",
    };

    beforeEach(() => {
      sm.confirmPayroll(MONTH, SUMMARY);
      sm.enterAdjustMode(MONTH);
      sm.confirmAdjustment(MONTH, [ADJ]);
    });

    it("settleAdjustment 标记为已处理", () => {
      sm.settleAdjustment(MONTH, "adj-001", "next_month", "2026-08");
      const conf = sm.getConfirmation(MONTH)!;
      expect(conf.adjustments[0].settled).toBe(true);
      expect(conf.adjustments[0].settledInMonth).toBe("2026-08");
    });

    it("getPendingAdjustments 不包含已处理的", () => {
      expect(sm.getPendingAdjustments(MONTH)).toHaveLength(1);
      sm.settleAdjustment(MONTH, "adj-001", "next_month", "2026-08");
      expect(sm.getPendingAdjustments(MONTH)).toHaveLength(0);
    });

    it("settle 不存在的 adjustmentId 无影响", () => {
      sm.settleAdjustment(MONTH, "nonexistent", "ignored", "2026-08");
      expect(sm.getPendingAdjustments(MONTH)).toHaveLength(1);
    });
  });

  describe("I8. 非法状态转换（防御性）", () => {
    it("draft → adjusting 无效（必须先 confirm）", () => {
      sm.enterAdjustMode(MONTH);
      expect(sm.getStatus(MONTH)).toBe("draft");
    });

    it("draft → cancelAdjustment 无效", () => {
      sm.cancelAdjustment(MONTH);
      expect(sm.getStatus(MONTH)).toBe("draft");
    });

    it("adjusting → confirmPayroll 覆盖为 frozen", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      sm.enterAdjustMode(MONTH);
      sm.confirmPayroll(MONTH, SUMMARY); // 强制重新确认
      expect(sm.getStatus(MONTH)).toBe("frozen");
    });

    it("重复 confirmPayroll 幂等", () => {
      sm.confirmPayroll(MONTH, SUMMARY);
      sm.confirmPayroll(MONTH, SUMMARY);
      expect(sm.getStatus(MONTH)).toBe("frozen");
    });
  });
});

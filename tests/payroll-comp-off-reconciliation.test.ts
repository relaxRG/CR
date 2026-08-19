import { describe, expect, it } from "vitest";
import { getLegacyCompOffCashOutDelta, settleCompOffCashOut } from "@/lib/labor/comp-off-cashout-settlement";
import { reducePayrollReconciliationState } from "@/lib/labor/payroll-reconciliation-state";
import type { CompOffBalanceEntry } from "@/lib/labor/types";

const entry = (id: string, patch: Partial<CompOffBalanceEntry> = {}): CompOffBalanceEntry => ({
  id,
  employeeId: "e-1",
  earnedMonth: "2026-04",
  source: "overtime",
  days: 1,
  expiresMonth: "2026-07",
  status: "cashed_out",
  usedMonth: "2026-07",
  cashOutUnitRate: 296.3,
  cashOutAmount: 296.3,
  createdAt: "2026-04-01T00:00:00.000Z",
  ...patch,
});

describe("调休兑现薪资核对", () => {
  it("只汇总本员工、本月且已兑现的余额流水", () => {
    const result = settleCompOffCashOut([
      entry("valid"),
      entry("other-month", { usedMonth: "2026-06" }),
      entry("available", { status: "available" }),
      entry("other-employee", { employeeId: "e-2" }),
    ], "e-1", "2026-07");
    expect(result.amount).toBe(296.3);
    expect(result.entryIds).toEqual(["valid"]);
  });

  it("按分精度汇总多笔兑现并识别无法追溯的历史薪资金额", () => {
    const result = settleCompOffCashOut([entry("one", { cashOutAmount: 0.1 }), entry("two", { cashOutAmount: 0.2 })], "e-1", "2026-07");
    expect(result.amount).toBe(0.3);
    expect(getLegacyCompOffCashOutDelta({ compOffCashOut: 296.3 }, result)).toBe(296);
    expect(getLegacyCompOffCashOutDelta({ compOffCashOut: 0.3 }, result)).toBe(0);
  });

  it("修正面板执行中不允许关闭或重复启动另一条修正路径", () => {
    const inspecting = reducePayrollReconciliationState({ tag: "closed" }, { type: "OPEN" });
    const rebuilding = reducePayrollReconciliationState(inspecting, { type: "REBUILD_DRAFT" });
    expect(reducePayrollReconciliationState(rebuilding, { type: "CLOSE" })).toEqual(rebuilding);
    expect(reducePayrollReconciliationState(rebuilding, { type: "OPEN_ADJUSTMENT" })).toEqual(rebuilding);
    expect(reducePayrollReconciliationState(rebuilding, { type: "SUCCESS", message: "完成" })).toEqual({ tag: "completed", message: "完成" });
  });
});

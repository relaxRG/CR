import { describe, expect, it } from "vitest";
import { createCompOffCashOutEvent, findCompOffCashOutIssues, getLegacyCompOffCashOutDelta, settleCompOffCashOut, voidCompOffCashOutEvent } from "@/lib/labor/comp-off-cashout-settlement";
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
  settlement: {
    id: `cashout-${id}`,
    entryId: id,
    employeeId: "e-1",
    source: "overtime",
    earnedMonth: "2026-04",
    usedMonth: "2026-07",
    days: 1,
    unitRate: 296.3,
    amount: 296.3,
    createdAt: "2026-04-01T00:00:00.000Z",
    status: "active",
  },
  createdAt: "2026-04-01T00:00:00.000Z",
  ...patch,
});

describe("调休兑现薪资核对", () => {
  it("只汇总本员工、本月且有效的唯一兑现事件", () => {
    const result = settleCompOffCashOut([
      entry("valid"),
      entry("other-month", { usedMonth: "2026-06", settlement: { ...entry("other-month").settlement!, usedMonth: "2026-06" } }),
      entry("available", { status: "available", usedMonth: undefined, settlement: undefined }),
      entry("other-employee", { employeeId: "e-2", settlement: { ...entry("other-employee").settlement!, employeeId: "e-2" } }),
    ], "e-1", "2026-07");
    expect(result.amount).toBe(296.3);
    expect(result.entryIds).toEqual(["valid"]);
  });

  it("将1天×¥0却保存为¥1的历史事件隔离，绝不计入薪资", () => {
    const corrupted = entry("ziheng-zero-rate", {
      earnedMonth: "2026-08",
      usedMonth: "2026-08",
      settlement: {
        ...entry("ziheng-zero-rate").settlement!,
        earnedMonth: "2026-08",
        usedMonth: "2026-08",
        unitRate: 0,
        amount: 1,
        status: "quarantined",
        issueCode: "ZERO_RATE_NON_ZERO_AMOUNT",
      },
    });
    const result = settleCompOffCashOut([corrupted], "e-1", "2026-08");
    expect(result.amount).toBe(0);
    expect(result.issues).toMatchObject([{ entryId: "ziheng-zero-rate", code: "ZERO_RATE_NON_ZERO_AMOUNT", amount: 1 }]);
  });

  it("按分精度汇总，并把¥296.30无来源薪资额报告为待更正而非静默保留", () => {
    const one = entry("one", { settlement: { ...entry("one").settlement!, unitRate: 0.1, amount: 0.1 } });
    const two = entry("two", { settlement: { ...entry("two").settlement!, unitRate: 0.2, amount: 0.2 } });
    const result = settleCompOffCashOut([one, two], "e-1", "2026-07");
    expect(result.amount).toBe(0.3);
    expect(getLegacyCompOffCashOutDelta({ compOffCashOut: 296.3 }, result)).toBe(296);
    expect(getLegacyCompOffCashOutDelta({ compOffCashOut: 0.3 }, result)).toBe(0);
    expect(findCompOffCashOutIssues([one, two], [{ employeeId: "e-1", month: "2026-07", compOffCashOut: 296.3 } as any]))
      .toMatchObject([{ employeeId: "e-1", month: "2026-07", code: "ORPHAN_PAYSLIP_CASHOUT", amount: 296 }]);
  });

  it("草稿月作废错误兑现会恢复余额并保留不可改写的作废审计历史", () => {
    const corrupted = entry("bad", { settlement: { ...entry("bad").settlement!, unitRate: 0, amount: 1, status: "quarantined", issueCode: "ZERO_RATE_NON_ZERO_AMOUNT" } });
    const voided = voidCompOffCashOutEvent(corrupted, "核对修正");
    expect(voided.status).toBe("available");
    expect(voided.usedMonth).toBeUndefined();
    expect(voided.settlement).toBeUndefined();
    expect(voided.settlementHistory).toMatchObject([{ amount: 1, status: "voided", voidReason: "核对修正" }]);
    expect(createCompOffCashOutEvent(voided, 0, "2026-08")).toBeNull();
  });

  it("修正面板执行中不允许关闭或重复启动另一条修正路径", () => {
    const inspecting = reducePayrollReconciliationState({ tag: "closed" }, { type: "OPEN" });
    const rebuilding = reducePayrollReconciliationState(inspecting, { type: "REBUILD_DRAFT" });
    expect(reducePayrollReconciliationState(rebuilding, { type: "CLOSE" })).toEqual(rebuilding);
    expect(reducePayrollReconciliationState(rebuilding, { type: "OPEN_ADJUSTMENT" })).toEqual(rebuilding);
    expect(reducePayrollReconciliationState(rebuilding, { type: "SUCCESS", message: "完成" })).toEqual({ tag: "completed", message: "完成" });
  });
});

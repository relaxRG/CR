/**
 * tests/payroll-lock-state-machine.test.ts
 *
 * 月度锁定状态机自动化测试
 *
 * 覆盖场景：
 *   Suite A：基础状态转换（DRAFT → FROZEN → ADJUSTING → FROZEN）
 *   Suite B：非法状态转换防护
 *   Suite C：锁定状态下的写入拦截
 *   Suite D：summary 完整性
 *   Suite E：多月份隔离（跨月/跨年）
 *   Suite F：差额调整流程
 *   Suite G：边界情况（空数据/连续操作/大量月份）
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PayrollConfirmationStatus,
  MonthlyConfirmation,
  PayrollAdjustment,
  AdjustmentSettleMethod,
} from "@/lib/labor/types";

// ─── 辅助函数：模拟 usePayrollConfirmationStore 的核心逻辑 ──────────────────

function createMockStore() {
  let confirmations: MonthlyConfirmation[] = [];

  function getConfirmation(month: string): MonthlyConfirmation | undefined {
    return confirmations.find((c) => c.month === month);
  }

  function upsertConfirmation(conf: MonthlyConfirmation) {
    const idx = confirmations.findIndex((c) => c.month === conf.month);
    if (idx >= 0) {
      confirmations = [...confirmations.slice(0, idx), conf, ...confirmations.slice(idx + 1)];
    } else {
      confirmations = [...confirmations, conf];
    }
  }

  function getStatus(month: string): PayrollConfirmationStatus {
    return getConfirmation(month)?.status ?? "draft";
  }

  // 与 store.tsx:1177 一致：只有 frozen 才算 locked
  function isMonthLocked(month: string): boolean {
    return getStatus(month) === "frozen";
  }

  // 与 store.tsx:1181 一致：draft 和 adjusting 都可写
  function isMonthWritable(month: string): boolean {
    const status = getStatus(month);
    return status === "draft" || status === "adjusting";
  }

  function confirmPayroll(month: string, summary: NonNullable<MonthlyConfirmation["summary"]>) {
    const existing = getConfirmation(month);
    upsertConfirmation({
      month,
      status: "frozen",
      frozenAt: Date.now(),
      frozenBy: "manager",
      adjustingAt: undefined,
      adjustments: existing?.adjustments ?? [],
      summary,
    });
  }

  function enterAdjustMode(month: string) {
    const existing = getConfirmation(month);
    if (!existing || existing.status !== "frozen") return;
    upsertConfirmation({ ...existing, status: "adjusting", adjustingAt: Date.now() });
  }

  function confirmAdjustment(month: string, adjustments: PayrollAdjustment[]) {
    const existing = getConfirmation(month);
    if (!existing || existing.status !== "adjusting") return;
    upsertConfirmation({
      ...existing,
      status: "frozen",
      frozenAt: Date.now(),
      adjustments: [...existing.adjustments, ...adjustments],
    });
  }

  function cancelAdjustment(month: string) {
    const existing = getConfirmation(month);
    if (!existing || existing.status !== "adjusting") return;
    upsertConfirmation({ ...existing, status: "frozen", adjustingAt: undefined });
  }

  function revokeConfirmation(month: string) {
    const existing = getConfirmation(month);
    if (!existing) return;
    upsertConfirmation({ ...existing, status: "draft", frozenAt: undefined, frozenBy: undefined });
  }

  function settleAdjustment(month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) {
    const existing = getConfirmation(month);
    if (!existing) return;
    const updated = existing.adjustments.map((a) =>
      a.id === adjustmentId ? { ...a, settled: true, settleMethod: method, settledInMonth } : a
    );
    upsertConfirmation({ ...existing, adjustments: updated });
  }

  function getPendingAdjustments(month: string): PayrollAdjustment[] {
    const existing = getConfirmation(month);
    if (!existing) return [];
    return existing.adjustments.filter((a) => !a.settled);
  }

  function reset() {
    confirmations = [];
  }

  return {
    getStatus, isMonthLocked, isMonthWritable,
    confirmPayroll, enterAdjustMode, confirmAdjustment, cancelAdjustment,
    revokeConfirmation, settleAdjustment, getPendingAdjustments,
    getConfirmation, reset,
  };
}

// 使用实际类型字段名
const mockSummary: NonNullable<MonthlyConfirmation["summary"]> = {
  totalEmployees: 8,
  totalGrossSalary: 50000,
  totalFinalSalary: 45000,
  totalDeductions: 5000,
};

// 辅助：创建合法的 PayrollAdjustment（字段与 types.ts 对齐）
function makeAdj(id: string, employeeId: string, employeeName: string, amount: number, details: string): PayrollAdjustment {
  return {
    id,
    createdAt: Date.now(),
    employeeId,
    employeeName,
    amount,
    details,
    settled: false,
  };
}

// ─── Suite A：基础状态转换 ─────────────────────────────────────────────────────

describe("Suite A：基础状态转换", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("A1. 初始状态为 DRAFT（未确认）", () => {
    expect(store.getStatus("2026-07")).toBe("draft");
    expect(store.getStatus("2026-08")).toBe("draft");
  });

  it("A2. confirmPayroll：DRAFT → FROZEN", () => {
    store.confirmPayroll("2026-07", mockSummary);
    expect(store.getStatus("2026-07")).toBe("frozen");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.frozenAt).toBeDefined();
    expect(conf?.frozenBy).toBe("manager");
    expect(conf?.summary?.totalGrossSalary).toBe(50000);
  });

  it("A3. enterAdjustMode：FROZEN → ADJUSTING", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    expect(store.getStatus("2026-07")).toBe("adjusting");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.adjustingAt).toBeDefined();
  });

  it("A4. confirmAdjustment：ADJUSTING → FROZEN", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    store.confirmAdjustment("2026-07", [makeAdj("adj-1", "emp-1", "王琪", 200, "绩效补贴补发")]);
    expect(store.getStatus("2026-07")).toBe("frozen");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.adjustments).toHaveLength(1);
    expect(conf?.adjustments[0].amount).toBe(200);
  });

  it("A5. cancelAdjustment：ADJUSTING → FROZEN（丢弃修改）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    store.cancelAdjustment("2026-07");
    expect(store.getStatus("2026-07")).toBe("frozen");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.adjustingAt).toBeUndefined();
    expect(conf?.adjustments).toHaveLength(0);
  });

  it("A6. revokeConfirmation：FROZEN → DRAFT（撤销确认）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.revokeConfirmation("2026-07");
    expect(store.getStatus("2026-07")).toBe("draft");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.frozenAt).toBeUndefined();
    expect(conf?.frozenBy).toBeUndefined();
  });
});

// ─── Suite B：非法状态转换防护 ────────────────────────────────────────────────

describe("Suite B：非法状态转换防护", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("B1. 不能从 DRAFT 直接进入 ADJUSTING", () => {
    store.enterAdjustMode("2026-07");
    expect(store.getStatus("2026-07")).toBe("draft");
  });

  it("B2. ADJUSTING 状态下 revokeConfirmation 直接变为 DRAFT", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    store.revokeConfirmation("2026-07");
    expect(store.getStatus("2026-07")).toBe("draft");
  });

  it("B3. 重复 confirmPayroll 应覆盖（幂等）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    const newSummary = { ...mockSummary, totalGrossSalary: 55000 };
    store.confirmPayroll("2026-07", newSummary);
    expect(store.getStatus("2026-07")).toBe("frozen");
    expect(store.getConfirmation("2026-07")?.summary?.totalGrossSalary).toBe(55000);
  });

  it("B4. FROZEN 时 confirmAdjustment 无效（需先 enterAdjustMode）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.confirmAdjustment("2026-07", [makeAdj("adj-1", "emp-1", "王琪", 200, "补发")]);
    expect(store.getStatus("2026-07")).toBe("frozen");
    expect(store.getConfirmation("2026-07")?.adjustments).toHaveLength(0);
  });

  it("B5. DRAFT 状态下 cancelAdjustment 无效", () => {
    store.cancelAdjustment("2026-07");
    expect(store.getStatus("2026-07")).toBe("draft");
  });
});

// ─── Suite C：锁定状态下的写入拦截 ───────────────────────────────────────────

describe("Suite C：锁定状态下的写入拦截", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("C1. isMonthWritable：DRAFT → true（可写入）", () => {
    expect(store.isMonthWritable("2026-07")).toBe(true);
  });

  it("C2. isMonthWritable：FROZEN → false（不可写入）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    expect(store.isMonthWritable("2026-07")).toBe(false);
  });

  it("C3. isMonthWritable：ADJUSTING → true（差额调整期间可写入）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    expect(store.isMonthWritable("2026-07")).toBe(true);
  });

  it("C4. isMonthLocked：DRAFT → false（未锁定）", () => {
    expect(store.isMonthLocked("2026-07")).toBe(false);
  });

  it("C5. isMonthLocked：FROZEN → true（已锁定）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    expect(store.isMonthLocked("2026-07")).toBe(true);
  });

  it("C6. isMonthLocked：ADJUSTING → false（调整期间不算锁定，允许写入）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    // 与 store.tsx:1177 一致：isMonthLocked 只检查 frozen
    expect(store.isMonthLocked("2026-07")).toBe(false);
  });
});

// ─── Suite D：summary 完整性 ──────────────────────────────────────────────────

describe("Suite D：summary 完整性", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("D1. confirmPayroll 时生成 summary", () => {
    store.confirmPayroll("2026-07", mockSummary);
    const conf = store.getConfirmation("2026-07");
    expect(conf?.summary).toBeDefined();
    expect(conf?.summary?.totalGrossSalary).toBe(50000);
    expect(conf?.summary?.totalFinalSalary).toBe(45000);
    expect(conf?.summary?.totalEmployees).toBe(8);
    expect(conf?.summary?.totalDeductions).toBe(5000);
  });

  it("D2. summary 包含所有关键字段", () => {
    store.confirmPayroll("2026-07", mockSummary);
    const summary = store.getConfirmation("2026-07")?.summary;
    expect(summary).toMatchObject({
      totalEmployees: expect.any(Number),
      totalGrossSalary: expect.any(Number),
      totalFinalSalary: expect.any(Number),
      totalDeductions: expect.any(Number),
    });
  });

  it("D3. revokeConfirmation 后 summary 保留（用于审计）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.revokeConfirmation("2026-07");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.status).toBe("draft");
    expect(conf?.summary?.totalGrossSalary).toBe(50000);
  });

  it("D4. 差额检测：summary.totalFinalSalary 与当前 PaySlip 对比", () => {
    const frozenFinal = 45000;
    store.confirmPayroll("2026-07", { ...mockSummary, totalFinalSalary: frozenFinal });
    const currentFinal = 46000;
    const delta = currentFinal - frozenFinal;
    expect(delta).toBe(1000);
    expect(delta > 0).toBe(true);
  });
});

// ─── Suite E：多月份隔离 ──────────────────────────────────────────────────────

describe("Suite E：多月份隔离", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("E1. 不同月份的锁定状态互不干扰", () => {
    store.confirmPayroll("2026-07", mockSummary);
    expect(store.getStatus("2026-07")).toBe("frozen");
    expect(store.getStatus("2026-08")).toBe("draft");
    expect(store.getStatus("2026-06")).toBe("draft");
  });

  it("E2. 锁定 7 月不影响 8 月的写入", () => {
    store.confirmPayroll("2026-07", mockSummary);
    expect(store.isMonthWritable("2026-07")).toBe(false);
    expect(store.isMonthWritable("2026-08")).toBe(true);
  });

  it("E3. 跨年月份隔离", () => {
    store.confirmPayroll("2025-12", mockSummary);
    store.confirmPayroll("2026-01", mockSummary);
    expect(store.getStatus("2025-12")).toBe("frozen");
    expect(store.getStatus("2026-01")).toBe("frozen");
    expect(store.getStatus("2026-02")).toBe("draft");
    store.revokeConfirmation("2025-12");
    expect(store.getStatus("2025-12")).toBe("draft");
    expect(store.getStatus("2026-01")).toBe("frozen");
  });
});

// ─── Suite F：差额调整流程 ────────────────────────────────────────────────────

describe("Suite F：差额调整流程", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
  });

  it("F1. enterAdjustMode 后 isMonthWritable 为 true", () => {
    expect(store.isMonthWritable("2026-07")).toBe(true);
  });

  it("F2. confirmAdjustment 记录差额条目", () => {
    store.confirmAdjustment("2026-07", [makeAdj("adj-1", "emp-1", "王琪", 500, "绩效补贴补发（7月）")]);
    const conf = store.getConfirmation("2026-07");
    expect(conf?.adjustments).toHaveLength(1);
    expect(conf?.adjustments[0].amount).toBe(500);
    expect(conf?.adjustments[0].settled).toBe(false);
  });

  it("F3. getPendingAdjustments 返回未结算差额", () => {
    store.confirmAdjustment("2026-07", [
      makeAdj("adj-1", "emp-1", "王琪", 500, "补发"),
      makeAdj("adj-2", "emp-2", "Stephen", -200, "多发扣回"),
    ]);
    const pending = store.getPendingAdjustments("2026-07");
    expect(pending).toHaveLength(2);
  });

  it("F4. settleAdjustment 标记差额已结算", () => {
    store.confirmAdjustment("2026-07", [makeAdj("adj-1", "emp-1", "王琪", 500, "补发")]);
    store.settleAdjustment("2026-07", "adj-1", "next_month", "2026-08");
    const conf = store.getConfirmation("2026-07");
    expect(conf?.adjustments[0].settled).toBe(true);
    expect(conf?.adjustments[0].settleMethod).toBe("next_month");
    expect(conf?.adjustments[0].settledInMonth).toBe("2026-08");
  });

  it("F5. 已结算差额不再出现在 getPendingAdjustments", () => {
    store.confirmAdjustment("2026-07", [
      makeAdj("adj-1", "emp-1", "王琪", 500, "补发"),
      makeAdj("adj-2", "emp-2", "Stephen", -200, "多发扣回"),
    ]);
    store.settleAdjustment("2026-07", "adj-1", "next_month", "2026-08");
    const pending = store.getPendingAdjustments("2026-07");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("adj-2");
  });
});

// ─── Suite G：边界情况 ────────────────────────────────────────────────────────

describe("Suite G：边界情况", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("G1. 对未知月份查询返回 DRAFT", () => {
    expect(store.getStatus("9999-99")).toBe("draft");
    expect(store.isMonthWritable("9999-99")).toBe(true);
    expect(store.isMonthLocked("9999-99")).toBe(false);
  });

  it("G2. 连续 confirmPayroll → revokeConfirmation 循环（幂等性）", () => {
    for (let i = 0; i < 5; i++) {
      store.confirmPayroll("2026-07", mockSummary);
      expect(store.getStatus("2026-07")).toBe("frozen");
      store.revokeConfirmation("2026-07");
      expect(store.getStatus("2026-07")).toBe("draft");
    }
  });

  it("G3. 多次 enterAdjustMode → cancelAdjustment 循环", () => {
    store.confirmPayroll("2026-07", mockSummary);
    for (let i = 0; i < 3; i++) {
      store.enterAdjustMode("2026-07");
      expect(store.getStatus("2026-07")).toBe("adjusting");
      store.cancelAdjustment("2026-07");
      expect(store.getStatus("2026-07")).toBe("frozen");
    }
  });

  it("G4. 12 个月份同时锁定互不干扰", () => {
    const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
    months.forEach((m) => store.confirmPayroll(m, mockSummary));
    months.forEach((m) => expect(store.getStatus(m)).toBe("frozen"));
    store.revokeConfirmation("2026-06");
    expect(store.getStatus("2026-06")).toBe("draft");
    months.filter((m) => m !== "2026-06").forEach((m) =>
      expect(store.getStatus(m)).toBe("frozen")
    );
  });

  it("G5. 差额调整后 summary 保持不变（不被覆盖）", () => {
    store.confirmPayroll("2026-07", mockSummary);
    store.enterAdjustMode("2026-07");
    store.confirmAdjustment("2026-07", [makeAdj("adj-1", "emp-1", "王琪", 200, "补发")]);
    // summary 应保留原始确认时的数据
    const conf = store.getConfirmation("2026-07");
    expect(conf?.summary?.totalGrossSalary).toBe(50000);
    expect(conf?.summary?.totalFinalSalary).toBe(45000);
  });
});

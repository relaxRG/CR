/**
 * 绩效补贴分项字段展示一致性测试
 * 验证 workKPIBonus / revenueKPIBonus 在所有展示位置的正确性
 *
 * 防回归规则：
 * - 展示「工作绩效」必须使用 workKPIBonus ?? performanceBonus（不能直接用 performanceBonus）
 * - 展示「业绩绩效」必须使用 revenueKPIBonus（不能用 salesCommission）
 * - 展示合计时使用 performanceBonus（workKPI + revenueKPI 合计）
 * - handleSave 必须同时写入 workKPIBonus 和 revenueKPIBonus
 * - buildPaySlipDraft 必须从 existing 保留分项字段
 */

import { describe, it, expect } from "vitest";

// ─── 模拟 PaySlip 数据 ────────────────────────────────────────────────────────
function makeSlip(overrides: Partial<{
  performanceBonus: number;
  workKPIBonus: number | undefined;
  revenueKPIBonus: number | undefined;
  salesCommission: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  rewardPenalty: number;
}> = {}) {
  return {
    performanceBonus: 0,
    workKPIBonus: undefined as number | undefined,
    revenueKPIBonus: undefined as number | undefined,
    salesCommission: 0,
    mealAllowance: 0,
    transportAllowance: 0,
    otherAllowance: 0,
    rewardPenalty: 0,
    ...overrides,
  };
}

// ─── 模拟展示逻辑（与各页面实现保持一致） ────────────────────────────────────

/** 绩效补贴展示页 summaryCard 工作绩效列 */
function displayWorkKPI(slip: ReturnType<typeof makeSlip>): number {
  return slip.workKPIBonus ?? slip.performanceBonus ?? 0;
}

/** 绩效补贴展示页 summaryCard 业绩绩效列 */
function displayRevenueKPI(slip: ReturnType<typeof makeSlip>): number {
  return slip.revenueKPIBonus ?? 0;
}

/** 薪资统计卡片展开「综合额外」区 工作绩效列 */
function displayLaborCardWorkKPI(slip: ReturnType<typeof makeSlip>): number {
  return slip.workKPIBonus ?? slip.performanceBonus ?? 0;
}

/** 薪资统计卡片展开「综合额外」区 业绩提点列（salesCommission，语义正确） */
function displayLaborCardCommission(slip: ReturnType<typeof makeSlip>): number {
  return slip.salesCommission ?? 0;
}

/** 薪资总览展开「绩效补贴」区 工作绩效行 */
function displayAttendanceWorkKPI(slip: ReturnType<typeof makeSlip>): number {
  return slip.workKPIBonus ?? slip.performanceBonus ?? 0;
}

/** 薪资统计卡片收起5格「综合额外」合计 */
function displayExtraTotal(slip: ReturnType<typeof makeSlip>): number {
  const allowanceSum = (slip.mealAllowance ?? 0) + (slip.transportAllowance ?? 0) + (slip.otherAllowance ?? 0);
  return (slip.performanceBonus ?? 0) + allowanceSum + (slip.rewardPenalty ?? 0);
}

/** 模拟 handleSave 写入分项字段 */
function simulateHandleSave(workKPITotal: number, revenueKPITotal: number, existing: ReturnType<typeof makeSlip>) {
  const performanceTotal = workKPITotal + revenueKPITotal;
  return {
    ...existing,
    performanceBonus: performanceTotal,
    workKPIBonus: workKPITotal,
    revenueKPIBonus: revenueKPITotal,
  };
}

/** 模拟 buildPaySlipDraft 保留分项字段 */
function simulateBuildPaySlipDraft(performanceTotal: number, existing: ReturnType<typeof makeSlip> | null) {
  return {
    performanceBonus: performanceTotal,
    workKPIBonus: existing?.workKPIBonus,
    revenueKPIBonus: existing?.revenueKPIBonus,
    salesCommission: existing?.salesCommission ?? 0,
    mealAllowance: existing?.mealAllowance ?? 0,
    transportAllowance: existing?.transportAllowance ?? 0,
    otherAllowance: existing?.otherAllowance ?? 0,
    rewardPenalty: existing?.rewardPenalty ?? 0,
  };
}

// ─── Suite A：新数据（含分项字段）的展示正确性 ───────────────────────────────
describe("Suite A：新数据分项字段展示", () => {
  const slip = makeSlip({
    performanceBonus: 1700, // workKPI(1700) + revenueKPI(0)
    workKPIBonus: 1700,
    revenueKPIBonus: 0,
    salesCommission: 500,   // 业绩提点（营业额提成）
    mealAllowance: 345,
  });

  it("A1 展示页「工作绩效」= workKPIBonus（1700）", () => {
    expect(displayWorkKPI(slip)).toBe(1700);
  });

  it("A2 展示页「业绩绩效」= revenueKPIBonus（0）", () => {
    expect(displayRevenueKPI(slip)).toBe(0);
  });

  it("A3 薪资卡片「工作绩效」= workKPIBonus（1700）", () => {
    expect(displayLaborCardWorkKPI(slip)).toBe(1700);
  });

  it("A4 薪资卡片「业绩提点」= salesCommission（500，语义正确）", () => {
    expect(displayLaborCardCommission(slip)).toBe(500);
  });

  it("A5 薪资总览展开「工作绩效」= workKPIBonus（1700）", () => {
    expect(displayAttendanceWorkKPI(slip)).toBe(1700);
  });

  it("A6 收起5格「综合额外」合计 = performanceBonus + allowances（正确使用合计）", () => {
    expect(displayExtraTotal(slip)).toBe(1700 + 345); // performanceBonus + mealAllowance
  });
});

// ─── Suite B：workKPI + revenueKPI 都有值的场景 ──────────────────────────────
describe("Suite B：工作绩效 + 业绩绩效 混合场景", () => {
  const slip = makeSlip({
    performanceBonus: 2200, // 1700 + 500
    workKPIBonus: 1700,
    revenueKPIBonus: 500,
    salesCommission: 300,
  });

  it("B1 展示页「工作绩效」= 1700（不是混合的 2200）", () => {
    expect(displayWorkKPI(slip)).toBe(1700);
  });

  it("B2 展示页「业绩绩效」= 500（不是 salesCommission 的 300）", () => {
    expect(displayRevenueKPI(slip)).toBe(500);
  });

  it("B3 薪资卡片「工作绩效」= 1700（分项正确）", () => {
    expect(displayLaborCardWorkKPI(slip)).toBe(1700);
  });

  it("B4 薪资卡片「业绩提点」= 300（salesCommission，语义正确）", () => {
    expect(displayLaborCardCommission(slip)).toBe(300);
  });

  it("B5 合计 performanceBonus = workKPIBonus + revenueKPIBonus", () => {
    expect(slip.performanceBonus).toBe((slip.workKPIBonus ?? 0) + (slip.revenueKPIBonus ?? 0));
  });
});

// ─── Suite C：旧数据向后兼容（无分项字段） ───────────────────────────────────
describe("Suite C：旧数据向后兼容", () => {
  const legacySlip = makeSlip({
    performanceBonus: 1500,
    workKPIBonus: undefined,   // 旧数据无此字段
    revenueKPIBonus: undefined, // 旧数据无此字段
    salesCommission: 200,
  });

  it("C1 旧数据展示「工作绩效」回落到 performanceBonus（1500）", () => {
    expect(displayWorkKPI(legacySlip)).toBe(1500);
  });

  it("C2 旧数据展示「业绩绩效」= 0（revenueKPIBonus 未定义）", () => {
    expect(displayRevenueKPI(legacySlip)).toBe(0);
  });

  it("C3 旧数据薪资卡片「工作绩效」回落到 performanceBonus（1500）", () => {
    expect(displayLaborCardWorkKPI(legacySlip)).toBe(1500);
  });

  it("C4 旧数据合计不受影响（performanceBonus 仍为 1500）", () => {
    expect(displayExtraTotal(legacySlip)).toBe(1500);
  });
});

// ─── Suite D：handleSave 写入分项字段 ────────────────────────────────────────
describe("Suite D：handleSave 写入分项字段", () => {
  const existing = makeSlip({ performanceBonus: 0, salesCommission: 300 });

  it("D1 保存后 performanceBonus = workKPI + revenueKPI", () => {
    const saved = simulateHandleSave(1700, 500, existing);
    expect(saved.performanceBonus).toBe(2200);
  });

  it("D2 保存后 workKPIBonus 正确写入", () => {
    const saved = simulateHandleSave(1700, 500, existing);
    expect(saved.workKPIBonus).toBe(1700);
  });

  it("D3 保存后 revenueKPIBonus 正确写入", () => {
    const saved = simulateHandleSave(1700, 500, existing);
    expect(saved.revenueKPIBonus).toBe(500);
  });

  it("D4 保存后展示页工作绩效 = 1700（不是混合的 2200）", () => {
    const saved = simulateHandleSave(1700, 500, existing);
    expect(displayWorkKPI(saved)).toBe(1700);
  });

  it("D5 保存后展示页业绩绩效 = 500", () => {
    const saved = simulateHandleSave(1700, 500, existing);
    expect(displayRevenueKPI(saved)).toBe(500);
  });

  it("D6 清空工作绩效（workKPITotal=0）后分项字段为 0", () => {
    const saved = simulateHandleSave(0, 0, existing);
    expect(saved.workKPIBonus).toBe(0);
    expect(saved.revenueKPIBonus).toBe(0);
    expect(saved.performanceBonus).toBe(0);
  });
});

// ─── Suite E：buildPaySlipDraft 保留分项字段（autoSync 不清除） ───────────────
describe("Suite E：buildPaySlipDraft 保留分项字段", () => {
  it("E1 autoSync 后 workKPIBonus 不丢失", () => {
    const existing = makeSlip({ performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });
    const draft = simulateBuildPaySlipDraft(2200, existing);
    expect(draft.workKPIBonus).toBe(1700);
  });

  it("E2 autoSync 后 revenueKPIBonus 不丢失", () => {
    const existing = makeSlip({ performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });
    const draft = simulateBuildPaySlipDraft(2200, existing);
    expect(draft.revenueKPIBonus).toBe(500);
  });

  it("E3 existing=null 时分项字段为 undefined（安全回退）", () => {
    const draft = simulateBuildPaySlipDraft(0, null);
    expect(draft.workKPIBonus).toBeUndefined();
    expect(draft.revenueKPIBonus).toBeUndefined();
  });

  it("E4 autoSync 重算 performanceBonus 不影响分项字段", () => {
    const existing = makeSlip({ performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });
    // autoSync 用相同的 performanceTotal 重算
    const draft = simulateBuildPaySlipDraft(2200, existing);
    expect(draft.performanceBonus).toBe(2200);
    expect(draft.workKPIBonus).toBe(1700);  // 分项不变
    expect(draft.revenueKPIBonus).toBe(500); // 分项不变
  });

  it("E5 多次 autoSync 后分项字段稳定", () => {
    let slip = makeSlip({ performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });
    for (let i = 0; i < 5; i++) {
      slip = simulateBuildPaySlipDraft(2200, slip) as ReturnType<typeof makeSlip>;
    }
    expect(slip.workKPIBonus).toBe(1700);
    expect(slip.revenueKPIBonus).toBe(500);
  });
});

// ─── Suite F：防回归 - 旧 Bug 复现验证 ───────────────────────────────────────
describe("Suite F：防回归 - 旧 Bug 复现", () => {
  it("F1 旧 Bug：展示页「工作绩效」直接用 performanceBonus 会显示混合值", () => {
    const slip = makeSlip({ performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });
    // 旧实现（错误）
    const oldImpl = slip.performanceBonus ?? 0;
    // 新实现（正确）
    const newImpl = slip.workKPIBonus ?? slip.performanceBonus ?? 0;
    // 旧实现显示 2200（混合），新实现显示 1700（正确）
    expect(oldImpl).toBe(2200);
    expect(newImpl).toBe(1700);
    expect(newImpl).not.toBe(oldImpl); // 两者不同，说明修复有意义
  });

  it("F2 旧 Bug：展示页「业绩绩效」用 salesCommission 显示营业额提成", () => {
    const slip = makeSlip({ revenueKPIBonus: 500, salesCommission: 300 });
    // 旧实现（错误）
    const oldImpl = slip.salesCommission ?? 0;
    // 新实现（正确）
    const newImpl = slip.revenueKPIBonus ?? 0;
    expect(oldImpl).toBe(300);  // 营业额提成
    expect(newImpl).toBe(500);  // 业绩绩效（正确）
    expect(newImpl).not.toBe(oldImpl);
  });

  it("F3 编辑页和展示页 summaryCard 数字一致（保存后无跳变）", () => {
    const workKPITotal = 1700;
    const revenueKPITotal = 500;
    // 编辑页 summaryCard 显示
    const editPageWorkKPI = workKPITotal;
    const editPageRevenueKPI = revenueKPITotal;
    // 保存后的 slip
    const saved = simulateHandleSave(workKPITotal, revenueKPITotal, makeSlip());
    // 展示页 summaryCard 显示
    const displayPageWorkKPI = displayWorkKPI(saved);
    const displayPageRevenueKPI = displayRevenueKPI(saved);
    // 两者应一致
    expect(displayPageWorkKPI).toBe(editPageWorkKPI);
    expect(displayPageRevenueKPI).toBe(editPageRevenueKPI);
  });
});

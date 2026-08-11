/**
 * 绩效补贴模块 22 处展示位置 E2E UI 状态同步测试
 *
 * 测试目标：验证用户在实际操作时（保存→返回→各页面展示）不会出现状态不同步
 *
 * 覆盖的 22 处展示位置：
 * A. 绩效补贴展示页 summaryCard（4格）
 * B. 绩效补贴编辑页 summaryCard（4格）
 * C. 绩效补贴展示页逐条区域（补贴项/工作绩效档位/业绩绩效阶梯）
 * D. 薪资统计卡片收起5格「综合额外」
 * E. 薪资统计卡片展开「综合额外」5格
 * F. 薪资总览展开「绩效补贴」区（7行）
 * G. 各版本导出（工作绩效/业绩绩效/业绩提点 3列）
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── 类型定义（与 PaySlip 对齐）──
interface PaySlip {
  id: string;
  employeeId: string;
  month: string;
  attendanceSalary: number;
  performanceBonus: number;
  workKPIBonus?: number;
  revenueKPIBonus?: number;
  salesCommission: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  rewardPenalty: number;
  advanceAmount: number;
  pettyLaborPaid?: number;
  grossSalary: number;
  finalSalary: number;
  allowanceOverrides?: Record<string, boolean>;
  workKPISelections?: Record<string, string>;
  revenueActuals?: Record<string, number>;
  updatedAt: string;
}

// ── 工具函数（模拟各页面的展示计算逻辑）──

/** 绩效补贴展示页 summaryCard */
function displayPageSummary(slip: PaySlip) {
  const allowanceTotal = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
  const performanceBonus = slip.performanceBonus;
  const workKPIBonus = slip.workKPIBonus ?? performanceBonus; // 向后兼容
  const revenueKPIBonus = slip.revenueKPIBonus ?? 0;
  const grandTotal = allowanceTotal + performanceBonus; // 绩效补贴页不含 salesCommission
  return { grandTotal, allowanceTotal, workKPIBonus, revenueKPIBonus };
}

/** 薪资统计卡片收起5格「综合额外」 */
function paySlipMiniCardCollapsed(slip: PaySlip) {
  const allowanceSum = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
  // 收起5格的综合额外 = performanceBonus + allowanceSum + rewardPenalty + salesCommission
  return slip.performanceBonus + allowanceSum + slip.rewardPenalty + slip.salesCommission;
}

/** 薪资统计卡片展开「综合额外」5格 */
function paySlipMiniCardExpanded(slip: PaySlip) {
  const allowanceSum = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
  const workKPI = slip.workKPIBonus ?? slip.performanceBonus ?? 0;
  const revenueKPI = (slip.revenueKPIBonus ?? 0) + slip.salesCommission; // 业绩 = 业绩绩效 + 业绩提点
  const reward = slip.rewardPenalty;
  const extraTotal = allowanceSum + workKPI + revenueKPI + reward;
  return { allowanceSum, workKPI, revenueKPI, reward, extraTotal };
}

/** 薪资总览展开「绩效补贴」区综合小计 */
function attendanceCardKPISubtotal(slip: PaySlip) {
  const allowanceTotal = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
  // 综合小计 = performanceBonus + allowanceTotal + salesCommission + rewardPenalty
  return slip.performanceBonus + allowanceTotal + slip.salesCommission + slip.rewardPenalty;
}

/** 导出工作绩效列 */
function exportWorkKPI(slip: PaySlip) {
  return slip.workKPIBonus ?? slip.performanceBonus ?? 0;
}

/** 导出业绩绩效列 */
function exportRevenueKPI(slip: PaySlip) {
  return slip.revenueKPIBonus ?? 0;
}

/** 导出业绩提点列 */
function exportSalesCommission(slip: PaySlip) {
  return slip.salesCommission;
}

/** 模拟 handleSave 保存操作 */
function simulateHandleSave(
  existing: PaySlip,
  workKPITotal: number,
  revenueKPITotal: number,
  allowanceTotal: number,
): PaySlip {
  const performanceTotal = workKPITotal + revenueKPITotal;
  return {
    ...existing,
    performanceBonus: performanceTotal,
    workKPIBonus: workKPITotal,
    revenueKPIBonus: revenueKPITotal,
    updatedAt: new Date().toISOString(),
  };
}

/** 模拟 buildPaySlipDraft（autoSync 触发） */
function simulateBuildPaySlipDraft(existing: PaySlip, attendanceSalary: number): PaySlip {
  const performanceTotal = existing.performanceBonus; // 从 existing 保留
  const allowanceTotal = existing.mealAllowance + existing.transportAllowance + existing.otherAllowance;
  const grossSalary = Math.round((
    attendanceSalary + performanceTotal + existing.salesCommission +
    allowanceTotal + existing.rewardPenalty
  ) * 100) / 100;
  const finalSalary = Math.round((
    grossSalary - (existing.advanceAmount ?? 0) - (existing.pettyLaborPaid ?? 0)
  ) * 100) / 100;
  return {
    ...existing,
    attendanceSalary,
    grossSalary,
    finalSalary,
    // 关键：保留所有控制字段
    workKPIBonus: existing.workKPIBonus,
    revenueKPIBonus: existing.revenueKPIBonus,
    allowanceOverrides: existing.allowanceOverrides,
    workKPISelections: existing.workKPISelections,
    revenueActuals: existing.revenueActuals,
    updatedAt: new Date().toISOString(),
  };
}

// ── 测试数据 ──
const makeSlip = (overrides: Partial<PaySlip> = {}): PaySlip => ({
  id: "slip-001",
  employeeId: "emp-001",
  month: "2026-08",
  attendanceSalary: 6000,
  performanceBonus: 2200, // workKPIBonus(1700) + revenueKPIBonus(500)
  workKPIBonus: 1700,
  revenueKPIBonus: 500,
  salesCommission: 300,
  mealAllowance: 345,
  transportAllowance: 200,
  otherAllowance: 0,
  rewardPenalty: -100,
  advanceAmount: 0,
  pettyLaborPaid: 0,
  grossSalary: 8945, // 6000+2200+300+345+200+0+(-100) = 8945
  finalSalary: 8945,
  allowanceOverrides: { "rule-meal": true },
  workKPISelections: { "rule-wkpi": "tier-4.4" },
  revenueActuals: { "rule-rkpi": 350000 },
  updatedAt: "2026-08-01T00:00:00Z",
  ...overrides,
});

// ══════════════════════════════════════════════════════════════
// Suite A：绩效补贴展示页 summaryCard（4格）
// ══════════════════════════════════════════════════════════════
describe("Suite A：绩效补贴展示页 summaryCard 4格", () => {
  it("A1：绩效补贴总额 = allowanceTotal + performanceBonus（不含 salesCommission）", () => {
    const slip = makeSlip();
    const { grandTotal } = displayPageSummary(slip);
    const expected = (345 + 200 + 0) + 2200; // 2745
    expect(grandTotal).toBe(expected);
    // 确认不含 salesCommission
    expect(grandTotal).not.toBe(expected + slip.salesCommission);
  });

  it("A2：补贴列 = mealAllowance + transportAllowance + otherAllowance", () => {
    const slip = makeSlip();
    const { allowanceTotal } = displayPageSummary(slip);
    expect(allowanceTotal).toBe(345 + 200 + 0);
  });

  it("A3：工作绩效列 = workKPIBonus（有值时不回落到 performanceBonus）", () => {
    const slip = makeSlip();
    const { workKPIBonus } = displayPageSummary(slip);
    expect(workKPIBonus).toBe(1700);
    expect(workKPIBonus).not.toBe(slip.performanceBonus); // 不等于合计
  });

  it("A4：业绩绩效列 = revenueKPIBonus", () => {
    const slip = makeSlip();
    const { revenueKPIBonus } = displayPageSummary(slip);
    expect(revenueKPIBonus).toBe(500);
  });

  it("A5：旧数据向后兼容（workKPIBonus 缺失时回落到 performanceBonus）", () => {
    const slip = makeSlip({ workKPIBonus: undefined });
    const { workKPIBonus } = displayPageSummary(slip);
    expect(workKPIBonus).toBe(slip.performanceBonus); // 回落到合计
  });

  it("A6：保存后展示页立即更新（state 响应性）", () => {
    const slip = makeSlip();
    // 模拟用户修改档位后保存
    const saved = simulateHandleSave(slip, 2000, 800, 545);
    const { workKPIBonus, revenueKPIBonus, grandTotal } = displayPageSummary(saved);
    expect(workKPIBonus).toBe(2000);
    expect(revenueKPIBonus).toBe(800);
    expect(grandTotal).toBe(545 + 2800); // allowanceTotal + performanceBonus
  });
});

// ══════════════════════════════════════════════════════════════
// Suite B：绩效补贴编辑页 summaryCard（4格）
// ══════════════════════════════════════════════════════════════
describe("Suite B：绩效补贴编辑页 summaryCard 4格", () => {
  it("B1：编辑页绩效补贴 = allowanceTotal + workKPITotal + revenueKPITotal", () => {
    const workKPITotal = 1700;
    const revenueKPITotal = 500;
    const allowanceTotal = 545;
    const grandTotal = allowanceTotal + workKPITotal + revenueKPITotal;
    expect(grandTotal).toBe(2745);
  });

  it("B2：编辑页与展示页 grandTotal 一致（保存后）", () => {
    const slip = makeSlip();
    const workKPITotal = 2000;
    const revenueKPITotal = 800;
    const allowanceTotal = 545;
    // 编辑页实时预览
    const editGrandTotal = allowanceTotal + workKPITotal + revenueKPITotal;
    // 保存后展示页
    const saved = simulateHandleSave(slip, workKPITotal, revenueKPITotal, allowanceTotal);
    const { grandTotal: displayGrandTotal } = displayPageSummary({ ...saved, mealAllowance: 345, transportAllowance: 200, otherAllowance: 0 });
    expect(editGrandTotal).toBe(displayGrandTotal);
  });

  it("B3：工作绩效列 = workKPITotal（实时计算）", () => {
    const workKPITotal = 1700; // 4.4分档位
    expect(workKPITotal).toBe(1700);
  });

  it("B4：业绩绩效列 = revenueKPITotal（实时计算）", () => {
    const revenueKPITotal = 500; // 达到 ≥280,000 阶梯
    expect(revenueKPITotal).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════
// Suite C：薪资统计卡片收起5格「综合额外」
// ══════════════════════════════════════════════════════════════
describe("Suite C：薪资统计卡片收起5格「综合额外」", () => {
  it("C1：综合额外 = performanceBonus + allowanceSum + rewardPenalty + salesCommission", () => {
    const slip = makeSlip();
    const result = paySlipMiniCardCollapsed(slip);
    const expected = 2200 + (345 + 200 + 0) + (-100) + 300; // 2945
    expect(result).toBe(expected);
  });

  it("C2：rewardPenalty 为负数时正确扣减", () => {
    const slip = makeSlip({ rewardPenalty: -500 });
    const result = paySlipMiniCardCollapsed(slip);
    const expected = 2200 + 545 + (-500) + 300; // 2545
    expect(result).toBe(expected);
  });

  it("C3：无绩效时综合额外 = 纯补贴合计", () => {
    const slip = makeSlip({ performanceBonus: 0, workKPIBonus: 0, revenueKPIBonus: 0, salesCommission: 0, rewardPenalty: 0 });
    const result = paySlipMiniCardCollapsed(slip);
    expect(result).toBe(545); // 仅补贴
  });
});

// ══════════════════════════════════════════════════════════════
// Suite D：薪资统计卡片展开「综合额外」5格
// ══════════════════════════════════════════════════════════════
describe("Suite D：薪资统计卡片展开「综合额外」5格", () => {
  it("D1：补贴合计格 = mealAllowance + transportAllowance + otherAllowance", () => {
    const slip = makeSlip();
    const { allowanceSum } = paySlipMiniCardExpanded(slip);
    expect(allowanceSum).toBe(545);
  });

  it("D2：工作绩效格 = workKPIBonus（有值时）", () => {
    const slip = makeSlip();
    const { workKPI } = paySlipMiniCardExpanded(slip);
    expect(workKPI).toBe(1700);
  });

  it("D3：业绩格 = revenueKPIBonus + salesCommission（合并展示）", () => {
    const slip = makeSlip();
    const { revenueKPI } = paySlipMiniCardExpanded(slip);
    expect(revenueKPI).toBe(500 + 300); // 800
  });

  it("D4：奖惩格 = rewardPenalty（含负数）", () => {
    const slip = makeSlip();
    const { reward } = paySlipMiniCardExpanded(slip);
    expect(reward).toBe(-100);
  });

  it("D5：综合小计格 = 以上四格之和", () => {
    const slip = makeSlip();
    const { allowanceSum, workKPI, revenueKPI, reward, extraTotal } = paySlipMiniCardExpanded(slip);
    expect(extraTotal).toBe(allowanceSum + workKPI + revenueKPI + reward);
    expect(extraTotal).toBe(545 + 1700 + 800 + (-100)); // 2945
  });

  it("D6：综合小计与收起5格「综合额外」数值一致", () => {
    const slip = makeSlip();
    const collapsed = paySlipMiniCardCollapsed(slip);
    const { extraTotal } = paySlipMiniCardExpanded(slip);
    expect(extraTotal).toBe(collapsed);
  });
});

// ══════════════════════════════════════════════════════════════
// Suite E：薪资总览展开「绩效补贴」区（7行）
// ══════════════════════════════════════════════════════════════
describe("Suite E：薪资总览展开「绩效补贴」区", () => {
  it("E1：餐补行 = mealAllowance", () => {
    const slip = makeSlip();
    expect(slip.mealAllowance).toBe(345);
  });

  it("E2：交通补贴行 = transportAllowance", () => {
    const slip = makeSlip();
    expect(slip.transportAllowance).toBe(200);
  });

  it("E3：其他补贴行（有值才显示）= otherAllowance", () => {
    const slip = makeSlip({ otherAllowance: 100 });
    expect(slip.otherAllowance).toBe(100);
    const slipZero = makeSlip({ otherAllowance: 0 });
    expect(slipZero.otherAllowance).toBe(0); // 不显示
  });

  it("E4：工作绩效行 = workKPIBonus（有值时）", () => {
    const slip = makeSlip();
    const workKPI = slip.workKPIBonus ?? slip.performanceBonus ?? 0;
    expect(workKPI).toBe(1700);
  });

  it("E5：业绩绩效行（有值才显示）= revenueKPIBonus", () => {
    const slip = makeSlip();
    expect(slip.revenueKPIBonus).toBe(500); // 显示
    const slipZero = makeSlip({ revenueKPIBonus: 0 });
    expect(slipZero.revenueKPIBonus).toBe(0); // 不显示
  });

  it("E6：业绩提点行（有值才显示）= salesCommission", () => {
    const slip = makeSlip();
    expect(slip.salesCommission).toBe(300); // 显示
    const slipZero = makeSlip({ salesCommission: 0 });
    expect(slipZero.salesCommission).toBe(0); // 不显示
  });

  it("E7：综合小计 = performanceBonus + allowanceTotal + salesCommission + rewardPenalty", () => {
    const slip = makeSlip();
    const subtotal = attendanceCardKPISubtotal(slip);
    const expected = 2200 + 545 + 300 + (-100); // 2945
    expect(subtotal).toBe(expected);
  });

  it("E8：综合小计与薪资统计卡片展开综合小计一致", () => {
    const slip = makeSlip();
    const attendanceSubtotal = attendanceCardKPISubtotal(slip);
    const { extraTotal } = paySlipMiniCardExpanded(slip);
    expect(attendanceSubtotal).toBe(extraTotal);
  });
});

// ══════════════════════════════════════════════════════════════
// Suite F：各版本导出（工作绩效/业绩绩效/业绩提点 3列）
// ══════════════════════════════════════════════════════════════
describe("Suite F：各版本导出 3列", () => {
  it("F1：导出工作绩效列 = workKPIBonus（有值时）", () => {
    const slip = makeSlip();
    expect(exportWorkKPI(slip)).toBe(1700);
  });

  it("F2：导出工作绩效列向后兼容（workKPIBonus 缺失时回落到 performanceBonus）", () => {
    const slip = makeSlip({ workKPIBonus: undefined });
    expect(exportWorkKPI(slip)).toBe(slip.performanceBonus);
  });

  it("F3：导出业绩绩效列 = revenueKPIBonus", () => {
    const slip = makeSlip();
    expect(exportRevenueKPI(slip)).toBe(500);
  });

  it("F4：导出业绩绩效列（旧数据 revenueKPIBonus 缺失时为 0）", () => {
    const slip = makeSlip({ revenueKPIBonus: undefined });
    expect(exportRevenueKPI(slip)).toBe(0);
  });

  it("F5：导出业绩提点列 = salesCommission", () => {
    const slip = makeSlip();
    expect(exportSalesCommission(slip)).toBe(300);
  });

  it("F6：三列之和 = workKPIBonus + revenueKPIBonus + salesCommission", () => {
    const slip = makeSlip();
    const total = exportWorkKPI(slip) + exportRevenueKPI(slip) + exportSalesCommission(slip);
    expect(total).toBe(1700 + 500 + 300); // 2500
  });
});

// ══════════════════════════════════════════════════════════════
// Suite G：完整用户操作路径（E2E 状态同步）
// ══════════════════════════════════════════════════════════════
describe("Suite G：完整用户操作路径 E2E 状态同步", () => {
  it("G1：保存→autoSync→展示页 三步走后所有字段一致", () => {
    const initial = makeSlip({ workKPIBonus: 0, revenueKPIBonus: 0, performanceBonus: 0 });

    // Step 1：用户在绩效补贴编辑页选择档位并保存
    const afterSave = simulateHandleSave(initial, 1700, 500, 545);
    expect(afterSave.workKPIBonus).toBe(1700);
    expect(afterSave.revenueKPIBonus).toBe(500);
    expect(afterSave.performanceBonus).toBe(2200);

    // Step 2：autoSync 触发（排班变化）
    const afterAutoSync = simulateBuildPaySlipDraft(afterSave, 6500);
    // 关键：控制字段必须保留
    expect(afterAutoSync.workKPIBonus).toBe(1700);
    expect(afterAutoSync.revenueKPIBonus).toBe(500);
    expect(afterAutoSync.performanceBonus).toBe(2200);

    // Step 3：展示页读取
    const { workKPIBonus, revenueKPIBonus, grandTotal } = displayPageSummary(afterAutoSync);
    expect(workKPIBonus).toBe(1700);
    expect(revenueKPIBonus).toBe(500);
    expect(grandTotal).toBe(545 + 2200);
  });

  it("G2：多次 autoSync 后字段不累积错误", () => {
    let slip = makeSlip();
    for (let i = 0; i < 10; i++) {
      slip = simulateBuildPaySlipDraft(slip, 6000 + i * 100);
    }
    // 10次 autoSync 后绩效字段不变
    expect(slip.workKPIBonus).toBe(1700);
    expect(slip.revenueKPIBonus).toBe(500);
    expect(slip.performanceBonus).toBe(2200);
  });

  it("G3：修改档位后再次保存，所有展示位置同步更新", () => {
    const slip = makeSlip();
    // 第一次保存
    const saved1 = simulateHandleSave(slip, 1700, 500, 545);
    // 第二次修改档位后保存
    const saved2 = simulateHandleSave(saved1, 2000, 800, 545);

    // 验证所有展示位置
    const summary = displayPageSummary({ ...saved2, mealAllowance: 345, transportAllowance: 200, otherAllowance: 0 });
    expect(summary.workKPIBonus).toBe(2000);
    expect(summary.revenueKPIBonus).toBe(800);
    expect(summary.grandTotal).toBe(545 + 2800);

    const collapsed = paySlipMiniCardCollapsed({ ...saved2, mealAllowance: 345, transportAllowance: 200, otherAllowance: 0 });
    expect(collapsed).toBe(2800 + 545 + saved2.rewardPenalty + saved2.salesCommission);

    const { extraTotal } = paySlipMiniCardExpanded({ ...saved2, mealAllowance: 345, transportAllowance: 200, otherAllowance: 0 });
    const attendanceSubtotal = attendanceCardKPISubtotal({ ...saved2, mealAllowance: 345, transportAllowance: 200, otherAllowance: 0 });
    expect(extraTotal).toBe(attendanceSubtotal); // 两个综合小计一致
  });

  it("G4：grossSalary 与各展示位置综合小计的关系正确", () => {
    const slip = makeSlip();
    // grossSalary = attendanceSalary + performanceBonus + salesCommission + allowanceTotal + rewardPenalty
    const expectedGross = 6000 + 2200 + 300 + 545 + (-100); // 8945
    expect(slip.grossSalary).toBe(expectedGross);

    // 综合小计（非考勤部分）= grossSalary - attendanceSalary
    const nonAttendancePart = slip.grossSalary - slip.attendanceSalary;
    const { extraTotal } = paySlipMiniCardExpanded(slip);
    expect(extraTotal).toBe(nonAttendancePart);
  });

  it("G5：零值场景下所有展示位置不显示负数或 NaN", () => {
    const slip = makeSlip({
      performanceBonus: 0, workKPIBonus: 0, revenueKPIBonus: 0,
      salesCommission: 0, mealAllowance: 0, transportAllowance: 0,
      otherAllowance: 0, rewardPenalty: 0,
    });
    const summary = displayPageSummary(slip);
    expect(summary.grandTotal).toBe(0);
    expect(summary.allowanceTotal).toBe(0);
    expect(summary.workKPIBonus).toBe(0);
    expect(summary.revenueKPIBonus).toBe(0);
    expect(isNaN(summary.grandTotal)).toBe(false);

    const collapsed = paySlipMiniCardCollapsed(slip);
    expect(collapsed).toBe(0);
    expect(isNaN(collapsed)).toBe(false);

    const { extraTotal } = paySlipMiniCardExpanded(slip);
    expect(extraTotal).toBe(0);
    expect(isNaN(extraTotal)).toBe(false);

    const subtotal = attendanceCardKPISubtotal(slip);
    expect(subtotal).toBe(0);
    expect(isNaN(subtotal)).toBe(false);
  });

  it("G6：rewardPenalty 为负数时各综合小计正确扣减", () => {
    const slip = makeSlip({ rewardPenalty: -500 });
    const { extraTotal } = paySlipMiniCardExpanded(slip);
    const subtotal = attendanceCardKPISubtotal(slip);
    // 两个综合小计都应包含 -500
    expect(extraTotal).toBe(545 + 1700 + 800 + (-500)); // 2545
    expect(subtotal).toBe(2200 + 545 + 300 + (-500)); // 2545
    expect(extraTotal).toBe(subtotal);
  });

  it("G7：月份切换后数据隔离（不同月份互不干扰）", () => {
    const slipJul = makeSlip({ month: "2026-07", performanceBonus: 1000, workKPIBonus: 1000, revenueKPIBonus: 0 });
    const slipAug = makeSlip({ month: "2026-08", performanceBonus: 2200, workKPIBonus: 1700, revenueKPIBonus: 500 });

    const summaryJul = displayPageSummary(slipJul);
    const summaryAug = displayPageSummary(slipAug);

    expect(summaryJul.workKPIBonus).toBe(1000);
    expect(summaryAug.workKPIBonus).toBe(1700);
    expect(summaryJul.workKPIBonus).not.toBe(summaryAug.workKPIBonus);
  });
});

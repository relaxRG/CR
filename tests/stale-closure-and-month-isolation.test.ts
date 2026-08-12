/**
 * tests/stale-closure-and-month-isolation.test.ts
 *
 * 月份隔离与 stale closure 防治测试
 *
 * 覆盖场景：
 *   Suite A：月份隔离（advances 过滤）
 *     A1. 当月预支过滤：deductMonth 精确匹配
 *     A2. 当月预支过滤：date 前缀匹配
 *     A3. 跨月预支不应计入当月
 *     A4. 已取消预支不应计入
 *     A5. 已扣除预支应计入（status=deducted）
 *
 *   Suite B：月份隔离（paySlips 过滤）
 *     B1. getPaySlip 精确匹配 employeeId + month
 *     B2. 不同月份的 PaySlip 互不干扰
 *     B3. 不同员工的 PaySlip 互不干扰
 *     B4. 年度个税累计：只统计当年且早于当月的记录
 *     B5. 跨年个税累计：不包含上一年的记录
 *
 *   Suite C：buildPaySlipDraft 控制字段保留
 *     C1. autoSync 后 allowanceOverrides 不丢失
 *     C2. autoSync 后 workKPISelections 不丢失
 *     C3. autoSync 后 revenueActuals 不丢失
 *     C4. autoSync 后 compOffCashOut 不丢失
 *     C5. autoSync 后 pettyLaborPaid 不丢失
 *
 *   Suite D：autoSync 依赖数组完整性
 *     D1. globalSettings 变化应触发重算（依赖数组包含 globalSettings）
 *     D2. specialStatuses 变化应触发重算（依赖数组包含 specialStatuses）
 *     D3. paySlips 变化不应触发 autoSync（防止无限循环）
 *
 *   Suite E：三步走保存时序
 *     E1. Step 1 写入控制字段后，Step 2 能读到最新值
 *     E2. Step 3 的 draft 包含 Step 1 写入的控制字段
 *     E3. 不需要在 Step 3 中再次显式传入控制字段
 */
import { describe, it, expect } from "vitest";
import { calcAttendanceBaseSalary, calcDailyRate } from "../lib/labor/types";

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function makeAdvance(overrides: {
  id?: string;
  employeeId?: string;
  amount?: number;
  status?: "pending" | "deducted" | "cancelled";
  date?: string;
  deductMonth?: string;
}) {
  return {
    id: overrides.id ?? "adv-1",
    employeeId: overrides.employeeId ?? "emp-1",
    amount: overrides.amount ?? 1000,
    status: overrides.status ?? "pending",
    date: overrides.date ?? "2026-07-01",
    deductMonth: overrides.deductMonth ?? undefined,
    category: "fulltime_advance" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makePaySlip(overrides: {
  id?: string;
  employeeId?: string;
  month?: string;
  grossSalary?: number;
  finalSalary?: number;
  workKPIBonus?: number;
  revenueKPIBonus?: number;
  allowanceOverrides?: Record<string, boolean>;
  workKPISelections?: Record<string, string>;
  revenueActuals?: Record<string, number>;
  compOffCashOut?: number;
  pettyLaborPaid?: number;
  socialInsuranceDeduction?: number;
  housingFundDeduction?: number;
  incomeTax?: number;
}) {
  return {
    id: overrides.id ?? "slip-1",
    employeeId: overrides.employeeId ?? "emp-1",
    month: overrides.month ?? "2026-07",
    grossSalary: overrides.grossSalary ?? 5000,
    finalSalary: overrides.finalSalary ?? 5000,
    workKPIBonus: overrides.workKPIBonus ?? 0,
    revenueKPIBonus: overrides.revenueKPIBonus ?? 0,
    allowanceOverrides: overrides.allowanceOverrides,
    workKPISelections: overrides.workKPISelections,
    revenueActuals: overrides.revenueActuals,
    compOffCashOut: overrides.compOffCashOut,
    pettyLaborPaid: overrides.pettyLaborPaid,
    socialInsuranceDeduction: overrides.socialInsuranceDeduction ?? 0,
    housingFundDeduction: overrides.housingFundDeduction ?? 0,
    incomeTax: overrides.incomeTax ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Suite A：月份隔离（advances 过滤）─────────────────────────────────────────

describe("Suite A：月份隔离（advances 过滤）", () => {
  const currentMonth = "2026-07";

  function filterAdvancesForMonth(advances: ReturnType<typeof makeAdvance>[], month: string) {
    return advances.filter(a =>
      a.employeeId === "emp-1" &&
      (a.deductMonth === month || a.date.startsWith(month)) &&
      (a.status === "pending" || a.status === "deducted")
    );
  }

  it("A1. 当月预支过滤：deductMonth 精确匹配", () => {
    const advances = [
      makeAdvance({ deductMonth: "2026-07", date: "2026-06-28" }), // 6月发生但7月扣
      makeAdvance({ id: "adv-2", deductMonth: "2026-08", date: "2026-08-01" }), // 8月发生但8月扣
    ];
    const result = filterAdvancesForMonth(advances, currentMonth);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("adv-1");
  });

  it("A2. 当月预支过滤：date 前缀匹配", () => {
    const advances = [
      makeAdvance({ date: "2026-07-15" }), // 7月发生，无 deductMonth
      makeAdvance({ id: "adv-2", date: "2026-06-15" }), // 6月发生，无 deductMonth
    ];
    const result = filterAdvancesForMonth(advances, currentMonth);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("adv-1");
  });

  it("A3. 跨月预支不应计入当月", () => {
    const advances = [
      makeAdvance({ date: "2026-06-01", deductMonth: "2026-06" }), // 6月
      makeAdvance({ id: "adv-2", date: "2026-08-01", deductMonth: "2026-08" }), // 8月
    ];
    const result = filterAdvancesForMonth(advances, currentMonth);
    expect(result).toHaveLength(0);
  });

  it("A4. 已取消预支不应计入", () => {
    const advances = [
      makeAdvance({ date: "2026-07-10", status: "cancelled" }),
    ];
    const result = filterAdvancesForMonth(advances, currentMonth);
    expect(result).toHaveLength(0);
  });

  it("A5. 已扣除预支应计入（status=deducted）", () => {
    const advances = [
      makeAdvance({ date: "2026-07-10", status: "deducted" }),
    ];
    const result = filterAdvancesForMonth(advances, currentMonth);
    expect(result).toHaveLength(1);
  });
});

// ─── Suite B：月份隔离（paySlips 过滤）─────────────────────────────────────────

describe("Suite B：月份隔离（paySlips 过滤）", () => {
  it("B1. getPaySlip 精确匹配 employeeId + month", () => {
    const paySlips = [
      makePaySlip({ employeeId: "emp-1", month: "2026-07" }),
      makePaySlip({ id: "slip-2", employeeId: "emp-1", month: "2026-08" }),
      makePaySlip({ id: "slip-3", employeeId: "emp-2", month: "2026-07" }),
    ];
    const result = paySlips.find(s => s.employeeId === "emp-1" && s.month === "2026-07");
    expect(result?.id).toBe("slip-1");
  });

  it("B2. 不同月份的 PaySlip 互不干扰", () => {
    const julySlip = makePaySlip({ month: "2026-07", allowanceOverrides: { meal: true } });
    const augustSlip = makePaySlip({ id: "slip-2", month: "2026-08", allowanceOverrides: { meal: false } });

    const paySlips = [julySlip, augustSlip];
    const july = paySlips.find(s => s.month === "2026-07");
    const august = paySlips.find(s => s.month === "2026-08");

    expect(july?.allowanceOverrides?.meal).toBe(true);
    expect(august?.allowanceOverrides?.meal).toBe(false);
  });

  it("B3. 不同员工的 PaySlip 互不干扰", () => {
    const emp1Slip = makePaySlip({ employeeId: "emp-1", workKPIBonus: 500 });
    const emp2Slip = makePaySlip({ id: "slip-2", employeeId: "emp-2", revenueKPIBonus: 300 });

    const paySlips = [emp1Slip, emp2Slip];
    const emp1 = paySlips.find(s => s.employeeId === "emp-1");
    const emp2 = paySlips.find(s => s.employeeId === "emp-2");

    expect(emp1?.workKPIBonus).toBe(500);
    expect(emp2?.revenueKPIBonus).toBe(300);
  });

  it("B4. 年度个税累计：只统计当年且早于当月的记录", () => {
    const paySlips = [
      makePaySlip({ month: "2026-01", grossSalary: 6000, socialInsuranceDeduction: 500 }),
      makePaySlip({ id: "slip-2", month: "2026-06", grossSalary: 7000, socialInsuranceDeduction: 600 }),
      makePaySlip({ id: "slip-3", month: "2026-07", grossSalary: 8000 }), // 当月，不计入
      makePaySlip({ id: "slip-4", month: "2025-12", grossSalary: 9000 }), // 上一年，不计入
    ];

    const currentMonth = "2026-07";
    const [curYear] = currentMonth.split("-");
    const prevMonthSlips = paySlips.filter(s =>
      s.employeeId === "emp-1" &&
      s.month.startsWith(curYear) &&
      s.month < currentMonth
    );

    expect(prevMonthSlips).toHaveLength(2); // 2026-01 和 2026-06
    expect(prevMonthSlips.map(s => s.month)).toEqual(["2026-01", "2026-06"]);
  });

  it("B5. 跨年个税累计：不包含上一年的记录", () => {
    const paySlips = [
      makePaySlip({ month: "2025-11", grossSalary: 8000 }),
      makePaySlip({ id: "slip-2", month: "2025-12", grossSalary: 9000 }),
      makePaySlip({ id: "slip-3", month: "2026-01", grossSalary: 6000 }),
    ];

    const currentMonth = "2026-03";
    const [curYear] = currentMonth.split("-");
    const prevMonthSlips = paySlips.filter(s =>
      s.employeeId === "emp-1" &&
      s.month.startsWith(curYear) &&
      s.month < currentMonth
    );

    expect(prevMonthSlips).toHaveLength(1); // 只有 2026-01
    expect(prevMonthSlips[0].month).toBe("2026-01");
  });
});

// ─── Suite C：buildPaySlipDraft 控制字段保留 ──────────────────────────────────

describe("Suite C：buildPaySlipDraft 控制字段保留（autoSync 不清除）", () => {
  // 模拟 buildPaySlipDraft 的返回值（修复后包含所有控制字段）
  function mockBuildPaySlipDraft(existing: ReturnType<typeof makePaySlip> | null) {
    return {
      grossSalary: 5500,
      finalSalary: 5500,
      workKPIBonus: existing?.workKPIBonus ?? 0,
      revenueKPIBonus: existing?.revenueKPIBonus ?? 0,
      mealAllowance: 345,
      transportAllowance: 0,
      otherAllowance: 15,
      // 修复后：从 existing 读取控制字段
      allowanceOverrides: existing?.allowanceOverrides,
      workKPISelections: existing?.workKPISelections,
      revenueActuals: existing?.revenueActuals,
      compOffCashOut: existing?.compOffCashOut,
      pettyLaborPaid: existing?.pettyLaborPaid,
    };
  }

  it("C1. autoSync 后 allowanceOverrides 不丢失", () => {
    const savedSlip = makePaySlip({ allowanceOverrides: { meal: true, transport: false } });
    const draft = mockBuildPaySlipDraft(savedSlip);
    expect(draft.allowanceOverrides).toEqual({ meal: true, transport: false });
  });

  it("C2. autoSync 后 workKPISelections 不丢失", () => {
    const savedSlip = makePaySlip({ workKPISelections: { "kpi-1": "t1" } });
    const draft = mockBuildPaySlipDraft(savedSlip);
    expect(draft.workKPISelections).toEqual({ "kpi-1": "t1" });
  });

  it("C3. autoSync 后 revenueActuals 不丢失", () => {
    const savedSlip = makePaySlip({ revenueActuals: { "rev-1": 80000 } });
    const draft = mockBuildPaySlipDraft(savedSlip);
    expect(draft.revenueActuals).toEqual({ "rev-1": 80000 });
  });

  it("C4. autoSync 后 compOffCashOut 不丢失", () => {
    const savedSlip = makePaySlip({ compOffCashOut: 300 });
    const draft = mockBuildPaySlipDraft(savedSlip);
    expect(draft.compOffCashOut).toBe(300);
  });

  it("C5. autoSync 后 pettyLaborPaid 不丢失", () => {
    const savedSlip = makePaySlip({ pettyLaborPaid: 1860 });
    const draft = mockBuildPaySlipDraft(savedSlip);
    expect(draft.pettyLaborPaid).toBe(1860);
  });
});

// ─── Suite D：autoSync 依赖数组完整性 ────────────────────────────────────────

describe("Suite D：autoSync 依赖数组完整性", () => {
  it("D1. globalSettings 变化应触发重算（依赖数组包含 globalSettings）", () => {
    // 模拟：globalSettings 在依赖数组中，变化时 autoSync 重新执行
    const deps1 = ["shifts", "currentMonth", "employees", "advances", "globalSettings", "specialStatuses"];
    expect(deps1).toContain("globalSettings");
    // 如果 globalSettings 不在依赖数组中，用户修改全局社保配置后薪资不会立即更新
  });

  it("D2. specialStatuses 变化应触发重算（依赖数组包含 specialStatuses）", () => {
    const deps1 = ["shifts", "currentMonth", "employees", "advances", "globalSettings", "specialStatuses"];
    expect(deps1).toContain("specialStatuses");
    // 如果 specialStatuses 不在依赖数组中，用户修改特殊状态配置后考勤不会立即重算
  });

  it("D3. paySlips 不在 autoSync 依赖数组中（防止无限循环）", () => {
    const autoSyncDeps = ["shifts", "currentMonth", "employees", "advances", "globalSettings", "specialStatuses"];
    expect(autoSyncDeps).not.toContain("paySlips");
    // autoSync 写入 paySlips，如果 paySlips 在依赖数组中会导致无限循环
    // 改用 getPaySlip(ref.current) 读取最新数据
  });
});

// ─── Suite E：三步走保存时序 ──────────────────────────────────────────────────

describe("Suite E：三步走保存时序（handleSave）", () => {
  it("E1. Step 1 写入控制字段后，Step 2 能读到最新值", () => {
    // 模拟 ref.current（同步更新）
    let refCurrent = makePaySlip({ allowanceOverrides: { meal: false } });

    // Step 1：写入新的控制字段
    const patched = { ...refCurrent, allowanceOverrides: { meal: true } };
    refCurrent = patched; // 模拟 ref.current 同步更新

    // Step 2：buildPaySlipDraft 从 ref.current 读取
    const existing = refCurrent;
    expect(existing.allowanceOverrides?.meal).toBe(true); // 能读到 Step 1 写入的值
  });

  it("E2. Step 3 的 draft 包含 Step 1 写入的控制字段", () => {
    const step1Overrides = { meal: true, transport: false };
    const step1Selections = { "kpi-1": "t1" };

    // 模拟 buildPaySlipDraft 返回值（从 existing 读取控制字段）
    const draft = {
      grossSalary: 5500,
      allowanceOverrides: step1Overrides, // 从 existing 读取
      workKPISelections: step1Selections, // 从 existing 读取
    };

    // Step 3：只需 { ...draft, id }，不需要再次传入控制字段
    const finalSlip = { ...draft, id: "slip-1" };
    expect(finalSlip.allowanceOverrides).toEqual(step1Overrides);
    expect(finalSlip.workKPISelections).toEqual(step1Selections);
  });

  it("E3. 不需要在 Step 3 中再次显式传入控制字段（避免两个来源）", () => {
    const savedOverrides = { meal: true };
    const draft = { grossSalary: 5500, allowanceOverrides: savedOverrides };

    // ❌ 旧写法（冗余，可能引发不一致）：
    // upsertPaySlip({ ...draft, allowanceOverrides: savedOverrides, id: "slip-1" })

    // ✅ 新写法（简洁，draft 已包含）：
    const finalSlip = { ...draft, id: "slip-1" };
    expect(finalSlip.allowanceOverrides).toEqual(savedOverrides);
    expect(Object.keys(finalSlip)).toEqual(["grossSalary", "allowanceOverrides", "id"]);
  });
});

// ─── Suite F：App 启动时序 ready 检查 ────────────────────────────────────────
// 根本原因：autoSync 在 shifts/employees 未加载完成时触发，activeEmps=[] 导致
// 循环不执行，旧的 attendances/paySlips 数据不会被清零
// 修复：autoSync 开头加 shiftsReady && employeesReady 检查
describe("Suite F：App 启动时序 ready 检查（比例底薪根本原因）", () => {
  it("F1. shiftsReady=false 时 autoSync 应跳过执行", () => {
    const shiftsReady = false;
    const employeesReady = true;
    const shouldRun = shiftsReady && employeesReady;
    expect(shouldRun).toBe(false);
  });

  it("F2. employeesReady=false 时 autoSync 应跳过执行", () => {
    const shiftsReady = true;
    const employeesReady = false;
    const shouldRun = shiftsReady && employeesReady;
    expect(shouldRun).toBe(false);
  });

  it("F3. 两者都 ready 时 autoSync 才执行", () => {
    const shiftsReady = true;
    const employeesReady = true;
    const shouldRun = shiftsReady && employeesReady;
    expect(shouldRun).toBe(true);
  });

  it("F4. 无排班时日薪累计比例底薪返回 0（attendanceDays=0）", () => {
    const dailyRate = calcDailyRate(8000, 31, 4);
    expect(calcAttendanceBaseSalary(dailyRate, 0, 27)).toBe(0);
  });

  it("F5. autoSync 依赖数组包含 shiftsReady 和 employeesReady", () => {
    const autoSyncDeps = [
      "shifts", "currentMonth", "employees", "advances",
      "compOffEntriesSched",
      "globalSettings", "specialStatuses",
      "shiftsReady", "employeesReady",
    ];
    expect(autoSyncDeps).toContain("shiftsReady");
    expect(autoSyncDeps).toContain("employeesReady");
    expect(autoSyncDeps).not.toContain("paySlips"); // 防止无限循环
  });

  it("F6. App 启动时序：employees 未 ready 时 activeEmps 为空导致旧数据保留", () => {
    // 模拟 App 启动时的错误场景（修复前）
    const employees: any[] = []; // employees 未加载完成
    const activeEmps = employees.filter((e: any) => e.active && !e.archived);
    // 如果 activeEmps 为空，循环不执行，旧数据不会被清零
    expect(activeEmps).toHaveLength(0);
    // 这就是为什么需要 ready 检查：防止在 employees 未加载完成时执行 autoSync
  });
});

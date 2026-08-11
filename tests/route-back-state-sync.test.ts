/**
 * 路由返回后组件状态同步测试
 *
 * 背景：
 * Expo Router Stack Navigator 中，router.push 子页面时父页面不卸载（只是被遮住）。
 * router.back() 返回时父页面不重新挂载，useMemo 只有在依赖变化时才重新计算。
 *
 * 核心规则：
 * - ✅ 依赖 React state（paySlips/attendances/employees）→ state 变化时重新计算
 * - ❌ 依赖 store action（getPaySlip/getAttendance，基于 ref 稳定引用）→ 不会重新计算
 *
 * 测试目标：
 * 1. 验证 paySlips state 变化时 slip 正确更新（workKPISelections/allowanceOverrides 等）
 * 2. 验证 attendances state 变化时 attendanceDays 正确更新
 * 3. 验证 getPaySlip（ref-based）不会触发 useMemo 重新计算（旧问题复现）
 * 4. 验证多字段同时更新时的原子性
 * 5. 验证跨员工/跨月份的隔离性
 */

import { describe, it, expect } from "vitest";

// ─── 工具函数：模拟 useMemo 行为 ─────────────────────────────────────────────
function createMemoSlip(
  getSlipFn: () => any,
  deps: () => any[]
) {
  let cachedDeps: any[] = [];
  let cachedValue: any = undefined;
  let computeCount = 0;

  return {
    compute() {
      const newDeps = deps();
      const changed = newDeps.some((d, i) => d !== cachedDeps[i]);
      if (changed || cachedValue === undefined) {
        cachedValue = getSlipFn();
        cachedDeps = newDeps;
        computeCount++;
      }
      return cachedValue;
    },
    getComputeCount() { return computeCount; },
    reset() { cachedDeps = []; cachedValue = undefined; computeCount = 0; }
  };
}

// ─── Suite A：paySlips state 响应性（核心修复验证） ───────────────────────────
describe("Suite A：paySlips state 响应性", () => {
  it("A1. 依赖 paySlips state 的 useMemo 在 persist 后立即更新", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    let paySlips = [{ employeeId, month, workKPISelections: {}, performanceBonus: 0 }];

    const memo = createMemoSlip(
      () => paySlips.find(s => s.employeeId === employeeId && s.month === month) ?? null,
      () => [paySlips, employeeId, month]  // 依赖 paySlips state
    );

    // 初始计算
    const slip1 = memo.compute();
    expect(slip1?.workKPISelections).toEqual({});
    expect(memo.getComputeCount()).toBe(1);

    // 模拟 handleSave → persist → setData → paySlips state 更新
    paySlips = [{ employeeId, month, workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 1700 }];

    // useMemo 重新计算（paySlips 引用变化）
    const slip2 = memo.compute();
    expect(slip2?.workKPISelections).toEqual({ "rule_1": "tier_a" });
    expect(slip2?.performanceBonus).toBe(1700);
    expect(memo.getComputeCount()).toBe(2);
  });

  it("A2. 依赖 getPaySlip（ref-based）的 useMemo 在 persist 后不更新（旧 Bug 复现）", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    const ref = { current: [{ employeeId, month, workKPISelections: {}, performanceBonus: 0 }] };
    const getPaySlip = (id: string, m: string) =>
      ref.current.find(s => s.employeeId === id && s.month === m) ?? null;

    // 模拟稳定的 getPaySlip 引用（useCallback 依赖 ref 对象，ref 对象不变）
    const stableGetPaySlip = getPaySlip; // 引用不变

    const memo = createMemoSlip(
      () => stableGetPaySlip(employeeId, month),
      () => [employeeId, month, stableGetPaySlip]  // 依赖 getPaySlip（稳定引用）
    );

    // 初始计算
    const slip1 = memo.compute();
    expect(slip1?.workKPISelections).toEqual({});
    expect(memo.getComputeCount()).toBe(1);

    // 模拟 persist → ref.current 更新（但 getPaySlip 引用不变）
    ref.current = [{ employeeId, month, workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 1700 }];

    // useMemo 依赖未变化 → 不重新计算 → 返回旧值（旧 Bug！）
    const slip2 = memo.compute();
    expect(slip2?.workKPISelections).toEqual({});  // 仍然是旧值！
    expect(memo.getComputeCount()).toBe(1);  // 没有重新计算
  });

  it("A3. 多字段同时更新时的原子性（workKPISelections + allowanceOverrides + performanceBonus）", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    let paySlips = [{
      employeeId, month,
      workKPISelections: {},
      allowanceOverrides: {},
      performanceBonus: 0,
    }];

    const memo = createMemoSlip(
      () => paySlips.find(s => s.employeeId === employeeId && s.month === month) ?? null,
      () => [paySlips, employeeId, month]
    );

    const slip1 = memo.compute();
    expect(slip1?.performanceBonus).toBe(0);

    // 原子性更新（三个字段同时变化）
    paySlips = [{
      employeeId, month,
      workKPISelections: { "rule_1": "tier_a", "rule_2": "tier_b" },
      allowanceOverrides: { "allowance_meal": true },
      performanceBonus: 1700,
    }];

    const slip2 = memo.compute();
    expect(slip2?.workKPISelections).toEqual({ "rule_1": "tier_a", "rule_2": "tier_b" });
    expect(slip2?.allowanceOverrides).toEqual({ "allowance_meal": true });
    expect(slip2?.performanceBonus).toBe(1700);
    expect(memo.getComputeCount()).toBe(2);
  });

  it("A4. 跨员工隔离：更新员工 A 的 slip 不影响员工 B 的 memo 缓存", () => {
    const empA = "emp_rg", empB = "emp_zq";
    const month = "2026-08";

    let paySlips = [
      { employeeId: empA, month, workKPISelections: {}, performanceBonus: 0 },
      { employeeId: empB, month, workKPISelections: {}, performanceBonus: 0 },
    ];

    const memoA = createMemoSlip(
      () => paySlips.find(s => s.employeeId === empA && s.month === month) ?? null,
      () => [paySlips, empA, month]
    );
    const memoB = createMemoSlip(
      () => paySlips.find(s => s.employeeId === empB && s.month === month) ?? null,
      () => [paySlips, empB, month]
    );

    memoA.compute();
    memoB.compute();
    expect(memoA.getComputeCount()).toBe(1);
    expect(memoB.getComputeCount()).toBe(1);

    // 只更新员工 A
    paySlips = [
      { employeeId: empA, month, workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 1700 },
      { employeeId: empB, month, workKPISelections: {}, performanceBonus: 0 },
    ];

    const slipA = memoA.compute();
    const slipB = memoB.compute();

    expect(slipA?.performanceBonus).toBe(1700);  // A 更新了
    expect(slipB?.performanceBonus).toBe(0);      // B 未变
    // 注意：paySlips 引用变化，两个 memo 都会重新计算（这是正确行为）
    expect(memoA.getComputeCount()).toBe(2);
    expect(memoB.getComputeCount()).toBe(2);
  });

  it("A5. 跨月份隔离：更新 7 月数据不影响 8 月 memo 缓存", () => {
    const employeeId = "emp_rg";

    let paySlips = [
      { employeeId, month: "2026-07", workKPISelections: {}, performanceBonus: 0 },
      { employeeId, month: "2026-08", workKPISelections: {}, performanceBonus: 0 },
    ];

    const memo07 = createMemoSlip(
      () => paySlips.find(s => s.employeeId === employeeId && s.month === "2026-07") ?? null,
      () => [paySlips, employeeId, "2026-07"]
    );
    const memo08 = createMemoSlip(
      () => paySlips.find(s => s.employeeId === employeeId && s.month === "2026-08") ?? null,
      () => [paySlips, employeeId, "2026-08"]
    );

    memo07.compute();
    memo08.compute();

    // 只更新 7 月
    paySlips = [
      { employeeId, month: "2026-07", workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 1700 },
      { employeeId, month: "2026-08", workKPISelections: {}, performanceBonus: 0 },
    ];

    const slip07 = memo07.compute();
    const slip08 = memo08.compute();

    expect(slip07?.performanceBonus).toBe(1700);  // 7月更新了
    expect(slip08?.performanceBonus).toBe(0);      // 8月未变
  });
});

// ─── Suite B：attendances state 响应性 ───────────────────────────────────────
describe("Suite B：attendances state 响应性", () => {
  it("B1. 依赖 attendances state 的 useMemo 在考勤更新后立即更新", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    let attendances = [{ employeeId, month, attendanceDays: 5 }];

    const memo = createMemoSlip(
      () => attendances.find(a => a.employeeId === employeeId && a.month === month)?.attendanceDays ?? 0,
      () => [attendances, employeeId, month]
    );

    expect(memo.compute()).toBe(5);
    expect(memo.getComputeCount()).toBe(1);

    // autoSync 更新考勤
    attendances = [{ employeeId, month, attendanceDays: 23 }];
    expect(memo.compute()).toBe(23);
    expect(memo.getComputeCount()).toBe(2);
  });

  it("B2. 依赖 getAttendance（ref-based）的 useMemo 在考勤更新后不更新（防御性修复验证）", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    const ref = { current: [{ employeeId, month, attendanceDays: 5 }] };
    const getAttendance = (id: string, m: string) =>
      ref.current.find(a => a.employeeId === id && a.month === m) ?? null;

    const stableGetAttendance = getAttendance;

    const memo = createMemoSlip(
      () => stableGetAttendance(employeeId, month)?.attendanceDays ?? 0,
      () => [employeeId, month, stableGetAttendance]  // 依赖稳定引用
    );

    expect(memo.compute()).toBe(5);
    expect(memo.getComputeCount()).toBe(1);

    // ref.current 更新，但 getAttendance 引用不变
    ref.current = [{ employeeId, month, attendanceDays: 23 }];

    // 不重新计算！返回旧值
    expect(memo.compute()).toBe(5);
    expect(memo.getComputeCount()).toBe(1);
  });

  it("B3. 修复后：加入 attendanceRecords 依赖后能正确更新", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    const ref = { current: [{ employeeId, month, attendanceDays: 5 }] };
    const getAttendance = (id: string, m: string) =>
      ref.current.find(a => a.employeeId === id && a.month === m) ?? null;
    const stableGetAttendance = getAttendance;

    let attendanceRecords = [...ref.current];

    // 修复后：依赖数组加入 attendanceRecords
    const memo = createMemoSlip(
      () => stableGetAttendance(employeeId, month)?.attendanceDays ?? 0,
      () => [employeeId, month, stableGetAttendance, attendanceRecords]  // 加入 records state
    );

    expect(memo.compute()).toBe(5);

    // 同时更新 ref.current 和 attendanceRecords state
    ref.current = [{ employeeId, month, attendanceDays: 23 }];
    attendanceRecords = [...ref.current];  // persist 时 setData 更新

    // 现在能正确更新！
    expect(memo.compute()).toBe(23);
    expect(memo.getComputeCount()).toBe(2);
  });
});

// ─── Suite C：Stack Navigator 路由返回场景模拟 ────────────────────────────────
describe("Suite C：Stack Navigator 路由返回场景", () => {
  it("C1. 路由返回后展示页 slip 应反映编辑页保存的最新数据", () => {
    // 模拟完整的「打开展示页 → push 编辑页 → 保存 → back 返回」流程
    const employeeId = "emp_rg";
    const month = "2026-08";

    // 初始状态（展示页挂载时）
    let paySlips = [{ employeeId, month, workKPISelections: {}, performanceBonus: 0 }];

    // 展示页的 slip 计算（依赖 paySlips state）
    const computeDisplaySlip = (slips: typeof paySlips) =>
      slips.find(s => s.employeeId === employeeId && s.month === month) ?? null;

    // 展示页挂载，useMemo 初次计算
    const displaySlip1 = computeDisplaySlip(paySlips);
    expect(displaySlip1?.workKPISelections).toEqual({});

    // 用户 push 到编辑页（展示页不卸载）
    // 用户选择档位并保存
    // handleSave → upsertPaySlip → persist → setData → paySlips state 更新
    paySlips = [{
      employeeId, month,
      workKPISelections: { "rule_1": "tier_a", "rule_2": "tier_b", "rule_3": "tier_c" },
      performanceBonus: 1700,
    }];

    // router.back() → 展示页重新显示
    // paySlips state 已变化 → useMemo 重新计算
    const displaySlip2 = computeDisplaySlip(paySlips);
    expect(displaySlip2?.workKPISelections).toEqual({
      "rule_1": "tier_a",
      "rule_2": "tier_b",
      "rule_3": "tier_c",
    });
    expect(displaySlip2?.performanceBonus).toBe(1700);
  });

  it("C2. 多次编辑后每次返回都能看到最新数据", () => {
    const employeeId = "emp_rg";
    const month = "2026-08";

    let paySlips = [{ employeeId, month, workKPISelections: {}, performanceBonus: 0 }];
    const computeSlip = (slips: typeof paySlips) =>
      slips.find(s => s.employeeId === employeeId && s.month === month) ?? null;

    // 第一次编辑
    paySlips = [{ employeeId, month, workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 300 }];
    expect(computeSlip(paySlips)?.performanceBonus).toBe(300);

    // 第二次编辑（修改选择）
    paySlips = [{ employeeId, month, workKPISelections: { "rule_1": "tier_b" }, performanceBonus: 200 }];
    expect(computeSlip(paySlips)?.workKPISelections).toEqual({ "rule_1": "tier_b" });
    expect(computeSlip(paySlips)?.performanceBonus).toBe(200);

    // 第三次编辑（清空）
    paySlips = [{ employeeId, month, workKPISelections: {}, performanceBonus: 0 }];
    expect(computeSlip(paySlips)?.workKPISelections).toEqual({});
    expect(computeSlip(paySlips)?.performanceBonus).toBe(0);
  });

  it("C3. 编辑页保存时 Step1/Step2/Step3 三步走的原子性", () => {
    // 模拟 handleSave 的三步走流程
    const employeeId = "emp_rg";
    const month = "2026-08";

    // 初始 slip（无控制字段）
    let storeData = [{ employeeId, month, workKPISelections: {}, performanceBonus: 0, finalSalary: 0 }];

    // Step 1：写入控制字段
    const patched = { ...storeData[0], workKPISelections: { "rule_1": "tier_a" }, performanceBonus: 1700 };
    storeData = [patched];

    // Step 2：buildPaySlipDraft 从 storeData 读取 existing（包含控制字段）
    const existing = storeData.find(s => s.employeeId === employeeId && s.month === month);
    expect(existing?.workKPISelections).toEqual({ "rule_1": "tier_a" });

    // 模拟 buildPaySlipDraft 保留控制字段
    const draft = {
      ...existing,
      finalSalary: 8085,
      workKPISelections: existing?.workKPISelections,  // 从 existing 读取
    };

    // Step 3：写入 draft
    storeData = [{ ...draft as any }];

    // 最终结果：控制字段和计算结果都正确
    const finalSlip = storeData.find(s => s.employeeId === employeeId && s.month === month);
    expect(finalSlip?.workKPISelections).toEqual({ "rule_1": "tier_a" });
    expect(finalSlip?.performanceBonus).toBe(1700);
    expect(finalSlip?.finalSalary).toBe(8085);
  });
});

// ─── Suite D：开发规范验证 ───────────────────────────────────────────────────
describe("Suite D：开发规范 — useMemo 依赖规则", () => {
  it("D1. 规范：展示类 useMemo 必须依赖 state 而非 action", () => {
    // 验证规范：如果 useMemo 用于展示数据，必须依赖 React state
    // 这个测试作为文档性测试，确保规范被理解和遵守

    // ✅ 正确：依赖 paySlips state
    const correctPattern = (paySlips: any[], employeeId: string, month: string) =>
      paySlips.find(s => s.employeeId === employeeId && s.month === month) ?? null;

    // ❌ 错误：依赖 getPaySlip（稳定引用）
    const ref = { current: [{ employeeId: "emp_1", month: "2026-08", value: "old" }] };
    const getPaySlip = (id: string, m: string) => ref.current.find(s => s.employeeId === id && s.month === m) ?? null;

    let paySlips = [{ employeeId: "emp_1", month: "2026-08", value: "old" }];

    // 正确模式：state 更新后能读到新值
    paySlips = [{ employeeId: "emp_1", month: "2026-08", value: "new" }];
    expect(correctPattern(paySlips, "emp_1", "2026-08")?.value).toBe("new");

    // 错误模式：ref 更新后 getPaySlip 能读到新值，但 useMemo 不会重新调用
    ref.current = [{ employeeId: "emp_1", month: "2026-08", value: "new" }];
    // getPaySlip 本身能读到新值
    expect(getPaySlip("emp_1", "2026-08")?.value).toBe("new");
    // 但 useMemo 缓存了旧值，不会重新调用 getPaySlip
    // → 这就是 Bug 的根本原因
  });

  it("D2. 规范：写入操作（handleSave）中使用 getPaySlip 是正确的", () => {
    // 写入操作在事件处理函数中，不受 useMemo 缓存影响
    // 每次调用都会读取最新的 ref.current

    const ref = { current: [{ employeeId: "emp_1", month: "2026-08", value: "old" }] };
    const getPaySlip = (id: string, m: string) => ref.current.find(s => s.employeeId === id && s.month === m) ?? null;

    // 模拟 handleSave 中读取 existing
    const existing1 = getPaySlip("emp_1", "2026-08");
    expect(existing1?.value).toBe("old");

    // 更新后再次读取（在 handleSave 中是正确的）
    ref.current = [{ employeeId: "emp_1", month: "2026-08", value: "new" }];
    const existing2 = getPaySlip("emp_1", "2026-08");
    expect(existing2?.value).toBe("new");
  });
});

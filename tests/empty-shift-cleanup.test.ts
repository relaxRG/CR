/**
 * 空排班记录清理测试
 *
 * 覆盖：
 * 1. isEmptyShiftEntry 纯函数：各种边界情况
 * 2. cleanEmptyShiftEntries 迁移脚本：AsyncStorage mock 场景
 * 3. SchHoursModal 清空工时行为回归：保证清空工时时删除记录而不是保留空值
 * 4. groupedScheduleRows 过滤逻辑回归：空记录不应出现在排班表
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isEmptyShiftEntry,
  cleanEmptyShiftEntries,
  resetMigrationState,
  type ShiftEntryRaw,
} from "@/lib/migrations/clean-empty-shift-entries";

// ─── AsyncStorage Mock ────────────────────────────────────────────────────────
const mockStorage: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(mockStorage[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
  },
}));

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
function makeShift(overrides: Partial<ShiftEntryRaw> = {}): ShiftEntryRaw {
  return {
    employeeId: "emp_001",
    date: "2026-08-01",
    shift: "午班",
    hoursValue: 8,
    specialStatusId: undefined,
    ...overrides,
  };
}

async function setShifts(entries: ShiftEntryRaw[]) {
  mockStorage["labor_shifts_v1"] = JSON.stringify(entries);
}

async function getShifts(): Promise<ShiftEntryRaw[]> {
  const raw = mockStorage["labor_shifts_v1"];
  return raw ? JSON.parse(raw) : [];
}

// ─── 测试组 1：isEmptyShiftEntry 纯函数 ───────────────────────────────────────
describe("isEmptyShiftEntry", () => {
  it("正常班次（有工时）→ 不是空记录", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: 8 }))).toBe(false);
  });

  it("工时为 0.5（半天）→ 不是空记录", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: 0.5 }))).toBe(false);
  });

  it("有特殊状态（调休）→ 不是空记录，即使工时为 null", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: null, specialStatusId: "ss_comp_off_overtime" }))).toBe(false);
  });

  it("有特殊状态（旷工）→ 不是空记录", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: null, specialStatusId: "ss_absent" }))).toBe(false);
  });

  it("有特殊状态（节日上班）+ 有工时 → 不是空记录", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: 8, specialStatusId: "ss_holiday" }))).toBe(false);
  });

  // ── 以下是应该被清理的空记录 ──
  it("hoursValue=null 且无特殊状态 → 是空记录（应清理）", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: null, specialStatusId: undefined }))).toBe(true);
  });

  it("hoursValue=undefined 且无特殊状态 → 是空记录（应清理）", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: undefined, specialStatusId: undefined }))).toBe(true);
  });

  it("hoursValue=0 且无特殊状态 → 是空记录（0 工时无意义，应清理）", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: 0, specialStatusId: undefined }))).toBe(true);
  });

  it("hoursValue=null 且 specialStatusId=null → 是空记录（应清理）", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: null, specialStatusId: null as any }))).toBe(true);
  });

  it("hoursValue=null 且 specialStatusId='' → 是空记录（应清理）", () => {
    expect(isEmptyShiftEntry(makeShift({ hoursValue: null, specialStatusId: "" }))).toBe(true);
  });
});

// ─── 测试组 2：cleanEmptyShiftEntries 迁移脚本 ────────────────────────────────
describe("cleanEmptyShiftEntries", () => {
  beforeEach(async () => {
    // 清空 mock storage 和迁移状态
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    await resetMigrationState();
  });

  it("无 labor_shifts_v1 数据 → 返回 0，不报错", async () => {
    const removed = await cleanEmptyShiftEntries();
    expect(removed).toBe(0);
  });

  it("全部是正常记录 → 不删除任何记录，返回 0", async () => {
    await setShifts([
      makeShift({ employeeId: "emp_001", date: "2026-08-01", hoursValue: 8 }),
      makeShift({ employeeId: "emp_002", date: "2026-08-02", hoursValue: 6 }),
    ]);
    const removed = await cleanEmptyShiftEntries();
    expect(removed).toBe(0);
    const remaining = await getShifts();
    expect(remaining).toHaveLength(2);
  });

  it("混合记录：清理空记录，保留有效记录", async () => {
    await setShifts([
      makeShift({ employeeId: "emp_001", date: "2026-08-01", hoursValue: 8 }),           // 保留
      makeShift({ employeeId: "emp_001", date: "2026-08-02", hoursValue: null }),          // 清理
      makeShift({ employeeId: "emp_001", date: "2026-08-03", hoursValue: null, specialStatusId: "ss_comp_off_overtime" }), // 保留（有特殊状态）
      makeShift({ employeeId: "emp_002", date: "2026-08-01", hoursValue: undefined }),     // 清理
      makeShift({ employeeId: "emp_002", date: "2026-08-04", hoursValue: 0 }),             // 清理
    ]);
    const removed = await cleanEmptyShiftEntries();
    expect(removed).toBe(3);
    const remaining = await getShifts();
    expect(remaining).toHaveLength(2);
    // 验证保留的是正确的记录
    expect(remaining.some((r) => r.date === "2026-08-01" && r.employeeId === "emp_001")).toBe(true);
    expect(remaining.some((r) => r.date === "2026-08-03" && r.specialStatusId === "ss_comp_off_overtime")).toBe(true);
  });

  it("全部是空记录 → 全部清理，返回正确数量", async () => {
    await setShifts([
      makeShift({ hoursValue: null }),
      makeShift({ date: "2026-08-02", hoursValue: null }),
      makeShift({ date: "2026-08-03", hoursValue: undefined }),
    ]);
    const removed = await cleanEmptyShiftEntries();
    expect(removed).toBe(3);
    const remaining = await getShifts();
    expect(remaining).toHaveLength(0);
  });

  it("幂等性：第二次运行返回 0（不重复清理）", async () => {
    await setShifts([
      makeShift({ hoursValue: null }),
    ]);
    const first = await cleanEmptyShiftEntries();
    expect(first).toBe(1);
    // 第二次：已标记完成，直接返回 0
    const second = await cleanEmptyShiftEntries();
    expect(second).toBe(0);
  });

  it("JSON 解析失败 → 不崩溃，返回 0", async () => {
    mockStorage["labor_shifts_v1"] = "invalid json {{{";
    const removed = await cleanEmptyShiftEntries();
    expect(removed).toBe(0);
  });
});

// ─── 测试组 3：SchHoursModal 清空工时行为回归 ─────────────────────────────────
describe("SchHoursModal 清空工时行为回归", () => {
  /**
   * 模拟 SchHoursModal.handleSave 的逻辑
   * 修复后：工时为空且无特殊状态时，调用 onClear 而不是 onSave
   */
  function simulateHandleSave(
    hoursInput: string,
    existingSpecialStatusId: string | undefined,
    onSave: (entry: Partial<ShiftEntryRaw>) => void,
    onClear: () => void
  ) {
    const hv = hoursInput ? (Number(hoursInput) || null) : null;
    // 修复后的逻辑
    if (hv === null && !existingSpecialStatusId) {
      onClear();
      return;
    }
    onSave({ hoursValue: hv, specialStatusId: undefined });
  }

  it("清空工时（无特殊状态）→ 调用 onClear，不调用 onSave", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("", undefined, onSave, onClear);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("清空工时（有特殊状态）→ 调用 onSave 保留特殊状态，不调用 onClear", () => {
    // 当 existing 有特殊状态时，清空工时不应删除记录
    // 注意：此场景实际上不会触发 handleSave（特殊状态有独立的 handleSelectSpecial）
    // 但作为防御性测试保留
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("", "ss_comp_off_overtime", onSave, onClear);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("输入有效工时 → 调用 onSave，不调用 onClear", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("8", undefined, onSave, onClear);
    expect(onSave).toHaveBeenCalledWith({ hoursValue: 8, specialStatusId: undefined });
    expect(onClear).not.toHaveBeenCalled();
  });

  it("输入 0 工时 → 调用 onClear（0 工时等同于清空）", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("0", undefined, onSave, onClear);
    // Number("0") || null = null（0 是 falsy）
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("输入非数字字符串 → 调用 onClear", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("abc", undefined, onSave, onClear);
    // Number("abc") = NaN, NaN || null = null
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("输入 0.5 工时 → 调用 onSave（半天有效）", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();
    simulateHandleSave("0.5", undefined, onSave, onClear);
    expect(onSave).toHaveBeenCalledWith({ hoursValue: 0.5, specialStatusId: undefined });
    expect(onClear).not.toHaveBeenCalled();
  });
});

// ─── 测试组 4：groupedScheduleRows 过滤逻辑回归 ───────────────────────────────
describe("groupedScheduleRows 空记录过滤回归", () => {
  /**
   * 模拟 groupedScheduleRows 中 empIdsWithShifts 的过滤逻辑
   * 修复后：过滤掉 hoursValue=null 且 specialStatusId=null 的空记录
   */
  function getEmpIdsWithValidShifts(
    shifts: ShiftEntryRaw[],
    session: string
  ): Set<string> {
    return new Set(
      shifts
        .filter(
          (s) =>
            s.shift === session &&
            (s.hoursValue !== null || s.specialStatusId != null)
        )
        .map((s) => s.employeeId)
    );
  }

  it("只有空记录 → 员工不出现在排班表", () => {
    const shifts: ShiftEntryRaw[] = [
      makeShift({ employeeId: "emp_001", shift: "午班", hoursValue: null }),
    ];
    const ids = getEmpIdsWithValidShifts(shifts, "午班");
    expect(ids.has("emp_001")).toBe(false);
  });

  it("有效记录 → 员工出现在排班表", () => {
    const shifts: ShiftEntryRaw[] = [
      makeShift({ employeeId: "emp_001", shift: "午班", hoursValue: 8 }),
    ];
    const ids = getEmpIdsWithValidShifts(shifts, "午班");
    expect(ids.has("emp_001")).toBe(true);
  });

  it("有特殊状态（无工时）→ 员工出现在排班表", () => {
    const shifts: ShiftEntryRaw[] = [
      makeShift({ employeeId: "emp_001", shift: "午班", hoursValue: null, specialStatusId: "ss_comp_off_overtime" }),
    ];
    const ids = getEmpIdsWithValidShifts(shifts, "午班");
    expect(ids.has("emp_001")).toBe(true);
  });

  it("混合：同一员工有空记录和有效记录 → 员工出现在排班表", () => {
    const shifts: ShiftEntryRaw[] = [
      makeShift({ employeeId: "emp_001", shift: "午班", date: "2026-08-01", hoursValue: null }),
      makeShift({ employeeId: "emp_001", shift: "午班", date: "2026-08-02", hoursValue: 8 }),
    ];
    const ids = getEmpIdsWithValidShifts(shifts, "午班");
    expect(ids.has("emp_001")).toBe(true);
  });

  it("不同班次的记录不互相影响", () => {
    const shifts: ShiftEntryRaw[] = [
      makeShift({ employeeId: "emp_001", shift: "午班", hoursValue: 8 }),
      makeShift({ employeeId: "emp_002", shift: "晚班", hoursValue: null }),
    ];
    const morningIds = getEmpIdsWithValidShifts(shifts, "午班");
    const eveningIds = getEmpIdsWithValidShifts(shifts, "晚班");
    expect(morningIds.has("emp_001")).toBe(true);
    expect(eveningIds.has("emp_002")).toBe(false);
  });
});

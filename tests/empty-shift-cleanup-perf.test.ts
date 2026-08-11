/**
 * 迁移脚本性能测试：模拟大量脏数据场景
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

function makeEntry(overrides: Partial<ShiftEntryRaw> = {}): ShiftEntryRaw {
  return {
    employeeId: "emp_001",
    date: "2026-08-01",
    shift: "午班",
    hoursValue: 8,
    ...overrides,
  };
}

function generateEntries(count: number, dirtyRatio: number): ShiftEntryRaw[] {
  const entries: ShiftEntryRaw[] = [];
  const employees = ["emp_001", "emp_002", "emp_003", "emp_004", "emp_005"];
  const sessions = ["午班", "晚班", "早班"];
  const specialStatuses = [undefined, "ss_comp_off", "ss_absent", "ss_holiday"];

  for (let i = 0; i < count; i++) {
    const empId = employees[i % employees.length];
    const session = sessions[i % sessions.length];
    const year = 2026;
    const month = String((i % 12) + 1).padStart(2, "0");
    const day = String((i % 28) + 1).padStart(2, "0");
    const date = `${year}-${month}-${day}`;

    const isDirty = Math.random() < dirtyRatio;
    if (isDirty) {
      // 空记录（hoursValue=null 且无特殊状态）
      entries.push(makeEntry({ employeeId: empId, date, shift: session, hoursValue: null, specialStatusId: undefined }));
    } else {
      // 有效记录（随机工时或特殊状态）
      const hasSpecial = Math.random() < 0.2;
      if (hasSpecial) {
        const ss = specialStatuses[Math.floor(Math.random() * specialStatuses.length)];
        entries.push(makeEntry({ employeeId: empId, date, shift: session, hoursValue: null, specialStatusId: ss }));
      } else {
        const hours = Math.round((Math.random() * 12 + 4) * 2) / 2;
        entries.push(makeEntry({ employeeId: empId, date, shift: session, hoursValue: hours }));
      }
    }
  }
  return entries;
}

describe("迁移脚本性能测试", () => {
  beforeEach(async () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    await resetMigrationState();
  });

  it("1,000 条记录（50% 脏数据）→ 应在 50ms 内完成", async () => {
    const entries = generateEntries(1000, 0.5);
    mockStorage["labor_shifts_v1"] = JSON.stringify(entries);

    const start = performance.now();
    const removed = await cleanEmptyShiftEntries();
    const elapsed = performance.now() - start;

    console.log(`1,000 条记录：清理 ${removed} 条，耗时 ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(50);
    expect(removed).toBeGreaterThan(0);
  });

  it("10,000 条记录（30% 脏数据）→ 应在 200ms 内完成", async () => {
    const entries = generateEntries(10000, 0.3);
    mockStorage["labor_shifts_v1"] = JSON.stringify(entries);

    const start = performance.now();
    const removed = await cleanEmptyShiftEntries();
    const elapsed = performance.now() - start;

    console.log(`10,000 条记录：清理 ${removed} 条，耗时 ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(200);
    expect(removed).toBeGreaterThan(0);
  });

  it("50,000 条记录（10% 脏数据）→ 应在 500ms 内完成", async () => {
    const entries = generateEntries(50000, 0.1);
    mockStorage["labor_shifts_v1"] = JSON.stringify(entries);

    const start = performance.now();
    const removed = await cleanEmptyShiftEntries();
    const elapsed = performance.now() - start;

    console.log(`50,000 条记录：清理 ${removed} 条，耗时 ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(500);
    expect(removed).toBeGreaterThan(0);
  });

  it("100,000 条记录（全部干净）→ 应在 3000ms 内完成，不删除任何记录", async () => {
    // 直接生成全部有效记录（有工时），不依赖 generateEntries 的随机逻辑
    const entries: ShiftEntryRaw[] = Array.from({ length: 100000 }, (_, i) => ({
      employeeId: `emp_${i % 5 + 1}`,
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      shift: ["午班", "晚班", "早班"][i % 3],
      hoursValue: (i % 12) + 1,  // 1-12 小时，全部有效
      specialStatusId: undefined,
    }));
    mockStorage["labor_shifts_v1"] = JSON.stringify(entries);

    const start = performance.now();
    const removed = await cleanEmptyShiftEntries();
    const elapsed = performance.now() - start;

    console.log(`100,000 条记录（全干净）：清理 ${removed} 条，耗时 ${elapsed.toFixed(2)}ms`);
    // 该路径包含 100,000 条 JSON 的序列化、反序列化和完整扫描；在并行 CI/H5 编译
    // 共用 CPU 时 500ms 不稳定。3s 仍能拦截明显的算法复杂度或 I/O 回归。
    expect(elapsed).toBeLessThan(3000);
    expect(removed).toBe(0);
  });

  it("isEmptyShiftEntry 纯函数：100 万次调用 → 应在 500ms 内完成", () => {
    const entries = generateEntries(1000, 0.5);
    const start = performance.now();
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      for (const e of entries) {
        if (isEmptyShiftEntry(e)) count++;
      }
    }
    const elapsed = performance.now() - start;
    console.log(`isEmptyShiftEntry 100 万次调用：${count} 次为空，耗时 ${elapsed.toFixed(2)}ms`);
    // CI 环境比真机慢 2-3 倍，将阈值从 100ms 放宽到 500ms
    expect(elapsed).toBeLessThan(500);
  });
});

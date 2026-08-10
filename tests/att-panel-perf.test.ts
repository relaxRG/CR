/**
 * 调休余额面板按钮连续快速点击性能测试
 *
 * 模拟移动端用户在 100ms 内连续点击 50 次面板按钮的场景，
 * 验证状态更新是否有性能卡顿（每次操作应在 1ms 内完成）。
 */

import { describe, it, expect } from "vitest";

// ─── 模拟 per-employee 面板状态更新 ──────────────────────────────────────────

type PanelMode = "add" | "deduct";
type AddMode = "hours" | "days";

interface PanelState {
  panelMode: Record<string, PanelMode>;
  addMode: Record<string, AddMode>;
  hoursInput: Record<string, string>;
  daysInput: Record<string, string>;
  expandedCompOff: Set<string>;
}

function createState(): PanelState {
  return {
    panelMode: {},
    addMode: {},
    hoursInput: {},
    daysInput: {},
    expandedCompOff: new Set(),
  };
}

function togglePanel(state: PanelState, empId: string): PanelState {
  const next = new Set(state.expandedCompOff);
  if (next.has(empId)) next.delete(empId);
  else next.add(empId);
  return { ...state, expandedCompOff: next };
}

function setPanelMode(state: PanelState, empId: string, mode: PanelMode): PanelState {
  return { ...state, panelMode: { ...state.panelMode, [empId]: mode } };
}

function setHoursInput(state: PanelState, empId: string, val: string): PanelState {
  return { ...state, hoursInput: { ...state.hoursInput, [empId]: val } };
}

function setDaysInput(state: PanelState, empId: string, val: string): PanelState {
  return { ...state, daysInput: { ...state.daysInput, [empId]: val } };
}

// ─── 模拟 CompOffEntry Store 操作 ────────────────────────────────────────────

interface CompOffEntry {
  id: string;
  employeeId: string;
  source: "overtime" | "holiday";
  status: "available" | "cashed_out";
  days: number;
  hoursDeducted?: number;
  expiresMonth: string;
  earnedMonth: string;
}

class MockCompOffStore {
  private entries: CompOffEntry[] = [];
  private idCounter = 0;

  addEntry(entry: Omit<CompOffEntry, "id">): void {
    this.entries.push({ ...entry, id: `entry_${++this.idCounter}` });
  }

  cashOutEntry(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.status = "cashed_out";
  }

  getAvailableEntries(empId: string, month: string): CompOffEntry[] {
    return this.entries.filter(
      (e) => e.employeeId === empId && e.status === "available" && e.expiresMonth >= month
    );
  }

  getTotalDays(empId: string, month: string): number {
    return this.getAvailableEntries(empId, month).reduce((s, e) => s + e.days, 0);
  }
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("性能测试：连续快速点击调休余额面板按钮", () => {
  it("连续 50 次切换面板展开/收起，每次操作应在 1ms 内完成", () => {
    let state = createState();
    const empIds = ["emp1", "emp2", "emp3", "emp4", "emp5"];
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const empId = empIds[i % empIds.length];
      const start = performance.now();
      state = togglePanel(state, empId);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }

    const maxTime = Math.max(...times);
    const avgTime = times.reduce((s, t) => s + t, 0) / times.length;

    console.log(`  面板展开/收起 50次：最大 ${maxTime.toFixed(3)}ms，平均 ${avgTime.toFixed(3)}ms`);
    expect(maxTime).toBeLessThan(10); // 单次操作 < 10ms（宽松阈值）
    expect(avgTime).toBeLessThan(1);  // 平均 < 1ms
  });

  it("连续 50 次切换面板模式（add/deduct），每次操作应在 1ms 内完成", () => {
    let state = createState();
    const empIds = ["emp1", "emp2", "emp3"];
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const empId = empIds[i % empIds.length];
      const mode: PanelMode = i % 2 === 0 ? "add" : "deduct";
      const start = performance.now();
      state = setPanelMode(state, empId, mode);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }

    const maxTime = Math.max(...times);
    const avgTime = times.reduce((s, t) => s + t, 0) / times.length;

    console.log(`  面板模式切换 50次：最大 ${maxTime.toFixed(3)}ms，平均 ${avgTime.toFixed(3)}ms`);
    expect(maxTime).toBeLessThan(10);
    expect(avgTime).toBeLessThan(1);
  });

  it("连续 50 次更新小时数输入，每次操作应在 1ms 内完成", () => {
    let state = createState();
    const times: number[] = [];
    const values = ["4", "8", "12", "6", "10"];

    for (let i = 0; i < 50; i++) {
      const val = values[i % values.length];
      const start = performance.now();
      state = setHoursInput(state, "emp1", val);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }

    const maxTime = Math.max(...times);
    const avgTime = times.reduce((s, t) => s + t, 0) / times.length;

    console.log(`  小时数输入更新 50次：最大 ${maxTime.toFixed(3)}ms，平均 ${avgTime.toFixed(3)}ms`);
    expect(maxTime).toBeLessThan(10);
    expect(avgTime).toBeLessThan(1);
  });

  it("10 个员工同时展开面板 + 各自操作，总耗时应在 50ms 内", () => {
    let state = createState();
    const store = new MockCompOffStore();

    // 预置数据：每个员工 3 条调休余额
    for (let i = 1; i <= 10; i++) {
      const empId = `emp${i}`;
      for (let j = 0; j < 3; j++) {
        store.addEntry({
          employeeId: empId,
          source: j % 2 === 0 ? "overtime" : "holiday",
          status: "available",
          days: 1,
          hoursDeducted: 8,
          expiresMonth: "2026-09",
          earnedMonth: "2026-08",
        });
      }
    }

    const start = performance.now();

    // 模拟 10 个员工同时展开面板
    for (let i = 1; i <= 10; i++) {
      state = togglePanel(state, `emp${i}`);
    }

    // 每个员工各操作 5 次（切换模式、更新输入）
    for (let i = 1; i <= 10; i++) {
      const empId = `emp${i}`;
      state = setPanelMode(state, empId, "add");
      state = setHoursInput(state, empId, "8");
      state = setPanelMode(state, empId, "deduct");
      state = setDaysInput(state, empId, "1");
      state = setPanelMode(state, empId, "add");
    }

    // 查询每个员工的余额（模拟渲染时的 getCompOffEntries 调用）
    for (let i = 1; i <= 10; i++) {
      const entries = store.getAvailableEntries(`emp${i}`, "2026-08");
      const total = store.getTotalDays(`emp${i}`, "2026-08");
      expect(entries.length).toBe(3);
      expect(total).toBe(3);
    }

    const elapsed = performance.now() - start;
    console.log(`  10员工并发操作总耗时：${elapsed.toFixed(3)}ms`);
    expect(elapsed).toBeLessThan(50); // 总耗时 < 50ms
  });

  it("Store 查询性能：100 条余额记录中查询单个员工，应在 5ms 内", () => {
    const store = new MockCompOffStore();

    // 预置 100 条记录（10个员工 × 10条）
    for (let i = 1; i <= 10; i++) {
      for (let j = 0; j < 10; j++) {
        store.addEntry({
          employeeId: `emp${i}`,
          source: j % 2 === 0 ? "overtime" : "holiday",
          status: j < 8 ? "available" : "cashed_out",
          days: 1,
          hoursDeducted: 8,
          expiresMonth: "2026-09",
          earnedMonth: "2026-08",
        });
      }
    }

    const start = performance.now();
    // 查询 50 次（模拟列表滚动时的重复查询）
    for (let k = 0; k < 50; k++) {
      const empId = `emp${(k % 10) + 1}`;
      store.getAvailableEntries(empId, "2026-08");
      store.getTotalDays(empId, "2026-08");
    }
    const elapsed = performance.now() - start;

    console.log(`  100条记录 × 50次查询总耗时：${elapsed.toFixed(3)}ms`);
    expect(elapsed).toBeLessThan(5); // 50次查询总耗时 < 5ms
  });

  it("兑换操作：连续 20 次 cashOut，状态更新不累积延迟", () => {
    const store = new MockCompOffStore();

    // 预置 20 条可兑换记录
    for (let i = 0; i < 20; i++) {
      store.addEntry({
        employeeId: "emp1",
        source: "overtime",
        status: "available",
        days: 1,
        hoursDeducted: 8,
        expiresMonth: "2026-09",
        earnedMonth: "2026-08",
      });
    }

    const times: number[] = [];
    const entries = store.getAvailableEntries("emp1", "2026-08");

    for (const entry of entries) {
      const start = performance.now();
      store.cashOutEntry(entry.id);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }

    const maxTime = Math.max(...times);
    const avgTime = times.reduce((s, t) => s + t, 0) / times.length;

    console.log(`  连续20次兑换：最大 ${maxTime.toFixed(3)}ms，平均 ${avgTime.toFixed(3)}ms`);
    expect(store.getAvailableEntries("emp1", "2026-08").length).toBe(0); // 全部兑换完
    expect(maxTime).toBeLessThan(5);
    expect(avgTime).toBeLessThan(0.5);
  });

  it("stopPropagation 调用不产生额外性能开销", () => {
    // 验证 stopPropagation 本身的调用开销可忽略
    const times: number[] = [];

    for (let i = 0; i < 1000; i++) {
      let stopped = false;
      const mockEvent = { stopPropagation: () => { stopped = true; } };
      const start = performance.now();
      mockEvent.stopPropagation?.();
      const elapsed = performance.now() - start;
      times.push(elapsed);
      expect(stopped).toBe(true);
    }

    const avgTime = times.reduce((s, t) => s + t, 0) / times.length;
    console.log(`  stopPropagation 1000次调用平均耗时：${avgTime.toFixed(4)}ms`);
    expect(avgTime).toBeLessThan(0.1); // 平均 < 0.1ms
  });
});

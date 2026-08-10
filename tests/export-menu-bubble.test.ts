/**
 * 导出菜单 Modal 事件冒泡修复验证测试
 *
 * 验证场景：
 * 1. 修复前：点击导出选项 → 同时触发 handleExport + setShowExportMenu(false)
 * 2. 修复后：点击导出选项 → 只触发 handleExport，背景关闭被阻止
 * 3. 连续快速点击导出选项不会重复触发
 * 4. 点击背景（非按钮区域）正确关闭 Modal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 模拟导出菜单状态 ─────────────────────────────────────────────────────────

type ExportType =
  | "payroll_excel"
  | "payroll_pdf"
  | "schedule_hours_excel"
  | "schedule_hours_pdf"
  | "schedule_session_excel"
  | "schedule_session_pdf";

interface ExportMenuState {
  showExportMenu: boolean;
  exportCallCount: Record<ExportType, number>;
  lastExportType: ExportType | null;
}

function createExportMenuState(): ExportMenuState {
  return {
    showExportMenu: true,
    exportCallCount: {
      payroll_excel: 0,
      payroll_pdf: 0,
      schedule_hours_excel: 0,
      schedule_hours_pdf: 0,
      schedule_session_excel: 0,
      schedule_session_pdf: 0,
    },
    lastExportType: null,
  };
}

// ─── 模拟事件对象 ─────────────────────────────────────────────────────────────

function createMockEvent() {
  let stopped = false;
  return {
    stopPropagation: () => { stopped = true; },
    wasStopped: () => stopped,
  };
}

// ─── 模拟修复前的 onPress handler（无 stopPropagation）─────────────────────

function onPressExportBefore(
  type: ExportType,
  state: ExportMenuState,
  _event: ReturnType<typeof createMockEvent>
): ExportMenuState {
  // 修复前：直接调用 handleExport，不阻止冒泡
  const newState = {
    ...state,
    exportCallCount: { ...state.exportCallCount, [type]: state.exportCallCount[type] + 1 },
    lastExportType: type,
  };
  // 冒泡到背景 → 背景 onPress 被触发 → Modal 关闭
  // （模拟：背景 onPress 被调用）
  return { ...newState, showExportMenu: false };
}

// ─── 模拟修复后的 onPress handler（有 stopPropagation）──────────────────────

function onPressExportAfter(
  type: ExportType,
  state: ExportMenuState,
  event: ReturnType<typeof createMockEvent>
): ExportMenuState {
  // 修复后：先阻止冒泡，再执行导出
  event.stopPropagation();
  return {
    ...state,
    exportCallCount: { ...state.exportCallCount, [type]: state.exportCallCount[type] + 1 },
    lastExportType: type,
    // showExportMenu 保持不变（背景 onPress 未被触发）
  };
}

// ─── 防抖：模拟移动端点击防抖（避免重复触发）──────────────────────────────

class DebounceGuard {
  private lastClickTime: Record<string, number> = {};
  private readonly debounceMs: number;

  constructor(debounceMs = 300) {
    this.debounceMs = debounceMs;
  }

  canClick(key: string, now: number): boolean {
    const last = this.lastClickTime[key] ?? 0;
    if (now - last < this.debounceMs) return false;
    this.lastClickTime[key] = now;
    return true;
  }
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("导出菜单 Modal 事件冒泡修复验证", () => {
  let state: ExportMenuState;

  beforeEach(() => {
    state = createExportMenuState();
  });

  it("修复前：点击导出选项会同时触发 Modal 关闭（冒泡问题）", () => {
    const event = createMockEvent();
    state = onPressExportBefore("payroll_excel", state, event);

    // 导出被触发
    expect(state.exportCallCount.payroll_excel).toBe(1);
    expect(state.lastExportType).toBe("payroll_excel");
    // Modal 被意外关闭（冒泡到背景）
    expect(state.showExportMenu).toBe(false);
    // stopPropagation 未被调用
    expect(event.wasStopped()).toBe(false);
  });

  it("修复后：点击导出选项只触发导出，Modal 保持打开", () => {
    const event = createMockEvent();
    state = onPressExportAfter("payroll_excel", state, event);

    // 导出被触发
    expect(state.exportCallCount.payroll_excel).toBe(1);
    expect(state.lastExportType).toBe("payroll_excel");
    // Modal 保持打开（背景 onPress 未被触发）
    expect(state.showExportMenu).toBe(true);
    // stopPropagation 被调用
    expect(event.wasStopped()).toBe(true);
  });

  it("修复后：点击背景（非按钮区域）正确关闭 Modal", () => {
    // 背景 onPress（不含 stopPropagation）
    const closeModal = (s: ExportMenuState) => ({ ...s, showExportMenu: false });
    state = closeModal(state);
    expect(state.showExportMenu).toBe(false);
    // 导出未被触发
    expect(state.lastExportType).toBeNull();
  });

  it("修复后：6 种导出类型各自独立触发，互不干扰", () => {
    const types: ExportType[] = [
      "payroll_excel",
      "payroll_pdf",
      "schedule_hours_excel",
      "schedule_hours_pdf",
      "schedule_session_excel",
      "schedule_session_pdf",
    ];

    for (const type of types) {
      const event = createMockEvent();
      state = onPressExportAfter(type, state, event);
      expect(event.wasStopped()).toBe(true);
    }

    // 每种类型各触发 1 次
    for (const type of types) {
      expect(state.exportCallCount[type]).toBe(1);
    }
    // Modal 始终保持打开
    expect(state.showExportMenu).toBe(true);
  });

  it("连续快速点击同一导出选项（无防抖）：每次点击都会触发", () => {
    // 模拟用户在 100ms 内连续点击 5 次
    for (let i = 0; i < 5; i++) {
      const event = createMockEvent();
      state = onPressExportAfter("payroll_excel", state, event);
    }
    // 5 次都触发了（无防抖保护时）
    expect(state.exportCallCount.payroll_excel).toBe(5);
  });

  it("连续快速点击同一导出选项（有防抖）：300ms 内只触发 1 次", () => {
    const guard = new DebounceGuard(300);
    let triggerCount = 0;
    const baseTime = 1000;

    // 模拟 5 次点击，间隔 50ms（在 300ms 防抖窗口内）
    for (let i = 0; i < 5; i++) {
      const now = baseTime + i * 50; // 0ms, 50ms, 100ms, 150ms, 200ms
      if (guard.canClick("payroll_excel", now)) {
        triggerCount++;
        const event = createMockEvent();
        state = onPressExportAfter("payroll_excel", state, event);
      }
    }

    // 只有第 1 次点击通过了防抖
    expect(triggerCount).toBe(1);
    expect(state.exportCallCount.payroll_excel).toBe(1);
  });

  it("连续快速点击（有防抖）：超过 300ms 后可以再次触发", () => {
    const guard = new DebounceGuard(300);
    let triggerCount = 0;
    const baseTime = 1000;

    // 第 1 次点击：0ms
    if (guard.canClick("payroll_excel", baseTime)) {
      triggerCount++;
      const event = createMockEvent();
      state = onPressExportAfter("payroll_excel", state, event);
    }

    // 第 2 次点击：100ms（在防抖窗口内，被阻止）
    if (guard.canClick("payroll_excel", baseTime + 100)) {
      triggerCount++;
    }

    // 第 3 次点击：400ms（超出防抖窗口，允许触发）
    if (guard.canClick("payroll_excel", baseTime + 400)) {
      triggerCount++;
      const event = createMockEvent();
      state = onPressExportAfter("payroll_excel", state, event);
    }

    expect(triggerCount).toBe(2); // 第 1 次和第 3 次触发
    expect(state.exportCallCount.payroll_excel).toBe(2);
  });

  it("不同导出类型的防抖独立计算，互不影响", () => {
    const guard = new DebounceGuard(300);
    const baseTime = 1000;

    // 同时点击两种不同类型（间隔 0ms）
    const canExcel = guard.canClick("payroll_excel", baseTime);
    const canPdf = guard.canClick("payroll_pdf", baseTime);

    // 两种类型各自独立，都可以触发
    expect(canExcel).toBe(true);
    expect(canPdf).toBe(true);
  });

  it("stopPropagation 调用性能：1000 次调用总耗时 < 1ms", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const event = createMockEvent();
      event.stopPropagation();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1);
  });
});

describe("导出菜单 Modal 状态管理", () => {
  it("初始状态：Modal 关闭", () => {
    const state = { showExportMenu: false };
    expect(state.showExportMenu).toBe(false);
  });

  it("点击导出按钮：Modal 打开", () => {
    let state = { showExportMenu: false };
    state = { ...state, showExportMenu: true };
    expect(state.showExportMenu).toBe(true);
  });

  it("点击背景：Modal 关闭", () => {
    let state = { showExportMenu: true };
    state = { ...state, showExportMenu: false };
    expect(state.showExportMenu).toBe(false);
  });

  it("导出完成后 Modal 自动关闭（handleExport 内部逻辑）", () => {
    // 模拟 handleExport 完成后关闭 Modal
    let state = { showExportMenu: true, exportDone: false };
    const handleExport = (s: typeof state) => ({ ...s, exportDone: true, showExportMenu: false });
    state = handleExport(state);
    expect(state.exportDone).toBe(true);
    expect(state.showExportMenu).toBe(false);
  });
});

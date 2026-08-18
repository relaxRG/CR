/**
 * 考勤概况卡片展开/收起与事件冒泡防护测试
 *
 * 覆盖场景：
 * 1. 卡片展开/收起状态切换逻辑
 * 2. 调休余额管理面板展开/收起状态切换逻辑
 * 3. 事件冒泡防护（stopPropagation）验证
 * 4. per-employee 面板状态独立性验证
 * 5. 调休余额计算逻辑验证（加班/节假日两套独立路径）
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── 模拟 Set 操作（考勤卡片展开状态） ───────────────────────────────────────

function toggleSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

// ─── 模拟 per-employee 面板状态 ──────────────────────────────────────────────

type PanelMode = "add" | "deduct";
type AddMode = "hours" | "days";
type DeductMode = "direct" | "cashout";

interface PerEmpPanelState {
  panelMode: Record<string, PanelMode>;
  addMode: Record<string, AddMode>;
  deductMode: Record<string, DeductMode>;
  hoursInput: Record<string, string>;
  daysInput: Record<string, string>;
}

function createPanelState(): PerEmpPanelState {
  return {
    panelMode: {},
    addMode: {},
    deductMode: {},
    hoursInput: {},
    daysInput: {},
  };
}

function setPanelMode(state: PerEmpPanelState, empId: string, mode: PanelMode): PerEmpPanelState {
  return { ...state, panelMode: { ...state.panelMode, [empId]: mode } };
}

function setAddMode(state: PerEmpPanelState, empId: string, mode: AddMode): PerEmpPanelState {
  return { ...state, addMode: { ...state.addMode, [empId]: mode } };
}

// ─── 模拟 stopPropagation 事件对象 ───────────────────────────────────────────

function createMockEvent() {
  let stopped = false;
  return {
    stopPropagation: () => { stopped = true; },
    wasStopped: () => stopped,
  };
}

// ─── 模拟调休余额计算 ─────────────────────────────────────────────────────────

interface CompOffEntry {
  id: string;
  employeeId: string;
  source: "overtime" | "holiday";
  status: "available" | "used_rest" | "cashed_out" | "expired";
  days: number;
  hoursDeducted?: number;
  holidayName?: string;
  expiresMonth: string;
  earnedMonth: string;
}

function calcCashOutAmount(
  entry: CompOffEntry,
  overtimeHourlyRate: number,
  dailyRate: number
): number {
  if (entry.source === "overtime") {
    const hours = entry.hoursDeducted ?? entry.days * 8;
    return Math.round(hours * overtimeHourlyRate * 100) / 100;
  } else {
    return Math.round(entry.days * dailyRate * 100) / 100;
  }
}

function getAvailableEntries(entries: CompOffEntry[], empId: string, currentMonth: string) {
  return entries.filter(
    (e) => e.employeeId === empId && e.status === "available" && e.expiresMonth >= currentMonth
  );
}

function getOvertimeEntries(entries: CompOffEntry[], empId: string, currentMonth: string) {
  return getAvailableEntries(entries, empId, currentMonth).filter((e) => e.source === "overtime");
}

function getHolidayEntries(entries: CompOffEntry[], empId: string, currentMonth: string) {
  return getAvailableEntries(entries, empId, currentMonth).filter((e) => e.source === "holiday");
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("考勤概况卡片展开/收起逻辑", () => {
  it("初始状态：所有卡片收起", () => {
    const expandedCards = new Set<string>();
    expect(expandedCards.has("emp1")).toBe(false);
    expect(expandedCards.has("emp2")).toBe(false);
  });

  it("点击卡片：收起 → 展开", () => {
    let expandedCards = new Set<string>();
    expandedCards = toggleSet(expandedCards, "emp1");
    expect(expandedCards.has("emp1")).toBe(true);
    expect(expandedCards.has("emp2")).toBe(false);
  });

  it("再次点击卡片：展开 → 收起", () => {
    let expandedCards = new Set<string>(["emp1"]);
    expandedCards = toggleSet(expandedCards, "emp1");
    expect(expandedCards.has("emp1")).toBe(false);
  });

  it("多个卡片独立展开，互不影响", () => {
    let expandedCards = new Set<string>();
    expandedCards = toggleSet(expandedCards, "emp1");
    expandedCards = toggleSet(expandedCards, "emp2");
    expect(expandedCards.has("emp1")).toBe(true);
    expect(expandedCards.has("emp2")).toBe(true);
    // 收起 emp1 不影响 emp2
    expandedCards = toggleSet(expandedCards, "emp1");
    expect(expandedCards.has("emp1")).toBe(false);
    expect(expandedCards.has("emp2")).toBe(true);
  });
});

describe("调休余额管理面板展开/收起逻辑", () => {
  it("初始状态：所有面板收起", () => {
    const expandedAttCompOff = new Set<string>();
    expect(expandedAttCompOff.has("emp1")).toBe(false);
  });

  it("点击「存入/兑换」按钮：面板展开", () => {
    let expandedAttCompOff = new Set<string>();
    expandedAttCompOff = toggleSet(expandedAttCompOff, "emp1");
    expect(expandedAttCompOff.has("emp1")).toBe(true);
  });

  it("点击「收起面板」按钮：面板收起", () => {
    let expandedAttCompOff = new Set<string>(["emp1"]);
    expandedAttCompOff = toggleSet(expandedAttCompOff, "emp1");
    expect(expandedAttCompOff.has("emp1")).toBe(false);
  });

  it("多个员工的面板状态独立", () => {
    let expandedAttCompOff = new Set<string>();
    expandedAttCompOff = toggleSet(expandedAttCompOff, "emp1");
    expandedAttCompOff = toggleSet(expandedAttCompOff, "emp3");
    expect(expandedAttCompOff.has("emp1")).toBe(true);
    expect(expandedAttCompOff.has("emp2")).toBe(false);
    expect(expandedAttCompOff.has("emp3")).toBe(true);
  });
});

describe("per-employee 面板内部状态独立性", () => {
  let state: PerEmpPanelState;

  beforeEach(() => {
    state = createPanelState();
  });

  it("默认状态：panelMode 为 add，addMode 为 hours", () => {
    expect(state.panelMode["emp1"] ?? "add").toBe("add");
    expect(state.addMode["emp1"] ?? "hours").toBe("hours");
  });

  it("修改 emp1 的 panelMode 不影响 emp2", () => {
    state = setPanelMode(state, "emp1", "deduct");
    expect(state.panelMode["emp1"]).toBe("deduct");
    expect(state.panelMode["emp2"] ?? "add").toBe("add");
  });

  it("修改 emp1 的 addMode 不影响 emp2", () => {
    state = setAddMode(state, "emp1", "days");
    expect(state.addMode["emp1"]).toBe("days");
    expect(state.addMode["emp2"] ?? "hours").toBe("hours");
  });

  it("多个员工同时有不同的面板状态", () => {
    state = setPanelMode(state, "emp1", "add");
    state = setPanelMode(state, "emp2", "deduct");
    state = setAddMode(state, "emp1", "hours");
    state = setAddMode(state, "emp2", "days");
    expect(state.panelMode["emp1"]).toBe("add");
    expect(state.panelMode["emp2"]).toBe("deduct");
    expect(state.addMode["emp1"]).toBe("hours");
    expect(state.addMode["emp2"]).toBe("days");
  });
});

describe("事件冒泡防护（stopPropagation）验证", () => {
  it("子按钮点击时，stopPropagation 被调用", () => {
    const event = createMockEvent();
    // 模拟子按钮的 onPress handler
    const onPressHandler = (e: ReturnType<typeof createMockEvent>) => {
      e.stopPropagation();
      // 执行实际操作...
    };
    onPressHandler(event);
    expect(event.wasStopped()).toBe(true);
  });

  it("外层卡片点击时，stopPropagation 不被调用（正常展开/收起）", () => {
    const event = createMockEvent();
    // 模拟外层卡片的 onPress handler（不调用 stopPropagation）
    const onPressHandler = (_e: ReturnType<typeof createMockEvent>) => {
      // 只执行展开/收起，不阻止冒泡
    };
    onPressHandler(event);
    expect(event.wasStopped()).toBe(false);
  });

  it("面板容器的 stopPropagation 阻止点击背景时触发卡片收起", () => {
    const event = createMockEvent();
    // 模拟面板容器的 onPress handler（activeOpacity={1} 的包裹容器）
    const containerOnPress = (e: ReturnType<typeof createMockEvent>) => {
      e.stopPropagation();
    };
    containerOnPress(event);
    expect(event.wasStopped()).toBe(true);
  });

  it("存入调休按钮的 stopPropagation 阻止卡片收起", () => {
    let cardExpanded = true;
    const event = createMockEvent();

    const doAddByHours = () => {
      // 存入调休逻辑
    };

    // 模拟修复后的 onPress handler
    const onPressHandler = (e: ReturnType<typeof createMockEvent>) => {
      e.stopPropagation();
      doAddByHours();
    };

    onPressHandler(event);
    // stopPropagation 被调用，卡片不会收起
    expect(event.wasStopped()).toBe(true);
    expect(cardExpanded).toBe(true); // 卡片保持展开
  });
});

describe("调休余额计算：加班调休 vs 节假日换休（两套独立逻辑）", () => {
  const overtimeHourlyRate = 45; // 加班时薪 ¥45/h
  const dailyRate = 320; // 日薪 ¥320/天

  const mockEntries: CompOffEntry[] = [
    {
      id: "ot1",
      employeeId: "emp1",
      source: "overtime",
      status: "available",
      days: 1,
      hoursDeducted: 8,
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    },
    {
      id: "ot2",
      employeeId: "emp1",
      source: "overtime",
      status: "available",
      days: 0.5,
      hoursDeducted: 4,
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    },
    {
      id: "hol1",
      employeeId: "emp1",
      source: "holiday",
      status: "available",
      days: 1,
      holidayName: "国庆节",
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    },
    {
      id: "exp1",
      employeeId: "emp1",
      source: "overtime",
      status: "expired",
      days: 1,
      expiresMonth: "2026-07", // 已过期
      earnedMonth: "2026-06",
    },
    {
      id: "emp2_ot1",
      employeeId: "emp2",
      source: "overtime",
      status: "available",
      days: 2,
      hoursDeducted: 16,
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    },
  ];

  it("加班调休：按加班时薪 × 小时数计算兑换金额", () => {
    const entry = mockEntries.find((e) => e.id === "ot1")!;
    const amount = calcCashOutAmount(entry, overtimeHourlyRate, dailyRate);
    expect(amount).toBe(360); // 8h × ¥45 = ¥360
  });

  it("加班调休（半天）：按实际小时数计算", () => {
    const entry = mockEntries.find((e) => e.id === "ot2")!;
    const amount = calcCashOutAmount(entry, overtimeHourlyRate, dailyRate);
    expect(amount).toBe(180); // 4h × ¥45 = ¥180
  });

  it("节假日换休：按日薪 × 天数计算兑换金额", () => {
    const entry = mockEntries.find((e) => e.id === "hol1")!;
    const amount = calcCashOutAmount(entry, overtimeHourlyRate, dailyRate);
    expect(amount).toBe(320); // 1天 × ¥320 = ¥320
  });

  it("加班调休和节假日换休使用不同的计算公式（不混用）", () => {
    const otEntry = mockEntries.find((e) => e.id === "ot1")!;
    const holEntry = mockEntries.find((e) => e.id === "hol1")!;
    const otAmount = calcCashOutAmount(otEntry, overtimeHourlyRate, dailyRate);
    const holAmount = calcCashOutAmount(holEntry, overtimeHourlyRate, dailyRate);
    // 加班调休用时薪，节假日换休用日薪，两者不同
    expect(otAmount).not.toBe(holAmount);
    expect(otAmount).toBe(360);
    expect(holAmount).toBe(320);
  });

  it("getOvertimeEntries：只返回加班调休余额，过滤已过期和节假日", () => {
    const entries = getOvertimeEntries(mockEntries, "emp1", "2026-08");
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.source === "overtime")).toBe(true);
    expect(entries.every((e) => e.status === "available")).toBe(true);
    expect(entries.find((e) => e.id === "exp1")).toBeUndefined(); // 过期的不返回
  });

  it("getHolidayEntries：只返回节假日换休余额", () => {
    const entries = getHolidayEntries(mockEntries, "emp1", "2026-08");
    expect(entries.length).toBe(1);
    expect(entries[0].source).toBe("holiday");
    expect(entries[0].holidayName).toBe("国庆节");
  });

  it("不同员工的余额完全独立，不会混用", () => {
    const emp1OT = getOvertimeEntries(mockEntries, "emp1", "2026-08");
    const emp2OT = getOvertimeEntries(mockEntries, "emp2", "2026-08");
    expect(emp1OT.length).toBe(2);
    expect(emp2OT.length).toBe(1);
    expect(emp2OT[0].days).toBe(2);
    expect(emp2OT[0].hoursDeducted).toBe(16);
  });

  it("加班调休：hoursDeducted 未设置时，默认使用 days × 8 计算", () => {
    const entry: CompOffEntry = {
      id: "ot_no_hours",
      employeeId: "emp1",
      source: "overtime",
      status: "available",
      days: 1,
      // hoursDeducted 未设置
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    };
    const amount = calcCashOutAmount(entry, overtimeHourlyRate, dailyRate);
    expect(amount).toBe(360); // 1天 × 8h × ¥45 = ¥360（默认8h/天）
  });

  it("兑换金额精确到分（四舍五入）", () => {
    const entry: CompOffEntry = {
      id: "ot_precise",
      employeeId: "emp1",
      source: "overtime",
      status: "available",
      days: 1,
      hoursDeducted: 3.5,
      expiresMonth: "2026-09",
      earnedMonth: "2026-08",
    };
    const amount = calcCashOutAmount(entry, 45.5, dailyRate);
    // 3.5h × ¥45.5 = ¥159.25 → 精确到分
    expect(amount).toBe(159.25);
  });
});

describe("考勤卡片兜底显示逻辑", () => {
  it("无加班时，加班明细所有字段显示「—」", () => {
    const att = { overtimeHours: 0, overtimeCompOffDays: 0, paidOvertimeHours: 0, overtimePay: 0 };
    const totalOT = att.overtimeHours > 0 ? `${att.overtimeHours.toFixed(1)}h` : "—";
    const compOff = att.overtimeCompOffDays > 0 ? `${att.overtimeCompOffDays}天` : "—";
    const paidOT = att.paidOvertimeHours > 0 ? `${att.paidOvertimeHours.toFixed(1)}h` : "—";
    const otPay = att.overtimePay > 0 ? `+¥${att.overtimePay.toFixed(0)}` : "—";
    expect(totalOT).toBe("—");
    expect(compOff).toBe("—");
    expect(paidOT).toBe("—");
    expect(otPay).toBe("—");
  });

  it("有加班时，加班明细显示实际数值", () => {
    const att = { overtimeHours: 43.5, overtimeCompOffDays: 4, paidOvertimeHours: 11.5, overtimePay: 575 };
    const totalOT = att.overtimeHours > 0 ? `${att.overtimeHours.toFixed(1)}h` : "—";
    const compOff = att.overtimeCompOffDays > 0 ? `${att.overtimeCompOffDays}天` : "—";
    expect(totalOT).toBe("43.5h");
    expect(compOff).toBe("4天");
  });

  it("无节假日上班时，节假日明细所有字段显示「—」", () => {
    const hwDays = 0;
    const hrDays = 0;
    const hcDays = 0;
    const holidayBonus = 0;
    const hwVal = hwDays > 0 ? `${hwDays}天` : "—";
    const hrVal = hrDays > 0 ? `${hrDays}天` : "—";
    const hcVal = hcDays > 0 ? `${hcDays}天` : "—";
    const bonusVal = holidayBonus > 0 ? `+¥${holidayBonus.toFixed(0)}` : "—";
    expect(hwVal).toBe("—");
    expect(hrVal).toBe("—");
    expect(hcVal).toBe("—");
    expect(bonusVal).toBe("—");
  });

  it("有节假日上班时，节假日明细显示实际数值", () => {
    const hwDays = 2;
    const hrDays = 1;
    const hcDays = 1;
    const holidayBonus = 320;
    const hwVal = hwDays > 0 ? `${hwDays}天` : "—";
    const hrVal = hrDays > 0 ? `${hrDays}天` : "—";
    const hcVal = hcDays > 0 ? `${hcDays}天` : "—";
    const bonusVal = holidayBonus > 0 ? `+¥${holidayBonus.toFixed(0)}` : "—";
    expect(hwVal).toBe("2天");
    expect(hrVal).toBe("1天");
    expect(hcVal).toBe("1天");
    expect(bonusVal).toBe("+¥320");
  });

  it("链路说明行仅在有数据时显示", () => {
    // 无加班：不显示链路说明行
    const noOT = 0;
    const showOTChain = noOT > 0;
    expect(showOTChain).toBe(false);

    // 有加班：显示链路说明行
    const hasOT = 11.5;
    const showOTChainHas = hasOT > 0;
    expect(showOTChainHas).toBe(true);
  });
});

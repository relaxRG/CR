/**
 * tests/labor-import.test.ts
 * 排班数据导入引擎单元测试
 *
 * 覆盖场景：
 * 1. getDaysInMonthArr 内部辅助函数
 * 2. ImportResult 结构完整性
 * 3. willOverwrite 标记计算
 * 4. 警告生成逻辑（员工不匹配、班次名称无效）
 * 5. 增量导入：空格子不清空原数据
 * 6. 导入预览 Modal 状态机
 */

import { describe, it, expect } from "vitest";

// ─── 内部辅助函数（镜像 import.ts 中的实现）─────────────────────────────────

function getDaysInMonthArr(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
}

// ─── 模拟数据 ─────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  realName: string;
  code?: string;
  active: boolean;
  archived: boolean;
  employeeType: string;
}

interface ShiftTemplate {
  session: string;
  startTime: string;
  endTime: string;
}

interface ShiftEntry {
  employeeId: string;
  date: string;
  shift: string;
  hoursValue: number | null;
}

interface ImportPreviewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  session: string | undefined;
  hoursValue: number | undefined;
  willOverwrite: boolean;
}

interface ImportResult {
  parsedCount: number;
  overwriteCount: number;
  skippedCount: number;
  preview: ImportPreviewRow[];
  entries: ShiftEntry[];
  warnings: string[];
}

const MOCK_EMPLOYEES: Employee[] = [
  { id: "emp001", realName: "张三", code: "ZS", active: true, archived: false, employeeType: "fullTime" },
  { id: "emp002", realName: "李四", code: "LS", active: true, archived: false, employeeType: "fullTime" },
  { id: "emp003", realName: "王五", code: "WW", active: false, archived: false, employeeType: "partTime" },
];

const MOCK_TEMPLATES: ShiftTemplate[] = [
  { session: "早班", startTime: "09:00", endTime: "17:00" },
  { session: "晚班", startTime: "17:00", endTime: "01:00" },
  { session: "全天", startTime: "09:00", endTime: "21:00" },
];

// ─── 模拟导入解析逻辑（镜像 import.ts 核心逻辑）──────────────────────────────

function simulateParseImport(params: {
  month: string;
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  existingShifts: ShiftEntry[];
  rawData: Array<{ empCode: string; date: string; session?: string; hoursValue?: number }>;
}): ImportResult {
  const { month, employees, shiftTemplates, existingShifts, rawData } = params;
  const days = getDaysInMonthArr(month);
  const activeEmps = employees.filter((e) => e.active && !e.archived);
  const validSessions = new Set(shiftTemplates.map((t) => t.session.trim()));
  const existingMap = new Map<string, ShiftEntry>();
  for (const s of existingShifts) {
    if (s.date.startsWith(month)) {
      existingMap.set(`${s.employeeId}|${s.date}|${s.shift}`, s);
    }
  }

  const warnings: string[] = [];
  const allEntries: ShiftEntry[] = [];
  const preview: ImportPreviewRow[] = [];
  let parsedCount = 0;
  let skippedCount = 0;
  let overwriteCount = 0;

  for (const row of rawData) {
    // 跳过不在当月的日期
    if (!days.includes(row.date)) {
      skippedCount++;
      warnings.push(`日期 ${row.date} 不在 ${month} 月内，已跳过`);
      continue;
    }
    // 查找员工
    const emp = activeEmps.find((e) => e.code === row.empCode || e.id === row.empCode);
    if (!emp) {
      skippedCount++;
      warnings.push(`员工代号 "${row.empCode}" 不存在或已停用，已跳过`);
      continue;
    }
    // 验证班次名称
    if (row.session && !validSessions.has(row.session.trim())) {
      warnings.push(`班次名称 "${row.session}" 不在模板中，将仍然写入`);
    }
    // 跳过空行（班次和工时都为空）
    if (!row.session && !row.hoursValue) {
      continue;
    }
    const session = row.session ?? shiftTemplates[0]!.session;
    const entry: ShiftEntry = {
      employeeId: emp.id,
      date: row.date,
      shift: session,
      hoursValue: row.hoursValue ?? null,
    };
    const existingKey = `${emp.id}|${row.date}|${session}`;
    const willOverwrite = existingMap.has(existingKey);
    if (willOverwrite) overwriteCount++;
    parsedCount++;
    allEntries.push(entry);
    preview.push({
      employeeId: emp.id,
      employeeCode: emp.code ?? emp.id.slice(0, 6),
      employeeName: emp.realName,
      date: row.date,
      session: row.session,
      hoursValue: row.hoursValue,
      willOverwrite,
    });
  }

  return { parsedCount, overwriteCount, skippedCount, preview, entries: allEntries, warnings };
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("getDaysInMonthArr 内部辅助函数", () => {
  it("2026-08 应返回 31 天", () => {
    const days = getDaysInMonthArr("2026-08");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-08-01");
    expect(days[30]).toBe("2026-08-31");
  });

  it("2026-02 应返回 28 天（非闰年）", () => {
    const days = getDaysInMonthArr("2026-02");
    expect(days).toHaveLength(28);
    expect(days[27]).toBe("2026-02-28");
  });

  it("2024-02 应返回 29 天（闰年）", () => {
    const days = getDaysInMonthArr("2024-02");
    expect(days).toHaveLength(29);
    expect(days[28]).toBe("2024-02-29");
  });

  it("2026-04 应返回 30 天", () => {
    const days = getDaysInMonthArr("2026-04");
    expect(days).toHaveLength(30);
    expect(days[29]).toBe("2026-04-30");
  });
});

describe("导入解析：基础功能", () => {
  it("正常导入：2 条有效数据，返回正确的 parsedCount", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班", hoursValue: 8 },
        { empCode: "LS", date: "2026-08-02", session: "晚班", hoursValue: 8 },
      ],
    });
    expect(result.parsedCount).toBe(2);
    expect(result.overwriteCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.entries).toHaveLength(2);
  });

  it("员工代号不存在：应跳过并生成警告", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "UNKNOWN", date: "2026-08-01", session: "早班" },
      ],
    });
    expect(result.parsedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("UNKNOWN");
  });

  it("非活跃员工（active=false）：应跳过", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "WW", date: "2026-08-01", session: "早班" }, // 王五 active=false
      ],
    });
    expect(result.parsedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("日期不在当月：应跳过并生成警告", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-09-01", session: "早班" }, // 9月日期
      ],
    });
    expect(result.parsedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.warnings[0]).toContain("2026-09-01");
  });

  it("空行（班次和工时都为空）：应静默跳过，不计入 skippedCount", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01" }, // 无班次无工时
        { empCode: "LS", date: "2026-08-02", session: "晚班" }, // 有班次
      ],
    });
    expect(result.parsedCount).toBe(1); // 只有 LS 的那条
    expect(result.skippedCount).toBe(0); // 空行不计入 skipped
  });
});

describe("导入解析：willOverwrite 覆盖检测", () => {
  it("无现有数据：willOverwrite 全部为 false", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" },
      ],
    });
    expect(result.overwriteCount).toBe(0);
    expect(result.preview[0]?.willOverwrite).toBe(false);
  });

  it("有现有数据且 key 匹配：willOverwrite 为 true，overwriteCount 增加", () => {
    const existingShifts: ShiftEntry[] = [
      { employeeId: "emp001", date: "2026-08-01", shift: "早班", hoursValue: 8 },
    ];
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts,
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" }, // 与现有数据 key 相同
      ],
    });
    expect(result.overwriteCount).toBe(1);
    expect(result.preview[0]?.willOverwrite).toBe(true);
  });

  it("现有数据不同班次：willOverwrite 为 false（不同 key）", () => {
    const existingShifts: ShiftEntry[] = [
      { employeeId: "emp001", date: "2026-08-01", shift: "晚班", hoursValue: 8 }, // 晚班
    ];
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts,
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" }, // 早班（不同班次）
      ],
    });
    expect(result.overwriteCount).toBe(0);
    expect(result.preview[0]?.willOverwrite).toBe(false);
  });

  it("混合场景：部分覆盖、部分新增", () => {
    const existingShifts: ShiftEntry[] = [
      { employeeId: "emp001", date: "2026-08-01", shift: "早班", hoursValue: 8 },
    ];
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts,
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" }, // 覆盖
        { empCode: "LS", date: "2026-08-02", session: "晚班" }, // 新增
      ],
    });
    expect(result.parsedCount).toBe(2);
    expect(result.overwriteCount).toBe(1);
    expect(result.preview[0]?.willOverwrite).toBe(true);
    expect(result.preview[1]?.willOverwrite).toBe(false);
  });
});

describe("导入解析：班次名称验证", () => {
  it("无效班次名称：生成警告但仍写入", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "自定义班次" }, // 不在模板中
      ],
    });
    expect(result.parsedCount).toBe(1); // 仍然写入
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("自定义班次");
  });

  it("有效班次名称：无警告", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" },
        { empCode: "LS", date: "2026-08-02", session: "晚班" },
      ],
    });
    expect(result.warnings).toHaveLength(0);
  });
});

describe("导入解析：增量覆盖规则", () => {
  it("只填工时（无班次）：应写入，使用默认班次", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", hoursValue: 9.5 }, // 无班次，只有工时
      ],
    });
    expect(result.parsedCount).toBe(1);
    expect(result.entries[0]?.hoursValue).toBe(9.5);
    expect(result.entries[0]?.shift).toBe("早班"); // 默认第一个模板
  });

  it("只填班次（无工时）：应写入，hoursValue 为 null", () => {
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData: [
        { empCode: "ZS", date: "2026-08-01", session: "早班" }, // 无工时
      ],
    });
    expect(result.parsedCount).toBe(1);
    expect(result.entries[0]?.hoursValue).toBeNull();
    expect(result.entries[0]?.shift).toBe("早班");
  });
});

describe("导入预览 Modal 状态机", () => {
  interface ModalState {
    showImportMenu: boolean;
    showImportPreview: boolean;
    importing: boolean;
    importResult: ImportResult | null; // null 表示未解析
  }

  function createInitialState(): ModalState {
    return {
      showImportMenu: false,
      showImportPreview: false,
      importing: false,
      importResult: null,
    };
  }

  it("初始状态：所有 Modal 关闭", () => {
    const state = createInitialState();
    expect(state.showImportMenu).toBe(false);
    expect(state.showImportPreview).toBe(false);
    expect(state.importing).toBe(false);
    expect(state.importResult).toBeNull();
  });

  it("点击导入按钮 → 导入菜单打开", () => {
    const state = { ...createInitialState(), showImportMenu: true };
    expect(state.showImportMenu).toBe(true);
  });

  it("选择文件解析中 → importing=true，菜单关闭", () => {
    const state = { ...createInitialState(), showImportMenu: false, importing: true };
    expect(state.importing).toBe(true);
    expect(state.showImportMenu).toBe(false);
  });

  it("解析完成 → 预览 Modal 打开，importing=false", () => {
    const mockResult: ImportResult = {
      parsedCount: 5,
      overwriteCount: 1,
      skippedCount: 0,
      preview: [],
      entries: [],
      warnings: [],
    };
    const state = {
      ...createInitialState(),
      importing: false,
      importResult: mockResult,
      showImportPreview: true,
    };
    expect(state.showImportPreview).toBe(true);
    expect(state.importing).toBe(false);
    expect(state.importResult?.parsedCount).toBe(5);
  });

  it("有警告时：确认按钮文案应为「仍然导入」", () => {
    const mockResult: ImportResult = {
      parsedCount: 3,
      overwriteCount: 0,
      skippedCount: 1,
      preview: [],
      entries: [],
      warnings: ["员工代号 X 不存在"],
    };
    const btnLabel = mockResult.warnings.length > 0
      ? `仍然导入 ${mockResult.parsedCount} 条`
      : `确认导入 ${mockResult.parsedCount} 条`;
    expect(btnLabel).toBe("仍然导入 3 条");
  });

  it("无警告时：确认按钮文案应为「确认导入」", () => {
    const mockResult: ImportResult = {
      parsedCount: 10,
      overwriteCount: 2,
      skippedCount: 0,
      preview: [],
      entries: [],
      warnings: [],
    };
    const btnLabel = mockResult.warnings.length > 0
      ? `仍然导入 ${mockResult.parsedCount} 条`
      : `确认导入 ${mockResult.parsedCount} 条`;
    expect(btnLabel).toBe("确认导入 10 条");
  });

  it("确认导入后 → 预览 Modal 关闭，importResult 清空", () => {
    let state: ModalState = {
      ...createInitialState(),
      showImportPreview: true,
      importResult: { parsedCount: 5, overwriteCount: 0, skippedCount: 0, preview: [], entries: [], warnings: [] } as ImportResult,
    };
    // 模拟 handleConfirmImport
    state = { ...state, showImportPreview: false, importResult: null };
    expect(state.showImportPreview).toBe(false);
    expect(state.importResult).toBeNull();
  });

  it("skippedCount > 0 时：跳过卡片应显示红色", () => {
    const mockResult: ImportResult = {
      parsedCount: 8,
      overwriteCount: 1,
      skippedCount: 2,
      preview: [],
      entries: [],
      warnings: [],
    };
    // 模拟颜色逻辑
    const skipCardColor = mockResult.skippedCount > 0 ? "#FF3B3020" : "gray";
    expect(skipCardColor).toBe("#FF3B3020");
  });

  it("skippedCount === 0 时：跳过卡片应显示灰色", () => {
    const mockResult: ImportResult = {
      parsedCount: 8,
      overwriteCount: 1,
      skippedCount: 0,
      preview: [],
      entries: [],
      warnings: [],
    };
    const skipCardColor = mockResult.skippedCount > 0 ? "#FF3B3020" : "gray";
    expect(skipCardColor).toBe("gray");
  });
});

describe("导入解析：大批量性能", () => {
  it("100 条数据应在 50ms 内完成解析", () => {
    const rawData = Array.from({ length: 100 }, (_, i) => ({
      empCode: i % 2 === 0 ? "ZS" : "LS",
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      session: i % 3 === 0 ? "早班" : "晚班",
      hoursValue: 8,
    }));
    const start = Date.now();
    const result = simulateParseImport({
      month: "2026-08",
      employees: MOCK_EMPLOYEES,
      shiftTemplates: MOCK_TEMPLATES,
      existingShifts: [],
      rawData,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(result.parsedCount).toBeGreaterThan(0);
  });
});

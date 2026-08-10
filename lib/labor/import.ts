/**
 * lib/labor/import.ts
 * 排班数据导入引擎
 *
 * 功能：
 *   1. buildImportTemplate  — 生成排班导入模版 Excel（2 Sheet：班次模版 + 工时模版）
 *   2. parseImportFile      — 解析用户上传的 Excel 文件，返回预览数据
 *   3. applyImportData      — 将解析结果增量写入 ShiftStore（空格子不清空原数据）
 *
 * 模版格式：
 *   - 第一行：表头（员工代号 | 姓名 | 01 | 02 | ... | 31）
 *   - 第二行：示例行（灰色背景，仅供参考）
 *   - 第三行起：每行一名员工，填入对应日期的班次名称或工时数字
 *
 * 导入规则：
 *   - 只更新填了数据的格子，空格子不影响原有数据
 *   - 班次名称必须与班次模板中的 session 名称完全匹配（不区分全半角空格）
 *   - 工时为数字（支持小数），0 或负数视为空
 *   - 同一格子同时有班次和工时时，两者合并为一条 ShiftEntry
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";

import type { Employee, ShiftEntry, ShiftTemplate } from "./types";

// 内部辅助：生成当月所有日期字符串数组（"2026-08-01" ... "2026-08-31"）
function getDaysInMonthArr(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

export interface ImportPreviewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  /** 班次名称（来自班次模版 Sheet，可能为 null） */
  session: string | null;
  /** 工时数字（来自工时模版 Sheet，可能为 null） */
  hoursValue: number | null;
  /** 是否与现有数据冲突（现有数据将被覆盖） */
  willOverwrite: boolean;
}

export interface ImportResult {
  /** 解析成功的行数 */
  parsedCount: number;
  /** 将覆盖现有数据的行数 */
  overwriteCount: number;
  /** 跳过的行数（员工代号不匹配、日期无效等） */
  skippedCount: number;
  /** 预览数据（最多 200 行） */
  preview: ImportPreviewRow[];
  /** 完整的待写入数据 */
  entries: ShiftEntry[];
  /** 警告信息 */
  warnings: string[];
}

// ─── 模版生成 ──────────────────────────────────────────────────────────────────

/**
 * 生成排班导入模版 Excel，包含 2 个 Sheet：
 * - Sheet 1：班次模版（格子填班次名称，如"午班"、"晚班"）
 * - Sheet 2：工时模版（格子填工时数字，如 8、8.5）
 */
export async function buildImportTemplate(params: {
  month: string;
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
}): Promise<void> {
  const { month, employees, shiftTemplates } = params;
  const days = getDaysInMonthArr(month);
  const activeEmps = employees.filter((e) => e.active && !e.archived);

  const wb = XLSX.utils.book_new();

  // 表头行：代号 | 姓名 | 01(周一) | 02(周二) | ...
  const dateHeaders = days.map((d) => {
    const day = d.slice(8);
    const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(d).getDay()];
    return `${day}(周${wd})`;
  });
  const header = ["员工代号", "姓名", ...dateHeaders];

  // 示例行
  const exampleSession = shiftTemplates.length > 0 ? shiftTemplates[0]!.session : "晚班";
  const exampleHours = shiftTemplates.length > 0 ? (shiftTemplates[0]!.defaultHours ?? 8) : 8;
  const sessionExampleRow = [
    "（示例）",
    "（示例）",
    ...days.map((_, i) => (i % 7 < 5 ? exampleSession : "")),
  ];
  const hoursExampleRow = [
    "（示例）",
    "（示例）",
    ...days.map((_, i) => (i % 7 < 5 ? exampleHours : "")),
  ];

  // 员工数据行（预填代号和姓名，日期格子留空）
  const empRows = activeEmps.map((emp) => [
    emp.code ?? emp.id.slice(0, 6),
    emp.realName,
    ...days.map(() => ""),
  ]);

  // ── Sheet 1：班次模版 ──
  const sessionSheet = XLSX.utils.aoa_to_sheet([header, sessionExampleRow, ...empRows]);
  sessionSheet["!cols"] = [{ wch: 10 }, { wch: 10 }, ...days.map(() => ({ wch: 8 }))];

  // 班次图例（在表格下方）
  const legendStartRow = 2 + activeEmps.length + 2;
  XLSX.utils.sheet_add_aoa(sessionSheet, [
    ["班次图例（请填写以下班次名称之一）："],
    ...shiftTemplates.map((t) => [t.session, `${t.startTime} - ${t.endTime}`, `默认 ${t.defaultHours}h`]),
  ], { origin: { r: legendStartRow, c: 0 } });

  XLSX.utils.book_append_sheet(wb, sessionSheet, "班次模版");

  // ── Sheet 2：工时模版 ──
  const hoursSheet = XLSX.utils.aoa_to_sheet([header, hoursExampleRow, ...empRows]);
  hoursSheet["!cols"] = [{ wch: 10 }, { wch: 10 }, ...days.map(() => ({ wch: 8 }))];

  // 说明行
  const hoursNoteRow = 2 + activeEmps.length + 2;
  XLSX.utils.sheet_add_aoa(hoursSheet, [
    ["填写说明："],
    ["- 填入数字（如 8 或 8.5），代表该天的工时（小时）"],
    ["- 留空表示该天无排班，不影响已有数据"],
    ["- 0 或负数视为空，不写入"],
  ], { origin: { r: hoursNoteRow, c: 0 } });

  XLSX.utils.book_append_sheet(wb, hoursSheet, "工时模版");

  // 导出文件
  const wbout = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const fileName = `排班导入模版_${month}.xlsx`;
  const fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
  await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      dialogTitle: `下载 ${month} 排班导入模版`,
    });
  } else {
    throw new Error(`模版已生成：${fileUri}`);
  }
}

// ─── Excel 解析 ───────────────────────────────────────────────────────────────

/**
 * 让用户选择 Excel 文件，解析并返回预览数据
 */
export async function parseImportFile(params: {
  month: string;
  employees: Employee[];
  shiftTemplates: ShiftTemplate[];
  existingShifts: ShiftEntry[];
}): Promise<ImportResult | null> {
  const { month, employees, shiftTemplates, existingShifts } = params;

  // 选择文件
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
           "application/vnd.ms-excel",
           "application/octet-stream"],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0]!;
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const wb = XLSX.read(base64, { type: "base64" });

  const days = getDaysInMonthArr(month);
  const activeEmps = employees.filter((e) => e.active && !e.archived);

  // 构建员工代号 → Employee 的查找 Map
  const empByCode = new Map<string, Employee>();
  for (const emp of activeEmps) {
    const code = (emp.code ?? emp.id.slice(0, 6)).trim().toLowerCase();
    empByCode.set(code, emp);
    // 也支持用姓名匹配
    empByCode.set(emp.realName.trim().toLowerCase(), emp);
  }

  // 构建班次名称的合法集合
  const validSessions = new Set(shiftTemplates.map((t) => t.session.trim()));

  // 构建现有排班的快速查找 Map
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

  // 解析 Sheet 1（班次模版）和 Sheet 2（工时模版）
  const sessionSheetName = wb.SheetNames.find((n) => n.includes("班次")) ?? wb.SheetNames[0];
  const hoursSheetName = wb.SheetNames.find((n) => n.includes("工时")) ?? wb.SheetNames[1];

  const sessionSheet = sessionSheetName ? wb.Sheets[sessionSheetName] : null;
  const hoursSheet = hoursSheetName ? wb.Sheets[hoursSheetName] : null;

  // 将 Sheet 转为二维数组
  const sessionData: string[][] = sessionSheet
    ? (XLSX.utils.sheet_to_json(sessionSheet, { header: 1, defval: "" }) as string[][])
    : [];
  const hoursData: string[][] = hoursSheet
    ? (XLSX.utils.sheet_to_json(hoursSheet, { header: 1, defval: "" }) as string[][])
    : [];

  // 解析表头行，找到日期列的索引
  function parseDateColumns(headerRow: string[]): Map<number, string> {
    const colToDate = new Map<number, string>();
    for (let col = 2; col < headerRow.length; col++) {
      const cell = String(headerRow[col] ?? "").trim();
      // 匹配 "01(周一)" 或 "1" 或 "01" 格式
      const dayMatch = cell.match(/^(\d{1,2})/);
      if (dayMatch) {
        const dayNum = parseInt(dayMatch[1]!, 10);
        const dateStr = `${month}-${String(dayNum).padStart(2, "0")}`;
        if (days.includes(dateStr)) {
          colToDate.set(col, dateStr);
        }
      }
    }
    return colToDate;
  }

  const sessionColToDate = sessionData.length > 0 ? parseDateColumns(sessionData[0] as string[]) : new Map<number, string>();
  const hoursColToDate = hoursData.length > 0 ? parseDateColumns(hoursData[0] as string[]) : new Map<number, string>();

  // 合并班次和工时数据（以员工代号+日期为 key）
  interface MergedCell {
    session: string | null;
    hoursValue: number | null;
  }
  const merged = new Map<string, MergedCell>();

  // 处理班次 Sheet（跳过表头行和示例行）
  for (let row = 2; row < sessionData.length; row++) {
    const rowData = sessionData[row] as string[];
    const codeRaw = String(rowData[0] ?? "").trim();
    if (!codeRaw || codeRaw.startsWith("（") || codeRaw.startsWith("班次图例")) continue;

    const emp = empByCode.get(codeRaw.toLowerCase()) ?? empByCode.get(String(rowData[1] ?? "").trim().toLowerCase());
    if (!emp) {
      skippedCount++;
      if (!warnings.find((w) => w.includes(codeRaw))) {
        warnings.push(`未找到员工：代号"${codeRaw}"，该行已跳过`);
      }
      continue;
    }

    for (const [col, dateStr] of sessionColToDate) {
      const cell = String(rowData[col] ?? "").trim();
      if (!cell) continue;

      const normalizedSession = cell.replace(/\s+/g, "");
      const matchedSession = [...validSessions].find((s) => s.replace(/\s+/g, "") === normalizedSession);
      if (!matchedSession) {
        warnings.push(`员工"${emp.realName}"在 ${dateStr} 的班次"${cell}"不在班次模板中，已跳过`);
        skippedCount++;
        continue;
      }

      const key = `${emp.id}|${dateStr}`;
      const existing = merged.get(key) ?? { session: null, hoursValue: null };
      merged.set(key, { ...existing, session: matchedSession });
    }
  }

  // 处理工时 Sheet（跳过表头行和示例行）
  for (let row = 2; row < hoursData.length; row++) {
    const rowData = hoursData[row] as string[];
    const codeRaw = String(rowData[0] ?? "").trim();
    if (!codeRaw || codeRaw.startsWith("（") || codeRaw.startsWith("填写说明")) continue;

    const emp = empByCode.get(codeRaw.toLowerCase()) ?? empByCode.get(String(rowData[1] ?? "").trim().toLowerCase());
    if (!emp) continue; // 已在班次 Sheet 处理过警告

    for (const [col, dateStr] of hoursColToDate) {
      const cell = String(rowData[col] ?? "").trim();
      if (!cell) continue;

      const hours = parseFloat(cell);
      if (isNaN(hours) || hours <= 0) continue;

      const key = `${emp.id}|${dateStr}`;
      const existing = merged.get(key) ?? { session: null, hoursValue: null };
      merged.set(key, { ...existing, hoursValue: hours });
    }
  }

  // 将合并数据转为 ShiftEntry 列表
  for (const [key, cell] of merged) {
    const [empId, dateStr] = key.split("|") as [string, string];
    const emp = activeEmps.find((e) => e.id === empId);
    if (!emp) continue;

    // 确定班次名称（没有班次时使用第一个模板的 session）
    const session = cell.session ?? (shiftTemplates[0]?.session ?? "晚班");
    const hoursValue = cell.hoursValue ?? null;

    const entry: ShiftEntry = {
      employeeId: empId,
      date: dateStr,
      shift: session,
      hoursValue,
    };

    // 检查是否会覆盖现有数据
    const existingKey = `${empId}|${dateStr}|${session}`;
    const willOverwrite = existingMap.has(existingKey);
    if (willOverwrite) overwriteCount++;

    parsedCount++;
    allEntries.push(entry);

    if (preview.length < 200) {
      preview.push({
        employeeId: empId,
        employeeCode: emp.code ?? emp.id.slice(0, 6),
        employeeName: emp.realName,
        date: dateStr,
        session: cell.session,
        hoursValue: cell.hoursValue,
        willOverwrite,
      });
    }
  }

  return {
    parsedCount,
    overwriteCount,
    skippedCount,
    preview,
    entries: allEntries,
    warnings,
  };
}

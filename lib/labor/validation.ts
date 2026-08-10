/**
 * lib/labor/validation.ts
 * 薪资计算前校验模块（Pre-payroll Validation）
 *
 * 设计原则：
 * - 不阻断计算流程，仅返回校验结果供 UI 展示
 * - 参考专业薪资系统的 Pre-payroll Check 阶段
 * - 校验结果分三级：error（配置异常）、warning（数据可疑）、info（提示信息）
 */

import type { Employee, ShiftEntry, MonthlyAttendance } from "./types";
import { getDaysInMonth, parseMonth } from "./types";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  ruleId: string;
  severity: ValidationSeverity;
  employeeId: string;
  employeeName: string;
  month: string;
  message: string;
  /** 建议操作 */
  suggestion: string;
}

// ─── 跨月排班检测工具 ─────────────────────────────────────────────────────────

/**
 * 检测排班日期是否属于当前操作月份
 * @returns true = 跨月排班
 */
export function isCrossMonthShift(date: string, currentViewMonth: string): boolean {
  return !date.startsWith(currentViewMonth);
}

/**
 * 获取跨月排班的影响说明文本
 */
export function getCrossMonthImpactText(date: string): string {
  const targetMonth = date.slice(0, 7);
  const [y, m] = targetMonth.split("-").map(Number);
  return `此排班将计入 ${y}年${m}月 的考勤和薪资计算`;
}

/**
 * 检测某条排班是否为跨月录入（需要 sourceMonth 字段支持）
 */
export function isCrossMonthEntry(entry: ShiftEntry & { sourceMonth?: string }): boolean {
  if (!entry.sourceMonth) return false;
  return !entry.date.startsWith(entry.sourceMonth);
}

// ─── 薪资计算前校验 ───────────────────────────────────────────────────────────

/**
 * 薪资计算前校验（Pre-payroll Validation）
 *
 * 校验规则：
 * - V001: 零排班非零底薪（活跃员工无排班）
 * - V002: 孤立跨月排班（仅月初1-2天排班，可能来自上月跨月录入）
 * - V003: 出勤超应出勤（超过150%，可能有重复录入）
 * - V004: 底薪配置异常（restDaysPerMonth >= daysInMonth）
 * - V005: 排班无工时（有排班记录但未填工时）
 */
export function validatePayrollData(
  employee: Employee,
  month: string,
  allShifts: ShiftEntry[],
  attendance: MonthlyAttendance
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const { year, month: m } = parseMonth(month);
  const daysInMonth = getDaysInMonth(year, m);
  const empShifts = allShifts.filter((s) => s.employeeId === employee.id && s.date.startsWith(month));
  const name = employee.code || employee.realName;

  // V001: 零排班非零底薪
  if (attendance.attendanceDays === 0 && employee.baseSalary > 0 && employee.active && !employee.archived) {
    // 仅对全职和长期兼职提示（临时兼职无排班是正常的）
    if (employee.type !== "parttime") {
      results.push({
        ruleId: "V001",
        severity: "warning",
        employeeId: employee.id,
        employeeName: name,
        month,
        message: `${name} 本月无排班记录，比例底薪为 ¥0`,
        suggestion: "请确认是否遗漏排班，或该员工本月确实未出勤",
      });
    }
  }

  // V002: 孤立跨月排班检测
  if (empShifts.length > 0 && empShifts.length <= 2) {
    const dates = empShifts.map((s) => parseInt(s.date.slice(-2)));
    const allEarlyMonth = dates.every((d) => d <= 2);
    if (allEarlyMonth) {
      results.push({
        ruleId: "V002",
        severity: "info",
        employeeId: employee.id,
        employeeName: name,
        month,
        message: `${name} 本月仅有 ${empShifts.length} 天排班（月初1-2日），可能来自上月跨月录入`,
        suggestion: "请在排班表中确认这些排班是否为有效数据",
      });
    }
  }

  // V003: 出勤超应出勤（超过150%）
  if (attendance.expectedAttendanceDays > 0 && attendance.attendanceDays > attendance.expectedAttendanceDays * 1.5) {
    results.push({
      ruleId: "V003",
      severity: "warning",
      employeeId: employee.id,
      employeeName: name,
      month,
      message: `${name} 出勤 ${attendance.attendanceDays} 天，超过应出勤 ${attendance.expectedAttendanceDays} 天的 150%`,
      suggestion: "请确认排班数据是否正确，是否有重复录入",
    });
  }

  // V004: 底薪配置异常
  if (employee.restDaysPerMonth >= daysInMonth) {
    results.push({
      ruleId: "V004",
      severity: "error",
      employeeId: employee.id,
      employeeName: name,
      month,
      message: `${name} 每月休息天数(${employee.restDaysPerMonth}) ≥ 当月天数(${daysInMonth})，配置异常`,
      suggestion: "请修改员工档案中的每月休息天数",
    });
  }

  // V005: 排班无工时（非特殊状态的排班应有工时）
  const noHoursShifts = empShifts.filter((s) =>
    !s.specialStatusId && (s.hoursValue === null || s.hoursValue === undefined || s.hoursValue === 0)
  );
  if (noHoursShifts.length > 0) {
    results.push({
      ruleId: "V005",
      severity: "warning",
      employeeId: employee.id,
      employeeName: name,
      month,
      message: `${name} 有 ${noHoursShifts.length} 天排班未填写工时`,
      suggestion: "未填工时的排班不计入出勤天数，请补充工时数据",
    });
  }

  return results;
}

/**
 * 批量校验所有活跃员工
 */
export function validateAllEmployees(
  employees: Employee[],
  month: string,
  allShifts: ShiftEntry[],
  attendanceRecords: MonthlyAttendance[]
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const activeEmps = employees.filter((e) => e.active && !e.archived);

  for (const emp of activeEmps) {
    const att = attendanceRecords.find((r) => r.employeeId === emp.id && r.month === month);
    if (!att) continue;
    results.push(...validatePayrollData(emp, month, allShifts, att));
  }

  // 按严重级别排序：error > warning > info
  const severityOrder: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return results;
}

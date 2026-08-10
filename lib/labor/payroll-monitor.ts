/**
 * 薪资模块监控埋点与异常告警
 *
 * 由于项目未集成 Sentry/Bugsnag 等 APM，采用本地日志 + 异常检测方案：
 * 1. 关键操作埋点（console.log with structured tags）
 * 2. 异常值检测（自动告警）
 * 3. 数据一致性校验（启动时静默检查）
 *
 * 未来可扩展：接入 Sentry/Datadog 时，将 reportAnomaly 替换为 SDK 调用。
 */

// ─── 日志级别 ─────────────────────────────────────────────────────────────────

type LogLevel = "info" | "warn" | "error";

interface PayrollLogEntry {
  level: LogLevel;
  tag: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ─── 内存日志缓冲（最近 100 条）────────────────────────────────────────────────

const LOG_BUFFER_SIZE = 100;
const logBuffer: PayrollLogEntry[] = [];

function pushLog(entry: PayrollLogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();

  // 输出到 console（生产环境可通过 __DEV__ 控制）
  const prefix = `[Payroll:${entry.tag}]`;
  switch (entry.level) {
    case "error": console.error(prefix, entry.message, entry.data ?? ""); break;
    case "warn": console.warn(prefix, entry.message, entry.data ?? ""); break;
    default: if (__DEV__) console.log(prefix, entry.message, entry.data ?? "");
  }
}

// 声明 __DEV__ 全局变量（React Native 内置）
declare const __DEV__: boolean;

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/** 获取最近的日志条目（用于导出调试信息） */
export function getRecentLogs(): PayrollLogEntry[] {
  return [...logBuffer];
}

/** 清空日志缓冲 */
export function clearLogs() {
  logBuffer.length = 0;
}

// ─── 埋点函数 ─────────────────────────────────────────────────────────────────

/**
 * 记录薪资计算事件
 */
export function logPayrollCalc(event: string, data?: Record<string, unknown>) {
  pushLog({
    level: "info",
    tag: "calc",
    message: event,
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 记录确认发薪状态变更
 */
export function logConfirmationStateChange(
  month: string,
  from: string,
  to: string,
  data?: Record<string, unknown>
) {
  pushLog({
    level: "info",
    tag: "confirmation",
    message: `${month}: ${from} → ${to}`,
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 记录数据迁移执行
 */
export function logMigration(name: string, affected: number) {
  pushLog({
    level: "info",
    tag: "migration",
    message: `${name}: ${affected} records affected`,
    timestamp: new Date().toISOString(),
  });
}

// ─── 异常检测与告警 ───────────────────────────────────────────────────────────

export interface AnomalyAlert {
  id: string;
  severity: "warning" | "critical";
  rule: string;
  message: string;
  employeeId?: string;
  month?: string;
  detectedAt: string;
}

const activeAlerts: AnomalyAlert[] = [];

/** 获取当前活跃告警 */
export function getActiveAlerts(): AnomalyAlert[] {
  return [...activeAlerts];
}

/** 清除已处理的告警 */
export function dismissAlert(id: string) {
  const idx = activeAlerts.findIndex((a) => a.id === id);
  if (idx >= 0) activeAlerts.splice(idx, 1);
}

/**
 * 报告异常（内部使用）
 */
function reportAnomaly(alert: Omit<AnomalyAlert, "id" | "detectedAt">) {
  const entry: AnomalyAlert = {
    ...alert,
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    detectedAt: new Date().toISOString(),
  };
  activeAlerts.push(entry);

  pushLog({
    level: alert.severity === "critical" ? "error" : "warn",
    tag: "anomaly",
    message: `[${alert.rule}] ${alert.message}`,
    data: { employeeId: alert.employeeId, month: alert.month },
    timestamp: entry.detectedAt,
  });

  // 未来扩展点：接入 Sentry
  // if (typeof Sentry !== 'undefined') {
  //   Sentry.captureMessage(alert.message, { level: alert.severity, extra: alert });
  // }
}

// ─── 异常告警规则 ─────────────────────────────────────────────────────────────

/**
 * 规则 A1：薪资计算结果异常值检测
 * 当 finalSalary 为负数或超过合理范围时触发
 */
export function checkSalaryAnomaly(
  employeeId: string,
  employeeName: string,
  month: string,
  finalSalary: number,
  grossSalary: number
) {
  // 负薪资
  if (finalSalary < 0) {
    reportAnomaly({
      severity: "critical",
      rule: "A1-NEGATIVE_SALARY",
      message: `${employeeName} ${month} 实发薪资为负数 (¥${finalSalary.toFixed(2)})`,
      employeeId,
      month,
    });
  }

  // 实发 > 应发（不含调休兑换时不应出现）
  if (finalSalary > grossSalary * 1.5 && grossSalary > 0) {
    reportAnomaly({
      severity: "warning",
      rule: "A1-SALARY_EXCEEDS_GROSS",
      message: `${employeeName} ${month} 实发(¥${finalSalary.toFixed(0)})超过应发(¥${grossSalary.toFixed(0)})的150%`,
      employeeId,
      month,
    });
  }
}

/**
 * 规则 A2：预支金额异常检测
 * 当预支金额超过应发薪资时触发
 */
export function checkAdvanceAnomaly(
  employeeId: string,
  employeeName: string,
  month: string,
  totalAdvance: number,
  grossSalary: number
) {
  if (totalAdvance > grossSalary && grossSalary > 0) {
    reportAnomaly({
      severity: "warning",
      rule: "A2-ADVANCE_EXCEEDS_GROSS",
      message: `${employeeName} ${month} 预支(¥${totalAdvance.toFixed(0)})超过应发(¥${grossSalary.toFixed(0)})`,
      employeeId,
      month,
    });
  }
}

/**
 * 规则 A3：补贴计算异常检测
 * 当 per_day 补贴的天数超过月天数时触发
 */
export function checkAllowanceAnomaly(
  employeeId: string,
  employeeName: string,
  month: string,
  allowanceAmount: number,
  dailyRate: number,
  daysInMonth: number
) {
  const maxExpected = dailyRate * daysInMonth;
  if (allowanceAmount > maxExpected * 1.1 && dailyRate > 0) {
    reportAnomaly({
      severity: "warning",
      rule: "A3-ALLOWANCE_EXCEEDS_MAX",
      message: `${employeeName} ${month} 补贴(¥${allowanceAmount})超过理论最大值(¥${maxExpected})`,
      employeeId,
      month,
    });
  }
}

/**
 * 规则 A4：数据一致性异常
 * 当 pettyLaborPaid 与 linkIds 不一致时触发
 */
export function checkDataIntegrityAnomaly(
  issueCount: number,
  totalChecked: number
) {
  if (issueCount > 0) {
    reportAnomaly({
      severity: issueCount > 5 ? "critical" : "warning",
      rule: "A4-DATA_INTEGRITY",
      message: `数据一致性检查发现 ${issueCount}/${totalChecked} 条薪资单存在问题`,
    });
  }
}

/**
 * 规则 A5：确认发薪后数据被意外修改
 * 当 FROZEN 状态下检测到数据变更时触发
 */
export function checkFrozenViolation(
  month: string,
  operation: string
) {
  reportAnomaly({
    severity: "critical",
    rule: "A5-FROZEN_VIOLATION",
    message: `已确认月份 ${month} 被意外修改：${operation}`,
    month,
  });
}

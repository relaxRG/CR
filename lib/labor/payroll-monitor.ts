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

/**
 * 规则 A6：绩效补贴控制字段丢失检测
 *
 * 当 autoSync 执行后，检测到某员工的工作绩效或业绩绩效大于0，但
 * allowanceOverrides/workKPISelections/revenueActuals 同时为空时触发。
 * 这是跨月闭包污染的典型症状：控制字段被 autoSync 覆盖清除。
 *
 * 调用时机：autoSync 每次执行完毕后，对所有有绩效设置的员工调用此检查。
 */
export function checkControlFieldsIntegrity(
  employeeId: string,
  employeeName: string,
  month: string,
  workKPIBonus: number,
  revenueKPIBonus: number,
  allowanceOverrides: Record<string, boolean> | undefined,
  workKPISelections: Record<string, string> | undefined,
  revenueActuals: Record<string, number> | undefined,
) {
  const hasPerformance = workKPIBonus !== 0 || revenueKPIBonus !== 0;
  const hasOverrides = allowanceOverrides && Object.keys(allowanceOverrides).length > 0;
  const hasKPISelections = workKPISelections && Object.keys(workKPISelections).length > 0;
  const hasRevenueActuals = revenueActuals && Object.keys(revenueActuals).length > 0;

  if (hasPerformance && !hasOverrides && !hasKPISelections && !hasRevenueActuals) {
    reportAnomaly({
      severity: "warning",
      rule: "A6-CONTROL_FIELDS_LOST",
      message: `${employeeName} ${month} 工作绩效=¥${workKPIBonus}、业绩绩效=¥${revenueKPIBonus}，但绩效补贴控制字段均为空，疑似控制字段丢失（跨月闭包污染）`,
      employeeId,
      month,
    });
  }
}

/**
 * 规则 A7：跨月数据污染检测
 *
 * 当检测到某月的 advances 合计与 paySlip.advanceAmount 差异过大时触发。
 * 差异过大通常意味着 advances 过滤缺少 month 约束，统计了其他月份的数据。
 *
 * 调用时机：autoSync 计算 advanceTotal 后，与 paySlip.advanceAmount 对比。
 */
export function checkAdvanceCrossMonthPollution(
  employeeId: string,
  employeeName: string,
  month: string,
  calculatedAdvance: number,
  storedAdvanceAmount: number
) {
  // 允许 ¥1 以内的浮点误差
  const diff = Math.abs(calculatedAdvance - storedAdvanceAmount);
  if (diff > 1 && storedAdvanceAmount > 0) {
    // 差异超过 ¥100 或超过存储值的 50% 时告警
    const isSignificant = diff > 100 || diff > storedAdvanceAmount * 0.5;
    if (isSignificant) {
      reportAnomaly({
        severity: "warning",
        rule: "A7-ADVANCE_CROSS_MONTH",
        message: `${employeeName} ${month} 预支合计不一致：计算值=¥${calculatedAdvance.toFixed(2)}，存储值=¥${storedAdvanceAmount.toFixed(2)}，差异=¥${diff.toFixed(2)}，疑似跨月数据污染`,
        employeeId,
        month,
      });
    }
  }
}

/**
 * 导出调试信息（用于用户反馈时附加）
 * 包含最近日志 + 活跃告警，格式化为可读字符串
 */
export function exportDebugReport(): string {
  const logs = getRecentLogs();
  const alerts = getActiveAlerts();
  const lines: string[] = [
    `=== Payroll Debug Report ===`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `--- Active Alerts (${alerts.length}) ---`,
    ...alerts.map((a) =>
      `[${a.severity.toUpperCase()}] ${a.rule}: ${a.message} (${a.detectedAt})`
    ),
    ``,
    `--- Recent Logs (last ${logs.length}) ---`,
    ...logs.slice(-20).map((l) =>
      `[${l.level.toUpperCase()}][${l.tag}] ${l.message}`
    ),
  ];
  return lines.join("\n");
}

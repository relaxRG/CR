import { roundMoney, sumMoney } from "@/lib/finance/money";
import type {
  CompOffBalanceEntry,
  CompOffCashOutEvent,
  CompOffCashOutSettlementSnapshot,
  PaySlip,
  PayrollDataQuarantineRecord,
} from "./types";

export type CompOffCashOutIssueCode =
  | NonNullable<CompOffCashOutEvent["issueCode"]>
  | "ORPHAN_PAYSLIP_CASHOUT"
  | "SETTLEMENT_SNAPSHOT_MISMATCH"
  | "EVENT_ENTRY_ID_MISMATCH"
  | "EVENT_EMPLOYEE_MISMATCH"
  | "EVENT_MONTH_MISMATCH"
  | "EVENT_SOURCE_MISMATCH"
  | "EVENT_DAYS_MISMATCH"
  | "DUPLICATE_EVENT_ID"
  | "INVALID_SETTLEMENT_HISTORY";

export type CompOffCashOutIssue = Readonly<{
  entryId?: string;
  employeeId: string;
  month: string;
  code: CompOffCashOutIssueCode;
  amount: number;
  description: string;
}>;

export type CompOffCashOutSettlementLine = Readonly<{
  entryId: string;
  eventId: string;
  source: CompOffBalanceEntry["source"];
  earnedMonth: string;
  days: number;
  unitRate: number;
  amount: number;
  createdAt: string;
}>;

export type CompOffCashOutSettlement = Readonly<{
  employeeId: string;
  month: string;
  amount: number;
  entryIds: readonly string[];
  lines: readonly CompOffCashOutSettlementLine[];
  issues: readonly CompOffCashOutIssue[];
}>;

export type CompOffCashOutIntegrityReport = Readonly<{
  entriesChecked: number;
  activeEvents: number;
  quarantinedEvents: number;
  voidedEvents: number;
  slipsChecked: number;
  issues: readonly CompOffCashOutIssue[];
}>;

type LegacyPaySlipCompOffCashOut = Readonly<{ compOffCashOut?: number }>;

const expectedAmount = (days: number, unitRate: number) => roundMoney(days * unitRate);
const isMoneyEqual = (left: number, right: number) => Math.abs(roundMoney(left) - roundMoney(right)) < 0.01;

function getEventPayloadIssue(entry: CompOffBalanceEntry, event: CompOffCashOutEvent): CompOffCashOutIssue | null {
  const month = entry.usedMonth ?? event.usedMonth;
  if (event.entryId !== entry.id) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "EVENT_ENTRY_ID_MISMATCH", amount: event.amount, description: "兑现事件引用的余额条目与其所属条目不一致，已从薪资结算隔离。" };
  if (event.employeeId !== entry.employeeId) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "EVENT_EMPLOYEE_MISMATCH", amount: event.amount, description: "兑现事件员工与余额条目员工不一致，已从薪资结算隔离。" };
  if (event.usedMonth !== entry.usedMonth || event.usedMonth !== month) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "EVENT_MONTH_MISMATCH", amount: event.amount, description: "兑现事件月份与余额条目使用月份不一致，已从薪资结算隔离。" };
  if (event.source !== entry.source || event.earnedMonth !== entry.earnedMonth) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "EVENT_SOURCE_MISMATCH", amount: event.amount, description: "兑现事件来源或取得月份与余额条目不一致，已从薪资结算隔离。" };
  if (event.days !== entry.days) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "EVENT_DAYS_MISMATCH", amount: event.amount, description: "兑现事件天数与余额条目天数不一致，已从薪资结算隔离。" };
  if (event.unitRate <= 0) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "ZERO_RATE_NON_ZERO_AMOUNT", amount: event.amount, description: "兑现事件费率为 ¥0，已从薪资结算隔离。" };
  if (!isMoneyEqual(expectedAmount(event.days, event.unitRate), event.amount)) return { entryId: entry.id, employeeId: entry.employeeId, month, code: "AMOUNT_RATE_MISMATCH", amount: event.amount, description: "兑现事件费率、天数与金额不一致，已从薪资结算隔离。" };
  return null;
}

function getHistoryIssue(entry: CompOffBalanceEntry): CompOffCashOutIssue | null {
  const history = entry.settlementHistory ?? [];
  const ids = new Set<string>();
  for (const event of history) {
    if (event.status !== "voided" || ids.has(event.id) || event.entryId !== entry.id || !event.voidedAt || !event.voidReason) {
      return {
        entryId: entry.id,
        employeeId: entry.employeeId,
        month: entry.usedMonth ?? entry.earnedMonth,
        code: "INVALID_SETTLEMENT_HISTORY",
        amount: event.amount,
        description: "作废兑现历史缺少作废依据、条目归属不正确或存在重复事件 ID，需人工核对。",
      };
    }
    ids.add(event.id);
  }
  return null;
}

/**
 * 将旧 cashOutUnitRate/cashOutAmount 迁移为不可分裂的事件快照。
 * 零费率非零金额、费率金额不匹配都隔离为 quarantined，绝不进入薪资结算。
 */
export function migrateLegacyCompOffSettlement(entry: CompOffBalanceEntry): CompOffBalanceEntry {
  const legacy = entry as CompOffBalanceEntry & { cashOutUnitRate?: number; cashOutAmount?: number };
  if (entry.status !== "cashed_out" || entry.settlement) return entry;

  const unitRate = roundMoney(legacy.cashOutUnitRate ?? 0);
  const amount = roundMoney(legacy.cashOutAmount ?? 0);
  const expected = expectedAmount(entry.days, unitRate);
  const issueCode = unitRate === 0 && amount !== 0
    ? "ZERO_RATE_NON_ZERO_AMOUNT"
    : !isMoneyEqual(expected, amount)
      ? "AMOUNT_RATE_MISMATCH"
      : undefined;
  const event: CompOffCashOutEvent = {
    id: `legacy-${entry.id}`,
    entryId: entry.id,
    employeeId: entry.employeeId,
    source: entry.source,
    earnedMonth: entry.earnedMonth,
    usedMonth: entry.usedMonth ?? entry.earnedMonth,
    days: entry.days,
    unitRate,
    amount,
    createdAt: entry.createdAt,
    status: issueCode ? "quarantined" : "active",
    issueCode,
  };
  const next = { ...entry, settlement: event } as CompOffBalanceEntry & { cashOutUnitRate?: never; cashOutAmount?: never };
  delete (next as unknown as Record<string, unknown>).cashOutUnitRate;
  delete (next as unknown as Record<string, unknown>).cashOutAmount;
  return next;
}

/** 只汇总指定月、状态为 active 且载荷完整的唯一兑现事件。 */
export function settleCompOffCashOut(entries: readonly CompOffBalanceEntry[], employeeId: string, month: string): CompOffCashOutSettlement {
  const issues: CompOffCashOutIssue[] = [];
  const lines: CompOffCashOutSettlementLine[] = [];
  const seenEventIds = new Set<string>();
  for (const rawEntry of entries) {
    if (rawEntry.employeeId !== employeeId || rawEntry.status !== "cashed_out" || rawEntry.usedMonth !== month) continue;
    const entry = migrateLegacyCompOffSettlement(rawEntry);
    const event = entry.settlement;
    if (!event) {
      issues.push({ entryId: entry.id, employeeId, month, code: "MISSING_SETTLEMENT", amount: 0, description: "已兑现余额没有可验证的兑现事件。" });
      continue;
    }
    if (seenEventIds.has(event.id)) {
      issues.push({ entryId: entry.id, employeeId, month, code: "DUPLICATE_EVENT_ID", amount: event.amount, description: "同一兑现事件 ID 被多个余额条目复用，已从薪资结算隔离。" });
      continue;
    }
    seenEventIds.add(event.id);
    if (event.status !== "active") {
      issues.push({ entryId: entry.id, employeeId, month, code: event.issueCode ?? "MISSING_SETTLEMENT", amount: event.amount, description: event.issueCode === "ZERO_RATE_NON_ZERO_AMOUNT" ? "零费率却存有兑现金额，已从薪资结算隔离。" : "兑现事件已隔离或作废，不进入薪资。" });
      continue;
    }
    const payloadIssue = getEventPayloadIssue(entry, event);
    if (payloadIssue) {
      issues.push(payloadIssue);
      continue;
    }
    lines.push({
      entryId: entry.id,
      eventId: event.id,
      source: entry.source,
      earnedMonth: entry.earnedMonth,
      days: event.days,
      unitRate: event.unitRate,
      amount: event.amount,
      createdAt: event.createdAt,
    });
  }
  return {
    employeeId,
    month,
    amount: sumMoney(lines.map((line) => line.amount)),
    entryIds: lines.map((line) => line.entryId),
    lines,
    issues,
  };
}

/** 从已验证汇总创建薪资快照；调用方不得自行构造 amount 或 eventIds。 */
export function createCompOffCashOutSettlementSnapshot(
  settlement: CompOffCashOutSettlement,
  now = new Date().toISOString(),
): CompOffCashOutSettlementSnapshot {
  return {
    source: "comp_off_event_ledger",
    eventIds: settlement.lines.map((line) => line.eventId),
    amount: settlement.amount,
    verifiedAt: now,
  };
}

export function getCompOffCashOutSettlementAmount(slip: Pick<PaySlip, "compOffCashOutSettlement">): number {
  return roundMoney(slip.compOffCashOutSettlement?.amount ?? 0);
}

/** 检查薪资单快照是否仍完整对应当前有效事件；任何不一致均不能自动进入重建金额。 */
export function getCompOffCashOutSnapshotIssue(
  slip: Pick<PaySlip, "employeeId" | "month" | "compOffCashOutSettlement">,
  settlement: CompOffCashOutSettlement,
): CompOffCashOutIssue | null {
  const snapshot = slip.compOffCashOutSettlement;
  if (!snapshot) return settlement.amount === 0 ? null : {
    employeeId: slip.employeeId,
    month: slip.month,
    code: "SETTLEMENT_SNAPSHOT_MISMATCH",
    amount: 0,
    description: "薪资单缺少兑现账本快照，不能证明已保存金额来自有效事件。",
  };
  const actualIds = [...snapshot.eventIds].sort();
  const expectedIds = settlement.lines.map((line) => line.eventId).sort();
  const idsMatch = actualIds.length === expectedIds.length && actualIds.every((id, index) => id === expectedIds[index]);
  if (snapshot.source !== "comp_off_event_ledger" || !idsMatch || !isMoneyEqual(snapshot.amount, settlement.amount)) {
    return {
      employeeId: slip.employeeId,
      month: slip.month,
      code: "SETTLEMENT_SNAPSHOT_MISMATCH",
      amount: snapshot.amount,
      description: `薪资单兑现快照与有效事件不一致（快照 ¥${snapshot.amount}，有效事件 ¥${settlement.amount}），需重建或创建更正会话。`,
    };
  }
  return null;
}

function createLegacyQuarantineRecord(slip: PaySlip, amount: number, expectedAmount: number, now: string): PayrollDataQuarantineRecord {
  return {
    id: `legacy-comp-off-${slip.id}`,
    field: "legacy_comp_off_cash_out",
    code: "ORPHAN_COMP_OFF_CASHOUT",
    amount,
    expectedAmount,
    detectedAt: now,
    description: `旧薪资单直接保存调休兑现 ¥${amount}，但有效兑现事件合计为 ¥${expectedAmount}。该值已隔离，不参与后续草稿重建。`,
    status: "quarantined",
  };
}

/**
 * 迁移旧薪资单的直接 compOffCashOut 字段。
 * 匹配有效事件的历史值转为可验证快照；不匹配值移入 payrollDataQuarantine，保留证据但绝不再参与工资计算。
 */
export function migrateLegacyPaySlipCompOffCashOut(
  rawSlip: PaySlip | (PaySlip & LegacyPaySlipCompOffCashOut),
  entries: readonly CompOffBalanceEntry[],
  now = new Date().toISOString(),
): PaySlip {
  const legacyAmount = roundMoney((rawSlip as LegacyPaySlipCompOffCashOut).compOffCashOut ?? 0);
  const hasLegacyField = Object.prototype.hasOwnProperty.call(rawSlip, "compOffCashOut");
  if (!hasLegacyField) return rawSlip as PaySlip;

  const settlement = settleCompOffCashOut(entries, rawSlip.employeeId, rawSlip.month);
  const next = { ...rawSlip } as PaySlip & LegacyPaySlipCompOffCashOut;
  delete (next as unknown as Record<string, unknown>).compOffCashOut;
  const existingQuarantine = rawSlip.payrollDataQuarantine ?? [];
  if (isMoneyEqual(legacyAmount, settlement.amount)) {
    next.compOffCashOutSettlement = createCompOffCashOutSettlementSnapshot(settlement, now);
  } else {
    next.compOffCashOutSettlement = createCompOffCashOutSettlementSnapshot({ ...settlement, amount: 0, lines: [] }, now);
    if (!existingQuarantine.some((record) => record.id === `legacy-comp-off-${rawSlip.id}`)) {
      next.payrollDataQuarantine = [...existingQuarantine, createLegacyQuarantineRecord(rawSlip as PaySlip, legacyAmount, settlement.amount, now)];
    }
  }
  return next;
}

/** 旧字段非零差额只用于报告历史异常；新代码不得再把它写入 PaySlip。 */
export function getLegacyCompOffCashOutDelta(slip: LegacyPaySlipCompOffCashOut, settlement: CompOffCashOutSettlement): number {
  return roundMoney((slip.compOffCashOut ?? 0) - settlement.amount);
}

export function findCompOffCashOutIssues(entries: readonly CompOffBalanceEntry[], slips: ReadonlyArray<PaySlip | (PaySlip & LegacyPaySlipCompOffCashOut)>): readonly CompOffCashOutIssue[] {
  const issues: CompOffCashOutIssue[] = [];
  const employees = new Set([...entries.map((entry) => entry.employeeId), ...slips.map((slip) => slip.employeeId)]);
  const months = new Set([...entries.map((entry) => entry.usedMonth).filter((month): month is string => Boolean(month)), ...slips.map((slip) => slip.month)]);
  for (const employeeId of employees) {
    for (const month of months) {
      const settlement = settleCompOffCashOut(entries, employeeId, month);
      issues.push(...settlement.issues);
      const slip = slips.find((item) => item.employeeId === employeeId && item.month === month);
      if (!slip) continue;
      const legacyAmount = (slip as LegacyPaySlipCompOffCashOut).compOffCashOut;
      if (typeof legacyAmount === "number" && !isMoneyEqual(legacyAmount, settlement.amount)) {
        issues.push({ employeeId, month, code: "ORPHAN_PAYSLIP_CASHOUT", amount: getLegacyCompOffCashOutDelta({ compOffCashOut: legacyAmount }, settlement), description: `薪资单含有 ¥${legacyAmount} 直接兑现额；有效事件为 ¥${settlement.amount}，必须隔离并人工核对。` });
      }
      const snapshotIssue = getCompOffCashOutSnapshotIssue(slip as PaySlip, settlement);
      if (snapshotIssue) issues.push(snapshotIssue);
    }
  }
  return issues;
}

/** 供核对面板、导出前门禁和测试共用的全量审计；不会修改任何原始数据。 */
export function auditCompOffCashOutIntegrity(
  entries: readonly CompOffBalanceEntry[],
  slips: ReadonlyArray<PaySlip | (PaySlip & LegacyPaySlipCompOffCashOut)>,
): CompOffCashOutIntegrityReport {
  let activeEvents = 0;
  let quarantinedEvents = 0;
  let voidedEvents = 0;
  const issues: CompOffCashOutIssue[] = [];
  for (const raw of entries) {
    const entry = migrateLegacyCompOffSettlement(raw);
    const event = entry.settlement;
    if (event?.status === "active") activeEvents += 1;
    if (event?.status === "quarantined") quarantinedEvents += 1;
    if (event?.status === "voided") voidedEvents += 1;
    const historyIssue = getHistoryIssue(entry);
    if (historyIssue) issues.push(historyIssue);
    if (event && event.status === "active") {
      const payloadIssue = getEventPayloadIssue(entry, event);
      if (payloadIssue) issues.push(payloadIssue);
    }
  }
  issues.push(...findCompOffCashOutIssues(entries, slips));
  return { entriesChecked: entries.length, activeEvents, quarantinedEvents, voidedEvents, slipsChecked: slips.length, issues };
}

export function createCompOffCashOutEvent(entry: CompOffBalanceEntry, unitRate: number, usedMonth: string, now = new Date().toISOString()): CompOffCashOutEvent | null {
  const normalizedRate = roundMoney(unitRate);
  if (entry.days <= 0 || normalizedRate <= 0 || usedMonth < entry.earnedMonth) return null;
  return {
    id: `cashout-${entry.id}-${now}`,
    entryId: entry.id,
    employeeId: entry.employeeId,
    source: entry.source,
    earnedMonth: entry.earnedMonth,
    usedMonth,
    days: entry.days,
    unitRate: normalizedRate,
    amount: expectedAmount(entry.days, normalizedRate),
    createdAt: now,
    status: "active",
  };
}

export function voidCompOffCashOutEvent(entry: CompOffBalanceEntry, reason: string, now = new Date().toISOString()): CompOffBalanceEntry {
  if (entry.status !== "cashed_out" || !entry.settlement || entry.settlement.status === "voided") return entry;
  const voided = { ...entry.settlement, status: "voided" as const, voidedAt: now, voidReason: reason };
  return {
    ...entry,
    status: "available",
    usedMonth: undefined,
    settlement: undefined,
    settlementHistory: [...(entry.settlementHistory ?? []), voided],
  };
}

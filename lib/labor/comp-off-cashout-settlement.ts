import { roundMoney, sumMoney } from "@/lib/finance/money";
import type { CompOffBalanceEntry, CompOffCashOutEvent, PaySlip } from "./types";

export type CompOffCashOutIssueCode = CompOffCashOutEvent["issueCode"] | "ORPHAN_PAYSLIP_CASHOUT" | "DIRECT_DEDUCTION_MARKED_CASHOUT";

export type CompOffCashOutIssue = Readonly<{
  entryId?: string;
  employeeId: string;
  month: string;
  code: NonNullable<CompOffCashOutIssueCode>;
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

const expectedAmount = (days: number, unitRate: number) => roundMoney(days * unitRate);

/**
 * 将旧cashOutUnitRate/cashOutAmount迁移为不可分裂的事件快照。
 * 绝不信任历史金额：零费率非零金额、费率金额不匹配都隔离为 quarantined，
 * 不进入薪资结算，等待用户在核对面板中作废或创建已发薪更正。
 */
export function migrateLegacyCompOffSettlement(entry: CompOffBalanceEntry): CompOffBalanceEntry {
  const legacy = entry as CompOffBalanceEntry & { cashOutUnitRate?: number; cashOutAmount?: number };
  if (entry.status !== "cashed_out" || entry.settlement) return entry;

  const unitRate = roundMoney(legacy.cashOutUnitRate ?? 0);
  const amount = roundMoney(legacy.cashOutAmount ?? 0);
  const expected = expectedAmount(entry.days, unitRate);
  const issueCode = unitRate === 0 && amount !== 0
    ? "ZERO_RATE_NON_ZERO_AMOUNT"
    : Math.abs(expected - amount) >= 0.01
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

/** 调休兑现唯一来源：只汇总指定月、状态为active的唯一事件。 */
export function settleCompOffCashOut(entries: readonly CompOffBalanceEntry[], employeeId: string, month: string): CompOffCashOutSettlement {
  const issues: CompOffCashOutIssue[] = [];
  const lines: CompOffCashOutSettlementLine[] = [];
  for (const rawEntry of entries) {
    if (rawEntry.employeeId !== employeeId || rawEntry.status !== "cashed_out" || rawEntry.usedMonth !== month) continue;
    const entry = migrateLegacyCompOffSettlement(rawEntry);
    const event = entry.settlement;
    if (!event) {
      issues.push({ entryId: entry.id, employeeId, month, code: "MISSING_SETTLEMENT", amount: 0, description: "已兑现余额没有可验证的兑现事件。" });
      continue;
    }
    if (event.status !== "active") {
      issues.push({ entryId: entry.id, employeeId, month, code: event.issueCode ?? "MISSING_SETTLEMENT", amount: event.amount, description: event.issueCode === "ZERO_RATE_NON_ZERO_AMOUNT" ? "零费率却存有兑现金额，已从薪资结算隔离。" : "兑现事件已隔离或作废，不进入薪资。" });
      continue;
    }
    const expected = expectedAmount(event.days, event.unitRate);
    if (event.unitRate <= 0 || Math.abs(expected - event.amount) >= 0.01) {
      issues.push({ entryId: entry.id, employeeId, month, code: event.unitRate <= 0 ? "ZERO_RATE_NON_ZERO_AMOUNT" : "AMOUNT_RATE_MISMATCH", amount: event.amount, description: "兑现事件费率、天数与金额不一致，已从薪资结算隔离。" });
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

/** 非零差额说明薪资单含有无法对应到有效事件的遗留兑现，必须核对，不能静默保留。 */
export function getLegacyCompOffCashOutDelta(slip: Pick<PaySlip, "compOffCashOut">, settlement: CompOffCashOutSettlement): number {
  return roundMoney((slip.compOffCashOut ?? 0) - settlement.amount);
}

export function hasLegacyCompOffCashOut(slip: Pick<PaySlip, "compOffCashOut">, settlement: CompOffCashOutSettlement): boolean {
  return Math.abs(getLegacyCompOffCashOutDelta(slip, settlement)) >= 0.01;
}

export function findCompOffCashOutIssues(entries: readonly CompOffBalanceEntry[], slips: readonly PaySlip[]): readonly CompOffCashOutIssue[] {
  const issues: CompOffCashOutIssue[] = [];
  const employees = new Set([...entries.map((entry) => entry.employeeId), ...slips.map((slip) => slip.employeeId)]);
  const months = new Set([...entries.map((entry) => entry.usedMonth).filter((month): month is string => Boolean(month)), ...slips.map((slip) => slip.month)]);
  for (const employeeId of employees) {
    for (const month of months) {
      const settlement = settleCompOffCashOut(entries, employeeId, month);
      issues.push(...settlement.issues);
      const slip = slips.find((item) => item.employeeId === employeeId && item.month === month);
      const legacyDelta = slip ? getLegacyCompOffCashOutDelta(slip, settlement) : 0;
      if (Math.abs(legacyDelta) >= 0.01) {
        issues.push({ employeeId, month, code: "ORPHAN_PAYSLIP_CASHOUT", amount: legacyDelta, description: `薪资单含有 ¥${legacyDelta} 未关联兑现额；草稿重建将按有效兑现事件归零。` });
      }
    }
  }
  return issues;
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

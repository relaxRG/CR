import { roundMoney, sumMoney } from "@/lib/finance/money";
import type { CompOffBalanceEntry, PaySlip } from "./types";

export type CompOffCashOutSettlement = Readonly<{
  employeeId: string;
  month: string;
  amount: number;
  entryIds: readonly string[];
  lines: readonly Readonly<{
    entryId: string;
    source: CompOffBalanceEntry["source"];
    earnedMonth: string;
    days: number;
    unitRate: number;
    amount: number;
  }>[];
}>;

/** 调休兑现唯一来源：只汇总在指定月明确标记为 cashed_out 的余额流水。 */
export function settleCompOffCashOut(entries: readonly CompOffBalanceEntry[], employeeId: string, month: string): CompOffCashOutSettlement {
  const lines = entries
    .filter((entry) => entry.employeeId === employeeId && entry.status === "cashed_out" && entry.usedMonth === month)
    .map((entry) => ({
      entryId: entry.id,
      source: entry.source,
      earnedMonth: entry.earnedMonth,
      days: entry.days,
      unitRate: entry.cashOutUnitRate ?? 0,
      amount: roundMoney(entry.cashOutAmount ?? 0),
    }));
  return {
    employeeId,
    month,
    amount: sumMoney(lines.map((line) => line.amount)),
    entryIds: lines.map((line) => line.entryId),
    lines,
  };
}

/** 非零差额说明薪资单含有无法对应到余额流水的遗留兑现，必须进入人工核对而不是静默保留。 */
export function getLegacyCompOffCashOutDelta(slip: Pick<PaySlip, "compOffCashOut">, settlement: CompOffCashOutSettlement): number {
  return roundMoney((slip.compOffCashOut ?? 0) - settlement.amount);
}

export function hasLegacyCompOffCashOut(slip: Pick<PaySlip, "compOffCashOut">, settlement: CompOffCashOutSettlement): boolean {
  return Math.abs(getLegacyCompOffCashOutDelta(slip, settlement)) >= 0.01;
}

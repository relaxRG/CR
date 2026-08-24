export interface WinePurchaseComparisonRecord {
  supplier: string;
  productName: string;
  month: string;
  amount: number;
}

export interface WinePurchaseComparisonRow {
  key: string;
  currentAmount: number;
  comparisonAmount: number;
  deltaAmount: number;
  deltaRatio: number | null;
}

export function previousBusinessMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("业务月份必须为 YYYY-MM");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildWinePurchaseComparison(
  records: readonly WinePurchaseComparisonRecord[],
  input: { month: string; comparisonMonth?: string; dimension: "supplier" | "product"; cumulative?: boolean },
): WinePurchaseComparisonRow[] {
  const comparisonMonth = input.comparisonMonth ?? previousBusinessMonth(input.month);
  const inRange = (record: WinePurchaseComparisonRecord, endMonth: string) => input.cumulative ? record.month <= endMonth : record.month === endMonth;
  const current = new Map<string, number>();
  const comparison = new Map<string, number>();
  const collect = (target: Map<string, number>, endMonth: string) => records.filter((record) => inRange(record, endMonth)).forEach((record) => {
    const key = input.dimension === "supplier" ? record.supplier : record.productName;
    target.set(key, (target.get(key) ?? 0) + record.amount);
  });
  collect(current, input.month);
  collect(comparison, comparisonMonth);
  return Array.from(new Set([...current.keys(), ...comparison.keys()]))
    .map((key) => {
      const currentAmount = current.get(key) ?? 0;
      const comparisonAmount = comparison.get(key) ?? 0;
      const deltaAmount = currentAmount - comparisonAmount;
      return { key, currentAmount, comparisonAmount, deltaAmount, deltaRatio: comparisonAmount === 0 ? null : deltaAmount / comparisonAmount };
    })
    .sort((left, right) => right.currentAmount - left.currentAmount || left.key.localeCompare(right.key, "zh-Hans-CN"));
}

export function toCents(value: number | null | undefined): number {
  const safe = Number.isFinite(value) ? Number(value) : 0;
  return Math.round(safe * 100);
}

export function fromCents(value: number): number {
  return Math.round(value) / 100;
}

export function roundMoney(value: number | null | undefined): number {
  return fromCents(toCents(value));
}

/**
 * 财务汇总必须在“分”层级相加，禁止直接 reduce 浮点元金额。
 */
export function sumMoney(values: ReadonlyArray<number | null | undefined>): number {
  return fromCents(values.reduce<number>((sum, value) => sum + toCents(value), 0));
}

export function subtractMoney(minuend: number | null | undefined, subtrahends: ReadonlyArray<number | null | undefined>): number {
  return fromCents(toCents(minuend) - subtrahends.reduce<number>((sum, value) => sum + toCents(value), 0));
}

export function multiplyMoney(unitAmount: number | null | undefined, quantity: number | null | undefined): number {
  const unit = Number.isFinite(unitAmount) ? Number(unitAmount) : 0;
  const count = Number.isFinite(quantity) ? Number(quantity) : 0;
  return roundMoney(unit * count);
}

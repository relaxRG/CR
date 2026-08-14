export type InventoryMonth = `${number}-${string}`;

export interface InventoryMonthBounds {
  min: InventoryMonth;
  max: InventoryMonth;
}

function formatMonth(year: number, month: number): InventoryMonth {
  return `${year}-${String(month).padStart(2, "0")}` as InventoryMonth;
}

/** 将 YYYY-MM、YYYY-MM-DD、YYYY年M月 规范为唯一的 YYYY-MM。 */
export function normalizeInventoryMonth(raw?: string | null): InventoryMonth | null {
  if (!raw) return null;
  const value = raw.trim();
  const iso = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  const cn = value.match(/^(\d{4})年(\d{1,2})月$/);
  const match = iso ?? cn;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = iso?.[3] == null ? null : Number(iso[3]);
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 1 || month > 12) return null;
  if (day != null && (day < 1 || day > new Date(year, month, 0).getDate())) return null;
  return formatMonth(year, month);
}

export function getCurrentInventoryMonth(now = new Date()): InventoryMonth {
  return formatMonth(now.getFullYear(), now.getMonth() + 1);
}

export function addInventoryMonths(month: InventoryMonth, offset: number): InventoryMonth {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + offset, 1);
  return formatMonth(date.getFullYear(), date.getMonth() + 1);
}

/**
 * 从十类库存的有效业务月份并集得到唯一可选范围。
 * 仅给最早、最晚业务月各留一个月缓冲；无任何业务记录时仅允许当前月。
 */
export function deriveInventoryMonthBounds(
  rawMonths: Array<string | null | undefined>,
  currentMonth = getCurrentInventoryMonth(),
): InventoryMonthBounds {
  const months = [...new Set(rawMonths.map(normalizeInventoryMonth).filter((month): month is InventoryMonth => month !== null))]
    .sort((left, right) => left.localeCompare(right));

  if (months.length === 0) return { min: currentMonth, max: currentMonth };
  return {
    min: addInventoryMonths(months[0], -1),
    max: addInventoryMonths(months[months.length - 1], 1),
  };
}

export function clampInventoryMonth(month: string | null | undefined, bounds: InventoryMonthBounds): InventoryMonth {
  const normalized = normalizeInventoryMonth(month) ?? bounds.max;
  if (normalized < bounds.min) return bounds.min;
  if (normalized > bounds.max) return bounds.max;
  return normalized;
}

export function canNavigateInventoryMonth(
  current: InventoryMonth,
  offset: -1 | 1,
  bounds: InventoryMonthBounds,
): boolean {
  const target = addInventoryMonths(current, offset);
  return target >= bounds.min && target <= bounds.max;
}

export function inventoryMonthsForYear(year: number, bounds: InventoryMonthBounds): InventoryMonth[] {
  return Array.from({ length: 12 }, (_, index) => formatMonth(year, index + 1))
    .filter((month) => month >= bounds.min && month <= bounds.max);
}

export function inventoryMonthLabel(month: InventoryMonth): string {
  const [year, value] = month.split("-").map(Number);
  return `${year}年${value}月`;
}

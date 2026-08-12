function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year: number, month: number, day: number): string | null {
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 将库存导入来源的日期归一化为 YYYY-MM-DD；不能可靠解析时返回 null。 */
export function normalizeImportDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 25569 && value < 60000) {
    const date = new Date((value - 25569) * 86400 * 1000);
    return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{8}$/.test(text)) {
    return formatDate(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
  }

  const ymd = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\D|$)/);
  if (ymd) return formatDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const chinese = text.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\D|$)/);
  if (chinese) return formatDate(Number(chinese[1]), Number(chinese[2]), Number(chinese[3]));

  const mdY = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\D|$)/);
  if (mdY) {
    const first = Number(mdY[1]);
    const second = Number(mdY[2]);
    const year = Number(mdY[3]);
    return first > 12
      ? formatDate(year, second, first)
      : formatDate(year, first, second);
  }

  return null;
}

export function getImportMonth(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 7) : null;
}

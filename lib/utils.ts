import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names using clsx and tailwind-merge.
 * This ensures Tailwind classes are properly merged without conflicts.
 *
 * Usage:
 * ```tsx
 * cn("px-4 py-2", isActive && "bg-primary", className)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Bilingual display priority: return [primary, secondary] name pair
 * following the UI language (en → English first, zh → Chinese first).
 * Falls back to the other name when the preferred one is empty.
 */
/** Detect CJK characters (Chinese/Japanese/Korean) */
function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(s);
}

/**
 * Bilingual display priority: return [primary, secondary] name pair
 * following the UI language (en → English first, zh → Chinese first).
 * Falls back to the other name when the preferred one is empty.
 *
 * Auto-corrects swapped parameters: if `en` contains CJK characters but `zh`
 * does not, the caller likely passed (zhName, enName) — parameters are swapped
 * automatically so the correct language always shows as primary.
 */
export function displayNames(
  en: string,
  zh: string,
  lang: "zh" | "en",
): { primary: string; secondary: string } {
  let e = (en || "").trim();
  let z = (zh || "").trim();
  // Auto-correct: if en looks like Chinese and zh looks like English, swap them
  if (e && z && hasCJK(e) && !hasCJK(z)) {
    [e, z] = [z, e];
  }
  const primary = lang === "en" ? e || z : z || e;
  const secondaryRaw = lang === "en" ? (e ? z : "") : (z ? e : "");
  return { primary, secondary: secondaryRaw === primary ? "" : secondaryRaw };
}

/**
 * 智能金额格式化：整数不显示小数点，有小数则保留两位
 *
 * - ¥9305   → "9305"
 * - ¥345.5  → "345.50"
 * - ¥12.34  → "12.34"
 * - ¥0.1    → "0.10"
 *
 * 使用方式：`¥${formatMoney(amount)}`
 */
export function formatMoney(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

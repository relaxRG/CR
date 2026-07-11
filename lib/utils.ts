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
export function displayNames(
  en: string,
  zh: string,
  lang: "zh" | "en",
): { primary: string; secondary: string } {
  const e = (en || "").trim();
  const z = (zh || "").trim();
  const primary = lang === "en" ? e || z : z || e;
  const secondaryRaw = lang === "en" ? (e ? z : "") : (z ? e : "");
  return { primary, secondary: secondaryRaw === primary ? "" : secondaryRaw };
}

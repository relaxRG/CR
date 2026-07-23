import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Lang } from "@/lib/i18n/translations";

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
 * Returns { primary, secondary } display names based on language.
 * For zh: primary=zh name, secondary=en name (if different)
 * For en: primary=en name (if exists), secondary=zh name (if different)
 */
export function displayNames(
  nameEn: string | undefined | null,
  nameZh: string | undefined | null,
  lang: Lang,
): { primary: string; secondary: string | null } {
  const zh = nameZh?.trim() || "";
  const en = nameEn?.trim() || "";
  if (lang === "en") {
    const primary = en || zh;
    const secondary = en && zh && en !== zh ? zh : null;
    return { primary, secondary };
  }
  // zh
  const primary = zh || en;
  const secondary = zh && en && zh !== en ? en : null;
  return { primary, secondary };
}

// Ingredient input suggestions: live search across the bottle library and homemade lab.
// Display priority follows the UI language (en → English name first; zh → Chinese first).
import { Bottle } from "./bottles/types";
import { HomemadePrep } from "./homemade/types";

export interface IngredientSuggestion {
  /** Unique key for list rendering */
  key: string;
  /** Value inserted into the ingredient name field */
  value: string;
  /** Secondary label shown next to the value (alt-language name) */
  secondary: string;
  /** Source library */
  source: "bottle" | "homemade";
  /** Category / type label for context */
  context: string;
  /** Navigation id in its library */
  refId: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Search bottles + homemade preps for names containing the query (bilingual).
 * Returns at most `limit` suggestions, homemade preps first (more specific),
 * then bottles; within each group, prefix matches rank before substring matches.
 */
export function suggestIngredients(
  query: string,
  bottles: Bottle[],
  preps: HomemadePrep[],
  lang: "zh" | "en",
  limit = 6,
): IngredientSuggestion[] {
  const q = norm(query);
  if (q.length < 1) return [];
  const isCjk = /[\u4e00-\u9fff]/.test(q);
  if (!isCjk && q.length < 2) return [];

  type Scored = { s: IngredientSuggestion; score: number };
  const out: Scored[] = [];

  const scoreName = (name: string): number => {
    const n = norm(name);
    if (!n) return 0;
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    return 0;
  };

  for (const p of preps) {
    const score = Math.max(scoreName(p.name), scoreName(p.nameAlt));
    if (score > 0) {
      const primary = lang === "en" ? p.name || p.nameAlt : p.nameAlt || p.name;
      const secondary = lang === "en" ? (p.name ? p.nameAlt : "") : (p.nameAlt ? p.name : "");
      out.push({
        s: {
          key: `hm-${p.id}`,
          value: primary,
          secondary: secondary === primary ? "" : secondary,
          source: "homemade",
          context: p.type,
          refId: p.id,
        },
        // Homemade entries get a small boost: they're user-curated
        score: score + 5,
      });
    }
  }

  for (const b of bottles) {
    const score = Math.max(scoreName(b.nameZh), scoreName(b.nameEn), scoreName(b.brand));
    if (score > 0) {
      const primary = lang === "en" ? b.nameEn || b.nameZh : b.nameZh || b.nameEn;
      const secondary = lang === "en" ? (b.nameEn ? b.nameZh : "") : (b.nameZh ? b.nameEn : "");
      out.push({
        s: {
          key: `bt-${b.id}`,
          value: primary,
          secondary: secondary === primary ? "" : secondary,
          source: "bottle",
          context: b.category,
          refId: b.id,
        },
        score,
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.s);
}

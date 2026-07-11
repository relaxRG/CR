import { Recipe } from "./types";

/**
 * Filter recipes by free-text query (name, ingredients, notes, base spirit)
 * and optional category / favorite filters.
 */
export function filterRecipes(
  recipes: Recipe[],
  query: string,
  filter: {
    categoryId?: string | null;
    favoritesOnly?: boolean;
    codexFamily?: string;
    flavor?: string;
    /** 多选:分类 id 集合(与 categoryId 二选一,优先生效) */
    categoryIds?: string[];
    /** 多选:Codex 家族集合 */
    codexFamilies?: string[];
    /** 多选:风味标签集合(命中任一即通过) */
    flavors?: string[];
    /** 多选:烈度集合 */
    strengths?: string[];
    /** 多选:饮用时长集合(短饮/长饮) */
    durations?: string[];
    /** 多选:饮用场合集合(餐前酒/餐后酒等) */
    occasions?: string[];
    /** 多选:基酒集合(快捷筛选子分类用) */
    baseSpirits?: string[];
  },
): Recipe[] {
  const q = query.trim().toLowerCase();
  return recipes.filter((r) => {
    if (filter.favoritesOnly && !r.favorite) return false;
    if (filter.baseSpirits && filter.baseSpirits.length > 0) {
      if (!filter.baseSpirits.includes(r.baseSpirit)) return false;
    }
    if (filter.categoryIds && filter.categoryIds.length > 0) {
      if (r.categoryId === null || !filter.categoryIds.includes(r.categoryId)) return false;
    } else if (filter.categoryId !== undefined && filter.categoryId !== null) {
      if (r.categoryId !== filter.categoryId) return false;
    }
    if (filter.codexFamilies && filter.codexFamilies.length > 0) {
      if (!filter.codexFamilies.includes(r.codexFamily)) return false;
    } else if (filter.codexFamily && r.codexFamily !== filter.codexFamily) return false;
    if (filter.flavors && filter.flavors.length > 0) {
      if (!filter.flavors.some((f) => r.flavors.includes(f))) return false;
    } else if (filter.flavor && !r.flavors.includes(filter.flavor)) return false;
    if (filter.strengths && filter.strengths.length > 0) {
      if (!filter.strengths.includes(r.strength)) return false;
    }
    if (filter.durations && filter.durations.length > 0) {
      if (!filter.durations.includes(r.drinkDuration)) return false;
    }
    if (filter.occasions && filter.occasions.length > 0) {
      if (!filter.occasions.includes(r.occasion)) return false;
    }
    if (!q) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    if (r.nameEn.toLowerCase().includes(q)) return true;
    if (r.baseSpirit.toLowerCase().includes(q)) return true;
    if (r.notes.toLowerCase().includes(q)) return true;
    if ((r.story ?? "").toLowerCase().includes(q)) return true;
    if ((r.flavorDesc ?? "").toLowerCase().includes(q)) return true;
    if (r.garnish.toLowerCase().includes(q)) return true;
    if (r.variantOf.toLowerCase().includes(q)) return true;
    if (r.codexFamily.toLowerCase().includes(q)) return true;
    if (r.source.toLowerCase().includes(q)) return true;
    if (r.flavors.some((f) => f.toLowerCase().includes(q))) return true;
    // 中英文互认:英文搜索词归一化为中文后再匹配(如搜 gin 命中"金酒"),
    // 配料若是英文也归一化后与搜索词比对(如搜"金酒"命中 Gin)
    const qZh = normalizeIngredientName(q).toLowerCase();
    return r.ingredients.some((i) => {
      const n = i.name.toLowerCase();
      if (n.includes(q)) return true;
      if (qZh !== q && n.includes(qZh)) return true;
      const nZh = normalizeIngredientName(i.name).toLowerCase();
      return nZh !== n && (nZh.includes(q) || nZh.includes(qZh));
    });
  });
}
import { normalizeIngredientName } from "../bottles/cost";

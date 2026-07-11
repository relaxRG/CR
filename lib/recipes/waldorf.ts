/**
 * 《The Waldorf Astoria Bar Book》(Frank Caiafa) 配方数据集导入。
 * 数据来自书籍 EPUB 的结构化提取(447 份配方),打包为 JSON 资产随应用分发。
 * 首次启动(或升级后首次加载)时一次性合入本地存储,之后由用户完全管理。
 */
import type { Category, Recipe } from "./types";
import { genId } from "./types";

// Metro 支持直接 require JSON 资产
// eslint-disable-next-line @typescript-eslint/no-require-imports
const raw = require("../../assets/waldorf-recipes.json") as {
  recipes: WaldorfRecipe[];
  categories: { id: string; name: string; nameEn: string }[];
};

interface WaldorfRecipe {
  nameEn: string;
  name: string;
  categoryId: string;
  baseSpirit: string;
  glass: string;
  method: string;
  ice: string;
  codexFamily: string;
  ingredients: { id: string; name: string; amount: string }[];
  steps: string;
  garnish: string;
  source: string;
  story: string;
  abv: number | null;
  notes: string;
}

/** 数据集标识:变更数据集时递增,可触发再次导入(按名称去重不会产生重复) */
export const WALDORF_DATASET_KEY = "cocktail_waldorf_imported_v1";

/** 构建书中新增的分类(已存在的 id 由调用方去重) */
export function buildWaldorfCategories(): Category[] {
  const now = Date.now();
  const colors = ["#7B5EA7", "#3E7A5E", "#C0841A", "#B0413E", "#2E6E8E", "#8A6D3B", "#5B7065"];
  return raw.categories.map((c, i) => ({
    id: c.id,
    name: c.name,
    nameEn: c.nameEn,
    color: colors[i % colors.length],
    createdAt: now + i,
  }));
}

/** 构建全部 Waldorf 配方(完整 Recipe 对象) */
export function buildWaldorfRecipes(): Recipe[] {
  const now = Date.now();
  return raw.recipes.map((r, i) => ({
    id: `waldorf-${genId()}-${i}`,
    name: r.name,
    nameEn: r.nameEn,
    categoryId: r.categoryId,
    baseSpirit: r.baseSpirit,
    glass: r.glass,
    method: r.method,
    ice: r.ice,
    strength: r.abv === null ? "medium" : r.abv < 15 ? "light" : r.abv < 25 ? "medium" : "strong",
    strengthBand: "",
    abv: r.abv,
    variantOf: "",
    codexFamily: r.codexFamily,
    flavors: [],
    drinkDuration: "",
    occasion: "",
    source: r.source,
    story: r.story,
    flavorDesc: "",
    ingredients: r.ingredients,
    steps: r.steps,
    garnish: r.garnish,
    notes: r.notes,
    favorite: false,
    made: false,
    rating: null,
    sortIndex: null,
    cardTagOrder: null,
    createdAt: now + i,
    updatedAt: now + i,
  }));
}

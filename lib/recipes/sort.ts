/**
 * 排序引擎:酒单与自制库共用的多方式排序。
 * 排序作用于"同名分组后的组",取组内首个条目的指标作为组指标。
 */
import { Recipe } from "./types";
import { HomemadePrep } from "../homemade/types";
import { Bottle } from "../bottles/types";

export const RECIPE_SORTS = [
  "default",
  "manual",
  "name",
  "abvAsc",
  "abvDesc",
  "costAsc",
  "costDesc",
  "ratingDesc",
  "newest",
  "favorites",
] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];

export const PREP_SORTS = [
  "default",
  "manual",
  "name",
  "costAsc",
  "costDesc",
  "ratingDesc",
  "newest",
] as const;
export type PrepSort = (typeof PREP_SORTS)[number];

export const BOTTLE_SORTS = [
  "default",
  "manual",
  "name",
  "priceAsc",
  "priceDesc",
  "abvAsc",
  "abvDesc",
  "ratingDesc",
  "newest",
] as const;
export type BottleSort = (typeof BOTTLE_SORTS)[number];

/** 名称比较:中文用拼音序(localeCompare zh),英文字母序 */
function compareName(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN");
}

/** 手动排序:sortIndex 升序,未设置的排在末尾(保持相对原顺序) */
function byManual(ia: number | null | undefined, ib: number | null | undefined): number {
  const a = ia ?? null;
  const b = ib ?? null;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * 配方排序。costOf 由调用方传入(成本依赖酒库/自制库上下文)。
 * 返回新数组,不修改原数组。default 保持原顺序。
 */
export function sortRecipes(
  recipes: Recipe[],
  sort: RecipeSort,
  opts: {
    costOf?: (r: Recipe) => number | null;
    nameOf?: (r: Recipe) => string;
  } = {},
): Recipe[] {
  if (sort === "default") return recipes;
  const arr = [...recipes];
  const nameOf = opts.nameOf ?? ((r: Recipe) => r.name || r.nameEn);
  const costOf = opts.costOf ?? (() => null);
  /** null 值始终排在末尾 */
  const byNullable = (
    va: number | null,
    vb: number | null,
    dir: 1 | -1,
  ): number => {
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir;
  };
  switch (sort) {
    case "manual":
      arr.sort((a, b) => byManual(a.sortIndex, b.sortIndex));
      break;
    case "name":
      arr.sort((a, b) => compareName(nameOf(a), nameOf(b)));
      break;
    case "abvAsc":
      arr.sort((a, b) => byNullable(a.abv ?? null, b.abv ?? null, 1));
      break;
    case "abvDesc":
      arr.sort((a, b) => byNullable(a.abv ?? null, b.abv ?? null, -1));
      break;
    case "costAsc":
      arr.sort((a, b) => byNullable(costOf(a), costOf(b), 1));
      break;
    case "costDesc":
      arr.sort((a, b) => byNullable(costOf(a), costOf(b), -1));
      break;
    case "ratingDesc":
      arr.sort((a, b) => byNullable(a.rating ?? null, b.rating ?? null, -1));
      break;
    case "newest":
      arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      break;
    case "favorites":
      arr.sort((a, b) => Number(b.favorite) - Number(a.favorite));
      break;
  }
  return arr;
}

/** 自制品排序。costOf 传入每 30ml 成本或批次成本。 */
export function sortPreps(
  preps: HomemadePrep[],
  sort: PrepSort,
  opts: {
    costOf?: (p: HomemadePrep) => number | null;
    nameOf?: (p: HomemadePrep) => string;
  } = {},
): HomemadePrep[] {
  if (sort === "default") return preps;
  const arr = [...preps];
  const nameOf = opts.nameOf ?? ((p: HomemadePrep) => p.name || p.nameAlt);
  const costOf = opts.costOf ?? (() => null);
  const byNullable = (va: number | null, vb: number | null, dir: 1 | -1): number => {
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir;
  };
  switch (sort) {
    case "manual":
      arr.sort((a, b) => byManual(a.sortIndex, b.sortIndex));
      break;
    case "name":
      arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN"));
      break;
    case "costAsc":
      arr.sort((a, b) => byNullable(costOf(a), costOf(b), 1));
      break;
    case "costDesc":
      arr.sort((a, b) => byNullable(costOf(a), costOf(b), -1));
      break;
    case "ratingDesc":
      arr.sort((a, b) => byNullable(a.rating ?? null, b.rating ?? null, -1));
      break;
    case "newest":
      arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      break;
  }
  return arr;
}

/** 酒库排序:价格为 0 视为未知,排在末尾 */
export function sortBottles(
  bottles: Bottle[],
  sort: BottleSort,
  opts: { nameOf?: (b: Bottle) => string } = {},
): Bottle[] {
  if (sort === "default") return bottles;
  const arr = [...bottles];
  const nameOf = opts.nameOf ?? ((b: Bottle) => b.nameZh || b.nameEn);
  const byNullable = (va: number | null, vb: number | null, dir: 1 | -1): number => {
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * dir;
  };
  const priceOf = (b: Bottle): number | null => (b.priceCny > 0 ? b.priceCny : null);
  switch (sort) {
    case "manual":
      arr.sort((a, b) => byManual(a.sortIndex, b.sortIndex));
      break;
    case "name":
      arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN"));
      break;
    case "priceAsc":
      arr.sort((a, b) => byNullable(priceOf(a), priceOf(b), 1));
      break;
    case "priceDesc":
      arr.sort((a, b) => byNullable(priceOf(a), priceOf(b), -1));
      break;
    case "abvAsc":
      arr.sort((a, b) => byNullable(a.abv ?? null, b.abv ?? null, 1));
      break;
    case "abvDesc":
      arr.sort((a, b) => byNullable(a.abv ?? null, b.abv ?? null, -1));
      break;
    case "ratingDesc":
      arr.sort((a, b) => byNullable(a.rating ?? null, b.rating ?? null, -1));
      break;
    case "newest":
      arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      break;
  }
  return arr;
}

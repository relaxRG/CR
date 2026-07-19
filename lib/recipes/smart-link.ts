/**
 * 智能配料链接引擎:把配方配料名自动匹配到酒库(Bottle)或自制库(HomemadePrep)条目。
 *
 * 统一多级匹配策略(优先级从高到低):
 * 1. 精确匹配:配料名 === 酒款中/英名 或 自制品中/英名
 * 2. Waldorf 别名规范化后精确匹配(903 条原始名 → 规范中英名)
 * 3. 同义词规范化(英文类别词 → 中文)后精确匹配
 * 4. 包含匹配(双向,长度加权,自制优先级与酒款同台竞争取最高分)
 *
 * 返回统一 SmartLink 结构,供详情页跳转、成本估算、表单实时提示复用。
 */
import type { Bottle } from "../bottles/types";
import type { HomemadePrep } from "../homemade/types";
import { matchBottle, normalizeIngredientName } from "../bottles/cost";
import { matchPrep } from "../homemade/match";
import { resolveIngredientNames } from "./ingredient-display";
import { stripForm } from "./form-fold";

export type SmartLink =
  | { kind: "bottle"; bottle: Bottle; form?: { key: string; factor: number }; matchConfidence: "exact" | "fuzzy" }
  | { kind: "prep"; prep: HomemadePrep; matchConfidence: "exact" | "fuzzy" }
  | null;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 精确匹配酒库(中/英/品牌名全等) */
function exactBottle(name: string, bottles: Bottle[]): Bottle | null {
  const key = norm(name);
  if (!key) return null;
  return (
    bottles.find(
      (b) => norm(b.nameZh) === key || norm(b.nameEn) === key || (b.brand && norm(b.brand) === key),
    ) ?? null
  );
}

/** 精确匹配自制库(中/英名全等) */
function exactPrep(name: string, preps: HomemadePrep[]): HomemadePrep | null {
  const key = norm(name);
  if (!key) return null;
  return preps.find((p) => norm(p.name) === key || norm(p.nameAlt) === key) ?? null;
}

/**
 * 智能匹配单个配料名 → 酒库或自制库条目。
 * 自制库精确命中优先于酒库模糊命中;两边都只有模糊命中时,自制优先
 * (自制品通常是配方中明确写出的自制成分,如"蜂蜜糖浆")。
 */
export function smartLinkIngredient(
  rawName: string,
  bottles: Bottle[],
  preps: HomemadePrep[],
  preferredSource?: "auto" | "spirits" | "bottles" | "materials" | "homemade",
): SmartLink {
  const name = rawName.trim();
  if (!name || name.length < 2) return null;

  // 按用户指定来源库过滤
  const SPIRITS_CATS = new Set(["Gin","Vodka","Rum","Whiskey","Agave Spirits","Brandy","Sake & Shochu","Baijiu"]);
  const MATERIALS_CATS = new Set(["Sugars & Sweeteners","Fruits & Vegetables","Spices & Botanicals",
    "Flowers & Florals","Tea, Coffee & Cacao","Nuts & Grains","Dairy & Egg","Acids & Additives"]);
  let filteredBottles = bottles;
  let filteredPreps = preps;
  if (preferredSource && preferredSource !== "auto") {
    if (preferredSource === "homemade") {
      filteredBottles = [];
    } else if (preferredSource === "spirits") {
      filteredPreps = [];
      filteredBottles = bottles.filter((b) => b.libraryOverride !== 'homemade' && SPIRITS_CATS.has(b.category ?? ""));
    } else if (preferredSource === "bottles") {
      filteredPreps = [];
      filteredBottles = bottles.filter((b) => b.libraryOverride !== 'homemade' && !SPIRITS_CATS.has(b.category ?? "") && !MATERIALS_CATS.has(b.category ?? ""));
    } else if (preferredSource === "materials") {
      filteredPreps = [];
      filteredBottles = bottles.filter((b) => b.libraryOverride !== 'homemade' && MATERIALS_CATS.has(b.category ?? ""));
    }
  } else {
    // auto 模式（Bug 1 修复）：不再排除 libraryOverride='homemade' 的酒款。
    // 这类条目（如"脱水菠萝"）虽然展示在自制库，但数据上仍是酒款，装饰行/配料行
    // 应能匹配到本尊并跳转到酒款详情页。同名歧义处理：若存在 override 酒款，
    // 先对真实自制品(prep)做一轮精确匹配，命中则优先返回 prep。
    const hasOverride = bottles.some((b) => b.libraryOverride === 'homemade');
    if (hasOverride) {
      const priorityPrep = exactPrep(name, preps);
      if (priorityPrep) return { kind: "prep", prep: priorityPrep, matchConfidence: "exact" };
    }
    filteredBottles = bottles;
  }

  // 1) 双边精确匹配(原文)
  const eb = exactBottle(name, filteredBottles);
  if (eb) return { kind: "bottle", bottle: eb, matchConfidence: "exact" };
  const ep = exactPrep(name, filteredPreps);
  if (ep) return { kind: "prep", prep: ep, matchConfidence: "exact" };

  // 2) Waldorf 别名规范化 → 双边精确匹配
  const resolved = resolveIngredientNames(name, filteredBottles, filteredPreps);
  if (resolved) {
    for (const candidate of [resolved.zh, resolved.en]) {
      if (!candidate || norm(candidate) === norm(name)) continue;
      const b = exactBottle(candidate, filteredBottles);
      if (b) return { kind: "bottle", bottle: b, matchConfidence: "exact" };
      const p = exactPrep(candidate, filteredPreps);
      if (p) return { kind: "prep", prep: p, matchConfidence: "exact" };
    }
  }

  // 3) 同义词规范化(英文类别词 → 中文)后精确匹配
  const normalized = normalizeIngredientName(name);
  if (normalized && norm(normalized) !== norm(name)) {
    const b = exactBottle(normalized, filteredBottles);
    if (b) return { kind: "bottle", bottle: b, matchConfidence: "exact" };
    const p = exactPrep(normalized, filteredPreps);
    if (p) return { kind: "prep", prep: p, matchConfidence: "exact" };
  }

  // 4) 模糊匹配:自制优先,其次酒库
  const strippedEarly = stripForm(name);
  if (strippedEarly.form && strippedEarly.base && norm(strippedEarly.base) !== norm(name)) {
    const ebE = exactBottle(strippedEarly.base, filteredBottles);
    if (ebE)
      return {
        kind: "bottle",
        bottle: ebE,
        form: { key: strippedEarly.form, factor: strippedEarly.factor },
        matchConfidence: "exact",
      };
  }
  const fp = matchPrep(name, filteredPreps);
  if (fp) return { kind: "prep", prep: fp, matchConfidence: "fuzzy" };
  const fb = matchBottle(name, filteredBottles);
  if (fb) {
    if (
      strippedEarly.form &&
      (norm(fb.nameZh ?? "") === norm(strippedEarly.base) || norm(fb.nameEn ?? "") === norm(strippedEarly.base))
    ) {
      return {
        kind: "bottle",
        bottle: fb,
        form: { key: strippedEarly.form, factor: strippedEarly.factor },
        matchConfidence: "fuzzy",
      };
    }
    return { kind: "bottle", bottle: fb, matchConfidence: "fuzzy" };
  }

  // 5) 规范名再走一轮模糊
  if (resolved) {
    for (const candidate of [resolved.zh, resolved.en]) {
      if (!candidate) continue;
      const p2 = matchPrep(candidate, filteredPreps);
      if (p2) return { kind: "prep", prep: p2, matchConfidence: "fuzzy" };
      const b2 = matchBottle(candidate, filteredBottles);
      if (b2) return { kind: "bottle", bottle: b2, matchConfidence: "fuzzy" };
    }
  }

  // 6) 形态折叠
  const stripped = strippedEarly;
  if (stripped.form && stripped.base && norm(stripped.base) !== norm(name)) {
    const normalizedBase = normalizeIngredientName(stripped.base);
    if (normalizedBase && norm(normalizedBase) !== norm(stripped.base)) {
      const eb3 = exactBottle(normalizedBase, filteredBottles);
      if (eb3)
        return { kind: "bottle", bottle: eb3, form: { key: stripped.form, factor: stripped.factor }, matchConfidence: "exact" };
    }
    const fb2 = matchBottle(stripped.base, filteredBottles);
    if (fb2)
      return { kind: "bottle", bottle: fb2, form: { key: stripped.form, factor: stripped.factor }, matchConfidence: "fuzzy" };
  }
  return null;
}

/** 批量匹配配方全部配料,返回 Map<ingredientId, SmartLink> */
export function smartLinkAll(
  ingredients: { id: string; name: string }[],
  bottles: Bottle[],
  preps: HomemadePrep[],
): Map<string, SmartLink> {
  const out = new Map<string, SmartLink>();
  for (const ing of ingredients) {
    out.set(ing.id, smartLinkIngredient(ing.name, bottles, preps));
  }
  return out;
}

/**
 * 智能显示名:配料匹配到产品后,直接用产品在酒库/自制库中的规范名替换显示。
 * - 中文界面:主名=产品中文名(缺则英文),副名=英文名
 * - 英文界面:主名=产品英文名(缺则中文),副名=中文名
 * 未匹配时返回 null(调用方回退到原有 ingredientDisplayName)。
 */
export function smartLinkDisplayName(
  link: SmartLink,
  lang: "zh" | "en",
): { primary: string; secondary: string } | null {
  if (!link) return null;
  let zh = "";
  let en = "";
  if (link.kind === "bottle") {
    zh = link.bottle.nameZh?.trim() ?? "";
    en = link.bottle.nameEn?.trim() ?? "";
  } else {
    // 自制库约定: name 可能是英文或中文, nameAlt 为另一语言
    const a = link.prep.name?.trim() ?? "";
    const b = link.prep.nameAlt?.trim() ?? "";
    const isZh = (s: string) => /[\u4e00-\u9fff]/.test(s);
    if (isZh(a)) {
      zh = a;
      en = b;
    } else {
      en = a;
      zh = isZh(b) ? b : b || "";
    }
  }
  const primary = lang === "zh" ? zh || en : en || zh;
  const secondary = lang === "zh" ? (zh ? en : "") : en ? zh : "";
  if (!primary) return null;
  return { primary, secondary: secondary === primary ? "" : secondary };
}

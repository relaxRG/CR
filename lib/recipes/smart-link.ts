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
  | { kind: "bottle"; bottle: Bottle; form?: { key: string; factor: number } }
  | { kind: "prep"; prep: HomemadePrep }
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
): SmartLink {
  const name = rawName.trim();
  if (!name || name.length < 2) return null;

  // 1) 双边精确匹配(原文)——库内若存在同名形态条目(如独立的"柠檬皮"卡片),
  //    直接精确命中该条目本身,按其自身价格/规格计价;
  //    只有库内没有该形态条目时,才会走 4.5 的母条目 × 系数换算兜底。
  const eb = exactBottle(name, bottles);
  if (eb) return { kind: "bottle", bottle: eb };
  const ep = exactPrep(name, preps);
  if (ep) return { kind: "prep", prep: ep };

  // 2) Waldorf 别名规范化 → 双边精确匹配
  const resolved = resolveIngredientNames(name, bottles, preps);
  if (resolved) {
    for (const candidate of [resolved.zh, resolved.en]) {
      if (!candidate || norm(candidate) === norm(name)) continue;
      const b = exactBottle(candidate, bottles);
      if (b) return { kind: "bottle", bottle: b };
      const p = exactPrep(candidate, preps);
      if (p) return { kind: "prep", prep: p };
    }
  }

  // 3) 同义词规范化(英文类别词 → 中文)后精确匹配
  const normalized = normalizeIngredientName(name);
  if (normalized && norm(normalized) !== norm(name)) {
    const b = exactBottle(normalized, bottles);
    if (b) return { kind: "bottle", bottle: b };
    const p = exactPrep(normalized, preps);
    if (p) return { kind: "prep", prep: p };
  }

  // 4) 模糊匹配:自制优先,其次酒库(matchBottle 含类别兜底)
  // 4.5) 形态折叠优先于模糊匹配:"柠檬皮"应按"柠檬"母条目+皮系数计价,
  //      而不是让模糊匹配把"柠檬皮"当普通液体配料命中"柠檬"。
  const strippedEarly = stripForm(name);
  if (strippedEarly.form && strippedEarly.base && norm(strippedEarly.base) !== norm(name)) {
    const ebE = exactBottle(strippedEarly.base, bottles);
    if (ebE)
      return {
        kind: "bottle",
        bottle: ebE,
        form: { key: strippedEarly.form, factor: strippedEarly.factor },
      };
  }
  const fp = matchPrep(name, preps);
  if (fp) return { kind: "prep", prep: fp };
  const fb = matchBottle(name, bottles);
  if (fb) {
    // 模糊命中但原名带形态词且命中的正是母条目 → 附加形态信息
    if (
      strippedEarly.form &&
      (norm(fb.nameZh) === norm(strippedEarly.base) || norm(fb.nameEn) === norm(strippedEarly.base))
    ) {
      return {
        kind: "bottle",
        bottle: fb,
        form: { key: strippedEarly.form, factor: strippedEarly.factor },
      };
    }
    return { kind: "bottle", bottle: fb };
  }

  // 5) 规范名再走一轮模糊(处理 Waldorf 别名下的变体写法)
  if (resolved) {
    for (const candidate of [resolved.zh, resolved.en]) {
      if (!candidate) continue;
      const p2 = matchPrep(candidate, preps);
      if (p2) return { kind: "prep", prep: p2 };
      const b2 = matchBottle(candidate, bottles);
      if (b2) return { kind: "bottle", bottle: b2 };
    }
  }

  // 6) 形态折叠:剥离末尾形态词("柠檬皮"→"柠檬")后重新精确/模糊匹配母条目
  const stripped = strippedEarly;
  if (stripped.form && stripped.base && norm(stripped.base) !== norm(name)) {
    const normalizedBase = normalizeIngredientName(stripped.base);
    if (normalizedBase && norm(normalizedBase) !== norm(stripped.base)) {
      const eb3 = exactBottle(normalizedBase, bottles);
      if (eb3)
        return { kind: "bottle", bottle: eb3, form: { key: stripped.form, factor: stripped.factor } };
    }
    const fb2 = matchBottle(stripped.base, bottles);
    if (fb2)
      return { kind: "bottle", bottle: fb2, form: { key: stripped.form, factor: stripped.factor } };
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

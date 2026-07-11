/**
 * 智能成本估算:成本计算与智能配料链接(smartLink)使用同一套匹配。
 *
 * 修复旧 estimateRecipeCost 的问题:
 * - 旧版只用 matchBottle(仅同义词+包含匹配),"Angostura 苦精"等带品牌前缀
 *   或 Waldorf 别名写法的配料匹配不到酒库 → 价格无法显示、总成本偏低。
 * - 新版复用 smartLinkIngredient 的五级匹配(精确/别名/同义词/模糊/规范名再模糊),
 *   酒库与自制库双通道:酒款按 价格/瓶容量*用量 折算,自制品按单位成本折算。
 * - 补充微量单位(dash/pinch/drop/rinse/barspoon 等)的估算,不再因解析不了用量而放弃。
 */
import type { Bottle } from "../bottles/types";
import type { HomemadePrep } from "../homemade/types";
import type { Ingredient } from "./types";
import { parseAmountToMl, parseVolumeToMl } from "../bottles/cost";
import { estimateHomemadeIngredientCost } from "../homemade/cost";
import { smartLinkIngredient, type SmartLink } from "./smart-link";
import { formCost, parseFormCount } from "./form-fold";

export interface SmartIngredientCost {
  ingredient: Ingredient;
  link: SmartLink;
  amountMl: number | null;
  cost: number | null;
  reason: "no_match" | "no_amount" | "no_price" | "no_volume" | null;
  /** 按整瓶计成本(开瓶后易失效产品,如可乐/软饮/非现榨果汁);用量仍按真实份量显示 */
  wholeBottle?: boolean;
  /** 形态折叠成本明细(柠檬皮/黄瓜片等按母条目单件价 × 系数计) */
  formInfo?: { form: string; factor: number; piecePrice: number; count: number };
}

export interface SmartRecipeCost {
  items: SmartIngredientCost[];
  total: number;
  estimatedCount: number;
  totalCount: number;
}

/** 微量/份数单位估算(ml),parseAmountToMl 解析失败时的兜底 */
export function parseAmountLoose(amount: string): number | null {
  const std = parseAmountToMl(amount);
  if (std !== null) return std;
  const a = amount.trim().toLowerCase();
  if (!a) return null;
  const numMatch = a.match(/(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)/);
  let n = 1;
  if (numMatch) {
    const s = numMatch[1].replace(/\s/g, "");
    if (s.includes("/")) {
      const [p, q] = s.split("/").map(Number);
      n = q ? p / q : 1;
    } else {
      n = Number(s);
    }
  }
  if (/dash|抖|滴洒/.test(a)) return n * 0.9;
  if (/drop|滴/.test(a)) return n * 0.05;
  if (/pinch|少许|一撮/.test(a)) return n * 0.3;
  if (/rinse|涮杯|洗杯/.test(a)) return 3;
  if (/barspoon|bar spoon|吧勺|吧匙/.test(a)) return n * 5;
  if (/tsp|茶匙/.test(a)) return n * 5;
  if (/tbsp|汤匙/.test(a)) return n * 15;
  if (/splash|注/.test(a)) return n * 7;
  if (/float|漂浮/.test(a)) return n * 7;
  if (/top|补满|加满/.test(a)) return 60;
  return null;
}

/** 酒库条目的每毫升单价;价格或容量缺失返回 null */
function bottleUnitPrice(bottle: Bottle): number | null {
  if (!bottle.priceCny || bottle.priceCny <= 0) return null;
  const vol = parseVolumeToMl(bottle.volume);
  if (!vol) return null;
  return bottle.priceCny / vol;
}

/**
 * 开瓶后易失效、剩余难以用完的产品:成本按整瓶计。
 * 依据:碳酸类开瓶即漏气;非现榨果汁开封后 1-3 天内变质。
 * 判定信号:酒库分类"软饮" + 名称关键词(碳酸/果汁类)。
 * 例外:糖浆/苦精保质期长,不按整瓶;鲜榨果汁属自制/原材料,按用量。
 */
const PERISHABLE_NAME_RE =
  /可乐|cola|苏打水|soda|汤力|tonic|姜汁汽水|ginger\s*(ale|beer)|干姜水|气泡水|sparkling|七喜|雪碧|sprite|7-?up|柠檬汽水|lemonade|果汁|juice|nectar|苹果汁|橙汁|菠萝汁|蔓越莓汁|西柚汁|葡萄柚汁|番茄汁|椰浆水?|coconut\s*water|奶|milk|cream|红牛|energy/i;
const PERISHABLE_EXCLUDE_RE = /鲜榨|现榨|fresh(ly)?\s*(squeezed|pressed)|自制|homemade|糖浆|syrup|苦精|bitters/i;

/** 判断酒库条目是否属于"开瓶易失效、按整瓶计成本"的产品 */
export function isPerishableWholeBottle(bottle: Bottle): boolean {
  const name = `${bottle.nameZh} ${bottle.nameEn}`;
  if (PERISHABLE_EXCLUDE_RE.test(name)) return false;
  if (bottle.category === "软饮") return true;
  return PERISHABLE_NAME_RE.test(name);
}

/** 单个配料的智能成本 */
export function estimateIngredientCostSmart(
  ing: Ingredient,
  bottles: Bottle[],
  preps: HomemadePrep[],
): SmartIngredientCost {
  const link = smartLinkIngredient(ing.name, bottles, preps);
  if (!link) {
    return { ingredient: ing, link: null, amountMl: null, cost: null, reason: "no_match" };
  }
  const amountMl = parseAmountLoose(ing.amount);

  if (link.kind === "bottle") {
    // 形态折叠:柠檬皮/黄瓜片等 → 母条目单件价 × 形态系数 × 数量
    if (link.form) {
      const count = parseFormCount(ing.amount);
      const fc = formCost(link.bottle, link.form.key, link.form.factor, count);
      if (fc) {
        return {
          ingredient: ing,
          link,
          amountMl: null,
          cost: fc.cost,
          reason: null,
          formInfo: { form: link.form.key, factor: fc.factor, piecePrice: fc.piecePrice, count },
        };
      }
      return { ingredient: ing, link, amountMl: null, cost: null, reason: "no_price" };
    }
    // 易失效产品:按一整瓶价格计成本,用量保持真实份量不变
    if (isPerishableWholeBottle(link.bottle)) {
      if (link.bottle.priceCny > 0) {
        return {
          ingredient: ing,
          link,
          amountMl,
          cost: link.bottle.priceCny,
          reason: null,
          wholeBottle: true,
        };
      }
      return { ingredient: ing, link, amountMl, cost: null, reason: "no_price", wholeBottle: true };
    }
    const unit = bottleUnitPrice(link.bottle);
    if (unit === null) {
      return {
        ingredient: ing,
        link,
        amountMl,
        cost: null,
        reason: link.bottle.priceCny > 0 ? "no_volume" : "no_price",
      };
    }
    if (amountMl === null) {
      return { ingredient: ing, link, amountMl: null, cost: null, reason: "no_amount" };
    }
    return { ingredient: ing, link, amountMl, cost: unit * amountMl, reason: null };
  }

  // 自制品:复用现有的自制单位成本估算(内部会汇总自制配方的原料成本)
  const hm = estimateHomemadeIngredientCost(ing.name, ing.amount, preps, bottles);
  if (hm && hm.cost !== null) {
    return { ingredient: ing, link, amountMl: amountMl, cost: hm.cost, reason: null };
  }
  return { ingredient: ing, link, amountMl, cost: null, reason: "no_price" };
}

/** 整配方智能成本估算 */
export function estimateRecipeCostSmart(
  ingredients: Ingredient[],
  bottles: Bottle[],
  preps: HomemadePrep[],
): SmartRecipeCost {
  const items = ingredients.map((ing) => estimateIngredientCostSmart(ing, bottles, preps));
  const estimated = items.filter((i) => i.cost !== null);
  return {
    items,
    total: estimated.reduce((s, i) => s + (i.cost ?? 0), 0),
    estimatedCount: estimated.length,
    totalCount: ingredients.length,
  };
}

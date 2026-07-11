import { Ingredient } from "../recipes/types";
import { Bottle } from "./types";

/** 单项配料的成本估算结果 */
export interface IngredientCost {
  ingredient: Ingredient;
  /** 匹配到的酒款,null 表示未匹配 */
  bottle: Bottle | null;
  /** 解析出的用量(ml),null 表示无法解析 */
  amountMl: number | null;
  /** 估算成本(元),null 表示无法估算 */
  cost: number | null;
  /** 无法估算的原因 */
  reason: "no_bottle" | "no_amount" | "no_price" | "no_volume" | null;
}

/** 配方成本估算汇总 */
export interface RecipeCostEstimate {
  items: IngredientCost[];
  /** 可估算项的成本合计(元) */
  total: number;
  /** 成功估算的配料数 */
  estimatedCount: number;
  /** 总配料数 */
  totalCount: number;
}

/** 单位 -> 毫升换算表 */
const UNIT_TO_ML: [RegExp, number][] = [
  [/(?:ml|毫升|cc)/i, 1],
  [/(?:oz|盎司|ounce)/i, 30],
  [/(?:cl)/i, 10],
  [/(?:dash|抖|滴)/i, 0.9],
  [/(?:tsp|茶匙|小勺)/i, 5],
  [/(?:tbsp|汤匙|大勺)/i, 15],
  [/(?:bar\s*spoon|吧勺)/i, 5],
  [/(?:shot|杯)/i, 45],
  [/(?:splash)/i, 5],
];

/**
 * 从用量文本解析出毫升数。
 * 支持:"45ml"、"1.5 oz"、"2 dash"、"1/2 oz"、"1½oz"、"30 毫升" 等
 */
export function parseAmountToMl(amount: string): number | null {
  const text = amount.trim();
  if (!text) return null;

  // 数字部分:支持小数、分数(1/2)、混合分数(1 1/2)与常见 Unicode 分数
  const vulgar: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  let normalized = text;
  for (const [ch, val] of Object.entries(vulgar)) {
    normalized = normalized.replace(new RegExp(`(\\d+)\\s*${ch}`, "g"), (_, n) => String(Number(n) + val));
    normalized = normalized.replace(new RegExp(ch, "g"), String(val));
  }

  // 混合分数 "1 1/2"
  let value: number | null = null;
  const mixed = normalized.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  } else {
    const frac = normalized.match(/(\d+)\s*\/\s*(\d+)/);
    if (frac) {
      value = Number(frac[1]) / Number(frac[2]);
    } else {
      const dec = normalized.match(/(\d+(?:\.\d+)?)/);
      if (dec) value = Number(dec[1]);
    }
  }
  if (value === null || !isFinite(value)) return null;

  for (const [re, ml] of UNIT_TO_ML) {
    if (re.test(normalized)) return value * ml;
  }
  // 无单位默认视为 ml(常见简写如 "45")
  return value;
}

/** 非液体计数单位(中/英):水果个数、叶片、方糖等,保留原始呈现 */
const NON_LIQUID_RE =
  /片|个|颗|枝|块|条|只|适量|少许|叶|把|抹|圈|针|satsuma|slice|wedge|sprig|lea(f|ves)|piece|cube|egg|pinch|twist|peel|wheel|whole|rind|zest|mint|berr|cherr|olive|clove|small|large|to\s*top|top\s*up|toasted|\blime\b|\blemon\b|\borange\b|青柠(?!汁)|柠檬(?!汁)/i;

/**
 * 将用量文本统一格式化为 ml 显示。
 * 例:"1.5 oz" -> "45ml";"2 dash" -> "1.8ml";
 * 非液体计数单位(如"1 个"、"12片"、"2 cubes"、"10 leaves")原样返回。
 */
export function formatAmountAsMl(amount: string): string {
  const text = amount.trim();
  if (!text) return text;
  // 非液体计数单位优先原样保留(水果/叶片/方糖/蛋等)
  if (NON_LIQUID_RE.test(text)) return text;
  // 含"or"/"或"等多方案写法不转换,避免误导
  if (/\bor\b|或/i.test(text)) return text;
  // 已经是纯 ml 写法时规范化输出
  const ml = parseAmountToMl(text);
  if (ml === null) return text;
  // 纯数字无单位:小数字(<20)多为计数(蛋/果),保留;大数字按 ml 简写惯例转换
  if (/^[\d\s./½¼¾⅓⅔~-]+$/.test(text) && ml < 20) return text;
  const rounded = Math.round(ml * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${display}ml`;
}

/** 从规格文本解析瓶容量 ml,如 "700ml" / "1000ml" / "75cl" */
export function parseVolumeToMl(volume: string): number | null {
  const text = volume.trim().toLowerCase();
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(ml|毫升|cl|l|升)?/);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2] ?? "ml";
  if (unit === "l" || unit === "升") return value * 1000;
  if (unit === "cl") return value * 10;
  return value;
}

/** 中英文配料同义词典:英文配料名 -> 中文等价词(用于匹配酒库) */
const INGREDIENT_SYNONYMS: [RegExp, string][] = [
  [/london\s*dry\s*gin|dry\s*gin|\bgin\b/i, "金酒"],
  [/white\s*rum|light\s*rum/i, "白朗姆"],
  [/dark\s*rum|aged\s*rum/i, "黑朗姆"],
  [/\brum\b/i, "朗姆"],
  [/\bvodka\b/i, "伏特加"],
  [/bourbon|rye\s*whisk(e)?y/i, "波本威士忌"],
  [/scotch|whisk(e)?y/i, "威士忌"],
  [/blanco\s*tequila|silver\s*tequila|tequila/i, "龙舌兰"],
  [/mezcal/i, "梅斯卡尔"],
  [/cognac|brandy/i, "白兰地"],
  [/campari/i, "金巴利"],
  [/aperol/i, "阿佩罗"],
  [/sweet\s*vermouth|rosso\s*vermouth/i, "甜味美思"],
  [/dry\s*vermouth/i, "干味美思"],
  [/vermouth/i, "味美思"],
  [/triple\s*sec|cointreau|orange\s*liqueur|curacao/i, "橙皮利口酒"],
  [/maraschino/i, "马拉斯奇诺樱桃利口酒"],
  [/st[.\s-]*germain|elderflower/i, "接骨木花利口酒"],
  [/kahlua|coffee\s*liqueur/i, "咖啡利口酒"],
  [/baileys|irish\s*cream/i, "百利甜"],
  [/amaretto/i, "杏仁利口酒"],
  [/chartreuse/i, "查特酒"],
  [/angostura|aromatic\s*bitters/i, "安高天娜苦精"],
  [/orange\s*bitters/i, "橙味苦精"],
  [/bitters/i, "苦精"],
  [/lime\s*juice/i, "青柠汁"],
  [/lemon\s*juice/i, "柠檬汁"],
  [/simple\s*syrup|sugar\s*syrup/i, "糖浆"],
  [/soda\s*water|club\s*soda/i, "苏打水"],
  [/tonic/i, "汤力水"],
  [/champagne|prosecco|sparkling\s*wine/i, "起泡酒"],
];

/** 将英文配料名转成中文等价词;中文原样返回 */
export function normalizeIngredientName(name: string): string {
  const t = name.trim();
  // 含中文时直接使用
  if (/[\u4e00-\u9fa5]/.test(t)) return t;
  for (const [re, zh] of INGREDIENT_SYNONYMS) {
    if (re.test(t)) return zh;
  }
  return t;
}

/**
 * 将配料名与酒库匹配:双向包含 + 去除常见修饰词。
 * 返回最优匹配(名称越长越具体,优先)。
 */
export function matchBottle(ingredientName: string, bottles: Bottle[]): Bottle | null {
  let name = ingredientName.trim().toLowerCase();
  if (!name) return null;
  // 英文配料名 → 中文等价词(酒库以中文分类为主)
  const normalized = normalizeIngredientName(ingredientName).toLowerCase();

  let best: Bottle | null = null;
  let bestScore = 0;
  for (const b of bottles) {
    const candidates = [b.nameZh, b.nameEn, b.brand]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 2);
    for (const c of candidates) {
      let score = 0;
      for (const n of normalized === name ? [name] : [name, normalized]) {
        let s = 0;
        if (c === n) s = 1000;
        else if (n.includes(c)) s = 100 + c.length;
        else if (c.includes(n)) s = 50 + n.length;
        if (s > score) score = s;
      }
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
  }
  // 类别兜底:配料名含"金酒/朗姆..."时匹配该分类中最便宜的酒款
  if (!best) {
    const categories = ["金酒", "朗姆", "伏特加", "威士忌", "龙舌兰", "白兰地", "味美思"];
    const searchName = normalized;
    for (const cat of categories) {
      if (searchName.includes(cat) || name.includes(cat)) {
        const inCat = bottles
          .filter((b) => b.category === cat && b.priceCny > 0)
          .sort((a, b) => a.priceCny - b.priceCny);
        if (inCat.length > 0) {
          // 若配料名带"甜/红/干/白"等修饰词,优先匹配备注或名称含该修饰词的酒款
          const sweet = /甜|红|rosso|sweet/i.test(name + searchName);
          const dry = /干|dry/i.test(name + searchName);
          if (sweet) {
            const hit = inCat.find((b) => /甜|红|rosso|sweet/i.test(b.nameZh + b.nameEn + b.notes));
            if (hit) return hit;
          }
          if (dry) {
            const hit = inCat.find((b) => /干|dry/i.test(b.nameZh + b.nameEn + b.notes));
            if (hit) return hit;
          }
          return inCat[0];
        }
      }
    }
  }
  return best;
}

/** 估算整个配方的单杯成本 */
export function estimateRecipeCost(
  ingredients: Ingredient[],
  bottles: Bottle[],
): RecipeCostEstimate {
  const items: IngredientCost[] = ingredients.map((ing) => {
    const bottle = matchBottle(ing.name, bottles);
    if (!bottle) {
      return { ingredient: ing, bottle: null, amountMl: null, cost: null, reason: "no_bottle" };
    }
    const amountMl = parseAmountToMl(ing.amount);
    if (amountMl === null) {
      return { ingredient: ing, bottle, amountMl: null, cost: null, reason: "no_amount" };
    }
    if (bottle.priceCny <= 0) {
      return { ingredient: ing, bottle, amountMl, cost: null, reason: "no_price" };
    }
    const volumeMl = parseVolumeToMl(bottle.volume);
    if (!volumeMl) {
      return { ingredient: ing, bottle, amountMl, cost: null, reason: "no_volume" };
    }
    const cost = (bottle.priceCny / volumeMl) * amountMl;
    return { ingredient: ing, bottle, amountMl, cost, reason: null };
  });

  const estimated = items.filter((i) => i.cost !== null);
  return {
    items,
    total: estimated.reduce((sum, i) => sum + (i.cost ?? 0), 0),
    estimatedCount: estimated.length,
    totalCount: ingredients.length,
  };
}

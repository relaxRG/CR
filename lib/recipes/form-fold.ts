/**
 * 形态折叠引擎:同一原材料的不同形态(黄瓜片/柠檬皮/青柠角…)折叠到母条目,
 * 并按"形态换算系数"折算成本。
 *
 * 设计:
 * - stripForm(name):剥离末尾形态词,返回 { base, form };"柠檬皮" → { base:"柠檬", form:"皮" }
 * - FORM_FACTORS:内置形态 → 占整件商品(1 个/1 份)的比例;可被 Bottle.formFactors 覆盖
 * - formUnitCost(bottle, form, count):形态成本 = 单件价格 × 系数 × 数量
 *   单件价格:规格可解析为"N个/枚/颗"按件数折算;按重量规格(500g)默认 1 件≈150g(柑橘均重),
 *   母条目可通过 formFactors["_pieceGrams"] 覆盖单件克重。
 */
import type { Bottle } from "../bottles/types";

/** 形态词 → 中英文正则与默认换算系数(占 1 个母条目的比例) */
export interface FormDef {
  /** 形态 key(存储/覆盖用) */
  key: string;
  /** 名称尾部匹配(中文)/独立词匹配(英文) */
  re: RegExp;
  /** 默认系数:1 份该形态 ≈ factor × 1 个母条目 */
  factor: number;
}

/**
 * 常见装饰/配料形态词(按更长词优先匹配)。
 * 系数参考:一个柠檬约可取 6 条皮 / 8 片 / 8 角;挤汁约 30ml。
 */
export const FORM_DEFS: FormDef[] = [
  { key: "螺旋皮", re: /(螺旋皮|长皮|horse'?s?\s*neck|spiral)$/i, factor: 1 / 2 },
  { key: "皮", re: /(皮卷|皮|twist|peel|zest|rind)$/i, factor: 1 / 6 },
  { key: "片", re: /(圆片|薄片|片|wheel|slice)$/i, factor: 1 / 8 },
  { key: "角", re: /(角|块|瓣|wedge|chunk|cube)$/i, factor: 1 / 8 },
  { key: "圈", re: /(圈|环|ring)$/i, factor: 1 / 8 },
  { key: "枝", re: /(枝|束|sprig|bouquet)$/i, factor: 1 / 10 },
  { key: "叶", re: /(叶|lea(?:f|ves))$/i, factor: 1 / 30 },
  { key: "条", re: /(条|strip|ribbon)$/i, factor: 1 / 6 },
  { key: "干", re: /(干|dried)$/i, factor: 1 / 8 },
  { key: "碎", re: /(碎|末|粉|grated|crumbs?|powder)$/i, factor: 1 / 20 },
  { key: "整个", re: /(整个|整颗|whole)$/i, factor: 1 },
];

/** 剥离结果 */
export interface StrippedForm {
  /** 母条目名(去形态词) */
  base: string;
  /** 命中的形态 key;null 表示无形态词 */
  form: string | null;
  /** 命中形态的默认系数 */
  factor: number;
}

const CLEAN_RE = /^(新鲜|鲜|fresh|dried)\s*/i;

/**
 * 剥离名称末尾的形态词:"柠檬皮"→{base:"柠檬",form:"皮"};"薄荷枝"→{base:"薄荷",form:"枝"}。
 * 剥离后 base 至少需 1 个汉字或 3 个英文字符,否则视为无形态(避免"果皮"等歧义)。
 */
export function stripForm(rawName: string): StrippedForm {
  const name = rawName.trim().replace(/\s+/g, " ");
  for (const def of FORM_DEFS) {
    const m = name.match(def.re);
    if (!m) continue;
    let base = name.slice(0, name.length - m[0].length).trim();
    base = base.replace(/[的\s·-]+$/g, "").trim();
    const cleaned = base.replace(CLEAN_RE, "").trim();
    const core = cleaned || base;
    const zhLen = (core.match(/[\u4e00-\u9fff]/g) || []).length;
    const enLen = core.replace(/[^a-zA-Z]/g, "").length;
    if (zhLen >= 1 || enLen >= 3) {
      return { base: core, form: def.key, factor: def.factor };
    }
  }
  return { base: name, form: null, factor: 1 };
}

/** 英文形态词前置写法:"lemon twist"/"orange peel"/"mint sprig" 等(形态词在结尾,与中文一致,无需额外处理) */

/** 数量解析:"2片"/"1 条"/"3 leaves"→数字;无数字默认 1 */
export function parseFormCount(amount: string): number {
  const a = amount.trim();
  if (!a) return 1;
  const m = a.match(/(\d+(?:\.\d+)?)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return isFinite(n) && n > 0 ? n : 1;
}

/** 规格解析为"件":"500g"→按克重折件;"10枚/10个"→10 件;"1根"→1 件 */
function parsePackPieces(volume: string, pieceGrams: number): number | null {
  const v = volume.trim().toLowerCase();
  if (!v) return null;
  let m = v.match(/(\d+(?:\.\d+)?)\s*(枚|个|颗|根|只|块|pcs?|pieces?)/);
  if (m) return Number(m[1]);
  m = v.match(/(\d+(?:\.\d+)?)\s*(kg|千克|公斤)/);
  if (m) return (Number(m[1]) * 1000) / pieceGrams;
  m = v.match(/(\d+(?:\.\d+)?)\s*(g|克)/);
  if (m) return Number(m[1]) / pieceGrams;
  return null;
}

/** 常见单件克重(base 名关键词 → 克);兜底 150g */
const PIECE_GRAMS: [RegExp, number][] = [
  [/西柚|葡萄柚|grapefruit/i, 350],
  [/橙|orange/i, 200],
  [/柠檬|lemon/i, 120],
  [/青柠|lime/i, 80],
  [/黄瓜|cucumber/i, 200],
  [/菠萝|pineapple/i, 900],
  [/草莓|strawberry/i, 20],
  [/树莓|raspberry/i, 5],
  [/樱桃|cherry/i, 10],
  [/薄荷|mint/i, 50],
  [/迷迭香|rosemary/i, 50],
];

export function defaultPieceGrams(baseName: string): number {
  for (const [re, g] of PIECE_GRAMS) {
    if (re.test(baseName)) return g;
  }
  return 150;
}

/** 形态系数:优先母条目 formFactors 覆盖,否则内置默认 */
export function formFactorOf(bottle: Bottle | null, form: string, fallback: number): number {
  const o = bottle?.formFactors?.[form];
  if (typeof o === "number" && isFinite(o) && o > 0) return o;
  return fallback;
}

export interface FormCost {
  /** 单件(1 个母条目)价格 */
  piecePrice: number;
  /** 该形态 1 份成本 */
  unitCost: number;
  /** 总成本 = unitCost × count */
  cost: number;
  /** 实际使用的系数 */
  factor: number;
}

/**
 * 形态成本:母条目价格 → 单件价 → × 形态系数 × 数量。
 * 母条目缺价格/规格时返回 null。
 */
export function formCost(
  bottle: Bottle,
  form: string,
  defaultFactor: number,
  count: number,
): FormCost | null {
  if (!bottle.priceCny || bottle.priceCny <= 0) return null;
  const pieceGrams =
    (typeof bottle.formFactors?._pieceGrams === "number" && bottle.formFactors._pieceGrams > 0
      ? bottle.formFactors._pieceGrams
      : defaultPieceGrams(`${bottle.nameZh} ${bottle.nameEn}`));
  const pieces = parsePackPieces(bottle.volume, pieceGrams);
  if (!pieces || pieces <= 0) return null;
  const piecePrice = bottle.priceCny / pieces;
  const factor = formFactorOf(bottle, form, defaultFactor);
  const unitCost = piecePrice * factor;
  return { piecePrice, unitCost, cost: unitCost * count, factor };
}

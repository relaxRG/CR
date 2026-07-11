/**
 * 装饰/配料连接词智能拆分引擎。
 *
 * 规则:
 * - 分隔符(、,,;;等)→ 独立装饰项,成本分别累加
 * - 「或 / or」→ 备选组:分别计算成本,取其中较高一项计入总成本(保守估计)
 * - 「与 / 及 / 和 / & / and / +」→ 组合项:拆分后分别计算,全部累加
 * - 每段先提取数量词,再走 smartLink(含形态折叠)匹配母条目计价
 * - 遇到资料库没有的原材料时,由调用方触发自动入库(auto-add)
 */
import type { Bottle } from "../bottles/types";
import type { HomemadePrep } from "../homemade/types";
import { estimateIngredientCostSmart, type SmartIngredientCost } from "./smart-cost";

/** 拆分出的单个装饰片段 */
export interface GarnishPart {
  /** 原始片段文本(含数量词) */
  raw: string;
  /** 提取的名称(去数量词) */
  name: string;
  /** 数量文本(如 "2片"),可为空 */
  amount: string;
}

/** 备选组(「或」连接)或组合组(「与/及」连接、或单项) */
export interface GarnishGroup {
  /** "or" = 备选取最高;"and" = 全部累加(单项也视为 and 组) */
  mode: "or" | "and";
  parts: GarnishPart[];
}

/** 顶层分隔符:顿号/逗号/分号视为并列(全部累加) */
const TOP_SPLIT_RE = /[、,,;;]+/;
/** 或:中文"或/或者",英文 or(独立词) */
const OR_RE = /\s+or\s+|或者|或/i;
/** 与/及/和:中文连接词,英文 and / & / with / plus / +(独立词) */
const AND_RE = /\s+(?:and|&|with|plus)\s+|[与及和]|\s*\+\s*/i;

/** 数量前缀提取:"2片柠檬皮"→amount:"2片";"1 orange twist"→amount:"1" */
const LEADING_COUNT_RE =
  /^((?:\d+(?:\.\d+)?|[一二两三四五六七八九十])\s*(?:片|条|颗|个|枚|枝|块|角|圈|叶|滴|抖)?)\s*/;

const ZH_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parsePart(raw: string): GarnishPart {
  const t = raw.trim();
  if (!t) return { raw: t, name: "", amount: "" };
  const m = t.match(LEADING_COUNT_RE);
  if (m && m[1] && t.slice(m[0].length).trim().length >= 1) {
    let amount = m[1].trim();
    // 中文数字转阿拉伯,便于 parseFormCount 解析
    const zh = amount.match(/^([一二两三四五六七八九十])/);
    if (zh) amount = amount.replace(zh[1], String(ZH_NUM[zh[1]] ?? 1));
    return { raw: t, name: t.slice(m[0].length).trim(), amount };
  }
  return { raw: t, name: t, amount: "" };
}

/** 保护词:名称本身含连接字但不应拆分(整词匹配优先) */
const PROTECTED_WORDS = [
  /马天尼|martini/i, // 不含连接词,占位示例
];

/** 名称是否包含真实连接词(排除保护词) */
function shouldSplit(text: string, re: RegExp): boolean {
  if (!re.test(text)) return false;
  for (const p of PROTECTED_WORDS) {
    if (p.test(text)) return false;
  }
  return true;
}

/**
 * 把装饰文本拆分为组:
 * "柠檬皮或橙皮、薄荷枝" → [ {mode:"or",[柠檬皮,橙皮]}, {mode:"and",[薄荷枝]} ]
 * "盐边与青柠角" → [ {mode:"and",[盐边,青柠角]} ]
 */
export function splitGarnish(text: string): GarnishGroup[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];
  const groups: GarnishGroup[] = [];
  for (const seg of trimmed.split(TOP_SPLIT_RE)) {
    const s = seg.trim();
    if (!s) continue;
    if (shouldSplit(s, OR_RE)) {
      // 或组内还可能有 and 子项,简化:先 or 拆,子段再 and 拆平铺
      const orParts = s.split(OR_RE).map((x) => x.trim()).filter(Boolean);
      const flat: GarnishPart[] = [];
      for (const op of orParts) {
        if (shouldSplit(op, AND_RE)) {
          // "A和B 或 C":and 子组作为一个备选整体过于复杂,拆平铺为多个备选
          for (const ap of op.split(AND_RE).map((x) => x.trim()).filter(Boolean)) {
            flat.push(parsePart(ap));
          }
        } else {
          flat.push(parsePart(op));
        }
      }
      if (flat.length > 1) {
        groups.push({ mode: "or", parts: flat });
        continue;
      }
      if (flat.length === 1) {
        groups.push({ mode: "and", parts: flat });
        continue;
      }
    }
    if (shouldSplit(s, AND_RE)) {
      const andParts = s.split(AND_RE).map((x) => x.trim()).filter(Boolean);
      const parts = andParts.map(parsePart).filter((p) => p.name);
      if (parts.length > 1) {
        groups.push({ mode: "and", parts });
        continue;
      }
    }
    const single = parsePart(s);
    if (single.name) groups.push({ mode: "and", parts: [single] });
  }
  return groups;
}

/** 单个装饰片段的成本明细 */
export interface GarnishPartCost {
  part: GarnishPart;
  est: SmartIngredientCost;
  /** 备选组中未选中(成本较低)的项标记 */
  chosen: boolean;
}

/** 装饰组成本 */
export interface GarnishGroupCost {
  group: GarnishGroup;
  items: GarnishPartCost[];
  /** 组小计:or 取最高项;and 全部累加 */
  subtotal: number;
  /** 组内是否有成功估价项 */
  estimated: boolean;
}

/** 装饰整体成本 */
export interface GarnishCost {
  groups: GarnishGroupCost[];
  total: number;
  /** 未匹配到任何库的片段名(供自动入库) */
  unmatchedNames: string[];
}

/**
 * 估算装饰成本:拆分 → 各片段 smartLink+成本 → 组内 or 取高 / and 累加。
 * "适量/少许"等无名称片段跳过;完全无法匹配的片段计 0 并记录到 unmatchedNames。
 */
export function estimateGarnishCost(
  garnish: string,
  bottles: Bottle[],
  preps: HomemadePrep[],
): GarnishCost {
  const groups = splitGarnish(garnish);
  const out: GarnishGroupCost[] = [];
  const unmatched: string[] = [];
  for (const g of groups) {
    const items: GarnishPartCost[] = g.parts.map((p) => ({
      part: p,
      est: estimateIngredientCostSmart(
        { id: `garnish-${p.name}`, name: p.name, amount: p.amount },
        bottles,
        preps,
      ),
      chosen: g.mode === "and",
    }));
    for (const it of items) {
      if (!it.est.link) unmatched.push(it.part.name);
    }
    let subtotal = 0;
    let estimated = false;
    if (g.mode === "or") {
      // 备选组:取成本最高的一项(未知成本视为 0 参与比较)
      let bestIdx = -1;
      let best = -1;
      items.forEach((it, i) => {
        const c = it.est.cost ?? -1;
        if (c > best) {
          best = c;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && (items[bestIdx].est.cost ?? null) !== null) {
        items[bestIdx].chosen = true;
        subtotal = items[bestIdx].est.cost!;
        estimated = true;
      }
    } else {
      for (const it of items) {
        if (it.est.cost !== null) {
          subtotal += it.est.cost;
          estimated = true;
        }
      }
    }
    out.push({ group: g, items, subtotal, estimated });
  }
  return {
    groups: out,
    total: out.reduce((s, g) => s + g.subtotal, 0),
    unmatchedNames: unmatched,
  };
}

/**
 * Pour Cost 计算引擎 (Build 125)
 *
 * 三个维度：
 *   1. 纯饮/直饮 Pour Cost：servingSize(ml) × (refPrice / specMl) ÷ salePrice
 *   2. 配方 Pour Cost：复用 smart-cost.ts 的 estimateRecipeCostSmart，
 *      total / salePrice（在售清单售价）
 *   3. 整体月度 Pour Cost：当月酒水进货总成本 ÷ 当月酒水销售总额
 *
 * 置信度体系：
 *   "exact"     — 所有配料已手动关联到酒库/自制库
 *   "partial"   — 部分配料已关联，部分未关联（使用模糊匹配估算）
 *   "estimated" — 全部依赖模糊匹配，未手动确认
 *   "unknown"   — 没有任何匹配，无法计算
 *
 * 安全保障：
 *   - 所有除法前检查分母 > 0
 *   - spec 解析失败时回退到 700ml 默认值
 *   - 循环引用由 smart-cost.ts 的 visitedPreps 机制处理
 */

import type { SpiritItem } from "./types";
import type { MenuEntry } from "../menu/store";

// ─── spec 字符串解析 ──────────────────────────────────────────────────────────

/**
 * 从 spec 字符串解析规格容量（ml）。
 * 支持格式：700ml / 700ML / 700 ml / 1L / 1l / 750ml / 1000ml 等。
 * 解析失败返回 null。
 */
export function parseSpecToMl(spec: string | undefined | null): number | null {
  if (!spec) return null;
  const s = spec.trim();

  // 匹配：数字 + 可选空格 + 单位（L/l/ml/ML/cl/CL）
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(ml|ML|mL|Ml|l|L|cl|CL|cL|Cl)\.?$/i);
  if (!m) return null;

  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();

  if (unit === "ml") return num;
  if (unit === "l") return num * 1000;
  if (unit === "cl") return num * 10;
  return null;
}

/**
 * 获取酒款的规格容量（ml）。
 * 优先使用 specMl 字段；未设置时从 spec 字符串解析；
 * 解析失败时回退到行业默认值 700ml。
 */
export function getSpecMl(item: SpiritItem): { ml: number; isDefault: boolean } {
  if (item.specMl && item.specMl > 0) {
    return { ml: item.specMl, isDefault: false };
  }
  const parsed = parseSpecToMl(item.spec);
  if (parsed && parsed > 0) {
    return { ml: parsed, isDefault: false };
  }
  return { ml: 700, isDefault: true };
}

// ─── 纯饮/直饮 Pour Cost ──────────────────────────────────────────────────────

export interface DirectPourCostResult {
  /** Pour Cost 百分比（0-100），null 表示无法计算 */
  pourCostPct: number | null;
  /** 单杯酒水成本（元） */
  costPerServing: number | null;
  /** 每 ml 成本（元） */
  costPerMl: number | null;
  /** 规格容量（ml） */
  specMl: number;
  /** 规格容量是否使用了默认值 700ml */
  specIsDefault: boolean;
  /** 置信度 */
  confidence: "exact" | "estimated" | "unknown";
  /** 无法计算的原因 */
  reason?: "no_price" | "no_spec" | "no_serving_size" | "no_sale_price" | "zero_spec";
}

/**
 * 计算纯饮/直饮的 Pour Cost。
 *
 * @param item       酒款档案
 * @param entry      在售清单条目（需要 servingSize 和 price）
 * @param refPrice   参考单价（元/瓶），传入 0 则使用 item.refPrice
 */
export function calcDirectPourCost(
  item: SpiritItem,
  entry: MenuEntry,
  refPrice?: number,
): DirectPourCostResult {
  const price = refPrice ?? item.refPrice;
  const salePrice = entry.price;
  const servingSize = entry.servingSize;

  if (!price || price <= 0) {
    return { pourCostPct: null, costPerServing: null, costPerMl: null, specMl: 700, specIsDefault: true, confidence: "unknown", reason: "no_price" };
  }

  const { ml: specMlVal, isDefault: specIsDefault } = getSpecMl(item);

  if (specMlVal <= 0) {
    return { pourCostPct: null, costPerServing: null, costPerMl: null, specMl: specMlVal, specIsDefault, confidence: "unknown", reason: "zero_spec" };
  }

  const costPerMl = price / specMlVal;

  if (!servingSize || servingSize <= 0) {
    return { pourCostPct: null, costPerServing: null, costPerMl, specMl: specMlVal, specIsDefault, confidence: specIsDefault ? "estimated" : "exact", reason: "no_serving_size" };
  }

  const costPerServing = costPerMl * servingSize;

  if (!salePrice || salePrice <= 0) {
    return { pourCostPct: null, costPerServing, costPerMl, specMl: specMlVal, specIsDefault, confidence: specIsDefault ? "estimated" : "exact", reason: "no_sale_price" };
  }

  const pourCostPct = (costPerServing / salePrice) * 100;
  const confidence = specIsDefault ? "estimated" : "exact";

  return { pourCostPct, costPerServing, costPerMl, specMl: specMlVal, specIsDefault, confidence };
}

// ─── 配方 Pour Cost（基于 smart-cost 结果） ───────────────────────────────────

export interface RecipePourCostResult {
  /** Pour Cost 百分比（0-100），null 表示无法计算 */
  pourCostPct: number | null;
  /** 配方总酒水成本（元） */
  recipeCost: number | null;
  /** 在售清单售价（元） */
  salePrice: number | null;
  /** 置信度 */
  confidence: "exact" | "partial" | "estimated" | "unknown";
  /** 已匹配配料数 */
  matchedCount: number;
  /** 总配料数 */
  totalCount: number;
  reason?: "no_sale_price" | "no_cost" | "no_ingredients";
}

/**
 * 根据配方成本估算结果和在售清单售价，计算配方 Pour Cost。
 *
 * @param recipeCostTotal   smart-cost 计算出的配方总成本（元）
 * @param matchedCount      已成功匹配到酒库/自制库的配料数
 * @param totalCount        配方总配料数
 * @param salePrice         在售清单售价（元）
 */
export function calcRecipePourCost(
  recipeCostTotal: number | null,
  matchedCount: number,
  totalCount: number,
  salePrice: number | null,
): RecipePourCostResult {
  if (totalCount === 0) {
    return { pourCostPct: null, recipeCost: null, salePrice, confidence: "unknown", matchedCount: 0, totalCount: 0, reason: "no_ingredients" };
  }

  if (recipeCostTotal === null || recipeCostTotal <= 0) {
    return { pourCostPct: null, recipeCost: recipeCostTotal, salePrice, confidence: "unknown", matchedCount, totalCount, reason: "no_cost" };
  }

  // 置信度：根据匹配率判断
  let confidence: RecipePourCostResult["confidence"];
  if (matchedCount === totalCount) {
    confidence = "exact";
  } else if (matchedCount > 0) {
    confidence = "partial";
  } else {
    confidence = "estimated";
  }

  if (!salePrice || salePrice <= 0) {
    return { pourCostPct: null, recipeCost: recipeCostTotal, salePrice, confidence, matchedCount, totalCount, reason: "no_sale_price" };
  }

  const pourCostPct = (recipeCostTotal / salePrice) * 100;
  return { pourCostPct, recipeCost: recipeCostTotal, salePrice, confidence, matchedCount, totalCount };
}

// ─── 整体月度 Pour Cost ───────────────────────────────────────────────────────

export interface MonthlyPourCostResult {
  /** Pour Cost 百分比（0-100），null 表示无法计算 */
  pourCostPct: number | null;
  /** 当月酒水进货总成本（元） */
  totalPurchaseCost: number;
  /** 当月酒水销售总额（元） */
  totalRevenue: number;
  confidence: "exact" | "unknown";
  reason?: "no_revenue" | "no_cost";
}

/**
 * 计算整体月度 Pour Cost。
 *
 * @param totalPurchaseCost  当月酒水进货总成本（来自烈酒库存进货流水）
 * @param totalRevenue       当月酒水销售总额（来自月报收入科目）
 */
export function calcMonthlyPourCost(
  totalPurchaseCost: number,
  totalRevenue: number,
): MonthlyPourCostResult {
  if (totalPurchaseCost <= 0) {
    return { pourCostPct: null, totalPurchaseCost, totalRevenue, confidence: "unknown", reason: "no_cost" };
  }
  if (totalRevenue <= 0) {
    return { pourCostPct: null, totalPurchaseCost, totalRevenue, confidence: "unknown", reason: "no_revenue" };
  }
  const pourCostPct = (totalPurchaseCost / totalRevenue) * 100;
  return { pourCostPct, totalPurchaseCost, totalRevenue, confidence: "exact" };
}

// ─── Pour Cost 颜色编码 ───────────────────────────────────────────────────────

/**
 * 根据 Pour Cost % 返回颜色。
 * 行业标准：
 *   < 20%  绿色（优秀）
 *   20-30% 橙色（正常）
 *   > 30%  红色（偏高）
 */
export function pourCostColor(pct: number): string {
  if (pct < 20) return "#10B981"; // 绿
  if (pct < 30) return "#F59E0B"; // 橙
  return "#EF4444";               // 红
}

/**
 * 置信度标签文字
 */
export function confidenceLabel(confidence: string): string {
  switch (confidence) {
    case "exact":     return "精确";
    case "partial":   return "部分估算";
    case "estimated": return "估算";
    default:          return "未知";
  }
}

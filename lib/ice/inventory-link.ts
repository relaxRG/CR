/**
 * 冰块进销存 ↔ 冰块成本 智能链接工具库
 *
 * 核心逻辑：
 * 1. 进销存品类名称 → 自动匹配 IceKind（用 matchIceKind）
 * 2. 进货后新单价 → 计算对应 IceKind 的新成本定价
 * 3. 提供差异对比和一键同步
 */
import { IceKind, IceSettings, matchIceKind, iceKindCostPerDrink } from "./cost";
import { GenericInventoryItem } from "@/lib/inventory-core/store";

/** 进销存品类与 IceKind 的匹配结果 */
export interface IceLinkMatch {
  item: GenericInventoryItem;
  kind: IceKind | null;
  /** 当前进价（元/单位） */
  currentPrice: number;
  /** 当前 IceKind 的单杯成本 */
  kindCostPerDrink: number;
  /** 根据进价重新计算的单杯成本 */
  computedCostPerDrink: number;
  /** 是否有价格差异（进销存价格 vs 成本设置价格） */
  hasPriceDiff: boolean;
  /** 差异百分比 */
  diffPct: number;
}

/**
 * 根据进销存品类名称自动匹配 IceKind
 * 匹配逻辑：先用 matchIceKind 匹配，再按分类 category 做补充匹配
 */
export function autoMatchIceKind(item: GenericInventoryItem, kinds: IceKind[]): IceKind | null {
  // 优先用 extra.linkedKindId 精确匹配
  const linkedId = item.extra?.linkedKindId as string | undefined;
  if (linkedId) {
    const found = kinds.find((k) => k.id === linkedId);
    if (found) return found;
  }
  // 用名称 + 分类 + 规格组合文本做智能匹配
  const searchText = [item.name, item.spec, item.category].filter(Boolean).join(" ");
  return matchIceKind(searchText, kinds);
}

/**
 * 根据进货单价和 IceKind 的计价方式，反推新的 IceKind 价格
 * 进销存单位通常是"袋/kg/箱"，需要换算到 IceKind 的 packGrams/price
 */
export function computeNewKindPrice(
  item: GenericInventoryItem,
  kind: IceKind,
  newUnitPrice: number,
): number {
  // 进销存单位推断：如果单位含"kg"则 1000g，含"袋"则用 packGrams
  const unit = (item.unit || "").toLowerCase();

  if (kind.pricing === "perDrink") {
    // perDrink：一份规格（一袋）可供 drinksPerPack 杯
    // 新价格 = 进货价（元/袋）
    return newUnitPrice;
  }
  if (kind.pricing === "perGram") {
    // perGram：packGrams 克/袋，price = 元/袋
    // 如果进销存单位是 kg，则 newUnitPrice 是元/kg，需换算到元/袋
    if (unit.includes("kg") || unit.includes("千克")) {
      const packKg = kind.packGrams / 1000;
      return newUnitPrice * packKg;
    }
    // 否则直接用元/袋
    return newUnitPrice;
  }
  if (kind.pricing === "perPiece") {
    // perPiece：price = 元/颗
    return newUnitPrice;
  }
  return newUnitPrice;
}

/**
 * 计算进销存品类的新单杯成本（基于进货价）
 */
export function computedCostFromInventory(
  item: GenericInventoryItem,
  kind: IceKind,
): number {
  const price = item.latestCostPrice;
  if (!price || price <= 0) return iceKindCostPerDrink(kind);

  const newKindPrice = computeNewKindPrice(item, kind, price);
  const tempKind: IceKind = { ...kind, price: newKindPrice };
  return iceKindCostPerDrink(tempKind);
}

/**
 * 批量分析所有冰块进销存品类的链接状态
 */
export function analyzeIceLinks(
  items: GenericInventoryItem[],
  settings: IceSettings,
): IceLinkMatch[] {
  return items.filter((i) => i.active).map((item) => {
    const kind = autoMatchIceKind(item, settings.kinds);
    const currentPrice = item.latestCostPrice ?? 0;
    const kindCostPerDrink = kind ? iceKindCostPerDrink(kind) : 0;
    const computedCost = kind ? computedCostFromInventory(item, kind) : 0;
    const hasPriceDiff = kind ? Math.abs(computedCost - kindCostPerDrink) > 0.001 : false;
    const diffPct = kindCostPerDrink > 0 ? ((computedCost - kindCostPerDrink) / kindCostPerDrink) * 100 : 0;
    return { item, kind, currentPrice, kindCostPerDrink, computedCostPerDrink: computedCost, hasPriceDiff, diffPct };
  });
}

/**
 * 生成同步到 IceKind 的新价格
 * 返回需要 updateKind(id, { price: newPrice }) 的参数
 */
export function buildSyncPatch(
  item: GenericInventoryItem,
  kind: IceKind,
): { id: string; patch: Partial<IceKind> } {
  const newPrice = computeNewKindPrice(item, kind, item.latestCostPrice ?? 0);
  return { id: kind.id, patch: { price: newPrice } };
}

/** 链接状态标签 */
export function getLinkStatusLabel(match: IceLinkMatch): {
  label: string;
  color: string;
  icon: string;
} {
  if (!match.kind) return { label: "未匹配", color: "#8E8E93", icon: "questionmark.circle" };
  if (!match.hasPriceDiff) return { label: "已同步", color: "#34C759", icon: "checkmark.circle.fill" };
  const sign = match.diffPct > 0 ? "↑" : "↓";
  return {
    label: `价差 ${sign}${Math.abs(match.diffPct).toFixed(1)}%`,
    color: match.diffPct > 5 ? "#FF3B30" : "#FF9500",
    icon: "exclamationmark.circle.fill",
  };
}

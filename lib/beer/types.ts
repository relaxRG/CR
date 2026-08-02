/**
 * 啤酒进销存类型定义
 * 啤酒全部为自采（备用金 B1），独立管理
 */

export interface BeerItem {
  id: string;
  /** 品牌/名称，如「青岛啤酒」「百威」「科罗娜」 */
  name: string;
  /** 英文名（可选） */
  nameEn: string;
  /** 规格，如「330ml」「500ml」「640ml」 */
  spec: string;
  /** 包装类型：瓶/罐/扎/桶 */
  packageType: "bottle" | "can" | "draft" | "barrel";
  /** 每箱数量（用于箱/瓶换算） */
  unitsPerCase: number;
  /** 当前库存（瓶/罐） */
  currentStock: number;
  /** 库存预警线 */
  alertThreshold: number;
  /** 最新进货价（元/瓶） */
  latestCostPrice: number;
  /** 建议售价（元/瓶） */
  sellingPrice: number;
  /** 供应商/采购渠道 */
  supplier: string;
  /** 备注 */
  notes: string;
  /** 是否在售 */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BeerTransaction {
  id: string;
  beerItemId: string;
  /** 类型：in=入库，out=出库，adjust=盘点调整 */
  type: "in" | "out" | "adjust";
  /** 数量（瓶/罐，正数=入库，负数=出库） */
  quantity: number;
  /** 单价（元/瓶，入库时记录） */
  unitPrice: number;
  /** 总金额 */
  totalAmount: number;
  date: string;
  /** 关联的备用金记录 ID（自采时关联） */
  pettyRecordId?: string;
  notes: string;
  createdAt: string;
}

export interface BeerMonthlySnapshot {
  id: string;
  month: string; // "2026-02"
  /** 快照数据：每款啤酒的期末库存 */
  items: {
    beerItemId: string;
    name: string;
    spec: string;
    openingStock: number;
    purchaseQty: number;
    purchaseCost: number;
    closingStock: number;
    unitCost: number;
  }[];
  /** 本月进货总额 */
  totalPurchaseCost: number;
  createdAt: string;
}

export const PACKAGE_TYPE_LABELS: Record<BeerItem["packageType"], string> = {
  bottle: "瓶装",
  can: "罐装",
  draft: "扎装",
  barrel: "桶装",
};

export const PACKAGE_TYPE_ICONS: Record<BeerItem["packageType"], string> = {
  bottle: "🍺",
  can: "🥤",
  draft: "🍻",
  barrel: "🛢️",
};

/** 计算毛利率 */
export function calcBeerMargin(costPrice: number, sellingPrice: number): number {
  if (sellingPrice <= 0) return 0;
  return Math.round(((sellingPrice - costPrice) / sellingPrice) * 100 * 10) / 10;
}

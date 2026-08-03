/**
 * 水果进销存类型定义
 * 水果全部为自采（备用金 A5 蔬菜水果），独立管理
 */

/** 水果品类 */
export type FruitCategory =
  | "citrus"      // 柑橘类（柠檬/橙/柚/橘）
  | "berry"       // 浆果类（草莓/蓝莓/覆盆子）
  | "tropical"    // 热带水果（芒果/菠萝/百香果/椰子）
  | "stone"       // 核果类（桃/李/樱桃/杏）
  | "melon"       // 瓜类（西瓜/哈密瓜）
  | "apple_pear"  // 苹果梨类
  | "herb"        // 香草/草本（薄荷/迷迭香/罗勒）
  | "vegetable"   // 蔬菜类（黄瓜/芹菜/番茄）
  | "other";      // 其他

export const FRUIT_CATEGORY_LABELS: Record<FruitCategory, string> = {
  citrus: "柑橘类",
  berry: "浆果类",
  tropical: "热带水果",
  stone: "核果类",
  melon: "瓜类",
  apple_pear: "苹果梨类",
  herb: "香草草本",
  vegetable: "蔬菜类",
  other: "其他",
};

export const FRUIT_CATEGORY_COLORS: Record<FruitCategory, string> = {
  citrus: "#F59E0B",
  berry: "#EC4899",
  tropical: "#10B981",
  stone: "#EF4444",
  melon: "#84CC16",
  apple_pear: "#6366F1",
  herb: "#14B8A6",
  vegetable: "#22C55E",
  other: "#94A3B8",
};

/** 单位类型 */
export type FruitUnit = "kg" | "piece" | "box" | "bag" | "bunch";
export const FRUIT_UNIT_LABELS: Record<FruitUnit, string> = {
  kg: "kg",
  piece: "个/只",
  box: "箱",
  bag: "袋",
  bunch: "串/把",
};

export interface FruitItem {
  id: string;
  /** 名称，如「青柠檬」「草莓」 */
  name: string;
  /** 英文名（可选） */
  nameEn: string;
  /** 品类 */
  category: FruitCategory;
  /** 规格，如「500g/袋」「1kg/盒」 */
  spec: string;
  /** 单位 */
  unit: FruitUnit;
  /** 当前库存（单位数量） */
  currentStock: number;
  /** 库存预警线 */
  alertThreshold: number;
  /** 最新进货价（元/单位） */
  latestCostPrice: number;
  /** 供应商/采购渠道 */
  supplier: string;
  /** 主要用途（如：装饰/果汁/调酒/食用） */
  usage: string;
  /** 备注 */
  notes: string;
  /** 是否在售 */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FruitTransaction {
  id: string;
  fruitItemId: string;
  /** 类型：in=入库，out=出库，adjust=盘点调整 */
  type: "in" | "out" | "adjust";
  /** 数量（正数入库，负数出库） */
  quantity: number;
  /** 单价（元/单位） */
  unitPrice: number;
  /** 总金额 */
  totalAmount: number;
  /** 关联备用金记录 ID（A5 蔬菜水果） */
  pettyRecordId?: string;
  /** 备注 */
  notes: string;
  date: string;
  createdAt: string;
}

export interface FruitMonthlySnapshot {
  id: string;
  /** 月份，格式 YYYY-MM */
  month: string;
  /** 快照时的所有水果库存 */
  items: Array<{
    fruitItemId: string;
    name: string;
    category: FruitCategory;
    unit: FruitUnit;
    openingStock: number;
    openingCost: number;
    purchaseQty: number;
    purchaseCost: number;
    closingStock: number;
    closingCost: number;
    consumedQty: number;
  }>;
  /** 本月进货总金额 */
  totalPurchaseCost: number;
  /** 备注 */
  notes: string;
  createdAt: string;
}

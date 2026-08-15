/** 菜品分类 */
export type FoodCategory = "cold" | "hot" | "soup" | "dessert" | "drink" | "staple" | "other";

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  cold: "凉菜",
  hot: "热菜",
  soup: "汤品",
  dessert: "甜点",
  drink: "饮品",
  staple: "主食",
  other: "其他",
};

/** 菜品 */
export interface FoodItem {
  id: string;
  name: string;
  category: FoodCategory;
  /** 售价（元） */
  price: number | null;
  /** 成本（元） */
  cost: number | null;
  /** 描述/做法简介 */
  description: string;
  /** 照片 URI */
  photoUri: string;
  /** 是否在售 */
  available: boolean;
  /** 过敏原标注 */
  allergens: string;
  createdAt: string;
  updatedAt: string;
}

/** 食材/原料分类 */
export type IngredientCategory = "meat" | "seafood" | "vegetable" | "fruit" | "grain" | "dairy" | "spice" | "sauce" | "frozen" | "other";

export const INGREDIENT_CATEGORY_LABELS: Record<IngredientCategory, string> = {
  meat: "肉类",
  seafood: "海鲜",
  vegetable: "蔬菜",
  fruit: "水果",
  grain: "米面粮油",
  dairy: "乳制品",
  spice: "香料调味",
  sauce: "酱料",
  frozen: "冻品",
  other: "其他",
};

/** 食材/原料条目 */
export interface FoodIngredient {
  id: string;
  name: string;
  /** 英文名（从供应商 Excel 中拆分出的英文部分） */
  nameEn?: string;
  category: IngredientCategory;
  /** 规格（如：500g/袋） */
  spec: string;
  /** 单位（如：袋、kg、个） */
  unit: string;
  /** 采购价 */
  costPrice: number | null;
  /** 当前库存数量 */
  stock: number;
  /** 供应商 */
  supplier: string;
  /** 备注 */
  notes: string;
  /** 价格历史（每次进货时追加） */
  priceHistory?: PriceHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

/** 价格历史记录条目 */
export interface PriceHistoryEntry {
  price: number;
  date: string;       // YYYY-MM-DD
  supplier: string;
  source: "manual" | "import";
}

/** 食材月度台账基础行。所有金额均由明细记录汇总，避免依赖当前库存倒推历史月份。 */
export interface FoodMonthlyLedgerEntry {
  id: string;
  month: string; // YYYY-MM
  ingredientId: string;
  openingQty: number;
  openingUnitCost: number;
  purchaseQty: number;
  purchaseCost: number;
  consumeQty: number;
  consumeCost: number;
  /** 月末实盘数量；未盘点时按期初+进货-消耗计算。 */
  actualClosingQty?: number;
  /** 实盘采用的单位成本；缺省时使用加权单位成本。 */
  actualClosingUnitCost?: number;
  createdAt: string;
  updatedAt: string;
}

export type FoodLedgerMovementKind = "purchase" | "consume" | "stocktake";

/** 食材月度台账的原子流水。采购、领用/损耗与盘点均以月份归属保存。 */
export interface FoodLedgerMovement {
  id: string;
  month: string; // YYYY-MM
  ingredientId: string;
  kind: FoodLedgerMovementKind;
  date: string; // YYYY-MM-DD
  quantity: number;
  unitCost: number;
  totalCost: number;
  supplier?: string;
  notes: string;
  createdAt: string;
}

/** 供应商进货记录（每次导入生成一批） */
export interface SupplierPurchaseRecord {
  id: string;
  supplierName: string;
  importDate: string;
  periodLabel: string;  // 如 "2026年6月"
  items: SupplierPurchaseItem[];
  totalAmount: number;
}

export interface SupplierPurchaseItem {
  /** 原始商品名（来自 Excel） */
  rawName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  date: string;
  orderNo: string;
  /** 匹配到的 FoodIngredient id（null=未匹配） */
  matchedIngredientId: string | null;
  /** 匹配置信度 0-100 */
  matchScore: number;
  /** 价格变动：正=涨价，负=降价，0=持平，null=首次 */
  priceDelta: number | null;
  /** 上次价格 */
  prevPrice: number | null;
}

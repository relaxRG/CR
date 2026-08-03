/**
 * 烈酒进销存类型定义
 * 对应 Excel「黎明前（2026）02烈酒.xlsx」数据结构
 * 工作表：Summary / 烈酒盘点 / 进货汇总 / 至缘 / 戎恒 / 自采 / 酒类信息
 */

// ─── 分类大类 ────────────────────────────────────────────────────────────────
export const SPIRIT_CATEGORIES = [
  "Base",
  "Gin",
  "Whisky",
  "Rum",
  "Liqueur",
  "Syrup",
  "Juice",
  "Bitters",
  "Vermouth",
  "Beer",
  "Wine",
  "Other",
] as const;

export type SpiritCategory = (typeof SPIRIT_CATEGORIES)[number];

/** 分类颜色映射 */
export const SPIRIT_CATEGORY_COLORS: Record<string, string> = {
  Base: "#EF4444",
  Gin: "#3B82F6",
  Whisky: "#F59E0B",
  Rum: "#10B981",
  Liqueur: "#8B5CF6",
  Syrup: "#EC4899",
  Juice: "#06B6D4",
  Bitters: "#84CC16",
  Vermouth: "#F97316",
  Beer: "#FBBF24",
  Wine: "#A855F7",
  Other: "#6B7280",
};

// ─── 烈酒台账条目 ────────────────────────────────────────────────────────────
/** 对应 Excel「烈酒盘点」工作表的一行 */
export interface SpiritInventoryItem {
  /** 产品序号（来自 Excel） */
  seq: number;
  /** 盘点分类（大类，如 Base/Gin/Whisky/Liqueur 等） */
  category: string;
  /** 中文名（来自盘点表） */
  name: string;
  /** 期初库存量 */
  initQty: number;
  /** 期初单位成本 */
  initUnitCost: number;
  /** 期初库存成本 */
  initCost: number;
  /** 本月进货量 */
  purchaseQty: number;
  /** 本月进货成本 */
  purchaseCost: number;
  /** 期末库存量 */
  endQty: number;
  /** 期末单位成本 */
  unitCost: number;
  /** 期末库存成本 */
  endCost: number;
  /** 消耗瓶数 */
  consumeBottles: number;
  /** 本期消耗量（成本） */
  consumeQty: number;
}

// ─── 供应商进货明细 ──────────────────────────────────────────────────────────
/** 对应 Excel「至缘」「戎恒」「自采」工作表的一行 */
export interface SpiritPurchaseOrderItem {
  /** 供应商名称 */
  supplier: string;
  /** 原始商品名（含中英文，如「白占边（金宾波本）/Jim Beam White」） */
  rawName: string;
  /** 解析出的中文名 */
  nameZh: string;
  /** 解析出的英文名 */
  nameEn: string;
  /** 单价 */
  unitPrice: number;
  /** 数量 */
  quantity: number;
  /** 金额 */
  amount: number;
  /** 规格（如 700ml） */
  spec: string;
  /** 日期 */
  date: string;
}

// ─── 酒类信息条目 ────────────────────────────────────────────────────────────
/** 对应 Excel「酒类信息」工作表的一行 */
export interface SpiritInfoItem {
  /** 中文名 */
  nameZh: string;
  /** 英文名 */
  nameEn: string;
  /** 参考单价 */
  refPrice: number;
  /** 规格 */
  spec: string;
}

// ─── 月度快照 ────────────────────────────────────────────────────────────────
/** 一次 Excel 导入生成的月度烈酒进销存快照 */
export interface SpiritMonthlySnapshot {
  id: string;
  /** 月份标签，如 "2026年2月" */
  monthLabel: string;
  /** 导入时间 */
  importedAt: string;
  /** 台账数据（烈酒盘点） */
  items: SpiritInventoryItem[];
  /** 供应商进货明细（至缘/戎恒/自采合并） */
  purchaseOrders: SpiritPurchaseOrderItem[];
  /** 供应商本月进货额汇总 { supplierName: amount } */
  supplierTotals: Record<string, number>;
  /** 分类本月进货额汇总 { category: amount } */
  categoryTotals: Record<string, number>;
  /** 月总进货额 */
  totalPurchase: number;
  /** 月总消耗成本 */
  totalConsume: number;
  /** 期末总库存成本 */
  totalEndCost: number;
}

// ─── 手动进货记录 ────────────────────────────────────────────────────────────
export interface SpiritManualPurchase {
  id: string;
  date: string;          // YYYY-MM-DD
  supplier: string;
  /** 对应 Bottle.id（若已匹配） */
  bottleId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  notes: string;
  createdAt: string;
}

// ─── 智能匹配记录 ────────────────────────────────────────────────────────────
/** 至缘商品名与 Bottle 库的匹配记录（支持记忆和人工纠错） */
export interface SpiritMatchRecord {
  /** 原始商品名（至缘格式） */
  rawName: string;
  /** 匹配到的 Bottle.id（null 表示无法匹配） */
  bottleId: string | null;
  /** 置信度：high / medium / low / manual */
  confidence: "high" | "medium" | "low" | "manual";
  /** 是否已人工确认 */
  confirmed: boolean;
  /** 最后更新时间 */
  updatedAt: string;
}

// ─── 新版 CRUD 类型（手动增删改+月份切换+进货流水） ────────────────────────

/** 酒款档案（品类目录），独立于月份存在 */
export interface SpiritItem {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  unit: string;
  refPrice: number;
  supplier?: string;
  spec?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 每一笔进货流水（对应 Excel 一行：日期/品名/单位/数量/单价/金额） */
export interface SpiritPurchaseRecord {
  id: string;
  month: string;        // YYYY-MM
  date: string;         // YYYY-MM-DD
  itemId?: string;      // 关联酒款 ID
  rawName: string;      // 原始商品名
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  supplier?: string;
  notes?: string;
  source: "manual" | "excel";
  createdAt: string;
}

/** 某月某款酒的台账数据（期初/进货/消耗/期末） */
export interface SpiritLedgerEntry {
  id: string;
  month: string;           // YYYY-MM
  itemId: string;
  openingQty: number;      // 期初库存量
  openingUnitCost: number; // 期初单价
  purchaseQty: number;     // 本月进货量（自动汇总）
  purchaseCost: number;    // 本月进货成本（自动汇总）
  consumeQty: number;      // 本月消耗量（手动录入）
  closingQty: number;      // 期末库存量 = 期初+进货-消耗
  closingUnitCost: number; // 期末单价
  closingCost: number;     // 期末库存成本
  isClosed: boolean;
  updatedAt: string;
}

// ─── 价格变动记录 ────────────────────────────────────────────────────────────
export interface SpiritPriceChange {
  /** 商品名 */
  name: string;
  /** 上期单价 */
  prevPrice: number;
  /** 本期单价 */
  currPrice: number;
  /** 变动百分比 */
  changePct: number;
  /** 供应商 */
  supplier: string;
}

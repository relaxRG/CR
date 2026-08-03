/**
 * 通用进销存核心类型定义
 * 所有品类（烈酒/葡萄酒/食材/啤酒/冰块/水果/杯具/餐具/日用品/设备）共用此结构
 *
 * 核心公式：
 *   期末库存量 = 期初库存量 + 本月进货量 - 本月消耗量
 *   期末库存成本 = 期末库存量 × 期末单位成本
 *   期末单位成本 = (期初库存成本 + 本月进货成本) / (期初库存量 + 本月进货量)
 */

// ─── 月度台账条目（每款商品一行，对标 Excel 格式）────────────────────────────
export interface MonthlyLedgerItem {
  /** 商品 ID（关联各自 Store 的 item.id） */
  itemId: string;
  /** 商品名称（快照时复制，防止改名后历史数据错乱） */
  name: string;
  /** 英文名（可选） */
  nameEn?: string;
  /** 分类标签（如品类/供应商/杯型等，各品类自定义） */
  category: string;
  /** 规格 */
  spec?: string;
  /** 单位 */
  unit: string;

  // ── 期初 ──
  /** 期初库存量 */
  openingQty: number;
  /** 期初单位成本（元/单位） */
  openingUnitCost: number;
  /** 期初库存成本 = openingQty × openingUnitCost */
  openingCost: number;

  // ── 本月进货 ──
  /** 本月进货量 */
  purchaseQty: number;
  /** 本月进货成本 */
  purchaseCost: number;

  // ── 本月消耗/出库 ──
  /** 本月消耗/出库量 */
  consumeQty: number;
  /** 本月消耗成本 */
  consumeCost: number;

  // ── 期末 ──
  /** 期末库存量 = 期初 + 进货 - 消耗 */
  closingQty: number;
  /** 期末单位成本（加权平均） */
  closingUnitCost: number;
  /** 期末库存成本 = closingQty × closingUnitCost */
  closingCost: number;

  // ── 损耗（杯具/餐具专用，其他品类为 0）──
  /** 损耗数量（破损/丢失） */
  lossQty: number;
  /** 损耗金额 */
  lossCost: number;

  /** 备注 */
  notes?: string;
}

// ─── 月度快照（一次月结生成一条）────────────────────────────────────────────
export interface MonthlySnapshot {
  id: string;
  /** 月份，格式 YYYY-MM */
  month: string;
  /** 品类标识（beer/ice/fruit/glassware/tableware/daily/equipment/food） */
  category: string;
  /** 台账明细 */
  items: MonthlyLedgerItem[];
  /** 本月进货总额 */
  totalPurchaseCost: number;
  /** 本月消耗总成本 */
  totalConsumeCost: number;
  /** 期末总库存成本 */
  totalClosingCost: number;
  /** 本月损耗总额（杯具/餐具） */
  totalLossCost: number;
  /** 备注 */
  notes: string;
  /** 创建时间 */
  createdAt: string;
}

// ─── 月度台账计算工具函数 ────────────────────────────────────────────────────
/**
 * 计算期末单位成本（加权平均法）
 * 公式：(期初库存成本 + 本月进货成本) / (期初库存量 + 本月进货量)
 */
export function calcClosingUnitCost(
  openingQty: number,
  openingUnitCost: number,
  purchaseQty: number,
  purchaseCost: number
): number {
  const totalQty = openingQty + purchaseQty;
  if (totalQty <= 0) return openingUnitCost;
  const totalCost = openingQty * openingUnitCost + purchaseCost;
  return Math.round((totalCost / totalQty) * 100) / 100;
}

/**
 * 计算期末库存量
 * 公式：期初 + 进货 - 消耗 - 损耗
 */
export function calcClosingQty(
  openingQty: number,
  purchaseQty: number,
  consumeQty: number,
  lossQty: number = 0
): number {
  return Math.max(0, openingQty + purchaseQty - consumeQty - lossQty);
}

/**
 * 从上月快照中提取某商品的期末数据，作为本月期初
 */
export function getOpeningFromLastMonth(
  lastSnapshot: MonthlySnapshot | null,
  itemId: string
): { qty: number; unitCost: number } {
  if (!lastSnapshot) return { qty: 0, unitCost: 0 };
  const item = lastSnapshot.items.find((i) => i.itemId === itemId);
  if (!item) return { qty: 0, unitCost: 0 };
  return { qty: item.closingQty, unitCost: item.closingUnitCost };
}

/**
 * 获取上一个月的月份字符串
 */
export function getPrevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * 获取当前月份字符串 YYYY-MM
 */
export function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ─── 进货记录（通用）────────────────────────────────────────────────────────
export interface PurchaseRecord {
  id: string;
  /** 关联商品 ID */
  itemId: string;
  /** 商品名称（快照） */
  itemName: string;
  /** 进货数量 */
  quantity: number;
  /** 单价 */
  unitPrice: number;
  /** 总金额 */
  totalAmount: number;
  /** 供应商 */
  supplier: string;
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 备注 */
  notes: string;
  createdAt: string;
}

// ─── 出库/消耗记录（通用）───────────────────────────────────────────────────
export interface ConsumeRecord {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  /** 消耗原因：normal=正常消耗, loss=损耗/破损, adjust=盘点调整 */
  reason: "normal" | "loss" | "adjust";
  /** 损耗原因描述（杯具/餐具专用） */
  lossReason?: string;
  date: string;
  notes: string;
  createdAt: string;
}

// ─── 设备专用：折旧和维修 ────────────────────────────────────────────────────
export interface EquipmentItem {
  id: string;
  name: string;
  nameEn?: string;
  /** 设备类型（制冰机/冰箱/调酒设备/音响/灯光/POS/其他） */
  equipmentType: string;
  /** 规格/型号 */
  spec: string;
  /** 购入日期 YYYY-MM-DD */
  purchaseDate: string;
  /** 购入价格（元） */
  purchasePrice: number;
  /** 预计使用年限（年） */
  usefulLifeYears: number;
  /** 残值率（%，默认 0） */
  residualRate: number;
  /** 当前状态：normal=正常, repair=维修中, scrapped=报废 */
  status: "normal" | "repair" | "scrapped";
  /** 供应商/品牌 */
  supplier: string;
  /** 备注 */
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 月折旧金额 = (购入价 × (1 - 残值率)) / (使用年限 × 12) */
export function calcMonthlyDepreciation(item: EquipmentItem): number {
  if (item.usefulLifeYears <= 0 || item.purchasePrice <= 0) return 0;
  const depreciable = item.purchasePrice * (1 - item.residualRate / 100);
  return Math.round((depreciable / (item.usefulLifeYears * 12)) * 100) / 100;
}

/** 累计折旧月数 */
export function calcDepreciatedMonths(purchaseDate: string): number {
  const purchase = new Date(purchaseDate);
  const now = new Date();
  return (now.getFullYear() - purchase.getFullYear()) * 12 + (now.getMonth() - purchase.getMonth());
}

/** 当前账面净值 = 购入价 - 累计折旧 */
export function calcBookValue(item: EquipmentItem): number {
  const monthly = calcMonthlyDepreciation(item);
  const months = calcDepreciatedMonths(item.purchaseDate);
  const residual = item.purchasePrice * (item.residualRate / 100);
  return Math.max(residual, item.purchasePrice - monthly * months);
}

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  equipmentName: string;
  /** 维修日期 YYYY-MM-DD */
  date: string;
  /** 维修内容描述 */
  description: string;
  /** 维修费用（元） */
  cost: number;
  /** 维修供应商/维修人 */
  vendor: string;
  notes: string;
  createdAt: string;
}

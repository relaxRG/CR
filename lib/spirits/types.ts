/**
 * 烈酒进销存类型定义（升级版）
 * 对应 Excel「黎明前（2026）02烈酒.xlsx」数据结构
 * 工作表：Summary / 烈酒盘点 / 进货汇总 / 至缘 / 戎恒 / 自采 / 酒类信息
 */

// ─── 自定义分类类型 ──────────────────────────────────────────────────────────
/** 用户自定义分类；内置分类可在此保存名称、颜色、顺序覆盖或删除标记。 */
export interface SpiritCustomCategory {
  /** 唯一 ID，内置分类使用原名作为 ID，自定义分类使用 uuid */
  id: string;
  /** 显示名称（可被用户修改） */
  name: string;
  /** 原始名称（内置分类的英文原名，用于向后兼容） */
  originalName?: string;
  /** 颜色 hex */
  color: string;
  /** 是否来自初始内置分类集。 */
  builtin: boolean;
  /** 内置分类删除后的持久化墓碑；防止下次启动被默认分类重新注入。 */
  deleted?: boolean;
  /** 用户自定义显示顺序；历史数据缺失时按原始内置顺序与创建时间回退。 */
  order?: number;
  createdAt: string;
}

// ─── 分类大类 ────────────────────────────────────────────────────────────────
export const SPIRIT_CATEGORIES = [
  "Base (Whisky)",
  "Base (Gin)",
  "Base (Tequila)",
  "Base (Rum)",
  "Base (Vodka)",
  "Base (Brandy)",
  "Liqueur (Whisky)",
  "Liqueur (Gin)",
  "Liqueur (Rum)",
  "Liqueur (Vodka)",
  "Liqueur (Brandy)",
  "Mezcal",
  "Vermouth",
  "Sherry",
  "Port",
  "Amaro",
  "Aperitif",
  "Orange Liqueur",
  "Fruit Liqueur",
  "Herb & Spice Liqueur",
  "Herbal/Floral Liqueur",
  "Flavored Liqueur",
  "Japanese Liqueur",
  "Chinese Liqueur",
  "Absinthe",
  "Bitters",
  "Syrup",
  "Soft Drink",
  "Juice",
  "Purée",
  "Gin",
  "Tequila",
  "Rum",
  "Vodka",
  "Cognac",
  "Japanese whisky",
  "Scotch Whisky (Islay)",
  "Scotch Whisky (Speyside)",
  "Scotch Whisky (Highland)",
  "Scotch Whisky (Islands)",
  "Scotch Whisky (Campbeltown)",
  "Scotch Whisky (Lowland)",
  "Beer",
  "Wine",
  "Other",
] as const;

export type SpiritCategory = (typeof SPIRIT_CATEGORIES)[number];

/** 分类颜色映射 */
export const SPIRIT_CATEGORY_COLORS: Record<string, string> = {
  "Base (Whisky)": "#F59E0B",
  "Base (Gin)": "#3B82F6",
  "Base (Tequila)": "#10B981",
  "Base (Rum)": "#EF4444",
  "Base (Vodka)": "#6B7280",
  "Base (Brandy)": "#92400E",
  "Liqueur (Whisky)": "#D97706",
  "Liqueur (Gin)": "#2563EB",
  "Liqueur (Rum)": "#DC2626",
  "Liqueur (Vodka)": "#4B5563",
  "Liqueur (Brandy)": "#78350F",
  Mezcal: "#059669",
  Vermouth: "#F97316",
  Sherry: "#B45309",
  Port: "#7C3AED",
  Amaro: "#065F46",
  Aperitif: "#DB2777",
  "Orange Liqueur": "#EA580C",
  "Fruit Liqueur": "#16A34A",
  "Herb & Spice Liqueur": "#15803D",
  "Herbal/Floral Liqueur": "#86EFAC",
  "Flavored Liqueur": "#A78BFA",
  "Japanese Liqueur": "#E11D48",
  "Chinese Liqueur": "#B91C1C",
  Absinthe: "#4ADE80",
  Bitters: "#84CC16",
  Syrup: "#EC4899",
  "Soft Drink": "#06B6D4",
  Juice: "#0EA5E9",
  Purée: "#F472B6",
  Gin: "#3B82F6",
  Tequila: "#10B981",
  Rum: "#EF4444",
  Vodka: "#6B7280",
  Cognac: "#92400E",
  "Japanese whisky": "#E11D48",
  "Scotch Whisky (Islay)": "#F59E0B",
  "Scotch Whisky (Speyside)": "#D97706",
  "Scotch Whisky (Highland)": "#B45309",
  "Scotch Whisky (Islands)": "#92400E",
  "Scotch Whisky (Campbeltown)": "#78350F",
  "Scotch Whisky (Lowland)": "#6B7280",
  Beer: "#FBBF24",
  Wine: "#A855F7",
  Other: "#6B7280",
};

// ─── 供应商信息卡 ────────────────────────────────────────────────────────────
export type SpiritProcurementChannelType = "supplier" | "online";

/** 采购档案中可引用的合同、资质或沟通文件元数据；二进制文件不写入业务状态。 */
export interface SpiritSupplierDocument {
  id: string;
  name: string;
  mimeType: string;
  storageKey: string;
  uploadedAt: string;
}

export interface SpiritSupplierInfo {
  id: string;
  name: string;
  /** 供货商=集中付款；网络采购=必须通过备用金或明确的付款关联。旧 isSelfBuy 读取时兼容为 online。 */
  channelType?: SpiritProcurementChannelType;
  /** 各入口读取同一顺序；缺失时按既有创建顺序迁移。 */
  sortOrder?: number;
  companyName?: string;
  contact?: string;
  contactName?: string;
  phone?: string;
  wechat?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  /** 供货商的约定付款周期（天）或文本付款条款。 */
  paymentCycleDays?: number;
  paymentTerms?: string;
  /** 网络采购平台主页；单品跳转链接保留在供应渠道记录，避免污染酒款主档。 */
  platformUrl?: string;
  documents?: SpiritSupplierDocument[];
  notes?: string;
  /** @deprecated 使用 channelType: "online"；为旧数据兼容保留。 */
  isSelfBuy?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 参考单价（按月生效） ────────────────────────────────────────────────────
/** 某款酒在某月的参考单价 */
export interface SpiritRefPrice {
  itemId: string;
  month: string;      // YYYY-MM，从该月起生效
  price: number;
  setAt: string;      // 设置时间
  setBy: "manual" | "import";  // 来源
}

// ─── 烈酒台账条目 ────────────────────────────────────────────────────────────
/** 对应 Excel「烈酒盘点」工作表的一行 */
export interface SpiritInventoryItem {
  seq: number;
  category: string;
  name: string;
  initQty: number;
  initUnitCost: number;
  initCost: number;
  purchaseQty: number;
  purchaseCost: number;
  endQty: number;
  unitCost: number;
  endCost: number;
  /** Excel第11列：消耗瓶数。 */
  consumeBottles: number;
  /** Excel第12列：本期消耗成本。 */
  consumeCost: number;
}

// ─── 供应商进货明细 ──────────────────────────────────────────────────────────
export interface SpiritPurchaseOrderItem {
  supplier: string;
  rawName: string;
  nameZh: string;
  nameEn: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  spec: string;
  date: string;
}

// ─── 酒类信息条目 ────────────────────────────────────────────────────────────
export interface SpiritInfoItem {
  nameZh: string;
  nameEn: string;
  refPrice: number;
  spec: string;
}

// ─── 月度快照 ────────────────────────────────────────────────────────────────
export interface SpiritMonthlySnapshot {
  id: string;
  monthLabel: string;
  importedAt: string;
  items: SpiritInventoryItem[];
  purchaseOrders: SpiritPurchaseOrderItem[];
  supplierTotals: Record<string, number>;
  categoryTotals: Record<string, number>;
  totalPurchase: number;
  totalConsume: number;
  totalEndCost: number;
}

// ─── 手动进货记录 ────────────────────────────────────────────────────────────
export interface SpiritManualPurchase {
  id: string;
  date: string;
  supplier: string;
  bottleId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  notes: string;
  createdAt: string;
}

// ─── 智能匹配记录 ────────────────────────────────────────────────────────────
export interface SpiritMatchRecord {
  rawName: string;
  bottleId: string | null;
  confidence: "high" | "medium" | "low" | "manual";
  confirmed: boolean;
  updatedAt: string;
}

// ─── 新版 CRUD 类型 ──────────────────────────────────────────────────────────

/** 同一烈酒主档在某个供应商处使用的采购名称；用于匹配与展示，不复制酒款主档。 */
export interface SpiritSupplierAlias {
  supplier: string;
  purchaseName: string;
  normalizedSupplier: string;
  normalizedName: string;
}

/** 酒款档案（品类目录），独立于月份存在 */
export interface SpiritItem {
  id: string;
  name: string;
  nameEn?: string;
  /** 进销存分类（用于成本报表分析，独立于酒库分类） */
  category: string;
  /** 分类来源：manual=人工设置，bottle=从酒库同步，auto=自动推断 */
  categorySource?: "manual" | "bottle" | "auto";
  /** 所属集团（品牌归属） */
  group?: string;
  unit: string;
  /** 当前参考单价（最新值，用于显示；历史按月查 refPrices） */
  refPrice: number;
  /** 主要供应商；保留既有字段以兼容历史档案。 */
  supplier?: string;
  /** 供应商专属采购名称；同一标准烈酒可对应不同供应商写法。 */
  supplierAliases?: SpiritSupplierAlias[];
  spec?: string;
  /** 规格容量（ml），用于计算每 ml 单价。
   * 优先使用此字段；未设置时自动从 spec 字段解析（如 "700ML" → 700）。 */
  specMl?: number;
  active: boolean;
  /** 价格异常阈值（%），进货单价偏差超过此值时标记异常。
   * 默认为 0，即只要有涨跌（哪怕 1%）就显示涨跌金额和百分比。
   * 设置为 30 则仅当偏差超过 30% 时才标记异常。 */
  priceAlertPct?: number;
  /** 关联酒库档案 ID（可选，用于跳转酒库详情页） */
  bottleId?: string;
  /** 酒库关联置信度：confirmed=人工确认，auto=自动匹配，none=未关联 */
  bottleLinkConfidence?: "confirmed" | "auto" | "none";
  createdAt: string;
  updatedAt: string;
}

/** 每一笔进货流水 */
export interface SpiritPurchaseRecord {
  id: string;
  month: string;        // YYYY-MM
  date: string;         // YYYY-MM-DD
  itemId?: string;      // 关联酒款 ID
  rawName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  supplier?: string;
  /** 品牌集团归属（自动识别或手动填写） */
  group?: string;
  /** 进销存分类（从关联 SpiritItem 同步，可单独覆盖） */
  category?: string;
  notes?: string;
  source: "manual" | "excel" | "pdf";
  createdAt: string;
}

/** 某月某款酒的台账数据 */
export interface SpiritLedgerEntry {
  id: string;
  month: string;           // YYYY-MM
  itemId: string;
  openingQty: number;      // 期初库存量（可手工修改）
  openingUnitCost: number; // 期初单价
  /** 期初是否被手工修改（与上月期末不符时标记） */
  openingManualOverride?: boolean;
  /** 上月期末库存量（用于对比提示） */
  prevClosingQty?: number;
  purchaseQty: number;     // 本月进货量（自动汇总）
  purchaseCost: number;    // 本月进货成本（自动汇总）
  consumeQty: number;      // 本月消耗瓶数（手动录入或盘点反推）
  /** 本月消耗成本。 */
  consumeCost: number;
  closingQty: number;      // 期末库存量 = 期初+进货-消耗
  closingUnitCost: number; // 期末单价
  closingCost: number;     // 期末库存成本
  isClosed: boolean;
  updatedAt: string;
}

// ─── 价格变动记录 ────────────────────────────────────────────────────────────
export interface SpiritPriceChange {
  name: string;
  prevPrice: number;
  currPrice: number;
  changePct: number;
  changeAmt: number;   // 具体涨跌金额
  supplier: string;
}

// ─── 当月进货汇总行（每款酒一行，每供应商2列：数量+金额） ───────────────────
export interface SpiritPurchaseSummaryRow {
  itemId: string;
  itemName: string;
  category: string;
  /** 当月参考单价 */
  refPrice: number;
  /** 上月参考单价（用于对比） */
  prevRefPrice?: number;
  /** 每个供应商的进货数量和金额 { supplierName: { qty, amount, unitPrice } } */
  bySupplier: Record<string, { qty: number; amount: number; unitPrice: number }>;
  /** 合计数量 */
  totalQty: number;
  /** 合计金额 */
  totalAmount: number;
}

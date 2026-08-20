/** 葡萄酒风格 */
export type WineStyle = "red" | "white" | "rose" | "sparkling" | "sweet" | "fortified" | "other";

/** 同一标准酒款在特定供应商处使用的采购名称；仅用于识别与展示，不复制酒款主档。 */
export interface WineSupplierAlias {
  supplier: string;
  purchaseName: string;
  /** 规范化后用于确定性匹配，历史记录首次读取时可重建。 */
  normalizedSupplier: string;
  normalizedName: string;
}

/** 葡萄酒条目 */
export interface WineBottle {
  id: string;
  /** 中文名称 */
  name: string;
  /** 英文/原文名称 */
  nameEn: string;
  /** 年份 */
  vintage: string;
  /** 产区（如：波尔多、勃艮第、纳帕谷） */
  region: string;
  /** 品种（如：赤霞珠、霞多丽） */
  grape: string;
  /** 酒庄/品牌 */
  winery: string;
  /** 风格 */
  style: WineStyle;
  /** 酒精度（%） */
  abv: number | null;
  /** 进价（元）— 最新参考进价 */
  costPrice: number | null;
  /** 售价（元） */
  salePrice: number | null;
  /** 当前库存（瓶） */
  stock: number;
  /** 评分（0-100，WS/RP风格） */
  rating: number | null;
  /** 品鉴笔记 */
  notes: string;
  /** 照片 URI */
  photoUri: string;
  /** 默认/主要供应商；保留以兼容既有酒款档案。 */
  supplier: string;
  /** 供应商专属采购名称；一款标准酒可对应多个供应商写法。 */
  supplierAliases?: WineSupplierAlias[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  // ★ 新增字段
  /** 规格容量（ml），用于 Pour Cost 计算，默认 750 */
  specMl?: number;
  /** 单杯分量（ml），用于 Pour Cost 计算 */
  servingSize?: number;
  /** 价格预警阈值（%），超过此涨幅显示 ⚠️，默认 0（全部显示） */
  priceAlertPct?: number;
  /** 历史参考单价 { "YYYY-MM": price } */
  refPrices?: Record<string, number>;
}

// ─── 进销存台账字段 ─────────────────────────────────────────────────────────

/** 葡萄酒进销存台账条目（对应 Excel 葡萄酒盘点表的一行） */
export interface WineInventoryItem {
  /** 产品序号（来自 Excel） */
  seq: number;
  /** 酒类（Red / White / Rose / Sparkling / Natural Wine 等） */
  wineType: string;
  /** 盘点分类（即供应商名称，如：甘澧、Interprocom） */
  supplier: string;
  /** 中文名 */
  name: string;
  /** 期初单位成本 */
  initUnitCost: number;
  /** 期初库存量（瓶） */
  initQty: number;
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
  // ★ 新增：实际盘点期末库存量（月末盘点后填入）
  actualEndQty?: number;
}

/** 进货总单明细条目（对应 Excel 进货总单表的一行） */
export interface WinePurchaseOrderItem {
  date: string;          // YYYY-MM-DD
  supplier: string;
  productName: string;   // 原始商品名（中英混合）
  unitPrice: number;
  quantity: number;
  amount: number;
}

/** 一次 Excel 导入生成的月度进销存快照 */
export interface WineMonthlySnapshot {
  id: string;
  /** 月份标签，如 "2026年2月" */
  monthLabel: string;
  /** 导入时间 */
  importedAt: string;
  /** 台账数据 */
  items: WineInventoryItem[];
  /** 进货总单明细 */
  purchaseOrders: WinePurchaseOrderItem[];
  /** 供应商本月进货额汇总 { supplierName: amount } */
  supplierTotals: Record<string, number>;
  /** 月总进货额 */
  totalPurchase: number;
  /** 月总消耗成本 */
  totalConsume: number;
  /** 期末总库存成本 */
  totalEndCost: number;
}

/** 手动进货录入记录 */
export type WinePurchaseSource = "manual" | "workbook";

/** 唯一采购流水；手动录入和复杂工作簿的进货总单共用同一账本。 */
export interface WineManualPurchase {
  id: string;
  date: string;          // YYYY-MM-DD
  supplier: string;
  /** 对应 WineBottle.id（若已匹配） */
  bottleId: string | null;
  productName: string;
  /** 当前采购流水的人工分类；缺省时按已关联酒款或台账分类展示。 */
  category?: WineStyle;
  unitPrice: number;
  quantity: number;
  amount: number;
  notes: string;
  createdAt: string;
  /** 数据来源；缺省历史记录按 manual 迁移。 */
  source?: WinePurchaseSource;
  /** 复杂工作簿导入批次；手动记录为空。 */
  importBatchId?: string;
  /** 确定性行指纹，用于阻止重复导入。 */
  importFingerprint?: string;
  /** 原始工作表与行号，便于审计和回退。 */
  sourceSheet?: string;
  sourceRow?: number;
  // ★ 新增字段
  /** 与上次进货单价的差值（正=涨价，负=降价） */
  unitPriceDelta?: number;
  /** 是否触发价格预警 */
  priceAlertTriggered?: boolean;
}

export type WineImportBatchStatus = "imported" | "replaced" | "cleared" | "recalculated" | "restored";

/** 一次复杂工作簿导入或强制业务操作的可审计批次。 */
export interface WineImportBatch {
  id: string;
  month: string;
  filename: string;
  fileFingerprint: string;
  sourceSchema: "wine_workbook_v1";
  status: WineImportBatchStatus;
  importedAt: string;
  sourceSheets: string[];
  parsedRows: { inventory: number; purchases: number; summary: number; purchaseSummary: number };
  appliedRows: { inventory: number; purchases: number; skippedDuplicates: number; conflicts: number };
  note?: string;
}

/** 清空、重算或替换前保存的一次本月可恢复状态。 */
export interface WineMonthRestorePoint {
  id: string;
  month: string;
  reason: "before_clear_purchases" | "before_recalculate" | "before_replace_import";
  createdAt: string;
  snapshot: WineMonthlySnapshot | null;
  purchases: WineManualPurchase[];
  batchIds: string[];
}

/** 仅记录会改变持久化业务数据的葡萄酒工作台操作。 */
export interface WineAuditEntry {
  id: string;
  month: string;
  action: "workbook_import" | "clear_month_purchases" | "recalculate_month_inventory" | "restore_month";
  occurredAt: string;
  detail: string;
  affected: { snapshots: number; purchases: number; batches: number };
  restorePointId?: string;
}

export const WINE_STYLE_LABELS: Record<WineStyle, string> = {
  red: "红葡萄酒",
  white: "白葡萄酒",
  rose: "桃红葡萄酒",
  sparkling: "起泡酒",
  sweet: "甜酒",
  fortified: "加强酒",
  other: "其他",
};

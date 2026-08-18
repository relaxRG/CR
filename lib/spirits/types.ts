/**
 * 烈酒进销存类型定义（升级版）
 * 对应 Excel「黎明前（2026）02烈酒.xlsx」数据结构
 * 工作表：Summary / 烈酒盘点 / 进货汇总 / 至缘 / 戎恒 / 自采 / 酒类信息
 */

// ─── 自定义分类类型 ──────────────────────────────────────────────────────────
/** 用户自定义分类（内置分类不在此列表中，但可被重命名覆盖） */
export interface SpiritCustomCategory {
  /** 唯一 ID，内置分类使用原名作为 ID，自定义分类使用 uuid */
  id: string;
  /** 显示名称（可被用户修改） */
  name: string;
  /** 原始名称（内置分类的英文原名，用于向后兼容） */
  originalName?: string;
  /** 颜色 hex */
  color: string;
  /** 是否为内置分类（内置不可删除） */
  builtin: boolean;
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

// ─── 品牌集团归属 ────────────────────────────────────────────────────────────
export const SPIRIT_GROUPS = [
  "保乐力加 (Pernod Ricard)",
  "金巴利集团 (Campari Group)",
  "帝亚吉欧 (Diageo)",
  "百富门 (Brown-Forman)",
  "宾三得利 (Beam Suntory)",
  "人头马君度 (Rémy Cointreau)",
  "路威酩轩 (LVMH)",
  "独立品牌",
  "其他",
] as const;

export type SpiritGroup = (typeof SPIRIT_GROUPS)[number];

/** 品牌集团旗下品牌关键词（用于自动识别，扩充版） */
export const GROUP_BRAND_KEYWORDS: Record<string, string[]> = {
  "保乐力加 (Pernod Ricard)": [
    "芝华士", "chivas", "百龄坛", "ballantine", "必富达", "beefeater", "哈瓦那", "havana",
    "马爹利", "martell", "甘露", "kahlua", "马利宝", "malibu", "三得利响", "hibiki",
    "皇家礼炮", "royal salute", "绝对", "absolut", "必富达", "beefeater",
    "格兰利威", "glenlivet", "格兰冠", "glen grant", "朗格斯", "longmorn",
    "布纳哈本", "bunnahabhain", "斯特拉塞斯拉", "strathisla",
  ],
  "金巴利集团 (Campari Group)": [
    "金巴利", "campari", "阿佩罗", "aperol", "深蓝", "skyy", "野火鸡", "wild turkey",
    "大马利尼", "grand marnier", "古贝塔", "courvoisier", "appleton",
    "拉斐尔", "russell", "奥维尔", "averna", "cynar", "braulio",
  ],
  "帝亚吉欧 (Diageo)": [
    "尊尼获加", "johnnie walker", "添加利", "tanqueray", "贝利", "baileys",
    "摩根船长", "captain morgan", "卡露华", "kahlua", "斯米诺", "smirnoff",
    "尊美醇", "jameson", "乐加维林", "lagavulin", "泰斯卡", "talisker",
    "克里尼利基", "clynelish", "卡尔里拉", "caol ila", "布朗拉", "brora",
    "格兰乌吉", "glenkinchie", "欧本", "oban", "克拉格摩尔", "cragganmore",
    "皇家蓝勋", "royal blue", "温莎", "windsor", "百利", "baileys",
  ],
  "百富门 (Brown-Forman)": [
    "杰克丹尼", "jack daniel", "白占边", "jim beam", "美格", "maker",
    "老福斯特", "old forester", "伍德福德", "woodford",
    "本利亚克", "benriach", "格兰多纳", "glendronach", "格兰格拉索", "glenglassaugh",
    "芬兰", "finlandia", "圣诞老人", "santa",
  ],
  "宾三得利 (Beam Suntory)": [
    "山崎", "yamazaki", "白州", "hakushu", "知多", "chita", "角瓶", "kakubin",
    "三得利", "suntory", "响", "hibiki", "乐加维林", "laphroaig",
    "波摩", "bowmore", "艾登", "auchentoshan", "格兰吉斯", "glen garioch",
    "麦卡伦", "macallan",
  ],
  "人头马君度 (Rémy Cointreau)": [
    "人头马", "remy martin", "君度", "cointreau", "路易十三", "louis xiii",
    "圣哲曼", "st germain", "metaxa", "布鲁克拉迪", "bruichladdich",
    "波特夏洛特", "port charlotte", "奥特摩", "octomore",
    "安格斯图拉", "angostura",
  ],
  "路威酩轩 (LVMH)": [
    "轩尼诗", "hennessy", "格兰摩兰吉", "glenmorangie", "阿贝", "ardbeg",
    "克鲁格", "krug", "唐培里侬", "dom perignon", "酩悦", "moet",
  ],
};

// ─── 供应商信息卡 ────────────────────────────────────────────────────────────
export interface SpiritSupplierInfo {
  id: string;
  name: string;
  contact?: string;
  contactName?: string;
  phone?: string;
  wechat?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  notes?: string;
  /** 是否为自采渠道（关联备用金） */
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
  supplier?: string;
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

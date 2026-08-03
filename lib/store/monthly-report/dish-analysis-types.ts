/**
 * 菜品分析报表类型定义 (Build 135)
 *
 * 四层分析：
 *   1. 大类（Food/Cocktail/Wine/Beer/Beverage/Shot）
 *   2. 小类（Fusion cuisine/White Wine/Red Wine/Cocktail 等）
 *   3. 菜品名称（每道菜）
 *   4. 规格（同一菜品不同规格）
 */

// ─── 菜品大类（来自「菜品大类」Excel） ────────────────────────────────────────
export interface DishCategoryData {
  /** 大类名称，如 "Food" "Cocktail" "Wine" */
  name: string;
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discount: number;
}

// ─── 菜品小类（来自「菜品小类」Excel） ────────────────────────────────────────
export interface DishSubCategoryData {
  /** 所属大类 */
  category: string;
  /** 小类名称，如 "Fusion cuisine" "White Wine" */
  subCategory: string;
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discount: number;
}

// ─── 菜品明细（来自「菜品名称」Excel） ────────────────────────────────────────
export interface DishItemData {
  name: string;
  /** 品项类型（普通菜/套餐等） */
  itemType?: string;
  /** 售卖状态（在售/停售） */
  saleStatus?: string;
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discount: number;
}

// ─── 菜品规格（来自「菜品名称+规格」Excel） ───────────────────────────────────
export interface DishSpecData {
  name: string;
  spec: string; // 规格，如 "Regular 正常" "--"
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discount: number;
}

// ─── 营业收入与收款统计（来自「营业收入与收款统计」Excel） ─────────────────────
export interface RevenueStatement {
  /** 营业额（订单金额合计） */
  grossRevenue: number;
  /** 优惠金额合计 */
  totalDiscount: number;
  /** 优惠明细 */
  discountBreakdown: {
    memberCard: number;
    meituan: number;
    manualDiscount: number;
    roundOff: number;
  };
  /** 营业收入（含团购服务费） */
  netRevenue: number;
  /** 其他业务收款 */
  otherRevenue: number;
  /** 收款合计 */
  totalReceipts: number;
  /** 财务费用合计 */
  totalFinancialFees: number;
  /** 财务费用明细 */
  financialFees: {
    /** 扫码支付结算手续费 */
    scanPayFee: number;
    /** 美团/点评团购服务费 */
    meituanServiceFee: number;
  };
  /** 预计到账金额 */
  estimatedReceived: number;
}

// ─── 综合收款统计（来自「综合收款统计」Excel，日度明细） ─────────────────────
export interface DailyPaymentDetail {
  date: string; // "2026-07-31"
  businessType: string; // "营业收入"
  subtotal: number;
  wechat: number;
  alipay: number;
  unionpayDebit: number;
  unionpayCredit: number;
  memberCard: number;
  /** 美团/点评套餐明细（按套餐名称） */
  meituanPackages: { name: string; amount: number }[];
  meituanTotal: number;
}

// ─── 完整菜品分析快照（月度） ─────────────────────────────────────────────────
export interface DishAnalysisSnapshot {
  id: string;
  /** 月份 "2026-07" */
  month: string;
  /** 月份标签 "2026年7月" */
  monthLabel: string;
  /** 导入时间 */
  importedAt: string;
  /** 菜品大类数据 */
  categories: DishCategoryData[];
  /** 菜品小类数据 */
  subCategories: DishSubCategoryData[];
  /** 菜品明细（全部，不限Top N） */
  items: DishItemData[];
  /** 菜品规格明细 */
  specs: DishSpecData[];
  /** 营业收入与收款统计 */
  revenueStatement?: RevenueStatement;
  /** 综合收款统计（日度明细） */
  dailyPayments: DailyPaymentDetail[];
  /** 数据完整性：哪些报表已导入 */
  importedReports: {
    categories: boolean;
    subCategories: boolean;
    items: boolean;
    specs: boolean;
    revenueStatement: boolean;
    dailyPayments: boolean;
    timeSlotsByOrder: boolean;
    timeSlotsByCheckout: boolean;
  };
}

// ─── 多月对比 ─────────────────────────────────────────────────────────────────
export interface MultiMonthComparison {
  months: string[]; // ["2026-05", "2026-06", "2026-07"]
  /** 按大类的月度销售额 */
  categoryTrends: {
    category: string;
    data: { month: string; amount: number; qty: number }[];
  }[];
  /** 月度总营业额趋势 */
  revenueTrend: { month: string; revenue: number; grossRevenue: number }[];
}

// ─── 报表类型识别 ─────────────────────────────────────────────────────────────
export type ReportFileType =
  | "overview"           // 营业概览（4工作表）
  | "daily_payment"      // 综合收款统计（按日）
  | "dish_by_name"       // 菜品销售统计（菜品名称）
  | "dish_by_category"   // 菜品销售统计（菜品大类）
  | "dish_by_subcategory"// 菜品销售统计（菜品小类）
  | "dish_by_spec"       // 菜品销售统计（菜品名称+规格）
  | "time_slot_order"    // 餐时段营业统计（订单创建时间）
  | "time_slot_checkout" // 餐时段营业统计（结账时间）
  | "revenue_statement"  // 营业收入与收款统计
  | "unknown";

export const REPORT_FILE_TYPE_LABELS: Record<ReportFileType, string> = {
  overview: "营业概览",
  daily_payment: "综合收款统计",
  dish_by_name: "菜品销售统计（菜品名称）",
  dish_by_category: "菜品销售统计（菜品大类）",
  dish_by_subcategory: "菜品销售统计（菜品小类）",
  dish_by_spec: "菜品销售统计（菜品名称+规格）",
  time_slot_order: "餐时段营业统计（下单时间）",
  time_slot_checkout: "餐时段营业统计（结账时间）",
  revenue_statement: "营业收入与收款统计",
  unknown: "未识别",
};

export const REPORT_FILE_TYPE_DESC: Record<ReportFileType, string> = {
  overview: "KPI/收款/菜品/顾客 4个工作表",
  daily_payment: "按日×收款方式×业务大类明细",
  dish_by_name: "每道菜的销量/销售额排行",
  dish_by_category: "Food/Cocktail/Wine/Beer 等大类汇总",
  dish_by_subcategory: "Fusion cuisine/White Wine 等小类汇总",
  dish_by_spec: "每道菜×规格的销售明细",
  time_slot_order: "按下单时间的半小时时段分析",
  time_slot_checkout: "按结账时间的半小时时段分析",
  revenue_statement: "营业额→优惠→收入→手续费→预计到账",
  unknown: "无法识别的文件格式",
};

/** 所有必要报表（用于缺失检测） */
export const REQUIRED_REPORT_TYPES: ReportFileType[] = [
  "overview",
  "daily_payment",
  "dish_by_name",
  "dish_by_category",
  "time_slot_order",
  "revenue_statement",
];

/** 可选报表 */
export const OPTIONAL_REPORT_TYPES: ReportFileType[] = [
  "dish_by_subcategory",
  "dish_by_spec",
  "time_slot_checkout",
];

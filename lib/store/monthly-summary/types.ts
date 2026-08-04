/**
 * 月度总报表数据模型 (Build 134)
 *
 * 科目树结构：
 *   本月收入
 *     ├─ 收款渠道（来自月度经营分析 paymentMethods）
 *     ├─ 手续费/服务费（负数，红字）
 *     └─ 手工录入（活动收入/外卖等）
 *   进货成本-食材
 *     ├─ A1-A10 各分类（备用金，已付）
 *     └─ 食材供应商（转账，待付）
 *   进货成本-酒水
 *     ├─ B1 啤酒现结（备用金，已付）
 *     ├─ B2 酒水配料（备用金，已付）
 *     ├─ B3 酒水耗材（备用金，已付）
 *     ├─ 烈酒供应商（转账，待付）
 *     └─ 葡萄酒供应商（转账/备用金，待付/已付）
 *   工资（薪资单 + 备用金兼职）
 *   房租（备用金 M1/M2）
 *   水电（备用金 L1/L2）
 *   备用金其他费用（D/E/G/H/I/J/K 类汇总，可拆分）
 *   Extra INFO（手工录入）
 *
 * 防重复叠加规则：
 *   - 备用金分类归属库存且单独显示 → 从备用金汇总中排除
 *   - 备用金分类归属人工且单独显示 → 从备用金汇总中排除，归入工资科目
 *   - 用户手工标记 manualDuplicate → 优先于自动检测
 */

// ─── 科目类型 ─────────────────────────────────────────────────────────────────
export type AccountCategory =
  | "revenue"          // 本月收入
  | "cogs_food"        // 进货成本-食材
  | "cogs_beverage"    // 进货成本-酒水（烈酒/啤酒/冰块）
  | "cogs_wine"        // 进货成本-葡萄酒
  | "labor"            // 工资
  | "rent"             // 房租
  | "utilities"        // 水电
  | "petty_other"      // 备用金其他费用
  | "extra"            // Extra INFO
  | "account_balance"; // 账户余额

export type DataSource =
  | "monthly_report"    // 月度经营分析
  | "petty_cash"        // 备用金
  | "wine_inventory"    // 葡萄酒进销存
  | "spirits_inventory" // 烈酒进销存
  | "beer_inventory"    // 啤酒进销存
  | "ice_inventory"     // 冰块进销存
  | "labor"             // 人工成本
  | "manual"            // 手动录入
  | "supplier_purchase" // 食材供应商采购
  | "computed";         // 自动计算

/** 付款状态 */
export type PaymentStatus = "unpaid" | "partial" | "paid";

// ─── 科目行 ───────────────────────────────────────────────────────────────────
export interface SummaryLineItem {
  id: string;
  /** 科目代码（如 "A1", "wine_supplier_ganlan"） */
  code: string;
  /** 显示名称 */
  label: string;
  /** 一级科目 */
  category: AccountCategory;
  /** 金额（正=收入，负=成本/支出） */
  amount: number;
  /** 数据来源 */
  source: DataSource;
  /** 是否已付 */
  isPaid: boolean;
  /** 付款说明（如「已付(备用金)」「20号前付」） */
  paymentNote: string;
  /** 是否已在其他科目计算（防重复标记，自动检测） */
  isDuplicate: boolean;
  /** 重复说明（如「已在备用金支出中计算」） */
  duplicateNote: string;
  /** 用户手工设置的重复标记（优先于自动检测，true=手工标记重复，false=手工取消重复） */
  manualDuplicate?: boolean;
  /** 是否需要手动录入 */
  isManual: boolean;
  /** 关联模块（用于跳转） */
  linkedModule?: string;
  /** 关联供应商 ID */
  supplierId?: string;
  /** 关联员工 ID */
  employeeId?: string;
  /** 关联备用金分类代码（如 "A1"） */
  pettyCode?: string;
  /** 关联库存模块（如 "spirits", "wine", "food"） */
  inventoryModule?: string;
  /** 备注 */
  notes: string;
}

// ─── 备用金分类配置 ───────────────────────────────────────────────────────────
export type InventoryModuleType = "spirits" | "wine" | "food" | "beer" | "ice";

export interface PettyCodeConfig {
  /** 备用金分类代码（如 "A1", "B1"） */
  code: string;
  /** 归属库存模块（null = 不归属任何库存） */
  inventoryModule: InventoryModuleType | null;
  /** 是否归属人工成本 */
  isLabor: boolean;
  /** 是否在月报中单独显示（false = 归入备用金其他费用汇总） */
  showInReport: boolean;
  /** 自定义显示标签（覆盖默认 code label，null = 使用默认） */
  customLabel: string | null;
  /** 归属的月报科目（覆盖默认分类路由） */
  reportCategory: AccountCategory | null;
}

/** 备用金分类默认配置（内置，用户可覆盖） */
export const DEFAULT_PETTY_CODE_CONFIGS: PettyCodeConfig[] = [
  // A 类食材 → 食材库存，单独显示
  ...["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"].map((code) => ({
    code, inventoryModule: "food" as InventoryModuleType, isLabor: false, showInReport: true, customLabel: null, reportCategory: "cogs_food" as AccountCategory,
  })),
  // B1 啤酒 → 烈酒库存（酒水），单独显示
  { code: "B1", inventoryModule: "spirits" as InventoryModuleType, isLabor: false, showInReport: true, customLabel: null, reportCategory: "cogs_beverage" as AccountCategory },
  // B2 酒水配料 → 烈酒库存（酒水），单独显示
  { code: "B2", inventoryModule: "spirits" as InventoryModuleType, isLabor: false, showInReport: true, customLabel: null, reportCategory: "cogs_beverage" as AccountCategory },
  // B3 酒水耗材 → 烈酒库存（酒水），单独显示
  { code: "B3", inventoryModule: "spirits" as InventoryModuleType, isLabor: false, showInReport: true, customLabel: null, reportCategory: "cogs_beverage" as AccountCategory },
  // K1 固定兼职 → 人工，默认不单独显示（归入备用金汇总）
  { code: "K1", inventoryModule: null, isLabor: true, showInReport: false, customLabel: null, reportCategory: null },
  // K9 临时兼职 → 人工，默认不单独显示
  { code: "K9", inventoryModule: null, isLabor: true, showInReport: false, customLabel: null, reportCategory: null },
  // D1-D3 员工福利 → 人工，默认不单独显示
  { code: "D1", inventoryModule: null, isLabor: true, showInReport: false, customLabel: null, reportCategory: null },
  { code: "D2", inventoryModule: null, isLabor: true, showInReport: false, customLabel: null, reportCategory: null },
  { code: "D3", inventoryModule: null, isLabor: true, showInReport: false, customLabel: null, reportCategory: null },
  // L1/L2 水电 → 固定成本，始终单独显示
  { code: "L1", inventoryModule: null, isLabor: false, showInReport: true, customLabel: null, reportCategory: "utilities" as AccountCategory },
  { code: "L2", inventoryModule: null, isLabor: false, showInReport: true, customLabel: null, reportCategory: "utilities" as AccountCategory },
  // M1/M2 房租 → 固定成本，始终单独显示
  { code: "M1", inventoryModule: null, isLabor: false, showInReport: true, customLabel: null, reportCategory: "rent" as AccountCategory },
  { code: "M2", inventoryModule: null, isLabor: false, showInReport: true, customLabel: null, reportCategory: "rent" as AccountCategory },
  // N 类收入 → 不计入支出
  ...["N0","N1","N2","N3","N4","N5"].map((code) => ({
    code, inventoryModule: null, isLabor: false, showInReport: false, customLabel: null, reportCategory: null as AccountCategory | null,
  })),
];

// ─── 库存模块月报配置 ─────────────────────────────────────────────────────────
export interface InventoryReportConfig {
  /** 库存模块标识 */
  module: InventoryModuleType;
  /** 是否在月报中单独显示（false = 进货金额归入备用金汇总，但库存分析仍使用） */
  showInReport: boolean;
  /** 月报分组标签 */
  groupLabel: string;
  /** 对应的月报科目分类 */
  reportCategory: AccountCategory;
}

/** 库存模块默认配置 */
export const DEFAULT_INVENTORY_CONFIGS: InventoryReportConfig[] = [
  { module: "spirits", showInReport: true, groupLabel: "烈酒", reportCategory: "cogs_beverage" },
  { module: "wine",    showInReport: true, groupLabel: "葡萄酒", reportCategory: "cogs_wine" },
  { module: "food",    showInReport: true, groupLabel: "食材", reportCategory: "cogs_food" },
  { module: "beer",    showInReport: true, groupLabel: "啤酒", reportCategory: "cogs_beverage" },
  { module: "ice",     showInReport: true, groupLabel: "冰块", reportCategory: "cogs_beverage" },
];

// ─── 供应商档案 ───────────────────────────────────────────────────────────────
export type SupplierCategory =
  | "wine"       // 葡萄酒
  | "spirits"    // 烈酒
  | "beer"       // 啤酒
  | "ice"        // 冰块
  | "food"       // 食材
  | "equipment"  // 设备
  | "other";     // 其他

export const SUPPLIER_CATEGORY_LABELS: Record<SupplierCategory, string> = {
  wine: "葡萄酒",
  spirits: "烈酒",
  beer: "啤酒",
  ice: "冰块",
  food: "食材",
  equipment: "设备",
  other: "其他",
};

export const SUPPLIER_CATEGORY_COLORS: Record<SupplierCategory, string> = {
  wine: "#C2185B",
  spirits: "#5856D6",
  beer: "#F4A300",
  ice: "#00BCD4",
  food: "#34C759",
  equipment: "#FF9500",
  other: "#8E8E93",
};

export interface SupplierBankAccount {
  id: string;
  accountName: string;
  bankName: string;
  cardNumber: string;
  note: string;
  isDefault: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  nameEn: string;
  category: SupplierCategory;
  contactName: string;
  contactPhone: string;
  /** 付款周期说明（如「20号前付」「月结」） */
  paymentTerms: string;
  bankAccounts: SupplierBankAccount[];
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 月度付款记录 ─────────────────────────────────────────────────────────────
export type PaymentSourceType =
  | "supplier"    // 供应商货款
  | "employee"    // 员工工资
  | "petty"       // 备用金科目（已付备用金）
  | "rent"        // 房租
  | "utilities"   // 水电
  | "labor_petty" // 备用金兼职/人工
  | "manual";     // 手工录入

export interface MonthlyPaymentRecord {
  id: string;
  /** 月份 "2026-07" */
  month: string;
  /** 收款方 ID（供应商ID / 员工ID / 备用金分类代码 / 自定义） */
  payeeId: string;
  /** 收款人类型 */
  payeeType: "supplier" | "employee";
  /** 来源类型（用于货款Tab分组和展示） */
  sourceType?: PaymentSourceType;
  /** 显示标签（覆盖默认名称） */
  displayLabel?: string;
  /** 付款方式标注（如「已付(备用金)」「待付转账」） */
  paymentMethodNote?: string;
  /** 应付总金额 */
  totalAmount: number;
  /** 已付金额 */
  paidAmount: number;
  /** 待付金额 = totalAmount - paidAmount - advanceAmount */
  remainingAmount: number;
  /** 付款状态 */
  status: PaymentStatus;
  /** 付款记录列表 */
  payments: {
    id: string;
    date: string;
    amount: number;
    bankAccountId: string;
    paymentMethod: string; // 转账/现金/微信/支付宝
    /** 付款账户类型 */
    accountType?: "company" | "personal" | "petty" | "pos";
    notes: string;
    paidAt: string;
  }[];
  /** 预支/定金金额 */
  advanceAmount: number;
  /** 备注 */
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 货款Tab专用：备用金科目卡片（不存储在 MonthlyPaymentRecord，从报表行动态生成） ──
export interface PettyPaymentCard {
  code: string;
  label: string;
  amount: number;
  category: AccountCategory;
  isPaid: boolean;
  paymentNote: string;
  isDuplicate: boolean;
}

// ─── 四账户体系 ───────────────────────────────────────────────────────────────
export type AccountType =
  | "company"    // 公司账户（招商/工商银行）
  | "personal"   // 私人账户（老板个人）
  | "petty"      // 备用金账户
  | "pos";       // 开店宝后台（POS 机未结算）

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  company: "公司账户",
  personal: "私人账户",
  petty: "备用金账户",
  pos: "开店宝后台",
};

export const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  company: "#007AFF",
  personal: "#5856D6",
  petty: "#FF9500",
  pos: "#34C759",
};

export interface AccountBalance {
  id: string;
  month: string;
  accountType: AccountType;
  accountName: string;
  openingBalance: number;
  closingBalance: number;
  computedClosingBalance: number;
  variance: number;
  varianceNote: string;
  isReconciled: boolean;
  inflows: { label: string; amount: number; date: string; notes: string }[];
  outflows: { label: string; amount: number; date: string; notes: string }[];
  createdAt: string;
  updatedAt: string;
}

// ─── 月度总报表 ───────────────────────────────────────────────────────────────
export interface MonthlySummaryReport {
  id: string;
  month: string;
  lineItems: SummaryLineItem[];
  totalRevenue: number;
  totalCOGS: number;
  totalLabor: number;
  totalRent: number;
  totalUtilities: number;
  totalPettyOther: number;
  totalExtra: number;
  netProfit: number;
  accountBalances: AccountBalance[];
  paymentRecords: MonthlyPaymentRecord[];
  manualItems: SummaryLineItem[];
  notes: string;
  isFinalized: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 员工银行卡（扩展到 Employee） ────────────────────────────────────────────
export interface EmployeeBankAccount {
  id: string;
  accountName: string;
  bankName: string;
  cardNumber: string;
  note: string;
  isDefault: boolean;
}

// ─── 一键复制内容生成 ─────────────────────────────────────────────────────────
export function generatePaymentCopyText(params: {
  recipientName: string;
  bankName: string;
  cardNumber: string;
  amount: number;
  note?: string;
}): string {
  const lines = [
    `收款人：${params.recipientName}`,
    `银行：${params.bankName}`,
    `卡号：${params.cardNumber}`,
    `金额：¥${params.amount.toFixed(2)}`,
  ];
  if (params.note) lines.push(`备注：${params.note}`);
  return lines.join("\n");
}

/** 格式化卡号（每4位加空格，末4位显示，其余*） */
export function maskCardNumber(cardNumber: string): string {
  const clean = cardNumber.replace(/\s/g, "");
  if (clean.length < 8) return clean;
  const last4 = clean.slice(-4);
  const masked = "**** ".repeat(Math.floor((clean.length - 4) / 4));
  return masked + last4;
}

/** 防重复叠加规则：哪些备用金分类已在其他科目中单独列示（动态计算，此为静态默认值） */
export const PETTY_EXCLUDED_FROM_OTHER: string[] = [
  "A1","A2","A3","A4","A5","A6","A7","A8","A9","A10",
  "B1","B2","B3",
  "L1","L2",
  "M1","M2",
  "N0","N1","N2","N3","N4","N5",
];

/** 根据 PettyCodeConfig 动态计算应排除的备用金分类 */
export function calcPettyExcludedCodes(configs: PettyCodeConfig[]): string[] {
  const excluded = new Set<string>(["N0","N1","N2","N3","N4","N5"]); // N 类收入始终排除
  for (const cfg of configs) {
    if (cfg.showInReport) {
      excluded.add(cfg.code);
    }
  }
  return Array.from(excluded);
}

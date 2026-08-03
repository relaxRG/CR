/**
 * 月度总报表数据模型
 *
 * 科目树结构（对应截图）：
 *   本月收入
 *     ├─ 菜品大类（来自月度经营分析）
 *     ├─ 平台/套餐（备注：已分摊，不重复计入）
 *     ├─ 活动收入（手动）
 *     ├─ 外卖收入（手动）
 *     ├─ 充电宝（备用金 N4，标注已在备用金）
 *     └─ 扣减项（手续费/服务费，红字）
 *   进货成本
 *     ├─ 食材（备用金 A 类，已付(备用金)）
 *     ├─ 啤酒（进销存/备用金 B1）
 *     ├─ 烈酒（进销存，独立付款）
 *     ├─ 冰块（进销存/备用金 B1/B3）
 *     ├─ 水果（手动）
 *     ├─ B2 酒水配料（备用金 B2，已付）
 *     ├─ B3 酒水耗材（备用金 B3，已付）
 *     └─ 葡萄酒（进销存，独立付款，多供应商）
 *   工资（人工成本模块）
 *   房租（手动）
 *   水电（备用金 L1/L2）
 *   备用金其他费用（D/E/G/H/I/J/K 类，排除已单独列示）
 *   Extra INFO（社保/银行扣款等，手动）
 *
 * 防重复叠加规则：
 *   - 备用金 A 类 → 食材成本，不再单独计入
 *   - 备用金 B2/B3 → 酒水配料/耗材，不再单独计入
 *   - 备用金 L1/L2 → 水电，不再单独计入
 *   - 备用金 N4 → 充电宝收入，标注「已在备用金」
 *   - 工资预支 K1 → 已在薪资单中扣除，取净发金额
 *   - 备用金其他费用 = 总支出 - A - B2 - B3 - L1 - L2 - M1 - M2
 */

// ─── 科目类型 ─────────────────────────────────────────────────────────────────
export type AccountCategory =
  | "revenue"          // 本月收入
  | "cogs_food"        // 进货成本-食材
  | "cogs_beverage"    // 进货成本-酒水
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
  /** 是否已在其他科目计算（防重复标记） */
  isDuplicate: boolean;
  /** 重复说明（如「已在备用金支出中计算」） */
  duplicateNote: string;
  /** 是否需要手动录入 */
  isManual: boolean;
  /** 关联模块（用于跳转） */
  linkedModule?: string;
  /** 关联供应商 ID */
  supplierId?: string;
  /** 关联员工 ID */
  employeeId?: string;
  /** 备注 */
  notes: string;
}

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
  /** 账户名（收款人姓名/公司名） */
  accountName: string;
  /** 银行名称 */
  bankName: string;
  /** 银行卡号 */
  cardNumber: string;
  /** 备注（如「对公账户」「个人账户」） */
  note: string;
  /** 是否为默认账户 */
  isDefault: boolean;
}

export interface Supplier {
  id: string;
  /** 供应商名称（如「甘澧」「至缘」） */
  name: string;
  /** 英文名（可选） */
  nameEn: string;
  /** 品类 */
  category: SupplierCategory;
  /** 联系人 */
  contactName: string;
  /** 联系电话 */
  contactPhone: string;
  /** 付款周期说明（如「20号前付」「月结」） */
  paymentTerms: string;
  /** 银行账户列表 */
  bankAccounts: SupplierBankAccount[];
  /** 备注 */
  notes: string;
  /** 是否活跃 */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 月度付款记录 ─────────────────────────────────────────────────────────────
export interface MonthlyPaymentRecord {
  id: string;
  /** 月份 "2026-07" */
  month: string;
  /** 供应商 ID 或员工 ID */
  payeeId: string;
  /** 收款人类型 */
  payeeType: "supplier" | "employee";
  /** 应付总金额 */
  totalAmount: number;
  /** 已付金额 */
  paidAmount: number;
  /** 待付金额 = totalAmount - paidAmount */
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
    notes: string;
    paidAt: string;
  }[];
  /** 预支金额（已提前支付的部分，如工资预支、货款定金） */
  advanceAmount: number;
  /** 备注 */
  notes: string;
  createdAt: string;
  updatedAt: string;
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
  /** 月份 "2026-07" */
  month: string;
  /** 账户类型 */
  accountType: AccountType;
  /** 账户名称（如「招商银行」「工商银行」） */
  accountName: string;
  /** 手动录入的期初余额 */
  openingBalance: number;
  /** 手动录入的期末余额（月末实际余额） */
  closingBalance: number;
  /** 系统计算的期末余额（期初 + 收入 - 支出） */
  computedClosingBalance: number;
  /** 差异金额（手动录入 - 系统计算） */
  variance: number;
  /** 差异说明 */
  varianceNote: string;
  /** 是否已核对 */
  isReconciled: boolean;
  /** 本月收款明细（手动录入） */
  inflows: { label: string; amount: number; date: string; notes: string }[];
  /** 本月支出明细（手动录入） */
  outflows: { label: string; amount: number; date: string; notes: string }[];
  createdAt: string;
  updatedAt: string;
}

// ─── 月度总报表 ───────────────────────────────────────────────────────────────
export interface MonthlySummaryReport {
  id: string;
  /** 月份 "2026-07" */
  month: string;
  /** 科目行列表 */
  lineItems: SummaryLineItem[];
  /** 收入小计 */
  totalRevenue: number;
  /** 进货成本小计 */
  totalCOGS: number;
  /** 工资小计 */
  totalLabor: number;
  /** 房租小计 */
  totalRent: number;
  /** 水电小计 */
  totalUtilities: number;
  /** 备用金其他费用 */
  totalPettyOther: number;
  /** Extra INFO */
  totalExtra: number;
  /** 净利润 = 收入 - 所有支出 */
  netProfit: number;
  /** 账户余额列表 */
  accountBalances: AccountBalance[];
  /** 付款记录列表 */
  paymentRecords: MonthlyPaymentRecord[];
  /** 手动录入的额外科目 */
  manualItems: SummaryLineItem[];
  /** 报表备注 */
  notes: string;
  /** 是否已完成（锁定） */
  isFinalized: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── 员工银行卡（扩展到 Employee） ────────────────────────────────────────────
export interface EmployeeBankAccount {
  id: string;
  /** 账户名（通常是真实姓名） */
  accountName: string;
  /** 银行名称 */
  bankName: string;
  /** 银行卡号 */
  cardNumber: string;
  /** 备注 */
  note: string;
  /** 是否为默认账户 */
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

/** 防重复叠加规则：哪些备用金分类已在其他科目中单独列示 */
export const PETTY_EXCLUDED_FROM_OTHER: string[] = [
  "A1","A2","A3","A4","A5","A6","A7","A8","A9","A10", // 食材（进货成本）
  "B2","B3",   // 酒水配料/耗材（进货成本）
  "L1","L2",   // 水电（水电科目）
  "M1","M2",   // 房租（房租科目）
  "N0","N1","N2","N3","N4","N5", // 收入类（不计入支出）
];

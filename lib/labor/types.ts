import { formatMoney } from "@/lib/utils";
/**
 * 人工成本管理模块 - 完整类型定义 v4
 * 新增：社保/公积金双轨制（个人+公司）、城市政策数据库、换休余额明细、节假日调休余额、无来源多休提醒
 */

// ─── 员工部门 / 类型 ──────────────────────────────────────────────────────────
export type EmployeeDept = "front" | "kitchen" | "parttime" | "other";

/** 部门归属类别：前厅需要排班，后厨需要排班，公司不需要排班 */
export type DeptCategory = "front" | "kitchen" | "company";

/** 自定义部门（可增删改） */
export interface CustomDept {
  id: string;
  name: string;
  category: DeptCategory;
  color: string;
  sortOrder: number;
}

/** 默认预置部门 */
export const DEFAULT_CUSTOM_DEPTS: CustomDept[] = [
  { id: "dept_front", name: "前厅", category: "front", color: "#1677FF", sortOrder: 0 },
  { id: "dept_kitchen", name: "后厨", category: "kitchen", color: "#52C41A", sortOrder: 1 },
  { id: "dept_company", name: "公司", category: "company", color: "#722ED1", sortOrder: 2 },
];

export const DEPT_CATEGORY_LABELS: Record<DeptCategory, string> = {
  front: "前厅",
  kitchen: "后厨",
  company: "公司",
};

export const DEPT_CATEGORY_COLORS: Record<DeptCategory, string> = {
  front: "#1677FF",
  kitchen: "#52C41A",
  company: "#722ED1",
};
/**
 * fulltime = 全职
 * longterm_parttime = 长期兼职（固定排班，有月度薪资，支持薪资预支）
 * parttime = 临时兼职（按次/按小时，无固定排班）
 */
export type EmployeeType = "fulltime" | "longterm_parttime" | "parttime";

export const DEPT_LABELS: Record<EmployeeDept, string> = {
  front: "前厅",
  kitchen: "后厨",
  parttime: "兼职",
  other: "其他",
};

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  fulltime: "全职",
  longterm_parttime: "长期兼职",
  parttime: "临时兼职",
};

export const EMPLOYEE_TYPE_COLORS: Record<EmployeeType, string> = {
  fulltime: "#007AFF",
  longterm_parttime: "#5856D6",
  parttime: "#FF9500",
};

export const DEPT_COLORS: Record<EmployeeDept, string> = {
  front: "#007AFF",    // 蓝色（前厅）
  kitchen: "#34C759",  // 绿色（后厨）
  parttime: "#FF9500", // 橙色（兼职）
  other: "#8E8E93",    // 灰色
};

// ─── 差异化工时规则（按星期设置合同工时） ────────────────────────────────────
/**
 * 灵活工时规则：某个星期范围内的合同工时
 * 例：{ fromDay: 1, toDay: 4, hours: 8 } 表示周一~周四每天8小时
 * fromDay/toDay: 0=周日, 1=周一, ..., 6=周六
 * 多条规则按顺序匹配，第一条命中的规则生效
 */
export interface WeeklyHoursRule {
  id: string;
  /** 开始星期（0=周日, 1=周一, ..., 6=周六） */
  fromDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 结束星期（0=周日, 1=周一, ..., 6=周六） */
  toDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 该范围内每天的合同工时（小时） */
  hours: number;
}

// ─── 调休规则 ─────────────────────────────────────────────────────────────────
export interface CompOffRule {
  /** 多少小时加班换1天调休（默认8） */
  hoursPerDay: number;
  /** 是否启用调休（false=全部计加班费） */
  enabled: boolean;
}

// ─── 补贴规则 ─────────────────────────────────────────────────────────────────
export type AllowanceType =
  | "transport_fixed"   // 交通补贴（固定月额）
  | "meal_per_day"      // 饭补（每出勤天 × 日额）
  | "custom_fixed";     // 自定义固定补贴

/** 补贴单位 */
export type AllowanceUnit = "per_day" | "per_month" | "per_quarter" | "per_year";

/**
 * 季度/年度补贴的发放模式
 * - natural: 自然周期（季度=1-3/4-6/7-9/10-12，年度=当年）
 *   错过当期则从下个周期开始
 * - rolling: 滚动周期（从生效月起每3个月/12个月发放一次）
 */
export type AllowancePeriodMode = "natural" | "rolling";

export const ALLOWANCE_UNIT_LABELS: Record<AllowanceUnit, string> = {
  per_day: "元/天",
  per_month: "元/月",
  per_quarter: "元/季",
  per_year: "元/年",
};

export const ALLOWANCE_PERIOD_MODE_LABELS: Record<AllowancePeriodMode, Record<"quarter" | "year", string>> = {
  natural: { quarter: "自然季度（1-3/4-6/7-9/10-12）", year: "自然年度（当年）" },
  rolling: { quarter: "滚动季度（生效起每3月）", year: "滚动年度（生效起每12月）" },
};

export interface AllowanceRule {
  id: string;
  type: AllowanceType;
  label: string;
  /** 金额 */
  amount: number;
  /** 计算单位（必填：决定补贴是按天/月/季/年计算） */
  unit: AllowanceUnit;
  /** 季度/年度发放模式（仅 per_quarter/per_year 时有效） */
  periodMode?: AllowancePeriodMode;
  /** 补贴生效月（YYYY-MM 格式，滚动模式下用于计算发放月） */
  effectiveMonth?: string;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 计算某月是否应发放季度/年度补贴
 * @param rule 补贴规则
 * @param month 当前月份（YYYY-MM）
 * @returns 是否在该月发放
 */
export function shouldPayAllowanceThisMonth(rule: AllowanceRule, month: string): boolean {
  // unit 已为必填字段，无需推断
  if (rule.unit === "per_day" || rule.unit === "per_month") return true;

  const mode = rule.periodMode ?? "natural";
  const [y, m] = month.split("-").map(Number);

  if (rule.unit === "per_quarter") {
    if (mode === "natural") {
      // 自然季度：在季度末月发放（3、6、9、12月）
      return m === 3 || m === 6 || m === 9 || m === 12;
    } else {
      // 滚动季度：从生效月起每3个月发放
      if (!rule.effectiveMonth) return false;
      const [ey, em] = rule.effectiveMonth.split("-").map(Number);
      const diff = (y - ey) * 12 + (m - em);
      return diff >= 2 && diff % 3 === 2; // 第3个月发放（索引为2）
    }
  }

  if (rule.unit === "per_year") {
    if (mode === "natural") {
      // 自然年度：在12月发放
      return m === 12;
    } else {
      // 滚动年度：从生效月起每12个月发放
      if (!rule.effectiveMonth) return false;
      const [ey, em] = rule.effectiveMonth.split("-").map(Number);
      const diff = (y - ey) * 12 + (m - em);
      return diff >= 11 && diff % 12 === 11; // 第12个月发放（索引为11）
    }
  }

  return true;
}


// ─── 工作绩效（Task-based KPI） ─────────────────────────────────────────────────

/** 工作绩效档位 */
export interface WorkKPITier {
  id: string;
  /** 档位标签，如"优秀""良好""合格""不合格" */
  label: string;
  /** 金额：正数=奖励，负数=扣款，0=无奖惩 */
  amount: number;
  sortOrder: number;
}

/** 工作绩效规则 */
export interface WorkKPIRule {
  id: string;
  /** 绩效名称 */
  name: string;
  /** 档位列表（勾选实际完成档位） */
  tiers: WorkKPITier[];
  /** 考核周期 */
  cycle: "monthly" | "quarterly";
  /** 备注 */
  notes: string;
  /** 是否启用 */
  enabled: boolean;
}

// ─── 业绩绩效（Revenue-based KPI） ──────────────────────────────────────────────

/** 业绩绩效数据源 */
export type RevenueKPISource =
  | "total_revenue"      // 总营业额
  | "net_revenue"        // 营业收入（扣手续费后）
  | "net_profit"         // 净利润
  | "category"           // 某个经营大类
  | "manual";            // 手动填充

export const REVENUE_KPI_SOURCE_LABELS: Record<RevenueKPISource, string> = {
  total_revenue: "总营业额",
  net_revenue: "营业收入（扣手续费）",
  net_profit: "净利润",
  category: "经营大类",
  manual: "手动填充",
};

/** 业绩绩效发放模式 */
export type RevenueKPIPayMode = "cumulative" | "highest";

export const REVENUE_KPI_PAY_MODE_LABELS: Record<RevenueKPIPayMode, string> = {
  cumulative: "叠加发放（所有达标档位累加）",
  highest: "取最高档（只拿最高一档）",
};

/** 业绩绩效计算方式 */
export type RevenueKPICalcType = "fixed" | "percentage";

export const REVENUE_KPI_CALC_TYPE_LABELS: Record<RevenueKPICalcType, string> = {
  fixed: "固定金额",
  percentage: "按比例提成",
};

/** 业绩绩效档位 */
export interface RevenueKPITier {
  id: string;
  /** 达到金额（≥ 此值触发） */
  threshold: number;
  /** 奖励金额（calcType=fixed时）或提成比例（calcType=percentage时，如 0.04=4%） */
  amount: number;
  /** 档位标签 */
  label?: string;
  sortOrder: number;
}

/** 业绩绩效规则 */
export interface RevenueKPIRule {
  id: string;
  /** 绩效名称 */
  name: string;
  /** 数据源 */
  source: RevenueKPISource;
  /** 当 source="category" 时，指定经营大类名称（智能匹配月报） */
  categoryName?: string;
  /** 档位列表 */
  tiers: RevenueKPITier[];
  /** 发放模式 */
  payMode: RevenueKPIPayMode;
  /** 计算方式 */
  calcType: RevenueKPICalcType;
  /** 封顶金额（0=无上限） */
  capAmount?: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 计算业绩绩效奖金
 */
export function calcRevenueKPIBonus(rule: RevenueKPIRule, actualValue: number): number {
  if (!rule.enabled || rule.tiers.length === 0) return 0;
  const sorted = [...rule.tiers].sort((a, b) => a.threshold - b.threshold);
  let bonus = 0;

  if (rule.payMode === "highest") {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (actualValue >= sorted[i].threshold) {
        bonus = rule.calcType === "fixed" ? sorted[i].amount : actualValue * sorted[i].amount;
        break;
      }
    }
  } else {
    for (const tier of sorted) {
      if (actualValue >= tier.threshold) {
        bonus += rule.calcType === "fixed" ? tier.amount : actualValue * tier.amount;
      }
    }
  }

  if (rule.capAmount && rule.capAmount > 0 && bonus > rule.capAmount) {
    bonus = rule.capAmount;
  }
  return bonus;
}

// ─── 社保 / 公积金配置 ────────────────────────────────────────────────────────
// ─── 单个险种配置（个人+公司双轨制） ────────────────────────────────────────
export interface InsuranceItem {
  /** 险种名称（如"养老保险"） */
  name: string;
  /** 是否启用此险种 */
  enabled: boolean;
  /** 个人缴费比例（如 0.08 = 8%） */
  employeeRate: number;
  /** 公司缴费比例（如 0.16 = 16%） */
  employerRate: number;
  /** 基数下限（元/月，0=不限） */
  baseMin: number;
  /** 基数上限（元/月，0=不限） */
  baseMax: number;
}

export interface HousingFundItem {
  name: string;
  enabled: boolean;
  /** 个人缴费比例 */
  employeeRate: number;
  /** 公司缴费比例 */
  employerRate: number;
  /** 公积金基数（0=使用工资） */
  base: number;
  baseMin: number;
  baseMax: number;
}

/**
 * 完整社保/公积金配置（双轨制：个人+公司）
 * 支持按城市自动填充，支持手动修改每个险种
 */
export interface SocialInsuranceConfig {
  /** 是否启用社保计算 */
  enabled: boolean;
  /** 城市（用于匹配政策，如"上海"、"北京"） */
  city: string;
  /** 社保基数（元/月，0=使用工资作为基数） */
  base: number;
  /** 基数下限（城市政策，0=不限） */
  baseMin: number;
  /** 基数上限（城市政策，0=不限） */
  baseMax: number;
  /** 养老保险 */
  pension: InsuranceItem;
  /** 医疗保险 */
  medical: InsuranceItem;
  /** 失业保险 */
  unemployment: InsuranceItem;
  /** 工伤保险（通常只有公司部分） */
  workInjury: InsuranceItem;
  /** 生育保险（通常只有公司部分） */
  maternity: InsuranceItem;
  /** 住房公积金 */
  housingFund: HousingFundItem;
  /** 最后联网更新时间 */
  lastUpdated?: string;
  /** 数据来源（"builtin"=内置, "network"=联网更新, "manual"=手动修改） */
  dataSource?: "builtin" | "network" | "manual";
}



/** 默认社保配置（全国通用基准） */
export const DEFAULT_SOCIAL_INSURANCE: SocialInsuranceConfig = {
  enabled: false,
  city: "",
  base: 0,
  baseMin: 0,
  baseMax: 0,
  pension:      { name: "养老保险", enabled: true,  employeeRate: 0.08,  employerRate: 0.16,  baseMin: 0, baseMax: 0 },
  medical:      { name: "医疗保险", enabled: true,  employeeRate: 0.02,  employerRate: 0.095, baseMin: 0, baseMax: 0 },
  unemployment: { name: "失业保险", enabled: true,  employeeRate: 0.005, employerRate: 0.005, baseMin: 0, baseMax: 0 },
  workInjury:   { name: "工伤保险", enabled: true,  employeeRate: 0,     employerRate: 0.004, baseMin: 0, baseMax: 0 },
  maternity:    { name: "生育保险", enabled: false, employeeRate: 0,     employerRate: 0.008, baseMin: 0, baseMax: 0 },
  housingFund:  { name: "住房公积金", enabled: false, employeeRate: 0.12, employerRate: 0.12,  base: 0, baseMin: 0, baseMax: 0 },
  lastUpdated: undefined,
  dataSource: "builtin",
};

// ─── 内置城市社保数据库 ───────────────────────────────────────────────────────
/**
 * 主要城市社保政策内置数据（2024年标准）
 * 支持联网更新覆盖
 */
export interface CityInsurancePolicy {
  city: string;
  /** 社保基数下限（元/月） */
  baseMin: number;
  /** 社保基数上限（元/月） */
  baseMax: number;
  pension:      { employeeRate: number; employerRate: number };
  medical:      { employeeRate: number; employerRate: number };
  unemployment: { employeeRate: number; employerRate: number };
  workInjury:   { employeeRate: number; employerRate: number };
  maternity:    { employeeRate: number; employerRate: number };
  housingFund:  { employeeRate: number; employerRate: number; baseMin: number; baseMax: number };
  /** 数据年份 */
  year: number;
  /** 数据来源说明 */
  source: string;
}

export const BUILTIN_CITY_POLICIES: CityInsurancePolicy[] = [
  {
    city: "上海",
    baseMin: 7310, baseMax: 35811,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.004 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.07,  employerRate: 0.07, baseMin: 2540, baseMax: 35811 },
    year: 2025, source: "上海市人社局2025年标准",
  },
  {
    city: "北京",
    baseMin: 7162, baseMax: 35811,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.004 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2540, baseMax: 35811 },
    year: 2025, source: "北京市人社局2025年标准",
  },
  {
    city: "广州",
    baseMin: 3096, baseMax: 35811,
    pension:      { employeeRate: 0.08,  employerRate: 0.14  },
    medical:      { employeeRate: 0.02,  employerRate: 0.065 },
    unemployment: { employeeRate: 0.002, employerRate: 0.012 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2300, baseMax: 35811 },
    year: 2025, source: "广州市人社局2025年标准",
  },
  {
    city: "深圳",
    baseMin: 2360, baseMax: 35811,
    pension:      { employeeRate: 0.08,  employerRate: 0.13  },
    medical:      { employeeRate: 0.02,  employerRate: 0.065 },
    unemployment: { employeeRate: 0.003, employerRate: 0.007 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.006 },
    housingFund:  { employeeRate: 0.05,  employerRate: 0.05, baseMin: 2360, baseMax: 35811 },
    year: 2025, source: "深圳市人社局2025年标准",
  },
  {
    city: "杭州",
    baseMin: 3702, baseMax: 27549,
    pension:      { employeeRate: 0.08,  employerRate: 0.14  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 27549 },
    year: 2025, source: "杭州市人社局2025年标准",
  },
  {
    city: "成都",
    baseMin: 3408, baseMax: 27549,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 27549 },
    year: 2025, source: "成都市人社局2025年标准",
  },
  {
    city: "武汉",
    baseMin: 3613, baseMax: 27549,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.08  },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 27549 },
    year: 2025, source: "武汉市人社局2025年标准",
  },
  {
    city: "南京",
    baseMin: 3480, baseMax: 27549,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.09  },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 27549 },
    year: 2025, source: "南京市人社局2025年标准",
  },
];

/**
 * 根据城市名称获取内置社保政策
 * 支持模糊匹配（如"上海市"匹配"上海"）
 */
export function getCityPolicy(city: string): CityInsurancePolicy | null {
  const normalized = city.replace(/市|省|区|县/g, "").trim();
  return BUILTIN_CITY_POLICIES.find((p) =>
    p.city === normalized || p.city.includes(normalized) || normalized.includes(p.city)
  ) ?? null;
}

/**
 * 根据城市政策生成 SocialInsuranceConfig
 * 保留现有 enabled/base 设置，更新险种比例
 */
export function applyCityPolicy(
  existing: SocialInsuranceConfig,
  policy: CityInsurancePolicy
): SocialInsuranceConfig {
  return {
    ...existing,
    city: policy.city,
    baseMin: policy.baseMin,
    baseMax: policy.baseMax,
    pension:      { ...existing.pension,      ...policy.pension,      name: "养老保险" },
    medical:      { ...existing.medical,      ...policy.medical,      name: "医疗保险" },
    unemployment: { ...existing.unemployment, ...policy.unemployment, name: "失业保险" },
    workInjury:   { ...existing.workInjury,   ...policy.workInjury,   name: "工伤保险" },
    maternity:    { ...existing.maternity,    ...policy.maternity,    name: "生育保险" },
    housingFund:  {
      ...existing.housingFund,
      ...policy.housingFund,
      name: "住房公积金",
      base: existing.housingFund.base,
    },
    lastUpdated: new Date().toISOString(),
    dataSource: "builtin",
  };
}

// ─── 个人所得税配置 ───────────────────────────────────────────────────────────
export interface IncomeTaxConfig {
  /** 是否启用个税计算 */
  enabled: boolean;
  /** 起征点（元/月，默认5000） */
  threshold: number;
  /**
   * 专项附加扣除（元/月，如子女教育、住房贷款利息等）
   * 需手动填写，不自动获取
   */
  specialDeductions: number;
  /** 专项附加扣除明细（可选，用于展示） */
  specialDeductionItems?: Array<{
    name: string;   // 如"子女教育"、"住房贷款利息"
    amount: number; // 元/月
    enabled: boolean;
  }>;
  /** 最后联网更新时间 */
  lastUpdated?: string;
  /** 数据来源 */
  dataSource?: "builtin" | "network" | "manual";
}

/** 中国个税税率表（2019年起适用） */
export const INCOME_TAX_BRACKETS = [
  { min: 0,      max: 36000,   rate: 0.03, quickDeduction: 0 },
  { min: 36000,  max: 144000,  rate: 0.10, quickDeduction: 2520 },
  { min: 144000, max: 300000,  rate: 0.20, quickDeduction: 16920 },
  { min: 300000, max: 420000,  rate: 0.25, quickDeduction: 31920 },
  { min: 420000, max: 660000,  rate: 0.30, quickDeduction: 52920 },
  { min: 660000, max: 960000,  rate: 0.35, quickDeduction: 85920 },
  { min: 960000, max: Infinity, rate: 0.45, quickDeduction: 181920 },
];

/** 默认个税配置 */
export const DEFAULT_INCOME_TAX: IncomeTaxConfig = {
  enabled: false,
  threshold: 5000,
  specialDeductions: 0,
  lastUpdated: undefined,
};

// ─── 特殊状态模板 ─────────────────────────────────────────────────────────────
/**
 * 特殊状态分类：
 * absence  = 缺席（不计工时，按倍率调整薪资）
 * work_day = 工作日特殊（计工时，按倍率调整薪资，如节日上班）
 * comp_off = 加班换休（不计工时，不扣薪，从累积加班时数里扣除）
 */
export type SpecialStatusCategory = "absence" | "work_day" | "comp_off";

/**
 * 薪资方向
 * positive = 正向（加钱）：当天上班且有额外补偿，如节日上班
 * negative = 负向（扣钱）：缺席或违规，如旷工、病假
 * neutral  = 中性（不加不扣）：如普通休息、加班换休
 */
export type SpecialStatusDirection = "positive" | "negative" | "neutral";

export interface SpecialStatus {
  id: string;
  /** 状态名称（如"旷工"、"病假"、"节日上班"） */
  name: string;
  /** 分类（仅用于 UI 分组，不参与薪资计算） */
  category: SpecialStatusCategory;
  /**
   * 薪资方向（驱动引擎计算的核心字段）
   * positive：该天算出勤，按倍率给额外补偿
   * negative：该天不算出勤（比例底薪已少1天），按倍率计算额外惩罚/退款
   * neutral：该天算出勤，不加不扣（如休息、加班换休）
   */
  direction: SpecialStatusDirection;
  /**
   * 是否计入工时
   * true：该天有实际工时（如节日上班、违规扣款但上了班）
   * false：该天无工时（如缺席、休息、加班换休）
   */
  countAsAttendance: boolean;
  /**
   * 薪资倍率（配合 direction 使用）
   * positive + 3x：额外补偿 (3-1)=2 倍日薪
   * negative + 2x：额外扣 (2-1)=1 倍日薪（旷工）
   * negative + 0.5x：退回 (1-0.5)=0.5 倍日薪（病假）
   * negative + 1x：无额外调整（事假，比例底薪已扣）
   * neutral + 0x：不加不扣
   */
  salaryMultiplier: number;
  /**
   * 是否节假日性质（可换休）
   * true：该状态产生调休权利，生成薪资单后可选择「拿钱」或「换休」
   * false：普通状态，不产生调休余额
   */
  isHoliday?: boolean;
  /** 显示颜色 */
  color: string;
  /** 排序权重 */
  sortOrder: number;
  /** 是否内置（内置状态不可删除，但可修改名称和倍率） */
  isBuiltin?: boolean;
}

/** 预设特殊状态（可全量增删改） */
export const DEFAULT_SPECIAL_STATUSES: SpecialStatus[] = [
  { id: "ss_rest",     name: "休",       category: "absence",  direction: "neutral",  countAsAttendance: false, salaryMultiplier: 0,   color: "#8E8E93", sortOrder: 0, isBuiltin: true },
  { id: "ss_annual",   name: "年假",     category: "absence",  direction: "positive", countAsAttendance: false, salaryMultiplier: 1,   color: "#34C759", sortOrder: 1, isBuiltin: true },
  { id: "ss_sick",     name: "病假",     category: "absence",  direction: "negative", countAsAttendance: false, salaryMultiplier: 0.5, color: "#FF9500", sortOrder: 2, isBuiltin: true },
  { id: "ss_personal", name: "事假",     category: "absence",  direction: "negative", countAsAttendance: false, salaryMultiplier: 1,   color: "#5856D6", sortOrder: 3, isBuiltin: true },
  { id: "ss_absent",   name: "旷工",     category: "absence",  direction: "negative", countAsAttendance: false, salaryMultiplier: 2,   color: "#FF3B30", sortOrder: 4, isBuiltin: true },
  { id: "ss_holiday",  name: "节日上班", category: "work_day", direction: "positive", countAsAttendance: true,  salaryMultiplier: 3,   color: "#FF2D55", sortOrder: 5, isBuiltin: true, isHoliday: true },
  /**
   * 三种调休来源必须明确，禁止再使用无来源的通用调休状态：
   * 加班换休只占用本月真实加班；调休余额和节假日调休只消费对应余额。
   */
  { id: "ss_comp_off_overtime", name: "加班换休",   category: "comp_off", direction: "neutral", countAsAttendance: true, salaryMultiplier: 0, color: "#D97706", sortOrder: 6, isBuiltin: true },
  { id: "ss_comp_off_balance",  name: "调休余额",   category: "comp_off", direction: "neutral", countAsAttendance: true, salaryMultiplier: 0, color: "#2563EB", sortOrder: 7, isBuiltin: true },
  { id: "ss_comp_off_holiday",  name: "节假日调休", category: "comp_off", direction: "neutral", countAsAttendance: true, salaryMultiplier: 0, color: "#16A34A", sortOrder: 8, isBuiltin: true },
  { id: "ss_penalty",  name: "违规扣款", category: "absence",  direction: "negative", countAsAttendance: true,  salaryMultiplier: 1,   color: "#FF6B00", sortOrder: 9, isBuiltin: true },
];

// ─── 店铺经营时间 ─────────────────────────────────────────────────────────────
/**
 * 店铺经营时间条目
 * 描述某个星期范围内的营业时间段
 * fromDay/toDay: 0=周日, 1=周一, ..., 6=周六
 */
export interface BusinessHoursEntry {
  id: string;
  /** 开始星期（0=周日, 1=周一, ..., 6=周六） */
  fromDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 结束星期（0=周日, 1=周一, ..., 6=周六） */
  toDay: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 开始时间，如 "10:00" */
  openTime: string;
  /** 结束时间，如 "23:00" */
  closeTime: string;
  /** 备注（可选） */
  notes?: string;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursEntry[] = [
  { id: "bh_weekday", fromDay: 1, toDay: 5, openTime: "10:00", closeTime: "22:00" },
  { id: "bh_weekend", fromDay: 6, toDay: 0, openTime: "10:00", closeTime: "23:00" },
];

export const WEEKDAY_SHORT = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// ─── 班次分组 ─────────────────────────────────────────────────────────────────
/**
 * 班次分组（如午班组/晚班组）
 * 每个分组有颜色，班次卡片归属分组，员工左侧竖条颜色由分组决定
 */
export interface ShiftGroup {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** 属于该分组的班次模板 ID 列表 */
  templateIds: string[];
}

export const DEFAULT_SHIFT_GROUPS: ShiftGroup[] = [
  { id: "sg_noon",    name: "午班组", color: "#FF9500", sortOrder: 0, templateIds: ["tpl_noon"] },
  { id: "sg_evening", name: "晚班组", color: "#5856D6", sortOrder: 1, templateIds: ["tpl_evening"] },
];

// ─── 班次模板 ─────────────────────────────────────────────────────────────────
export type ShiftSession = string;

export interface ShiftTemplate {
  id: string;
  session: string;
  startTime: string;
  endTime: string;
  defaultHours: number;
  color: string;
  sortOrder: number;
  /** 营业额预警阈值（元，0=不预警） */
  revenueWarning?: number;
}

export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: "tpl_noon",    session: "午班", startTime: "10:30", endTime: "17:00", defaultHours: 6,  color: "#FF9500", sortOrder: 0 },
  { id: "tpl_evening", session: "晚班", startTime: "17:00", endTime: "24:00", defaultHours: 7,  color: "#5856D6", sortOrder: 1 },
];

export const SHIFT_COLOR_PRESETS = [
  "#FF9500", "#5856D6", "#34C759", "#FF3B30", "#007AFF",
  "#AF52DE", "#5AC8FA", "#FF2D55", "#FFCC00", "#8E8E93",
];

// ─── 节假日配置 ───────────────────────────────────────────────────────────────
export interface HolidayConfig {
  id: string;
  name: string;
  dates: string[];
  multiplier: number;
  applicableEmployeeIds: string[];
  notes: string;
}

export const LEGAL_HOLIDAY_REFERENCE = [
  { name: "元旦",   desc: "1月1日，1天",       multiplier: 3 },
  { name: "春节",   desc: "农历初一至初七，7天", multiplier: 3 },
  { name: "清明节", desc: "4月4-6日，1天",      multiplier: 3 },
  { name: "劳动节", desc: "5月1-5日，1天",      multiplier: 3 },
  { name: "端午节", desc: "农历五月初五，1天",   multiplier: 3 },
  { name: "中秋节", desc: "农历八月十五，1天",   multiplier: 3 },
  { name: "国庆节", desc: "10月1-7日，3天",     multiplier: 3 },
];

// ─── 员工自定义分组 ───────────────────────────────────────────────────────────

// ─── 员工档案（扩展版） ───────────────────────────────────────────────────────
export interface Employee {
  id: string;
  code: string;
  realName: string;
  phone: string;
  dept: EmployeeDept;
  /** 自定义部门 ID（新版，优先于 dept 字段） */
  customDeptId?: string;
  type: EmployeeType;
  baseSalary: number;
  /**
   * 每日标准工时（已弃用，仅保留用于向后兼容旧数据）
   * 新员工一律使用 weeklyHoursRules 灵活工时规则
   * @deprecated 请使用 weeklyHoursRules
   */
  stdHoursPerDay?: number;
  /** 灵活工时规则列表（优先于 stdHoursPerDay） */
  weeklyHoursRules?: WeeklyHoursRule[];
  restDaysPerMonth: number;
  hourlyRate: number;
  overtimeHourlyRate: number;
  /** 员工在列表中的显示顺序（同部门内） */
  sortOrder?: number;
  /**
   * 兼职员工计费模式（仅 parttime 类型有效）
   * - "daily": 按天结算（baseSalary 为日薪，工资 = 出勤天数 × baseSalary）
   * - "hourly": 按小时结算（工资 = 总工时 × overtimeHourlyRate）
   */
  parttimeMode?: "daily" | "hourly";
  /** 调休规则（几小时加班换一天休） */
  compOffRule?: CompOffRule;
  /** 补贴规则结构版本；缺失即视为历史数据并在加载时整体清空，不做迁移。 */
  allowanceRulesSchemaVersion?: number;
  /** 补贴规则列表（餐补/交通/自定义） */
  allowanceRules?: AllowanceRule[];
  /** 工作绩效规则（Task-based KPI） */
  workKPIRules?: WorkKPIRule[];
  /** 业绩绩效规则（Revenue-based KPI） */
  revenueKPIRules?: RevenueKPIRule[];
  /** 社保/公积金配置（每人独立，可覆盖全局配置） */
  socialInsurance?: SocialInsuranceConfig;
  /** 个税配置（每人独立，可覆盖全局配置） */
  incomeTax?: IncomeTaxConfig;
  notes: string;
  active: boolean;
  bankAccounts?: EmployeeBankAccount[];
  idNumber?: string;
  /** 身份证正面照片 URL */
  idCardFrontUrl?: string;
  /** 身份证反面照片 URL */
  idCardBackUrl?: string;
  /** 健康证照片 URL */
  healthCertUrl?: string;
  healthCertExpiry?: string;
  /** 实际住址（紧急联系方式卡片中） */
  actualAddress?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  joinDate?: string;
  leaveDate?: string;
  /** 是否已归档（离职归档）：归档后从主列表和排班表消失 */
  archived?: boolean;
  /** 归档时间 */
  archivedAt?: string;
  createdAt: string;
  /**
   * 最后修改时间戳（毫秒，Unix epoch）
   * 用于多端并发修改时的字段级 LWW（Last Write Wins）合并
   * 由 updateEmployee() 自动写入，无需手动维护
   */
  updatedAt?: number;
}

// ─── 员工银行卡 ───────────────────────────────────────────────────────────────
export interface EmployeeBankAccount {
  id: string;
  accountName: string;
  bankName: string;
  cardNumber: string;
  note: string;
  isDefault: boolean;
}

// ─── 排班单元格值 ─────────────────────────────────────────────────────────────
export type ShiftHoursValue = number | "休" | "无早" | null;
export type ShiftSessionValue = string | "休" | "无早" | null;

// ─── 排班记录（每月每员工每天） ───────────────────────────────────────────────
export interface ShiftEntry {
  employeeId: string;
  /** 日期 "2026-02-01" */
  date: string;
  /**
   * 班次名称（始终使用班次模板的 session 名称，如"午班"、"晚班"）
   * 即使设置了 specialStatusId，此字段也应是 session 名称，不得是特殊状态名称
   * 这样 getEntry/deleteShift 才能正确匹配
   * 旧値 "day"/"evening"/"both" 已在加载时持久化迁移为"午班"/"晚班"
   */
  shift: string;
  /** 工时（小时），特殊状态时为 null 或 0 */
  hoursValue: ShiftHoursValue;
  /**
   * 特殊状态 ID（对应 SpecialStatus.id）
   * 若设置，该天按特殊状态规则处理薪资
   * comp_off 类型表示加班换休（从累积加班时数里扣除 compOffRule.hoursPerDay 小时）
   */
  specialStatusId?: string;
}

// ─── 换休余额明细条目（跨月累积，有效期3个月） ───────────────────────────────
/**
 * 每次手动存入的换休余额记录
 * 员工加班超过4h后，可手动存入换休余额
 * 有效期从存入月起3个月，过期自动清零
 */
export interface CompOffBalanceEntry {
  id: string;
  employeeId: string;
  /** 存入月份（YYYY-MM） */
  earnedMonth: string;
  /**
   * 来源类型
   * overtime：加班换休（普通加班超出合同工时）
   * holiday：节假日调休（节日上班选择换休）
   */
  source: "overtime" | "holiday";
  /** 存入时扣除的加班小时数（4h=0.5天，8h=1天）（overtime 类型使用） */
  hoursDeducted?: number;
  /** 节假日上班日期（holiday 类型使用） */
  workDate?: string;
  /** 节假日名称（如「元宵节」） */
  holidayName?: string;
  /** 节假日上班对应的补偿金额（holiday 类型，兑现时使用） */
  holidayBonusAmount?: number;
  /** 换算的天数（0.5 or 1） */
  days: number;
  /** 到期月份（earnedMonth + 3个月，YYYY-MM） */
  expiresMonth: string;
  /**
   * 使用状态
   * available：可用
   * used_rest：已换休（抵扣多休天数）
   * cashed_out：已兑现成钱
   * expired：已过期
   */
  status: "available" | "used_rest" | "cashed_out" | "expired";
  /** 使用月份（status=used_rest/cashed_out 时填写） */
  usedMonth?: string;
  /**
   * 唯一的兑现事件快照。它在兑现时一次性写入费率、金额和来源，之后只能作废，
   * 不允许再分别编辑费率或金额。
   */
  settlement?: CompOffCashOutEvent;
  /** 已作废的历史兑现事件，仅用于审计；任一余额同时最多只有一笔 active 兑现事件。 */
  settlementHistory?: readonly CompOffCashOutEvent[];
  /** 备注 */
  notes?: string;
  createdAt: string;
}

export interface CompOffCashOutEvent {
  id: string;
  entryId: string;
  employeeId: string;
  source: "overtime" | "holiday";
  earnedMonth: string;
  usedMonth: string;
  days: number;
  /** 兑现时按余额天数计算的单位费率快照；必须大于零。 */
  unitRate: number;
  /** days × unitRate，创建时校验并固定。 */
  amount: number;
  createdAt: string;
  /** active 才进入薪资；quarantined 是历史损坏数据，voided 是已安全作废。 */
  status: "active" | "quarantined" | "voided";
  issueCode?: "ZERO_RATE_NON_ZERO_AMOUNT" | "AMOUNT_RATE_MISMATCH" | "MISSING_SETTLEMENT";
  voidedAt?: string;
  voidReason?: string;
}

/** 薪资草稿唯一允许保存的调休兑现依据：金额必须与 eventIds 指向的 active 事件精确一致。 */
export interface CompOffCashOutSettlementSnapshot {
  source: "comp_off_event_ledger";
  eventIds: readonly string[];
  amount: number;
  verifiedAt: string;
}

/** 仅保存不可自动入账的历史异常证据；它不参与应发、实发或月结金额计算。 */
export interface PayrollDataQuarantineRecord {
  id: string;
  field: "legacy_comp_off_cash_out";
  code: "ORPHAN_COMP_OFF_CASHOUT" | "SETTLEMENT_SNAPSHOT_MISMATCH";
  amount: number;
  expectedAmount: number;
  detectedAt: string;
  description: string;
  status: "quarantined";
}

/** 计算换休余额到期月份（存入月 + 3个月） */
export function calcCompOffExpiresMonth(earnedMonth: string): string {
  const [y, m] = earnedMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 获取某员工在某月可用的换休余额总天数（未过期、未使用） */
export function getAvailableCompOffDays(entries: CompOffBalanceEntry[], employeeId: string, currentMonth: string): number {
  return entries
    .filter((e) => e.employeeId === employeeId && e.status === "available" && e.expiresMonth >= currentMonth)
    .reduce((sum, e) => sum + e.days, 0);
}

// ─── 节假日调休余额（节日上班产生，当月或次月使用） ─────────────────────────
/**
 * 节假日上班（填写「节日上班 Nx」）后，产生的调休权利
 * 优先于换休余额使用，当月内或次月内有效
 */
export interface HolidayCompOffEntry {
  id: string;
  employeeId: string;
  /** 节日上班日期 */
  workDate: string;
  /** 节日名称（如「元宵节」） */
  holidayName: string;
  /** 产生的调休天数（通常为1天） */
  days: number;
  /** 有效期至（通常为下月末） */
  expiresMonth: string;
  /** 使用状态 */
  status: "available" | "used_rest" | "cashed_out" | "expired";
  usedMonth?: string;
  /** 已迁移至 CompOffBalanceEntry（source=holiday）；仅保留作历史兼容，不再参与业务计算。 */
  migratedToUnified?: boolean;
  createdAt: string;
}

// ─── 无来源多休提醒 ───────────────────────────────────────────────────────────
/**
 * 当员工出勤天数 < 应出勤天数，且无换休余额/节假日调休可抵扣时，生成此提醒
 * 老板可手动选择：扣薪 / 不扣薪 / 填写原因
 */
export interface UnexplainedRestAlert {
  id: string;
  employeeId: string;
  month: string;
  /** 无来源多休天数 */
  unexplainedDays: number;
  /** 处理方式：pending=待处理，deduct=扣薪，waive=不扣薪，noted=已备注 */
  resolution: "pending" | "deduct" | "waive" | "noted";
  /** 备注原因 */
  notes?: string;
  updatedAt: string;
}

// ─── 调休余额记录（每员工每月） ────────────────────────────────────────────────

// ─── 月度考勤汇总（每员工每月） ──────────────────────────────────────────────
export interface MonthlyAttendance {
  id: string;
  employeeId: string;
  month: string;
  daysInMonth: number;
  /** 出勤天数（有工时的天数） */
  attendanceDays: number;
  /** 总工时（所有工作班次工时之和） */
  totalHours: number;
  /** 标准工时（按灵活工时规则或统一工时计算） */
  stdHours: number;
  /** 原始加班时数：仅以实际工作班次的工时与标准工时比较；余额休与节假日休不影响此值。 */
  overtimeHours: number;
  /** 加班换休天数：自动从本月原始加班中占用。 */
  overtimeCompOffDays: number;
  /** 加班换休实际占用的本月加班小时数。 */
  overtimeCompOffHours: number;
  /** 调休余额使用天数：按最早到期余额条目消费，不影响本月加班费。 */
  balanceCompOffDays: number;
  /** 节假日调休使用天数：仅消费节假日换休余额，不影响本月加班费。 */
  holidayCompOffDays: number;
  /** 加班换休申请超出本月原始加班的小时数；非零时禁止确认薪资单。 */
  overtimeCompOffShortfallHours?: number;
  /** 实际计费加班时数（原始加班 - 已确认的加班换休占用）。 */
  paidOvertimeHours: number;
  /**
   * 应出勤天数（daysInMonth - restDaysPerMonth）
   * 自动从员工档案计算，不需要手动填写
   */
  expectedAttendanceDays: number;
  /**
   * 少休天数 = 应出勤天数 - 实际出勤天数
   * 正数=少出勤（缺席），负数=多出勤（加班天数）
   * 自动计算，不需要手动填写
   */
  underRestDays: number;
  /**
   * 特殊状态扣薪明细
   * key = 特殊状态 ID，value = { count: 天数, deduction: 扣薪金额, name: 状态名称 }
   */
  specialStatusDeductions: Record<string, { count: number; deduction: number; name: string; multiplier: number }>;
  /** 特殊状态总扣薪（所有 absence 类状态的扣薪合计） */
  totalSpecialDeduction: number;
  /** 节日上班补偿（work_day 类特殊状态的额外薪资） */
  holidayBonus: number;
  /** 日薪原始基数 = 月底薪 ÷ 当月应出勤天数；保留原始精度，显示时再格式化为两位小数。 */
  dailyRate: number;
  /** 比例底薪 = 日薪原始基数 × 实际出勤天数，最终金额保留两位小数。 */
  proportionalBaseSalary?: number;
  overtimePay: number;
  /** 考勤工资 = 比例底薪 + 加班工资 - 特殊状态扣薪 + 节日上班补偿 */
  attendanceSalary: number;
  notes: string;
  /**
   * 加班超时提醒：当月加班时数超过员工档案中设定的阈値时自动生成
   * 默认阈値：4h（超过半天就提醒存入调休）
   */
  overtimeAlertHours?: number;
  /**
   * 节假日上班天数（isHoliday=true 的特殊状态天数）
   * 包含选择拿錢和换休的所有节假日上班天
   */
  holidayWorkDays?: number;
}

// ─── 薪资单（最终薪资） ───────────────────────────────────────────────────────
// ─── 奖惩明细条目 ─────────────────────────────────────────────────────────────
export interface RewardPenaltyItem {
  id: string;
  /** 条目名称（如「全勤奖」「迟到扣款」「客诉处罚」） */
  name: string;
  /** 金额：正数=奖励，负数=扣款 */
  amount: number;
  /** 说明 */
  note: string;
}

export interface PaySlip {
  id: string;
  employeeId: string;
  month: string;
  /** 员工姓名快照（员工删除后仍可显示） */
  employeeName?: string;
  /** 员工代号快照（员工删除后仍可显示） */
  employeeCode?: string;
  attendanceDays: number;
  /** 考勤工资（比例底薪 + 加班工资 + 节假日补偿 - 特殊扣薪）。精度：2位小数，Math.round(·×100)/100 */
  attendanceSalary: number;
  /** 工作绩效小计（workKPIRules 档位合计）。精度：2位小数 */
  workKPIBonus?: number;
  /** 业绩绩效小计（revenueKPIRules 阶梯合计）。精度：2位小数 */
  revenueKPIBonus?: number;
  /** 餐补合计（per_day 规则：餐补日单价 × 出勤天数）。精度：2位小数 */
  mealAllowance: number;
  /** 交通补贴（固定金额，按周期发放）。精度：2位小数 */
  transportAllowance: number;
  /** 其他补贴合计。精度：2位小数 */
  otherAllowance: number;
  /** 奖惩小计（正数为奖励，负数为罚款）。精度：2位小数 */
  rewardPenalty: number;
  /** 奖惩明细条目（多条，替代单一 rewardPenalty） */
  rewardPenaltyItems?: RewardPenaltyItem[];
  /** 手动预支金额（仅包含手动新增预支，不含备用金关联）。精度：2位小数 */
  advanceAmount: number;
  notes: string;
  /**
   * 应发薪资（税前，扣除社保个税前）。精度：2位小数
   * grossSalary = attendanceSalary + workKPIBonus + revenueKPIBonus +
   *              mealAllowance + transportAllowance + otherAllowance + rewardPenalty + 已验证调休兑现快照金额
   */
  grossSalary: number;
  /** 社保个人缴纳金额（自动计算，可手动覆盖）。精度：2位小数 */
  socialInsuranceDeduction: number;
  /** 公积金个人缴纳金额（自动计算，可手动覆盖）。精度：2位小数 */
  housingFundDeduction: number;
  /** 个人所得税（累计预扣法，自动计算）。精度：2位小数 */
  incomeTax: number;
  /**
   * 实发薪资。精度：2位小数
   * 公式：finalSalary = grossSalary - socialInsuranceDeduction - housingFundDeduction - incomeTax - advanceAmount - pettyLaborPaid
   * 展示时预支合计：advanceAmount + pettyLaborPaid（手动预支 + 备用金关联）
   */
  finalSalary: number;
  /** 公司承担社保总额（养老+医疗+失业+工伤+生育，公司部分） */
  employerSocialInsurance: number;
  /** 公司承担公积金总额（公积金公司部分） */
  employerHousingFund: number;
  /** 公司总人力成本 = 应发 + 公司社保 + 公司公积金 */
  totalEmployerCost: number;
  /** 公司社保明细（各险种公司部分金额） */
  employerInsuranceDetails?: {
    pension: number;
    medical: number;
    unemployment: number;
    workInjury: number;
    maternity: number;
  };
  /** 补贴明细 */
  allowanceDetails?: Record<string, {
    amount: number;
    autoNote: string;
    isOverride: boolean;
    /** 审计字段：记录计算依据，便于追溯和调试 */
    calcBasis?: {
      formula: "rate_x_days" | "fixed" | "override";
      rate?: number;
      days?: number;
      calculatedAt: number;
    };
  }>;
  /** 补贴本月生效状态覆盖（key: ruleId, value: 是否本月生效）
   * 用于持久化绩效补贴页中用户手动勾选/取消的补贴项状态 */
  allowanceOverrides?: Record<string, boolean>;
  /** 工作绩效档位选择（key: ruleId, value: tierId）
   * 由绩效补贴页整页保存时一次性写入，进入页面时从此初始化本地 State */
  workKPISelections?: Record<string, string>;
  /** 业绩绩效实际达到金额（key: ruleId, value: 实际金额数字）
   * 由绩效补贴页整页保存时一次性写入，进入页面时从此初始化本地 State */
  revenueActuals?: Record<string, number>;
  /** 社保明细（各险种金额） */
  socialInsuranceDetails?: {
    pension: number;
    medical: number;
    unemployment: number;
    workInjury: number;
    maternity: number;
  };
  /** 个税计算备注（如"累计应税收入¥xx，适用税率xx%"） */
  incomeTaxNote?: string;
  /**
   * 节假日补偿分配（默认全部拿钱，可手动改为换休）
   * key = 特殊状态 ID，每条记录该节日上班日的分配方式
   */
  holidayBonusAllocation?: Record<string, {
    /** 节日上班日期 */
    date: string;
    /** 节日名称 */
    name: string;
    /** 总补偿金额 */
    totalBonus: number;
    /** 拿钱的金额 */
    cashAmount: number;
    /** 换休的天数 */
    restDays: number;
    /** 处理方式：cash=拿钱, rest=换休, split=部分拿钱+部分换休 */
    mode: "cash" | "rest" | "split";
  }>;
  /**
   * 调休兑现账本快照。它仅由 active 兑现事件汇总产生，严禁人工编辑金额或从旧薪资单继承。
   */
  compOffCashOutSettlement?: CompOffCashOutSettlementSnapshot;
  /**
   * 从旧版直接金额迁移出的隔离证据。只用于核对和更正，绝不参与薪资计算。
   */
  payrollDataQuarantine?: readonly PayrollDataQuarantineRecord[];
  /**
   * 由本月排班中的余额休状态消耗的条目明细；key = date|shift|specialStatusId。
   * 每个排班日可按最早到期优先分配多条余额，重算时由唯一结算器原子释放和重建。
   */
  compOffUsage?: Record<string, Array<{
    entryId: string;
    days: number;
    source: "holiday" | "overtime";
    consumedAt: number;
  }>>;
  /**
   * 备用金人工已付金额（来自备用金关联记录，自动同步）。精度：2位小数
   * 展示时与 advanceAmount 合并计算：已预支 = advanceAmount + pettyLaborPaid
   * 计入 finalSalary 公式：finalSalary = grossSalary - ... - advanceAmount - pettyLaborPaid
   */
  pettyLaborPaid?: number;
  /** 备用金人工已付明细（关联的 PettyCashLaborLink ID 列表） */
  pettyLaborLinkIds?: string[];

  /** 上月已结算差额（由月度归档差额调整引擎生成并计入本月薪资） */
  adjustmentFromPrevMonth?: number;

  updatedAt: string;
}

// ─── 全局薪资设置（社保/个税开关） ───────────────────────────────────────────
export interface GlobalPayrollSettings {
  /** 全局社保/公积金开关 */
  socialInsuranceEnabled: boolean;
  /** 全局个税开关 */
  incomeTaxEnabled: boolean;
  /** 全局社保配置（员工未单独配置时使用） */
  defaultSocialInsurance: SocialInsuranceConfig;
  /** 全局个税配置 */
  defaultIncomeTax: IncomeTaxConfig;
  /** 最后更新时间 */
  updatedAt: string;
}

export const DEFAULT_GLOBAL_PAYROLL_SETTINGS: GlobalPayrollSettings = {
  socialInsuranceEnabled: false,
  incomeTaxEnabled: false,
  defaultSocialInsurance: DEFAULT_SOCIAL_INSURANCE,
  defaultIncomeTax: DEFAULT_INCOME_TAX,
  updatedAt: new Date().toISOString(),
};

// ─── 月度设置 ─────────────────────────────────────────────────────────────────
export interface MonthConfig {
  month: string;
  daysInMonth: number;
  startDate: string;
  notes: string;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function parseMonth(month: string): { year: number; month: number } {
  const [y, m] = month.split("-").map(Number);
  return { year: y, month: m };
}

/**
 * 日薪原始基数：月底薪 ÷ 当月应出勤天数。
 *
 * 不在这里提前四舍五入；同一原始日薪必须同时供比例底薪、节假日倍率、特殊状态扣薪和
 * 调休兑现使用，所有最终金额仅在各自结算边界统一保留两位小数。
 */
export function calcDailyRate(baseSalary: number, daysInMonth: number, restDays: number): number {
  const expectedAttendanceDays = daysInMonth - restDays;
  if (!Number.isFinite(baseSalary) || !Number.isFinite(expectedAttendanceDays) || baseSalary <= 0 || expectedAttendanceDays <= 0) return 0;
  return baseSalary / expectedAttendanceDays;
}

/**
 * 比例底薪唯一入口：日薪原始基数 × 实际出勤天数。
 *
 * 1. 无出勤或应出勤配置异常时归零；
 * 2. 仅在最终金额处保留两位小数，避免先将日薪显示值四舍五入后再乘天数产生累计误差；
 * 3. expectedAttendanceDays 只作为与日薪来源一致性的防御校验，不参与第二次除法。
 */
export function calcAttendanceBaseSalary(
  dailyRate: number,
  attendanceDays: number,
  expectedAttendanceDays: number,
): number {
  if (!Number.isFinite(dailyRate) || !Number.isFinite(attendanceDays) || !Number.isFinite(expectedAttendanceDays)) return 0;
  if (attendanceDays <= 0 || expectedAttendanceDays <= 0) return 0;
  return Math.round(dailyRate * attendanceDays * 100) / 100;
}

/**
 * 获取持久化的比例底薪。新考勤记录直接读取比例底薪字段；仅旧数据缺少该字段时，
 * 才从已结算考勤工资反推一次，确保历史薪资不被迁移时静默改写。
 */
export function getAttendanceBaseSalary(attendance: MonthlyAttendance | null | undefined): number {
  if (!attendance || attendance.attendanceDays <= 0 || attendance.expectedAttendanceDays <= 0) return 0;
  if (typeof attendance.proportionalBaseSalary === "number" && Number.isFinite(attendance.proportionalBaseSalary)) {
    return attendance.proportionalBaseSalary;
  }
  return Math.round((
    attendance.attendanceSalary
    - attendance.overtimePay
    - attendance.holidayBonus
    + attendance.totalSpecialDeduction
  ) * 100) / 100;
}

/**
 * 获取某员工某天的合同工时
 * 优先级：weeklyHoursRules（灵活工时规则）> stdHoursPerDay（默认工时）
 */
export function getContractHoursForDate(employee: Employee, date: string): number {
  const dow = new Date(date).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  if (employee.weeklyHoursRules && employee.weeklyHoursRules.length > 0) {
    for (const rule of employee.weeklyHoursRules) {
      const inRange = rule.fromDay <= rule.toDay
        ? dow >= rule.fromDay && dow <= rule.toDay
        : dow >= rule.fromDay || dow <= rule.toDay;
      if (inRange) return rule.hours;
    }
  }
  return employee.stdHoursPerDay ?? 0;
}

/**
 * 计算社保/公积金（双轨制：个人+公司）
 * 返回个人缴纳金额、公司缴纳金额、合计
 */
export function calcSocialInsurance(
  grossSalary: number,
  config: SocialInsuranceConfig
): {
  // 个人部分（从员工工资扣）
  pension: number;
  medical: number;
  unemployment: number;
  workInjury: number;
  maternity: number;
  housingFund: number;
  employeeTotal: number;
  // 公司部分（公司额外支出）
  employerPension: number;
  employerMedical: number;
  employerUnemployment: number;
  employerWorkInjury: number;
  employerMaternity: number;
  employerHousingFund: number;
  employerTotal: number;
  // 合计
  total: number;
} {
  const zero = {
    pension: 0, medical: 0, unemployment: 0, workInjury: 0, maternity: 0, housingFund: 0, employeeTotal: 0,
    employerPension: 0, employerMedical: 0, employerUnemployment: 0, employerWorkInjury: 0, employerMaternity: 0, employerHousingFund: 0, employerTotal: 0,
    total: 0,
  };
  if (!config.enabled) return zero;

  // 计算基数（应用上下限）
  const rawBase = config.base > 0 ? config.base : grossSalary;
  const base = config.baseMax > 0
    ? Math.min(config.baseMax, Math.max(config.baseMin, rawBase))
    : Math.max(config.baseMin, rawBase);

  const hfRawBase = config.housingFund.base > 0 ? config.housingFund.base : grossSalary;
  const hfBase = config.housingFund.baseMax > 0
    ? Math.min(config.housingFund.baseMax, Math.max(config.housingFund.baseMin, hfRawBase))
    : Math.max(config.housingFund.baseMin, hfRawBase);

  const r = (v: number) => Math.round(v * 100) / 100;

  // 个人部分
  const pension      = config.pension.enabled      ? r(base   * config.pension.employeeRate)      : 0;
  const medical      = config.medical.enabled      ? r(base   * config.medical.employeeRate)      : 0;
  const unemployment = config.unemployment.enabled ? r(base   * config.unemployment.employeeRate) : 0;
  const workInjury   = config.workInjury.enabled   ? r(base   * config.workInjury.employeeRate)   : 0;
  const maternity    = config.maternity.enabled    ? r(base   * config.maternity.employeeRate)    : 0;
  const housingFund  = config.housingFund.enabled  ? r(hfBase * config.housingFund.employeeRate)  : 0;
  const employeeTotal = pension + medical + unemployment + workInjury + maternity + housingFund;

  // 公司部分
  const employerPension      = config.pension.enabled      ? r(base   * config.pension.employerRate)      : 0;
  const employerMedical      = config.medical.enabled      ? r(base   * config.medical.employerRate)      : 0;
  const employerUnemployment = config.unemployment.enabled ? r(base   * config.unemployment.employerRate) : 0;
  const employerWorkInjury   = config.workInjury.enabled   ? r(base   * config.workInjury.employerRate)   : 0;
  const employerMaternity    = config.maternity.enabled    ? r(base   * config.maternity.employerRate)    : 0;
  const employerHousingFund  = config.housingFund.enabled  ? r(hfBase * config.housingFund.employerRate)  : 0;
  const employerTotal = employerPension + employerMedical + employerUnemployment + employerWorkInjury + employerMaternity + employerHousingFund;

  return {
    pension, medical, unemployment, workInjury, maternity, housingFund, employeeTotal,
    employerPension, employerMedical, employerUnemployment, employerWorkInjury, employerMaternity, employerHousingFund, employerTotal,
    total: employeeTotal + employerTotal,
  };
}

/**
 * 计算个人所得税（累计预扣法）
 * @param cumulativeIncome 年度累计应税收入（当月及之前各月应税收入之和）
 * @param cumulativeDeductions 年度累计专项扣除（社保+公积金+专项附加扣除）
 * @param cumulativeTaxPaid 年度累计已预扣税额
 * @param _threshold 起征点（默认5000）
 * @returns 本月应预扣税额
 */
export function calcIncomeTax(
  /**
   * 年度累计应纳税所得额
   * = 累计应发 - 累计社保个人部分 - 累计公积金个人部分 - 累计起征点（5000×月数）- 累计专项附加扣除
   * 由调用方计算后传入，函数内部不再重复扣除
   */
  cumulativeIncome: number,
  cumulativeTaxPaid: number,
  _threshold: number = 5000,
  _specialDeductions: number = 0
): { tax: number; note: string } {
  // 累计应纳税所得额直接使用传入值（调用方已扣除社保、起征点、专项附加扣除）
  const taxableIncome = Math.max(0, cumulativeIncome);

  // 查找适用税率档
  const bracket = INCOME_TAX_BRACKETS.find(
    (b) => taxableIncome > b.min && taxableIncome <= b.max
  ) ?? INCOME_TAX_BRACKETS[0];

  const cumulativeTax = Math.max(0, taxableIncome * bracket.rate - bracket.quickDeduction);
  const monthTax = Math.max(0, cumulativeTax - cumulativeTaxPaid);

  const note = `累计应税收入¥${formatMoney(taxableIncome)}，适用税率${(bracket.rate * 100).toFixed(0)}%，速算扣除数¥${formatMoney(bracket.quickDeduction)}`;

  return { tax: Math.round(monthTax * 100) / 100, note };
}

/**
 * 自动计算补贴金额
 */
export function calcAllowance(rule: AllowanceRule, attendanceDays: number): { amount: number; autoNote: string } {
  if (!rule.enabled) return { amount: 0, autoNote: "" };

  // unit 已为必填字段，直接使用，无需推断
  // transport_fixed 始终为固定补贴（不受 unit 影响）
  if (rule.type === "transport_fixed") {
    return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
  }

  if (rule.unit === "per_day") {
    // 动态补贴：金额 = 单价 × 出勤天数
    const total = Math.round(rule.amount * attendanceDays * 100) / 100;
    return {
      amount: total,
      autoNote: `${rule.label} ¥${formatMoney(rule.amount)}/天 × ${attendanceDays}天 = ¥${formatMoney(total)}`,
    };
  }

  // 固定补贴：per_month / per_quarter / per_year
  return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

export function getMonthDates(month: string): string[] {
  const { year, month: m } = parseMonth(month);
  const days = getDaysInMonth(year, m);
  return Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

export function getDayOfWeek(date: string): number {
  return new Date(date).getDay();
}

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── 快速填充预设 ─────────────────────────────────────────────────────────────
/** 快速填充预设：保存常用的填充配置（最多3个） */
export interface FillPreset {
  id: string;
  /** 显示名称，如「周一~五·当月」 */
  label: string;
  /** 班次 session 名称（班次模式下使用） */
  session: string;
  /** 起始星期几（0=周日，1=周一，...，6=周六） */
  fromDay: number;
  /** 结束星期几（0=周日，1=周一，...，6=周六） */
  toDay: number;
  /** 范围：当前周 or 当前月 */
  scope: "week" | "month";
  /** 时长模式下的工时数（时长模式下使用） */
  hours?: number;
  /** 预设模式："shift"（班次）或 "hours"（时长） */
  mode?: "shift" | "hours";
  createdAt: string;
}

/** 判断某个星期几是否在 fromDay~toDay 范围内（支持跨周，如周五~周二） */
export function isDayInRange(dow: number, fromDay: number, toDay: number): boolean {
  if (fromDay <= toDay) {
    return dow >= fromDay && dow <= toDay;
  } else {
    // 跨周，如 fromDay=5(周五), toDay=2(周二) => 周五、六、日、一、二
    return dow >= fromDay || dow <= toDay;
  }
}


// ─── 月度归档与差额调整 ─────────────────────────────────────────────────────

/** 月度归档状态。DRAFT 不持久化；有正式归档时为 FROZEN；调整草稿期间为 ADJUSTING。 */
export type MonthCloseStatus = "draft" | "frozen" | "adjusting";

/** 差额结算方式 */
export type AdjustmentSettleMethod = "next_month" | "separate" | "manual";

/** 已归档的单个部门最终排班依据。只能由月度归档事务创建，不提供手工存档入口。 */
export interface FinalScheduleSnapshot {
  deptCategory: DeptCategory;
  entries: ShiftEntry[];
  employeeIds: string[];
  entryCount: number;
}

/** 已归档的单个员工薪资依据。独立于实时 PaySlip，禁止被自动同步覆盖。 */
export interface FrozenPayrollSnapshot {
  employeeId: string;
  employeeName: string;
  grossSalary: number;
  finalSalary: number;
  attendanceSalary: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  workKPIBonus?: number;
  revenueKPIBonus?: number;
  rewardPenalty?: number;
  socialInsuranceDeduction: number;
  housingFundDeduction: number;
  incomeTax?: number;
  advanceAmount: number;
  pettyLaborPaid?: number;
}

/** 归档完成后产生的单员工差额记录。 */
export interface PayrollAdjustment {
  id: string;
  archiveId: string;
  createdAt: number;
  employeeId: string;
  employeeName: string;
  amount: number;
  details: string;
  settled: boolean;
  settleMethod?: AdjustmentSettleMethod;
  settledInMonth?: string;
}

/** 正式月度归档版本：同时保存最终排班依据与冻结薪资依据。 */
export interface MonthCloseArchive {
  id: string;
  month: string;
  version: number;
  status: "frozen" | "superseded";
  createdAt: number;
  closedBy: string;
  previousArchiveId?: string;
  supersededByArchiveId?: string;
  summary: {
    totalEmployees: number;
    totalGrossSalary: number;
    totalFinalSalary: number;
    totalDeductions: number;
  };
  scheduleByDept: Partial<Record<DeptCategory, FinalScheduleSnapshot>>;
  payrollByEmployee: Record<string, FrozenPayrollSnapshot>;
  adjustments: PayrollAdjustment[];
}

/** FROZEN 月进入调整时创建的隔离会话。实时正式数据不在会话中直接修改。 */
export interface MonthAdjustmentSession {
  id: string;
  month: string;
  baseArchiveId: string;
  baseVersion: number;
  status: "open";
  reason: string;
  settleMethod: AdjustmentSettleMethod;
  createdAt: number;
  createdBy: string;
  /** 打开调整时的完整月度基线；放弃调整必须精确恢复，避免污染冻结版本。 */
  baseline: {
    shifts: ShiftEntry[];
    attendances: MonthlyAttendance[];
    paySlips: PaySlip[];
  };
}

/**
 * 人工成本管理模块 - 完整类型定义 v4
 * 新增：社保/公积金双轨制（个人+公司）、城市政策数据库、换休余额明细、节假日调休余额、无来源多休提醒
 */

// ─── 员工部门 / 类型 ──────────────────────────────────────────────────────────
export type EmployeeDept = "front" | "kitchen" | "parttime" | "other";
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

/**
 * 向后兼容：旧版 WeeklyHoursMap 类型
 * @deprecated 请使用 WeeklyHoursRule[]
 */
export type WeeklyHoursMap = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number | null>>;

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
  | "custom_fixed"      // 自定义固定补贴
  | "custom_formula";   // 自定义公式（预留）

export interface AllowanceRule {
  id: string;
  type: AllowanceType;
  label: string;
  /** 金额（固定月额 or 每天金额） */
  amount: number;
  /** 是否启用 */
  enabled: boolean;
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

/** 向后兼容：从旧版 SocialInsuranceConfig 读取个人比例 */
export function getSIEmployeeRate(config: SocialInsuranceConfig): {
  pension: number; medical: number; unemployment: number;
  workInjury: number; maternity: number; housingFund: number;
} {
  return {
    pension: config.pension.employeeRate,
    medical: config.medical.employeeRate,
    unemployment: config.unemployment.employeeRate,
    workInjury: config.workInjury.employeeRate,
    maternity: config.maternity.employeeRate,
    housingFund: config.housingFund.employeeRate,
  };
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
  housingFund:  { name: "住房公积金", enabled: true, employeeRate: 0.12, employerRate: 0.12,  base: 0, baseMin: 0, baseMax: 0 },
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
    baseMin: 7310, baseMax: 36549,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.004 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.07,  employerRate: 0.07, baseMin: 2690, baseMax: 36549 },
    year: 2024, source: "上海市人社局2024年标准",
  },
  {
    city: "北京",
    baseMin: 6821, baseMax: 34188,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.004 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2320, baseMax: 34188 },
    year: 2024, source: "北京市人社局2024年标准",
  },
  {
    city: "广州",
    baseMin: 3096, baseMax: 30948,
    pension:      { employeeRate: 0.08,  employerRate: 0.14  },
    medical:      { employeeRate: 0.02,  employerRate: 0.065 },
    unemployment: { employeeRate: 0.002, employerRate: 0.012 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2300, baseMax: 30948 },
    year: 2024, source: "广州市人社局2024年标准",
  },
  {
    city: "深圳",
    baseMin: 2360, baseMax: 31884,
    pension:      { employeeRate: 0.08,  employerRate: 0.13  },
    medical:      { employeeRate: 0.02,  employerRate: 0.065 },
    unemployment: { employeeRate: 0.003, employerRate: 0.007 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.006 },
    housingFund:  { employeeRate: 0.05,  employerRate: 0.05, baseMin: 2360, baseMax: 31884 },
    year: 2024, source: "深圳市人社局2024年标准",
  },
  {
    city: "杭州",
    baseMin: 3702, baseMax: 25826,
    pension:      { employeeRate: 0.08,  employerRate: 0.14  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 25826 },
    year: 2024, source: "杭州市人社局2024年标准",
  },
  {
    city: "成都",
    baseMin: 3408, baseMax: 22498,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.095 },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 22498 },
    year: 2024, source: "成都市人社局2024年标准",
  },
  {
    city: "武汉",
    baseMin: 3613, baseMax: 21680,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.08  },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 21680 },
    year: 2024, source: "武汉市人社局2024年标准",
  },
  {
    city: "南京",
    baseMin: 3480, baseMax: 23200,
    pension:      { employeeRate: 0.08,  employerRate: 0.16  },
    medical:      { employeeRate: 0.02,  employerRate: 0.09  },
    unemployment: { employeeRate: 0.005, employerRate: 0.005 },
    workInjury:   { employeeRate: 0,     employerRate: 0.003 },
    maternity:    { employeeRate: 0,     employerRate: 0.008 },
    housingFund:  { employeeRate: 0.12,  employerRate: 0.12, baseMin: 2280, baseMax: 23200 },
    year: 2024, source: "南京市人社局2024年标准",
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
  { id: "ss_comp_off", name: "加班换休", category: "comp_off", direction: "neutral",  countAsAttendance: true,  salaryMultiplier: 0,   color: "#007AFF", sortOrder: 6, isBuiltin: true },
  { id: "ss_penalty",  name: "违规扣款", category: "absence",  direction: "negative", countAsAttendance: true,  salaryMultiplier: 1,   color: "#FF6B00", sortOrder: 7, isBuiltin: true },
];

// ─── 绩效条目数据源类型 ───────────────────────────────────────────────────────
export type PerformanceDataSource =
  | "manual"            // 纯手动
  | "revenue"           // 营业额（从月报读取）
  | "net_profit"        // 净利润（从月报读取）
  | "attendance_days";  // 出勤天数（从排班表读取）

// ─── 绩效条目（模板级别） ─────────────────────────────────────────────────────
export interface PerformanceItem {
  id: string;
  /** 编号（A1/B2/C1...） */
  code: string;
  /** 条目名称 */
  title: string;
  /** 详细说明/备注 */
  description: string;
  /** 最高可得金额（0=无上限） */
  maxAmount: number;
  /** 是否固定金额（固定则 actualAmount = maxAmount，不需填写） */
  isFixed: boolean;
  /** 数据来源 */
  dataSource: PerformanceDataSource;
  /**
   * 阶梯规则（用于营业额提点、好评数等）
   * 例：[{ threshold: 50000, rate: 0.04 }, { threshold: 90000, rate: 0.05 }]
   */
  tiers?: Array<{ threshold: number; rate: number; label?: string }>;
  /** 排序权重 */
  sortOrder: number;
}

// ─── 绩效分组（模板级别） ─────────────────────────────────────────────────────
export interface PerformanceGroup {
  id: string;
  title: string;
  description: string;
  items: PerformanceItem[];
  sortOrder: number;
}

// ─── 绩效模板（每位员工一个） ─────────────────────────────────────────────────
export interface PerformanceTemplate {
  id: string;
  employeeId: string;
  name: string;
  groups: PerformanceGroup[];
  updatedAt: string;
}

// ─── 绩效月度记录（每月填写实际完成情况） ────────────────────────────────────
export interface PerformanceRecord {
  id: string;
  employeeId: string;
  month: string;
  actuals: Record<string, number>;
  overrides: Record<string, boolean>;
  autoNotes: Record<string, string>;
  totalPerformance: number;
  updatedAt: string;
}

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
export interface EmployeeGroup {
  id: string;
  name: string;
  color: string;
  employeeIds: string[];
  sortOrder: number;
  collapsed: boolean;
}

export const DEFAULT_EMPLOYEE_GROUPS: EmployeeGroup[] = [
  { id: "grp_front",    name: "前厅", color: "#007AFF", employeeIds: [], sortOrder: 0, collapsed: false },
  { id: "grp_kitchen",  name: "后厨", color: "#34C759", employeeIds: [], sortOrder: 1, collapsed: false },
  { id: "grp_parttime", name: "兼职", color: "#FF9500", employeeIds: [], sortOrder: 2, collapsed: false },
  { id: "grp_other",    name: "其他", color: "#8E8E93", employeeIds: [], sortOrder: 3, collapsed: false },
];

// ─── 员工档案（扩展版） ───────────────────────────────────────────────────────
export interface Employee {
  id: string;
  code: string;
  realName: string;
  phone: string;
  dept: EmployeeDept;
  type: EmployeeType;
  baseSalary: number;
  /** 每日标准工时（无灵活规则时使用） */
  stdHoursPerDay: number;
  /** 灵活工时规则列表（优先于 stdHoursPerDay） */
  weeklyHoursRules?: WeeklyHoursRule[];
  /** @deprecated 旧版，已被 weeklyHoursRules 替代 */
  weeklyHours?: WeeklyHoursMap;
  restDaysPerMonth: number;
  hourlyRate: number;
  overtimeHourlyRate: number;
  holidayMultiplier: number;
  /** 调休规则（几小时加班换一天休） */
  compOffRule?: CompOffRule;
  /** 补贴规则列表（饭补/交通/自定义） */
  allowanceRules?: AllowanceRule[];
  /** 社保/公积金配置（每人独立，可覆盖全局配置） */
  socialInsurance?: SocialInsuranceConfig;
  /** 个税配置（每人独立，可覆盖全局配置） */
  incomeTax?: IncomeTaxConfig;
  defaultSession?: ShiftSession;
  notes: string;
  active: boolean;
  monthlyFixedSalary: number;
  bankAccounts?: EmployeeBankAccount[];
  idNumber?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  idCardImageUri?: string;
  healthCertImageUri?: string;
  healthCertExpiry?: string;
  joinDate?: string;
  leaveDate?: string;
  createdAt: string;
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
   * 班次名称（工作班次时使用，如"午班"、"晚班"）
   * 若 specialStatusId 有值，则此字段表示特殊状态名称（用于显示）
   * @deprecated 旧值 "day"/"evening"/"both" 会在读取时自动迁移
   */
  shift: string;
  /** 工时（小时），特殊状态时为 null 或 0 */
  hoursValue: ShiftHoursValue;
  /** @deprecated 保留向后兼容 */
  sessionValue: ShiftSessionValue;
  /**
   * 特殊状态 ID（对应 SpecialStatus.id）
   * 若设置，该天按特殊状态规则处理薪资
   * comp_off 类型表示加班换休（从累积加班时数里扣除 compOffRule.hoursPerDay 小时）
   */
  specialStatusId?: string;
  /** @deprecated 旧版加班处理方式，已被 specialStatusId 替代 */
  overtimeType?: "pay" | "comp_off";
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
  /** 兑现日薪（兑现时按兑现当月日薪计算，可人工修改） */
  cashOutDailyRate?: number;
  /** 兑现金额（days × cashOutDailyRate） */
  cashOutAmount?: number;
  /** 备注 */
  notes?: string;
  createdAt: string;
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

// ─── 调休余额记录（每员工每月，保留向后兼容） ────────────────────────────────
export interface CompOffBalance {
  id: string;
  employeeId: string;
  month: string;
  /** 本月累积加班时数（用于加班换休计算） */
  totalOvertimeHours: number;
  /** 本月使用加班换休次数 */
  compOffCount: number;
  /** 每次换休消耗的加班时数（来自 compOffRule.hoursPerDay） */
  hoursPerCompOff: number;
  /** 实际计费加班时数（totalOvertimeHours - compOffCount * hoursPerCompOff） */
  paidOvertimeHours: number;
  /** @deprecated 旧版字段，保留兼容 */
  earnedDays?: number;
  usedDays?: number;
  remainingDays?: number;
  details?: Array<{ date: string; overtimeHours: number; compOffDays: number }>;
}

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
  /** 累积加班时数（totalHours - stdHours，正数为加班） */
  overtimeHours: number;
  /** 加班换休次数 */
  compOffCount: number;
  /** 每次换休消耗的加班时数 */
  hoursPerCompOff: number;
  /** 实际计费加班时数（overtimeHours - compOffCount * hoursPerCompOff） */
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
  dailyRate: number;
  dailyRateOverride: boolean;
  overtimePay: number;
  /** 考勤工资 = 底薪 + 加班工资 - 特殊状态扣薪 + 节日上班补偿 */
  attendanceSalary: number;
  notes: string;
}

// ─── 薪资单（最终薪资） ───────────────────────────────────────────────────────
export interface PaySlip {
  id: string;
  employeeId: string;
  month: string;
  attendanceDays: number;
  attendanceSalary: number;
  performanceBonus: number;
  salesCommission: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  rewardPenalty: number;
  rewardPenaltyNote: string;
  advanceAmount: number;
  notes: string;
  /** 最终薪资（税前，扣除社保个税前） */
  grossSalary: number;
  /** 社保个人缴纳金额（自动计算，可手动覆盖） */
  socialInsuranceDeduction: number;
  /** 公积金个人缴纳金额（自动计算，可手动覆盖） */
  housingFundDeduction: number;
  /** 个人所得税（累计预扣法，自动计算） */
  incomeTax: number;
  /**
   * 实发薪资 = 应发 - 社保个人部分 - 公积金个人部分 - 个税 - 预支
   * 开启社保/个税时：实发 = grossSalary - socialInsuranceDeduction - housingFundDeduction - incomeTax - advanceAmount
   * 关闭社保/个税时：实发 = grossSalary - advanceAmount
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
  allowanceDetails?: Record<string, { amount: number; autoNote: string; isOverride: boolean }>;
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
   * 调休兑现金额（将调休余额兑现成钱，加入应发）
   * 兑现时按兑现当月日薪计算，可人工修改
   */
  compOffCashOut?: number;
  /** 调休兑现备注（如"兑现X天加班换休余额，日薪¥XX"） */
  compOffCashOutNote?: string;
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

export function calcDailyRate(baseSalary: number, daysInMonth: number, restDays: number): number {
  const workDays = daysInMonth - restDays;
  if (workDays <= 0) return 0;
  return Math.round((baseSalary / workDays) * 100) / 100;
}

/**
 * 获取某员工某天的合同工时
 * 优先级：weeklyHoursRules（新）> weeklyHours（旧，兼容）> stdHoursPerDay
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
    return employee.stdHoursPerDay;
  }

  if (employee.weeklyHours) {
    const h = employee.weeklyHours[dow];
    if (h === null) return 0;
    if (h !== undefined) return h;
  }

  return employee.stdHoursPerDay;
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
  /** @deprecated 向后兼容，等同于 employeeTotal */
  totalEmployee: number;
} {
  const zero = {
    pension: 0, medical: 0, unemployment: 0, workInjury: 0, maternity: 0, housingFund: 0, employeeTotal: 0,
    employerPension: 0, employerMedical: 0, employerUnemployment: 0, employerWorkInjury: 0, employerMaternity: 0, employerHousingFund: 0, employerTotal: 0,
    total: 0, totalEmployee: 0,
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
    totalEmployee: employeeTotal,
  };
}

/**
 * 计算个人所得税（累计预扣法）
 * @param cumulativeIncome 年度累计应税收入（当月及之前各月应税收入之和）
 * @param cumulativeDeductions 年度累计专项扣除（社保+公积金+专项附加扣除）
 * @param cumulativeTaxPaid 年度累计已预扣税额
 * @param threshold 起征点（默认5000）
 * @returns 本月应预扣税额
 */
export function calcIncomeTax(
  /**
   * 年度累计应纳税所得额
   * = 累计应发 - 累计社保个人部分 - 累计公积金个人部分 - 累计起征点（5000×月数）- 累计专项附加扣除
   * 由调用方计算后传入，函数内部不再重复扣除
   */
  cumulativeIncome: number,
  /** @deprecated 保留参数兼容性，已不使用（调用方已在 cumulativeIncome 中扣除） */
  cumulativeDeductions: number,
  cumulativeTaxPaid: number,
  threshold: number = 5000,
  specialDeductions: number = 0
): { tax: number; note: string } {
  // 累计应纳税所得额直接使用传入值（调用方已扣除社保、起征点、专项附加扣除）
  const taxableIncome = Math.max(0, cumulativeIncome);

  // 查找适用税率档
  const bracket = INCOME_TAX_BRACKETS.find(
    (b) => taxableIncome > b.min && taxableIncome <= b.max
  ) ?? INCOME_TAX_BRACKETS[0];

  const cumulativeTax = Math.max(0, taxableIncome * bracket.rate - bracket.quickDeduction);
  const monthTax = Math.max(0, cumulativeTax - cumulativeTaxPaid);

  const note = `累计应税收入¥${taxableIncome.toFixed(0)}，适用税率${(bracket.rate * 100).toFixed(0)}%，速算扣除数¥${bracket.quickDeduction}`;

  return { tax: Math.round(monthTax * 100) / 100, note };
}

/** 计算最终薪资（税后实发） */
export function calcFinalSalary(slip: Omit<PaySlip, "finalSalary" | "grossSalary" | "id" | "updatedAt">): {
  grossSalary: number;
  finalSalary: number;
} {
  const grossSalary = Math.round((
    slip.attendanceSalary +
    slip.performanceBonus +
    slip.salesCommission +
    slip.mealAllowance +
    slip.transportAllowance +
    slip.otherAllowance +
    slip.rewardPenalty
  ) * 100) / 100;

  const finalSalary = Math.round((
    grossSalary -
    (slip.socialInsuranceDeduction ?? 0) -
    (slip.housingFundDeduction ?? 0) -
    (slip.incomeTax ?? 0)
  ) * 100) / 100;

  return { grossSalary, finalSalary };
}

/**
 * 自动计算补贴金额
 */
export function calcAllowance(rule: AllowanceRule, attendanceDays: number): { amount: number; autoNote: string } {
  if (!rule.enabled) return { amount: 0, autoNote: "" };
  switch (rule.type) {
    case "transport_fixed":
      return { amount: rule.amount, autoNote: `交通补贴（固定）¥${rule.amount}` };
    case "meal_per_day":
      return {
        amount: Math.round(rule.amount * attendanceDays * 100) / 100,
        autoNote: `饭补 ¥${rule.amount}/天 × ${attendanceDays}天 = ¥${(rule.amount * attendanceDays).toFixed(0)}`,
      };
    case "custom_fixed":
      return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
    default:
      return { amount: rule.amount, autoNote: rule.label };
  }
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

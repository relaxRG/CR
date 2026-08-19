import type { TextStyle, ViewStyle } from "react-native";

/**
 * 门店唯一视觉系统。
 *
 * 所有报表、员工、备用金、库存、店铺页面必须从这里读取信息层级、
 * 语义颜色、图标尺度和响应式密度；不得在业务页面自行发明同层级样式。
 */
export const STORE_VISUAL_SYSTEM = {
  version: 1,
  weight: {
    quiet: "400",
    body: "500",
    emphasis: "600",
  },
  icon: {
    detail: 12,
    section: 14,
    toolbar: 16,
    navigation: 18,
    maximumRoutine: 18,
  },
  spacing: {
    pageHorizontal: 16,
    sectionTop: 16,
    sectionGap: 12,
    groupGap: 8,
    rowVertical: 12,
    compactRowVertical: 8,
  },
  radius: {
    card: 14,
    group: 12,
    control: 10,
    tag: 7,
  },
  density: {
    phoneMax: 599,
    tabletMax: 1023,
    phoneSummaryColumns: 2,
    tabletSummaryColumns: 4,
    desktopSummaryColumns: 4,
    phoneVisibleMetricColumns: 3,
    tabletVisibleMetricColumns: 5,
    desktopVisibleMetricColumns: 5,
    desktopContentMaxWidth: 1240,
  },
} as const;

export type StoreVisualTone =
  | "neutral"
  | "primary"
  | "positive"
  | "attention"
  | "accent"
  | "danger"
  | "muted"
  // 以下为员工领域的兼容别名；新模块优先使用通用角色而非职业或动作名称。
  | "front"
  | "kitchen"
  | "overtime"
  | "allowance"
  | "settled"
  | "warning";

export type StoreVisualColors = {
  primary: string;
  foreground: string;
  muted: string;
  border: string;
  surface: string;
  background: string;
  success: string;
  warning: string;
  error: string;
  aiAccent: string;
  /** 分类色仅用于图表、图例、色点和用户管理的分类图标；页面不得直接硬编码。 */
  categoryTeal?: string;
  categoryCyan?: string;
  categoryIndigo?: string;
  categoryPink?: string;
  categoryMint?: string;
  categoryAmber?: string;
  categoryCoral?: string;
};

/**
 * 基础颜色角色跨所有门店页面一致：它们描述展示意图，不直接替代领域事实。
 * 例如“收入”不是天然绿色，“库存”也不是天然蓝色；应由领域映射决定是否需要强调。
 */
export function storeTone(colors: StoreVisualColors, tone: StoreVisualTone): string {
  switch (tone) {
    case "primary":
    case "front":
      return colors.primary;
    case "positive":
    case "kitchen":
    case "settled":
      return colors.success;
    case "attention":
    case "overtime":
    case "warning":
      return colors.warning;
    case "accent":
    case "allowance":
      return colors.aiAccent;
    case "danger":
      return colors.error;
    case "muted":
      return colors.muted;
    default:
      return colors.foreground;
  }
}

export function storeToneSurface(colors: StoreVisualColors, tone: StoreVisualTone): string {
  return `${storeTone(colors, tone)}14`;
}

/**
 * 用户可管理的分类与统计系列使用稳定九色调色板。危险红不参与普通分类，
 * 以免把普通菜品、库存分类或费用科目误读为异常。色彩不足时优先配合图例、形状、排序或分面，
 * 而不是无限继续增加相近颜色。
 */
export const STORE_CATEGORY_COLOR_KEYS = [
  "primary",
  "categoryTeal",
  "aiAccent",
  "categoryIndigo",
  "categoryCyan",
  "categoryMint",
  "categoryAmber",
  "categoryPink",
  "categoryCoral",
] as const;

/** 兼容已有图表调用；语义 tone 不再被误用为分类颜色池。 */
export const STORE_CATEGORY_TONES = ["primary", "accent", "attention", "positive", "muted"] as const satisfies readonly StoreVisualTone[];

export type StoreCategoryColorKey = (typeof STORE_CATEGORY_COLOR_KEYS)[number];

export function storeCategoryColor(colors: StoreVisualColors, index: number): string {
  const key = STORE_CATEGORY_COLOR_KEYS[Math.abs(index) % STORE_CATEGORY_COLOR_KEYS.length];
  const resolved = colors[key];
  if (resolved) return resolved;
  const fallbacks: Record<StoreCategoryColorKey, StoreVisualTone> = {
    primary: "primary",
    categoryTeal: "positive",
    aiAccent: "accent",
    categoryIndigo: "primary",
    categoryCyan: "primary",
    categoryMint: "positive",
    categoryAmber: "attention",
    categoryPink: "accent",
    categoryCoral: "attention",
  };
  return storeTone(colors, fallbacks[key]);
}

/**
 * 领域映射是唯一允许解释“同一种基础色在此页面是什么意思”的位置。
 * 页面代码应引用通用 tone；设计评审与开发规范按本映射判断是否可使用该颜色。
 */
export const STORE_DOMAIN_COLOR_RULES = {
  reports: {
    neutral: "常规营业收入、支出、手续费、科目金额与历史同比；不因金额正负自动着色。",
    primary: "当前选择的报表页签、筛选和唯一的主操作。",
    positive: "净利润为正、已完成归档或明确达标的趋势；必须同时显示文字或趋势符号。",
    attention: "需要关注的环比变化、待补充数据或尚未核对的期间；不是普通费用颜色。",
    accent: "菜品大类、收入构成和图例中的第二分类色；仅用于图表、色点或分组标题。",
    danger: "净利润为负、金额校验差额、导入失败或明确财务异常。",
  },
  labor: {
    neutral: "姓名、常规底薪、实发金额、已预支和普通薪资字段。",
    primary: "前厅分类、当前操作与待发薪资。",
    positive: "后厨分类、已发薪资、已完成核对或已归档。",
    attention: "加班、到期调休、待确认或需关注的考勤变化。",
    accent: "补贴、绩效、预支关联和非异常的附加项。",
    danger: "薪资差额、扣款异常、数据冲突或确需人工处理的状态。",
  },
  pettyCash: {
    neutral: "普通支出、期初/期末余额、账本金额与历史记录。",
    primary: "当前账本视图、手工录入与需要处理的当月动作。",
    positive: "确认入账、正常收入或已完成月结。",
    attention: "待分类、待核对、临近月结或需补充凭证。",
    accent: "备用金转入与内部资金调拨；不用于普通收入。",
    danger: "账实不符、负余额、重复导入或明确错误记录。",
  },
  inventory: {
    neutral: "库存量、单位成本、进货成本、消耗、期初/期末及普通台账金额。",
    primary: "当前分类、当前工作台、采购录入和可执行的主操作。",
    positive: "已月结、盘点已确认、成功导入或完成归档。",
    attention: "待盘点、待补全分类、待确认的月结草稿；不恢复已删除的库存预警功能。",
    accent: "统计图或分类分组的第二色，仅出现在分组标题、色点和图例，不进入每行台账。",
    danger: "损耗、盘点差异、导入冲突或不允许的负库存数据。",
  },
  shop: {
    neutral: "杯具、餐具、日用品、设备的普通数量、成本和台账字段。",
    primary: "当前品类、登记/录入等主操作。",
    positive: "维护完成、折旧确认、已归档或完成盘点。",
    attention: "待维护、待盘点、待补全资料。",
    accent: "统计图与分类分组的辅助颜色，不能替代状态文字。",
    danger: "损耗、维修异常、盘点差异或数据冲突。",
  },
} as const;

export type StoreDensity = "phone" | "tablet" | "desktop";

export function getStoreDensity(width: number): StoreDensity {
  if (width <= STORE_VISUAL_SYSTEM.density.phoneMax) return "phone";
  if (width <= STORE_VISUAL_SYSTEM.density.tabletMax) return "tablet";
  return "desktop";
}

export function getStoreVisibleMetricColumns(width: number): number {
  const density = getStoreDensity(width);
  if (density === "phone") return STORE_VISUAL_SYSTEM.density.phoneVisibleMetricColumns;
  if (density === "tablet") return STORE_VISUAL_SYSTEM.density.tabletVisibleMetricColumns;
  return STORE_VISUAL_SYSTEM.density.desktopVisibleMetricColumns;
}

export function getStoreSummaryColumns(width: number): number {
  return getStoreDensity(width) === "phone"
    ? STORE_VISUAL_SYSTEM.density.phoneSummaryColumns
    : STORE_VISUAL_SYSTEM.density.tabletSummaryColumns;
}

/** 页面外壳：Mac 固定舒适阅读宽度，iPhone/iPad始终贴合可用宽度。 */
export function storeContentShell(width: number): ViewStyle {
  return {
    width: "100%",
    maxWidth: getStoreDensity(width) === "desktop" ? STORE_VISUAL_SYSTEM.density.desktopContentMaxWidth : undefined,
    alignSelf: "center",
    paddingHorizontal: STORE_VISUAL_SYSTEM.spacing.pageHorizontal,
  };
}

/** 常规正文必须轻于“强调”；700及以上只允许显式异常标签，不能用于日常数据行。 */
export const STORE_TEXT = {
  pageTitle: { fontSize: 17, lineHeight: 23, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis },
  sectionTitle: { fontSize: 15, lineHeight: 21, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis },
  body: { fontSize: 13, lineHeight: 19, fontWeight: STORE_VISUAL_SYSTEM.weight.body },
  supporting: { fontSize: 12, lineHeight: 17, fontWeight: STORE_VISUAL_SYSTEM.weight.quiet },
  caption: { fontSize: 10, lineHeight: 14, fontWeight: STORE_VISUAL_SYSTEM.weight.quiet },
  metric: { fontSize: 14, lineHeight: 20, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis },
  metricLarge: { fontSize: 20, lineHeight: 27, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis },
} as const satisfies Record<string, TextStyle>;

/** 页面接入契约，既用作团队规范，也由自动化测试检查关键页面。 */
export const STORE_VISUAL_RULES = {
  scope: "报表、员工、备用金、库存、店铺只能使用本模块的语义色彩、图标尺度、文本层级与响应式密度函数。",
  color: "基础角色为蓝=当前选择/主操作，绿=确认完成或正向结果，琥珀=待关注，紫=关联/辅助分类，红=真实异常，灰=中性数据与历史。报表、员工、备用金、库存和店铺必须按 STORE_DOMAIN_COLOR_RULES 解释领域事实；普通收入、支出、库存量和成本默认中性。重要状态必须同时提供文字或图标。",
  icon: "分类标题使用14pt图标且每组仅一次；工具栏使用16pt轮廓图标；行内详情最多12pt；常规页面不得出现超过18pt的装饰图标。",
  type: "正文使用400/500，名称与关键金额最多600；日常标题、金额、台账行禁止700/800/900。",
  density: "iPhone仅展示3个关键指标并通过展开查看详情；iPad和Mac展示5个指标；Mac内容最大宽度1240pt且不放大手机卡片。",
  controls: "二级页签为40pt纯文本栏；上下文操作为36pt；底部导航和页面内容不允许被绝对定位操作遮挡。",
} as const;

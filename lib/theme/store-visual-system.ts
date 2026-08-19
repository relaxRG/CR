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
  | "front"
  | "kitchen"
  | "overtime"
  | "allowance"
  | "settled"
  | "warning"
  | "danger"
  | "muted";

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
};

/** 每种颜色只拥有一个稳定的业务语义，不能在不同页面重定义。 */
export function storeTone(colors: StoreVisualColors, tone: StoreVisualTone): string {
  switch (tone) {
    case "primary":
    case "front":
      return colors.primary;
    case "kitchen":
    case "settled":
      return colors.success;
    case "overtime":
    case "warning":
      return colors.warning;
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

/** 统计图和可配置分类可在此稳定色序列中轮换；不得在业务页面自建颜色池。 */
export const STORE_CATEGORY_TONES = ["primary", "overtime", "kitchen", "allowance", "danger", "front"] as const satisfies readonly StoreVisualTone[];

export function storeCategoryColor(colors: StoreVisualColors, index: number): string {
  return storeTone(colors, STORE_CATEGORY_TONES[index % STORE_CATEGORY_TONES.length]);
}

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
  color: "蓝=当前主操作/前厅，绿=完成/后厨，琥珀=加班或待处理，紫=补贴关联，红=真实异常，灰=辅助或无数据。重要状态必须同时提供文字或图标。",
  icon: "分类标题使用14pt图标且每组仅一次；工具栏使用16pt轮廓图标；行内详情最多12pt；常规页面不得出现超过18pt的装饰图标。",
  type: "正文使用400/500，名称与关键金额最多600；日常标题、金额、台账行禁止700/800/900。",
  density: "iPhone仅展示3个关键指标并通过展开查看详情；iPad和Mac展示5个指标；Mac内容最大宽度1240pt且不放大手机卡片。",
  controls: "二级页签为40pt纯文本栏；上下文操作为36pt；底部导航和页面内容不允许被绝对定位操作遮挡。",
} as const;

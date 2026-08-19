export const NUMERIC_TONE = {
  /** 普通金额、数量、时长：依靠标签和正负号表达含义，不额外着色。 */
  value: "value",
  /** 本页唯一需要优先阅读的最终结果，例如实发、待发、综合小计；用字重层级而非品牌色。 */
  primary: "primary",
  /** 需要用户处理的实际损失、异常或风险；常规扣款不属于该类别。 */
  negative: "negative",
  /** 空值、说明、公司承担项或其他弱化数字。 */
  muted: "muted",
} as const;

export type NumericTone = (typeof NUMERIC_TONE)[keyof typeof NUMERIC_TONE];

type NumericThemeColors = {
  foreground: string;
  primary: string;
  error: string;
  muted: string;
};

/**
 * 数字颜色唯一解析器。
 * 图表线条、分类标签和操作按钮可以使用自己的类别色，但报表中的数值文本必须使用本函数。
 */
export function numericColor(colors: NumericThemeColors, tone: NumericTone = NUMERIC_TONE.value): string {
  switch (tone) {
    case NUMERIC_TONE.primary:
      return colors.foreground;
    case NUMERIC_TONE.negative:
      return colors.error;
    case NUMERIC_TONE.muted:
      return colors.muted;
    default:
      return colors.foreground;
  }
}

/** 供代码审查和文档引用的简短、稳定使用规则。 */
export const NUMERIC_COLOR_RULES = {
  [NUMERIC_TONE.value]: "普通金额、数量、时长和常规扣款使用正文色；正负号表达方向。",
  [NUMERIC_TONE.primary]: "每个聚合区最多突出一个最终结果，使用正文深色和字重，不使用品牌蓝。",
  [NUMERIC_TONE.negative]: "仅限真实损失、异常、逾期或需要处理的风险。",
  [NUMERIC_TONE.muted]: "空值、参考值、公司承担项和次要上下文。",
} as const;

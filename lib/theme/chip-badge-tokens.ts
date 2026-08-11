import type { ViewStyle, TextStyle } from "react-native";

/**
 * 标签与数量徽标的布局 Token。
 * 目标：文字和数字均完整可读；空间不足由父级横向滚动或 Chip 自身换行处理，绝不相互覆盖。
 */
export const CHIP_BADGE_LAYOUT = {
  /** 位于 horizontal ScrollView 内的筛选 Chip：不可被 flex 压缩。 */
  scrollChip: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    minHeight: 36,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
  } satisfies ViewStyle,

  /** ScrollView 内的筛选文字：由 Chip 的内容宽度决定，不能被人数徽标压缩。 */
  scrollLabel: {
    flexShrink: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  } satisfies TextStyle,

  /** 与筛选文字同列的计数徽标；不固定宽度，允许 1、99 或 99+ 自适应。 */
  countBadge: {
    flexShrink: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    marginLeft: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  } satisfies ViewStyle,

  /** 内容可能较长、应参与 flexWrap 的信息标签。 */
  wrapChip: {
    flexShrink: 1,
    maxWidth: "100%",
    alignSelf: "flex-start",
  } satisfies ViewStyle,

  /** 信息标签最多两行；不能用单行省略号掩盖配方/变更等业务信息。 */
  wrapLabel: {
    flexShrink: 1,
    lineHeight: 15,
  } satisfies TextStyle,
} as const;

/** 计数上限避免超大数字破坏紧凑徽标；真实数量可在详情或无障碍标签中完整提供。 */
export function formatCompactCount(count: number, max = 99): string {
  const normalized = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  return normalized > max ? `${max}+` : String(normalized);
}

export const CHIP_BADGE_RULES = {
  scroll: "可横向滚动的筛选行使用 scrollChip + scrollLabel + countBadge，子项不得被 flex 压缩。",
  wrap: "信息标签位于 flexWrap 容器时使用 wrapChip + wrapLabel，长文本最多两行而非单行裁切。",
  count: "数量徽标与文字分为独立节点；计数超过 99 显示 99+，不占用无限宽度。",
  scope: "通知角标可绝对定位，但不得与同一 Chip 的标题文字共用可压缩空间。",
} as const;

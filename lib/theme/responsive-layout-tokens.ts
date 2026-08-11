import type { TextStyle, ViewStyle } from "react-native";

/**
 * 基础交互组件的响应式布局 Token。
 * 原则：可变文本收缩，固定图标/徽标不收缩；长选项在自身容器换行；操作按钮保持可读触控面积。
 */
export const RESPONSIVE_LAYOUT = {
  /** 横排中的可变内容区，必须有 minWidth: 0 才能在 Web/Flex 中正确收缩。 */
  fluidRowContent: {
    flex: 1,
    minWidth: 0,
  } satisfies ViewStyle,

  /** 图标、徽标、关闭按钮等固定元素，不可被相邻文字压缩。 */
  fixedRowItem: {
    flexShrink: 0,
  } satisfies ViewStyle,

  /** 位于 flexWrap 中的可变选项：最长不超过父容器，允许自身内容换行。 */
  wrapOption: {
    flexShrink: 1,
    maxWidth: "100%",
    alignSelf: "flex-start",
  } satisfies ViewStyle,

  /** 有同行图标时的可变文本，防止把固定图标推出父容器。 */
  rowText: {
    flexShrink: 1,
  } satisfies TextStyle,

  /** 底部操作按钮中的文字，允许缩放而不改变按钮触控区。 */
  actionText: {
    flexShrink: 1,
    textAlign: "center",
  } satisfies TextStyle,

  /** Sheet/Modal 内容应限制于当前视口，避免长内容导致页面级横向溢出。 */
  sheetContent: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  } satisfies ViewStyle,
} as const;

export const RESPONSIVE_UI_RULES = {
  input: "TextInput 位于横排时使用 fluidRowContent；搜索图标、清除按钮等使用 fixedRowItem。",
  option: "下拉、筛选和批量编辑选项在 flexWrap 中使用 wrapOption，文本最多两行。",
  action: "底部双按钮必须使用相等 flex 宽度和 actionText；长文案可缩放但不挤出视口。",
  modal: "底部 Sheet 的内容使用 sheetContent；固定操作区位于安全区内，长选项只在内部滚动。",
} as const;

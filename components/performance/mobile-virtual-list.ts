import { Platform } from "react-native";
import {
  MOBILE_NESTABLE_DRAGGABLE_LIST_BASE_PROPS,
  MOBILE_VIRTUAL_LIST_BASE_PROPS,
} from "@/lib/performance/mobile-virtual-list-policy";

export { MOBILE_VIRTUAL_LIST_MONITORING_POLICY } from "@/lib/performance/mobile-virtual-list-policy";

/**
 * 面向中长列表的统一虚拟化默认值。
 * 可见业务列表不得自行散落重复的渲染窗口配置；特殊列表可在组件处显式覆盖。
 */
export const MOBILE_VIRTUAL_LIST_PROPS = {
  ...MOBILE_VIRTUAL_LIST_BASE_PROPS,
  // iOS 的裁剪在复杂/动画行上可能造成内容消失；仅在 Android 开启。
  removeClippedSubviews: Platform.OS === "android",
} as const;

/** 可拖拽嵌套列表的专用自动滚动参数。 */
export const MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS = {
  ...MOBILE_NESTABLE_DRAGGABLE_LIST_BASE_PROPS,
  // iOS 的裁剪在复杂/动画行上可能造成内容消失；仅在 Android 开启。
  removeClippedSubviews: Platform.OS === "android",
} as const;

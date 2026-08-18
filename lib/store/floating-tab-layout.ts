export const FLOATING_TAB_BODY_HEIGHT = 57;
export const FLOATING_TAB_BOTTOM_GAP = 8;
export const FLOATING_TAB_CONTENT_BREATHING_ROOM = 16;

/** 浮岛导航顶部到屏幕底部的距离。 */
export function tabBarTopInset(insetsBottom: number, isWeb = false): number {
  const bottomPad = isWeb ? 12 : Math.max(insetsBottom, 8);
  return bottomPad + FLOATING_TAB_BOTTOM_GAP + FLOATING_TAB_BODY_HEIGHT;
}

/** 页面可滚动内容必须预留的底部空间，避免末行被浮岛导航遮挡。 */
export function floatingTabContentInset(insetsBottom: number, isWeb = false): number {
  return tabBarTopInset(insetsBottom, isWeb) + FLOATING_TAB_CONTENT_BREATHING_ROOM;
}

/** 多选操作栏悬浮在导航上方，但低于内容安全边界。 */
export function floatingTabBulkBarInset(insetsBottom: number, isWeb = false): number {
  return tabBarTopInset(insetsBottom, isWeb) + 10;
}

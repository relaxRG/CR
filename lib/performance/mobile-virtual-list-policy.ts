/**
 * 与运行环境无关的移动端虚拟列表基线，可由 Node/Vitest 和客户端组件共同复用。
 */
export const MOBILE_VIRTUAL_LIST_BASE_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 12,
  windowSize: 7,
  updateCellsBatchingPeriod: 40,
} as const;

export const MOBILE_NESTABLE_DRAGGABLE_LIST_BASE_PROPS = {
  ...MOBILE_VIRTUAL_LIST_BASE_PROPS,
  autoscrollThreshold: 80,
  autoscrollSpeed: 120,
} as const;

export const MOBILE_VIRTUAL_LIST_MONITORING_POLICY = {
  fixtureSize: 120,
  mobileViewports: [320, 375, 430] as const,
  frameSampleCount: 24,
  maxFrameGapMs: 100,
} as const;

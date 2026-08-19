/** @type {const} */
/**
 * 颜色系统完全对标 Manus app 设计风格
 * 浅色模式：Ant Design Mobile 风格
 * 深色模式：Manus dark 风格
 */
const themeColors = {
  primary:    { light: '#1677FF', dark: '#4096FF' },
  background: { light: '#F7F7F7', dark: '#141414' },
  surface:    { light: '#FFFFFF', dark: '#1F1F1F' },
  foreground: { light: '#1A1A1A', dark: '#FFFFFFD9' },
  muted:      { light: '#8C8C8C', dark: '#FFFFFF73' },
  border:     { light: '#EBEBEB', dark: '#303030' },
  success:    { light: '#52C41A', dark: '#49AA19' },
  warning:    { light: '#FA8C16', dark: '#D87A16' },
  error:      { light: '#FF4D4F', dark: '#DC4446' },
  aiAccent:   { light: '#722ED1', dark: '#9254DE' },
  // 分类色仅用于图表、分类图标、色点和图例；不替代 success / warning / error 状态色。
  categoryTeal:   { light: '#0F766E', dark: '#2DD4BF' },
  categoryCyan:   { light: '#0E7490', dark: '#22D3EE' },
  categoryIndigo: { light: '#4F46E5', dark: '#818CF8' },
  categoryPink:   { light: '#BE185D', dark: '#F472B6' },
  categoryMint:   { light: '#047857', dark: '#34D399' },
  categoryAmber:  { light: '#B45309', dark: '#FBBF24' },
  categoryCoral:  { light: '#C2410C', dark: '#FB923C' },
};

module.exports = { themeColors };

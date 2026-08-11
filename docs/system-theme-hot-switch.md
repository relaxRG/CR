# 系统深浅色模式动态监听与热切换方案

**状态：** 已实现  
**核心实现：** `lib/theme-provider.tsx`、`lib/theme/theme-preference.ts`

## 问题根因

旧主题根在应用配色时调用会强制指定全局外观的原生 API。该调用把原本应由系统提供的 Appearance 来源固定为当前颜色；系统后续切换深色或浅色时，主题 Hook 与监听器可能继续收到被覆盖的旧值。因此 App 需要退出/重启后才能重新读取系统外观。

## 新模型

主题状态被拆分为“偏好”和“有效主题”：

| 字段 | 值 | 含义 |
|---|---|---|
| `themePreference` | `system` / `light` / `dark` | 用户选择。默认 `system`。 |
| `observedSystemScheme` | `light` / `dark` | 系统当前实际外观，由原生 Appearance 与 Web media query 监听。 |
| `colorScheme` | `light` / `dark` | 唯一有效主题；由偏好与系统外观解析得到。 |

```text
preference = system → colorScheme = observedSystemScheme
preference = light  → colorScheme = light
preference = dark   → colorScheme = dark
```

手动选择只在当前 Provider 运行期覆盖，不再改写系统 Appearance。调用 `followSystemTheme()` 后，立即读取当前系统外观并持续跟随。

## 监听链路

| 平台 | 监听机制 | 目的 |
|---|---|---|
| iOS / Android | `Appearance.addChangeListener` | 系统切换深浅色时即时更新 Provider 状态。 |
| H5 / 浏览器 | `window.matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件 | 覆盖部分 react-native-web 环境中 Appearance 事件不完整的情况。 |
| React 兜底 | `useColorScheme()` | Provider 重新渲染时同步原生系统值。 |

收到变化后仅更新 `observedSystemScheme`；有效主题变化由 React 推导，随后统一更新 NativeWind、DOM `data-theme`、`dark` class 和 CSS 变量。不会重新启动应用，也不会重建导航树。

## 调用约定

```tsx
const {
  colorScheme,
  themePreference,
  setColorScheme,
  followSystemTheme,
} = useThemeContext();

setColorScheme("dark"); // 临时手动预览/覆盖
followSystemTheme();     // 立即恢复当前系统主题，并持续跟随
```

禁止调用任何会强制设定全局系统外观的 API；应用需要改变的是自身有效主题，而不是操作系统的 Appearance 来源。

## 回归验证

| 测试 | 验证内容 |
|---|---|
| `tests/theme-system-follow.test.ts` | system/light/dark 解析、手动覆盖、恢复跟随、原生与 H5 监听存在、旧强制设色调用不回归。 |
| `tests/responsive-base-components.test.ts` | 搜索、抽屉、选择、操作按钮与浮动 Tab 的既有响应式护栏持续通过。 |
| `pnpm test:h5:theme-hot-switch` | 375pt H5 下系统媒体偏好 `light → dark → light` 不重载页面即可更新 `data-theme` 和 `dark` class，且不产生根级横向溢出。 |
| `pnpm test:h5:schedule-correction` | 主题根改造不影响现有排班、月报、报表和筛选标签多尺寸视觉回归。 |

## 发布检查

1. iOS 模拟器或真机中保持 App 前台，系统设置切换深色/浅色，检查所有已打开页面立即更新。
2. 在主题实验页选择浅色或深色后点击 **Follow system**，确认立即恢复系统当前主题。
3. 在 375pt、390pt、430pt 下验证主题切换前后根节点无横向溢出。
4. 每次改动主题根、NativeWind 配置或颜色 Token 后，必须执行完整 Vitest 和两项 H5 E2E。

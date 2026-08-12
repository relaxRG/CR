# 前端组件接入指南：主题、数值语义与移动端响应式布局

**适用范围：** Cocktail R 的 Expo / React Native / NativeWind 页面、基础组件、抽屉和报表。  
**目标：** 新页面和组件在系统深浅色模式、375pt–430pt 手机宽度、长文本和数量徽标场景下保持一致、可读且不产生根级横向溢出。

## 一、接入顺序

新组件应按以下顺序接入，不得在页面内复制主题、颜色或布局规则。

| 步骤 | 使用的模块 | 作用 |
|---|---|---|
| 1 | `useThemeContext()` / `useColors()` | 读取唯一有效主题；禁止自己读取或强制设置系统 Appearance。 |
| 2 | `numeric-color-tokens.ts` | 为金额、数量和异常值选择语义化数值颜色。 |
| 3 | `chip-badge-tokens.ts` | 为筛选标签、数量徽标和信息 Chip 选择安全布局。 |
| 4 | `responsive-layout-tokens.ts` | 为输入框、操作行、抽屉、双按钮和底部 Tab 使用收缩/固定项约束。 |
| 5 | 组件专项测试 + H5 E2E | 在最窄 375pt 下验证文字、控件和根布局。 |

## 二、主题接入

### 2.1 只读取有效主题

```tsx
import { useThemeContext } from "@/lib/theme-provider";
import { useColors } from "@/hooks/use-colors";

const { colorScheme } = useThemeContext();
const colors = useColors();
```

`colorScheme` 是应用唯一有效主题。它在默认模式下跟随系统，在手动预览模式下使用用户选择。页面、卡片、图标和动态 StyleSheet 不应另外调用系统外观 API。

### 2.2 手动预览后恢复系统跟随

```tsx
const { setColorScheme, followSystemTheme } = useThemeContext();

setColorScheme("dark");       // 仅当前运行期手动覆盖
followSystemTheme();           // 立即恢复系统当前主题并持续监听
```

禁止调用会强制设定系统 Appearance 来源的 API。主题根已分别订阅原生 `Appearance` 和 H5 `matchMedia`；组件只需要消费上下文，不应自行注册全局系统主题监听器。

## 三、数值颜色规则

从 `lib/theme/numeric-color-tokens.ts` 使用以下语义，避免将每种业务项目染成不同颜色。

| Token | 仅用于 | 不用于 |
|---|---|---|
| `value` | 普通金额、数量、工时、常规收入或扣款 | 最终主结果、异常警告。 |
| `primary` | 每个信息区唯一的最终重点值，如实发、待发、综合小计 | 每一条收入、每个统计项。 |
| `negative` | 真实损失、异常、风险或需处理事项 | 普通预支、一般扣款、状态分类。 |
| `muted` | 空值、参考值、公司承担项和次要拆分 | 需要用户处理的错误。 |

图表、时段边框、进度条和状态圆点可保留分类色；**普通数字不能依赖分类色表达含义**，应依赖文字、标签和正负号。

## 四、标签、数量徽标与筛选项

### 4.1 筛选项：横向滚动，不压缩内容

```tsx
import { CHIP_BADGE_LAYOUT, formatCompactCount } from "@/lib/theme/chip-badge-tokens";

<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={CHIP_BADGE_LAYOUT.scrollContainer}>
  <Pressable style={CHIP_BADGE_LAYOUT.scrollChip}>
    <Text style={CHIP_BADGE_LAYOUT.scrollLabel}>后厨</Text>
    <Text style={CHIP_BADGE_LAYOUT.countBadge}>{formatCompactCount(3)}</Text>
  </Pressable>
</ScrollView>
```

筛选标签必须满足：文字和数量是独立节点；二者均不可压缩；空间不足时由标签栏横向滚动。禁止固定均分宽度、绝对定位数字或把“后厨 3”拼成可被裁切的单一文本。

### 4.2 信息标签：允许两行

业务说明、变更标签或长单位名称使用 `wrapChip` 与 `wrapLabel`。它们应在自身容器内最多换两行，而不是用 `numberOfLines={1}` 隐藏关键业务信息。

数量计数统一使用 `formatCompactCount`：`0–99` 显示原值，`100+` 显示 `99+`，避免徽标无限变宽。

## 五、输入框、下拉、按钮与弹窗

从 `lib/theme/responsive-layout-tokens.ts` 使用行内收缩与固定元素的组合。

```tsx
import { RESPONSIVE_LAYOUT } from "@/lib/theme/responsive-layout-tokens";

<View style={RESPONSIVE_LAYOUT.fluidRowContent}>
  <TextInput style={RESPONSIVE_LAYOUT.rowText} />
  <Pressable style={RESPONSIVE_LAYOUT.fixedRowItem}>
    <IconSymbol name="xmark" />
  </Pressable>
</View>
```

| 控件类型 | 必须满足的约束 |
|---|---|
| 搜索/文本输入 | 输入区域 `flex: 1` 且 `minWidth: 0`；图标和清除按钮不可压缩。 |
| 单行“文字 + 控件” | 文本可收缩；按钮、开关、计数和图标固定占位。 |
| 长下拉项/单位/来源名称 | 最大宽度受父容器限制；可最多换两行。 |
| 底部双按钮 | 容器不使用固定像素宽度；按钮字体可适度缩小，文本不可静默裁切。 |
| 底部 Tab | 单项 `minWidth: 0`；文案启用字体缩放；不得因长语言文本撑开根节点。 |
| Sheet / Modal | 内容区允许纵向滚动；底部操作区固定；不可用固定高度裁掉换行内容。 |

## 六、发布前最小测试清单

每个涉及主题或基础布局的改动至少执行：

```bash
pnpm check
pnpm test
pnpm test:h5:theme-hot-switch
pnpm test:h5:schedule-correction
```

测试必须覆盖以下断言：

| 维度 | 验证方式 |
|---|---|
| 系统主题 | H5 `light → dark → light` 不刷新页面，根节点 `data-theme` 与 `dark` class 同步变化。 |
| 窄屏布局 | 375pt、390pt、430pt 根 `scrollWidth` 不大于 `clientWidth`。 |
| 标签徽标 | 长分类文字与人数徽标不重叠，均在 Chip 边界内。 |
| 输入与操作按钮 | 长输入、长选项、双按钮和底部 Tab 不挤压固定控件。 |
| 数值语义 | 主结果、异常和普通值使用正确 Token；不重新引入项目色数字。 |

## 七、Code Review 禁止项

在合并前拒绝以下模式：

```text
- 页面内强制写系统 Appearance 或复制主题监听器。
- 普通金额按部门/渠道/项目染色。
- 筛选 Chip 使用 flex: 1、固定均分宽度或绝对定位人数。
- 行内可变文本没有 minWidth: 0，导致固定按钮被挤出。
- 业务说明无条件 numberOfLines={1}。
- 只在大屏截图中验证，未覆盖 375pt。
- 为修复一个页面而绕过共享 Token，继续新增页面私有布局常量。
```

> 基础组件的目标是“信息完整优先于单行紧凑”。当内容不能同时完整显示时，筛选条件横向滚动，信息标签纵向换行，页面根节点永不横向扩张。

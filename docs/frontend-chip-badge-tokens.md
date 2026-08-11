# 前端标签与数量徽标 Design Token 规范

**版本：** 1.0  
**实现入口：** `lib/theme/chip-badge-tokens.ts`  
**适用范围：** 部门筛选、状态 Chip、数量徽标、库存分类标记、变更标签、快捷筛选及所有同时展示“文字 + 数字”的紧凑组件。

## 设计目标

标签和数量徽标必须完整、独立且可读。窄屏空间不足时，设计应选择“横向滚动”或“标签自身换行”，而不是通过压缩、重叠、绝对定位或省略号隐藏业务信息。

> 筛选条件允许横向滚动；信息说明允许最多两行；数量徽标与标题必须是独立元素，不能争夺同一段可压缩文本空间。

## Layout Token

| Token | 适用场景 | 核心约束 |
|---|---|---|
| `CHIP_BADGE_LAYOUT.scrollChip` | 位于横向 `ScrollView` 的筛选 Chip | `flexShrink: 0`；最小高度 36pt；内容宽度不被相邻 Chip 挤压。 |
| `CHIP_BADGE_LAYOUT.scrollLabel` | 上述筛选 Chip 的文字 | `flexShrink: 0`；稳定 13pt / 18pt 行高。 |
| `CHIP_BADGE_LAYOUT.countBadge` | 与文字同行的数量徽标 | 独立最小宽度 20pt、高度 20pt、左边距 6pt、不可压缩。 |
| `CHIP_BADGE_LAYOUT.wrapChip` | 位于 `flexWrap` 容器的长信息标签 | 最大宽度为父容器 100%，可收缩但不越界。 |
| `CHIP_BADGE_LAYOUT.wrapLabel` | 长信息标签文字 | 可在自身 Chip 内换行；默认最多两行。 |

## 推荐调用方式

### 筛选栏：文字与数量徽标完全分离

```tsx
import { CHIP_BADGE_LAYOUT, formatCompactCount } from "@/lib/theme/chip-badge-tokens";

<ScrollView horizontal showsHorizontalScrollIndicator={false}>
  <Pressable style={[CHIP_BADGE_LAYOUT.scrollChip, styles.filterChip]}>
    <Text numberOfLines={1} style={CHIP_BADGE_LAYOUT.scrollLabel}>后厨</Text>
    <View style={[CHIP_BADGE_LAYOUT.countBadge, styles.countBadge]}>
      <Text>{formatCompactCount(3)}</Text>
    </View>
  </Pressable>
</ScrollView>
```

### 信息标签：允许换行，不用单行裁切掩盖内容

```tsx
<View style={[CHIP_BADGE_LAYOUT.wrapChip, styles.changeChip]}>
  <Text numberOfLines={2} style={CHIP_BADGE_LAYOUT.wrapLabel}>
    用量 · 冷泡咖啡 20ml → 30ml
  </Text>
</View>
```

## 数量格式规则

`formatCompactCount(count)` 将数量限制为 `99+`；这样大量数据不会让小徽标无限扩张。真实数量应在详情页、长按提示或无障碍标签中完整提供。

| 原始数量 | 紧凑徽标 |
|---:|---|
| 0 | `0` |
| 3 | `3` |
| 99 | `99` |
| 100 | `99+` |
| 8,000 | `99+` |

## 禁止模式

| 反模式 | 问题 | 正确替代 |
|---|---|---|
| 同一行的标题和人数都可 `flexShrink` | 数字会覆盖标题或标题被裁切。 | `scrollLabel` + `countBadge`。 |
| 标签栏没有 horizontal ScrollView，却强制同一行 | 小屏会造成根级横向溢出或压缩。 | 使用横向 ScrollView；保持 Chip 不可压缩。 |
| 长变更标签使用 `numberOfLines={1}` | 业务差异被无提示地裁掉。 | `wrapChip` + `wrapLabel`，最多两行。 |
| 数量徽标用绝对定位叠在正文上 | 文字长度变化后必然碰撞。 | 使用正常 Flex 行内布局。 |
| 数量无限制直接塞进固定徽标 | `1000`、`10000` 等会破坏卡片宽度。 | 使用 `formatCompactCount`。 |

## 本次审计与修复结果

| 组件 | 风险评估 | 处理结果 |
|---|---|---|
| 员工档案部门筛选 | **高**：文字和人数徽标共用可压缩行，已出现“后厨 3”重叠。 | 改为共享 `scrollChip`、`scrollLabel`、`countBadge`；计数使用 `99+` 上限。 |
| 快捷筛选 `QuickFilterChips` | 中：横向容器存在，但 Chip 本身缺少不可压缩约束。 | 增加 `flexShrink: 0` 和最小高度，避免长分类 + 子项计数被压缩。 |
| 实验变更 `LabChangeChips` | **高**：长变更文本强制单行，窄屏会无声裁切。 | 改为 `wrapChip` + 两行文字。 |
| 库存分类卡数量徽标 | 中：长标题可能挤出固定数量徽标。 | 标题允许单行收缩；数量徽标不可收缩并保证最小高度。 |
| 角标通知（同步红点、未读数） | 低：固定尺寸且不与标题同一行竞争空间。 | 保留绝对定位；不用于正文计数。 |

## 代码审查清单

1. 是否存在“文字 + 数量徽标”同一行但两个元素都可压缩的情况。
2. 筛选行是否在空间不足时使用横向滚动，而非压缩所有标签。
3. 业务信息标签是否不恰当地使用单行省略号。
4. 大于 99 的计数是否走 `formatCompactCount`。
5. 是否为 `375pt`、`390pt`、`430pt` 至少覆盖一个真实长标签/多数字徽标夹具。
6. 绝对定位的徽标是否只用于图标通知，而不是文字同行的业务数量。

## 自动化护栏

`tests/employee-filter-chip-layout.test.ts` 验证员工部门筛选的结构约束；`scripts/h5-schedule-correction-e2e.mjs` 使用“后厨 3”真实夹具，在 375/390/430pt 下验证文字与徽标不重叠、都落在 Chip 边界内、页面无根级横向溢出。新标签组件应在对应测试中增加至少一项结构或 H5 回归断言。

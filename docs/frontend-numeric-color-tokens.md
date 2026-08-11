# 前端数字颜色 Design Token 规范

**版本：** 1.0  
**适用范围：** 薪资、考勤、月报、经营分析、绩效、库存成本及后续所有包含金额、数量、时长或比例的界面。  
**实现入口：** `lib/theme/numeric-color-tokens.ts`

## 设计目标

数字本身不应同时承担类别、状态、操作和趋势四种视觉含义。报表页面中的常规数值统一使用正文色；标签、图表线条、图例和状态图标承担分类识别；颜色仅留给用户需要优先处理或优先阅读的信息。

> 颜色表达“优先级与异常”，正负号、标签和单位表达“业务方向与类别”。

## 四个数字 Token

| Token | 解析为主题色 | 用途 | 示例 |
|---|---|---|---|
| `NUMERIC_TONE.value` | `colors.foreground` | 普通金额、数量、工时、常规扣款与常规正向项目。 | 餐补、绩效、社保代扣、总营业额。 |
| `NUMERIC_TONE.primary` | `colors.primary` | 每个聚合区域最多一个最终重点值。 | 实发薪资、待发、综合小计、月度营业额。 |
| `NUMERIC_TONE.negative` | `colors.error` | 实际损失、异常、逾期、风险或必须处理的问题。 | 负向奖惩、特殊扣薪、亏损、超支。 |
| `NUMERIC_TONE.muted` | `colors.muted` | 空值、参考值、公司承担项、弱化上下文。 | `—`、公司社保、支付渠道拆分。 |

## 使用方式

```tsx
import { numericColor, NUMERIC_TONE } from "@/lib/theme/numeric-color-tokens";

// 普通金额
<Text style={{ color: numericColor(colors) }}>¥{formatMoney(amount)}</Text>

// 区块主结果
<Text style={{ color: numericColor(colors, NUMERIC_TONE.primary) }}>
  ¥{formatMoney(finalSalary)}
</Text>

// 真实异常
<Text style={{ color: numericColor(colors, NUMERIC_TONE.negative) }}>
  -¥{formatMoney(exceptionDeduction)}
</Text>
```

## 禁止用法

| 反模式 | 原因 | 替代方案 |
|---|---|---|
| 普通收入、补贴、绩效全部标绿 | 绿色失去“成功/正常”的注意力价值，造成数字噪声。 | 使用 `value`；在规则命中处保留绿色圆点或状态标签。 |
| 已预支、社保、公积金、个税全部标红 | 常规扣款不等同于异常或错误。 | 使用 `value` 并保留 `-` 号。 |
| 按部门/支付渠道为每个金额使用不同颜色 | 用户在读颜色而不是读数值，移动端更易拥挤。 | 数字使用 `muted` 或 `value`；分类由标签、图例、色条或图标表达。 |
| 一个卡片中多个蓝色主金额 | 无法识别真正结论。 | 每个卡片最多使用一个 `primary` 数字。 |
| 用颜色替代正负号 | 色觉差异和暗色模式下信息会丢失。 | 金额始终保留 `+` 或 `-`。 |

## 图表与类别色的例外

图表的柱、线、色块、圆点和图例可以使用业务类别色，例如午餐/晚餐时段、支付渠道或部门。但是，紧邻图表的数值文本默认仍使用 `value`。如果数值本身代表风险等级，才使用 `negative`；如果是唯一结论，使用 `primary`。

## 页面落地矩阵

| 页面 | 已统一规则 | 分类色保留位置 |
|---|---|---|
| 薪资统计 | 普通收入、扣款、调休余额使用 `value`；总工资/综合结果使用 `primary`。 | 部门标签、操作按钮。 |
| 考勤概况 | 绩效、补贴、调休兑换、预支使用 `value`；待发使用 `primary`；缺勤/扣薪使用 `negative`。 | 状态标签和交互按钮。 |
| 绩效汇总 | 工作/业绩绩效与补贴使用 `value`；总绩效补贴使用 `primary`。 | 达标圆点、已选档位状态 Chip。 |
| 时段成本分析 | 营业额数字使用 `value`。 | 时段左边框、热力条和图例。 |
| 月度经营报告 | 支付渠道拆分金额使用 `muted`。 | 环形图、趋势箭头、预警图标。 |

## Code Review 检查清单

新增或修改数字 UI 时，审查者应确认：

1. 该数字是否真的需要颜色，而不是正文色。
2. 一个聚合区是否只存在一个 `primary` 主结果。
3. 红色是否表示真实异常，而非普通扣款。
4. 分类是否已由文字、图标或图表色表达，从而避免对数字重复着色。
5. 正负号、单位和标签是否完整，不依赖颜色传达业务含义。
6. 375pt 宽度下，颜色调整后是否仍保留数值可读性和 `numberOfLines` 保护。

## 自动化护栏

`tests/numeric-color-tokens.test.ts` 验证 Token 解析及成本分析、绩效汇总、月度经营报告的关键约束；`tests/payroll-number-color-hierarchy.test.ts` 验证薪资统计与考勤概况不回退为多颜色金额展示。新增核心报表页时应至少补充一条对应页面断言。

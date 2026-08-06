# 补贴计算 Bug 分析与开发规范报告

## 一、Bug 根因分析

本次修复的核心 Bug（日补贴未乘出勤天数，且取消绩效后残留）是由**计算逻辑分散（Single Source of Truth 缺失）**引起的。

### 1. 日补贴计算错误
- **现象**：日补贴 ¥15/天，出勤 27 天，UI 仅显示 ¥15，且存入薪资单的金额也是 ¥15。
- **原因**：在 `lib/labor/store.tsx` 中，核心计算引擎 `buildPaySlipDraft` 已经正确调用了 `calcAllowance(rule, attendanceDays)` 来计算金额。然而，`labor-kpi-allowance.tsx` 页面在渲染 UI 和处理状态更新时，**自己重新实现了一套局部的补贴求和逻辑**，直接使用了 `rule.amount`（单价）累加，完全忽略了出勤天数。

### 2. 取消补贴后残留
- **现象**：在绩效补贴页取消了某项补贴（勾选去掉），但合计金额仍有残留。
- **原因**：`toggleAllowance` 函数中，局部变量 `newAllowanceTotal` 的计算逻辑错误（未乘出勤天数），导致即时写入状态时金额不匹配。

## 二、受影响关联逻辑审查

通过全局扫描 `calcAllowance`、`rule.amount` 和相关补贴字段（`mealAllowance`, `transportAllowance` 等）：

| 模块 | 审查结果 | 处理方式 |
|------|----------|----------|
| `labor-attendance.tsx` | 正确从 `PaySlip` 字段读取已计算结果 | 无需修改 |
| `export.ts` | 正确从 `PaySlip` 字段读取已计算结果 | 无需修改 |
| `labor-employee-form.tsx` | 显示 `rule.amount`，此处为配置页，显示单价正确 | 无需修改 |
| `labor-kpi-allowance.tsx` | 局部计算错误 | **已修复**，删除局部计算，改用 `calcAllowance` 和 `buildPaySlipDraft` |

## 三、测试与性能验证

- **单元测试**：新增 `tests/allowance-calc.test.ts`，包含 36 个测试用例，覆盖了所有补贴类型、边界值（0天/31天）、季度/年度模式及混合合计计算。
- **集成测试**：153 个全量测试（包含性能与并发测试）全部通过。
- **性能评估**：修复后去除了冗余的局部计算引擎，直接复用核心引擎，消除了状态不同步的隐患，不会造成任何移动端卡顿。

## 四、开发规范建议

为了避免类似 Bug 再次发生，提出以下三条核心开发规范：

1. **坚持单一数据源（Single Source of Truth）**
   任何涉及金额、工时等业务指标的计算，**必须**收敛到 `lib/` 下的核心引擎（如 `buildPaySlipDraft`）。UI 层（`.tsx` 页面）严禁私自编写 `.reduce()` 累加逻辑或局部计算引擎。
2. **计算函数必须保持纯粹（Pure Function）**
   像 `calcAllowance` 这样的计算函数，必须是输入输出确定的纯函数。UI 层如果需要实时展示，应直接调用该纯函数（如本次修复中的 `calcAllowance(rule, attendanceDays)`），而不是自己读取原始配置重算。
3. **即时写入必须全量重算**
   当用户在 UI 触发状态变更（如 `toggleAllowance`）时，只应将**选择状态**（如 `allowanceOverrides`）写入 Store，随后立即调用核心引擎 `buildPaySlipDraft` 重新生成整个薪资单。严禁在 UI 层尝试计算「增量金额」（如旧代码中的 `newAllowanceTotal`）。

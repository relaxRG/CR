# 薪资计算引擎 Bug 分析与重构报告

## 一、 Bug 现象与根源分析

在员工档案中关闭了「社保/公积金」开关后，薪资单（`PaySlip`）中仍然计算并扣除了社保和公积金费用。经过全面排查，该问题由**两个相互叠加的 Bug** 以及**三处分散的局部计算引擎**共同导致。

### 1. 开关判断逻辑错误（逻辑漏洞）
在 `buildPaySlipDraft` 引擎中，旧的开关判断逻辑使用了错误的 `||` 运算符：
```typescript
// 旧逻辑（错误）
const siEnabled = (siConfig?.enabled) || (globalSettings?.socialInsuranceEnabled ?? false);
```
**问题**：只要「全局社保开关」为 `true`，即使员工个人档案中单独关闭了社保（`siConfig.enabled = false`），由于 `||` 的短路特性，最终的 `siEnabled` 依然会返回 `true`，导致强制计算。

**修复**：改为严格的 `&&` 判断，即「员工个人开关开启」且「全局开关未强制关闭」时才生效：
```typescript
// 新逻辑（正确）
const siEnabled = siConfig?.enabled === true && globalSettings?.socialInsuranceEnabled !== false;
```
*（注：个税 `incomeTaxEnabled` 也存在完全相同的 Bug，已同步修复）*

### 2. 历史数据污染（状态继承漏洞）
在开关关闭时，旧逻辑未能清零相关字段，而是错误地继承了历史数据：
```typescript
// 旧逻辑（错误）：开关关闭时，仍从 existing 继承上个月或上次保存的扣除额
let socialInsuranceDeduction = existing?.socialInsuranceDeduction ?? 0;
```
**问题**：如果员工上个月开启了社保（产生了扣款），这个月关闭社保后，系统跳过了计算逻辑，但保留了 `existing` 中的旧值，导致关闭后仍显示扣款。

**修复**：所有扣除字段在初始化时强制为 `0`，只有在开关开启时才重新计算并覆盖，彻底阻断历史数据污染。

### 3. 分散的局部计算引擎（架构缺陷）
在 `labor-kpi-allowance.tsx`（绩效补贴页）和 `labor-attendance.tsx`（薪资总览页）中，发现了两处绕过核心引擎 `buildPaySlipDraft` 的「局部计算逻辑」。

**问题**：
- 绩效补贴页自定义了一个 `calcPaySlipUpdate` 函数，直接读取 `existing.socialInsuranceDeduction`，导致其无法感知社保开关的变化。
- 薪资总览页在保存奖惩时，使用了 `rewardDiff` 直接加减 `finalSalary` 的「增量计算模式」，完全跳过了社保和个税的重新计算。

**修复**：彻底删除所有局部计算引擎，统一调用 `buildPaySlipDraft` 进行全量重新计算。

---

## 二、 受影响的关联逻辑与重构清单

本次重构删除了所有冲突的旧代码和废弃引擎，统一了薪资计算的唯一入口。

| 文件路径 | 删除的旧逻辑/废弃代码 | 重构后的新逻辑 |
| --- | --- | --- |
| `lib/labor/types.ts` | 删除废弃函数 `calcFinalSalary` | 该函数从未被调用，完全废弃，已删除。 |
| `lib/labor/store.tsx` | 删除 `import` 中的废弃函数引用 | 修复 `siEnabled` 和 `taxEnabled` 判断逻辑；修复历史数据污染。 |
| `app/labor-kpi-allowance.tsx` | 删除局部的 `calcPaySlipUpdate` 引擎 | 引入 `buildPaySlipDraft`，所有补贴和绩效的变更先写入 `patch`，再交由核心引擎全量重算。 |
| `app/labor-attendance.tsx` | 删除 `saveRewards` 中的增量计算模式 | 在 `EmployeeCard` 内部直接调用 Store Hooks 获取引擎，奖惩变更后强制全量重算。 |

---

## 三、 开发规范建议

为了避免未来再次出现类似的逻辑遗漏和数据污染，建议在后续开发中严格遵守以下规范：

### 规范 1：单一事实来源（Single Source of Truth）
**严禁在 UI 层或子页面中编写局部的计算逻辑**。所有涉及金额、薪资、库存等核心数据的计算，必须统一收敛到 `store.tsx` 或 `types.ts` 中的核心引擎（如 `buildPaySlipDraft`）。任何变更（哪怕只是增加 10 块钱奖金）都必须将新参数传入核心引擎进行全量重算，**绝对禁止使用增量加减（`A = A + diff`）**，因为增量计算会破坏社保、个税等依赖总额的阶梯计算。

### 规范 2：防御性状态重置（Defensive State Reset）
在处理涉及「开关（Toggle）」的逻辑时，**关闭状态必须显式清零所有相关字段**，绝不能依赖 `undefined` 或直接跳过赋值。
- 错误示范：`if (enabled) { value = calc(); }` （如果原本有值，关闭后值会残留）
- 正确示范：`let value = 0; if (enabled) { value = calc(); }`

### 规范 3：严格的布尔逻辑（Strict Boolean Logic）
在处理多级配置（如：全局配置 + 个人配置覆盖）时，慎用 `||` 和 `??` 的组合。
如果业务逻辑是「个人开启才算开启，但全局可以一键强关」，应写为：
`personal === true && global !== false`
这比 `personal || global` 更安全，能避免全局开关意外覆盖个人关闭意愿的问题。

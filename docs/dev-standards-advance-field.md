# 开发规范：预支字段处理标准

> 版本：v1.0 | 生效日期：2026-08-11 | 适用范围：cocktail-r 薪资模块

---

## 一、Bug 根因分析

### 问题描述

`labor-attendance.tsx`（薪资总览/编辑薪资页）中 `advanceTotal` 的计算缺少月份约束：

```ts
// ❌ 旧代码（Bug）：无 month 过滤，累加所有月份的预支
const advanceTotal = useMemo(() =>
  advances.filter((a) => a.employeeId === employee.id
    && (a.status === "pending" || a.status === "deducted"))
  .reduce((sum, a) => sum + a.amount, 0),
  [advances, employee.id]
);
```

同时，「已预支」字段在不同页面使用了三个不同名称（`已预支` / `预支小计` / `预支`），且含义不一致（有的含备用金，有的不含）。

### 根因分类

| 根因 | 说明 |
|------|------|
| **数据作用域缺失** | 从全局数组实时过滤时，未加月份约束，导致跨月数据污染 |
| **命名不统一** | 同一业务概念在不同页面使用不同标签，维护者难以判断含义 |
| **快照字段不完整** | `frozenSnapshot` 仅记录 `advanceAmount`，未记录 `pettyLaborPaid`，导致差额对比不准确 |
| **展示逻辑分散** | `advanceAmount` 和 `pettyLaborPaid` 在部分页面分开展示，在部分页面合并展示，不一致 |

---

## 二、修复方案

### 2.1 统一「已预支」的含义和来源

**规则**：所有页面中「已预支」= `advanceAmount + pettyLaborPaid`（手动预支 + 备用金已付合计）

```ts
// ✅ 正确：合并展示
const totalAdvance = (slip?.advanceAmount ?? 0) + (slip?.pettyLaborPaid ?? 0);
```

### 2.2 从 advances 数组实时过滤时必须加 month 约束

```ts
// ✅ 正确：有 month 过滤
const advanceTotal = advances
  .filter((a) =>
    a.employeeId === employee.id &&
    (a.deductMonth === month || a.date?.startsWith(month)) &&
    (a.status === "pending" || a.status === "deducted")
  )
  .reduce((sum, a) => sum + a.amount, 0);
```

### 2.3 两种数据来源的选择规则

| 场景 | 推荐来源 | 原因 |
|------|----------|------|
| 展示已确认的预支金额 | `slip.advanceAmount`（读 PaySlip） | 由引擎写入，已有 month 过滤，稳定 |
| 实时计算当月预支合计 | `advances.filter(...)` + month 约束 | 需要实时反映未确认的预支记录 |
| 传给 `buildPaySlipDraft` | 从 advances 重算（有 month 过滤） | 确保计算基准与引擎一致 |

---

## 三、开发规范

### 规范 1：数据聚合必须明确作用域

> **凡是从全局数组（`advances`、`paySlips`、`links` 等）过滤聚合时，必须在 filter 条件中明确 `month` 或 `employeeId` 等作用域约束。**

```ts
// ❌ 禁止：无作用域约束
advances.filter((a) => a.status === "pending").reduce(...)

// ✅ 必须：明确 month + employeeId
advances.filter((a) =>
  a.employeeId === empId &&
  (a.deductMonth === month || a.date.startsWith(month)) &&
  a.status === "pending"
).reduce(...)
```

### 规范 2：UI 标签与业务含义必须一一对应

> **同一业务概念在所有页面使用同一标签。新增 UI 标签前，先查阅本文档确认是否已有规范标签。**

| 业务概念 | 规范标签 | 含义 |
|----------|----------|------|
| 手动预支 + 备用金已付合计 | **已预支** | `advanceAmount + pettyLaborPaid` |
| 月度实发合计（全员） | **已预支** | `sum(pettyLaborPaid + advanceAmount)` |
| 年度预支合计 | **已预支** | `totalAdvance + totalPettyPaid` |

### 规范 3：可选字段读取必须有 `?? 0` 兜底

> **所有 `?: number` 类型的字段在参与计算时，必须使用 `?? 0` 兜底，防止旧版数据中字段缺失导致 `NaN`。**

```ts
// ✅ 正确
const total = (slip?.advanceAmount ?? 0) + (slip?.pettyLaborPaid ?? 0);

// ❌ 禁止
const total = slip.advanceAmount + slip.pettyLaborPaid; // 可能 NaN
```

### 规范 4：快照字段必须完整记录所有参与 finalSalary 计算的字段

> **`frozenSnapshot` 必须包含所有影响 `finalSalary` 的字段，以支持准确的差额对比。**

```ts
// finalSalary = grossSalary - SI - HF - tax - advanceAmount - pettyLaborPaid
// 因此 frozenSnapshot 必须同时包含 advanceAmount 和 pettyLaborPaid
```

### 规范 5：UI 金额文本必须使用 `formatMoney` + 防截断属性

> **所有金额文本必须使用 `formatMoney()` 格式化，固定宽度容器中必须加 `numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}`。**

```tsx
// ✅ 正确（固定宽度容器）
<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
  {`-¥${formatMoney(amount)}`}
</Text>

// ❌ 禁止（直接插值，无千分位，无防截断）
<Text>{`-¥${amount}`}</Text>
```

---

## 四、受影响的文件清单

| 文件 | 修改内容 |
|------|----------|
| `app/labor.tsx` | OverviewCard「已发」→「已预支」；扣款区「预支小计」→「已预支」 |
| `app/labor-attendance.tsx` | advanceTotal 加 month 过滤；「预支小计」+「备用金已付」合并为「已预支」 |
| `app/monthly-summary.tsx` | 「预支」→「已预支」；三列金额加 adjustsFontSizeToFit |
| `app/labor-salary-history.tsx` | 「预支扣除」+「备用金已付」合并为「已预支」 |
| `lib/labor/export.ts` | Excel/HTML 报表列标题「预支」→「已预支」 |
| `lib/labor/payroll-confirmation.ts` | 差异标签「预支」→「已预支」；frozenSnapshot 加 pettyLaborPaid |
| `lib/labor/types.ts` | frozenSnapshot 加 pettyLaborPaid 字段 |
| `lib/store/petty-labor-link-store.tsx` | extractKeywords 单字符修复；matchEmployeeFromDescription 策略修正 |

---

## 五、测试覆盖要求

新增或修改预支相关逻辑时，必须同时更新以下测试文件：

- `tests/petty-labor-match.test.ts`：匹配逻辑（Suite P1-P4，39 用例）
- `tests/advance-petty-display.test.ts`：预支展示逻辑

**测试用例必须覆盖**：
1. 有 month 过滤的正确场景
2. 跨月数据不被纳入的边界场景
3. 旧版数据（`pettyLaborPaid = undefined`）的兼容场景
4. 单字符中文员工名的匹配场景

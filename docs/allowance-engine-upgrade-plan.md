# 补贴引擎升级方案

## 一、当前问题深度分析

### 1.1 表面现象

子豪（王琪）的餐补规则为 `per_day`（¥15/天），7月出勤27天：
- 绩效补贴页面正确显示：¥405（15×27）
- 薪资卡片错误显示：¥15（补贴合计）

### 1.2 底层架构缺陷

当前补贴引擎存在 **3 层设计缺陷**，不是单一 Bug 而是架构问题：

| 层面 | 缺陷 | 后果 |
|------|------|------|
| **计算时机** | 补贴在 `buildPaySlipDraft` 中计算，依赖传入的 `attendance` 参数 | 如果 attendance 不是最新的，补贴金额就是错的 |
| **数据流向** | 补贴金额被"快照"写入 `slip.mealAllowance`，后续不再随出勤变化 | 出勤天数增加后，旧快照不会自动更新 |
| **覆盖机制** | `isOverride` 设计为"锁定手动值"，但对动态补贴（per_day）语义错误 | 一旦被标记为 override，永远使用旧值 |

### 1.3 根本原因：违反"声明式计算"原则

专业薪资系统（如 Workday、SAP SuccessFactors、钉钉薪酬）的核心设计原则是：

> **补贴金额 = f(规则, 当月出勤) — 每次查询时实时计算，不缓存中间结果。**

当前代码的问题是将补贴金额作为**快照**存储在 `PaySlip` 中，而非每次展示时实时从规则和出勤数据派生。这导致：

1. 出勤数据变化后，补贴快照不自动更新
2. 多个入口（autoSync、绩效补贴页面、编辑薪资）各自计算，时序不同导致结果不同
3. `isOverride` 机制试图解决"手动覆盖"需求，但与"动态计算"冲突

---

## 二、专业薪资系统设计参考

### 2.1 三层计算架构（Workday/SAP 模式）

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 规则层 (Rule Layer)                                │
│  - 补贴规则定义（类型、金额、单位、条件）                       │
│  - 不存储计算结果，只存储规则参数                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: 计算层 (Calculation Layer)                          │
│  - 纯函数：f(rule, attendanceDays, month) → amount            │
│  - 每次调用都重新计算，不依赖缓存                               │
│  - 区分"自动计算"和"手动锁定"两种模式                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: 快照层 (Snapshot Layer)                             │
│  - 仅在"确认发薪"时生成不可变快照                               │
│  - 日常展示使用实时计算值，不使用快照                            │
│  - 快照用于历史审计，不用于当月展示                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

| 原则 | 说明 | 当前代码违反情况 |
|------|------|-----------------|
| **实时派生** | 当月补贴金额始终从规则+出勤实时计算 | ❌ 使用 slip 中的快照值展示 |
| **幂等重算** | 任何时候重算结果一致（相同输入→相同输出） | ❌ isOverride 导致相同输入不同输出 |
| **单一数据源** | 补贴金额只有一个计算入口 | ❌ autoSync、handleSave、UI 各自计算 |
| **锁定语义明确** | "锁定"只用于固定金额补贴，动态补贴不可锁定 | ❌ isOverride 不区分动态/固定 |
| **延迟快照** | 快照仅在发薪确认时生成 | ❌ 每次 autoSync 都写入快照 |

---

## 三、升级方案

### 方案概述

**将补贴引擎从"快照驱动"升级为"规则驱动+实时计算"模式。**

核心改动：
1. 补贴金额不再存储在 `PaySlip` 中作为快照
2. UI 展示时实时从规则+出勤计算
3. `buildPaySlipDraft` 中的补贴计算改为"总是重算"（移除 isOverride 对动态补贴的锁定）
4. 仅对固定金额补贴保留手动覆盖能力

### 3.1 修改 `buildPaySlipDraft` — 补贴计算逻辑

```typescript
// ── 补贴自动计算（升级版）──
for (const rule of employee.allowanceRules) {
  if (!rule.enabled) continue;
  if (!shouldPayAllowanceThisMonth(rule, month)) continue;
  if (overrides && rule.id in overrides && !overrides[rule.id]) continue;
  
  // 核心改动：区分动态补贴和固定补贴
  const isDynamic = rule.unit === "per_day" || rule.type === "meal_per_day";
  const { amount: autoAmount, autoNote } = calcAllowance(rule, attendanceDays);
  
  let finalAmount: number;
  if (isDynamic) {
    // 动态补贴：始终使用最新计算值（不允许 override 锁定）
    finalAmount = autoAmount;
  } else {
    // 固定补贴：支持手动覆盖
    const existingDetail = existing?.allowanceDetails?.[rule.id];
    const isOverride = existingDetail?.isOverride ?? false;
    finalAmount = isOverride ? (existingDetail?.amount ?? autoAmount) : autoAmount;
  }
  
  allowanceDetails[rule.id] = { 
    amount: finalAmount, 
    autoNote, 
    isOverride: isDynamic ? false : (existing?.allowanceDetails?.[rule.id]?.isOverride ?? false),
    // 新增：记录计算依据，便于审计
    calcBasis: isDynamic ? { rate: rule.amount, days: attendanceDays } : undefined,
  };
  
  // 分类累加
  if (rule.type === "transport_fixed") transportAllowance += finalAmount;
  else if (isDynamic) mealAllowance += finalAmount;
  else otherAllowance += finalAmount;
}
```

### 3.2 修改 UI 展示层 — 薪资卡片补贴合计

```typescript
// 5格摘要行中的"综合额外"
// 修改前：从 slip 快照读取
const allowanceSum = slip ? (slip.mealAllowance ?? 0) + (slip.transportAllowance ?? 0) + (slip.otherAllowance ?? 0) : 0;

// 修改后：实时计算（与 buildPaySlipDraft 使用相同逻辑）
// 但由于 buildPaySlipDraft 已保证每次 autoSync 都重算，
// 只要 autoSync 正确触发，slip 中的值就是最新的。
// 所以真正的修复是确保 autoSync 的触发时机正确。
```

### 3.3 修改 autoSync 触发机制 — 确保补贴随出勤更新

当前 autoSync 依赖 `[shifts, ...]`，排班变化时会重算。但问题是：

1. **排班变化 → autoSync 触发 → calcFromShifts → 新 attendanceDays → buildPaySlipDraft → 新补贴** ✅
2. **绩效补贴页面保存 → 不触发 autoSync** ❌（但 handleSave 内部已调用 buildPaySlipDraft）

实际上 autoSync 的触发是正确的。**真正的 Bug 在于 `calcAllowance` 对 `custom_fixed + per_day` 的分类逻辑**。

### 3.4 真正的 Bug 定位（重新审视）

让我重新检查子豪的餐补规则类型。从截图看：
- 绩效补贴页面显示："餐补 · 元/天 · ¥405 (¥15/天×27天)"

这说明规则的 `unit = "per_day"`。在 `calcAllowance` 中：
- `custom_fixed + per_day` → `amount = rule.amount × attendanceDays = 15 × 27 = 405`

在 `buildPaySlipDraft` 中分类：
- `rule.type === "meal_per_day"` → mealAllowance
- `rule.type === "custom_fixed" && rule.unit === "per_day"` → mealAllowance

**如果规则的 type 不是 `meal_per_day` 也不是 `custom_fixed`，而是其他类型，就会走 `else` 分支（otherAllowance += finalAmount），且 calcAllowance 的 default case 只返回 `rule.amount`（不乘天数）！**

这就是 Bug！如果子豪的餐补规则 type 是一个不匹配的值（比如旧版创建的），calcAllowance 的 switch 会走 default 分支，返回 `rule.amount = 15`（不乘天数）。

---

## 四、最终修复方案（根本性）

### 修复 1：`calcAllowance` 统一按 `unit` 字段决定是否乘天数

```typescript
export function calcAllowance(rule: AllowanceRule, attendanceDays: number): { amount: number; autoNote: string } {
  if (!rule.enabled) return { amount: 0, autoNote: "" };
  const unit = rule.unit ?? "per_month"; // 默认按月
  
  // 核心改动：统一按 unit 字段决定计算方式，不再依赖 type
  if (unit === "per_day") {
    const total = Math.round(rule.amount * attendanceDays * 100) / 100;
    return {
      amount: total,
      autoNote: `${rule.label} ¥${rule.amount}/天 × ${attendanceDays}天 = ¥${total}`,
    };
  }
  // per_month / per_quarter / per_year：固定金额
  return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
}
```

### 修复 2：`buildPaySlipDraft` 移除动态补贴的 isOverride 锁定

```typescript
const isDynamic = (rule.unit ?? "per_month") === "per_day";
const { amount: autoAmount, autoNote } = calcAllowance(rule, attendanceDays);

// 动态补贴始终使用最新计算值
const existingDetail = existing?.allowanceDetails?.[rule.id];
const isOverride = isDynamic ? false : (existingDetail?.isOverride ?? false);
const finalAmount = isOverride ? (existingDetail?.amount ?? autoAmount) : autoAmount;
```

### 修复 3：`buildPaySlipDraft` 分类逻辑统一按 unit 判断

```typescript
// 分类：per_day 归入 mealAllowance，其他归入对应类别
if (rule.type === "transport_fixed") transportAllowance += finalAmount;
else if ((rule.unit ?? "per_month") === "per_day" || rule.type === "meal_per_day") mealAllowance += finalAmount;
else otherAllowance += finalAmount;
```

### 修复 4：添加防御性日志（开发阶段）

在 `buildPaySlipDraft` 中添加：
```typescript
if (__DEV__ && (rule.unit ?? "per_month") === "per_day" && finalAmount === rule.amount) {
  console.warn(`[Allowance] ${rule.label}: per_day 补贴未乘天数！attendanceDays=${attendanceDays}`);
}
```

---

## 五、验证标准

修复后子豪（餐补 ¥15/天，7月出勤27天）应显示：

| 位置 | 期望值 |
|------|--------|
| 绩效补贴页面 | ¥405 (¥15/天×27天) |
| 薪资卡片 · 综合额外 | +¥405 |
| 薪资卡片 · 补贴合计 | +¥405 |
| 总工资 | ¥8000 + ¥70 + ¥405 = ¥8475 |
| 导出表 · 补贴合计列 | 405 |

---

## 六、长期防护措施

1. **补贴测试用例**：新增 `per_day` 补贴随出勤天数变化的 E2E 测试
2. **calcAllowance 统一入口**：所有补贴计算必须经过此函数，禁止内联
3. **isOverride 仅用于固定补贴**：动态补贴（per_day）永远不设置 isOverride
4. **autoSync 后校验**：补贴金额与 `rule.amount × attendanceDays` 交叉验证

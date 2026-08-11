# 绩效补贴字段开发规范

> 版本：v2  更新日期：2026-08-11

---

## 一、字段语义定义（必须严格遵守）

| 字段 | 类型 | 语义 | 来源 |
|------|------|------|------|
| `performanceBonus` | `number`（必填） | 工作绩效 + 业绩绩效的**合计**，用于 grossSalary 计算 | `buildPaySlipDraft` 的 `performanceTotal` 参数 |
| `workKPIBonus` | `number?`（可选） | **仅** workKPIRules 档位合计（工作绩效小计） | `handleSave` 写入，`buildPaySlipDraft` 从 existing 保留 |
| `revenueKPIBonus` | `number?`（可选） | **仅** revenueKPIRules 阶梯合计（业绩绩效小计） | `handleSave` 写入，`buildPaySlipDraft` 从 existing 保留 |
| `salesCommission` | `number`（必填） | 营业额按比例提成（业绩提点），与绩效补贴页无关 | `buildPaySlipDraft` 从 existing 保留 |

---

## 二、展示规范

### 展示「工作绩效」时

```typescript
// ✅ 正确：优先使用分项字段，向后兼容旧数据
const workKPI = slip.workKPIBonus ?? slip.performanceBonus ?? 0;

// ❌ 错误：直接使用 performanceBonus（包含 revenueKPI 混合）
const workKPI = slip.performanceBonus ?? 0;
```

### 展示「业绩绩效」时

```typescript
// ✅ 正确：使用分项字段
const revenueKPI = slip.revenueKPIBonus ?? 0;

// ❌ 错误：使用 salesCommission（这是营业额提成，完全不同概念）
const revenueKPI = slip.salesCommission ?? 0;
```

### 展示「业绩提点」时

```typescript
// ✅ 正确：salesCommission 与「业绩提点」语义一致
const commission = slip.salesCommission ?? 0;
```

### 展示合计时

```typescript
// ✅ 正确：使用 performanceBonus 合计（已包含 workKPI + revenueKPI）
const total = (slip.performanceBonus ?? 0) + allowanceSum + (slip.rewardPenalty ?? 0);
```

---

## 三、保存规范

### handleSave 必须写入分项字段

```typescript
// ✅ 正确：Step 1 同时写入合计和分项
const patched = {
  ...existing,
  performanceBonus: performanceTotal,  // 合计（用于 grossSalary 计算）
  workKPIBonus: workKPITotal,           // 分项（用于展示）
  revenueKPIBonus: revenueKPITotal,     // 分项（用于展示）
  // ... 其他控制字段
};
```

### buildPaySlipDraft 必须保留分项字段

```typescript
// ✅ 正确：从 existing 保留分项字段，autoSync 不清除
return {
  // ...
  performanceBonus: performanceTotal,
  workKPIBonus: existing?.workKPIBonus,    // 保留
  revenueKPIBonus: existing?.revenueKPIBonus, // 保留
};
```

---

## 四、Bug 根因分析

### 本次 Bug 的完整链路

```
设计缺陷：
  performanceBonus = workKPITotal + revenueKPITotal（合计）
  但展示页需要分别显示工作绩效和业绩绩效

错误实现：
  展示页「工作绩效」→ performanceBonus（混合值，数字偏大）
  展示页「业绩绩效」→ salesCommission（完全不同的字段！）

后果：
  1. 编辑页保存后返回展示页，数字跳变（编辑页显示分项，展示页显示混合）
  2. 「业绩绩效」列始终显示营业额提成，与绩效补贴页完全无关
  3. 用户困惑：为什么保存后数字变了？
```

### 为什么反复出现

1. **字段语义未文档化**：`performanceBonus` 的混合语义没有在代码中明确说明
2. **展示页和编辑页数据来源不同**：编辑页用局部 state，展示页用 PaySlip 字段，两者不对应
3. **缺少分项字段**：`PaySlip` 类型只有合计字段，没有分项字段，导致展示时被迫使用错误字段

---

## 五、各展示位置字段使用规范

| 页面 | 位置 | 字段 | 规范 |
|------|------|------|------|
| 绩效补贴展示页 | summaryCard 工作绩效列 | `workKPIBonus ?? performanceBonus` | ✅ |
| 绩效补贴展示页 | summaryCard 业绩绩效列 | `revenueKPIBonus` | ✅ |
| 薪资统计卡片 | 展开综合额外区 工作绩效列 | `workKPIBonus ?? performanceBonus` | ✅ |
| 薪资统计卡片 | 展开综合额外区 业绩提点列 | `salesCommission` | ✅（标签一致） |
| 薪资统计卡片 | 收起5格 综合额外 | `performanceBonus + allowance + reward`（合计） | ✅ |
| 薪资总览 | 展开绩效补贴区 工作绩效行 | `workKPIBonus ?? performanceBonus` | ✅ |
| 薪资总览 | 展开绩效补贴区 综合小计 | `performanceBonus + allowances + salesCommission`（合计） | ✅ |
| 薪资总览 | 收起状态 绩效列 | `performanceBonus`（合计，收起状态合理） | ✅ |
| Excel/HTML 导出 | 绩效列 | `performanceBonus`（合计） | ✅ |

---

## 六、向后兼容策略

旧数据（`workKPIBonus` 为 `undefined`）的处理：

```typescript
// 展示时：回落到 performanceBonus（合计值，数字偏大但不会为 0）
const workKPI = slip.workKPIBonus ?? slip.performanceBonus ?? 0;

// 旧数据首次进入编辑页保存后，workKPIBonus/revenueKPIBonus 会被正确写入
```

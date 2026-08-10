# P3 改进方案：unit 必填 + calcBasis 审计字段

## 一、改进概述

| 改进项 | 目标 | 影响范围 |
|--------|------|---------|
| **unit 字段改为必填** | 消除运行时推断逻辑，新建规则必须明确指定计算单位 | 接口定义 + 表单 + 数据迁移 |
| **calcBasis 审计字段** | 记录每次补贴计算的依据（单价、天数、公式），便于追溯和调试 | allowanceDetails 结构 + buildPaySlipDraft |

---

## 二、改进 1：unit 字段改为必填

### 2.1 当前状态

```typescript
// lib/labor/types.ts
export interface AllowanceRule {
  // ...
  unit?: AllowanceUnit;  // ← 可选，旧数据可能为 undefined
}
```

运行时有 3 处推断逻辑：
- `types.ts:151` — `shouldPayAllowanceThisMonth`: `rule.unit ?? "per_month"`
- `types.ts:1356` — `calcAllowance`: `rule.unit ?? (rule.type === "meal_per_day" ? "per_day" : "per_month")`
- `store.tsx:924` — `buildPaySlipDraft`: 同上

### 2.2 修改方案

**Step 1：接口定义 — `unit` 改为必填**

```typescript
export interface AllowanceRule {
  id: string;
  type: AllowanceType;
  label: string;
  amount: number;
  unit: AllowanceUnit;  // ← 改为必填（移除 ?）
  periodMode?: AllowancePeriodMode;
  effectiveMonth?: string;
  enabled: boolean;
}
```

**Step 2：数据迁移 — 为旧规则补充 unit 字段**

在 `lib/labor/store.tsx` 的初始化/加载逻辑中添加迁移：

```typescript
// 数据迁移：为旧版 AllowanceRule 补充 unit 字段
function migrateAllowanceRules(rules: AllowanceRule[]): AllowanceRule[] {
  return rules.map(rule => {
    if (rule.unit) return rule; // 已有 unit，无需迁移
    // 推断逻辑（与 calcAllowance 一致）
    const unit: AllowanceUnit = rule.type === "meal_per_day" ? "per_day"
      : rule.type === "transport_fixed" ? "per_month"
      : "per_month";
    return { ...rule, unit };
  });
}
```

**Step 3：简化 calcAllowance — 移除推断逻辑**

```typescript
export function calcAllowance(rule: AllowanceRule, attendanceDays: number): { amount: number; autoNote: string } {
  if (!rule.enabled) return { amount: 0, autoNote: "" };

  // transport_fixed 始终固定
  if (rule.type === "transport_fixed") {
    return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
  }

  // 直接使用 rule.unit（必填，无需推断）
  if (rule.unit === "per_day") {
    const total = Math.round(rule.amount * attendanceDays * 100) / 100;
    return {
      amount: total,
      autoNote: `${rule.label} ¥${formatMoney(rule.amount)}/天 × ${attendanceDays}天 = ¥${formatMoney(total)}`,
    };
  }

  return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
}
```

**Step 4：表单创建 — 确保 unit 始终被设置（已满足）**

当前 `addAllowanceRule` 已有默认值 `preset?.unit ?? "per_month"`，无需修改。

---

## 三、改进 2：calcBasis 审计字段

### 3.1 目标

在 `allowanceDetails` 中记录每次补贴计算的完整依据，使得：
- 管理者可以追溯"这个金额是怎么算出来的"
- 调试时可以快速定位计算参数是否正确
- 导出时可以附带计算说明

### 3.2 数据结构

```typescript
// lib/labor/types.ts — PaySlip 中的 allowanceDetails 扩展
allowanceDetails?: Record<string, {
  amount: number;
  autoNote: string;
  isOverride: boolean;
  /** 审计字段：记录计算依据 */
  calcBasis?: {
    /** 计算公式类型 */
    formula: "rate_x_days" | "fixed" | "override";
    /** 单价（per_day 时有值） */
    rate?: number;
    /** 出勤天数（per_day 时有值） */
    days?: number;
    /** 计算时间戳 */
    calculatedAt: number;
  };
}>;
```

### 3.3 写入逻辑

在 `buildPaySlipDraft` 中：

```typescript
allowanceDetails[rule.id] = {
  amount: finalAmount,
  autoNote,
  isOverride,
  calcBasis: isDynamic
    ? { formula: "rate_x_days", rate: rule.amount, days: attendanceDays, calculatedAt: Date.now() }
    : isOverride
      ? { formula: "override", calculatedAt: Date.now() }
      : { formula: "fixed", calculatedAt: Date.now() },
};
```

### 3.4 展示利用（可选）

在薪资卡片展开明细中，可以显示 calcBasis 信息：
```
补贴合计 +¥405
  └ 餐补: ¥15/天 × 27天 = ¥405 (计算于 08-10 12:43)
```

---

## 四、向后兼容性

| 场景 | 处理方式 |
|------|---------|
| 旧规则无 unit 字段 | 加载时自动迁移（migrateAllowanceRules） |
| 旧 allowanceDetails 无 calcBasis | `calcBasis` 为 optional，旧数据正常读取 |
| 旧版 App 读取新数据 | `unit` 已有值不影响旧逻辑；`calcBasis` 被忽略 |

---

## 五、测试更新

1. 修改现有测试中 `makeRule` 的默认值（已有 `unit: "per_day"`）
2. 新增测试：验证 `migrateAllowanceRules` 对旧规则的补充
3. 新增测试：验证 `calcBasis` 字段正确写入
4. 确保 TypeScript 编译通过（unit 必填后所有创建处都有值）

---

## 六、实施步骤

| Step | 文件 | 改动 |
|------|------|------|
| 1 | `lib/labor/types.ts` | `unit?: AllowanceUnit` → `unit: AllowanceUnit` |
| 2 | `lib/labor/types.ts` | `allowanceDetails` 结构增加 `calcBasis` |
| 3 | `lib/labor/store.tsx` | 添加 `migrateAllowanceRules` + 在加载时调用 |
| 4 | `lib/labor/store.tsx` | `buildPaySlipDraft` 写入 `calcBasis` |
| 5 | `lib/labor/types.ts` | `calcAllowance` 移除 `??` 推断（简化） |
| 6 | `tests/allowance-calc.test.ts` | 更新测试 + 新增迁移和 calcBasis 测试 |
| 7 | TypeScript 编译检查 | 确保所有创建 AllowanceRule 处都有 unit |

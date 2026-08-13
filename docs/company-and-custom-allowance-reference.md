# 公司补贴与自定义固定补贴：配置和结算代码参考

**适用版本：** 当前 `main` 分支。

## 1. 创建入口

自定义补贴在**员工档案**创建，不在“绩效补贴”月度编辑页创建。操作路径为：

```text
门店 → 员工 → 选择员工档案 → 补贴设置 → 点击右侧 ⚙
  ├─ + 餐补（快捷预设）
  ├─ + 交通补贴（快捷预设）
  └─ + 添加自定义补贴（公司补贴、岗位补贴、通讯补贴等）
```

月度绩效补贴页只读取员工档案已经保存的规则，并允许本月启用/停用；它不修改员工档案中的规则金额，以防月度临时操作污染长期规则。

## 2. 完整规则数据结构

```ts
export type AllowanceType =
  | "transport_fixed"  // 交通补贴（固定月额）
  | "meal_per_day"     // 餐补（按实际出勤天数）
  | "custom_fixed"     // 公司补贴/岗位补贴/其他自定义固定补贴
  | "custom_formula";  // 自定义公式保留类型

export type AllowanceUnit = "per_day" | "per_month" | "per_quarter" | "per_year";

export interface AllowanceRule {
  id: string;
  type: AllowanceType;
  label: string;
  amount: number;
  unit: AllowanceUnit;
  periodMode?: "natural" | "rolling";
  effectiveMonth?: string; // YYYY-MM，仅滚动季/年周期需要
  enabled: boolean;
}
```

### 公司补贴示例

公司补贴使用 `custom_fixed`。在员工档案新增自定义补贴后，将名称改为“公司补贴”、填写金额并保存即可。

```ts
{
  id: "company_allowance",
  type: "custom_fixed",
  label: "公司补贴",
  amount: 2500,
  unit: "per_month",
  enabled: true,
}
```

按季度公司补贴可写为：

```ts
{
  id: "company_quarterly",
  type: "custom_fixed",
  label: "公司季度补贴",
  amount: 3000,
  unit: "per_quarter",
  periodMode: "natural", // 仅在3、6、9、12月发放
  enabled: true,
}
```

## 3. 员工档案预设创建代码

`lib/labor/allowance-rule-factory.ts`：

```ts
export const ALLOWANCE_PRESETS = {
  meal: { label: "餐补", type: "meal_per_day", unit: "per_day" },
  transport: { label: "交通补贴", type: "transport_fixed", unit: "per_month" },
} as const;

export function createAllowanceRule(id: string, preset?: AllowanceRulePreset): AllowanceRule {
  return {
    id,
    type: preset?.type ?? "custom_fixed",
    label: preset?.label ?? "自定义补贴",
    amount: 0,
    unit: preset?.unit ?? "per_month",
    enabled: true,
  };
}
```

`app/labor-employee-form.tsx` 的档案表单通过以下逻辑创建：

```ts
const addAllowanceRule = (preset?: AllowanceRulePreset) => {
  setAllowanceRules((prev) => [
    ...prev,
    createAllowanceRule(Date.now().toString(), preset),
  ]);
};

// 快捷按钮
[ALLOWANCE_PRESETS.meal, ALLOWANCE_PRESETS.transport]

// 自定义按钮
addAllowanceRule(); // 默认得到 custom_fixed + per_month + “自定义补贴”
```

新增规则后，表单允许修改 `label` 和 `amount`，或删除该规则；完整 `allowanceRules` 随员工档案保存。

## 4. 所有类型的发放月份逻辑

```ts
function shouldPayAllowanceThisMonth(rule, month) {
  if (rule.unit === "per_day" || rule.unit === "per_month") return true;

  if (rule.unit === "per_quarter" && rule.periodMode !== "rolling") {
    return [3, 6, 9, 12].includes(currentMonthNumber);
  }

  if (rule.unit === "per_year" && rule.periodMode !== "rolling") {
    return currentMonthNumber === 12;
  }

  // rolling：由 effectiveMonth 推算第3月或第12月
}
```

非发放月不进入结算，也不能在月度编辑页被勾选。

## 5. 结算引擎完整分发逻辑

唯一入口：`lib/labor/payroll-extras.ts` 的 `settlePayrollExtras(employee, month, attendanceDays, controls)`。

```ts
for (const rule of employee.allowanceRules ?? []) {
  if (!rule.enabled || !shouldPayAllowanceThisMonth(rule, month)) continue;
  if (rule.id in allowanceOverrides && !allowanceOverrides[rule.id]) continue;

  const isDaily = rule.unit === "per_day" || rule.type === "meal_per_day";
  const previous = priorDetails[rule.id];
  const isOverride = !isDaily && previous?.isOverride === true;
  const calculated = calcAllowance(rule, safeAttendanceDays);
  const amount = isOverride ? (previous.amount ?? calculated.amount) : calculated.amount;

  if (rule.type === "transport_fixed") transportAllowance += amount;
  else if (isDaily) mealAllowance += amount;
  else otherAllowance += amount;
}
```

### 分发矩阵与公式

| 规则类型/单位 | `calcAllowance` 公式 | 结算分项 | 零出勤 |
|---|---|---|---|
| `meal_per_day` 或 `per_day` | `amount × attendanceDays` | `mealAllowance` | 强制为0；不接受旧手工金额覆盖。 |
| `transport_fixed` | 固定 `amount` | `transportAllowance` | 不因零出勤自动清零。 |
| `custom_fixed` + `per_month` | 固定 `amount` | `otherAllowance` | 不因零出勤自动清零。 |
| `custom_fixed` + `per_quarter` | 季度发放月的固定 `amount` | `otherAllowance` | 非发放月为0。 |
| `custom_fixed` + `per_year` | 年度发放月的固定 `amount` | `otherAllowance` | 非发放月为0。 |
| `custom_formula` | 当前实现按其 `unit` 调用同一基础计算；没有独立公式解释器 | 按天进入 `mealAllowance`，否则进入 `otherAllowance` | 由单位决定。 |

底层金额函数：

```ts
function calcAllowance(rule: AllowanceRule, attendanceDays: number) {
  if (!rule.enabled) return { amount: 0, autoNote: "" };

  if (rule.type === "transport_fixed") {
    return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
  }

  if (rule.unit === "per_day") {
    const total = Math.round(rule.amount * attendanceDays * 100) / 100;
    return { amount: total, autoNote: `${rule.label} ¥${rule.amount}/天 × ${attendanceDays}天 = ¥${total}` };
  }

  return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
}
```

## 6. 保存到薪资单和总额关系

结算后的金额写入薪资单：

```ts
mealAllowance: extras.mealAllowance,
transportAllowance: extras.transportAllowance,
otherAllowance: extras.otherAllowance,
allowanceDetails: extras.allowanceDetails,
allowanceOverrides: existing?.allowanceOverrides,
```

汇总关系为：

```text
补贴合计 = mealAllowance + transportAllowance + otherAllowance
绩效补贴 = 补贴合计 + 工作绩效 + 业绩绩效
综合额外 = 绩效补贴 + 奖惩小计
应发薪资 = 考勤工资 + 综合额外 + 调休兑现
```

## 7. 月度编辑页的作用

当月编辑页会显示该员工的全部规则，包括“公司补贴”等自定义规则。月度开关写入：

```ts
allowanceOverrides: {
  meal: false,            // 本月关闭餐补
  transport: true,        // 本月启用交通补贴
  company_allowance: true // 本月启用公司补贴
}
```

固定补贴允许具有审计依据的本月金额覆盖；按天餐补不允许继承覆盖金额，必须按实际出勤重算。

## 8. 防回归测试

`tests/allowance-rule-factory.test.ts` 覆盖：

1. 餐补预设创建为 `meal_per_day + per_day`；
2. 交通补贴预设创建为 `transport_fixed + per_month`，不会误入其他补贴；
3. 餐补、交通补贴、公司补贴分别进入 `mealAllowance`、`transportAllowance`、`otherAllowance`；
4. 三项示例为 `15 × 2 + 200 + 2500 = 2730`。

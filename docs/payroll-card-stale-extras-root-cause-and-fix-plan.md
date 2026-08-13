# 瑞雪与张忠洋薪资卡不一致：逐人根因与一次性修复方案

**结论先行：** 这是两个员工的两份独立薪资数据，但它们暴露的是同一个架构断点：**绩效补贴详情页使用唯一结算引擎从控制字段实时计算；薪资卡却直接读取薪资单上可能已经过期的聚合金额字段。** 因此，详情页可以正确，薪资卡仍可能错。第三个问题“综合额外变成两行”是独立的卡片布局错误。

本方案只说明根因与实施方式，尚未修改本轮薪资代码。

## 1. 两位员工必须分开核对

| 员工 | 详情页中正确的事实 | 薪资卡中错误的事实 | 直接判断 |
|---|---|---|---|
| **瑞雪** | 公司补贴为 **¥2,500**；五项工作绩效为 **¥200 + ¥300 + ¥500 + ¥300 + ¥400 = ¥1,700**；业绩绩效为 **¥0**。因此绩效补贴总额必须是 **¥4,200**。 | 卡片的“补贴合计”为 **¥2,500**，工作绩效/业绩绩效显示“—”，综合额外也是 **¥2,500**。 | 当前卡片读取到的薪资单聚合字段 `workKPIBonus` 是过期的 `0`，但该薪资单控制字段 `workKPISelections` 已足以让详情页算出正确的 ¥1,700。 |
| **张忠洋** | 饭补规则是 **¥15/天**，详情页显示 **¥0（¥15/天 × 0天）**；无工作绩效。因此补贴和综合额外均必须是 **¥0**。 | 卡片显示“综合额外 +¥15”“补贴合计 +¥15”，实发和总工资都多出 ¥15。 | 当前卡片读取到的薪资单聚合字段 `mealAllowance` 是过期的 `15`；详情页按当前出勤 `0天` 和日补贴规则实时结算为 `0`。 |

这不是“瑞雪的绩效计算错了”，也不是“张忠洋的饭补规则错了”。两人的**详情页计算均符合规则**；错误发生在薪资卡将旧薪资单金额当作当前数据来展示和汇总。

## 2. 精确断点

### 2.1 唯一结算引擎正确

`lib/labor/payroll-extras.ts` 的 `settlePayrollExtras()` 已明确处理两个关键规则：

1. `attendanceDays <= 0` 时转换为 `safeAttendanceDays = 0`；日补贴只能按 `单价 × 0天` 计算，不能继承旧金额。
2. 工作绩效必须从 `workKPISelections` 找到当前档位，再汇总各档金额。

因此：张忠洋的饭补应为 `0`，瑞雪的工作绩效应为 `1700`。该函数不是截图问题的根源。

### 2.2 薪资草稿构建也正确，但不是卡片的唯一来源

`lib/labor/store.tsx` 的 `buildPaySlipDraft()` 确实使用 `settlePayrollExtras()`，并将结果写入 `workKPIBonus`、`mealAllowance` 等薪资单字段。因此，只要草稿被重新构建，字段会被纠正。

但薪资卡当前路径并不保证在每一次以下变化后执行草稿重构：绩效控制字段刚保存、考勤天数由排班同步变为零、页面返回但组件未卸载、或旧草稿从本地加载。卡片只是从 `paySlips` 映射取得原对象。

### 2.3 薪资卡直接消费旧聚合字段

`app/labor.tsx` 的 `PaySlipMiniCard` 直接做如下等价计算：

```ts
allowanceSum = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance
performanceTotal = slip.workKPIBonus + slip.revenueKPIBonus
extraTotal = allowanceSum + performanceTotal + slip.rewardPenalty
```

这使卡片绕过了控制字段和唯一结算引擎。于是会出现：

- 瑞雪：`workKPISelections` 已保存，但旧 `workKPIBonus = 0`，卡片显示 ¥2,500。
- 张忠洋：出勤已为 0，但旧 `mealAllowance = 15`，卡片显示 +¥15。

### 2.4 “综合额外两行”是单独的布局错误

卡片展开区把五个项目设为 `width: "33.333%"` 并开启 `flexWrap: "wrap"`。五项必然是前三项第一行、后二项第二行；因此“综合额外”看起来被拆成两行。这不是金额重复计算，而是固定会发生的布局结果。

## 3. 一次性修复设计

### 3.1 新增唯一的薪资卡额外项解析器

在 `lib/labor/payroll-extras.ts` 新增纯函数：

```ts
resolvePayrollExtrasForDisplay({ employee, slip, attendance, monthStatus })
```

它返回：

```ts
{
  allowanceTotal,
  mealAllowance,
  transportAllowance,
  otherAllowance,
  workKPIBonus,
  revenueKPIBonus,
  rewardPenalty,
  grandTotal,
}
```

规则如下。

| 月份状态 | 数据来源 | 原因 |
|---|---|---|
| `DRAFT` | 以 `slip.allowanceOverrides`、`slip.allowanceDetails`、`slip.workKPISelections`、`slip.revenueActuals` 和当前出勤调用 `settlePayrollExtras()`。 | 草稿必须实时反映当前规则、出勤和控制字段。 |
| `FROZEN` | 只读取冻结快照/冻结薪资单字段。 | 已确认发薪不能因后续规则或出勤编辑而改写历史。 |
| `ADJUSTING` | 冻结基线加明确差额调整，不把当前规则直接覆盖历史。 | 确保差额可审计。 |

**重要：** UI 不自己计算。`PaySlipMiniCard`、薪资详情、导出、月报都调用同一解析器。这样仍符合“UI层不重复结算”的架构规则。

### 3.2 建立 DRAFT 月份的幂等对账写回

在 Store 增加单一 `reconcileDraftPayrollExtras(employeeId, month)`：

1. 读取当前员工、考勤、月份状态和薪资单控制字段。
2. 调用上述解析器/唯一结算引擎。
3. 对比 `workKPIBonus`、`revenueKPIBonus`、三类补贴、`grossSalary`、`finalSalary`。
4. 仅有差异时用一次 `upsertPaySlip()` 写回全部规范字段；无差异绝不写入。

触发点必须覆盖：绩效补贴保存成功、排班/考勤重算成功、员工补贴或KPI规则编辑成功、路由返回、Store加载完成。不得由卡片渲染过程中写入。

这会一次性清掉张忠洋的旧 `mealAllowance: 15`，并写入瑞雪的 `workKPIBonus: 1700`。

### 3.3 严格删除旧聚合读取路径

以下卡片内联计算必须删除：

```ts
slip.mealAllowance + slip.transportAllowance + slip.otherAllowance
slip.workKPIBonus + slip.revenueKPIBonus
```

这些值只能由 `resolvePayrollExtrasForDisplay()` 返回；保留薪资单字段仅用于冻结快照、导出和持久化，不再被DRAFT卡片当作权威来源。

同时清理任何把日补贴旧金额直接增量加到 `grossSalary` 或 `finalSalary` 的路径；必须重建草稿，不能做“+15/-15”的增量修补。

### 3.4 卡片布局恢复为一行

展开区五项采用不换行五列：

```ts
<View style={{ flexDirection: "row", flexWrap: "nowrap" }}>
  <View style={{ flex: 1, minWidth: 0 }}>...</View>
  // 共五格
</View>
```

所有数值使用 `numberOfLines={1}`、`adjustsFontSizeToFit` 与更小的说明文字；**不再使用 `33.333%` + `flexWrap`**。iPhone 375pt、390pt、430pt 都必须保持“补贴合计 / 工作绩效 / 业绩绩效 / 奖惩小计 / 综合额外”一行。

## 4. 本次必须新增的精确测试

| 测试 | 输入 | 必须断言 |
|---|---|---|
| 瑞雪 DRAFT 实时卡片 | 补贴 2500；五档工作绩效 1700；出勤正常。薪资单旧聚合为0。 | 卡片解析结果：补贴2500、工作1700、业绩0、综合4200；写回后 `workKPIBonus=1700`。 |
| 张忠洋零出勤日补贴 | 规则 `¥15/天`，出勤0，薪资单旧 `mealAllowance=15`。 | 卡片解析结果和对账写回都为0；`grossSalary`/`finalSalary` 同步减少15；不出现 +15。 |
| 冻结月保护 | 冻结薪资单有历史额外项，当前规则/考勤改变。 | 卡片继续显示冻结快照，不自动重算或写回。 |
| 路由返回同步 | 保存瑞雪工作绩效后返回薪资统计，组件不卸载。 | 卡片立即显示 +1700，不需要退出页面。 |
| 五列移动布局 | 375/390/430pt。 | 综合额外五项一行，无第二行、无横向溢出、数值不截断。 |
| 全局闭环 | 任意DRAFT薪资单。 | `综合额外 = 补贴合计 + 工作绩效 + 业绩绩效 + 奖惩小计`，并且 `grossSalary` 同一口径。 |

## 5. 对本次截图的预期修复结果

| 员工 | 修复后薪资卡的综合额外区 |
|---|---|
| 瑞雪 | 补贴合计 `+¥2500`；工作绩效 `+¥1700`；业绩绩效 `—`；奖惩小计 `—`；综合额外 `+¥4200`。一行显示。 |
| 张忠洋 | 补贴合计 `—`；工作绩效 `—`；业绩绩效 `—`；奖惩小计 `—`；综合额外 `—`。总工资和实发不再包含 +¥15。 |

## 6. 为什么此前会反复出现

此前修复集中于“详情页使用唯一结算引擎”和“草稿构建使用唯一结算引擎”，但没有把**DRAFT卡片展示**也收敛到同一个权威解析器，也没有建立“控制字段/出勤变化后必须幂等对账写回”的唯一触发机制。于是每个页面各自看起来都合理，但跨页面比较就会出现新详情、旧卡片。

本方案的关键不是再为某个字段打补丁，而是让所有DRAFT展示、总额和写回都从同一解析器获得结果；仅冻结月份例外。这样瑞雪、张忠洋以及任何未来员工都不会再次因旧聚合字段出现分裂显示。

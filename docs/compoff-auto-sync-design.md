# 加班换休自动化 + 调休到期预警 完整方案

## 一、现状问题分析

### 问题 1：排班表「存入调休」需要手动操作
当前流程：排班填写加班 → 考勤卡出现橙色提醒 → 用户点击「存入」按钮 → 弹出面板 → 手动输入小时数 → 确认。
**问题**：每次加班都需要手动操作，且存入小时数可能与实际加班时数不一致，产生数据偏差。

### 问题 2：加班换休超额逻辑不明确
当月排班中标记了「加班换休」（comp_off 特殊状态），但该员工本月加班时数不足以支撑换休，或调休余额为零时，系统目前的行为是：
- `calcFromShifts` 中 `compOffCount` 照常累加（不检查余额）
- `paidOvertimeHours = rawOvertimeHours - compOffCount * hoursPerCompOff`，可能变为负数（被 `Math.max(0, ...)` 截断）
- 实际上「用了不存在的余额」，导致加班工资少算

### 问题 3：调休余额无到期预警
`CompOffBalanceEntry.expiresMonth` 字段存在，但 UI 中只在兑换列表里显示「到期 YYYY-MM」，没有主动预警。

---

## 二、完整方案设计

### 方案 A：加班换休全自动化（核心）

**设计原则**：排班数据是唯一事实来源，调休余额由系统自动维护，无需手动存入。

#### 自动化规则

| 场景 | 触发条件 | 系统行为 |
|------|----------|----------|
| 加班时数 ≥ 4h | 排班变化，`rawOvertimeHours ≥ 4` | 自动计算可存入天数，写入 `CompOffBalanceEntry`（幂等） |
| 加班时数变化 | 排班修改导致加班时数增减 | 更新对应月份的自动生成条目（不新增重复条目） |
| 排班清空 | 加班时数归零 | 将该月自动生成的条目状态改为 `expired` |
| 标记「加班换休」| 排班中填写 comp_off 特殊状态 | 从余额中扣除（已有逻辑），但新增超额检查 |

#### 幂等标识设计

在 `CompOffBalanceEntry` 中新增 `autoSyncKey` 字段：
```
autoSyncKey = `auto_ot_${employeeId}_${month}`
```
每次 autoSync 时，先查找该 key 的现有条目，再决定创建/更新/作废，**确保每月每员工只有一条自动生成的加班调休记录**。

#### 存入规则（对齐劳动法）

```
可存入天数 = floor(rawOvertimeHours / hoursPerCompOff)
剩余计费小时 = rawOvertimeHours % hoursPerCompOff
```

例：加班 10h，hoursPerCompOff=8：
- 存入 1 天调休（8h）
- 剩余 2h 按时薪计算加班工资

#### 超额换休防护

当排班中标记「加班换休」天数超过可用余额时：
- **不阻止排班操作**（不影响用户填写排班）
- **在考勤卡显示警告**：「本月换休 N 天，但余额仅 M 天，超出 X 天将按旷工处理」
- **薪资计算**：超出部分按旷工（扣 1 天日薪）处理，而非静默忽略

---

### 方案 B：调休到期预警

#### 预警逻辑

```
预警条件：
  expiresMonth <= nextMonth(currentMonth, 1)  // 30天内到期
  AND status === "available"
  AND days > 0
```

#### UI 展示位置

1. **薪资统计考勤卡顶部**（展开后）：橙色预警卡片，显示「X 天调休将于 YYYY-MM 到期，请尽快使用或兑换」
2. **排班表右侧考勤卡**：在调休余额标签旁显示橙色「⚠️」图标

#### 预警优先级

| 状态 | 颜色 | 文案 |
|------|------|------|
| 本月到期 | 红色 | 「⚠️ X 天调休本月到期，请立即处理」 |
| 下月到期 | 橙色 | 「⏰ X 天调休将于下月到期」 |
| 两月内到期 | 黄色 | 「X 天调休将于 YYYY-MM 到期」 |

---

### 方案 C：超额换休逻辑规范

#### 当前问题的根因

`calcFromShifts` 中：
```ts
const compOffHoursUsed = compOffCount * hoursPerCompOff;
const paidOvertimeHours = Math.max(0, rawOvertimeHours - compOffHoursUsed);
```

这里 `compOffCount` 是排班中标记换休的天数，**不检查余额是否足够**。
当 `compOffHoursUsed > rawOvertimeHours` 时，`paidOvertimeHours = 0`，加班工资归零，但换休天数也没有被正确扣除余额。

#### 修复方案

在 autoSync useEffect 中，计算完 `att` 后，立即执行余额检查：

```
实际可换休天数 = min(compOffCount, floor(可用余额天数))
超额换休天数 = compOffCount - 实际可换休天数

如果超额换休天数 > 0：
  → 在 att 的 specialStatusDeductions 中新增「超额换休（按旷工）」扣薪
  → 扣薪金额 = 超额天数 × dailyRate
```

---

## 三、实现计划

### 步骤 1：`types.ts` 新增字段
- `CompOffBalanceEntry.autoSyncKey?: string`（幂等标识）
- `CompOffBalanceEntry.autoSyncHours?: number`（自动存入的加班小时数，用于更新时对比）

### 步骤 2：`store.tsx` 新增 upsertAutoEntry 方法
- 按 `autoSyncKey` 查找现有条目
- 如果存在且 hours 不同 → 更新
- 如果不存在 → 新增
- 如果 hours = 0 → 作废

### 步骤 3：`labor.tsx` autoSync useEffect 扩展
- 计算完 `att` 后，调用 `upsertAutoEntry` 自动维护加班调休余额
- 新增超额换休检查逻辑
- 删除排班表考勤卡的「存入」手动按钮

### 步骤 4：考勤卡 UI 新增到期预警
- 薪资统计考勤卡：展开后顶部显示到期预警卡片
- 排班表考勤卡：调休余额标签旁显示预警图标

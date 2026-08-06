# 「考勤概况」分区卡片 完整方案设计

## 一、12 个字段的数据来源分析

| 字段 | 数据来源 | 现有/新增 | 说明 |
|------|----------|-----------|------|
| 出勤天数 | `att.attendanceDays` | ✅ 现有 | 有工时记录的天数 |
| 实际出勤天数（应出勤） | `att.expectedAttendanceDays` | ✅ 现有 | daysInMonth - restDaysPerMonth |
| 实际工时 | `att.totalHours` | ✅ 现有 | 所有班次工时之和 |
| 标准工时 | `att.stdHours` | ✅ 现有 | 按合同工时规则计算 |
| 总加班时数 | `att.overtimeHours` | ✅ 现有 | totalHours - stdHours |
| 加班换休天数 | `att.compOffCount` | ✅ 现有 | 排班中标记 comp_off 的天数 |
| 实际加班费时长 | `att.paidOvertimeHours` | ✅ 现有 | overtimeHours - compOffCount×hoursPerCompOff |
| 加班费 | `att.overtimePay` | ✅ 现有 | paidOvertimeHours × overtimeHourlyRate |
| 节假日天数 | `att.holidayWorkDays` | ⚠️ **需新增** | 排班中标记节日上班（isHoliday=true）的天数 |
| 节假日换休天数 | `att.holidayRestDays` | ⚠️ **需新增** | 节假日上班中选择换休的天数（来自 holidayBonusAllocation） |
| 实际节假日兑换天数 | `att.holidayCashDays` | ⚠️ **需新增** | 节假日上班中选择拿钱的天数 |
| 节假日薪资 | `att.holidayBonus` | ✅ 现有 | 节日上班额外补偿金额（已扣除换休部分） |

---

## 二、新增字段方案

### 2.1 `MonthlyAttendance` 新增 3 个字段

```typescript
// lib/labor/types.ts
export interface MonthlyAttendance {
  // ... 现有字段 ...

  /**
   * 节假日上班天数（排班中标记 isHoliday=true 的特殊状态天数）
   * 包含所有节假日上班，无论选择拿钱还是换休
   */
  holidayWorkDays?: number;

  /**
   * 节假日换休天数（节假日上班中选择换休的天数）
   * 来源：PaySlip.holidayBonusAllocation 中 mode="rest" 的条目数
   * 注意：此字段在 calcFromShifts 中无法计算（需要 PaySlip 数据），
   * 由 autoSync useEffect 在生成 PaySlip 后回填到 att
   */
  holidayRestDays?: number;

  /**
   * 节假日实际兑现天数（节假日上班中选择拿钱的天数）
   * = holidayWorkDays - holidayRestDays
   */
  holidayCashDays?: number;
}
```

### 2.2 `calcFromShifts` 新增 `holidayWorkDays` 计算

在 `calcFromShifts` 中，遍历 shifts 时统计 `isHoliday=true` 的班次天数：

```typescript
// lib/labor/store.tsx - calcFromShifts 内部
let holidayWorkDays = 0;

// 在 forEach 中，当 specialStatus.isHoliday === true 时：
if (specialStatus.isHoliday && specialStatus.salaryMultiplier > 1) {
  holidayWorkDays++;
}

// 返回值中新增：
return {
  // ... 现有字段 ...
  holidayWorkDays,
};
```

### 2.3 `autoSync useEffect` 回填 `holidayRestDays` 和 `holidayCashDays`

`holidayRestDays` 依赖 `PaySlip.holidayBonusAllocation`，必须在生成 PaySlip 后回填到 att：

```typescript
// labor.tsx autoSync useEffect 中，生成 slip 后：
const allocation = slip.holidayBonusAllocation ?? {};
const holidayRestDays = Object.values(allocation).filter(a => a.mode === "rest").length;
const holidayCashDays = (att.holidayWorkDays ?? 0) - holidayRestDays;
upsertAttendance({
  ...att,
  holidayRestDays,
  holidayCashDays,
});
```

---

## 三、UI 布局方案

### 3.1 整体结构（三个分区）

```
┌─────────────────────────────────────────────────────┐
│  考勤概况                                            │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  分区一：出勤统计（2列×2行 = 4格）              │  │
│  │  出勤天数  应出勤  实际工时  标准工时            │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  分区二：加班明细（仅加班时显示）               │  │
│  │  总加班时数  换休天数  计费时长  加班费          │  │
│  │  ─────────────────────────────────────────── │  │
│  │  加班 19.5h → 换休 1天(8h) → 计费 11.5h → +¥345 │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  分区三：节假日明细（仅有节假日上班时显示）      │  │
│  │  节假日天数  换休天数  拿钱天数  节假日薪资      │  │
│  │  ─────────────────────────────────────────── │  │
│  │  节日上班 2天 → 换休 1天 · 拿钱 1天 → +¥320   │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  少出勤 1天  /  多出勤 2天（颜色区分）               │
└─────────────────────────────────────────────────────┘
```

### 3.2 字段对应关系

**分区一：出勤统计（固定显示）**

| 格子 | 字段 | 颜色逻辑 |
|------|------|----------|
| 出勤天数 | `att.attendanceDays` 天 | 达标=绿，不足=橙 |
| 应出勤 | `att.expectedAttendanceDays` 天 | 灰色（参考值） |
| 实际工时 | `att.totalHours` h | 正常色 |
| 标准工时 | `att.stdHours` h | 灰色（参考值） |

**分区二：加班明细（`att.overtimeHours > 0` 时显示）**

| 格子 | 字段 | 颜色逻辑 |
|------|------|----------|
| 总加班时数 | `att.overtimeHours` h | 橙色 |
| 换休天数 | `att.compOffCount` 天 | 蓝色 |
| 计费时长 | `att.paidOvertimeHours` h | 正常色 |
| 加班费 | `+¥att.overtimePay` | 绿色 |

底部链路说明行：`加班 Xh → 换休 N天(Xh) → 计费 Xh → +¥XXX`

**分区三：节假日明细（`att.holidayWorkDays > 0` 时显示）**

| 格子 | 字段 | 颜色逻辑 |
|------|------|----------|
| 节假日天数 | `att.holidayWorkDays` 天 | 红色（节日色） |
| 换休天数 | `att.holidayRestDays` 天 | 蓝色 |
| 拿钱天数 | `att.holidayCashDays` 天 | 绿色 |
| 节假日薪资 | `+¥att.holidayBonus` | 绿色 |

底部说明行：`节日上班 N天 → 换休 X天 · 拿钱 X天 → +¥XXX`

---

## 四、实现步骤

1. **`lib/labor/types.ts`**：`MonthlyAttendance` 新增 `holidayWorkDays`、`holidayRestDays`、`holidayCashDays`
2. **`lib/labor/store.tsx`**：`calcFromShifts` 统计 `holidayWorkDays`，返回值中新增
3. **`app/labor.tsx`**：
   - `autoSync useEffect` 在生成 PaySlip 后回填 `holidayRestDays`、`holidayCashDays` 到 att
   - 重构「考勤概况」分区卡片为三分区布局
   - 同步更新排班表右侧考勤卡片

---

## 五、边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 节假日上班但未生成 PaySlip | `holidayRestDays=0`，`holidayCashDays=holidayWorkDays` |
| 节假日全部换休 | `holidayCashDays=0`，`holidayBonus=0`（已有逻辑） |
| 加班换休天数 > 可用余额 | 超额部分显示警告标签（后续方案实现） |
| 兼职员工 | 无标准工时概念，加班分区不显示 |

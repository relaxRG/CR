# 跨月排班与考勤校验防错机制设计方案

## 设计背景

当前系统的排班表支持跨月显示（如7月视图中显示8月1日、2日的格子），用户可以在跨月格子中录入排班。虽然 UI 标注了"跨月·不计入本月"，但**数据实际写入了目标月份的存储**，导致：

1. 用户在7月视图中为8月1日录入排班 → 8月薪资计算包含该天
2. 排班表8月视图的"0人"统计可能未包含这些跨月录入
3. 用户不知道8月已有排班数据，导致薪资异常

参考 Gusto、Rippling、钉钉、飞书等成熟薪资系统的设计规范，提出以下三层防错机制。

---

## 一、防错机制架构（三层防护）

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 数据写入层 — 跨月排班写入确认                    │
│  ↓ 数据已写入                                            │
│  Layer 2: 计算校验层 — 薪资计算前的数据完整性检查            │
│  ↓ 计算完成                                              │
│  Layer 3: 展示预警层 — 异常数据可视化提醒                   │
└─────────────────────────────────────────────────────────┘
```

---

## 二、Layer 1: 数据写入层 — 跨月排班写入确认

### 2.1 设计原则

> 跨月排班不是错误操作，而是合理的提前排班需求。但系统应确保用户**知晓**该操作的影响。

### 2.2 实现方案

**在 `upsertShift` 调用前增加跨月检测：**

```typescript
// lib/labor/validation.ts（新增文件）

/**
 * 检测排班日期是否属于当前操作月份
 * @returns true = 跨月排班
 */
export function isCrossMonthShift(date: string, currentViewMonth: string): boolean {
  return !date.startsWith(currentViewMonth);
}

/**
 * 跨月排班写入的影响说明
 */
export function getCrossMonthImpactText(date: string, currentViewMonth: string): string {
  const targetMonth = date.slice(0, 7);
  const [y, m] = targetMonth.split("-").map(Number);
  return `此排班将计入 ${y}年${m}月 的考勤和薪资计算`;
}
```

**UI 层增强（SchShiftModal / SchHoursModal）：**

当前已有 `跨月·不计入本月` 标签，但措辞有误导性（实际上会计入目标月份）。建议修改为：

```
修改前: "跨月·不计入本月"
修改后: "跨月·计入{目标月}考勤"
```

并在保存时增加轻量确认提示（Toast 而非 Modal，不打断操作流）。

---

## 三、Layer 2: 计算校验层 — 薪资计算前的数据完整性检查

### 3.1 设计原则

> 参考专业薪资系统的 "Pre-payroll Validation" 阶段：在计算薪资前，系统自动执行一系列校验规则，发现异常数据时标记警告但不阻断计算。

### 3.2 校验规则清单

| 规则 ID | 规则名称 | 检测条件 | 严重级别 | 处理方式 |
|---------|---------|---------|---------|---------|
| V001 | 零排班非零底薪 | `attendanceDays=0` 且 `baseSalary>0` 且员工 `active=true` | Warning | 标记提醒 |
| V002 | 孤立跨月排班 | 某月仅有1-2天排班且均为月初（可能来自上月跨月录入） | Info | 标记提醒 |
| V003 | 出勤超应出勤 | `attendanceDays > expectedAttendanceDays * 1.5` | Warning | 标记提醒 |
| V004 | 底薪配置异常 | `restDaysPerMonth >= daysInMonth` | Error | 阻断计算 |
| V005 | 排班无工时 | 有排班记录但 `hoursValue=null/0` 且非特殊状态 | Warning | 标记提醒 |
| V006 | 月中入职/离职 | 员工入职日期在月中，但排班从月初开始 | Info | 标记提醒 |

### 3.3 实现方案

```typescript
// lib/labor/validation.ts

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  ruleId: string;
  severity: ValidationSeverity;
  employeeId: string;
  month: string;
  message: string;
  /** 建议操作 */
  suggestion: string;
}

/**
 * 薪资计算前校验（Pre-payroll Validation）
 * 不阻断计算流程，仅返回校验结果供 UI 展示
 */
export function validatePayrollData(
  employee: Employee,
  month: string,
  shifts: ShiftEntry[],
  attendance: MonthlyAttendance
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const { year, month: m } = parseMonth(month);
  const daysInMonth = getDaysInMonth(year, m);

  // V001: 零排班非零底薪
  if (attendance.attendanceDays === 0 && employee.baseSalary > 0 && employee.active) {
    results.push({
      ruleId: "V001",
      severity: "warning",
      employeeId: employee.id,
      month,
      message: `${employee.code} 本月无排班记录，比例底薪为 ¥0`,
      suggestion: "请确认是否遗漏排班，或该员工本月确实未出勤",
    });
  }

  // V002: 孤立跨月排班检测
  const empShifts = shifts.filter((s) => s.employeeId === employee.id && s.date.startsWith(month));
  if (empShifts.length > 0 && empShifts.length <= 2) {
    const dates = empShifts.map((s) => parseInt(s.date.slice(-2)));
    const allEarlyMonth = dates.every((d) => d <= 2);
    if (allEarlyMonth) {
      results.push({
        ruleId: "V002",
        severity: "info",
        employeeId: employee.id,
        month,
        message: `${employee.code} 本月仅有 ${empShifts.length} 天排班（月初），可能来自上月跨月录入`,
        suggestion: "请在排班表中确认这些排班是否为有效数据",
      });
    }
  }

  // V003: 出勤超应出勤
  if (attendance.attendanceDays > attendance.expectedAttendanceDays * 1.5) {
    results.push({
      ruleId: "V003",
      severity: "warning",
      employeeId: employee.id,
      month,
      message: `${employee.code} 出勤 ${attendance.attendanceDays} 天，超过应出勤 ${attendance.expectedAttendanceDays} 天的 150%`,
      suggestion: "请确认排班数据是否正确，是否有重复录入",
    });
  }

  // V004: 底薪配置异常
  if (employee.restDaysPerMonth >= daysInMonth) {
    results.push({
      ruleId: "V004",
      severity: "error",
      employeeId: employee.id,
      month,
      message: `${employee.code} 每月休息天数(${employee.restDaysPerMonth})≥当月天数(${daysInMonth})，配置异常`,
      suggestion: "请修改员工档案中的每月休息天数",
    });
  }

  // V005: 排班无工时
  const noHoursShifts = empShifts.filter((s) =>
    !s.specialStatusId && (s.hoursValue === null || s.hoursValue === undefined || s.hoursValue === 0)
  );
  if (noHoursShifts.length > 0) {
    results.push({
      ruleId: "V005",
      severity: "warning",
      employeeId: employee.id,
      month,
      message: `${employee.code} 有 ${noHoursShifts.length} 天排班未填写工时`,
      suggestion: "未填工时的排班不计入出勤天数，请补充工时数据",
    });
  }

  return results;
}
```

---

## 四、Layer 3: 展示预警层 — 异常数据可视化提醒

### 4.1 薪资统计页面增强

在薪资统计列表顶部增加**校验摘要条**：

```
┌──────────────────────────────────────────┐
│ ⚠️ 2 项需要关注                           │
│ · Stephen: 本月仅有1天排班（月初跨月录入？）  │
│ · Jason: 本月无排班记录                     │
│                          [查看详情] [忽略]  │
└──────────────────────────────────────────┘
```

### 4.2 排班表页面增强

在月度排班表顶部增加**跨月数据提示**：

```
┌──────────────────────────────────────────┐
│ ℹ️ 本月有 1 条来自上月视图的跨月排班         │
│ Stephen 8/1 午班 (来自7月排班表录入)         │
│                          [定位] [删除]     │
└──────────────────────────────────────────┘
```

### 4.3 实现方案

在 `autoSync` 逻辑中同步执行校验，将结果存储到 state：

```typescript
// 在 autoSync useEffect 中增加校验
const validationResults: ValidationResult[] = [];
for (const emp of activeEmps) {
  const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
  const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, holidayDaysList);
  // ... 现有逻辑 ...
  
  // 新增：校验
  const empValidation = validatePayrollData(emp, currentMonth, shifts, att);
  validationResults.push(...empValidation);
}
setPayrollValidationResults(validationResults);
```

---

## 五、跨月排班标记机制（数据层增强）

### 5.1 设计原则

> 在排班数据中增加来源标记，使系统能区分"正常排班"和"跨月录入的排班"。

### 5.2 ShiftEntry 扩展

```typescript
export interface ShiftEntry {
  employeeId: string;
  date: string;
  shift: string;
  hoursValue: number | null;
  specialStatusId?: string;
  
  // 新增字段
  /** 录入来源月份（如在7月视图中录入8月排班，sourceMonth="2026-07"） */
  sourceMonth?: string;
  /** 录入时间戳 */
  createdAt?: string;
}
```

### 5.3 写入时自动标记

```typescript
// 在 upsertShift 调用处增加 sourceMonth
const handleSaveShift = (entry: ShiftEntry) => {
  upsertShift({
    ...entry,
    sourceMonth: currentMonth,  // 当前视图月份
    createdAt: entry.createdAt ?? new Date().toISOString(),
  });
};
```

### 5.4 跨月排班检测

```typescript
/**
 * 检测某条排班是否为跨月录入
 * 条件：sourceMonth 存在且与 date 所属月份不同
 */
export function isCrossMonthEntry(entry: ShiftEntry): boolean {
  if (!entry.sourceMonth) return false;
  return !entry.date.startsWith(entry.sourceMonth);
}
```

---

## 六、实施优先级

| 优先级 | 功能 | 工作量 | 影响 |
|--------|------|--------|------|
| P0 | 修复 "跨月·不计入本月" 措辞 | 5min | 消除用户误解 |
| P1 | calcFromShifts 零出勤防护 | ✅ 已完成 | 核心 bug 修复 |
| P1 | UI 展示层零出勤防护 | ✅ 已完成 | 显示层修复 |
| P2 | validatePayrollData 校验函数 | 30min | 提前发现异常 |
| P2 | 薪资统计页校验摘要条 | 1h | 用户可视化 |
| P3 | ShiftEntry sourceMonth 标记 | 20min | 数据可追溯 |
| P3 | 排班表跨月数据提示 | 1h | 排班管理增强 |

---

## 七、与专业薪资系统的对标

| 功能 | 钉钉智能薪酬 | 飞书人事 | 我们的系统（修复后） |
|------|------------|---------|-------------------|
| 零出勤零薪资 | ✅ | ✅ | ✅ |
| 排班-考勤-薪资联动 | ✅ | ✅ | ✅ |
| 薪资计算前校验 | ✅ Pre-payroll Check | ✅ 算薪检查 | 🔜 P2 待实施 |
| 跨月排班标记 | ✅ 自动标记 | ✅ 来源追溯 | 🔜 P3 待实施 |
| 异常数据可视化 | ✅ 异常报告 | ✅ 风险提示 | 🔜 P2 待实施 |
| 排班锁定（月结后不可修改） | ✅ | ✅ | ❌ 暂不需要 |

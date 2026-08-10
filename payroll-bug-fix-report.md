# 薪资计算 Bug 分析与专业优化方案

## 一、问题现象

**Stephen 张忠洋** 在 2026年8月的薪资统计中显示：
- 比例底薪：¥370.37
- 综合额外：+¥15
- 总工资：¥385.37

但排班表显示 2026年8月**所有周均为 0 人排班**，即 Stephen 在8月没有任何排班记录。

---

## 二、根因定位

### 2.1 核心 Bug 位置

**文件：** `lib/labor/store.tsx` 第 786-790 行

```typescript
// 按实际出勤天数比例计算底薪
const proportionalBase = expectedAttendanceDays > 0
  ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
  : employee.baseSalary;  // ← BUG: 当 expectedAttendanceDays=0 时，直接返回全额底薪
```

**问题：** 当 `expectedAttendanceDays = 0`（即 `daysInMonth - restDaysPerMonth <= 0`）时，代码回退到返回 `employee.baseSalary`（全额底薪），这是一个防御性编程的错误假设。

### 2.2 但 Stephen 的情况不是这个分支

根据截图反推：
- 比例底薪 ¥370.37 = 10000 × 1 / 27
- 这意味着 `baseSalary=10000`，`expectedAttendanceDays=27`（31天-4天休息），`attendanceDays=1`

**真正的问题是：Stephen 在8月有 1 天出勤记录被计入了。**

### 2.3 跨月排班数据泄漏

排班表支持跨月显示（7月最后一周会显示8月1日、2日等日期）。当用户在7月的排班视图中为跨月格子（8月初日期）录入排班时：

1. `upsertShift` 直接保存 `{ date: "2026-08-01", ... }` 到全局排班存储
2. 排班表 UI 虽然标注了"跨月·不计入本月"，但**数据实际已写入**
3. 当切换到8月视图时，`getShifts("2026-08")` 会返回这条记录
4. `calcFromShifts` 将其计入 `attendanceDays`，导致比例底薪非零

**同时，排班表 UI 的"0人"统计可能只统计了当前视图分组中的人数，而非全局排班数据。**

### 2.4 补充问题：`expectedAttendanceDays = 0` 的兜底逻辑错误

即使跨月问题修复后，仍存在一个潜在 bug：

```typescript
: employee.baseSalary;  // 当 restDaysPerMonth >= daysInMonth 时，不应发全额底薪
```

正确行为应该是：如果应出勤天数为0，比例底薪也应为0。

---

## 三、专业优化方案

### 3.1 方案设计原则

参考成熟薪资系统（如 Gusto、Rippling、钉钉智能薪酬）的设计：

| 原则 | 说明 |
|------|------|
| **零排班零薪资** | 当月无任何有效排班 → 比例底薪 = 0，考勤工资 = 0 |
| **数据源唯一性** | 比例底薪由统一 helper 函数计算，消除多处反推公式不一致 |
| **防御性边界处理** | 所有除法运算前检查分母，所有比例计算结果 ≥ 0 |
| **跨月数据隔离** | 薪资计算严格只使用 `startsWith(month)` 的排班数据 |
| **显示层防护** | UI 展示时对 `attendanceDays === 0` 做特殊处理 |

### 3.2 具体修改清单

#### 修改 1：`lib/labor/store.tsx` — calcFromShifts 中的比例底薪计算

```typescript
// 修复前（第 786-790 行）：
const proportionalBase = expectedAttendanceDays > 0
  ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
  : employee.baseSalary;

// 修复后：
const proportionalBase = (expectedAttendanceDays > 0 && attendanceDays > 0)
  ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
  : 0;
```

**逻辑说明：**
- `attendanceDays === 0` → 无出勤，比例底薪为 0（核心修复）
- `expectedAttendanceDays === 0` → 应出勤天数为 0（配置异常），比例底薪也为 0（不再回退到全额）

#### 修改 2：`lib/labor/types.ts` — 新增统一 helper 函数

```typescript
/**
 * 计算比例底薪（统一入口，消除多处反推公式不一致）
 * 
 * 专业规则：
 * 1. 无出勤（attendanceDays=0）→ 返回 0
 * 2. 应出勤天数为 0（配置异常）→ 返回 0
 * 3. 正常情况 → baseSalary × (attendanceDays / expectedAttendanceDays)
 */
export function calcProportionalBase(
  baseSalary: number,
  attendanceDays: number,
  expectedAttendanceDays: number
): number {
  if (attendanceDays <= 0 || expectedAttendanceDays <= 0) return 0;
  return Math.round((baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100;
}
```

#### 修改 3：`app/labor.tsx` — UI 展示层统一使用 helper

将第 481-483 行和第 521-527 行的反推公式替换为直接使用 `calcProportionalBase`：

```typescript
// 修复前（反推公式，可能出现负数或不一致）：
const baseSalary = slip
  ? Math.round((slip.attendanceSalary - (att?.overtimePay ?? 0) - (att?.holidayBonus ?? 0) + _specialDed) * 100) / 100
  : null;

// 修复后（直接从考勤数据计算）：
const baseSalary = (att && att.attendanceDays > 0 && att.expectedAttendanceDays > 0)
  ? calcProportionalBase(employee.baseSalary, att.attendanceDays, att.expectedAttendanceDays)
  : 0;
```

#### 修改 4：`lib/labor/export.ts` — 导出引擎同步修复

```typescript
// 修复前（第 63-69 行）：
function calcProportionalBase(att: MonthlyAttendance | undefined, slip: PaySlip | undefined): number {
  if (!slip) return 0;
  const specialDeduction = att?.totalSpecialDeduction ?? 0;
  const overtimePay = att?.overtimePay ?? 0;
  const holidayBonus = att?.holidayBonus ?? 0;
  return Math.round((slip.attendanceSalary - overtimePay - holidayBonus + specialDeduction) * 100) / 100;
}

// 修复后：
function calcProportionalBase(att: MonthlyAttendance | undefined, slip: PaySlip | undefined): number {
  if (!slip || !att) return 0;
  // 无出勤直接返回 0，避免反推公式在边界情况下产生异常值
  if (att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0) return 0;
  const specialDeduction = att?.totalSpecialDeduction ?? 0;
  const overtimePay = att?.overtimePay ?? 0;
  const holidayBonus = att?.holidayBonus ?? 0;
  return Math.round((slip.attendanceSalary - overtimePay - holidayBonus + specialDeduction) * 100) / 100;
}
```

#### 修改 5：`app/labor.tsx` 第 4288 行 — 考勤概况卡片修复口径不一致

```typescript
// 修复前（缺少 specialDeduction 回加，与主卡片口径不一致）：
const baseSal = slip
  ? Math.round((slip.attendanceSalary - (att.overtimePay ?? 0) - (att.holidayBonus ?? 0)) * 100) / 100
  : null;

// 修复后：
const _specDed = Object.values(att.specialStatusDeductions ?? {}).reduce((s, d) => s + d.deduction, 0);
const baseSal = (att.attendanceDays > 0 && att.expectedAttendanceDays > 0)
  ? Math.round((slip.attendanceSalary - (att.overtimePay ?? 0) - (att.holidayBonus ?? 0) + _specDed) * 100) / 100
  : 0;
```

---

## 四、影响范围评估

| 受影响模块 | 修改内容 | 风险等级 |
|-----------|---------|---------|
| `lib/labor/store.tsx` calcFromShifts | 核心计算逻辑修复 | 低（仅影响边界条件） |
| `lib/labor/types.ts` | 新增 helper 函数 | 无（纯新增） |
| `app/labor.tsx` 薪资卡片 | UI 展示修复 | 低（显示层变更） |
| `app/labor.tsx` 考勤概况 | 口径统一修复 | 低（显示层变更） |
| `lib/labor/export.ts` | 导出报表修复 | 低（与 UI 保持一致） |

---

## 五、验证场景

| 场景 | 预期结果 |
|------|---------|
| 员工8月无排班 | 比例底薪=0，考勤工资=0，总工资=综合额外 |
| 员工8月有1天排班 | 比例底薪=baseSalary×1/expectedDays |
| 员工全勤 | 比例底薪=baseSalary（不变） |
| restDaysPerMonth ≥ daysInMonth | 比例底薪=0（不再回退全额） |
| 跨月排班（7月视图录入8月1日） | 8月计算中正确包含该天（数据层无问题） |

---

## 六、关于 Stephen 当前数据的修复

Stephen 当前显示 ¥370.37 的原因是8月有1条排班记录（可能来自7月跨月录入或之前的测试数据）。修复代码后，需要：

1. 检查 Stephen 在8月是否确实有排班数据残留
2. 如果是误录入，删除该排班记录
3. 重新生成8月薪资单（点击"生成薪资单"按钮）

代码修复后，即使有1天排班，计算逻辑也是正确的（按比例计算）。如果确认8月不应有任何排班，则需要在排班表中清除残留数据。

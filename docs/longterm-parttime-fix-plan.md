# 长期兼职（longterm_parttime）薪资逻辑修复方案

## 一、问题现象

从截图可以看到朱大哥（朱志委）的情况：

| 项目 | 当前状态 | 正确状态 |
|------|---------|---------|
| 员工类型 | 长期兼职（longterm_parttime） | ✅ 正确 |
| 底薪（月） | ¥0 | ✅ 正确（但不应显示此字段） |
| 灵活工时 | "未配置工时规则" | ❌ 不应显示此字段 |
| 月休息天数 | 4天 | ❌ 不应显示此字段 |
| 计费模式 | 按小时结算 | ✅ 正确 |
| 兼职时薪 | ¥35/小时 | ✅ 正确 |
| 排班表 | 每格显示 ⚠️ 警告图标 | ❌ 不应有警告 |
| 薪资卡片 | 比例底薪 ¥-8680 | ❌ 严重错误 |
| 加班考勤 | +¥8680 | ❌ 应显示为"工时薪资" |
| 总工资 | ¥0 | ❌ 应为 ¥8680 |

## 二、问题根因分析

### Bug 1：排班表 ⚠️ 警告图标

**位置：** `app/labor.tsx` 第 3921 行

```typescript
if (contractH === 0 && !entry.specialStatusId && typeof h === "number" && h > 0) {
  // 显示 ⚠️ 警告
}
```

**原因：** `getContractHoursForDate()` 对朱大哥返回 0（因为他没有 `weeklyHoursRules` 且 `stdHoursPerDay=0`），代码认为"有排班但无合同工时覆盖"是异常，显示警告。

**但对长期兼职来说，没有合同工时是正常的** — 他们按实际工时计费，不需要合同工时规则。

### Bug 2：薪资卡片显示"比例底薪 ¥-8680"

**位置：** `app/labor.tsx` 第 481-484 行

```typescript
const baseSalary = (!att || att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0)
  ? 0
  : calcProportionalBase(employee.baseSalary, att.attendanceDays, att.expectedAttendanceDays);
```

**原因：** 朱大哥的配置是 `baseSalary=0, restDaysPerMonth=4`，所以：
- `expectedAttendanceDays = 31 - 4 = 27`（> 0）
- `attendanceDays = 约 24`（> 0）
- `calcProportionalBase(0, 24, 27) = 0`

但 UI 显示的是 ¥-8680，这说明 **UI 仍在使用旧的反推公式**（从 `slip.attendanceSalary` 反推），而 `slip.attendanceSalary = 0`（因为引擎走的是 else 分支而非 parttime 分支）。

### Bug 3：薪资计算引擎分支错误

**位置：** `lib/labor/store.tsx` 第 778 行

```typescript
if (employee.type === "parttime") {
  // 兼职逻辑：按工时×时薪
} else {
  // 全职逻辑：比例底薪
}
```

**原因：** 条件判断只检查 `"parttime"`，**没有包含 `"longterm_parttime"`**！

所以朱大哥虽然是长期兼职，但薪资计算走的是**全职分支**：
- `proportionalBase = 0 × 24/27 = 0`
- `overtimePay = paidOvertimeHours × overtimeHourlyRate`

但 `overtimePay` 的计算依赖 `rawOvertimeHours = totalHours - stdHoursTotal`，而 `stdHoursTotal` 来自 `getContractHoursForDate()` 返回 0，所以：
- `stdHoursTotal = 0`（因为无合同工时规则）
- `rawOvertimeHours = 248 - 0 = 248h`（所有工时都被当作加班！）
- `overtimePay = 248 × 35 = ¥8680`
- `attendanceSalary = 0 + 8680 - 0 + 0 = ¥8680`

然后 UI 用反推公式：`比例底薪 = attendanceSalary - overtimePay = 8680 - 8680 = 0`... 但实际显示 -8680，说明某处计算有误差。

**核心问题：`longterm_parttime` 没有被纳入兼职计算分支。**

### Bug 4：员工档案显示不必要的字段

**位置：** `app/labor-employee-form.tsx` 第 639 行

```typescript
{isFulltime && (  // isFulltime = type === "fulltime"
  // 底薪、灵活工时、月休息天数
)}
```

虽然表单只对 `fulltime` 显示这些字段，但**员工档案展示页**可能仍显示了这些字段（因为数据中有 `restDaysPerMonth: 4` 的默认值）。

---

## 三、修复方案

### 修复 1：薪资计算引擎 — 将 longterm_parttime 纳入兼职分支

**文件：** `lib/labor/store.tsx` 第 778 行

```typescript
// 修复前
if (employee.type === "parttime") {

// 修复后
if (employee.type === "parttime" || employee.type === "longterm_parttime") {
```

### 修复 2：排班表警告图标 — 兼职员工不显示"无合同工时"警告

**文件：** `app/labor.tsx` 第 3921 行

```typescript
// 修复前
if (contractH === 0 && !entry.specialStatusId && typeof h === "number" && h > 0) {

// 修复后（增加非兼职条件）
const empObj = employees.find((e) => e.id === entry.employeeId);
const isParttimeEmp = empObj?.type === "parttime" || empObj?.type === "longterm_parttime";
if (contractH === 0 && !entry.specialStatusId && typeof h === "number" && h > 0 && !isParttimeEmp) {
```

### 修复 3：薪资卡片 — 兼职员工不显示"比例底薪"，改为"工时薪资"

**文件：** `app/labor.tsx` 第 479-494 行（5格摘要行）

```typescript
// 修复后：兼职员工显示"工时薪资"而非"比例底薪"
const isParttimeEmp = employee.type === "parttime" || employee.type === "longterm_parttime";
if (isParttimeEmp) {
  // 工时薪资 = totalHours × overtimeHourlyRate（直接从 att.attendanceSalary 读取）
  label = "工时薪资";
  value = att?.attendanceSalary ?? 0;
} else {
  label = "比例底薪";
  value = calcProportionalBase(...);
}
```

### 修复 4：考勤明细 — 兼职员工显示不同的5格布局

兼职员工的考勤明细应为：
- 工时薪资（totalHours × hourlyRate）
- 出勤天数
- 总工时
- —（无特殊扣薪）
- 总考勤工资

而非全职的：比例底薪 / 加班工资 / 节假日薪资 / 特殊扣薪 / 总考勤工资

### 修复 5：员工档案展示 — 隐藏兼职不需要的字段

对 `longterm_parttime` 类型：
- 隐藏"底薪（月）"（或标注"不适用"）
- 隐藏"灵活工时"
- 隐藏"月休息天数"
- 仅显示：计费模式、兼职时薪

### 修复 6：E2E 测试同步

在 `tests/attendance-payroll-e2e.test.ts` 中同步修复 `calcFromShiftsPure` 的分支条件。

---

## 四、影响范围

| 文件 | 修改内容 |
|------|---------|
| `lib/labor/store.tsx` | 薪资计算分支条件 |
| `app/labor.tsx` | 排班表警告 + 薪资卡片5格 + 考勤明细5格 |
| `app/labor-employee-form.tsx` | 员工档案展示字段条件（如有） |
| `tests/attendance-payroll-e2e.test.ts` | 同步修复 + 新增 longterm_parttime 测试 |

---

## 五、验证标准

修复后朱大哥（baseSalary=0, overtimeHourlyRate=35, 7月工时=248h）应显示：

| 项目 | 期望值 |
|------|--------|
| 排班表 | 无 ⚠️ 警告，正常显示工时数字 |
| 薪资卡片第1格 | "工时薪资 ¥8680"（248h × 35） |
| 薪资卡片第2格 | "—"（兼职无加班概念） |
| 总考勤工资 | ¥8680 |
| 实发薪资 | ¥8680（无预支/扣款时） |

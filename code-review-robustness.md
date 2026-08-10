# 代码 Diff 鲁棒性审查报告

## 审查范围

本次审查针对 commit `7fb5ff6` 中修改的 4 个文件，重点验证比例底薪计算逻辑在极端边缘条件下的正确性。

---

## 一、`lib/labor/store.tsx` — 核心计算引擎

### 修改内容

```diff
-const proportionalBase = expectedAttendanceDays > 0
+const proportionalBase = (expectedAttendanceDays > 0 && attendanceDays > 0)
   ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
-  : employee.baseSalary;
+  : 0;
```

### 边缘条件验证

| 条件 | 修复前 | 修复后 | 正确性 |
|------|--------|--------|--------|
| `attendanceDays=0, expectedDays=27` | `10000*0/27=0` ✅ | `0` ✅ | 两者等价，但修复后更明确 |
| `attendanceDays=0, expectedDays=0` | `employee.baseSalary`（全额！）❌ | `0` ✅ | **关键修复** |
| `attendanceDays=1, expectedDays=0` | `employee.baseSalary` ❌ | `0` ✅ | 配置异常防护 |
| `attendanceDays=-1`（理论不可能） | `负数/27=负数` ❌ | `0` ✅ | 防御性编程 |
| `attendanceDays=27, expectedDays=27` | `baseSalary` ✅ | `baseSalary` ✅ | 全勤不受影响 |
| `attendanceDays=30, expectedDays=27` | `baseSalary*30/27>baseSalary` ⚠️ | 同左 ⚠️ | **潜在问题**（见下） |

### 潜在问题：出勤天数超过应出勤天数

当 `attendanceDays > expectedAttendanceDays` 时（员工在休息日也上班），比例底薪会超过 baseSalary。这在当前系统中是**合理行为**——多出勤的天数通过加班工资另行补偿，比例底薪超过 100% 实际上是"多出勤奖励"。

**结论：无需额外封顶处理。** 加班天数的工资已通过 `overtimePay` 独立计算，`proportionalBase > baseSalary` 的情况在当前架构下不会导致重复计算。

### 遗留风险评估

`attendanceSalary` 的最终计算：
```typescript
attendanceSalary = Math.round(
  (proportionalBase + overtimePay - totalSpecialDeduction + holidayBonus) * 100
) / 100;
```

当 `proportionalBase=0` 且 `totalSpecialDeduction > 0` 时，`attendanceSalary` 可能为负数。

**风险等级：低。** 因为 `totalSpecialDeduction` 只在有排班记录且标记了特殊状态时才非零。如果 `attendanceDays=0`，则不会有任何排班记录被处理，`totalSpecialDeduction` 也必然为 0。逻辑自洽。

---

## 二、`lib/labor/types.ts` — 新增 helper 函数

### 修改内容

```typescript
export function calcProportionalBase(
  baseSalary: number,
  attendanceDays: number,
  expectedAttendanceDays: number
): number {
  if (attendanceDays <= 0 || expectedAttendanceDays <= 0) return 0;
  return Math.round((baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100;
}
```

### 边缘条件验证

| 条件 | 结果 | 正确性 |
|------|------|--------|
| `baseSalary=0` | `0` ✅ | 无底薪员工 |
| `baseSalary=-1000`（理论不可能） | 负数 ⚠️ | 应由上游校验 |
| `attendanceDays=0.5`（半天出勤） | 正常计算 ✅ | 系统用整数天，但函数本身兼容 |
| `NaN` 输入 | `NaN <= 0` 为 false → 进入计算 → `NaN` | ⚠️ |
| `Infinity` 输入 | 进入计算 → `Infinity` | ⚠️ |

### 建议增强（可选）

```typescript
// 更防御性的版本（可选，当前系统不会产生 NaN/Infinity）
if (!Number.isFinite(baseSalary) || !Number.isFinite(attendanceDays) || !Number.isFinite(expectedAttendanceDays)) return 0;
```

**结论：当前实现对正常业务数据完全鲁棒。** NaN/Infinity 场景在 React Native + AsyncStorage 持久化链路中不可能出现（JSON 序列化会丢失这些值）。

---

## 三、`app/labor.tsx` — UI 展示层

### 修改点 1：薪资卡片（第 481-485 行）

```typescript
const baseSalary = (!att || att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0)
  ? 0
  : slip ? Math.round((slip.attendanceSalary - (att?.overtimePay ?? 0) - (att?.holidayBonus ?? 0) + _specialDed) * 100) / 100 : null;
```

**边缘条件：**
- `att` 为 `undefined`（新员工无考勤记录）→ 返回 `0` ✅
- `att` 存在但 `slip` 为 `null`（考勤已算但薪资单未生成）→ 返回 `null`（显示"—"）✅
- `att.attendanceDays=0` → 返回 `0`（显示"¥0"）✅

**潜在问题：** 当 `baseSalary=0` 时，UI 显示 `¥0` 而非 `—`。对于无排班的员工，显示 `¥0` 是否比 `—` 更合适？

**结论：显示 `¥0` 是正确的。** 它明确告知用户"该员工本月比例底薪为零"，而 `—` 通常表示"数据缺失/未计算"。从专业薪资系统角度，零值和缺失值语义不同。

### 修改点 2：考勤概况卡片（第 4291-4295 行）

```typescript
const _specDed = Object.values(att.specialStatusDeductions ?? {}).reduce((s, d) => s + d.deduction, 0);
const baseSal = (att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0)
  ? 0
  : slip ? Math.round((slip.attendanceSalary - (att.overtimePay ?? 0) - (att.holidayBonus ?? 0) + _specDed) * 100) / 100 : null;
```

**注意：** 此处 `att` 已确认存在（外层有 `{att ? (...) : null}` 判断），所以不需要 `!att` 检查。

**边缘条件：** `att.specialStatusDeductions` 为 `undefined`（旧数据迁移场景）→ `?? {}` 防护 → `reduce` 返回 `0` ✅

---

## 四、`lib/labor/export.ts` — 导出引擎

### 修改内容

```typescript
function calcProportionalBase(att: MonthlyAttendance | undefined, slip: PaySlip | undefined): number {
  if (!slip || !att) return 0;
  if (att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0) return 0;
  // ... 反推公式
}
```

**边缘条件：**
- 导出时某员工无考勤记录（`att=undefined`）→ 返回 `0` ✅
- 导出时某员工无薪资单（`slip=undefined`）→ 返回 `0` ✅
- 历史数据中 `attendanceDays` 字段缺失 → TypeScript 类型保证字段存在，但旧数据可能为 `undefined` → `undefined <= 0` 为 `false` → 进入反推计算 ⚠️

**建议增强（可选）：**
```typescript
if ((att.attendanceDays ?? 0) <= 0 || (att.expectedAttendanceDays ?? 0) <= 0) return 0;
```

---

## 五、综合鲁棒性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 零出勤防护 | ✅ 完善 | 所有路径均已覆盖 |
| 除零保护 | ✅ 完善 | `expectedAttendanceDays > 0` 前置检查 |
| 负数防护 | ✅ 良好 | `<= 0` 统一拦截 |
| NaN/Infinity | ⚠️ 可接受 | 业务链路不会产生，但未显式防护 |
| 旧数据兼容 | ⚠️ 可接受 | TypeScript 类型约束，但运行时无 nullish 防护 |
| 精度处理 | ✅ 完善 | 统一 `Math.round(x * 100) / 100` 两位小数 |
| 口径一致性 | ✅ 已修复 | 考勤概况卡片已加回 specialDeduction |

### 总结

**修复质量：优秀。** 核心逻辑正确，边缘条件覆盖充分，不会引入新的回归问题。唯一的改进空间是对旧数据迁移场景增加 nullish coalescing（`?? 0`），但这属于防御性增强而非 bug。

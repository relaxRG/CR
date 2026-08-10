# 薪资模块开发规范

## 一、Bug 根因分析

### 1.1 直接原因

`lib/labor/store.tsx` 第 786 行的 `calcFromShifts` 函数中：

```typescript
// 旧代码（有 Bug）
const proportionalBase = expectedAttendanceDays > 0
  ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
  : employee.baseSalary;  // ← 当 expectedAttendanceDays=0 时回退到全额底薪
```

当 `expectedAttendanceDays = 0`（即 `restDaysPerMonth >= daysInMonth`）时，代码回退返回全额底薪而非 0。

### 1.2 深层原因

| 层面 | 问题 | 后果 |
|------|------|------|
| **架构层** | 比例底薪没有统一计算入口，多处使用反推公式 | 修复一处漏另一处，口径不一致 |
| **防御层** | 除法运算只检查分母，未检查分子（attendanceDays） | 零出勤时仍进入计算分支 |
| **数据层** | 跨月排班写入无来源标记，UI 措辞误导用户 | 用户不知道数据已写入目标月份 |
| **测试层** | E2E 测试未覆盖零出勤边界场景 | Bug 长期未被发现 |
| **展示层** | UI 使用反推公式而非正向计算 | 计算引擎修复后 UI 仍可能显示错误 |

### 1.3 根本原因

**违反了 Single Source of Truth 原则**：比例底薪的计算逻辑分散在 5 个位置（store.tsx、labor.tsx ×3、export.ts），每处使用不同的公式变体，导致修复不彻底。

---

## 二、开发规范（避免类似问题）

### 规范 1：派生值必须有统一计算入口

> **所有派生值（如比例底薪、日薪、加班费）必须通过 `lib/labor/types.ts` 中的导出函数计算，禁止在 UI 层或导出层内联重新实现。**

```typescript
// ✅ 正确：使用统一 helper
import { calcProportionalBase } from "@/lib/labor/types";
const base = calcProportionalBase(baseSalary, attendanceDays, expectedDays);

// ❌ 错误：内联反推公式
const base = slip.attendanceSalary - overtimePay - holidayBonus + specialDeduction;
```

### 规范 2：除法运算必须同时检查分子和分母

> **任何涉及除法的薪资计算，必须同时验证分子 > 0 和分母 > 0，且回退值为 0（而非全额）。**

```typescript
// ✅ 正确
const result = (numerator > 0 && denominator > 0)
  ? Math.round((value * numerator / denominator) * 100) / 100
  : 0;

// ❌ 错误
const result = denominator > 0
  ? Math.round((value * numerator / denominator) * 100) / 100
  : value; // 回退到全额是危险的
```

### 规范 3：边界条件必须有对应测试用例

> **每个计算函数必须覆盖以下边界场景的测试：**

| 场景 | 测试要求 |
|------|---------|
| 零值输入 | 所有参数为 0 时返回 0 |
| 配置异常 | restDays >= daysInMonth 时不崩溃 |
| 负值防护 | 负数输入时返回 0 |
| 精度验证 | 结果精确到分（两位小数） |
| 闭环验证 | 分项之和 = 总额 |

### 规范 4：跨月数据操作必须标记来源

> **任何写入非当前视图月份的数据操作，必须：**
> 1. 在数据中标记 `sourceMonth`（来源月份）
> 2. UI 中明确告知用户影响范围
> 3. 薪资计算前通过 `validation.ts` 校验

### 规范 5：UI 展示值必须来自持久化数据或统一 helper

> **UI 层禁止通过反推公式从其他字段推导展示值。如需展示派生值，必须：**
> 1. 优先从持久化的 attendance/slip 字段直接读取
> 2. 若需计算，调用 `types.ts` 中的统一 helper
> 3. 禁止在 JSX 内联中编写计算逻辑超过一行

### 规范 6：测试文件中的计算逻辑必须与生产代码同步

> **`tests/` 中的纯函数版计算逻辑（如 `calcFromShiftsPure`）必须与 `store.tsx` 保持完全一致。任何修改 store.tsx 的 PR 必须同步更新测试文件。**

---

## 三、代码审查清单

PR 涉及薪资计算时，审查者必须检查：

- [ ] 是否使用了统一 helper（`calcProportionalBase`, `calcDailyRate`）
- [ ] 除法运算是否同时检查分子和分母
- [ ] 回退值是否为 0（而非全额或 undefined）
- [ ] 是否有对应的边界条件测试
- [ ] `tests/attendance-payroll-e2e.test.ts` 中的纯函数是否同步更新
- [ ] 导出模块（`export.ts`）是否与 UI 口径一致
- [ ] 跨月操作是否有来源标记和用户提示

---

## 四、文件职责划分

| 文件 | 职责 | 禁止 |
|------|------|------|
| `lib/labor/types.ts` | 类型定义 + 纯计算函数 | 禁止包含 React/状态逻辑 |
| `lib/labor/store.tsx` | 状态管理 + 持久化 + 业务引擎 | 禁止包含 UI 逻辑 |
| `lib/labor/validation.ts` | 数据校验规则 | 禁止修改数据 |
| `lib/labor/export.ts` | 导出格式化 | 禁止重新实现计算逻辑 |
| `app/labor.tsx` | UI 展示 + 用户交互 | 禁止内联计算公式 |

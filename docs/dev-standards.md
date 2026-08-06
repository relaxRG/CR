# cocktail R — 开发规范

> 版本：2026-08-06 | 适用范围：排班/考勤/薪资引擎

---

## 一、本次 Bug 根因分析

### Bug 描述

删除所有排班后，考勤卡片仍显示全勤（出勤 31/27）和节假日薪资（+¥800）。

### 根因

考勤/薪资自动同步引擎（`useEffect` + `runPayrollGeneration`）中存在以下跳过逻辑：

```ts
// ❌ 错误写法
const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
if (empShifts.length === 0) continue;  // 跳过空排班员工
```

**问题本质**：该逻辑假设"没有排班 = 不需要更新"，但实际上"没有排班 = 出勤为 0，需要将旧的考勤记录归零"。

由于 `continue` 跳过了 `upsertAttendance` 和 `upsertPaySlip` 的调用，AsyncStorage 中的旧考勤数据（全勤、节假日薪资）永久残留，UI 读取持久化记录时显示的是旧数据。

### 修复方案

```ts
// ✅ 正确写法
const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
// 不跳过空排班！空排班 → calcFromShifts 返回 attendanceDays=0, attendanceSalary=0
// 必须调用 upsertAttendance 将旧记录归零
const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, []);
upsertAttendance(att);
```

---

## 二、核心开发规范

### 规范 1：持久化数据必须显式归零，不能依赖"不写入"

**原则**：当业务数据被清空（如删除排班、清空记录），必须主动将关联的派生数据（考勤、薪资单）重新计算并写入持久化存储，而不是跳过写入。

```ts
// ❌ 错误：假设"没有数据 = 不需要更新"
if (records.length === 0) continue;

// ✅ 正确：没有数据时也要重新计算（结果为 0），并写入存储
const result = compute(records);  // 空输入 → 零值输出
persist(result);
```

**适用场景**：
- 排班清空 → 考勤归零 → 薪资单归零
- 备用金记录清空 → 月报科目行归零
- 进货记录清空 → 库存成本归零

---

### 规范 2：单一数据源原则（Single Source of Truth）

考勤/薪资数据的流向必须是单向的：

```
排班数据（shifts）
    ↓ calcFromShifts()
考勤记录（MonthlyAttendance）
    ↓ buildPaySlipDraft()
薪资单（PaySlip）
    ↓ 只读展示
UI 组件
```

**禁止**：UI 组件直接修改 `attendanceSalary`、`grossSalary`、`finalSalary` 的基础值。

**允许**：以下增量操作可以直接 patch 薪资单（因为它们是独立的增量项，不依赖排班）：
- `compOffCashOut`（调休兑现，增量加入）
- `rewardPenalty`（奖惩，增量加入）
- `performanceBonus`（绩效，手动录入）
- `advanceAmount`（预支，手动录入）
- `pettyLaborPaid`（备用金已付，同步）

---

### 规范 3：自动同步 useEffect 的依赖数组必须完整

自动同步 `useEffect` 的依赖数组必须包含所有可能触发重算的数据源：

```ts
// ✅ 正确：shifts 变化（包括删除）会触发重算
}, [shifts, currentMonth, employees, advances]);
```

**检查清单**：
- [ ] `shifts` 在依赖数组中（删除排班时触发）
- [ ] `currentMonth` 在依赖数组中（切换月份时触发）
- [ ] `employees` 在依赖数组中（修改员工底薪/配置时触发）
- [ ] `advances` 在依赖数组中（修改预支时触发）

---

### 规范 4：考勤计算引擎（calcFromShifts）的契约

`calcFromShifts` 是考勤计算的唯一入口，其行为契约：

| 输入 | 输出 |
|------|------|
| 空 `shifts` 数组 | `attendanceDays=0`, `holidayBonus=0`, `attendanceSalary=0` |
| 正常排班 | 按实际出勤天数比例计算 |
| 含节假日特殊状态 | 额外计算 `holidayBonus` |

**禁止**：在调用 `calcFromShifts` 之前对空输入做短路（`if (shifts.length === 0) return`）。

---

### 规范 5：废弃代码必须立即删除，不留注释占位

```ts
// ❌ 错误：留下废弃注释
// ─── 旧 CompOffStore 已删除，由 CompOffBalanceEntryStore 替代 ─────────────────

// ✅ 正确：直接删除，不留痕迹
// （无内容）
```

**原则**：废弃代码的历史记录由 Git 保存，源码中不应出现"已删除/已移除/已废弃"的注释占位符。

---

### 规范 6：数据迁移代码的生命周期

持久化迁移代码（`useEffect` 中的 migration）应在以下情况下删除：

1. 该 App 版本已在 TestFlight/App Store 上线超过 **3 个月**
2. 所有用户设备的数据已完成迁移（可通过版本号判断）

迁移代码删除前，必须在 `todo.md` 中记录计划删除时间。

---

## 三、受影响的关联模块清单

| 模块 | 文件 | 影响类型 | 修复状态 |
|------|------|---------|---------|
| 自动同步引擎 | `app/labor.tsx:3108` | 空排班跳过 → 旧数据残留 | ✅ 已修复 |
| 手动生成薪资单 | `app/labor.tsx:3267` | 空排班跳过 → 旧数据残留 | ✅ 已修复 |
| 废弃注释（旧 CompOffStore） | `lib/labor/store.tsx:765` | 代码噪音 | ✅ 已删除 |
| 废弃注释（旧绩效 Store） | `lib/labor/store.tsx:766` | 代码噪音 | ✅ 已删除 |
| 废弃注释（旧绩效系统） | `lib/labor/types.ts:668` | 代码噪音 | ✅ 已删除 |
| 废弃注释（DEPT_OPTIONS_SCH） | `app/labor.tsx:4209` | 代码噪音 | ✅ 已删除 |
| 员工废弃字段迁移 | `lib/labor/store.tsx:101` | 持久化迁移（保留） | ✅ 正常运行 |
| 排班废弃字段迁移 | `lib/labor/store.tsx:443` | 持久化迁移（保留） | ✅ 正常运行 |
| 调休兑现 patch | `app/labor.tsx:404` | 增量 patch（合理） | ✅ 无需修改 |
| KPI/补贴 patch | `app/labor-kpi-allowance.tsx:128` | 增量 patch（合理） | ✅ 无需修改 |

---

## 四、类似问题的排查清单

当遇到"删除数据后 UI 仍显示旧值"类问题时，按以下顺序排查：

1. **检查 UI 读取的是持久化记录还是实时计算**
   - 如果读取 `records.find(...)` → 是持久化记录，可能有旧数据
   - 如果读取 `calcFromShifts(...)` → 是实时计算，不会有旧数据

2. **检查自动同步 useEffect 是否有跳过逻辑**
   - 搜索 `continue`、`return`、`length === 0` 等短路条件
   - 确认删除操作是否会触发 useEffect（依赖数组是否包含相关数据）

3. **检查是否有多个写入路径**
   - 自动同步 + 手动生成是否都会更新持久化记录
   - 两条路径是否都正确处理了空输入

4. **验证修复**
   - 删除所有排班 → 等待 500ms → 考勤卡片应显示 0 出勤
   - 重新生成薪资单 → 薪资单应显示 0 考勤工资

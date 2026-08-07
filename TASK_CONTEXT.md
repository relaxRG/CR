# cocktail R — 任务上下文

## 最新状态（2026-08-07）

**当前 Build：135**（月报系统 v2 续：货款 Tab 独立分组 + 手工增删改）

---

## 已修复问题

### 问题 1：装饰条目无法进入 Garnish Tab ✅ 已修复
- 根本原因：homemade-form.tsx 中 `isGarnishType` 推断逻辑不准确
- 修复：增加顶层分组选择器（含酒精/无酒精/装饰），`handleSave` 直接用 `selectedGroup` 写入 `abvGroup`

### 问题 2：类型标签全部混在一起 ✅ 已修复
- 根本原因：类型选择区域显示了所有三组
- 修复：类型选择区域只显示当前选中分组的类型

### 问题 3：排班清空后考勤卡仍显示全勤/节假日薪资 ✅ 已修复（Build 134）

**根本原因**：考勤/薪资自动同步引擎中存在空排班跳过逻辑：

```ts
// ❌ 错误写法（已删除）
if (empShifts.length === 0) continue;
```

该逻辑假设"没有排班 = 不需要更新"，但实际上"没有排班 = 出勤为 0，需要将旧考勤记录归零"。由于跳过了 `upsertAttendance` 和 `upsertPaySlip`，AsyncStorage 中的旧考勤数据永久残留。

**修复位置**：
1. `app/labor.tsx:3108`（自动同步 useEffect）— 移除 `continue`
2. `app/labor.tsx:3267`（手动生成薪资单 `runPayrollGeneration`）— 移除 `continue`

**同步删除的废弃代码**：
- `lib/labor/store.tsx`：废弃注释（旧 CompOffStore/旧绩效 Store）
- `lib/labor/types.ts`：废弃注释（旧绩效系统）
- `app/labor.tsx`：废弃注释（DEPT_OPTIONS_SCH）

---

## 开发规范

详见 `docs/dev-standards.md`，核心规范：

**规范 1：持久化数据必须显式归零**
> 当业务数据被清空（如删除排班），必须主动将关联派生数据重新计算并写入存储，而不是跳过写入。

**规范 2：单一数据源原则**
> 数据流向：排班 → `calcFromShifts()` → 考勤 → `buildPaySlipDraft()` → 薪资单 → UI

**规范 3：自动同步 useEffect 依赖数组必须完整**
> 必须包含 `shifts`、`currentMonth`、`employees`、`advances`

**规范 4：`calcFromShifts` 空输入契约**
> 空 shifts 数组 → `attendanceDays=0`, `holidayBonus=0`, `attendanceSalary=0`，禁止在调用前短路

**规范 5：废弃代码立即删除**
> 不留注释占位符，历史由 Git 保存

---

## 关键文件

| 文件 | 职责 |
|------|------|
| `app/labor.tsx` | 排班表 + 考勤卡片 + 薪资统计主页面 |
| `lib/labor/store.tsx` | 考勤/薪资/员工/排班持久化存储和计算引擎 |
| `lib/labor/types.ts` | 所有 labor 模块类型定义 |
| `app/labor-attendance.tsx` | 薪资总览页面 |
| `app/labor-kpi-allowance.tsx` | KPI/补贴编辑页面 |
| `docs/dev-standards.md` | 开发规范文档 |

---

## 架构说明

### 考勤计算数据流

```
shifts（排班数据，AsyncStorage: labor_shifts_v1）
    ↓ calcFromShifts()  [lib/labor/store.tsx]
MonthlyAttendance（考勤记录，AsyncStorage: labor_attendance_v1）
    ↓ buildPaySlipDraft()  [lib/labor/store.tsx]
PaySlip（薪资单，AsyncStorage: labor_payslips_v1）
    ↓
UI 展示（labor.tsx 考勤卡片 / labor-attendance.tsx 薪资总览）
```

### 自动同步触发条件

`useEffect` 依赖 `[shifts, currentMonth, employees, advances]`：
- 排班变化（增加/删除/修改）→ 500ms 防抖后重算所有员工考勤+薪资单
- 月份切换 → 立即重算
- 员工配置变化（底薪/社保等）→ 立即重算
- 预支变化 → 立即重算

### 手动生成薪资单

`runPayrollGeneration`（点击"生成薪资单"按钮触发）：
- 处理节假日换休/拿钱决策
- 消耗调休余额
- 生成完整薪资单（含节假日补偿分配）
- 空排班员工也会生成（考勤归零）

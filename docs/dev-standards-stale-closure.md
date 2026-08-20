# 开发规范：月份隔离与 stale closure 防治

> 版本：2026-08-11 | 适用范围：所有涉及薪资/考勤/预支的 React 组件和 Store

---

## 一、问题背景

本项目曾因以下两类问题导致绩效补贴数据反复丢失（累计修复 5 次以上）：

1. **控制字段丢失**：`buildPaySlipDraft` 返回值不包含 `allowanceOverrides`/`workKPISelections`/`revenueActuals`，`autoSync` 每次触发都会清除用户的绩效设置。
2. **stale closure**：`useEffect` 依赖数组不完整，闭包捕获了旧的 state 快照，导致读取到过期数据。

---

## 二、月份隔离规范

### 规则 1：数据聚合必须明确 month 作用域

任何从全局数组（`paySlips`、`advances`、`attendances`）聚合数据时，**必须**明确 month 约束：

```typescript
// ❌ 错误：无月份过滤，会统计所有月份
const advanceTotal = advances
  .filter(a => a.employeeId === emp.id)
  .reduce((s, a) => s + a.amount, 0);

// ✅ 正确：明确 deductMonth 或 date 约束
const advanceTotal = advances
  .filter(a =>
    a.employeeId === emp.id &&
    (a.deductMonth === month || a.date.startsWith(month)) &&
    (a.status === "pending" || a.status === "deducted")
  )
  .reduce((s, a) => s + a.amount, 0);
```

### 规则 2：优先使用 ref-based getter 而非 state 变量

在 `useEffect` 闭包中读取 store 数据时，**优先使用** `getPaySlip`/`getAttendance` 等基于 `ref.current` 的 getter，而非直接读取 state 变量：

```typescript
// ❌ 错误：paySlips 可能是 stale closure
const existingSlip = paySlips.find(s => s.employeeId === emp.id && s.month === currentMonth);

// ✅ 正确：getPaySlip 基于 ref.current，始终是最新值
const existingSlip = getPaySlip(emp.id, currentMonth);
```

### 规则 3：buildPaySlipDraft 必须保留手动控制字段，但绝不继承调休兑现金额

`buildPaySlipDraft` 的返回值**必须**包含以下字段（从 `existing` 读取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `allowanceOverrides` | `existing?.allowanceOverrides` | 用户手动勾选/取消的补贴 |
| `workKPISelections` | `existing?.workKPISelections` | 用户选择的工作绩效档位 |
| `revenueActuals` | `existing?.revenueActuals` | 用户填写的业绩实际金额 |
| `compOffCashOutSettlement` | **不得从 `existing` 读取** | 必须由当次 `settleCompOffCashOut()` 的 active 事件生成快照 |
| `holidayBonusAllocation` | `existing?.holidayBonusAllocation` | 节假日奖金分配 |
| `pettyLaborPaid` | `existing?.pettyLaborPaid` | 备用金已付金额 |
| `rewardPenaltyItems` | `existing?.rewardPenaltyItems` | 奖惩明细 |

**不保留手动控制字段会导致 `autoSync` 每次触发时清除用户设置。** 调休兑现不属于手动控制字段：重建时必须重新汇总实时账本，生成 `eventIds + amount + verifiedAt` 快照；旧薪资单的裸金额只能迁入隔离区，绝不能继承。

---

### 规则 3.1：隔离区完整性检查不得被自动同步跳过

自动同步、手动重算、导出和月结前均必须运行兑现账本完整性检查。只允许 `active` 且费率、金额、员工、月份、余额条目、来源、天数全部一致的事件参与汇总；`quarantined`、`voided`、重复事件 ID、快照不一致和旧裸金额必须停留在核对区，草稿月重建、已确认月创建更正会话。

## 三、stale closure 防治规范

### 规则 4：useEffect 依赖数组必须完整

`useEffect` 中使用的所有外部变量**必须**加入依赖数组，除非：
- 该变量是 `ref.current`（同步更新，不需要）
- 该变量是 `useCallback`/`useMemo` 的稳定引用
- 故意排除以防止无限循环（需注释说明）

```typescript
// ❌ 错误：globalSettings 和 specialStatuses 不在依赖数组中
React.useEffect(() => {
  // ... 使用了 globalSettings 和 specialStatuses
}, [shifts, currentMonth, employees, advances]);

// ✅ 正确：所有使用的变量都在依赖数组中
React.useEffect(() => {
  // ... 使用了 globalSettings 和 specialStatuses
}, [shifts, currentMonth, employees, advances, globalSettings, specialStatuses]);
// 注：paySlips 故意不加入，因为 autoSync 写入 paySlips 会导致无限循环
```

### 规则 5：故意排除的依赖必须注释说明

```typescript
// ✅ 正确：故意排除 paySlips，并注释原因
}, [shifts, currentMonth, employees, advances, globalSettings, specialStatuses]);
// 注：paySlips 故意不加入依赖数组，因为 autoSync 写入 paySlips 后会触发自身（无限循环）
// 改用 getPaySlip(ref.current) 读取最新数据，不受 stale closure 影响
```

---

## 四、保存时序规范（三步走模式）

涉及"先写控制字段，再全量重算"的场景，必须遵循三步走模式：

```typescript
// Step 1：先写入控制字段（让 buildPaySlipDraft 能读到最新值）
upsertPaySlip({ ...existing, allowanceOverrides, workKPISelections, revenueActuals });

// Step 2：全量重算（buildPaySlipDraft 内部从 ref.current 读取 Step 1 写入的控制字段）
const draft = buildPaySlipDraft(employee, month, att, performanceTotal, advanceAmount, globalSettings);

// Step 3：原子性写入（draft 已包含所有控制字段，无需再次显式传入）
upsertPaySlip({ ...draft, id: existing.id });
```

**不要**在 Step 3 中再次显式传入控制字段，这会造成两个来源的控制字段，容易引发不一致。

---

## 五、快速检查清单

在提交涉及薪资/考勤/预支的代码前，检查以下项目：

- [ ] 所有 `advances.filter` 是否有 `month`/`deductMonth` 约束？
- [ ] 所有 `paySlips.find/filter` 是否有 `month` 约束（或是全量操作）？
- [ ] `useEffect` 中使用的 store state 是否都在依赖数组中？
- [ ] 故意排除的依赖是否有注释说明？
- [ ] `buildPaySlipDraft` 调用后的 `upsertPaySlip` 是否使用了 `{ ...draft, id }` 简洁形式？
- [ ] 新增的 `buildXxxDraft` 函数是否保留了所有手动控制字段？

---

## 六、已知的合理例外

以下场景**不需要** month 过滤，是设计意图：

| 场景 | 原因 |
|------|------|
| `薪资预支管理页 totalPending` | 全历史视图，显示所有未扣除预支总额 |
| `data-integrity-check.ts` | 完整性检查需要扫描所有月份 |
| `labor-salary-history.tsx` | 年度历史视图，按员工展示所有月份 |
| `advance-store.tsx deleteAdvance` | 按 id 删除，不需要月份约束 |
| `prevMonthSlips（个税累计）` | 历史月份数据，不被 autoSync 修改，stale 风险极低 |

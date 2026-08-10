# "确认发薪"快照机制设计

## 一、核心概念

| 概念 | 说明 |
|------|------|
| **实时计算** | 当月薪资始终从排班/考勤/规则实时派生，随时可变 |
| **确认发薪** | 管理者在月报页面点击"确认发薪"，生成不可变快照 |
| **快照（Frozen Snapshot）** | 确认时刻的薪资数据副本，用于历史审计 |
| **差额调整单** | 确认后修改排班/考勤产生的差异记录 |

---

## 二、数据结构设计

### 2.1 PaySlip 新增字段

```typescript
export interface PaySlip {
  // ... 现有字段 ...

  /** 确认发薪时间戳（有值 = 已确认） */
  frozenAt?: number;
  /** 确认人（管理者 ID 或名称） */
  frozenBy?: string;
  /** 确认时的快照数据（不可变副本） */
  frozenSnapshot?: {
    grossSalary: number;
    finalSalary: number;
    attendanceSalary: number;
    mealAllowance: number;
    transportAllowance: number;
    otherAllowance: number;
    performanceBonus: number;
    socialInsuranceDeduction: number;
    housingFundDeduction: number;
  };
  /** 差额调整（确认后修改产生的差异） */
  adjustment?: {
    /** 调整金额（正=应补发，负=应扣回） */
    amount: number;
    /** 调整原因 */
    reason: string;
    /** 调整产生时间 */
    createdAt: number;
    /** 是否已在后续月份处理 */
    settled: boolean;
    /** 处理月份（如 "2026-08"） */
    settledInMonth?: string;
  };
}
```

### 2.2 月报新增字段

```typescript
export interface MonthlyPayrollReport {
  month: string;
  /** 确认状态 */
  status: "draft" | "confirmed";
  /** 确认时间 */
  confirmedAt?: number;
  /** 确认人 */
  confirmedBy?: string;
  /** 确认时的汇总数据 */
  summary?: {
    totalEmployees: number;
    totalGrossSalary: number;
    totalFinalSalary: number;
    totalDeductions: number;
  };
  /** 待处理的差额调整 */
  pendingAdjustments?: Array<{
    employeeId: string;
    employeeName: string;
    amount: number;
    reason: string;
  }>;
}
```

---

## 三、放置位置：月报页面

### 3.1 UI 布局

```
┌─────────────────────────────────────────────────────┐
│  月报 · 2026年7月                                    │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐    │
│  │  状态：⚠️ 未确认                              │    │
│  │  [确认发薪] 按钮                              │    │
│  │  提示：确认后薪资数据将生成不可变快照          │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  汇总信息：                                          │
│  总人数：8人 | 总应发：¥52,380 | 总实发：¥48,210    │
│                                                     │
│  员工明细列表...                                     │
└─────────────────────────────────────────────────────┘
```

确认后：

```
┌─────────────────────────────────────────────────────┐
│  月报 · 2026年7月                                    │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐    │
│  │  状态：✅ 已确认（2026-08-01 18:30）          │    │
│  │  [撤销确认] (需长按)                          │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ⚠️ 待处理调整：                                     │
│  · 子豪：+¥390（排班修正，餐补增加）                 │
│  · [处理调整] [忽略]                                 │
│                                                     │
│  汇总信息...                                         │
└─────────────────────────────────────────────────────┘
```

### 3.2 交互流程

```
1. 管理者进入月报页面
2. 系统自动触发全量重算（确保数据最新）
3. 管理者审核各员工薪资
4. 点击"确认发薪"
5. 弹出确认对话框：
   "确认 2026年7月 薪资发放？
    总人数：8人
    总实发：¥48,210
    确认后将生成不可变快照。"
6. 确认 → 为每个员工的 PaySlip 写入 frozenAt + frozenSnapshot
7. 月报状态变为 "confirmed"
```

---

## 四、联动机制

### 4.1 确认后修改排班/考勤

```
管理者修改7月排班（已确认月份）
    ↓
autoSync 触发 → 重新计算薪资
    ↓
系统检测到 slip.frozenAt 有值
    ↓
比较新计算值与 frozenSnapshot
    ↓
如果有差异 → 自动生成 adjustment 记录
    ↓
薪资统计页显示：⚠️ 有待处理调整
月报页显示：⚠️ 待处理调整列表
```

### 4.2 差额处理方式

| 方式 | 说明 | 操作 |
|------|------|------|
| **计入下月** | 差额自动加入下月薪资的 `adjustmentFromPrevMonth` | 默认方式 |
| **单独补发** | 管理者手动标记为"已单独处理" | 手动确认 |
| **忽略** | 差额太小或已口头协商 | 手动忽略 |

### 4.3 下月薪资自动包含调整

```typescript
// buildPaySlipDraft 中新增逻辑
const prevMonthSlip = getPaySlip(employeeId, prevMonth);
const adjustmentFromPrev = prevMonthSlip?.adjustment?.settled === false
  ? prevMonthSlip.adjustment.amount
  : 0;

const grossSalary = attendanceSalary + performanceTotal + ... + adjustmentFromPrev;
```

---

## 五、对员工管理页面的影响

### 5.1 薪资统计页

| 场景 | 未确认月份 | 已确认月份 |
|------|-----------|-----------|
| 薪资卡片 | 实时计算值 | 实时计算值（但标记差异） |
| "编辑薪资"按钮 | ✅ 正常 | ⚠️ 显示"此月已确认" |
| 综合额外 | 实时值 | 实时值 |

### 5.2 排班表

| 场景 | 未确认月份 | 已确认月份 |
|------|-----------|-----------|
| 添加/修改排班 | ✅ 正常 | ✅ 允许，但显示 ⚠️ 提示 |
| 提示文案 | 无 | "此月已确认发薪，修改将产生差额调整" |

### 5.3 员工档案

| 修改项 | 影响 |
|--------|------|
| 修改底薪 | **不影响已确认月份**（只影响未来月份） |
| 修改补贴规则 | **不影响已确认月份**（只影响未来月份） |
| 修改社保配置 | **不影响已确认月份** |

---

## 六、实施路径

### Phase 1（当前 P3）— 数据结构准备

- [x] `PaySlip` 增加 `frozenAt`、`frozenBy`、`frozenSnapshot`、`adjustment` 字段
- [ ] 月报数据结构增加 `status`、`confirmedAt` 字段

### Phase 2 — 确认逻辑

- [ ] 月报页面添加"确认发薪"按钮
- [ ] 确认时写入 frozenSnapshot
- [ ] autoSync 中检测 frozenAt 并生成 adjustment

### Phase 3 — 差额联动

- [ ] 薪资统计页显示差额标记
- [ ] 排班表显示已确认月份提示
- [ ] 下月 buildPaySlipDraft 自动包含 adjustmentFromPrev

### Phase 4 — 撤销与权限

- [ ] 撤销确认功能（长按触发）
- [ ] 操作日志记录

---

## 七、代码改动预估

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `lib/labor/types.ts` | +30行 | 新增字段定义 |
| `lib/labor/store.tsx` | +80行 | 确认/撤销/差额检测逻辑 |
| `app/labor.tsx` | +50行 | 薪资卡片差额标记 + 排班提示 |
| `app/labor-monthly-report.tsx` | +120行 | 确认按钮 + 状态展示 |
| `tests/` | +60行 | 确认/差额/联动测试 |

**总计约 340 行新增代码。**

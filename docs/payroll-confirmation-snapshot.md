# "确认发薪"快照机制设计（完整版）

## 一、核心设计理念

**确认发薪 = 整个月的员工管理全部锁定。**

- 确认后：排班、考勤、薪资、补贴、调休、预支等全部变为只读
- 需要修改：必须先点击"差额调整"按钮进入调整模式
- 调整完成：自动计算差额，重新锁定

---

## 二、锁定范围 — 完整清单

### 经代码验证的所有当月数据写操作（18个入口）

| # | 模块 | 写操作 | 锁定后状态 |
|---|------|--------|-----------|
| 1 | 排班表 | `upsertShift`（单条排班） | 🔒 禁止 |
| 2 | 排班表 | `batchUpsertShifts`（批量排班） | 🔒 禁止 |
| 3 | 排班表 | `deleteShift`（删除排班） | 🔒 禁止 |
| 4 | 排班表 | `batchDeleteShifts`（批量删除） | 🔒 禁止 |
| 5 | 排班表 | 快速填充（长按姓名） | 🔒 禁止 |
| 6 | 排班表 | 排班导入 | 🔒 禁止 |
| 7 | 考勤 | `upsertAttendance`（autoSync） | 🔒 禁止（autoSync 跳过已确认月） |
| 8 | 考勤 | 特殊状态标记（旷工/迟到/病假） | 🔒 禁止 |
| 9 | 薪资单 | `upsertPaySlip`（autoSync） | 🔒 禁止（autoSync 跳过已确认月） |
| 10 | 薪资单 | 编辑薪资（手动修改） | 🔒 禁止 |
| 11 | 预支 | `addAdvance`（新增预支） | 🔒 禁止 |
| 12 | 预支 | `deleteAdvance`（删除预支） | 🔒 禁止 |
| 13 | 调休 | `addCompOffEntry`（存入加班调休） | 🔒 禁止 |
| 14 | 调休 | `cashOutCompOff`（兑换调休） | 🔒 禁止 |
| 15 | 节假日换休 | `addHolidayCompOff`（存入） | 🔒 禁止 |
| 16 | 节假日换休 | `updateHolidayCompOff`（修改） | 🔒 禁止 |
| 17 | 节假日换休 | `toggleMode`（拿钱↔换休切换） | 🔒 禁止 |
| 18 | 绩效补贴 | `handleSave`（保存绩效配置） | 🔒 禁止 |

### 不锁定的操作

| 操作 | 原因 |
|------|------|
| 排班模板（新增/修改/删除） | 模板是全局配置，不属于当月数据 |
| 付款信息（复制到剪贴板） | 只读操作 |
| 导出/对比/历史查看 | 只读操作 |
| 员工档案修改（底薪/时薪/补贴规则/社保） | 面向未来，不影响已确认月份 |
| 月份切换/浏览 | 只读导航 |

---

## 三、状态机

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌─────────┐     确认发薪      ┌─────────┐                 │
│   │  DRAFT  │ ─────────────────→ │ FROZEN  │                 │
│   │ (草稿)  │                    │ (已锁定) │                 │
│   └─────────┘                    └────┬────┘                 │
│       ↑                               │                      │
│       │                          点击"差额调整"               │
│       │                               ↓                      │
│       │                         ┌───────────┐                │
│       │         确认调整         │ ADJUSTING │                │
│       └─────────────────────── │ (调整模式) │                │
│                                 └───────────┘                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| 状态 | UI 表现 | 允许的操作 |
|------|---------|-----------|
| **DRAFT** | 正常（所有操作可用） | 全部 |
| **FROZEN** | 灰色/只读（操作按钮隐藏或禁用） | 仅查看 + "差额调整"按钮 |
| **ADJUSTING** | 橙色边框标记"调整中" | 全部操作可用 + "确认调整"按钮 |

---

## 四、数据结构

### 4.1 PaySlip 新增字段

```typescript
export interface PaySlip {
  // ... 现有字段 ...

  /** 确认发薪时间戳（有值 = 已确认/已锁定） */
  frozenAt?: number;
  /** 确认人 */
  frozenBy?: string;
  /** 确认时的快照（不可变副本，用于差额计算） */
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
    advanceAmount: number;
  };
}
```

### 4.2 月度确认状态（新增 Store）

```typescript
export interface MonthlyConfirmation {
  month: string;
  /** 状态：draft | frozen | adjusting */
  status: "draft" | "frozen" | "adjusting";
  /** 确认时间 */
  frozenAt?: number;
  /** 确认人 */
  frozenBy?: string;
  /** 进入调整模式的时间 */
  adjustingAt?: number;
  /** 调整历史 */
  adjustments: Array<{
    id: string;
    /** 调整时间 */
    createdAt: number;
    /** 涉及员工 */
    employeeId: string;
    employeeName: string;
    /** 差额金额（正=应补发，负=应扣回） */
    amount: number;
    /** 差额明细 */
    details: string;
    /** 是否已处理 */
    settled: boolean;
    /** 处理方式 */
    settleMethod?: "next_month" | "separate" | "ignored";
    /** 处理月份 */
    settledInMonth?: string;
  }>;
}
```

---

## 五、交互流程

### 5.1 确认发薪

```
1. 管理者进入月报页面
2. 查看当月所有员工薪资汇总
3. 点击"确认发薪"按钮
4. 弹出确认对话框：
   ┌─────────────────────────────────────────┐
   │  确认 2026年7月 薪资发放？               │
   │                                         │
   │  总人数：8人                              │
   │  总实发：¥48,210                          │
   │                                         │
   │  确认后本月所有员工管理数据将被锁定。      │
   │  如需修改请使用"差额调整"功能。            │
   │                                         │
   │       [取消]        [确认发薪]            │
   └─────────────────────────────────────────┘
5. 确认 → 状态变为 FROZEN
6. 为每个员工的 PaySlip 写入 frozenAt + frozenSnapshot
7. 所有当月操作入口变为只读/禁用
```

### 5.2 进入调整模式

```
1. 管理者在已锁定月份发现错误
2. 在月报页面（或薪资统计页顶部）点击"差额调整"按钮
3. 弹出确认对话框：
   ┌─────────────────────────────────────────┐
   │  进入差额调整模式？                       │
   │                                         │
   │  调整模式下可修改本月排班、考勤等数据。    │
   │  修改完成后请点击"确认调整"。              │
   │  系统将自动计算与原确认值的差额。          │
   │                                         │
   │       [取消]        [进入调整]            │
   └─────────────────────────────────────────┘
4. 确认 → 状态变为 ADJUSTING
5. 所有操作入口恢复可用（标记橙色"调整中"）
6. 管理者进行修改（排班/考勤/补贴等）
7. autoSync 正常触发，重算薪资
```

### 5.3 确认调整

```
1. 管理者修改完成
2. 点击"确认调整"按钮
3. 系统自动计算差额：
   - 对每个员工：新 finalSalary - frozenSnapshot.finalSalary = 差额
4. 弹出差额确认对话框：
   ┌─────────────────────────────────────────┐
   │  调整结果                                │
   │                                         │
   │  子豪：+¥390（餐补增加）                  │
   │  朱大哥：-¥280（排班修正）                │
   │                                         │
   │  差额处理方式：                           │
   │  ○ 计入下月薪资（默认）                   │
   │  ○ 单独补发/扣回                          │
   │  ○ 忽略                                  │
   │                                         │
   │       [返回修改]     [确认调整]            │
   └─────────────────────────────────────────┘
5. 确认 → 生成调整记录 → 状态回到 FROZEN
6. 更新 frozenSnapshot 为最新值
7. 所有操作入口重新锁定
```

---

## 六、UI 变化

### 6.1 薪资统计页

| 状态 | 顶部提示 | 操作按钮 |
|------|---------|---------|
| DRAFT | 无 | 全部可用 |
| FROZEN | `🔒 本月已确认发薪（08-01 18:30）` | 隐藏"编辑薪资"/"绩效补贴" |
| ADJUSTING | `⚠️ 调整模式 — 修改完成后请确认调整` | 全部可用（橙色高亮） |

### 6.2 排班表

| 状态 | 格子交互 | 工具栏 |
|------|---------|--------|
| DRAFT | 正常点击 | 编辑/导入/快速填充可用 |
| FROZEN | 不可点击（灰色蒙层） | 编辑/导入/快速填充禁用 |
| ADJUSTING | 正常点击（橙色边框） | 全部可用 |

### 6.3 薪资卡片

| 状态 | 按钮行 | 调休操作 |
|------|--------|---------|
| DRAFT | 绩效补贴 / 编辑薪资 / 付款信息 / 历史 | 存入/兑换可用 |
| FROZEN | 付款信息 / 历史（其他隐藏） | 存入/兑换禁用 |
| ADJUSTING | 全部可用（橙色标记） | 存入/兑换可用 |

### 6.4 月报页面

| 状态 | 按钮 |
|------|------|
| DRAFT | `[确认发薪]`（蓝色主按钮） |
| FROZEN | `[差额调整]`（橙色按钮） + `[撤销确认]`（灰色，长按触发） |
| ADJUSTING | `[确认调整]`（绿色主按钮） + `[取消调整]`（灰色） |

---

## 七、autoSync 行为

### 7.1 FROZEN 状态下

```typescript
// autoSync 中增加前置检查
if (getMonthlyConfirmation(currentMonth)?.status === "frozen") {
  // 已确认月份：跳过所有写入操作
  // 不调用 upsertAttendance / upsertPaySlip
  return;
}
```

### 7.2 ADJUSTING 状态下

```typescript
if (getMonthlyConfirmation(currentMonth)?.status === "adjusting") {
  // 调整模式：正常重算，但标记为调整数据
  const att = calcFromShifts(...);
  upsertAttendance(att);
  const slip = buildPaySlipDraft(...);
  upsertPaySlip(slip);
  // 不更新 frozenSnapshot（保留原始快照用于差额计算）
}
```

---

## 八、差额计算逻辑

```typescript
function calculateAdjustments(month: string, employees: Employee[]): Adjustment[] {
  const adjustments: Adjustment[] = [];
  
  for (const emp of employees) {
    const slip = getPaySlip(emp.id, month);
    if (!slip?.frozenSnapshot) continue;
    
    const diff = (slip.finalSalary ?? 0) - slip.frozenSnapshot.finalSalary;
    if (Math.abs(diff) < 0.01) continue; // 忽略精度误差
    
    // 生成差额明细
    const details: string[] = [];
    const snapAttSalary = slip.frozenSnapshot.attendanceSalary;
    if (Math.abs((slip.attendanceSalary ?? 0) - snapAttSalary) > 0.01) {
      details.push(`考勤工资: ${snapAttSalary} → ${slip.attendanceSalary}`);
    }
    const snapMeal = slip.frozenSnapshot.mealAllowance;
    if (Math.abs((slip.mealAllowance ?? 0) - snapMeal) > 0.01) {
      details.push(`餐补: ${snapMeal} → ${slip.mealAllowance}`);
    }
    // ... 其他字段对比
    
    adjustments.push({
      id: uuid(),
      createdAt: Date.now(),
      employeeId: emp.id,
      employeeName: emp.nickname || emp.realName,
      amount: Math.round(diff * 100) / 100,
      details: details.join("；"),
      settled: false,
    });
  }
  
  return adjustments;
}
```

---

## 九、实施路径

### Phase 1 — 数据结构 + 状态管理

| 文件 | 改动 |
|------|------|
| `lib/labor/types.ts` | PaySlip 增加 frozenAt/frozenBy/frozenSnapshot |
| `lib/labor/store.tsx` | 新增 `useMonthlyConfirmationStore` |
| `lib/labor/store.tsx` | 新增 `confirmPayroll` / `enterAdjustMode` / `confirmAdjustment` 方法 |

### Phase 2 — autoSync 锁定

| 文件 | 改动 |
|------|------|
| `app/labor.tsx` | autoSync 增加 FROZEN 状态检查 |
| `app/labor.tsx` | 排班表操作增加状态检查 |

### Phase 3 — UI 锁定

| 文件 | 改动 |
|------|------|
| `app/labor.tsx` | 薪资卡片按钮行根据状态显示/隐藏 |
| `app/labor.tsx` | 排班表格子根据状态禁用 |
| `app/labor.tsx` | 调休操作根据状态禁用 |
| `app/labor.tsx` | 预支操作根据状态禁用 |
| `app/labor-kpi-allowance-edit.tsx` | 绩效补贴页根据状态只读 |

### Phase 4 — 月报集成

| 文件 | 改动 |
|------|------|
| `app/labor.tsx`（月报区域） | 确认发薪按钮 + 差额调整按钮 |
| `app/labor.tsx` | 差额计算 + 确认调整对话框 |
| `app/labor.tsx` | 调整历史展示 |

### Phase 5 — 差额联动

| 文件 | 改动 |
|------|------|
| `lib/labor/store.tsx` | buildPaySlipDraft 增加 adjustmentFromPrevMonth |
| `app/labor.tsx` | 薪资卡片展示上月差额调整 |

---

## 十、代码量预估

| Phase | 新增行数 | 修改行数 |
|-------|---------|---------|
| Phase 1 | ~80 | ~10 |
| Phase 2 | ~20 | ~15 |
| Phase 3 | ~60 | ~40 |
| Phase 4 | ~120 | ~20 |
| Phase 5 | ~30 | ~10 |
| 测试 | ~80 | ~0 |
| **总计** | **~390** | **~95** |

---

## 十一、边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 当月未结束就确认 | 允许（有些店月中发薪） |
| 确认后新员工入职 | 新员工不受锁定影响（无历史数据） |
| 确认后员工离职 | 离职操作不受锁定影响（面向未来） |
| 多次进入调整模式 | 每次调整生成独立记录，frozenSnapshot 更新为最新确认值 |
| 撤销确认 | 长按触发，清除 frozenAt/frozenSnapshot，状态回到 DRAFT |
| 跨月切换 | 每个月独立状态，互不影响 |

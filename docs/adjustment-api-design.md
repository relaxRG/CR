# 差额计算与自动分摊 — 接口设计

## 一、核心接口

### 1.1 差额计算

```typescript
/**
 * 计算所有员工的差额（调整模式下修改后 vs 原快照）
 *
 * @param employees - 当月所有活跃员工
 * @param getPaySlip - 获取员工薪资单的函数
 * @param month - 当前月份
 * @returns 有差异的员工列表（无差异的不返回）
 */
function calculateAdjustments(
  employees: Employee[],
  getPaySlip: (employeeId: string, month: string) => PaySlip | undefined,
  month: string,
): AdjustmentDiff[]

interface AdjustmentDiff {
  employeeId: string;
  employeeName: string;
  /** 总差额（正=应补发，负=应扣回） */
  amount: number;
  /** 人类可读的差额说明 */
  details: string;
  /** 逐字段差异明细 */
  breakdown: {
    field: string;    // 字段名（如 "mealAllowance"）
    label: string;    // 中文标签（如 "餐补"）
    before: number;   // 原快照值
    after: number;    // 修改后值
    diff: number;     // 差额
  }[];
}
```

**调用时机：** 管理者在调整模式下点击"确认调整"时调用。

**计算逻辑：**
```
对每个员工:
  1. 读取 slip.frozenSnapshot（原快照）
  2. 读取 slip 当前值（调整后）
  3. 逐字段对比 8 个核心字段
  4. 总差额 = 新 finalSalary - 原 finalSalary
  5. 如果差额 > 0.01 → 加入结果列表
```

---

### 1.2 确认调整

```typescript
/**
 * 确认调整（ADJUSTING → FROZEN）
 * 生成调整记录，更新 frozenSnapshot，重新锁定
 *
 * @param month - 当前月份
 * @param diffs - calculateAdjustments 的返回值
 * @param settleMethod - 处理方式
 * @returns 生成的调整记录列表
 */
function confirmAdjustment(
  month: string,
  diffs: AdjustmentDiff[],
  settleMethod: AdjustmentSettleMethod,
): PayrollAdjustment[]
```

**内部逻辑：**
```
1. 将 diffs 转换为 PayrollAdjustment 记录
2. 设置 settleMethod（next_month / separate / ignored）
3. 追加到 MonthlyConfirmation.adjustments
4. 更新每个员工 PaySlip 的 frozenSnapshot 为当前值
5. 更新 frozenAt 为当前时间
6. 状态变为 FROZEN
```

---

### 1.3 差额分摊（计入下月）

```typescript
/**
 * 获取某员工在某月应计入的上月差额
 * 在 buildPaySlipDraft 中调用
 *
 * @param confirmations - 所有月度确认记录
 * @param employeeId - 员工 ID
 * @param currentMonth - 当前月份（要计算的月份）
 * @returns 应计入的差额金额（正=补发，负=扣回）
 */
function getAdjustmentForMonth(
  confirmations: MonthlyConfirmation[],
  employeeId: string,
  currentMonth: string,
): number
```

**计算逻辑：**
```
1. 计算上月月份（currentMonth - 1）
2. 查找上月的 MonthlyConfirmation
3. 筛选该员工的未处理调整（settled=false, settleMethod="next_month"）
4. 汇总金额返回
```

---

## 二、状态机完整 API

```typescript
interface PayrollConfirmationActions {
  // ─── 查询 ───
  getStatus(month: string): "draft" | "frozen" | "adjusting";
  getConfirmation(month: string): MonthlyConfirmation | null;
  isMonthLocked(month: string): boolean;
  isMonthWritable(month: string): boolean;
  getPendingAdjustments(month: string): PayrollAdjustment[];

  // ─── 状态转换 ───
  confirmPayroll(month, employees, getPaySlip): void;
  enterAdjustMode(month: string): void;
  confirmAdjustment(month, diffs, settleMethod): PayrollAdjustment[];
  cancelAdjustment(month: string): void;
  revokeConfirmation(month: string): void;

  // ─── 差额管理 ───
  settleAdjustment(month, adjustmentId, method, settledInMonth): void;
}
```

---

## 三、buildPaySlipDraft 集成

```typescript
// 在 buildPaySlipDraft 中新增：
const adjustmentFromPrev = getAdjustmentForMonth(confirmations, employee.id, month);

const grossSalary = Math.round((
  attendanceSalary +
  performanceTotal +
  (existing?.salesCommission ?? 0) +
  transportAllowance + mealAllowance + otherAllowance +
  (existing?.rewardPenalty ?? 0) +
  (existing?.compOffCashOut ?? 0) +
  adjustmentFromPrev  // ← 新增：上月差额调整
) * 100) / 100;

// 写入 slip
return {
  ...slip,
  adjustmentFromPrevMonth: adjustmentFromPrev !== 0 ? adjustmentFromPrev : undefined,
};
```

---

## 四、确认发薪流程伪代码

```typescript
function confirmPayroll(month: string, employees: Employee[], getPaySlip) {
  // 1. 为每个员工生成快照
  for (const emp of employees) {
    const slip = getPaySlip(emp.id, month);
    if (!slip) continue;
    upsertPaySlip({
      ...slip,
      frozenAt: Date.now(),
      frozenBy: "manager",
      frozenSnapshot: buildFrozenSnapshot(slip),
    });
  }

  // 2. 生成汇总
  const summary = {
    totalEmployees: employees.length,
    totalGrossSalary: employees.reduce((s, e) => s + (getPaySlip(e.id, month)?.grossSalary ?? 0), 0),
    totalFinalSalary: employees.reduce((s, e) => s + (getPaySlip(e.id, month)?.finalSalary ?? 0), 0),
    totalDeductions: employees.reduce((s, e) => {
      const slip = getPaySlip(e.id, month);
      return s + (slip?.socialInsuranceDeduction ?? 0) + (slip?.housingFundDeduction ?? 0);
    }, 0),
  };

  // 3. 保存确认状态
  upsertConfirmation({
    month,
    status: "frozen",
    frozenAt: Date.now(),
    frozenBy: "manager",
    adjustments: [],
    summary,
  });
}
```

---

## 五、差额自动标记已处理

```typescript
/**
 * 当下月薪资确认时，自动标记上月差额为已处理
 * 在 confirmPayroll 中调用
 */
function autoSettlePrevMonthAdjustments(currentMonth: string) {
  const [y, m] = currentMonth.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

  const prevConf = getConfirmation(prevMonth);
  if (!prevConf) return;

  const updated = prevConf.adjustments.map((a) => {
    if (!a.settled && a.settleMethod === "next_month") {
      return { ...a, settled: true, settledInMonth: currentMonth };
    }
    return a;
  });

  upsertConfirmation({ ...prevConf, adjustments: updated });
}
```

---

## 六、UI 调用示例

### 6.1 月报页面 — 确认发薪按钮

```typescript
const handleConfirmPayroll = () => {
  Alert.alert(
    "确认发薪",
    `确认 ${monthLabel(currentMonth)} 薪资发放？\n总人数：${employees.length}人\n总实发：¥${totalFinal}\n\n确认后本月所有数据将被锁定。`,
    [
      { text: "取消" },
      { text: "确认发薪", style: "destructive", onPress: () => {
        confirmPayroll(currentMonth, employees, getPaySlip);
      }},
    ]
  );
};
```

### 6.2 月报页面 — 确认调整按钮

```typescript
const handleConfirmAdjustment = () => {
  const diffs = calculateAdjustments(employees, getPaySlip, currentMonth);
  if (diffs.length === 0) {
    Alert.alert("无差异", "本次调整未产生任何薪资差额。");
    cancelAdjustment(currentMonth);
    return;
  }

  // 显示差额确认对话框
  setAdjustmentDiffs(diffs);
  setShowAdjustmentModal(true);
};
```

### 6.3 差额确认 Modal

```typescript
<Modal visible={showAdjustmentModal}>
  <Text>调整结果</Text>
  {adjustmentDiffs.map((d) => (
    <View key={d.employeeId}>
      <Text>{d.employeeName}：{d.amount >= 0 ? "+" : ""}¥{d.amount}</Text>
      <Text style={{ fontSize: 10 }}>{d.details}</Text>
    </View>
  ))}
  <Text>差额处理方式：</Text>
  <RadioGroup value={settleMethod} onChange={setSettleMethod}>
    <Radio value="next_month" label="计入下月薪资（默认）" />
    <Radio value="separate" label="单独补发/扣回" />
    <Radio value="ignored" label="忽略" />
  </RadioGroup>
  <Button title="确认调整" onPress={() => {
    confirmAdjustment(currentMonth, adjustmentDiffs, settleMethod);
    setShowAdjustmentModal(false);
  }} />
</Modal>
```

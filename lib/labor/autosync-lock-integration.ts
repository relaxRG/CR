/**
 * autoSync 锁定逻辑集成
 *
 * 本文件定义了 autoSync 在不同确认状态下的行为规范。
 * 实际集成时需要在 app/labor.tsx 的 autoSync useEffect 中添加前置检查。
 *
 * 状态行为：
 *   DRAFT    → 正常执行所有写入
 *   FROZEN   → 跳过所有写入（排班/考勤/薪资单）
 *   ADJUSTING → 正常执行所有写入（但不更新 frozenSnapshot）
 */

// ─── 集成代码（添加到 app/labor.tsx 的 autoSync useEffect 中）─────────────────

/*
位置：app/labor.tsx autoSync useEffect 的最开头

添加以下代码：

```typescript
// ─── 确认发薪锁定检查 ───
const monthConfStatus = getStatus(currentMonth);
if (monthConfStatus === "frozen") {
  // 已确认月份：跳过所有自动写入
  // 排班数据仍可读取（用于展示），但不写入考勤和薪资单
  return;
}
```

完整的 autoSync 结构变为：

```typescript
useEffect(() => {
  if (!ready) return;

  // ─── 确认发薪锁定检查 ───
  const monthConfStatus = getStatus(currentMonth);
  if (monthConfStatus === "frozen") {
    // 已确认月份：跳过所有自动写入
    return;
  }

  // ─── 正常 autoSync 逻辑（DRAFT 或 ADJUSTING）───
  const timer = setTimeout(() => {
    for (const emp of activeEmps) {
      const empShifts = getShifts(emp.id, currentMonth);
      const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, ...);
      upsertAttendance(att);
      const slip = buildPaySlipDraft(emp, currentMonth, att, ...);
      upsertPaySlip(slip);
    }
  }, 500); // 500ms 防抖

  return () => clearTimeout(timer);
}, [shifts, currentMonth, employees, advances, ...]);
```
*/

// ─── 排班表操作锁定（添加到各操作入口）─────────────────────────────────────────

/*
位置：app/labor.tsx 中所有排班写操作

模式 1：在 onSave/onPress 回调中添加前置检查

```typescript
// SchShiftModal onSave
onSave={(entry) => {
  if (!isMonthWritable(currentMonth)) {
    Alert.alert("已锁定", "本月已确认发薪，如需修改请先进入差额调整模式。");
    return;
  }
  upsertShift(entry);
}}
```

模式 2：在组件层面禁用交互

```typescript
// 排班格子
<TouchableOpacity
  disabled={!isMonthWritable(currentMonth)}
  onPress={() => openShiftModal(emp, date)}
>
```

推荐模式 2（更简洁），配合 opacity: 0.5 视觉反馈。
*/

// ─── 预支操作锁定 ─────────────────────────────────────────────────────────────

/*
位置：app/labor.tsx 预支区域

```typescript
// 新增预支
const handleAddAdvance = () => {
  if (!isMonthWritable(currentMonth)) {
    Alert.alert("已锁定", "本月已确认发薪，如需修改请先进入差额调整模式。");
    return;
  }
  // ... 原有逻辑
};

// 删除预支
const handleDeleteAdvance = (id: string) => {
  if (!isMonthWritable(currentMonth)) {
    Alert.alert("已锁定", "本月已确认发薪，如需修改请先进入差额调整模式。");
    return;
  }
  deleteAdvance(id);
};
```
*/

// ─── 调休操作锁定 ─────────────────────────────────────────────────────────────

/*
位置：app/labor.tsx 调休区域

```typescript
// 存入/兑换按钮
<TouchableOpacity
  disabled={!isMonthWritable(currentMonth)}
  onPress={...}
  style={[..., !isMonthWritable(currentMonth) && { opacity: 0.4 }]}
>
```
*/

// ─── 绩效补贴页面锁定 ─────────────────────────────────────────────────────────

/*
位置：app/labor-kpi-allowance-edit.tsx

```typescript
// 在页面顶部获取状态
const { isMonthWritable } = usePayrollConfirmation();
const canEdit = isMonthWritable(month);

// 保存按钮
<TouchableOpacity
  disabled={!canEdit}
  onPress={handleSave}
  style={[..., !canEdit && { opacity: 0.4 }]}
>
  <Text>{canEdit ? "保存" : "已锁定"}</Text>
</TouchableOpacity>

// 补贴项勾选
<Checkbox
  disabled={!canEdit}
  value={enabled}
  onValueChange={...}
/>
```
*/

// ─── 编辑薪资锁定 ─────────────────────────────────────────────────────────────

/*
位置：app/labor.tsx 编辑薪资入口

已有 `!isReadOnly` 条件控制按钮显示。
修改为 `!isReadOnly && canWrite`：

```typescript
{!isReadOnly && canWrite && (
  <TouchableOpacity onPress={() => router.push(...)}>
    <Text>编辑薪资</Text>
  </TouchableOpacity>
)}
```
*/

export {};

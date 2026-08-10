# FROZEN / ADJUSTING 状态 UI 联动规范

## 一、全局状态 Hook

```typescript
/**
 * 在 labor.tsx 顶层使用，提供当月确认状态给所有子组件
 */
const { getStatus, isMonthWritable, isMonthLocked } = usePayrollConfirmation();
const monthStatus = getStatus(currentMonth); // "draft" | "frozen" | "adjusting"
const canWrite = isMonthWritable(currentMonth); // draft || adjusting
```

---

## 二、顶部状态栏

### 2.1 位置

薪资统计页和排班表页面的月份选择器下方，固定显示。

### 2.2 样式规范

| 状态 | 背景色 | 文字色 | 图标 | 文案 |
|------|--------|--------|------|------|
| DRAFT | 无（不显示） | — | — | — |
| FROZEN | `#F0F0F0`（浅灰） | `#666666` | 🔒 | `本月已确认发薪（{日期}）` |
| ADJUSTING | `#FFF3E0`（浅橙） | `#E65100` | ⚠️ | `调整模式 — 修改完成后请确认调整` |

### 2.3 代码示例

```tsx
{monthStatus !== "draft" && (
  <View style={{
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: monthStatus === "frozen" ? "#F0F0F0" : "#FFF3E0",
  }}>
    <Text style={{
      fontSize: 12,
      fontWeight: "600",
      color: monthStatus === "frozen" ? "#666666" : "#E65100",
    }}>
      {monthStatus === "frozen"
        ? `🔒 本月已确认发薪（${formatDate(confirmation?.frozenAt)}）`
        : `⚠️ 调整模式 — 修改完成后请确认调整`
      }
    </Text>
  </View>
)}
```

---

## 三、薪资卡片按钮行

### 3.1 当前结构

```
[绩效补贴] [编辑薪资] [付款信息] [历史]
```

### 3.2 各状态下的按钮可见性

| 按钮 | DRAFT | FROZEN | ADJUSTING |
|------|:-----:|:------:|:---------:|
| 绩效补贴 | ✅ 正常 | ❌ 隐藏 | ✅ 橙色边框 |
| 编辑薪资 | ✅ 正常 | ❌ 隐藏 | ✅ 橙色边框 |
| 付款信息 | ✅ 正常 | ✅ 正常 | ✅ 正常 |
| 历史 | ✅ 正常 | ✅ 正常 | ✅ 正常 |

### 3.3 代码示例

```tsx
{/* 绩效补贴按钮 */}
{canWrite && (
  <TouchableOpacity
    onPress={() => router.push(...)}
    style={[
      styles.actionBtn,
      { backgroundColor: colors.success + "15", borderColor: colors.success + "44" },
      monthStatus === "adjusting" && { borderColor: "#FF9800", borderWidth: 2 },
    ]}
  >
    <Text style={{ color: colors.success }}>绩效补贴</Text>
  </TouchableOpacity>
)}

{/* 编辑薪资按钮 */}
{canWrite && (
  <TouchableOpacity
    onPress={() => ...}
    style={[
      styles.actionBtn,
      { backgroundColor: colors.primary + "15", borderColor: colors.primary + "44" },
      monthStatus === "adjusting" && { borderColor: "#FF9800", borderWidth: 2 },
    ]}
  >
    <Text style={{ color: colors.primary }}>编辑薪资</Text>
  </TouchableOpacity>
)}
```

---

## 四、调休/换休操作区

### 4.1 各状态下的操作可用性

| 操作 | DRAFT | FROZEN | ADJUSTING |
|------|:-----:|:------:|:---------:|
| 存入/兑换 按钮 | ✅ 可用 | ❌ 禁用（灰色） | ✅ 可用（橙色） |
| 节假日拿钱↔换休 | ✅ 可用 | ❌ 禁用 | ✅ 可用 |

### 4.2 代码示例

```tsx
<TouchableOpacity
  disabled={!canWrite}
  onPress={handleCashOut}
  style={[
    styles.compOffBtn,
    !canWrite && { opacity: 0.4 },
    monthStatus === "adjusting" && { borderColor: "#FF9800" },
  ]}
>
  <Text style={[
    styles.compOffBtnText,
    !canWrite && { color: colors.muted },
  ]}>
    ± 存入/兑换
  </Text>
</TouchableOpacity>
```

---

## 五、排班表

### 5.1 格子交互

| 状态 | 格子点击 | 长按填充 | 编辑按钮 | 导入按钮 |
|------|:-------:|:-------:|:-------:|:-------:|
| DRAFT | ✅ 正常 | ✅ 正常 | ✅ 正常 | ✅ 正常 |
| FROZEN | ❌ 不响应 | ❌ 不响应 | ❌ 禁用 | ❌ 禁用 |
| ADJUSTING | ✅ 正常 | ✅ 正常 | ✅ 正常 | ✅ 正常 |

### 5.2 FROZEN 状态视觉

```tsx
{/* 排班表格子 */}
<TouchableOpacity
  disabled={!canWrite}
  onPress={() => canWrite && openShiftModal(emp, date)}
  style={[
    styles.scheduleCell,
    !canWrite && { opacity: 0.5 },
  ]}
>
  {/* 格子内容 */}
</TouchableOpacity>

{/* FROZEN 状态下的全局蒙层提示（可选） */}
{monthStatus === "frozen" && (
  <View style={{
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.02)",
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none",
  }}>
    {/* 蒙层不阻断滚动，仅视觉提示 */}
  </View>
)}
```

### 5.3 ADJUSTING 状态视觉

```tsx
{/* 排班表容器 — 调整模式橙色边框 */}
<View style={[
  styles.scheduleContainer,
  monthStatus === "adjusting" && {
    borderWidth: 2,
    borderColor: "#FF9800",
    borderRadius: 12,
  },
]}>
  {/* 排班表内容 */}
</View>
```

---

## 六、预支区域

### 6.1 各状态下的操作

| 操作 | DRAFT | FROZEN | ADJUSTING |
|------|:-----:|:------:|:---------:|
| 新增预支 | ✅ | ❌ 禁用 | ✅ 橙色 |
| 删除预支 | ✅ | ❌ 禁用 | ✅ |

### 6.2 代码示例

```tsx
{/* 新增预支按钮 */}
<TouchableOpacity
  disabled={!canWrite}
  onPress={handleAddAdvance}
  style={[
    styles.addAdvanceBtn,
    !canWrite && { opacity: 0.4 },
  ]}
>
  <Text>+ 新增预支</Text>
</TouchableOpacity>
```

---

## 七、月报页面操作按钮

### 7.1 按钮布局

| 状态 | 主按钮 | 次按钮 |
|------|--------|--------|
| DRAFT | `[确认发薪]`（蓝色） | 无 |
| FROZEN | `[差额调整]`（橙色） | `[撤销确认]`（灰色，长按） |
| ADJUSTING | `[确认调整]`（绿色） | `[取消调整]`（灰色） |

### 7.2 代码示例

```tsx
{/* 月报操作按钮 */}
<View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
  {monthStatus === "draft" && (
    <TouchableOpacity
      onPress={handleConfirmPayroll}
      style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
    >
      <Text style={styles.primaryBtnText}>确认发薪</Text>
    </TouchableOpacity>
  )}

  {monthStatus === "frozen" && (
    <>
      <TouchableOpacity
        onPress={handleEnterAdjustMode}
        style={[styles.primaryBtn, { backgroundColor: "#FF9800" }]}
      >
        <Text style={styles.primaryBtnText}>差额调整</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onLongPress={handleRevokeConfirmation}
        delayLongPress={2000}
        style={[styles.secondaryBtn]}
      >
        <Text style={styles.secondaryBtnText}>撤销确认（长按）</Text>
      </TouchableOpacity>
    </>
  )}

  {monthStatus === "adjusting" && (
    <>
      <TouchableOpacity
        onPress={handleConfirmAdjustment}
        style={[styles.primaryBtn, { backgroundColor: "#4CAF50" }]}
      >
        <Text style={styles.primaryBtnText}>确认调整</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleCancelAdjustment}
        style={[styles.secondaryBtn]}
      >
        <Text style={styles.secondaryBtnText}>取消调整</Text>
      </TouchableOpacity>
    </>
  )}
</View>
```

---

## 八、颜色规范汇总

| 用途 | 颜色 | Hex |
|------|------|-----|
| FROZEN 背景 | 浅灰 | `#F0F0F0` |
| FROZEN 文字 | 中灰 | `#666666` |
| FROZEN 蒙层 | 透明灰 | `rgba(0,0,0,0.02)` |
| ADJUSTING 背景 | 浅橙 | `#FFF3E0` |
| ADJUSTING 文字 | 深橙 | `#E65100` |
| ADJUSTING 边框 | 橙色 | `#FF9800` |
| 确认发薪按钮 | 主色蓝 | `colors.primary` |
| 差额调整按钮 | 橙色 | `#FF9800` |
| 确认调整按钮 | 绿色 | `#4CAF50` |
| 撤销/取消按钮 | 灰色 | `#9E9E9E` |

---

## 九、动画与过渡

| 场景 | 动画 |
|------|------|
| DRAFT → FROZEN | 顶部状态栏从上方滑入（300ms） |
| FROZEN → ADJUSTING | 状态栏颜色渐变（灰→橙，200ms） |
| ADJUSTING → FROZEN | 状态栏颜色渐变（橙→灰，200ms） + 成功 toast |
| 按钮禁用 | opacity 0.4（无动画） |
| 橙色边框出现 | borderWidth 0→2（200ms） |

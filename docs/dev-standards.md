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

---

## 六、按钮布局重构 Bug 根因分析（2026-08-06）

### Bug 描述

薪资总览页（`labor-attendance.tsx`）展开卡片底部有「绩效补贴」「编辑薪资」「付款信息」「历史」四个按钮，但用户实际需要的是在薪资统计页（`labor.tsx`）折叠卡片上操作。两个页面各有一套按钮，造成功能重复、入口分散、用户困惑。

同时，「付款信息」按钮触发的是一个弹出 Modal（需要二次点击「复制全部」），而用户期望的是**一键直接复制**。

### 根因

**1. 功能入口分散（UI 架构问题）**

开发时在两个层级（列表页卡片 + 详情页展开卡片）各自添加了操作按钮，没有统一规划入口层级。导致：
- 同一功能（绩效补贴、编辑薪资、历史）在两个地方都有入口
- 用户不清楚应该在哪里操作
- 代码维护时需要同步修改两处

**2. 付款信息 Modal 过度设计**

付款信息只需要「复制」这一个动作，却设计成了一个完整的 Modal（展示姓名/银行/卡号/金额，再点复制按钮）。这增加了操作步骤，且 Modal 本身的 state（`paymentModalFor`、`paymentEmployee`、`paymentSlip`、`defaultBank`、`handleCopyPayment`）都需要在父组件维护，并通过 `onOpenPayment` prop 传入子组件，造成不必要的 prop drilling。

**3. 废弃代码未及时清理**

重构后旧的 `Clipboard` import 仍留在文件中（未使用），废弃注释（`// 旧绩效 Store 已移除`）也未删除。

### 修复方案

1. **删除** `labor-attendance.tsx` 中的所有按钮（四按钮块 + 一键复制按钮）及关联废弃逻辑（Modal、state、handler、prop、styles、import）
2. **扩展** `labor.tsx` 薪资统计卡片的三按钮为四按钮，「付款信息」直接调用 `Clipboard.setString()` 复制，无需 Modal
3. **清理** 所有废弃 import 和注释

---

## 七、受此次重构影响的关联模块清单

| 模块 | 文件 | 影响类型 | 处理结果 |
|------|------|---------|---------|
| 薪资总览展开卡片底部四按钮 | `app/labor-attendance.tsx` | 删除整块 | ✅ 已删除 |
| 一键复制付款信息按钮 | `app/labor-attendance.tsx` | 删除整块 | ✅ 已删除 |
| 付款信息 Modal JSX | `app/labor-attendance.tsx` | 删除整块 | ✅ 已删除 |
| `paymentModalFor` state | `app/labor-attendance.tsx` | 废弃 state | ✅ 已删除 |
| `paymentEmployee/paymentSlip/defaultBank` useMemo | `app/labor-attendance.tsx` | 废弃派生状态 | ✅ 已删除 |
| `handleCopyPayment` handler | `app/labor-attendance.tsx` | 废弃 handler | ✅ 已删除 |
| `onOpenPayment` prop | `app/labor-attendance.tsx` | 废弃 prop drilling | ✅ 已删除 |
| `Modal` import | `app/labor-attendance.tsx` | 废弃 import | ✅ 已删除 |
| `Clipboard` import（无使用） | `app/labor-attendance.tsx` | 废弃 import | ✅ 已删除 |
| 废弃 styles（10个） | `app/labor-attendance.tsx` | 废弃样式定义 | ✅ 已删除 |
| 薪资统计卡片三按钮 | `app/labor.tsx` | 扩展为四按钮 | ✅ 已更新 |
| `Clipboard` import | `app/labor.tsx` | 新增 | ✅ 已添加 |
| 废弃注释（旧绩效 Store） | `app/labor.tsx` | 废弃注释 | ✅ 已删除 |
| `ss_comp_off` 兼容注释 | `lib/labor/types.ts` | 向后兼容（保留） | ✅ 正常 |
| 旧值迁移注释 | `lib/labor/types.ts` | 迁移说明（保留） | ✅ 正常 |

**未受影响的同名 style**（其他文件中独立定义，与本次重构无关）：
- `spirits-inventory.tsx` 中的 `actionBtn`
- `wine-inventory.tsx` 中的 `actionBtn`
- `suppliers.tsx` 中的 `copyBtn`
- `bulk-action-bar.tsx` 中的 `actionBtn`
- `swipeable-row.tsx` 中的 `actionBtn`
- `BaseInventoryScreen.tsx` 中的 `actionBtn`

---

## 八、UI 架构规范：操作入口层级原则

### 规范 6：操作入口只在一个层级定义

**原则**：同一功能的操作入口只应在一个 UI 层级出现，不应在列表页和详情页各自重复。

```
❌ 错误：
  列表页卡片（折叠）→ 有「绩效补贴」「编辑薪资」「历史」按钮
  详情页卡片（展开）→ 也有「绩效补贴」「编辑薪资」「付款信息」「历史」按钮

✅ 正确：
  列表页卡片（折叠）→ 有「绩效补贴」「编辑薪资」「付款信息」「历史」四个按钮（唯一入口）
  详情页卡片（展开）→ 只展示数据，不重复操作按钮
```

**适用场景**：
- 员工薪资卡片（列表 vs 展开详情）
- 供应商卡片（列表 vs 展开详情）
- 库存条目（列表 vs 详情页）

---

### 规范 7：单步操作不应设计为 Modal

**原则**：如果一个操作只有一个步骤（如「复制」），直接执行，不要包装成 Modal。

```ts
// ❌ 错误：单步操作包装成 Modal
<TouchableOpacity onPress={() => setShowPaymentModal(true)}>
  <Text>付款信息</Text>
</TouchableOpacity>
<Modal visible={showPaymentModal}>
  {/* 展示信息... */}
  <TouchableOpacity onPress={handleCopy}>复制全部</TouchableOpacity>
</Modal>

// ✅ 正确：直接执行
<TouchableOpacity onPress={() => {
  Clipboard.setString(buildPaymentText(employee, slip));
  Alert.alert("已复制", "付款信息已复制到剪贴板");
}}>
  <Text>付款信息</Text>
</TouchableOpacity>
```

**例外**：如果操作需要用户确认（删除、提交）或需要用户输入（金额、备注），才应使用 Modal/Alert。

---

### 规范 8：避免 Prop Drilling 传递 Modal 开关

**原则**：不要通过 prop 将父组件的 Modal 开关函数传入子组件。如果子组件需要触发 Modal，应将 Modal 移入子组件内部，或使用 Context。

```ts
// ❌ 错误：通过 prop 传递 Modal 开关
function ParentPage() {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <ChildCard onOpenModal={() => setShowModal(true)} />
      <Modal visible={showModal}>...</Modal>
    </>
  );
}

// ✅ 正确方案 A：将 Modal 移入子组件
function ChildCard() {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setShowModal(true)}>...</TouchableOpacity>
      <Modal visible={showModal}>...</Modal>
    </>
  );
}

// ✅ 正确方案 B：如果只是单步操作，直接执行（无需 Modal）
function ChildCard({ employee, slip }) {
  return (
    <TouchableOpacity onPress={() => {
      Clipboard.setString(buildPaymentText(employee, slip));
      Alert.alert("已复制", "...");
    }}>...</TouchableOpacity>
  );
}
```

---

### 规范 9：废弃 import 必须与废弃代码同步删除

**原则**：删除功能代码时，必须同步检查并删除不再使用的 import（包括 `Clipboard`、`Modal`、`useState`、`useMemo` 等）。

**检查方法**：
```bash
# 检查某个 import 是否还在使用
grep -n "Clipboard\." src/file.tsx
grep -n "Modal " src/file.tsx  # 注意加空格避免匹配注释
```

**工具提示**：TypeScript 编译器不会对未使用的 import 报错（只有 ESLint 会），所以必须手动检查。

---

## 九、绩效补贴页退出后数据重置 Bug 根因分析（2026-08-06）

### Bug 描述

在绩效补贴页（`labor-kpi-allowance.tsx`）勾选工作绩效档位后，直接手势返回或点「<」返回，再次进入页面时档位选择全部重置为空白。

### 根因（两个独立问题叠加）

**问题 1：`workKPISelections` 和 `revenueActuals` 初始化不读持久化数据**

```ts
// ❌ 错误：初始化为空对象，每次进入页面都从空白开始
const [workKPISelections, setWorkKPISelections] = useState<Record<string, string>>({});
const [revenueActuals, setRevenueActuals] = useState<Record<string, string>>({});
```

`PaySlip` 类型中没有对应的持久化字段，导致即使保存成功，下次进入也无法恢复。

**问题 2：`selectWorkKPITier` 只更新本地 state，不立即写入 PaySlip**

```ts
// ❌ 错误：只更新本地 state，依赖返回时的 syncToPaySlip() 写入
const selectWorkKPITier = (ruleId, tierId) => {
  setWorkKPISelections((prev) => ({ ...prev, [ruleId]: ... }));
  // 没有调用 upsertPaySlip！
};
```

`syncToPaySlip()` 只在点击「<」返回按钮时被调用，手势返回时不触发，导致数据丢失。

### 修复方案

1. 在 `PaySlip` 类型中新增 `workKPISelections` 和 `revenueActuals` 持久化字段
2. 初始化时从 `PaySlip` 读取已保存的选择状态
3. 每次点击/输入立即调用 `upsertPaySlip`（与 `toggleAllowance` 保持一致）
4. 删除 `syncToPaySlip()` 函数，返回按钮直接 `router.back()`

### 受影响的关联模块清单

| 模块 | 文件 | 问题 | 处理 |
|------|------|------|------|
| `workKPISelections` 初始化 | `labor-kpi-allowance.tsx` | 初始化为 `{}` 不读持久化 | ✅ 从 `PaySlip.workKPISelections` 恢复 |
| `revenueActuals` 初始化 | `labor-kpi-allowance.tsx` | 初始化为 `{}` 不读持久化 | ✅ 从 `PaySlip.revenueActuals` 恢复 |
| `selectWorkKPITier()` | `labor-kpi-allowance.tsx` | 只更新本地 state | ✅ 改为即时 `upsertPaySlip` |
| `updateRevenueActual()` | `labor-kpi-allowance.tsx` | 只更新本地 state | ✅ 改为即时 `upsertPaySlip` |
| `syncToPaySlip()` | `labor-kpi-allowance.tsx` | 废弃函数 | ✅ 已删除 |
| 返回按钮 | `labor-kpi-allowance.tsx` | `syncToPaySlip(); router.back()` | ✅ 改为直接 `router.back()` |
| `useCallback` import | `labor-kpi-allowance.tsx` | 删除后不再需要 | ✅ 已删除 |
| `calcPaySlipUpdate()` | `labor-kpi-allowance.tsx` | 新增统一计算入口 | ✅ 避免三处重复计算 |
| `PaySlip.workKPISelections` | `lib/labor/types.ts` | 缺少持久化字段 | ✅ 新增 |
| `PaySlip.revenueActuals` | `lib/labor/types.ts` | 缺少持久化字段 | ✅ 新增 |

**已审查但无需修复的同类逻辑：**
- `labor-attendance.tsx` 的 `rewardItems`/`notes`：用户主动点「✓ 保存」写入（编辑模式，合理），`notes` 用 `onBlur` 即时写入（正确）
- `spirits-inventory.tsx` 的 `onBack`：UI 导航回调，不涉及数据同步
- `suppliers.tsx` 的 `onBack`：UI 导航回调，不涉及数据同步

---

## 十、开发规范：状态持久化三原则

### 规范 10：单步选择操作必须即时写入持久化存储

**原则**：用户的每次点击选择（勾选、档位选择、开关切换）必须立即调用 `upsertXxx` 写入持久化存储，不能依赖「返回时同步」。

```ts
// ❌ 错误：只更新本地 state，依赖返回时同步
const selectTier = (id: string) => {
  setSelections((prev) => ({ ...prev, ruleId: id }));
  // 忘记调用 upsertPaySlip！
};

// ✅ 正确：即时写入
const selectTier = (id: string) => {
  setSelections((prev) => {
    const next = { ...prev, ruleId: id };
    upsertPaySlip({ ...existing, selections: next, ...recalc(next) });
    return next;
  });
};
```

**例外**：需要用户确认（删除）或批量编辑（奖惩列表）的操作，可以使用「编辑模式 → 保存」模式。

---

### 规范 11：本地 state 初始化必须从持久化存储读取

**原则**：如果一个 state 需要在页面关闭后保留，必须：
1. 在 `PaySlip`/`Employee` 等持久化类型中新增对应字段
2. 在 `useState` 初始化时从持久化存储读取

```ts
// ❌ 错误：初始化为空，每次进入页面都从空白开始
const [selections, setSelections] = useState<Record<string, string>>({});

// ✅ 正确：从 PaySlip 恢复
const [selections, setSelections] = useState<Record<string, string>>(() => {
  const slip = getPaySlip(employeeId, month);
  return slip?.workKPISelections ?? {};
});
```

**检查清单**：
- [ ] 这个 state 需要在页面关闭后保留吗？
- [ ] 对应的持久化类型中有字段吗？
- [ ] `useState` 初始化时读取了持久化数据吗？

---

### 规范 12：禁止「返回时同步」模式

**原则**：禁止在返回按钮的 `onPress` 中调用同步函数，也禁止使用 `useEffect` cleanup 来同步数据。

```ts
// ❌ 错误：依赖返回时同步
<TouchableOpacity onPress={() => { syncToPaySlip(); router.back(); }}>

// ❌ 错误：useEffect cleanup 同步
useEffect(() => {
  return () => { syncToPaySlip(); }; // 不可靠，组件卸载时不保证执行
}, []);

// ✅ 正确：每次操作立即写入，返回按钮直接返回
<TouchableOpacity onPress={() => router.back()}>
```

**原因**：
- 手势返回（iOS swipe back）不触发 `onPress`
- React Native 的 `useEffect` cleanup 在导航时不保证执行顺序
- 用户可能切换 Tab 而不是点返回按钮

---

### 规范 13：新增持久化字段时同步更新类型定义

**原则**：每次需要持久化新的 state，必须同步在对应的类型文件中新增字段，并添加注释说明用途。

```ts
// lib/labor/types.ts
interface PaySlip {
  // ...
  /** 工作绩效档位选择（key: ruleId, value: tierId）
   * 即时写入，进入页面时从此恢复，无需 syncToPaySlip */
  workKPISelections?: Record<string, string>;
}
```

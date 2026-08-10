# Cocktail-R 开发规范与防错指南

> 针对近期薪资引擎与状态同步模块重构的总结，供开发团队参考。

在近期的系统重构中，我们解决了一系列与**状态同步**、**性能卡顿**和**计算时序**相关的深层次问题。为了确保 Cocktail-R 的长期稳定与高可维护性，我们提炼出以下核心开发规范与防错指南。

## 1. 页面交互架构：读写分离原则

在处理具有强关联计算的数据（如薪资、月报）时，必须严格遵守「读写分离」架构。

### 规范要求
- **展示页（Read-Only）**：直接从 Store 响应式读取数据（例如 `getPaySlip`）。不维护任何本地业务 State，不提供任何直接编辑功能。所有数据均为派生或直接订阅。
- **编辑页（Write）**：采用「整页编辑，统一保存」模式。进入时从 Store 拷贝一份快照到本地 `useState`；用户的所有操作均在本地 State 暂存；仅在点击「保存」时，才一次性写入 Store 并触发重算。

### 防错指南
- **切忌「即时写入」**：如果在强关联页面使用 `onChangeText={(v) => upsertPaySlip(...)}`，每次按键都会触发全量重算引擎（如 `buildPaySlipDraft`），这在移动端会导致严重的掉帧（FPS 下降）和卡顿。
- **保护中间状态**：如果在填写一半时退出，即时写入会把「半成品」数据污染到 Store 中。整页保存模式通过「取消确认弹窗」彻底杜绝了这一风险。

## 2. 薪资引擎：时序安全与「三步走」写入法

薪资引擎（`buildPaySlipDraft`）依赖于许多底层控制字段（如：补贴开关 `allowanceOverrides`、绩效档位 `workKPISelections`）。如果写入时序错误，引擎将读取到旧数据，导致计算结果不一致。

### 规范要求
当需要更新控制字段并触发薪资重算时，必须严格执行**三步走**原子操作：

1. **先写控制字段**：将最新的控制字段通过 `upsert` 写入 Store，确保 `ref.current` 已更新。
2. **触发全量重算**：调用 `buildPaySlipDraft`。此时引擎内部从 `ref.current` 读取数据时，能获取到第 1 步写入的最新控制字段。
3. **原子性最终写入**：将引擎返回的新薪资单草稿，连同所有的控制字段一起，执行最终的 `upsert`。

### 防错代码示例
```typescript
// ❌ 错误做法：先重算，再覆盖（引擎读取的是旧数据）
const draft = buildPaySlipDraft(...);
upsertPaySlip({ ...draft, allowanceOverrides: newOverrides }); // 此时 draft 里的应发薪资并未包含 newOverrides 的影响

// ✅ 正确做法（三步走）
upsertPaySlip({ ...existing, allowanceOverrides: newOverrides }); // 1. 先写
const draft = buildPaySlipDraft(...); // 2. 重算（引擎读到新 overrides）
upsertPaySlip({ ...draft, allowanceOverrides: newOverrides }); // 3. 终写
```

## 3. 性能优化：严格控制 Render 阶段的高频计算

React 的每次渲染都会执行函数体内的所有同步代码。如果在渲染阶段直接进行大数组的 `filter`、`reduce` 或 `sort`，在列表页（如排班页同时渲染 20 个员工卡片）会引发指数级的性能衰减。

### 规范要求
- **必须使用 `useMemo`**：所有针对数组的遍历计算（尤其是从全局 Store 获取的全量数组），必须使用 `useMemo` 包裹，并提供精确的依赖项。
- **避免在 JSX 中直接调用复杂计算函数**：如果一个组件渲染了复杂的统计报表，不应将计算逻辑写在普通的 `renderReport()` 函数中。应将数据聚合逻辑提取为 `useMemo`，JSX 仅负责渲染计算好的结果。

### 防错指南
- **排查特征**：在代码审查时，搜索 `.filter(`、`.reduce(` 和 `.sort(`，如果它们不在 `useMemo` 或 `useCallback` 的闭包内，就是潜在的性能炸弹。

## 4. 长列表导航：滚动位置保持

在移动端，用户在长列表点击进入详情页，再返回时，期望列表保持在原来的滚动位置。

### 规范要求
- **强制使用 `useScrollPreservation`**：项目中所有存在「长列表 → 详情/跳转 → 返回」路径的页面（如酒单、配方、采购列表），必须接入统一的 `useScrollPreservation` Hook。

### 机制说明
该 Hook 利用 `onScroll` 事件将偏移量实时写入 `useRef`（纯内存操作，不触发 Re-render，零性能损耗），并在 `useFocusEffect` 中延迟恢复位置。这能完美解决 Expo Router 在某些路由切换（如 `display: none` 的 Tab 切换）时触发重新布局导致的滚动丢失问题。

---
*Cocktail-R 核心开发团队*

## 5. 核心计算引擎的 DRY 原则与「展示-计算一致性」

在近期的薪资引擎重构中，我们修复了三个由于违反「展示-计算一致性」和 DRY（Don't Repeat Yourself）原则导致的严重 Bug：

1. **兼职时薪错位**：兼职员工工资计算错误地使用了 `overtimeHourlyRate`，而 UI 展示的是 `hourlyRate`。
2. **季度补贴未拦截**：`buildPaySlipDraft` 计算引擎遗漏了 `shouldPayAllowanceThisMonth` 调用，导致季度补贴每月发放。
3. **按天补贴分类错误**：`custom_fixed` + `per_day` 的餐补在计算时忽略了 `unit` 字段，且被错误归类到 `otherAllowance`。

### 根因分析

这些 Bug 产生的根本原因在于**计算逻辑的碎片化分布**：
- `calcAllowance`（负责计算金额）和 `buildPaySlipDraft`（负责分类累加）没有共享同一个抽象分类模型，导致新增组合类型（`custom_fixed` + `per_day`）时，只改了一处，遗漏了另一处。
- 展示层（`labor-kpi-allowance.tsx`）自己实现了一套补贴过滤逻辑，而没有调用统一的 `shouldPayAllowanceThisMonth`。

### 防错指南

为了避免类似问题再次发生，所有核心计算引擎的开发必须遵循以下规范：

1. **唯一计算源（Single Source of Truth）**
   任何业务数据的计算（如「补贴是否在当月发放」、「补贴最终金额」），**必须且只能在 `lib/labor/store.tsx` 或 `types.ts` 中的纯函数内实现**。UI 组件（展示页、编辑页）绝对禁止自己编写计算逻辑，必须调用核心函数。

2. **UI 展示必须与引擎计算绝对一致**
   如果 UI 界面上显示「时薪：¥35」，底层计算引擎就**必须**使用同一个变量（`employee.hourlyRate`）进行乘法运算。任何「展示 A 字段，计算用 B 字段」的妥协都会导致严重的财务事故。

3. **核心函数的每一次修改，必须同步扫描所有调用点**
   例如：在 `buildPaySlipDraft` 中加入了 `shouldPayAllowanceThisMonth` 拦截后，必须立即全局搜索 `calcAllowance` 的所有调用点（包括展示页、编辑页、测试文件），确保所有地方都同步加上了同样的拦截逻辑。

4. **强制测试覆盖边界条件**
   任何新增的配置组合（如 `custom_fixed` 加上了 `per_day` 选项），必须在 `allowance-calc.test.ts` 中补充至少 3 个测试用例：
   - 正常计算（乘法/固定额）
   - 零值边界（出勤 0 天）
   - 分类归属（测试 `calcAllowanceTotal` 是否归入正确类别）

## 6. 字段弃用与向后兼容策略（以 `stdHoursPerDay` 为例）

在演进核心数据结构时，直接删除旧字段会导致老用户的数据崩溃。必须采用平滑的向后兼容策略：

1. **类型层兼容**：将废弃字段在 TypeScript 接口中标记为可选（如 `stdHoursPerDay?: number`），避免编译报错，同时表明该字段不推荐使用。
2. **写入层兼容**：在保存逻辑中，保留该字段但强制写入空值或零值（如 `stdHoursPerDay: 0`），逐步洗掉旧数据。
3. **读取层兼容（Fallback）**：引擎在读取时，优先使用新字段（如 `weeklyHoursRules`），如果新字段为空或无效，则 fallback 读取旧字段（`stdHoursPerDay`），确保老用户不受影响。
4. **UI 层隔离**：在前端 UI 彻底删除废弃字段的输入框和展示位，强制新用户和老用户在编辑时使用新字段。对于依赖旧字段的展示，应提示「请更新配置」。

## 7. 嵌套可点击组件的事件冒泡防护

在 React Native 中，`TouchableOpacity` / `Pressable` 的点击事件默认会向上冒泡。这在嵌套交互组件时会导致严重的误触问题。

**规范要求：**
凡是将 `TouchableOpacity` / `Pressable` 嵌套在另一个可点击容器（如可展开卡片、Modal 触发按钮）内时，子组件的 `onPress` 必须调用 `e.stopPropagation?.()` 阻止事件冒泡。

**标准写法：**
```tsx
<TouchableOpacity onPress={(e) => { 
  e.stopPropagation?.(); 
  doSomething(); 
}}>
```

**容器级防护：**
如果子组件区域较大（如内联展开的整个面板），可使用拦截容器包裹整个区域，防止内部所有点击穿透到外层卡片：
```tsx
<TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation?.()}>
  {/* 内部的所有子按钮即使不写 stopPropagation，也不会冒泡到最外层 */}
</TouchableOpacity>
```

## 8. 清空操作必须删除记录，而不是保留空值

在表单或表格中，当用户清空一个输入字段（如工时）并保存时，如果该字段是这条记录存在的唯一意义，**必须删除整条记录，而不是将字段设为 `null` 并保留记录**。

**反面模式（错误）：**
```tsx
// 用户清空工时输入框
const hv = hoursInput ? Number(hoursInput) : null;
// 错误：保留了 hoursValue=null 的空记录
upsertShift({ employeeId, date, hoursValue: hv });
```
保留空值记录会导致：
1. 列表过滤逻辑需要额外增加 `hoursValue !== null` 的判断，极易遗漏。
2. 历史遗留的空记录会污染统计结果（例如在排班表中，员工明明没有排班，但因为存在一条空记录而依然显示在列表中）。
3. UI 显示异常，甚至导致崩溃。

**标准模式（正确）：**
```tsx
const hv = hoursInput ? Number(hoursInput) : null;
// 正确：当工时为空且无其他附属意义（如特殊状态）时，直接删除记录
if (hv === null && !specialStatusId) {
  deleteShift(employeeId, date);
  return;
}
upsertShift({ employeeId, date, hoursValue: hv, specialStatusId });
```
**规范要求：**
在任何包含「清空」或「重置」语义的保存操作中，必须评估该记录是否还有存在的必要。如果无必要，必须调用对应的 `delete` / `remove` 方法彻底清除。

## 9. 金额显示规范（智能小数位）

为了保证全项目金额显示的统一性，并提供更简洁的视觉体验，所有金额展示必须使用 `formatMoney` 工具函数，**禁止在组件内直接调用 `.toFixed(0)` 或 `.toFixed(2)`**。

**规范要求：**
- 整数金额不显示小数点（如 `¥9305`）
- 有小数的金额统一保留两位（如 `¥345.50`）
- 无特殊要求时，零值应根据上下文处理（有时显示 `—` 比显示 `¥0` 更清晰）

**标准写法：**
```tsx
import { formatMoney } from "@/lib/utils";

// 正确
<Text>¥{formatMoney(item.price)}</Text>

// 错误
<Text>¥{item.price.toFixed(0)}</Text>
<Text>¥{item.price.toFixed(2)}</Text>
```
**例外情况：**
- 超过 10,000 的大额数据，可使用自定义的 `fmtAmt` 函数缩写为 `X.X万`。
- 非金额数据（如工时 `8.0h`、百分比 `12.5%`、纯数字变化量 `+345`）不受此规范限制，可继续使用 `toFixed`。

## 10. 写入持久化存储后必须同步更新 React State

凡是直接调用 `AsyncStorage.setItem`、`SecureStore.setItemAsync` 或封装函数（如 `saveDeviceInfo`、`pairWithCode`）写入持久化数据后，如果该数据被 React Context/State 管理，**必须同时调用对应的 `setState` 或触发引擎重启函数**。否则 UI 和引擎会读取到过期的 React State，导致功能失效。

**典型 Bug 场景（退出同步组后无法重新加入）：**

```ts
// ❌ 错误：只写入 AsyncStorage，没有通知 SyncProvider
await pairWithCode(code);
// SyncProvider 的 deviceInfo state 仍为 null，同步引擎不会重启

// ✅ 正确：写入后调用 restartSync 重启同步引擎
await pairWithCode(code);
void restartSync(); // 重置 startedRef + 重新执行 performSync + 重启实时监听
```

**规范要求：**

在任何「写入持久化存储」的操作后，必须评估该数据是否被 React State 管理。如果是，必须选择以下方式之一同步更新：

1. **直接 setState**：`setDeviceInfo(newInfo)`（适合简单数据更新）
2. **调用引擎重启函数**：`restartSync()`（适合需要重新初始化整个引擎的场景）
3. **触发 useEffect 重新读取**：通过修改依赖项（如 `setReloadKey(k+1)`）让 `useEffect` 重新从存储读取

**检查清单（代码审查时）：**

- [ ] 调用了 `AsyncStorage.setItem` 或封装的持久化函数后，是否有对应的 `setState`？
- [ ] 如果没有 `setState`，是否有 `useEffect` 会在适当时机重新读取？
- [ ] 如果是引擎级别的状态（如同步引擎的 `deviceInfo`），是否需要调用重启函数？

## 11. 员工类型判断必须覆盖所有兼职子类型

**背景**：项目中存在两种兼职类型：`parttime`（临时兼职）和 `longterm_parttime`（长期兼职）。它们在薪资计算上完全相同（不适用节假日倍数、特殊状态扣薪），但历史代码中大量使用 `type === "parttime"` 判断，遗漏了 `longterm_parttime`，导致长期兼职员工被错误地套用全职薪资逻辑（节假日倍数工资、旷工扣薪等）。

**错误写法：**
```ts
if (employee.type === "parttime") { /* 兼职逻辑 */ }
```

**正确写法：**
```ts
const isParttime = employee.type === "parttime" || employee.type === "longterm_parttime";
if (isParttime) { /* 兼职逻辑 */ }
```

**适用场景：**
- 薪资计算引擎（`calcFromShifts`、`buildPaySlipDraft`）
- UI 展示逻辑（档案编辑页、档案展示页、薪资统计卡片）
- 导出引擎（`export.ts`）

**例外**：分组过滤逻辑（前厅/后厨/公司/临时兼职）按部门分组，长期兼职按部门归属，不受此规范影响。

**检查清单：**
- [ ] 新增员工类型判断时，搜索 `=== "parttime"` 确认是否需要同时处理 `longterm_parttime`
- [ ] 使用 `isParttime` 辅助变量统一判断，避免遗漏
- [ ] 新增员工类型时，同步更新所有相关的类型判断逻辑

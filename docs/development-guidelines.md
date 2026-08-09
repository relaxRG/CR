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

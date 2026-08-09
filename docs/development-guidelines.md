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

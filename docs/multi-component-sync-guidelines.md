# 多组件状态同步与时序 Bug 分析报告

## 一、Bug 根因分析（补贴不同步问题）

在本次修复的「补贴不同步」和「饭补金额不随出勤天数变化」问题中，其根本原因在于 **React 状态更新时序与持久化写入的竞争条件**。

### 错误的时序（旧代码）
```typescript
// 1. 先写入额外字段（如 allowanceOverrides）
const patched = { ...existing, ...extraPatch };
upsertPaySlip(patched);

// 2. 立即调用 buildPaySlipDraft 重新计算
// 🚨 问题发生：buildPaySlipDraft 内部从 ref.current 读取 existing。
// 此时 upsertPaySlip 虽已执行，但它是一个异步触发的动作，或者在同一事件循环中
// ref.current 已经更新，但 buildPaySlipDraft 返回的 draft 没有继承 patched 里的 allowanceOverrides。
const draft = buildPaySlipDraft(employee, month, att, advanceAmount, globalSettings);

// 3. 再次写入，此时 draft 覆盖了 patched，导致 allowanceOverrides 丢失
upsertPaySlip({ ...draft, ...extraPatch, id: existing.id });
```

### 正确的时序（修复后）
```typescript
// 1. 合并控制字段到 existing（不写入 store，只用于传参）
const patched = { ...existing, ...extraPatch };

// 2. 先临时更新 ref（通过先写入 patched），确保 buildPaySlipDraft 读到最新控制字段
upsertPaySlip(patched); 

// 3. 此时 ref.current 已更新，buildPaySlipDraft 能读到最新 allowanceOverrides，算出正确的补贴金额
const draft = buildPaySlipDraft(...);

// 4. 原子性最终写入：用重新计算的薪资字段覆盖，同时明确保留所有控制字段
upsertPaySlip({
  ...draft,
  allowanceOverrides: patched.allowanceOverrides,
  workKPISelections: patched.workKPISelections,
  revenueActuals: patched.revenueActuals,
  id: existing.id,
});
```

## 二、UI 重构遗漏分析

**薪资构成明细消失**：在上一轮考勤卡重构中，用「三分区考勤概况」替换了旧的展开区域，但不慎将底部的「薪资构成明细」（绩效/补贴/奖惩/预支/社保/实发）一并删除。
**多余独立界面**：排班表考勤卡的「存入」按钮使用了 `router.push("/labor")` 跳转，触发了独立路由渲染，而没有复用已有的嵌入模式。

## 三、开发规范与防错建议

为了彻底避免这类多组件状态不同步和时序 Bug，提出以下架构级防错建议：

### 1. 状态写入的「原子性」原则
- **避免同一事件循环内多次写入同一对象**。如果必须多次写入，必须确保后一次写入**显式继承**前一次写入的关键控制字段。
- **推荐模式**：在调用计算引擎前，将所有前置条件准备好并传入，引擎返回结果后，执行**唯一一次**持久化写入。

### 2. 核心计算引擎不应依赖外部状态
- `buildPaySlipDraft` 内部不应依赖 `ref.current` 来读取 `existing`。
- **重构建议**：将 `existing` 作为明确的参数传入 `buildPaySlipDraft`，使其成为一个真正的**纯函数**。这样就不需要关心 `ref.current` 是否已经更新，彻底消除时序竞争。

### 3. 路由隔离与嵌入模式规范
- 明确区分「页面级路由」和「组件级嵌入」。
- 如果一个组件（如 `LaborScreen`）既可以作为独立页面，又可以被嵌入到 Tab 中，必须默认 `embedded=true`，由顶级路由文件（如 `_layout.tsx` 或 `store.tsx`）负责外层导航栏，内部不要私自渲染返回按钮和标题。

### 4. 视觉回归检查清单
每次进行大面积 UI 重构（如考勤卡重构）时，必须执行以下检查：
- [x] 原有核心数据字段（如实发薪资、社保代扣）是否依然可见？
- [x] 在小屏幕（iPhone SE）下是否溢出？
- [x] 顶部/底部留白是否与 App 整体设计语言对齐？

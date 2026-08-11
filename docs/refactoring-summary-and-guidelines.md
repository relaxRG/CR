# 本次重构总结：开发规范与架构建议

## 一、重构背景

本次重构围绕**薪资计算引擎**展开，修复了 5 类核心 Bug，建立了确认发薪快照锁定机制，并全面升级了补贴引擎。

---

## 二、修复的 Bug 及其根因模式

| # | Bug | 根因模式 | 防御措施 |
|---|-----|---------|---------|
| 1 | 比例底薪在零出勤时返回全额 | 除法回退值错误（回退到全额而非 0） | 统一 helper + 零出勤前置检查 |
| 2 | longterm_parttime 走了全职分支 | 类型分支条件遗漏新类型 | 使用 `isParttime()` helper 统一判断 |
| 3 | 补贴合计显示单日金额而非月总额 | `calcAllowance` 依赖 type 而非 unit | 统一按 unit 字段路由计算 |
| 4 | 排班表对兼职显示无意义的警告 | 全职逻辑未排除兼职 | 按类型条件渲染 |
| 5 | UI 与导出使用不同的比例底薪来源 | 违反 Single Source of Truth | 考勤引擎持久化 `proportionalBaseSalary`，统一通过 `getAttendanceBaseSalary` 读取 |

### 共性根因

> **所有 Bug 的共性根因是：同一业务逻辑分散在多处实现，且各处实现不一致。**

---

## 三、架构原则（避免类似问题）

### 原则 1：Single Source of Truth（单一真相源）

```
❌ 错误：UI 中从聚合考勤工资反推比例底薪
✅ 正确：考勤引擎按“日薪 × 实际出勤天数”持久化，UI/导出调用 getAttendanceBaseSalary(att) 读取
```

**规则：** 任何派生值必须有且仅有一个计算入口。UI 只负责展示，不负责计算。

### 原则 2：Type-Safe Branching（类型安全分支）

```
❌ 错误：if (type === "parttime") { ... }  // 遗漏 longterm_parttime
✅ 正确：if (isParttime(type)) { ... }     // helper 内部维护所有兼职变体
```

**规则：** 员工类型判断必须使用统一 helper，禁止直接字符串比较。

### 原则 3：Unit-Driven Calculation（单位驱动计算）

```
❌ 错误：switch (rule.type) { case "meal_per_day": ... }  // 新类型遗漏
✅ 正确：if (rule.unit === "per_day") amount * days       // 按 unit 路由
```

**规则：** 计算逻辑按数据字段（unit/mode）路由，不按业务类型名（type）路由。

### 原则 4：Defensive Zero-Check（防御性零值检查）

```
❌ 错误：baseSalary * days / expectedDays  // expectedDays=0 时 Infinity
✅ 正确：(expectedDays > 0 && days > 0) ? baseSalary * days / expectedDays : 0
```

**规则：** 所有除法运算必须同时检查分子和分母，回退值为 0（不是全额）。

### 原则 5：Immutable Snapshot（不可变快照）

```
❌ 错误：确认发薪后仍允许 autoSync 覆盖数据
✅ 正确：FROZEN 状态下 autoSync 跳过，修改需进入 ADJUSTING 模式
```

**规则：** 已确认的数据通过快照锁定，任何修改必须通过显式的调整流程。

### 原则 6：Isolation by Design（设计级隔离）

```
❌ 错误：补发金额混入下月 PaySlip.finalSalary
✅ 正确：separate 补发单独立存储，getAdjustmentForMonth 只读取 next_month
```

**规则：** 不同结算方式的数据必须在存储层和计算层完全隔离。

---

## 四、状态同步防 Bug 规范

### 4.1 autoSync 设计规范

| 规范 | 说明 |
|------|------|
| 防抖 | 500ms debounce，避免频繁触发 |
| 前置检查 | FROZEN 状态直接 return |
| 依赖完整 | useEffect 依赖数组必须包含所有输入源 |
| 幂等性 | 相同输入产生相同输出，重复执行无副作用 |
| 原子写入 | 一次 upsertPaySlip 写入完整薪资单，不分步写入 |

### 4.2 数据流方向

```
排班数据 → calcFromShifts → MonthlyAttendance
                                    ↓
员工配置 → buildPaySlipDraft → PaySlip → UI 展示
                                    ↓
补贴规则 → calcAllowance ──────────┘
```

**禁止反向流动：** UI 不可反推计算值写回 Store。

### 4.3 快照与实时数据的边界

| 数据 | 当月（DRAFT） | 当月（FROZEN） | 历史月份 |
|------|:---:|:---:|:---:|
| 排班 | 实时 | 锁定 | 快照 |
| 考勤 | 实时计算 | 锁定 | 快照 |
| 薪资 | 实时计算 | 锁定 | 快照 |
| 补贴 | 实时计算 | 锁定 | 快照 |
| 员工档案 | 可修改 | 可修改（不影响当月） | — |

---

## 五、代码审查清单（PR Template）

### 薪资相关 PR 必检项

- [ ] 是否使用了统一 helper（`calcDailyRate`, `calcAttendanceBaseSalary`, `getAttendanceBaseSalary`, `calcAllowance`）
- [ ] 除法运算是否同时检查分子和分母
- [ ] 回退值是否为 0（而非全额或 undefined）
- [ ] 员工类型判断是否覆盖了所有变体（fulltime/longterm_parttime/parttime）
- [ ] 补贴计算是否按 `unit` 字段路由
- [ ] 动态补贴（per_day）是否禁止了 isOverride 锁定
- [ ] 新增写操作是否检查了 `isMonthWritable(month)`
- [ ] 是否有对应的边界条件测试用例
- [ ] `tests/attendance-payroll-e2e.test.ts` 中的纯函数是否同步更新
- [ ] 导出模块（`export.ts`）是否与 UI 口径一致

---

## 六、文件职责划分（最终版）

| 文件 | 职责 | 禁止 |
|------|------|------|
| `lib/labor/types.ts` | 类型定义 + 纯计算函数 | 禁止包含 React/状态逻辑 |
| `lib/labor/store.tsx` | 状态管理 + 持久化 + 业务引擎 + 确认发薪 Store | 禁止包含 UI 逻辑 |
| `lib/labor/payroll-confirmation.ts` | 差额计算 + 快照生成 + 补发单生成 | 禁止包含 React 逻辑 |
| `lib/labor/separate-payment-store.tsx` | 补发单独立存储 + CRUD | 禁止混入正常薪资计算 |
| `lib/labor/validation.ts` | 数据校验规则 | 禁止修改数据 |
| `lib/labor/export.ts` | 导出格式化 | 禁止重新实现计算逻辑 |
| `app/labor.tsx` | UI 展示 + 用户交互 + 拦截逻辑 | 禁止内联计算公式 |
| `components/separate-payment-panel.tsx` | 补发单 UI 面板 | 仅展示和操作 |

---

## 七、测试覆盖要求

| 模块 | 最低测试覆盖 |
|------|------------|
| 薪资引擎（calcFromShifts） | 每种员工类型 × 每种边界条件 |
| 补贴引擎（calcAllowance） | 每种 unit × 每种 type 组合 |
| 确认发薪状态机 | 每种状态转换 + 非法转换防御 |
| 差额计算 | 正差额/负差额/零差额/多字段/精度误差 |
| 单独补发 | 生成/隔离验证/付款/对账 |

---

## 八、本次重构的完整 Commit 历史

| Commit | 内容 |
|--------|------|
| `7fb5ff6` | fix: 修复比例底薪在无排班/零出勤时仍计算出非零值的 bug |
| `c15f987` | feat: 新增跨月排班校验模块和 UI 措辞修复 |
| `b53e20f` | refactor: 全面统一比例底薪计算口径 |
| `998eece` | fix: 修复长期兼职薪资计算和 UI 展示错误 |
| `936e56e` | refactor: 优化兼职员工导出列名/校验语义/字段清理 |
| `bcc2e9e` | refactor(P3): unit 字段改为必填 + calcBasis 审计字段 |
| `80752ab` | feat: 集成全部操作入口 FROZEN 拦截 + 状态机单元测试 |
| `ac73372` | feat: 单独补发隔离结算 + 旧代码清理 |
| (latest) | feat: 单独补发 UI + 实付对账测试 + 架构总结 |

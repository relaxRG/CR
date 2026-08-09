# 员工工时与计费模式重构技术文档

**Author:** Manus AI  
**Date:** 2026-08-09

## 1. 重构背景与目标

在早期的 `cocktail-r` 项目中，员工工时与计费模式存在一定的局限性和技术债：
- 存在两套工时系统：默认工时（`stdHoursPerDay`）和灵活工时规则（`weeklyHoursRules`），容易导致配置冲突和计算逻辑复杂。
- 兼职员工的计费模式固化为「按小时结算」，不支持「按天结算」的日薪模式。
- 时薪字段冗余（`hourlyRate` 和 `overtimeHourlyRate`），在不同场景下（如加班工资、调休兑现、兼职工资）的调用不一致，导致实际计算结果与 UI 预期不符。
- 兼职计费模式（`parttimeMode`）仅存在于 UI 状态中，未持久化到数据库。

本次重构的目标是：**统一工时数据源、合并时薪计算基准、支持灵活的兼职计费模式，并彻底清理历史技术债。**

## 2. 核心架构变更

### 2.1 工时数据源统一

彻底废弃 `stdHoursPerDay` 字段，将其标记为 `@deprecated` 并在类型定义中改为可选字段（`stdHoursPerDay?: number`）。新员工不再写入此字段，旧员工的数据仅作为向后兼容的 Fallback 使用。

所有员工的工时计算统一收敛至 `weeklyHoursRules`（灵活工时规则）。当某天没有任何规则覆盖时，`getContractHoursForDate` 引擎将返回 `0`。在 UI 层（排班页），如果某天有排班但标准工时为 `0`，将显示橙色警告图标（⚠️），提醒用户补全配置。

### 2.2 时薪计算基准统一

在引擎计算层面，废弃 `hourlyRate` 的实际计算用途。所有涉及薪资计算的场景统一使用 `overtimeHourlyRate`（加班时薪）：
- **加班工资**：`paidOvertimeHours × overtimeHourlyRate`
- **调休兑现**：`cashOutHours × overtimeHourlyRate`
- **兼职工资（按小时）**：`totalHours × overtimeHourlyRate`

在 UI 展示层面（员工档案）：
- `hourlyRate` 更名为「正常时薪（参考）」，自动计算为 `日薪 ÷ 当天平均灵活工时`，仅作展示。
- `overtimeHourlyRate` 更名为「加班时薪（实际计算）」，用户可自由修改，支持填 `0`（表示加班不计费）。

### 2.3 兼职双计费模式支持

在 `Employee` 类型中正式引入 `parttimeMode` 字段，支持 `"daily"` 和 `"hourly"` 两种枚举值：
- **按天结算 (`"daily"`)**：兼职工资 = 出勤天数 × `baseSalary`（此时 `baseSalary` 作为日薪使用）。
- **按小时结算 (`"hourly"`)**：兼职工资 = 总工时 × `overtimeHourlyRate`。

该字段已在员工档案表单中实现持久化，并在 `calcFromShifts` 引擎中正确路由计算分支。

## 3. 数据库与持久化清理

在本次重构中，对 AsyncStorage 数据库进行了深度审查，确保无脏数据残留：
- **废弃字段清理**：`sessionValue`、`overtimeType`、`address`、`idCardImageUri`、`defaultSession` 等历史废弃字段已在 `EmployeeProvider` 和 `ShiftProvider` 的 `useEffect` 初始化阶段通过数据迁移脚本彻底删除。
- **孤立 Key 审查**：确认 `SYNC_KEYS` 中注册的所有键均有对应的 Store 使用，无孤立同步键。
- **多设备同步修复**：修复了 `spirits`、`equipment`、`fruit` 等非核心模块 Store 未注册 `registerStoreReload` 的问题。现在所有模块在接收到 Cloudflare 同步推送后，均能即时触发本地状态刷新和 UI 重渲染。

## 4. 开发规范说明

为了避免未来迭代中再次出现类似的技术债，特制定以下开发规范：

### 规范一：字段弃用与向后兼容（四步法）
当需要废弃某个数据字段时，必须严格执行以下四步：
1. **类型层标记**：在 `types.ts` 中将字段改为可选（添加 `?`），并使用 `@deprecated` JSDoc 注释说明替代方案。
2. **写入层阻断**：在所有 `handleSave` 或 `upsert` 函数中，将该字段的值硬编码为 `undefined` 或安全的零值（如 `0`）。
3. **读取层 Fallback**：在核心计算引擎中，使用 `??` 操作符为旧数据提供安全的 Fallback 处理。
4. **UI 层隔离**：彻底删除所有与该字段相关的输入框和展示组件，防止新数据继续写入。

### 规范二：单点计算基准（Single Source of Truth）
任何具有业务含义的数值（如时薪），在引擎中只能有一个计算基准。如果业务要求区分不同场景（如正常时薪 vs 加班时薪），必须在类型定义和 UI 提示中明确界定各自的计算范围，严禁在不同模块中混用。

### 规范三：状态必须穿透至持久层
任何在 UI 表单中新增的业务状态（如 `parttimeMode`），不仅要在本地 `useState` 中管理，必须同步更新：
- `types.ts` 中的接口定义
- Store 的持久化逻辑（或后端的数据库 Schema）
- 核心计算引擎的处理分支

### 规范四：多设备同步闭环
在 `cocktail-r` 的本地优先（Local-First）架构下，任何新建的持久化 Store，其 `useEffect` 初始化逻辑的返回值必须注册 `registerStoreReload`，确保云端推送到达时，本地内存状态能够被即时覆盖并正确地刷新。

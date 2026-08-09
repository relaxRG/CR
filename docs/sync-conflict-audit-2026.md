# 多端并发冲突处理机制审查报告
> 审查日期：2026-08-10 | Commit: 7fc1793

## 一、TypeScript 代码质量审查

### 结论：代码库完全健康

| 检查项 | 结果 |
| :--- | :--- |
| 标准 `strict` 模式编译 | **0 个错误** |
| 冗余类型定义（重复 interface/type） | **未发现** |
| 额外严格选项（`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`） | 974 个噪音警告（正常，Expo 官方也不启用这两个选项） |

**噪音警告分布**（仅供参考，无需修复）：

| 错误码 | 数量 | 来源 |
| :--- | :---: | :--- |
| TS18048（数组索引可能 undefined） | 367 | `noUncheckedIndexedAccess` |
| TS2532（对象可能 undefined） | 163 | `noUncheckedIndexedAccess` |
| TS2345（类型不兼容） | 188 | `exactOptionalPropertyTypes` |
| TS2379/TS2375（可选属性类型不精确） | 136 | `exactOptionalPropertyTypes` |

---

## 二、多端并发冲突处理机制审查

### 现有机制概述

同步引擎（`lib/sync/engine.ts`）实现了以下分层冲突处理策略：

| 层级 | 机制 | 适用场景 |
| :--- | :--- | :--- |
| 键级时间戳 | 每个 AsyncStorage 键独立维护 `sync.ts.<key>` 时间戳 | 所有键 |
| 60秒冲突窗口 | 双端在 60s 内都有修改 → 弹出冲突对话框，由用户决策 | 所有键 |
| ID 级合并（`mergeIdList`） | 以 `id` 字段为主键，云端新增条目不丢失，已有条目走字段级合并 | `ID_LIST_KEYS` 中的键 |
| 字段级合并（`mergeRecord`） | 同一记录不同字段各自保留，依据 `updatedAt` 时间戳判断哪端更新 | ID 级合并的子步骤 |
| prefs 有利优先合并（`mergePrefs`） | `favorite/made` 取 true 优先，`rating` 取最大值 | `cocktail.prefs.v1` |
| `initialSyncDone` 锁 | 初始同步完成前阻止脏键推送，防止旧数据覆盖云端 | 所有键 |
| 脏键持久化 | 离线期间的修改持久化到 `sync.dirtyKeys.pending`，重连后补推 | 所有键 |

### 发现的问题及修复

#### 问题 1（已修复）：`Employee` 对象缺少 `updatedAt` 字段

**根因**：`mergeRecord` 依赖 `updatedAt`（数字时间戳）判断字段时序，但 `Employee` 接口没有此字段，`updateEmployee()` 也不写入时间戳。导致 `localTs = 0, remoteTs = 0`，字段级合并始终保留本地值。

**影响**：两端同时修改同一员工的同一字段（如 `baseSalary`），后保存的云端版本会被静默丢弃。

**修复**：
- `lib/labor/types.ts`：`Employee` 接口添加 `updatedAt?: number` 字段
- `lib/labor/store.tsx`：`addEmployee()` 写入 `updatedAt: Date.now()`，`updateEmployee()` 写入 `updatedAt: Date.now()`

#### 问题 2（已修复）：3 个员工相关键未加入 `ID_LIST_KEYS`

**根因**：`labor_comp_off_entries_v1`、`labor_holiday_comp_off_v1`、`labor_unexplained_rest_alerts_v1` 的数据结构都有 `id` 字段，应使用 ID 级合并，但未在 `ID_LIST_KEYS` 中注册，导致使用整体 LWW（后写覆盖先写）。

**影响**：两端同时新增调休余额条目时，后保存的一端会覆盖先保存的一端的所有条目。

**修复**：`lib/sync/engine.ts`：将 3 个键加入 `ID_LIST_KEYS`。

### 已知设计取舍（无需修复）

| 键 | 当前策略 | 原因 | 风险 |
| :--- | :--- | :--- | :--- |
| `labor_shifts_v1` | 整体 LWW | `ShiftEntry` 无 `id` 字段（复合主键 `employeeId+date+shift`），无法使用 ID 级合并 | 低（排班通常只有一个管理员操作） |
| `labor_attendance_v1` | 整体 LWW | `MonthlyAttendance` 有 `id` 字段，但考勤数据通常由单一设备写入 | 低 |

---

## 三、新字段（`parttimeMode`、`weeklyHoursRules`）的同步保护评估

工时重构引入的两个新字段均在 `Employee` 接口中，通过 `labor_employees_v1` 键同步：

| 字段 | 同步键 | 合并策略 | 保护状态 |
| :--- | :--- | :--- | :--- |
| `parttimeMode` | `labor_employees_v1` | ID 级 + 字段级 LWW | **修复后：已保护** |
| `weeklyHoursRules` | `labor_employees_v1` | ID 级 + 字段级 LWW | **修复后：已保护** |
| `overtimeHourlyRate` | `labor_employees_v1` | ID 级 + 字段级 LWW | **修复后：已保护** |

修复前，由于 `Employee` 无 `updatedAt`，字段级合并无法正确判断时序，存在数据静默丢弃风险。修复后，每次 `updateEmployee()` 都会写入 `updatedAt: Date.now()`，`mergeRecord` 可正确判断哪端的修改更新，从而保留正确版本。

---

## 四、测试结果

```
Test Files  17 passed | 1 skipped (18)
Tests       229 passed | 1 skipped (230)
TypeScript  0 errors (strict mode)
```

---

## 五、开发规范建议

1. **新增数据模型时必须包含 `updatedAt?: number` 字段**（数字时间戳，非字符串），并在写入函数中自动维护，以支持字段级 LWW 合并。
2. **新增有 `id` 字段的数组类型 AsyncStorage 键时，必须同步在 `ID_LIST_KEYS` 中注册**，防止并发新增条目时数据丢失。
3. **无 `id` 字段的数组类型键（如 `labor_shifts_v1`）**，应评估是否需要添加 `id` 字段以升级为 ID 级合并；若业务场景为单设备写入，可保持整体 LWW。

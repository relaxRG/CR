# 性能和状态同步验证报告

## 一、autoSync 性能分析

### 1.1 当前机制

```
依赖变化 → 500ms 防抖 → 遍历所有活跃员工 → calcFromShifts + buildPaySlipDraft → upsertAttendance + upsertPaySlip
```

**防抖策略：** 500ms 内多次修改只触发一次重算，避免频繁写入。

### 1.2 本次修改对性能的影响

| 修改 | 性能影响 | 说明 |
|------|---------|------|
| `attendanceDays > 0` 条件判断 | 无影响 | 仅增加一个布尔比较 |
| `calcAttendanceBaseSalary` / `getAttendanceBaseSalary` helper | 无影响 | 纯算术与字段读取，函数调用开销可忽略 |
| UI 层读取持久化比例底薪替代反推公式 | 微优化 | 不再从聚合考勤工资拆分计算 |
| 跨月标签文本变更 | 无影响 | 纯字符串替换 |

**结论：本次修改不引入任何性能回归。** 实际上，UI 层移除了 `Object.values(att.specialStatusDeductions).reduce()` 的内联计算，略微减少了渲染时的计算量。

### 1.3 潜在性能瓶颈（已有防护）

| 瓶颈点 | 当前防护 | 状态 |
|--------|---------|------|
| autoSync 遍历所有员工 | 500ms 防抖 | ✅ 已有 |
| getShifts(month) 全量过滤 | `startsWith` 字符串匹配 | ✅ O(n) 可接受 |
| paySlips.filter 年度累计 | 每月最多12条 | ✅ 数据量小 |
| upsertAttendance/upsertPaySlip | AsyncStorage 批量写入 | ✅ 异步不阻塞 UI |

### 1.4 性能测试结果

已有性能测试全部通过：
- `att-panel-perf.test.ts`: 10员工并发操作 < 50ms ✅
- `empty-shift-cleanup-perf.test.ts`: 100万次调用 < 100ms ✅
- `sync-performance.test.ts`: 18模块串行 push < 5000ms ✅

---

## 二、状态同步验证

### 2.1 数据流完整性

```
排班修改(shifts) → autoSync 触发 → calcFromShifts → upsertAttendance → buildPaySlipDraft → upsertPaySlip
     ↓                                    ↓                                      ↓
  UI 排班表更新              考勤卡片更新（attendanceDays=0）         薪资卡片更新（比例底薪=0）
```

**验证点：** 当排班被清空时：
1. `getShifts(month).filter(emp)` 返回空数组 ✅
2. `calcFromShifts` 计算 `attendanceDays=0` ✅
3. `proportionalBase = 0`（新修复） ✅
4. `attendanceSalary = 0` ✅
5. `buildPaySlipDraft` 生成 `grossSalary = 0 + performanceTotal + allowances` ✅
6. UI 展示 `比例底薪 = ¥0` ✅

### 2.2 状态不同步风险点

| 风险 | 场景 | 防护措施 |
|------|------|---------|
| 旧考勤数据残留 | 排班清空后考勤未重算 | autoSync 不跳过空排班（注释明确说明） |
| 旧薪资单残留 | 考勤归零后薪资单未更新 | autoSync 每次都重新 buildPaySlipDraft |
| 跨月数据不同步 | 7月视图修改8月排班 | shifts 依赖触发 autoSync |
| 绩效控制字段丢失 | 重算覆盖补贴启用状态、工作KPI档位或业绩实绩 | `allowanceOverrides`、`workKPISelections`、`revenueActuals`完整传入唯一结算引擎 |

### 2.3 依赖数组完整性

```typescript
[shifts, currentMonth, employees, advances, compOffEntriesSched, holidayCompOffEntriesSched]
```

| 依赖 | 触发场景 | 验证 |
|------|---------|------|
| `shifts` | 排班增删改 | ✅ 排班变化立即重算 |
| `currentMonth` | 切换月份 | ✅ 切换月份重算当月 |
| `employees` | 员工底薪/配置修改 | ✅ 配置变化重算 |
| `advances` | 预支增删 | ✅ 预支变化更新 finalSalary |
| `compOffEntriesSched` | 存入/兑换调休 | ✅ 调休变化影响加班费 |
| `holidayCompOffEntriesSched` | 节假日调休变化 | ✅ 同上 |

**结论：依赖数组完整，不存在状态不同步风险。**

---

## 三、移动端模拟验证

### 3.1 React Native 渲染性能

本次修改对渲染性能的影响：

- **薪资卡片（PaySlipMiniCard）**：直接调用 `getAttendanceBaseSalary(att)` 读取持久化比例底薪；仅历史记录缺少字段时才执行一次兼容读取，渲染路径更稳定。
- **考勤概况卡片**：同上优化。
- **排班表跨月标签**：从静态字符串改为 `date.slice(5,7)` 动态插值，开销可忽略。

### 3.2 AsyncStorage 写入频率

autoSync 的 500ms 防抖确保：
- 快速连续操作（如批量排班）不会触发多次写入
- 每次触发最多写入 `N` 条考勤 + `N` 条薪资单（N = 活跃员工数）
- 典型场景（5-10名员工）：每次 autoSync 写入 10-20 条记录，耗时 < 50ms

### 3.3 内存使用

本次修改不增加任何新的 state 或 ref，不影响内存占用。`calcAttendanceBaseSalary` 和 `getAttendanceBaseSalary` 均为无闭包的纯函数。

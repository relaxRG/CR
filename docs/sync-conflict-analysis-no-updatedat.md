# 23 个无 `updatedAt` 字段的 `ID_LIST_KEYS` 键冲突场景分析

在我们的本地优先同步引擎中，`ID_LIST_KEYS` 集合包含了 25 个键，它们会使用 `mergeIdList` 进行 ID 级合并。然而，除了 `labor_employees_v1` 和 `labor_payslips_v1` 外，其余 23 个键的数据对象**没有** `updatedAt` 字段。

## 核心机制：缺少 `updatedAt` 时的降级行为

当 `mergeIdList` 匹配到相同 `id` 的条目时，会调用 `mergeRecord` 进行字段级 LWW（Last Write Wins）合并。
`mergeRecord` 的时序判断逻辑如下：

```typescript
const localTs = local.updatedAt ?? 0;
const remoteTs = remote.updatedAt ?? 0;
// 如果 remoteTs > localTs，取云端值；否则保留本地值
if (remoteTs > localTs) {
  merged[field] = remote[field];
}
```

因为这 23 个键的数据对象没有 `updatedAt`，`localTs` 和 `remoteTs` 始终为 `0`。
`0 > 0` 为 `false`，因此：**对于两端都有的字段，合并策略退化为「始终保留本地值」。**

## 极端冲突场景分析

### 场景一：两端并发修改同一条记录的**不同字段**（安全）

**假设场景**：
- 初始状态：配方 A（`cocktail.recipes`），`name="Mojito"`, `price=50`
- 设备 1：修改 `price=60`
- 设备 2：修改 `name="Mojito Classic"`

**合并结果**：
由于是**不同字段**的修改，当设备 2 拉取云端（设备 1）的数据时：
- 本地有 `name="Mojito Classic"`，云端有 `name="Mojito"`。退化保留本地值 `name="Mojito Classic"`。
- 本地没有 `price=60` 的新修改（本地是 `price=50`），但因为是整条记录对比，`price` 字段在两端都存在。退化保留本地值 `price=50`。

**结论：发生数据静默丢弃**。设备 2 会把设备 1 对 `price` 的修改抹除。这与有 `updatedAt` 时的理想行为（保留两端的各自修改）不同。

### 场景二：两端并发修改同一条记录的**同一字段**（静默覆盖）

**假设场景**：
- 初始状态：酒瓶 B（`cocktail.bottles`），`stock=10`
- 设备 1：盘点后修改 `stock=8`，并同步到云端
- 设备 2（离线）：盘点后修改 `stock=5`，随后恢复网络拉取云端数据

**合并结果**：
- 两端都有 `stock` 字段。
- `localTs=0, remoteTs=0`。
- 退化保留本地值 `stock=5`。

**结论：后同步的一端（设备 2）的修改会静默覆盖先同步的一端（设备 1）的修改。** 这种表现本质上等同于整体 LWW。

### 场景三：一端修改记录，另一端未修改（最常见场景，静默覆盖）

**假设场景**：
- 初始状态：食材 C（`food.ingredients.v2`），`cost=10`
- 设备 1：修改 `cost=15`，同步到云端
- 设备 2：**未做任何修改**，打开 App 拉取云端数据

**合并结果**：
- 设备 2 本地有食材 C，且有 `cost=10` 字段。
- 云端有食材 C，`cost=15`。
- `localTs=0, remoteTs=0`。
- 退化保留本地值 `cost=10`。

**结论：极其危险！云端的修改永远无法同步到设备 2。** 设备 2 会一直停留在旧数据，除非它清空本地缓存重新拉取。

*注意：实际代码中，`pull` 函数在拉取时，如果发现某个键的 `sync.ts.<key>`（键级时间戳）有更新，会整体拉取。但 `mergeIdList` 会在内部阻断这种更新，导致合并后的结果依然是旧数据。*

## 为什么目前没有大规模爆发 Bug？

虽然理论上存在「云端修改无法同步到本地」的严重问题，但在实际运行中，这 23 个键的冲突问题被以下机制部分掩盖：

1. **60 秒冲突窗口**：如果两端在 60 秒内都修改了同一个键，会弹出冲突对话框，让用户手动选择保留哪一端，绕过了 `mergeIdList`。
2. **全量覆盖**：如果一端完全没有数据（空设备），会直接采用云端数据。
3. **单设备主导**：许多基础数据（如配方、酒瓶、供应商）通常只由店长在一台设备上维护，很少发生多设备高频并发修改。

## 修复建议

为了彻底解决这 23 个键在多设备同步时可能出现的「数据静默丢弃」和「云端更新无法拉取」问题，必须为它们的数据结构补充 `updatedAt` 字段。

**涉及的 23 个键**：
- `cocktail.recipes`, `cocktail.bottles`, `wine.bottles.v1`
- `homemade.preps.v1`, `cocktail.lab.projects`, `cocktail.lab.batches`, `lab.plan.v1`
- `food.menu.v1`, `food.ingredients.v2`
- `monthly_summary.suppliers.v1`, `monthly_summary.payments.v1`
- 烈酒模块的 12 个键（`spirits.items.v3` 等）

**修复方案**：
在对应的 TypeScript 接口中添加 `updatedAt?: number`，并在对应的 Store 的 `update/upsert` 方法中写入 `updatedAt: Date.now()`。这与本次修复 `Employee` 对象的做法完全一致。

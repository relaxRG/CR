# 食材月度台账：核心实现与重构审计

**范围：**食材的按月采购、消耗、月末盘点、月结；供应商导入；详情页快捷入出库；葡萄酒、水果、啤酒的直接完整台账展示。

> 完整可执行源文件请同时查看附件：`lib/food/ingredient-store.tsx`、`app/food-inventory.tsx`、`tests/food-monthly-ledger.test.ts`。本文件用于说明各模块之间的调用关系、清理结果和防回归边界。

## 1. 食材月度链路的完整调用关系

```text
手工进货 / 供应商批量导入 / 详情页快捷入库
  └─ recordPurchase / batchImport
      ├─ 更新当前库存、供应商、最新单价与价格历史
      ├─ 更新 ledgerEntries[month, ingredientId].purchaseQty / purchaseCost
      └─ 追加 ledgerMovements(kind = "purchase")

手工消耗 / 详情页快捷出库
  └─ recordConsume
      ├─ 更新当前库存
      ├─ 更新 ledgerEntries.consumeQty / consumeCost
      └─ 追加 ledgerMovements(kind = "consume")

月末盘点
  └─ recordStocktake
      ├─ 写入 actualClosingQty / actualClosingUnitCost
      ├─ 用实盘数量更新当前库存
      └─ 追加 ledgerMovements(kind = "stocktake")

月结
  └─ closeMonth
      └─ 若尚未实盘，冻结公式期末；下月 buildFoodMonthlyLedger 读取最近上月期末为期初。
```

月度行由 `buildFoodMonthlyLedger(state, month)` 统一生成。其期末公式为：

```ts
const closingUnitCost = entry.actualClosingUnitCost ?? weightedUnitCost(entry);
const closingQty = entry.actualClosingQty ?? theoreticalClosingQty(entry);
const closingCost = Math.round(closingQty * closingUnitCost * 100) / 100;
```

其中，未实盘时：`期末数量 = max(0, 期初数量 + 进货数量 − 消耗数量)`；单位成本使用期初成本与进货成本的加权平均。实盘后，数量与可选单位成本以实盘数据为准。

| 写入入口 | 统一状态动作 | 防错边界 |
|---|---|---|
| 食材库存“录入进货” | `RECORD_PURCHASE` | 首笔采购先创建期初行，再写采购，避免采购先改库存而污染期初 |
| 供应商导入 | `BATCH_IMPORT → applyPurchase` | 新建食材立即返回稳定 ID，并在同一批内进入采购流水 |
| 食材库存“录入消耗” | `RECORD_CONSUME` | 自动限制当前库存不为负数；实盘状态在后续流水发生时失效 |
| 食材库存“月末盘点” | `RECORD_STOCKTAKE` | 以实盘数量覆写期末，同时保存可追溯盘点流水 |
| 食材详情“入库 +1 / 出库 -1” | `recordPurchase / recordConsume` | 已移除直接写 `stock` 的绕行路径 |
| 删除食材 | `DELETE` | 同时删除该食材的价格历史、月度行和原子流水，避免孤儿数据 |

## 2. 受本次重构影响的逻辑与引擎

| 模块 | 现状与职责 | 本次处理 |
|---|---|---|
| `lib/food/ingredient-store.tsx` | 食材档案、价格历史、本地持久化与同步 | 新增月度行和原子流水；采购、消耗、盘点、月结全部进入 reducer；新增首次水合屏障，避免空状态覆盖本地数据 |
| `lib/food/types.ts` | 食材领域类型 | 新增 `FoodMonthlyLedgerEntry`、`FoodLedgerMovement`、流水类型 |
| `app/food-inventory.tsx` | 食材工作台 | 直接完整横向台账；采购、消耗、盘点、月结入口；名称详情卡片 |
| `components/food/FoodLedgerMovementModal.tsx` | 食材操作表单 | 消耗与盘点共用输入组件，统一写入月度链路 |
| `app/supplier-import.tsx` | 供应商导入 | 新建食材获得稳定 ID，随后进入同批 `batchImport` 与供应商进货记录 |
| `app/food-ingredient/[id].tsx` | 食材详情 | 快捷加减库存改为采购/消耗流水，不再直接覆盖 `stock` |
| `components/inventory/HorizontalLedgerTable.tsx` | 台账呈现 | 通用列配置、分组、局部横向滚动和名称点击回调 |
| `components/inventory/MonthlyLedgerDetailSheet.tsx` | 移动端详情 | 通用名称详情卡片，复用同一月度行数据 |
| `components/inventory/BaseInventoryScreen.tsx` | 水果、啤酒、冰块和店铺通用库存壳 | 增加显式 `ledgerPresentation`；水果、啤酒启用直接完整台账，冰块和店铺继续使用有效的卡片模式 |
| `app/wine-inventory.tsx` | 葡萄酒自定义台账 | 删除旧 `LedgerRow` 折叠卡片，接入完整横向台账、筛选结果和名称详情 |

## 3. 已删除的旧代码与废弃字段

| 项目 | 清理结果 |
|---|---|
| 葡萄酒旧 `LedgerRow`、`NumCell`、`DetailRow` | 已删除，不再与横向台账并存 |
| 食材库存旧卡片分组 `byCategory` | 已删除，改由月度台账分组直接渲染 |
| 食材无用的文件选择/文件系统导入 | 已删除 |
| 食材详情直接 `updateIngredient(... stock ...)` | 已删除，改用采购/消耗流水 |
| `alertThreshold` | 不存在活跃业务模型、表单和计算路径；仅保留历史加载时剥离函数与对应测试 |
| 通用 `MonthlyLedgerSheet` | **保留且非废弃**；目前仍被冰块、杯具、餐具、日用品、设备的卡片模式使用 |

## 4. 本次问题根因与开发规范

这次发现并修复的风险并非单一界面问题，而是“库存写入口不唯一”造成的账实链路断裂：详情页可以直接改库存、供应商导入的新建条目没有稳定 ID，因此两者可能改变当前库存却没有对应的月度台账事实。另一个风险是异步加载尚未完成时把空 state 写回本地存储，造成数据被覆盖。

后续必须遵守以下规范：

1. **库存数量只能通过领域动作写入。**采购必须走 `recordPurchase`，消耗必须走 `recordConsume`，盘点必须走 `recordStocktake`；UI 不得直接设置 `stock`。
2. **一批业务必须具有稳定实体 ID。**任何“先新增、后入库”的流程必须由新增动作同步返回 ID，并将该 ID 用于同一事务/批次的后续记录。
3. **加载优先于持久化。**异步 store 必须具有 hydration barrier；未水合状态不可写回持久化层或通知同步引擎。
4. **月度行只从不可变事实汇总。**当前库存只用于首次启用月度链路的基线；后续历史月份必须从上月期末、采购、消耗与盘点记录推导。
5. **每个写入口都必须有 reducer 级测试和页面级回归。**至少覆盖首笔采购、跨月结转、导入、新建条目、详情快捷操作、盘点覆盖、删除清理和热重载加载。

## 5. 测试与移动端验证

| 测试层 | 覆盖点 | 最新结果 |
|---|---|---|
| 食材 reducer | 采购、消耗、实盘、月结、批量导入、删除清理、详情快捷入口、历史字段清理 | `6` 项通过 |
| 供应商导入连接 | 新建食材稳定 ID、同批入库归属、供应商记录归属 | `2` 项通过 |
| 直接台账结构 | 通用横向表格、葡萄酒移除旧卡片、水果/啤酒配置、食材入口 | `4` 项通过 |
| 日期与月份 | 葡萄酒非法/跨月日期、食品供应商非法日期、统一月份边界与钳制 | `7` 项通过 |
| 全量单元回归 | 全仓库功能 | `88` 文件、`925` 用例通过 |
| H5 移动端 | 375、390、430pt；葡萄酒、水果、啤酒、食材台账横向滚动、名称详情、无根级横向溢出 | 全部通过 |

H5 数据表自身宽度为 936–974px，而 375–430pt 视口内的表格容器宽度为 343–398px；脚本确认 `scrollLeft` 可到达右端，且 `documentElement/body` 宽度始终等于视口宽度，因此横向内容被限制在台账容器内，没有造成页面级卡顿或横向溢出。

## 6. 残余边界

历史版本的食材档案原本没有按月采购和消耗事实，系统不会凭当前库存虚构历史月份流水。首次记录某月份业务时，当前库存作为该链路的初始期初基线；完成月结后，后续月份严格以已冻结的上月期末结转。该策略避免捏造历史数据，并确保今后每笔新增业务都可追溯。

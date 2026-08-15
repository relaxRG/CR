# 库存模块架构审查与移动端台账实现方案

**审查范围：**库存/店铺工作台、十个分类的月份传播、烈酒/葡萄酒/食材/通用库存状态引擎、完整横向台账、名称详情卡片、移动端端到端脚本。

## 1. 审查结论

当前架构已经具备一个可复用的**工作台层 + 月份层 + 分类业务层 + 台账呈现层**。水果和啤酒能够通过 `BaseInventoryScreen` 的配置直接复用完整台账；葡萄酒和食材使用相同的 `HorizontalLedgerTable`，但各自保留专有的字段、筛选和写入流程。烈酒仍保持专门的 14 列台账，满足集团、分类生命周期和供应商进货等更复杂业务。

> 新建一个“字段与通用进销存一致”的分类，现有架构可以直接复用；新分类不需要复制横向滚动、详情卡片、月份导航或基础的采购/消耗/月结模态框。

| 维度 | 当前判断 | 结论 |
|---|---|---|
| 移动端横向表格 | 滚动限制在 `HorizontalLedgerTable` 自身 `ScrollView` | 可复用且已验证 |
| 点击详情 | 名称列只绑定 `onPress`，不会让整行误触 | 可复用且已验证 |
| 普通库存分类 | `BaseInventoryScreen` 提供 cards/table 展示切换和通用写入组件 | 复用性高 |
| 自定义复杂分类 | 葡萄酒、食材、烈酒仍各有数据模型和业务页 | 复用 UI，不能强行统一状态模型 |
| 月份边界 | 外层工作台统一钳制 | 可靠；本次已补齐食材月度行与流水来源 |
| 持久化安全 | 通用 store 和食材已有水合屏障；烈酒、葡萄酒仍需补齐 | 后续 P0 架构债务 |

## 2. 现有前端架构与数据流

```text
StoreInventoryScreen
  ├─ 分类分段标签：CATEGORIES
  ├─ BoundedMonthNavigator：统一业务月、边界钳制、快速选月
  ├─ categoryMonths：各分类事实日期 → 全局可用月份范围
  └─ InventoryBusinessPanel
       ├─ SpiritsInventoryScreen（烈酒专用 14 列台账）
       ├─ WineInventoryScreen（葡萄酒专用数据 + 通用横向表）
       ├─ FoodInventoryScreen（食材月度事实 + 通用横向表）
       └─ BaseInventoryScreen（水果、啤酒、冰块、杯具、餐具、日用品）
            ├─ HorizontalLedgerTable（table 模式）
            ├─ MonthlyLedgerSheet（cards 模式）
            ├─ MonthlyLedgerDetailSheet（名称详情）
            ├─ PurchaseEntryModal / OpeningStockModal / MonthCloseModal
            └─ ItemEditModal（既有商品禁止直接改库存）
```

### 2.1 工作台与月份层

`components/store/inventory.tsx` 是唯一的分类导航宿主。它根据模式过滤库存六类或店铺四类，持久化当前分类和月份，并调用 `deriveInventoryMonthBounds` 生成最早业务月前一个月到最晚业务月后一个月的可选范围。

本次修复将以下事实加入食材的 `categoryMonths`：

```ts
food: [
  ...foodStore.ledgerEntries.map((entry) => entry.month),
  ...foodStore.ledgerMovements.flatMap((movement) => [movement.month, movement.date]),
  ...foodStore.ingredients.flatMap((ingredient) => (ingredient.priceHistory ?? []).map((entry) => entry.date)),
  ...foodPurchases.records.flatMap((record) => [record.importDate, ...(record.items ?? []).map((item) => item.date)]),
]
```

因此，**仅发生消耗、盘点或月结的食材月份也能被工作台选中**，不会因为没有采购价变更而被月份浏览器遗漏。

### 2.2 通用横向台账组件

`components/inventory/HorizontalLedgerTable.tsx` 的稳定接口如下：

```ts
export interface HorizontalLedgerColumn<Row> {
  key: string;
  label: string;
  width: number;
  align?: "left" | "center" | "right";
  render: (row: Row) => ReactNode;
  onPress?: (row: Row) => void;
  testID?: (row: Row) => string;
}

export interface HorizontalLedgerGroup<Row> {
  id: string;
  label: string;
  color: string;
  rows: Row[];
}
```

表格容器只在自身范围内设置 `horizontal`，并由页面保持根视图非横向滚动。名称列配置 `onPress` 后会变成独立的 `Pressable`，因此用户可以点击商品名称打开详情卡片，而数字列不会误触发。

| 组件能力 | 当前实现 | 分类使用情况 |
|---|---|---|
| 局部横向滚动 | 最外层 `ScrollView horizontal` | 葡萄酒、水果、啤酒、食材 |
| 列配置 | `width`、对齐、单元格 render | 每个分类自行定义业务字段 |
| 分类分组 | `groups` 传入颜色、标签和行 | 食材按食材类别；葡萄酒按酒类；通用分类按品类 |
| 名称详情 | `onPress` + `testID` | 四类直接台账均已接入 |
| 合计行 | `footer` 插槽 | 食材使用动态期初/期末/期末成本合计 |

### 2.3 食材月度链路的UI实现

`app/food-inventory.tsx` 默认进入“库存管理”。其完整台账展示十一项：商品名称、期初数量/单价/成本、进货数量/成本、消耗数量/成本、期末库存/单价/成本。名称列打开底部详情卡片，完整数据仍以当前月的 `getMonthLedger(currentMonth)` 为唯一来源。

操作栏保持同一行局部横向滚动，包含：**录入进货、录入消耗、月末盘点、月结**。采购调用 `recordPurchase`；消耗和盘点通过 `FoodLedgerMovementModal` 分别调用 `recordConsume`、`recordStocktake`；月结调用 `closeMonth`。

> 详情页中的“入库 +1 / 出库 -1”也不再直接写 `stock`：前者写采购流水，后者写消耗流水。供应商导入新建食材时会即时取得稳定 ID，再进入同一批 `batchImport`，使新增档案也具有可追溯采购事实。

### 2.4 各分类台账与UI差异

| 分类 | 主页实现 | 表格形态 | 名称点击 | 保留的专有UI |
|---|---|---|---|---|
| 烈酒 | 专用 `SpiritsInventoryScreen` | 14 列，集团最右、排序筛选、分类管理 | 详情卡片 | 进货表、采购分析、分类生命周期 |
| 葡萄酒 | `WineInventoryScreen` + 通用横向表 | 期初/进货/期末/消耗字段 | `MonthlyLedgerDetailSheet` | 供应商筛选、搜索、月末盘点 |
| 水果 | `BaseInventoryScreen` table 模式 | 通用库存月度字段 | `MonthlyLedgerDetailSheet` | 水果类别和损耗配置 |
| 食材 | `FoodInventoryScreen` + 通用横向表 | 月度采购、消耗、盘点和结转字段 | 食材专用详情底部卡片 | 价格波动、供应商导入、消耗/盘点表单 |
| 啤酒 | `BaseInventoryScreen` table 模式 | 通用库存月度字段 | `MonthlyLedgerDetailSheet` | 包装、售价等 extra 字段 |
| 冰块/店铺 | `BaseInventoryScreen` cards 模式 | 紧凑卡片台账 | 卡片详情 | 冰块成本联动、店铺用品业务 |

## 3. 移动端端到端验证

H5 回归脚本 `scripts/h5-schedule-correction-e2e.mjs` 已扩展为六种手机宽度：**320、360、375、390、412、430pt**。每一台账分类均验证：

1. 完整台账容器与商品名称 `testID` 存在；
2. 表格 `scrollWidth > clientWidth` 时，设置 `scrollLeft` 后能够到达最右端；
3. 商品名称点击后详情卡片出现；
4. `documentElement.scrollWidth` 与 `body.scrollWidth` 不大于视口，防止根级横向溢出；
5. 回归结束后主动关闭专用测试标签页，避免连续执行堆积 Chromium 渲染进程。

| 分类 | 台账内容宽度 | 320pt 至 430pt 结果 |
|---|---:|---|
| 葡萄酒 | 974px | 局部可横向滚动、名称详情正常、无根级溢出 |
| 水果 | 936px | 局部可横向滚动、名称详情正常、无根级溢出 |
| 啤酒 | 936px | 局部可横向滚动、名称详情正常、无根级溢出 |
| 食材 | 956px | 局部可横向滚动、名称详情正常、无根级溢出 |

## 4. 新分类的复用方案

### 4.1 可直接接入的普通分类

若新分类满足“档案 + 采购 + 消耗 + 月末快照”的通用模型，应使用 `createGenericInventoryStore` 和 `BaseInventoryScreen`。只需提供：存储键、分类颜色、单位、分类选项、扩展字段、是否显示损耗、是否默认直接台账。

```tsx
<BaseInventoryScreen
  title="新分类库存"
  emoji="📦"
  accentColor="#0EA5E9"
  useStore={useNewInventoryStore}
  defaultTab="ledger"
  ledgerPresentation="table"
  defaultUnit="件"
  categoryOptions={[{ value: "standard", label: "标准" }]}
  extraFields={[{ key: "brand", label: "品牌" }]}
/>
```

### 4.2 需要专用适配层的复杂分类

如果新分类拥有独立的导入格式、供应商分析、成本算法、分组规则或盘点字段，应保留专有状态引擎，但将展示层标准化为：`buildMonthLedger(month)` → `HorizontalLedgerTable` 的 `columns/groups/rowKey` → `MonthlyLedgerDetailSheet`。烈酒、葡萄酒和食材就是这种方式。

## 5. 架构风险与优先级

| 优先级 | 发现 | 风险 | 建议 |
|---|---|---|---|
| P0 | 葡萄酒和烈酒 store 目前没有 `hydrated/ready` 写回屏障 | 初始空 state 有机会在异步读取完成前写回存储 | 将通用库存/食材已采用的水合屏障抽为统一 hook，并迁移葡萄酒与烈酒 |
| P1 | 分类定义分散在分类数组、store hook、月份来源与 `switch` 装配 | 新分类需要多处手工修改，容易遗漏月份来源 | 建立类型化分类注册表；每个分类显式声明 `render` 与 `collectMonths` |
| P1 | 复杂分类在页面内声明列和分组 | 同列语义的宽度、金额格式、合计策略可能漂移 | 抽取 `ledger-column-presets.tsx` 与 `currency/quantity` 单元格渲染器 |
| P2 | 食材详情卡片与通用详情卡片是两个组件 | 视觉字段可能逐步不一致 | 将食品特有指标建成 detail section 插槽，逐步复用通用底部卡片壳 |
| P2 | H5 E2E 过去只覆盖 375/390/430pt 且不关闭测试页 | 极窄屏遗漏、重复回归可能耗尽浏览器资源 | 本次已扩展至 320–430pt，并增加专用页关闭逻辑 |

## 6. 推荐的后续UI调整

当前UI已满足“进入库存管理直接看完整台账”。下一轮不建议重新加入移动概览切换，而建议沿用下列优先顺序：

1. **P0：统一水合状态。**在台账区域加载前显示骨架屏或“正在读取库存”状态，直到所有持久化 key 已完成读取，避免短暂空表和意外写回。
2. **P1：列预设统一。**使期初、进货、消耗、期末等公共列具有一致的宽度、数量小数位和金额格式；分类只追加专有列。
3. **P1：详情卡片分段。**统一为“期初 / 本期发生 / 期末 / 备注”四个区块，食材额外展示最近采购价和盘点差异，烈酒额外展示集团。
4. **P2：表头辅助提示。**首次进入宽表时，在表格右缘显示一次性轻提示“左右滑动查看全部字段”；提示确认后本地记忆，不重复打扰。
5. **P2：新分类注册表。**以一个定义对象同时提供标签、颜色、月份事实源、路由页面和台账适配器，消除目前的硬编码多处登记。

## 7. 本轮实际修复

本轮架构审查已落地两项修复：食材月度行和消耗/盘点流水已纳入统一月份边界；H5 回归扩大为六种手机尺寸，并在测试结束时清理专用测试页。对应护栏为 `tests/food-ledger-month-browser-wiring.test.ts`。

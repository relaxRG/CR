# 烈酒库存14列表格移动端优化实施方案

## 目标

在不改变库存、采购、成本、月结和导入业务计算的前提下，将移动端375–430pt上的14列表格改为“视觉主列固定 + 关键结果优先 + 抽屉查看完整详情”。桌面与平板宽屏继续保留完整横向表格，满足高密度对账需求。

> 不建议在React Native `ScrollView` 中实现传统网页式的真正冻结列。它需要双横向容器、双纵向容器和滚动位置同步，容易造成惯性滚动不同步、行高错位和性能问题。移动端应采用等价但更稳定的“固定身份卡片列表 + 详情抽屉”模式。

## 断点与呈现模式

| 宽度 | 模式 | 目的 |
|---|---|---|
| `< 600pt` | `LedgerCompactList` | 固定身份主列、纵向虚拟列表、抽屉显示完整14列。 |
| `600–899pt` | `LedgerResponsiveTable` | 保留横向表格；品名与期末库存优先，允许局部横滑。 |
| `≥ 900pt` | `LedgerWideTable` | 沿用现有14列对账表。 |

采用 `useWindowDimensions()` 取得实时宽度；禁止模块顶层 `Dimensions.get()`。

## 移动端视觉主列

每个品项只在主列表中显示当前经营最需要的三项，不横向滚动：

| 固定区域 | 数据 | 说明 |
|---|---|---|
| 身份主列 | 分类色标、中文名、分类、负库存状态 | 保证用户始终知道正在查看哪个品项。 |
| 关键库存 | 期末库存量 | 负库存以错误颜色和文字提示。 |
| 关键成本 | 期末成本 | 作为月度库存决策核心金额。 |
| 操作提示 | `›` | 点击打开详情抽屉，而不是要求用户横滑14列。 |

主列表不显示期初库存、参考价、进货量、单价、消耗瓶数等低频列；这些数据进入抽屉的“期初 / 进货 / 期末 / 消耗”四个分组。

## 组件结构

```tsx
type LedgerDisplayModel = {
  item: SpiritItem;
  entry: SpiritLedgerEntry | undefined;
  categoryLabel: string;
  categoryColor: string;
  isNegative: boolean;
  opening: { quantity: number; unitCost: number; cost: number };
  purchases: { quantity: number; cost: number };
  closing: { quantity: number; unitCost: number; cost: number };
  consumption: { bottles: number; quantity: number; cost: number };
};

function SpiritsLedger({ width, rows }: { width: number; rows: LedgerDisplayModel[] }) {
  if (width < 600) return <LedgerCompactList rows={rows} />;
  return <LedgerWideTable rows={rows} />;
}
```

`LedgerDisplayModel` 必须由现有 `getItemLedger(item.id, selectedMonth)` 及现有成本函数构建，不能在紧凑列表和抽屉中重新计算库存或成本。

## 紧凑列表实现骨架

```tsx
function LedgerCompactList({ rows }: { rows: LedgerDisplayModel[] }) {
  const [selected, setSelected] = useState<LedgerDisplayModel | null>(null);

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={({ item }) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelected(item)} style={styles.compactRow}>
            <View style={[styles.categoryDot, { backgroundColor: item.categoryColor }]} />
            <View style={styles.identity}>
              <Text numberOfLines={2} style={styles.itemName}>{item.item.name}</Text>
              <Text numberOfLines={1} style={styles.category}>{item.categoryLabel}</Text>
            </View>
            <Metric label="期末库存" value={item.closing.quantity} tone={item.isNegative ? "negative" : "default"} />
            <Metric label="期末成本" value={formatMoney(item.closing.cost)} />
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        )}
        ListHeaderComponent={<LedgerCompactHeader />}
      />
      <LedgerDetailSheet row={selected} onClose={() => setSelected(null)} />
    </>
  );
}
```

使用 `FlatList`，而不是外层纵向 `ScrollView` 再嵌套14列表格。这样可以避免长库存清单在移动端重复渲染，且抽屉打开不会影响原列表的滚动位置。

## 抽屉详情

详情使用现有项目的 `Modal`/底部Sheet规范，不新增业务存储：

```tsx
function LedgerDetailSheet({ row, onClose }: Props) {
  if (!row) return null;
  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <SheetHandle />
        <LedgerIdentity row={row} />
        <DetailSection title="期初" metrics={[row.opening.quantity, row.opening.unitCost, row.opening.cost]} />
        <DetailSection title="本月进货" metrics={[row.purchases.quantity, row.purchases.cost]} />
        <DetailSection title="期末库存" metrics={[row.closing.quantity, row.closing.unitCost, row.closing.cost]} />
        <DetailSection title="本期消耗" metrics={[row.consumption.bottles, row.consumption.quantity, row.consumption.cost]} />
        <LedgerActions row={row} />
      </View>
    </Modal>
  );
}
```

抽屉复用现有“编辑酒款、修改分类、编辑期初、月末盘点”等操作回调；业务写入仍走现有 `updateItem`、`upsertLedger`、`setActualClosing` 和 `syncLedgerFromPurchases`。

## 数据与性能约束

1. 所有显示字段来自单一 `LedgerDisplayModel`，防止紧凑列表、宽表和抽屉金额不一致。
2. `rows` 以 `useMemo` 按 `items`、`ledger`、`selectedMonth`、`categories` 构建；不要在单行渲染中反复调用全表筛选。
3. 紧凑列表使用稳定 `item.id`、`React.memo` 行组件和固定/估算行高；长按业务菜单按需创建。
4. 抽屉仅保存选中行ID或显示模型，不复制库存状态；保存后从Store重新读取同一模型。
5. 宽屏表格继续是局部横滑，禁止改为完整逻辑页分页。

## 实施顺序

| 步骤 | 改动 | 验收 |
|---|---|---|
| 1 | 提取 `LedgerDisplayModel` 纯构建函数 | 宽表与紧凑列表读取同一金额。 |
| 2 | 保留桌面宽表，新增 `<600pt` 紧凑列表分支 | 375/390/430pt无根级横向溢出。 |
| 3 | 新增详情抽屉和四段指标 | 14列所有数据可见，关键列首屏可见。 |
| 4 | 将现有行操作接入抽屉 | 编辑、分类、盘点、导入后刷新不回退。 |
| 5 | 补充H5与单元测试 | 触发详情、负库存、长品名、导入后同步、宽度切换均通过。 |

## 回归矩阵

| 场景 | 断言 |
|---|---|
| 375/390/430pt | 根级宽度等于视口；品名、期末库存、期末成本可见；点击打开详情。 |
| 长中文/英文品名 | 名称最多两行，不挤压关键指标或操作箭头。 |
| 负库存 | 主列表和详情中均显示同一负库存状态。 |
| 导入采购后 | 台账和当月进货显示同一记录；紧凑列表期末指标刷新。 |
| 600pt边界 | 从紧凑列表切换到宽表时，金额、分组和当前月份不改变。 |
| 桌面宽屏 | 14列可局部横滑；不使用整页分页工具。 |

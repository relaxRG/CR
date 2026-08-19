# 报表与库存：色彩映射前端组件示例与共享库审计

> 此文档展示如何使用 `store-visual-system.ts` 中的基础颜色角色和领域映射。示例不改变数据计算、月结、导入或台账列，只负责将视觉颜色放在正确的业务语义上。

## 1. 报表：净利润可以上色，普通收入/支出/手续费保持中性

总营业收入、总支出和手续费只是金额事实，不应因“收入”或“支出”自动变绿或变红。净利润、导入异常、校验差额、待核对状态则包含可操作的结果，适合使用状态色。

```tsx
import { Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StoreMetric, StoreSectionHeader } from "@/components/store/store-visual-primitives";
import {
  STORE_TEXT,
  storeTone,
  type StoreVisualColors,
  type StoreVisualTone,
} from "@/lib/theme/store-visual-system";

function reportProfitTone(netProfit: number, hasReconciliationGap: boolean): StoreVisualTone {
  if (hasReconciliationGap || netProfit < 0) return "danger";
  if (netProfit > 0) return "positive";
  return "neutral";
}

export function MonthlyReportSummary({
  revenue,
  expenses,
  serviceFee,
  netProfit,
  hasReconciliationGap,
  colors,
}: {
  revenue: number;
  expenses: number;
  serviceFee: number;
  netProfit: number;
  hasReconciliationGap: boolean;
  colors: StoreVisualColors;
}) {
  const profitTone = reportProfitTone(netProfit, hasReconciliationGap);

  return (
    <View style={{ gap: 12 }}>
      <StoreSectionHeader
        label="本月经营概览"
        detail={hasReconciliationGap ? "存在待核对金额" : "已汇总当前月份"}
        icon="chart.bar.fill"
        tone={hasReconciliationGap ? "attention" : "primary"}
        colors={colors}
      />

      <View style={{ flexDirection: "row", gap: 12 }}>
        {/* 普通业务金额均是中性，不将收入/支出本身状态化。 */}
        <StoreMetric label="营业收入" value={`¥${revenue.toFixed(2)}`} icon="arrow.down.left.circle" tone="neutral" colors={colors} />
        <StoreMetric label="总支出" value={`¥${expenses.toFixed(2)}`} icon="arrow.up.right.circle" tone="neutral" colors={colors} />
        <StoreMetric label="手续费" value={`¥${serviceFee.toFixed(2)}`} icon="creditcard" tone="neutral" colors={colors} />

        {/* 净利润是明确结果，才依据正/负/异常改变颜色。 */}
        <StoreMetric
          label={hasReconciliationGap ? "净利润（待核对）" : "净利润"}
          value={`¥${netProfit.toFixed(2)}`}
          icon={netProfit < 0 ? "exclamationmark.triangle" : "chart.line.uptrend.xyaxis"}
          tone={profitTone}
          primary
          colors={colors}
        />
      </View>
    </View>
  );
}
```

下面的科目行展示“状态色在标签上、金额保持中性”的模式。即使某一笔支出尚未付款，金额正文仍然是中性；用户通过“待付”标签、图标与可进入的处理入口了解状态。

```tsx
export function ReportLineItem({
  label,
  amount,
  isPaid,
  hasImportError,
  colors,
}: {
  label: string;
  amount: number;
  isPaid: boolean;
  hasImportError: boolean;
  colors: StoreVisualColors;
}) {
  const statusTone: StoreVisualTone = hasImportError ? "danger" : isPaid ? "positive" : "attention";
  const statusLabel = hasImportError ? "导入异常" : isPaid ? "已付" : "待付";

  return (
    <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ ...STORE_TEXT.body, color: colors.foreground }}>{label}</Text>
        <View style={{ borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: `${storeTone(colors, statusTone)}14` }}>
          <Text style={{ ...STORE_TEXT.caption, color: storeTone(colors, statusTone) }}>{statusLabel}</Text>
        </View>
      </View>
      <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>¥{amount.toFixed(2)}</Text>
    </View>
  );
}
```

## 2. 库存：台账金额中性，只有状态与真实差异上色

库存数量、进货成本、消耗成本、期末成本不是成功或失败。它们在高密度 Excel 台账中应保持中性。损耗、盘点差异、负库存、导入冲突才使用异常色；已盘点、已月结使用正向色；待盘点和月结草稿使用关注色。

```tsx
import { Text } from "react-native";
import {
  storeTone,
  type StoreVisualColors,
  type StoreVisualTone,
} from "@/lib/theme/store-visual-system";
import { STORE_TABLE_METRICS, formatStoreMoney, formatStoreQuantity } from "@/lib/store/table-display";

type InventoryCellKind =
  | "normalQuantity"
  | "normalCost"
  | "loss"
  | "stockDifference"
  | "negativeStock"
  | "confirmedClose"
  | "pendingCount";

function inventoryCellTone(kind: InventoryCellKind): StoreVisualTone {
  switch (kind) {
    case "loss":
    case "stockDifference":
    case "negativeStock":
      return "danger";
    case "confirmedClose":
      return "positive";
    case "pendingCount":
      return "attention";
    default:
      return "neutral";
  }
}

export function InventoryLedgerValue({
  value,
  kind,
  format = "money",
  colors,
}: {
  value: number;
  kind: InventoryCellKind;
  format?: "money" | "quantity";
  colors: StoreVisualColors;
}) {
  const tone = inventoryCellTone(kind);
  const isZero = value === 0;
  const text = format === "money" ? formatStoreMoney(value) : formatStoreQuantity(value);

  return (
    <Text
      style={{
        color: isZero ? colors.muted : storeTone(colors, tone),
        fontSize: STORE_TABLE_METRICS.numericFontSize,
        fontWeight: tone === "danger" || tone === "positive" ? "600" : "500",
      }}
    >
      {isZero ? "—" : text}
    </Text>
  );
}
```

以下示例说明普通“进货成本”和“消耗成本”不要自动着色。它们通过列标题和数值本身传达含义；只有损耗/差异才是红色异常。

```tsx
const ledgerColumns = [
  {
    key: "purchaseCost",
    label: "进货成本",
    render: (row: LedgerRow) => (
      <InventoryLedgerValue value={row.purchaseCost} kind="normalCost" colors={colors} />
    ),
  },
  {
    key: "consumeCost",
    label: "消耗成本",
    render: (row: LedgerRow) => (
      <InventoryLedgerValue value={row.consumeCost} kind="normalCost" colors={colors} />
    ),
  },
  {
    key: "lossCost",
    label: "损耗成本",
    render: (row: LedgerRow) => (
      <InventoryLedgerValue value={row.lossCost} kind="loss" colors={colors} />
    ),
  },
  {
    key: "closingQty",
    label: "期末量",
    render: (row: LedgerRow) => (
      <InventoryLedgerValue
        value={row.closingQty}
        kind={row.closingQty < 0 ? "negativeStock" : "normalQuantity"}
        format="quantity"
        colors={colors}
      />
    ),
  },
];
```

## 3. 分类图表、分组图标和日历：丰富颜色的正确位置

分类色使用 `storeCategoryColor()`，按稳定序号选择主题中的九色分类调色板。相同分类应把颜色持久化在分类实体上或通过稳定排序计算；不要因列表重新排序而改变颜色。分类色出现于图表系列、图例、分类分组标题、分类图标背景和日历色点，**不进入普通台账每一行的金额文本**。

```tsx
import { storeCategoryColor } from "@/lib/theme/store-visual-system";

const sortedCategories = categories
  .slice()
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

const chartSeries = sortedCategories.map((category, index) => ({
  id: category.id,
  label: category.name,
  color: category.customColor ?? storeCategoryColor(colors, index),
  values: totalsByCategory[category.id] ?? [],
}));
```

当分类超过九种时，首先将低频分类合并为“其他”、让用户筛选前九类或使用分面图；不要直接增加相似色。只有第十类是稳定、高频、需要长期识别的领域对象时，才新增主题分类色，同时为浅色、深色和增强对比度登记变体。

## 4. 当前共享组件库审计

审计发现下列代码已经在使用共享系统，但仍保留了与新规范不一致的旧样式。它们应按优先级迁移；本清单不改变任何业务计算。

| 优先级 | 文件 | 发现的残留 | 规范要求的修正 |
|---|---|---|---|
| P0 | `components/inventory/HorizontalLedgerTable.tsx` | 表头强制主蓝背景、`#fff`、`#DCEBFF` 和 800 字重；分类组标题也为 800 | 改为中性表头表面 + 主色排序/选中提示；标题和分组最高 600；分类色仅用于色点、细线与图例 |
| P0 | `components/inventory/BaseInventoryScreen.tsx` | 商品名、期末量、期末成本使用 800；普通进货/消耗成本被品类色或 warning 染色；直接页签为深色块 | 普通台账金额中性；仅损耗/差异/负库存使用异常色；页签切换到共享 40pt 文字下划线样式 |
| P1 | `components/inventory/BoundedMonthNavigator.tsx` | 月份卡片有 700/800 字重及直写白色、遮罩、阴影数值 | 标题/年份降至 600；文本、表面与遮罩迁移到主题令牌；保留必要的选中对比度 |
| P1 | `app/monthly-summary.tsx` | `LineItemRow` 已符合“普通金额中性、状态标签上色”；但工资/货款汇总区仍有局部 `#007AFF/#34C759/#722ED1/#FF9500`、700/800 和局部按钮样式 | 部门/分类进入 `STORE_DOMAIN_COLOR_RULES` 与主题分类色；行标题与金额最多 600；统一共享分组标题与工具栏 |
| P2 | `components/store/sale.tsx`、`components/store/purchase.tsx` | 在共享系统外使用局部选中红/绿、圆形按钮、本地分段栏与 700 字重 | 后续迁移至 `StoreSegmentedTabs`、`StoreToolbarAction` 和领域映射，不能再新建局部色板 |

## 5. 审计结论

现有系统已经建立了正确的“领域映射”方向，但尚未完全覆盖所有旧共享原语。最重要的下一步不是再给普通数字增加颜色，而是先收敛库存横向台账、直接库存工作台、月份选择器和总月报局部工资区。只有这些共享或高频组件完成迁移，报表与库存的颜色展示才会真正统一。

## References

[1]: https://developer.apple.com/design/human-interface-guidelines/color "Apple Human Interface Guidelines — Color"
[2]: https://developer.apple.com/design/human-interface-guidelines/layout "Apple Human Interface Guidelines — Layout"
[3]: https://developer.apple.com/design/human-interface-guidelines/sf-symbols "Apple Human Interface Guidelines — SF Symbols"
[4]: https://help.icostapp.com/guide/other/update.html "iCost 更新记录"

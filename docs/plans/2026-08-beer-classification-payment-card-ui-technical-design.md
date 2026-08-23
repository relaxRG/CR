# 啤酒分类独立核算与烈酒采购交互技术设计

**目的：** 将啤酒作为烈酒进销存中一个自然分类呈现，不创建独立页面、独立供应商体系或额外模式；同时确保啤酒库存、消耗、价格、付款、分析与总月报成本独立计算，绝不与非啤酒烈酒混算或重复计入。

> 设计原则：**一套烈酒工作台、一个采购渠道事实源、一个分类快照、多个只读计算投影。** 用户只看到熟悉的烈酒库存和当月进货页面；“啤酒独立”是计算与报表的边界，不是新页面或新操作负担。

## 1. 事实模型与存储结构

当前项目的烈酒领域以 AsyncStorage 同步业务键为本地事实存储，并通过设备同步引擎同步；对象存储仅用于原始 Excel 归档，不应用于一般采购行。为支持啤酒，**不新建独立啤酒供应商表或啤酒库存表**，而是在现有烈酒事实中补充受控的分类标识。

| 事实 | 现有/目标存储键或表 | 新增/保留字段 | 责任 |
|---|---|---|---|
| 酒款主档 | `spirits.items.v3` / `spirit_items` | `category`、`productClass`、`bottleId`、中英文标准名称 | 当前品类归属；酒款可被标为“啤酒 / Beer” |
| 采购行 | `spirits.purchases.v3` / `spirit_purchase_records` | `itemId`、`supplierId`、`rawName`、`categorySnapshot`、`productClassSnapshot`、金额/数量/日期 | 历史采购不可被后来改分类而改写 |
| 月度台账 | `spirits.ledger.v3` / `spirit_ledger_entries` | `itemId`、月份、期初/进货/消耗/期末数量与成本 | 按酒款计算；分类通过酒款与采购快照投影 |
| 烈酒供应商 | `spirits.suppliers.v1` / `spirit_suppliers` | `channelType`、排序、付款周期、资料与附件元数据 | 烈酒与啤酒共享；葡萄酒不引用此表 |
| 付款分摊 | `spirits.procurementPayments.v1` / `spirit_payment_allocations` | `purchaseId`、`source`、`pettyCashRecordId`、金额、日期 | 付款独立于采购成本；可一笔备用金拆多行 |
| 分类定义 | `spirits.customCategories.v1` / `spirit_categories` | `id`、名称、颜色、权威排序、归档状态 | `啤酒 / Beer` 是烈酒域内的分类，不是模块 |

### 1.1 推荐的关系模型

```text
SpiritSupplier (烈酒供应商 / 网络采购渠道)
             1 ────── * SpiritPurchaseRecord
                               * ────── 1 SpiritItem
                               * ────── * SpiritPaymentAllocation

SpiritItem 1 ────── * SpiritLedgerEntry（月度）
SpiritItem 1 ────── 1 SpiritCategory（可为“啤酒 / Beer”）
```

烈酒供应商可以供应任意烈酒分类，包括啤酒。采购记录只能引用烈酒域内的供应商 ID；葡萄酒采购继续引用葡萄酒域内独立供应商 ID。总月报只读取经过模块和分类标记的投影，不能反向创建或修改供应商。

### 1.2 字段语义与快照规则

```ts
interface SpiritPurchaseRecord {
  id: string;
  itemId?: string;
  supplierId?: string;               // 烈酒供应商档案 ID
  supplierNameSnapshot: string;      // 当次票据/导入原名，用于历史展示
  rawName: string;                   // 供应商给出的商品名
  categorySnapshot: string;          // 当次采购时分类，例如“啤酒 / Beer”
  productClassSnapshot: "spirit" | "beer";
  quantity: number;
  unitPrice: number;
  amount: number;
  date: string;
}
```

`categorySnapshot` 与 `productClassSnapshot` 是不可随当前酒款编辑回写的历史事实。若后来将某酒款从“其他”调整为“啤酒 / Beer”，旧采购默认保留原分类；只有用户在采购详情中明确选择“将历史采购重新归类”时，才以单一受控命令批量更新。这样可避免报表因主档编辑而悄悄改变已结月的成本构成。

`productClassSnapshot` 不是用户必须理解或操作的新字段。它是由分类定义的 `reportClass` 派生：分类“啤酒 / Beer”映射为 `beer`，其他烈酒分类映射为 `spirit`。用户仍然只看到分类名称和颜色。

### 1.3 唯一计算口径

| 指标 | 计算来源 | 啤酒独立条件 | 禁止做法 |
|---|---|---|---|
| 期初/期末库存 | 酒款月度台账 | 酒款当前/历史分类为啤酒 | 用采购付款金额调整库存 |
| 本月进货成本 | `SpiritPurchaseRecord.amount` | `productClassSnapshot === "beer"` | 在付款确认时再加一次成本 |
| 本月消耗 | 台账期初 + 进货 − 实盘期末 | 仅啤酒酒款 | 因供应商同时卖烈酒而混合消耗 |
| 价格历史 | 采购行的单价与日期 | 仅啤酒采购快照 | 以供应商总平均价覆盖酒款价格 |
| 已付/待付 | 付款分摊金额与采购金额 | 分摊只指向啤酒采购行 | 付款记录无 purchaseId 或跨品类吸收 |
| 总月报成本行 | 采购成本投影 | `productClassSnapshot` 分组 | 将付款金额当作第二笔成本 |

## 2. 后端/数据库迁移原则

生产端如采用 D1，应以迁移增加列和索引，不建立独立 `beer_suppliers` 或 `beer_inventory` 表。建议迁移如下：

```sql
ALTER TABLE spirit_purchase_records
  ADD COLUMN product_class_snapshot TEXT NOT NULL DEFAULT 'spirit'
  CHECK (product_class_snapshot IN ('spirit', 'beer'));

ALTER TABLE spirit_categories
  ADD COLUMN report_class TEXT NOT NULL DEFAULT 'spirit'
  CHECK (report_class IN ('spirit', 'beer'));

CREATE INDEX IF NOT EXISTS idx_spirit_purchase_month_class
  ON spirit_purchase_records(month, product_class_snapshot, date);
CREATE INDEX IF NOT EXISTS idx_spirit_purchase_supplier_class
  ON spirit_purchase_records(supplier_id, product_class_snapshot, month);
```

迁移步骤必须是：先部署读取兼容（缺失字段按 `spirit` 处理）→ 识别名称或既有分类明确为“啤酒 / Beer”的记录生成候选→ 显示迁移预览→ 用户确认后写入快照→ 验证各月金额守恒→ 最后启用严格非空约束。不能把名称中含“beer”或“啤酒”的所有记录直接批量改写，因为导入名称可能不完整或指向混合商品。

## 3. 前端：合并呈现而不增加模式

### 3.1 烈酒库存页面

库存页面保持现有结构：月份选择器、概览卡、分类筛选、库存表、详情上浮卡。啤酒只自然出现在分类列、分类快速选择和库存行中。

| 区域 | 呈现 | 交互 | 啤酒处理 |
|---|---|---|---|
| 分类列 | 标题“分类”，统一颜色标签 | 点击筛选/排序 | 与其它分类同等显示“啤酒 / Beer” |
| 库存行 | 标准中英文酒款双行名称 | 点击打开酒款详情 | 啤酒酒款使用相同详情，不跳转独立页面 |
| 本期消耗卡后 | 快速选择分类，默认展开 | 点击类别即可原子更新 | “啤酒 / Beer”是一个普通选项 |
| 分类汇总 | 正常分类汇总表/图 | 点击可下钻同页采购行 | 啤酒金额按快照独立汇总 |
| 付款状态 | 详情内显示已付/部分/待付 | 点击打开付款分摊上浮卡 | 仅关联当前酒款/采购行的啤酒付款 |

不增加“啤酒模式”切换器。现有分类筛选已经是足够的发现机制；当用户没有选任何分类时，烈酒页面正常显示全部记录，但各计算模块仍在内部按 `productClassSnapshot` 分账。

### 3.2 当月进货页面

当月进货保留一张表和一个日期分组结构。每行显示：序号、分类、商品名称（供应商原名 + 已关联标准中英文）、数量、单价、总价、供应商/网络渠道、付款状态。啤酒记录只在“分类”栏显示“啤酒 / Beer”，没有第二张采购表。

```text
2026-08-24
  #  分类          商品名称                    数量    单价     总价       付款
  1  啤酒 / Beer   青岛经典 · Tsingtao Classic  24 瓶  ¥6.50   ¥156.00   已关联备用金
  2  威士忌        Chivas 12 · 芝华士12年       1 瓶  ¥210.00 ¥210.00   待集中付款
```

## 4. 当月进货“分类”列：UI与交互实现

### 4.1 表头结构

分类表头是可点击的紧凑列，不叠加多余箭头。点击表头打开底部上浮卡（iPhone）或锚点菜单（iPad/macOS）：

```text
分类                                      [筛选状态摘要]
────────────────────────────────────────────────────────
筛选分类
[✓] 啤酒 / Beer       [✓] 威士忌       [ ] 金酒
[ ] 朗姆酒            [ ] 未分类

排序方式
(●) 按分类管理顺序     ( ) 按分类名称
( ) 按本月金额         ( ) 按本月数量

[清除筛选]                           [完成]
```

分类选项始终按分类管理页的 `order` 排列。筛选是多选“交集”条件：已选分类与供应商、日期、关键字、付款状态等其它条件同时生效。未选任何分类表示不限制分类，**不是**只显示未分类；“未分类”是一个显式选项。

### 4.2 状态模型

```ts
type PurchaseCategoryTableState = {
  selectedCategoryIds: string[];     // 空数组 = 不限制
  includeUncategorized: boolean;
  sort: {
    key: "categoryOrder" | "categoryName" | "amount" | "quantity";
    direction: "asc" | "desc";
  };
};
```

排序只影响当前屏幕行的投影，绝不写回分类主数据。`categoryOrder` 读取分类管理入口的唯一顺序；因此供应商、集团、分类的管理页调整顺序后，进货表、快速选择、筛选器、分析图表都同步更新，但用户临时按金额排序不会改变任何管理顺序。

### 4.3 边界与无障碍

- 筛选变化保留月份、搜索词、供应商和滚动位置；不重新加载或改写采购行。
- iPhone 以全宽底部上浮卡承载多选；iPad/macOS 用最大宽度受限的 Popover/Sheet，不让选项横向溢出。
- 表头 accessibility label 示例：`分类，已筛选 2 个分类，当前按分类管理顺序排序`。
- “完成”关闭面板但不再提交数据；“清除筛选”仅清分类条件，不清其它列筛选。
- 空结果显示“没有符合当前分类条件的采购记录”，提供“清除分类筛选”，而非误报没有进货。

## 5. 总月报：烈酒分类付款卡 UI与交互

### 5.1 放置和层级

在总月报的 **进货成本 · 酒水** 科目区内，在烈酒成本行后出现一张只读的“烈酒付款汇总”卡。它采用工资付款卡相同的信息层级和触控规范，但不创建新的业务页面。

```text
烈酒付款汇总                                    查看当月进货 ›
本月采购成本 ¥8,460.00       已付 ¥3,120.00       待付 ¥5,340.00

烈酒供应商 A · 集中付款                     待付 ¥2,800.00  ›
  啤酒 / Beer ¥560.00 · 威士忌 ¥2,240.00

网络采购 B · 备用金                          已付 ¥320.00   ›
  啤酒 / Beer ¥320.00 · 2 笔采购已关联

待关联备用金                                  ¥180.00       ›
  1 笔网络采购尚未找到对应备用金凭证
```

“啤酒 / Beer”仅作为卡片中的分类明细或总月报独立成本行显示；不会产生单独的啤酒页面。卡片默认按烈酒采购渠道分组，是因为付款对象是渠道。渠道行内部按分类展示金额，既能看到同一供应商的啤酒与非啤酒采购，又不会把两者合并成一个成本数字。

### 5.2 只读事实投影

付款卡读取以下投影：

```ts
interface SpiritsPaymentCardRow {
  supplierId: string;
  supplierName: string;
  channelType: "supplier" | "online";
  productClassBreakdown: {
    spirit: { purchaseAmount: number; paid: number; remaining: number };
    beer: { purchaseAmount: number; paid: number; remaining: number };
  };
  unresolvedPettyAmount: number;
}
```

所有金额都从采购行和付款分摊计算：

- `purchaseAmount`：采购行金额之和；
- `paid`：合法付款分摊金额之和；
- `remaining = max(0, purchaseAmount - paid)`；
- `unresolvedPettyAmount`：网络采购但未关联备用金凭证的采购额；
- `overpaid`：付款超过采购额时以异常状态显示，不吞掉差额。

付款卡不修改采购行、库存台账或供应商。用户点击“录入付款”或“关联备用金”进入对应的采购详情上浮卡，由采购行—付款分摊命令写入；成功后月报通过只读刷新获得新状态。

### 5.3 点击和深链

| 用户动作 | 跳转/行为 | 传递筛选 | 不允许的行为 |
|---|---|---|---|
| 点击卡右上“查看当月进货” | 打开既有烈酒当月进货页 | 月份=当前月，付款状态=全部 | 创建第二个“付款采购”页面 |
| 点击渠道行 | 打开既有当月进货 | 月份、供应商 ID、付款状态 | 仅用供应商名称匹配 |
| 点击“啤酒 / Beer”明细 | 打开既有当月进货 | 月份、分类=啤酒、渠道 ID | 改变分类管理排序 |
| 点击待关联备用金 | 打开当月进货待关联筛选 | 月份、来源=网络采购、付款=待关联 | 标记为已付而没有凭证 |
| 点击录入付款 | 当前上下文上浮卡 | purchaseIds/剩余金额 | 重复计入采购成本 |

### 5.4 三端视觉与状态

- **iPhone：** 卡片为单列信息层级；金额行可横向排列但付款状态始终紧贴金额；操作在卡内底部，避免超出安全区。
- **iPad：** 渠道卡可采用两栏；左侧渠道与分类，右侧成本/已付/待付，但窄分屏回落到 iPhone 单列，不缩小关键字体。
- **macOS：** 付款卡在进货成本区域内最大宽度受控；渠道行可展开同月采购明细；不会因窗口变宽而拉伸图标或制造大面积空白。
- **状态颜色：** 中性文字表达普通金额；绿色仅表示已付/已完成；琥珀表示待关联、待确认；红色仅表示超付、金额冲突或无法读取凭证；蓝色可用于当前主操作。颜色不表达“啤酒”或“烈酒”本身。

## 6. 错误、并发与月结保护

1. 月结已冻结时，付款卡仍可查看；改动历史付款必须进入受控调整，并保留操作原因和审计记录。
2. 同一付款分摊操作使用单飞守卫；网络中断时保留待提交状态，释放按钮 busy，允许重试，不丢失购买/凭证关系。
3. 付款分摊写入和采购更新按 revision 条件提交；冲突时刷新权威采购/付款投影，显示“查看云端版本、重新尝试、放弃本机草稿”。
4. 总月报永不直接把付款状态回写到采购成本。采购成本与付款事实不一致时，显示异常提示而不是自动修正金额。

## 7. 测试验收清单

| 测试 | 必须断言 |
|---|---|
| 啤酒同页呈现 | 啤酒行位于烈酒库存/进货表内；不存在单独啤酒路由或供应商键 |
| 金额隔离 | 同渠道同时购啤酒和威士忌时，各自库存、成本、付款、月报行独立且总额守恒 |
| 分类筛选 | 多选、未分类、清除、管理顺序、金额/数量排序与其它筛选交集正确 |
| 付款卡 | 渠道行与啤酒分类明细正确；点击深链保留月份/渠道/分类/状态 |
| 备用金分摊 | 一笔备用金拆到多条含啤酒采购；没有凭证时待关联；不会重复计入成本 |
| 三端布局 | iPhone、iPad 分屏、macOS 窄宽和字体倍率下无溢出、遮挡、过小字体或操作消失 |
| 历史兼容 | 旧采购无 `productClassSnapshot` 时安全回退为非啤酒烈酒，且可由用户受控重分类 |

## 8. 参考

多端页面和表格遵循 Apple 对可适配布局、可读文字层级和列表编辑行为的指导：窗口或字体变化应触发安全重排而非压缩关键文字。[1] [2]

[1]: https://developer.apple.com/design/human-interface-guidelines/typography "Apple Human Interface Guidelines — Typography"
[2]: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables "Apple Human Interface Guidelines — Lists and tables"


## 9. 同一烈酒供货商：统一应付、统一付款、分类构成透明化

当一个烈酒供货商同时供应啤酒和非啤酒烈酒时，**应付对象应是该供应商，而不是分类**。因此同一供应商在同一月份只形成一张烈酒采购付款汇总卡和一个统一付款余额；分类只负责解释该余额和成本由哪些商品构成。

```text
烈酒供货商 A
本月统一采购 ¥2,800.00    已付 ¥1,000.00    待付 ¥1,800.00
构成：非啤酒烈酒 ¥2,240.00 ｜ 啤酒 / Beer ¥560.00
```

### 9.1 计算模型

```ts
interface SupplierUnifiedPaymentProjection {
  supplierId: string;
  month: string;
  purchaseAmount: number;  // 同一供应商所有烈酒域采购行之和
  paidAmount: number;      // 同一供应商所有有效付款分摊之和
  remainingAmount: number;
  breakdown: {
    spirit: { purchaseAmount: number; paidAmount: number; remainingAmount: number };
    beer: { purchaseAmount: number; paidAmount: number; remainingAmount: number };
  };
}
```

统一总额是付款工作流唯一的待付对象。分类构成则由采购行 `productClassSnapshot` 分组获得。付款分摊仍然必须精确绑定到具体 `purchaseId`，所以一笔统一付款可同时分配给啤酒和非啤酒采购行，但不会丢失分类层面的已付/待付比例。

当用户支付金额小于供应商总待付时，付款上浮卡默认按用户勾选的采购行分配；若未指定，显示“尚未分配 ¥X”，不允许系统凭金额比例自动猜测分配到啤酒或烈酒。用户可一键按当前应付比例建议拆分，但必须确认后才写入具体行分摊。

### 9.2 付款卡 UI

卡片首先呈现供应商统一总额，第二行使用中性灰说明分类构成，避免使用颜色误导品类优先级：

```text
烈酒供货商 A                                      查看明细 ›
采购 ¥2,800.00       已付 ¥1,000.00       待付 ¥1,800.00
其中：烈酒 ¥2,240.00（已付 ¥800）｜啤酒 ¥560.00（已付 ¥200）
[录入统一付款]  [查看当月进货]
```

点击“录入统一付款”后打开同一张付款上浮卡：顶部是供应商总待付；中间是可展开的采购行分配区，按“啤酒 / Beer”和其它烈酒分类分组；底部持续显示“本次付款”“已分配”“未分配”。保存条件是本次付款等于已分配总额，或用户明确将未分配部分保存为“待分配付款草稿”。

### 9.3 总月报与成本边界

总月报的付款卡可显示统一供应商付款余额和分类构成，但成本行保持独立：一条“烈酒成本”只汇总非啤酒烈酒采购成本；一条“啤酒成本”只汇总啤酒采购成本。付款总额是现金结算视图，成本总额是采购/库存视图；两者允许不同，但都必须能下钻到同一批采购行和付款分摊。

### 9.4 新增验收断言

1. 同一供应商同时有啤酒 ¥560 与烈酒 ¥2,240 时，只出现一张供应商付款卡，统一采购额为 ¥2,800。
2. 一笔 ¥1,000 付款分配为啤酒 ¥200、烈酒 ¥800 时，统一已付为 ¥1,000；两类分类已付金额分别正确。
3. 未分配付款不得自动按比例写入啤酒或烈酒采购行；付款卡显示待分配，而不是错误显示分类已付。
4. 总月报成本行仍分别显示啤酒 ¥560 与非啤酒烈酒 ¥2,240；统一付款卡金额不得被当作新增成本。
5. 付款卡和明细深链只使用 `supplierId` 与 `purchaseId`，不使用供应商名称匹配。


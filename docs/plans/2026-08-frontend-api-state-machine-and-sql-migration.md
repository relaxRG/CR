# 烈酒内啤酒分类：前端接口、状态机与安全 SQL 迁移实施清单

**适用范围：** 烈酒库存、当月进货、烈酒采购档案、啤酒 / Beer 分类、网络采购、备用金付款分摊、总月报烈酒付款汇总。  
**明确边界：** 啤酒不创建独立页面、模块、供应商资料或采购工作台；它只作为烈酒进销存内的分类。烈酒供应商可销售啤酒，葡萄酒供应商继续独立管理。总月报只读汇总，不再创建或按名称匹配供应商。

> 本文中的 SQL 是**迁移示例**，不是可直接在生产执行的命令。真实 D1 迁移必须先在脱敏副本/测试数据库执行预检、备份和行数/金额校验，并取得明确的生产迁移确认后才可执行。

## 1. 前端模块和接口修改总览

| 模块 | 新增/修改接口 | 事实所有者 | 同步键 | 必须不变的规则 |
|---|---|---|---|---|
| 烈酒分类定义 | `reportClass`、`isBeerClass` | `SpiritsInventoryProvider` | `spirits.customCategories.v1` | 分类管理顺序唯一；啤酒不是新模块 |
| 酒款主档 | `productClass` 派生展示 | `SpiritsInventoryProvider` | `spirits.items.v3` | 酒款编辑不回写历史采购快照 |
| 采购记录 | `categorySnapshot`、`productClassSnapshot`、`supplierId` | `SpiritsInventoryProvider` | `spirits.purchases.v3` | 历史成本与分类快照稳定 |
| 付款分摊 | `upsertProcurementPayment`、`resolvePurchasePaymentSummary` | `SpiritsInventoryProvider` | `spirits.procurementPayments.v1` | 付款不等于成本；金额守恒 |
| 当月进货表 | `categoryFilter`、`categorySort` | 纯视图模型 | 不持久化或仅本机 UI 偏好 | 临时排序不改分类管理顺序 |
| 总月报付款卡 | `buildSpiritsPaymentReportProjection` | 只读报表投影 | 读取采购/付款/供应商键 | 不创建供应商，不按名称匹配 |

## 2. 类型与前端 API 修改清单

### 2.1 分类定义

```ts
export type SpiritProductClass = "spirit" | "beer";

export interface SpiritCustomCategory {
  id: string;
  name: string;
  color: string;
  order: number;
  archived?: boolean;
  /** 默认 spirit；名称为“啤酒 / Beer”时不能仅靠名称推断，应由管理页明确设定。 */
  reportClass?: SpiritProductClass;
}

export function resolveSpiritProductClass(category: Pick<SpiritCustomCategory, "reportClass"> | undefined): SpiritProductClass {
  return category?.reportClass === "beer" ? "beer" : "spirit";
}
```

分类管理页仅需在“啤酒 / Beer”这一条分类上提供一个受控的“归入啤酒核算”开关；不能通过字符串包含 `beer`/`啤酒` 自动把所有历史数据改成啤酒。该开关应展示影响范围预览：当前酒款数、未月结采购行数、已月结历史行数和待确认历史行数。

### 2.2 酒款和采购快照

```ts
export interface SpiritItem {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  // 不作为历史财务依据；只用于当前库存/界面派生。
  productClass?: SpiritProductClass;
}

export interface SpiritPurchaseRecord {
  id: string;
  itemId?: string;
  supplierId?: string;
  supplierNameSnapshot: string;
  rawName: string;
  categorySnapshot: string;
  productClassSnapshot: SpiritProductClass | null;
  snapshotSource: "import" | "manual" | "user_reclassified" | "migration_unresolved";
  snapshotRevision: number;
  quantity: number;
  unitPrice: number;
  amount: number;
  date: string;
}
```

`productClassSnapshot: null` 表示历史记录尚未确认，不允许其自动进入“啤酒”成本行。迁移后可安全回退为 `spirit`，但该回退应保留 `snapshotSource: "migration_unresolved"`，以便采购档案显示“历史分类待确认”。

### 2.3 Provider 命令接口

```ts
type CategoryReclassifyPreview = {
  affectedItemIds: string[];
  affectedPurchaseIds: string[];
  frozenPurchaseIds: string[];
  unresolvedPurchaseIds: string[];
  amountByPreviousClass: Record<SpiritProductClass, number>;
  amountByNextClass: Record<SpiritProductClass, number>;
};

type SpiritProcurementPaymentAllocation = {
  id: string;
  purchaseId: string;
  source: "direct" | "petty_cash";
  pettyCashRecordId?: string;
  amount: number;
  paidAt: string;
  paymentMethod: string;
  notes?: string;
};

interface SpiritsContextValue {
  previewCategoryReclassification(categoryId: string, nextClass: SpiritProductClass): CategoryReclassifyPreview;
  applyCategoryReclassification(input: {
    categoryId: string;
    nextClass: SpiritProductClass;
    purchaseIds: string[];
    reason: string;
    includeFrozenHistory: boolean;
  }): Promise<{ applied: number; skippedFrozen: number; revision: number }>;

  upsertProcurementPayment(input: Omit<SpiritProcurementPaymentAllocation, "id"> & { id?: string }): Promise<SpiritProcurementPaymentAllocation>;
  deleteProcurementPayment(id: string, reason: string): Promise<void>;
  getPurchasePaymentSummary(purchaseId: string): SpiritPurchasePaymentSummary;

  buildMonthPurchaseView(input: PurchaseTableQuery): PurchaseTableView;
}
```

`applyCategoryReclassification` 只能由库存/采购档案的显式确认操作调用。默认不包含月结冻结历史；如需包含，必须经过月结调整会话并记录原因。该命令一次性更新分类定义、可更新的采购快照和相关 revision，避免出现表格已是啤酒、付款卡仍是烈酒的混合状态。

### 2.4 当月进货分类筛选排序接口

```ts
type PurchaseCategorySortKey = "categoryOrder" | "categoryName" | "amount" | "quantity";

type PurchaseTableQuery = {
  month: string;
  supplierIds: string[];
  categoryIds: string[];         // [] = 不限制
  includeUncategorized: boolean;
  paymentStates: Array<"paid" | "partial" | "unpaid" | "unresolved_petty">;
  search: string;
  sort: { key: PurchaseCategorySortKey; direction: "asc" | "desc" };
};

type PurchaseTableView = {
  rows: PurchaseTableRow[];
  availableCategories: Array<{ id: string; name: string; color: string; order: number; count: number }>;
  activeFilterCount: number;
  totalAmount: number;
};
```

`categoryOrder` 始终从烈酒分类管理页的 `order` 获取。排序不是写操作：点击“按金额”只改变 `PurchaseTableView.rows` 的当前顺序，不会修改 `SpiritCustomCategory.order`。查询参数通过路由/屏幕 state 保留在现有当月进货页，深链从总月报返回时应预填月份、供应商、分类和付款状态。

## 3. 前端状态机

### 3.1 历史分类快照状态机

```text
                    ┌──────────────────┐
                    │ no_snapshot       │
                    │ 旧数据未初始化     │
                    └────────┬─────────┘
                             │ 迁移预检
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
  resolved_spirit      resolved_beer       unresolved
  明确非啤酒分类        明确啤酒分类          名称/分类不足
          │                  │                  │
          └─────────┬────────┘                  │
                    ▼                           │
           snapshot_active                      │
           正常只读投影                          │
                    │ 用户受控重分类              │
                    ▼                           ▼
           reclassification_pending ──确认──> snapshot_active
                    │ 月结冻结                  │
                    └──────────────> adjustment_required
```

状态规则：

1. 导入或手动新建采购时立即写入 `categorySnapshot` 与 `productClassSnapshot`。
2. 历史迁移只自动初始化**可由分类 ID 或稳定酒款 ID 明确识别**的行。
3. 任何不确定行进入 `unresolved`；它在总额中仍计入烈酒采购成本，但不计入“啤酒 / Beer”独立成本行。
4. 用户确认后写入 `user_reclassified` 来源和新的 revision；已月结数据进入 `adjustment_required`，而不是静默修改。

### 3.2 付款分摊状态机

```text
purchase_created
  ├─ supplier 集中付款 ─────────> unpaid → partial → paid
  └─ online 网络采购 ───────────> needs_petty_link
                                   ├─ 选择备用金凭证 → allocation_pending
                                   ├─ 分摊保存成功  → paid / partial
                                   └─ 无凭证或断网  → unresolved_petty / retryable
```

付款 state 由采购金额和分摊金额派生，不单独让 UI 写“已付”。规则如下：

```ts
const paid = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
const remaining = Math.max(0, purchase.amount - paid);
const paymentStatus = paid === 0 ? "unpaid" : paid < purchase.amount ? "partial" : paid === purchase.amount ? "paid" : "overpaid";
```

网络采购若没有有效 `pettyCashRecordId`，状态是 `unresolved_petty`；它不能显示绿色“已付”。一笔备用金在 UI 中使用“拆分分配”编辑器分给多个采购行，分配总额不得超过备用金可用金额；保存前显示剩余未分配金额。

### 3.3 分类列筛选排序状态机

```text
idle
  └─ 点击分类列 → sheet_open
       ├─ 选/取消分类、未分类、排序 → dirty_local
       ├─ 清除分类条件 → dirty_local
       ├─ 完成 → applied_local → sheet_closed
       └─ 取消 → rollback_to_open_snapshot → sheet_closed
```

分类筛选是本机 UI state，不写入采购数据，也不触发同步。为了防止 iPad/macOS 窗口变化丢状态，sheet 使用 draft state，点击“完成”才写入屏幕 query state；点击“取消”恢复打开时快照。已从总月报深链进入的筛选为 route-owned state，用户清除后只更新当前屏幕，不修改总月报。

## 4. API/Worker 接口建议

如果采购付款落地到 Cloudflare Worker/D1，接口必须使用 ID 和 revision，不接受仅名称的供应商或采购定位。

### 4.1 读取投影

```http
GET /api/spirits/purchase-projection?month=2026-08&supplierId=sup_1&categoryId=beer&paymentState=unresolved_petty
Authorization: DeviceSessionV2
```

响应：

```json
{
  "revision": 42,
  "rows": [],
  "categoryTotals": [
    { "categoryId": "beer", "purchaseAmount": 56000, "paidAmount": 32000, "remainingAmount": 24000 }
  ],
  "unresolvedCount": 1
}
```

金额使用最小货币单位整数；客户端展示时再格式化。`month`、`supplierId`、`categoryId` 都是筛选条件，绝不能让服务器用供应商名称推断。

### 4.2 付款分摊提交

```http
POST /api/spirits/purchase-payments/allocate
If-Match: "42"
Authorization: DeviceSessionV2
Content-Type: application/json

{
  "operationId": "uuid",
  "allocations": [
    {
      "purchaseId": "pur_1",
      "source": "petty_cash",
      "pettyCashRecordId": "petty_9",
      "amountMinor": 32000,
      "paymentMethod": "支付宝",
      "paidAt": "2026-08-24"
    }
  ]
}
```

- 服务器验证 `purchaseId` 属于该设备组、备用金凭证存在、金额大于零、分配总额不超过凭证可用额。
- 同一 `operationId` 幂等；revision 不匹配返回 `409 PROCUREMENT_REVISION_CONFLICT`。
- D1 写入与 R2/其它对象无全局事务时，采用先记录 operation、再条件写 allocation、最后更新投影 revision 的可恢复顺序；失败不能把采购成本或库存台账置为已付。

### 4.3 总月报付款卡投影

```http
GET /api/reports/monthly/spirits-payments?month=2026-08
Authorization: DeviceSessionV2
```

响应按 `supplierId` 和 `productClassSnapshot` 分组，返回 `spirit`、`beer`、`unresolvedPetty`、`overpaid` 等明细。总月报接口只读；所有付款写入仍走采购付款接口。

## 5. SQL 迁移示例：先兼容、再预检、后确认

### 5.1 Migration 1：增加字段与迁移审计表

```sql
-- 202608xx_spirit_beer_classification_snapshot_prepare.sql
PRAGMA foreign_keys = ON;

ALTER TABLE spirit_categories
  ADD COLUMN report_class TEXT NOT NULL DEFAULT 'spirit'
  CHECK (report_class IN ('spirit', 'beer'));

ALTER TABLE spirit_purchase_records
  ADD COLUMN category_snapshot TEXT;
ALTER TABLE spirit_purchase_records
  ADD COLUMN product_class_snapshot TEXT
  CHECK (product_class_snapshot IN ('spirit', 'beer'));
ALTER TABLE spirit_purchase_records
  ADD COLUMN snapshot_source TEXT NOT NULL DEFAULT 'migration_unresolved'
  CHECK (snapshot_source IN ('import', 'manual', 'user_reclassified', 'migration_resolved', 'migration_unresolved'));
ALTER TABLE spirit_purchase_records
  ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS spirit_purchase_snapshot_migration_audit (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE,
  previous_category_snapshot TEXT,
  next_category_snapshot TEXT,
  previous_product_class_snapshot TEXT,
  next_product_class_snapshot TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('resolved', 'unresolved', 'skipped_frozen')),
  reason TEXT NOT NULL,
  source_item_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES spirit_purchase_records(id)
);

CREATE INDEX IF NOT EXISTS idx_spirit_purchase_month_class_snapshot
  ON spirit_purchase_records(month, product_class_snapshot, date);
CREATE INDEX IF NOT EXISTS idx_spirit_purchase_supplier_class_snapshot
  ON spirit_purchase_records(supplier_id, product_class_snapshot, month);
```

此阶段没有任何金额更新，没有把记录认定为啤酒，也没有删除旧字段。

### 5.2 Migration 2：初始化分类定义，但不猜测历史采购

```sql
-- 管理者明确选择的烈酒内分类，示例只对已存在且明确的“啤酒 / Beer”分类赋值。
UPDATE spirit_categories
SET report_class = 'beer'
WHERE id = 'beer'
  AND name IN ('啤酒', 'Beer', '啤酒 / Beer');

-- 其它分类保持 spirit。此语句不能按 purchases.raw_name 做模糊更新。
UPDATE spirit_categories
SET report_class = 'spirit'
WHERE report_class IS NULL;
```

生产迁移需将 `id = 'beer'` 替换为预检报告中人工确认的分类 ID。若没有这个分类，先由管理页创建并让用户确认，再写 `report_class = 'beer'`。

### 5.3 Migration 3：仅根据稳定酒款 ID 初始化可确定历史行

```sql
-- 可明确回填：采购行有 item_id，酒款有当前分类，且分类定义已声明 report_class。
UPDATE spirit_purchase_records AS p
SET
  category_snapshot = c.name,
  product_class_snapshot = c.report_class,
  snapshot_source = 'migration_resolved',
  snapshot_revision = 1
FROM spirit_items AS i
JOIN spirit_categories AS c ON c.name = i.category
WHERE p.item_id = i.id
  AND p.category_snapshot IS NULL
  AND p.product_class_snapshot IS NULL
  AND c.report_class IN ('spirit', 'beer');

INSERT OR IGNORE INTO spirit_purchase_snapshot_migration_audit (
  id, purchase_id, previous_category_snapshot, next_category_snapshot,
  previous_product_class_snapshot, next_product_class_snapshot,
  decision, reason, source_item_id, created_at
)
SELECT
  lower(hex(randomblob(16))), p.id, NULL, p.category_snapshot, NULL,
  p.product_class_snapshot, 'resolved',
  '稳定 item_id 与分类定义可确认', p.item_id, datetime('now')
FROM spirit_purchase_records p
WHERE p.snapshot_source = 'migration_resolved'
  AND p.snapshot_revision = 1;
```

### 5.4 Migration 4：未知历史数据保持待确认并隔离金额

```sql
-- 所有无法通过 item_id + 已确认分类识别的历史采购，保留为未确认。
UPDATE spirit_purchase_records
SET
  snapshot_source = 'migration_unresolved',
  snapshot_revision = CASE WHEN snapshot_revision = 0 THEN 1 ELSE snapshot_revision END
WHERE product_class_snapshot IS NULL;

INSERT OR IGNORE INTO spirit_purchase_snapshot_migration_audit (
  id, purchase_id, previous_category_snapshot, next_category_snapshot,
  previous_product_class_snapshot, next_product_class_snapshot,
  decision, reason, source_item_id, created_at
)
SELECT
  lower(hex(randomblob(16))), p.id, NULL, p.category_snapshot, NULL,
  NULL,
  'unresolved',
  '缺少稳定酒款链接或分类定义，禁止名称猜测', p.item_id, datetime('now')
FROM spirit_purchase_records p
WHERE p.snapshot_source = 'migration_unresolved';
```

未知行在“烈酒总采购成本”中仍按原金额计入，但不进入“啤酒 / Beer”独立金额。这样总金额守恒，而啤酒金额不会被误报。

### 5.5 金额隔离验证查询

```sql
-- 所有采购成本：应与旧烈酒采购总额一致。
SELECT month, SUM(amount_minor) AS all_spirits_amount_minor
FROM spirit_purchase_records
GROUP BY month;

-- 分类已确认的烈酒/啤酒拆分。
SELECT
  month,
  COALESCE(product_class_snapshot, 'unresolved') AS class,
  SUM(amount_minor) AS amount_minor,
  COUNT(*) AS purchase_count
FROM spirit_purchase_records
GROUP BY month, COALESCE(product_class_snapshot, 'unresolved')
ORDER BY month, class;

-- 金额守恒：resolved spirit + beer + unresolved 必须等于全部采购金额。
WITH total AS (
  SELECT month, SUM(amount_minor) AS amount_minor
  FROM spirit_purchase_records GROUP BY month
), split AS (
  SELECT month, SUM(amount_minor) AS amount_minor
  FROM spirit_purchase_records GROUP BY month
)
SELECT total.month, total.amount_minor, split.amount_minor,
       total.amount_minor - split.amount_minor AS delta_minor
FROM total JOIN split USING (month)
WHERE total.amount_minor <> split.amount_minor;
```

最后一个查询必须返回零行。如果出现差额，迁移立即停止，不得进入“强制非空约束”阶段。

### 5.6 付款金额隔离与备用金分摊表

```sql
CREATE TABLE IF NOT EXISTS spirit_purchase_payment_allocations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct', 'petty_cash')),
  petty_cash_record_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_method TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES spirit_purchase_records(id),
  CHECK (
    (source = 'petty_cash' AND petty_cash_record_id IS NOT NULL)
    OR (source = 'direct' AND petty_cash_record_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_spirit_payment_purchase
  ON spirit_purchase_payment_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_spirit_payment_petty
  ON spirit_purchase_payment_allocations(petty_cash_record_id);
```

付款分摊表绝不更新 `spirit_purchase_records.amount_minor`。报表读取时才连接采购和分摊：`purchase_cost = SUM(p.amount_minor)`；`paid = SUM(a.amount_minor)`；`remaining = MAX(0, purchase_cost - paid)`。不能使用付款金额再写入台账或成本表。

## 6. 迁移执行顺序与回滚

| 步骤 | 操作 | 可回滚性 | 放行条件 |
|---|---|---|---|
| 1 | 备份、行数和月度金额基线 | 只读 | 备份可验证 |
| 2 | 增加 nullable 快照列、审计表、索引 | 兼容 | 旧客户端仍可读取 |
| 3 | 回填稳定 itemId 分类 | 审计可逆 | 金额守恒查询零差额 |
| 4 | 记录未确认行，不猜测 | 可继续人工处理 | 待确认数量明确可见 |
| 5 | 发布前端待确认队列和受控重分类命令 | 操作审计 | 月结保护/冲突/断网测试通过 |
| 6 | 建立付款分摊表和只读付款投影 | 操作可逆 | 不重复成本测试通过 |
| 7 | 仅在未确认行清零且旧客户端退役后考虑严格非空 | 需变更窗口 | 全量回归和生产确认 |

**绝不在未确认历史行仍存在时添加 `NOT NULL product_class_snapshot`。** 这会迫使错误猜测或造成迁移失败。

## 7. 前端测试清单

1. 新建/导入啤酒采购生成 `productClassSnapshot = beer`；同页展示，不出现独立啤酒路由。
2. 修改酒款当前分类不改写旧采购快照；明确重分类后才改变允许调整的行。
3. 同供应商的啤酒和威士忌：采购成本、库存、消耗、付款、价格历史和总月报行分别正确，月度总额守恒。
4. 付款分摊：一笔备用金分配给啤酒和威士忌多条采购；分配不超过备用金，不重复计入成本。
5. 分类列：多选、未分类、清除、权威顺序、金额/数量排序、深链恢复和窄宽上浮卡行为正确。
6. 总月报付款卡：只读、带模块/分类明细、深链至既有当月进货、网络采购待关联不显示已付。
7. 迁移：明确 itemId 行可回填、未知行保持 unresolved、金额隔离核验零差额、冻结历史进入调整流程。

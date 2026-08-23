-- Cocktail R 付款与分类成本人工恢复脚本库
-- 默认安全模式：所有 :placeholder 必须由受控运维工具参数化绑定；禁止直接拼接用户输入。
-- 使用前：在影子库演练、记录工单号、确认 group_id / supplier_id / payment_id / reason。
-- 不在本文件中执行任何生产操作；每个修复块都应先运行 PRECHECK，确认结果后才允许执行 TRANSACTION。

-- ============================================================================
-- R0. 通用预检：付款守恒与采购超核销
-- ============================================================================
-- 参数：:group_id, :supplier_id
SELECT
  p.id AS payment_id,
  p.amount_minor AS payment_minor,
  COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.payment_id = p.id), 0) AS allocated_minor,
  COALESCE((SELECT SUM(c.available_minor) FROM supplier_credits c WHERE c.origin_payment_id = p.id AND c.status = 'available'), 0) AS credit_minor,
  p.amount_minor
    - COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.payment_id = p.id), 0)
    - COALESCE((SELECT SUM(c.available_minor) FROM supplier_credits c WHERE c.origin_payment_id = p.id AND c.status = 'available'), 0) AS delta_minor
FROM supplier_payments p
WHERE p.group_id = :group_id AND p.supplier_id = :supplier_id
ORDER BY p.paid_at DESC;

SELECT
  pr.id AS purchase_id,
  pr.amount_minor AS purchase_minor,
  COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_id = pr.id), 0)
    + COALESCE((SELECT SUM(ca.amount_minor) FROM credit_allocations ca WHERE ca.purchase_id = pr.id), 0) AS settled_minor
FROM spirit_purchase_records pr
WHERE pr.group_id = :group_id AND pr.supplier_id = :supplier_id
  AND (
    COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_id = pr.id), 0)
    + COALESCE((SELECT SUM(ca.amount_minor) FROM credit_allocations ca WHERE ca.purchase_id = pr.id), 0)
  ) > pr.amount_minor;

-- ============================================================================
-- R1. 冲销错误核销分配（不删除历史）
-- ============================================================================
-- 前置：确认 :allocation_id 属于 :group_id，未被旧调整冲销，且 :reason 非空。
BEGIN IMMEDIATE;

SELECT a.id, a.payment_id, a.purchase_id, a.amount_minor
FROM payment_allocations a
JOIN supplier_payments p ON p.id = a.payment_id
WHERE a.id = :allocation_id
  AND p.group_id = :group_id;

-- 服务层必须检查上一个 SELECT 恰好返回 1 行；否则 ROLLBACK。
INSERT INTO payment_adjustments (
  id, group_id, original_allocation_id, adjustment_type, amount_minor, reason, ticket_ref, created_at
)
SELECT lower(hex(randomblob(16))), :group_id, a.id, 'allocation_reversal', a.amount_minor,
       :reason, :ticket_ref, datetime('now')
FROM payment_allocations a
JOIN supplier_payments p ON p.id = a.payment_id
WHERE a.id = :allocation_id AND p.group_id = :group_id;

-- 逻辑冲销：以 adjustment 抵消，不物理 DELETE allocation。
UPDATE payment_allocations
SET status = 'reversed', updated_at = datetime('now')
WHERE id = :allocation_id AND status = 'active';

INSERT INTO finance_repair_audit (
  id, group_id, repair_type, target_id, reason, ticket_ref, performed_by, created_at
) VALUES (
  lower(hex(randomblob(16))), :group_id, 'reverse_allocation', :allocation_id,
  :reason, :ticket_ref, :operator_id, datetime('now')
);
COMMIT;

-- ============================================================================
-- R2. 将经确认的未分配已付款转为预付款余额
-- ============================================================================
-- 前置：payment 的 delta_minor > 0；不得用于掩盖 PAY-001 未对账差额。
BEGIN IMMEDIATE;

SELECT p.id, p.amount_minor
  - COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.payment_id = p.id AND a.status = 'active'), 0)
  - COALESCE((SELECT SUM(c.available_minor) FROM supplier_credits c WHERE c.origin_payment_id = p.id AND c.status = 'available'), 0)
  AS unallocated_minor
FROM supplier_payments p
WHERE p.id = :payment_id AND p.group_id = :group_id AND p.supplier_id = :supplier_id;

-- 服务层确认 unallocated_minor = :expected_unallocated_minor 且 > 0 后才执行。
INSERT INTO supplier_credits (
  id, group_id, supplier_id, origin_payment_id, original_minor, available_minor, status, created_at
) VALUES (
  lower(hex(randomblob(16))), :group_id, :supplier_id, :payment_id,
  :expected_unallocated_minor, :expected_unallocated_minor, 'available', datetime('now')
);

INSERT INTO finance_repair_audit (
  id, group_id, repair_type, target_id, reason, ticket_ref, performed_by, created_at
) VALUES (
  lower(hex(randomblob(16))), :group_id, 'create_supplier_credit', :payment_id,
  :reason, :ticket_ref, :operator_id, datetime('now')
);
COMMIT;

-- ============================================================================
-- R3. 修复啤酒/非啤酒烈酒分类快照（仅明确确认的单行）
-- ============================================================================
-- 前置：不得按 rawName 模糊更新；已月结记录必须走月结调整授权。
BEGIN IMMEDIATE;

SELECT id, month, category_snapshot, product_class_snapshot, snapshot_source, month_closed_at
FROM spirit_purchase_records
WHERE id = :purchase_id AND group_id = :group_id;

-- 服务层检查：:next_class IN ('beer','spirit')、:reason 非空；若 month_closed_at 非空则 :is_authorized_month_adjustment = 1。
INSERT INTO spirit_purchase_snapshot_migration_audit (
  id, purchase_id, previous_category_snapshot, next_category_snapshot,
  previous_product_class_snapshot, next_product_class_snapshot,
  decision, reason, source_item_id, created_at
)
SELECT lower(hex(randomblob(16))), id, category_snapshot, :next_category_snapshot,
       product_class_snapshot, :next_class, 'resolved', :reason, item_id, datetime('now')
FROM spirit_purchase_records
WHERE id = :purchase_id AND group_id = :group_id;

UPDATE spirit_purchase_records
SET category_snapshot = :next_category_snapshot,
    product_class_snapshot = :next_class,
    snapshot_source = 'user_reclassified',
    snapshot_revision = snapshot_revision + 1,
    updated_at = datetime('now')
WHERE id = :purchase_id
  AND group_id = :group_id
  AND (month_closed_at IS NULL OR :is_authorized_month_adjustment = 1);

INSERT INTO finance_repair_audit (
  id, group_id, repair_type, target_id, reason, ticket_ref, performed_by, created_at
) VALUES (
  lower(hex(randomblob(16))), :group_id, 'reclassify_purchase_snapshot', :purchase_id,
  :reason, :ticket_ref, :operator_id, datetime('now')
);
COMMIT;

-- ============================================================================
-- R4. 修复完成后强制验证：必须返回零行才能关闭告警
-- ============================================================================
-- 付款差额
SELECT p.id AS payment_id
FROM supplier_payments p
WHERE p.group_id = :group_id
  AND p.amount_minor <> COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.payment_id = p.id AND a.status = 'active'), 0)
                    + COALESCE((SELECT SUM(c.available_minor) FROM supplier_credits c WHERE c.origin_payment_id = p.id AND c.status = 'available'), 0);

-- 分类拆分差额
WITH totals AS (
  SELECT month, supplier_id, SUM(amount_minor) AS total_minor
  FROM spirit_purchase_records WHERE group_id = :group_id GROUP BY month, supplier_id
), split AS (
  SELECT month, supplier_id,
    SUM(CASE WHEN product_class_snapshot = 'beer' THEN amount_minor ELSE 0 END) AS beer_minor,
    SUM(CASE WHEN product_class_snapshot = 'spirit' THEN amount_minor ELSE 0 END) AS spirit_minor,
    SUM(CASE WHEN product_class_snapshot IS NULL THEN amount_minor ELSE 0 END) AS unresolved_minor
  FROM spirit_purchase_records WHERE group_id = :group_id GROUP BY month, supplier_id
)
SELECT t.month, t.supplier_id
FROM totals t JOIN split s USING (month, supplier_id)
WHERE t.total_minor <> s.beer_minor + s.spirit_minor + s.unresolved_minor;

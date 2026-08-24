-- 葡萄酒独立期初与跨财年历史断层只读稽核
-- 适用 D1 / SQLite。所有查询均为 SELECT/CTE；不会写入、修复或删除任何数据。
-- 期初基线为独立报表视图，不以供应商期初 = 酒款期初作为错误条件。

-- 参数：:fiscal_start（例如 2026-01），:fiscal_end（例如 2026-12）

-- 1) 当前有效期初，按对象和维度列出，供审计抽样；不做跨维度自动调平。
SELECT
  scope,
  subject_id,
  initial_cumulative_amount,
  created_at,
  updated_at
FROM wine_purchase_baselines
WHERE deleted_at IS NULL
ORDER BY scope, subject_id;

-- 2) 本财年每月真实采购：供应商总额、已链接酒款总额、待链接金额。
-- 供应商总额包含所有采购；酒款投影仅统计 bottle_id 已确认的行。
WITH monthly AS (
  SELECT
    substr(date, 1, 7) AS business_month,
    SUM(amount) AS supplier_purchase_amount,
    SUM(CASE WHEN bottle_id IS NOT NULL THEN amount ELSE 0 END) AS linked_product_amount,
    SUM(CASE WHEN bottle_id IS NULL THEN amount ELSE 0 END) AS unresolved_product_amount,
    COUNT(CASE WHEN bottle_id IS NULL THEN 1 END) AS unresolved_row_count
  FROM wine_manual_purchases
  WHERE substr(date, 1, 7) BETWEEN :fiscal_start AND :fiscal_end
  GROUP BY substr(date, 1, 7)
)
SELECT
  business_month,
  supplier_purchase_amount,
  linked_product_amount,
  unresolved_product_amount,
  unresolved_row_count,
  CASE
    WHEN unresolved_row_count = 0 AND abs(supplier_purchase_amount - linked_product_amount) < 0.000001 THEN 'complete'
    WHEN unresolved_row_count > 0 THEN 'needs_linking'
    ELSE 'investigate'
  END AS projection_status
FROM monthly
ORDER BY business_month;

-- 3) 未链接采购清单：只输出需人工确认的行，不凭名称猜测酒款。
SELECT
  id,
  date,
  supplier,
  product_name,
  category,
  quantity,
  amount,
  source,
  import_batch_id,
  source_sheet,
  source_row
FROM wine_manual_purchases
WHERE bottle_id IS NULL
  AND substr(date, 1, 7) BETWEEN :fiscal_start AND :fiscal_end
ORDER BY date, supplier, product_name;

-- 4) 已关闭月份的基线归档与现行基线差异。
-- 差异是可解释的更正线索，不是失败：关闭月份副本必须保持不可变。
WITH archived AS (
  SELECT
    a.month AS archived_month,
    json_extract(b.value, '$.scope') AS scope,
    json_extract(b.value, '$.subjectId') AS subject_id,
    CAST(json_extract(b.value, '$.initialCumulativeAmount') AS REAL) AS archived_amount
  FROM wine_purchase_baseline_archives a,
       json_each(a.baselines_json) b
  WHERE a.month BETWEEN :fiscal_start AND :fiscal_end
), current_baselines AS (
  SELECT scope, subject_id, initial_cumulative_amount, updated_at
  FROM wine_purchase_baselines
  WHERE deleted_at IS NULL
)
SELECT
  archived.archived_month,
  archived.scope,
  archived.subject_id,
  archived.archived_amount,
  current_baselines.initial_cumulative_amount AS current_amount,
  current_baselines.updated_at,
  COALESCE(current_baselines.initial_cumulative_amount, 0) - archived.archived_amount AS post_close_delta
FROM archived
LEFT JOIN current_baselines
  ON current_baselines.scope = archived.scope
 AND current_baselines.subject_id = archived.subject_id
WHERE abs(COALESCE(current_baselines.initial_cumulative_amount, 0) - archived.archived_amount) >= 0.000001
ORDER BY archived.archived_month, archived.scope, archived.subject_id;

-- 5) 审计完整性：期初创建/更新/删除/归档记录必须有原因和业务月。
SELECT
  id,
  baseline_id,
  action,
  previous_amount,
  next_amount,
  reason,
  occurred_at,
  month
FROM wine_purchase_baseline_audit_entries
WHERE (trim(COALESCE(reason, '')) = '' OR trim(COALESCE(month, '')) = '')
ORDER BY occurred_at DESC;

-- 6) 风险汇总：供运营告警或月结前签核使用。
WITH unresolved AS (
  SELECT COUNT(*) AS rows, COALESCE(SUM(amount), 0) AS amount
  FROM wine_manual_purchases
  WHERE bottle_id IS NULL AND substr(date, 1, 7) BETWEEN :fiscal_start AND :fiscal_end
), bad_audit AS (
  SELECT COUNT(*) AS rows
  FROM wine_purchase_baseline_audit_entries
  WHERE trim(COALESCE(reason, '')) = '' OR trim(COALESCE(month, '')) = ''
)
SELECT
  unresolved.rows AS unresolved_purchase_rows,
  unresolved.amount AS unresolved_purchase_amount,
  bad_audit.rows AS malformed_baseline_audit_rows,
  CASE WHEN unresolved.rows = 0 AND bad_audit.rows = 0 THEN 'ready_for_review' ELSE 'follow_up_required' END AS audit_status
FROM unresolved CROSS JOIN bad_audit;

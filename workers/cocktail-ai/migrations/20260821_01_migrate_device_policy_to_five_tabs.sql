-- DeviceSessionV2 五Tab授权迁移
-- 用户可配置权限收敛为：cocktail / wine / lab / food / store。
-- capabilities_json 在本迁移后只存储 "<tab>.access" 授权；列名保留以避免破坏既有D1表结构。
-- 业务数据、设备令牌、成员资格和同步快照均不删除。
-- 折算原则：owner 永远得到五Tab；非owner只有某Tab下全部旧资源均已有 view 时才得到该Tab，绝不静默扩大权限。

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS device_policy_migration_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  previous_policy_json TEXT NOT NULL,
  migrated_tab_policy_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(migration_key, device_id)
);

INSERT OR IGNORE INTO device_policy_migration_audit (
  migration_key, device_id, group_id, previous_policy_json, migrated_tab_policy_json, created_at
)
SELECT
  '20260821_01_five_business_tabs',
  p.device_id,
  p.group_id,
  p.capabilities_json,
  json_array(
    CASE WHEN d.role = 'owner' OR (
      p.capabilities_json LIKE '%"recipes.view"%' AND p.capabilities_json LIKE '%"bottles.view"%' AND p.capabilities_json LIKE '%"homemade.view"%' AND p.capabilities_json LIKE '%"books.view"%' AND p.capabilities_json LIKE '%"menu.view"%' AND p.capabilities_json LIKE '%"shopping.view"%'
    ) THEN 'cocktail.access' END,
    CASE WHEN d.role = 'owner' OR (
      p.capabilities_json LIKE '%"wine_catalog.view"%' AND p.capabilities_json LIKE '%"inventory_wine.view"%'
    ) THEN 'wine.access' END,
    CASE WHEN d.role = 'owner' OR (
      p.capabilities_json LIKE '%"lab_projects.view"%' AND p.capabilities_json LIKE '%"lab_batches.view"%' AND p.capabilities_json LIKE '%"lab_plan.view"%'
    ) THEN 'lab.access' END,
    CASE WHEN d.role = 'owner' OR (
      p.capabilities_json LIKE '%"food_menu.view"%' AND p.capabilities_json LIKE '%"food_ingredients.view"%' AND p.capabilities_json LIKE '%"inventory_food.view"%'
    ) THEN 'food.access' END,
    CASE WHEN d.role = 'owner' OR (
      p.capabilities_json LIKE '%"inventory_spirits.view"%' AND p.capabilities_json LIKE '%"inventory_fruit.view"%' AND p.capabilities_json LIKE '%"inventory_beer.view"%' AND p.capabilities_json LIKE '%"inventory_ice.view"%' AND
      p.capabilities_json LIKE '%"shop_glassware.view"%' AND p.capabilities_json LIKE '%"shop_tableware.view"%' AND p.capabilities_json LIKE '%"shop_supplies.view"%' AND p.capabilities_json LIKE '%"shop_equipment.view"%' AND p.capabilities_json LIKE '%"suppliers.view"%' AND
      p.capabilities_json LIKE '%"reports_monthly.view"%' AND p.capabilities_json LIKE '%"accounts.view"%' AND p.capabilities_json LIKE '%"analytics_business.view"%' AND p.capabilities_json LIKE '%"analytics_period.view"%' AND p.capabilities_json LIKE '%"petty_cash.view"%' AND p.capabilities_json LIKE '%"store_schedule.view"%' AND
      p.capabilities_json LIKE '%"labor_employees.view"%' AND p.capabilities_json LIKE '%"labor_schedule.view"%' AND p.capabilities_json LIKE '%"labor_attendance.view"%' AND p.capabilities_json LIKE '%"labor_comp_off.view"%' AND p.capabilities_json LIKE '%"payroll.view"%'
    ) THEN 'store.access' END
  ),
  unixepoch('now') * 1000
FROM device_policies p
JOIN devices d ON d.device_id = p.device_id AND d.group_id = p.group_id
WHERE d.is_active = 1;

UPDATE device_policies
SET capabilities_json = (
  SELECT migrated_tab_policy_json
  FROM device_policy_migration_audit audit
  WHERE audit.migration_key = '20260821_01_five_business_tabs'
    AND audit.device_id = device_policies.device_id
),
revision = revision + 1,
updated_at = unixepoch('now') * 1000,
updated_by = 'migration:20260821_01'
WHERE EXISTS (
  SELECT 1 FROM device_policy_migration_audit audit
  WHERE audit.migration_key = '20260821_01_five_business_tabs'
    AND audit.device_id = device_policies.device_id
);

-- 历史未使用配对码可能包含部分资源授权，不能自动扩大为全部Tab；
-- 安全作废后由主设备重新生成五Tab配对码，业务数据与现有成员不受影响。
DELETE FROM pair_code_policies WHERE capabilities_json LIKE '%.view%';
DELETE FROM pair_codes WHERE used = 0 AND code NOT IN (SELECT code FROM pair_code_policies);

UPDATE group_policy_revisions
SET revision = revision + 1,
updated_at = unixepoch('now') * 1000
WHERE group_id IN (SELECT DISTINCT group_id FROM device_policy_migration_audit WHERE migration_key = '20260821_01_five_business_tabs');

COMMIT;

import type { Capability, CapabilityResource } from "./capabilities";
import type { SyncStorageKey } from "./engine";

/**
 * 新功能接入同步架构的强制契约。
 * 新页面、新存储键、导入导出与业务命令必须先在此登记；CI 用此清单拒绝未声明接入。
 */
export type FeatureContract = Readonly<{
  id: string;
  label: string;
  resource: CapabilityResource;
  actions: Readonly<Record<string, Capability>>;
  sync: "shared" | "local_only";
  storageKeys: readonly SyncStorageKey[];
  offline: Readonly<{
    viewCached: boolean;
    allowDraftEdits: boolean;
    requiresOnlineActions: readonly string[];
  }>;
}>;

export function defineFeatureContract<const T extends FeatureContract>(contract: T): T {
  if (!contract.id || !contract.label) throw new Error("FEATURE_CONTRACT_INVALID");
  if (contract.sync === "shared" && contract.storageKeys.length === 0) throw new Error("FEATURE_CONTRACT_SHARED_KEYS_REQUIRED");
  if (contract.sync === "local_only" && contract.storageKeys.length > 0) throw new Error("FEATURE_CONTRACT_LOCAL_ONLY_KEYS_FORBIDDEN");
  return contract;
}

const cachedEditable = { viewCached: true, allowDraftEdits: true, requiresOnlineActions: [] } as const;
const cachedReadOnly = { viewCached: true, allowDraftEdits: false, requiresOnlineActions: [] } as const;

/**
 * 全 App 功能目录。新增功能必须先登记此处，新增同步键必须同时进入 STORAGE_POLICY。
 * 资源、动作、同步键和离线行为在此形成可审计的单一产品契约。
 */
export const FEATURE_CONTRACTS = [
  // 设备、数据保护与诊断
  defineFeatureContract({ id: "devices.manager", label: "设备管理", resource: "devices", actions: { open: "devices.view", manage: "devices.manage" }, sync: "local_only", storageKeys: [], offline: { ...cachedReadOnly, requiresOnlineActions: ["manage"] } }),
  defineFeatureContract({ id: "sync.diagnostics", label: "同步诊断", resource: "sync_diagnostics", actions: { open: "sync_diagnostics.view" }, sync: "local_only", storageKeys: [], offline: cachedReadOnly }),
  defineFeatureContract({ id: "backup.workspace", label: "备份与恢复", resource: "backup", actions: { open: "backup.view", export: "backup.export", manage: "backup.manage" }, sync: "local_only", storageKeys: [], offline: { ...cachedReadOnly, requiresOnlineActions: ["export", "manage"] } }),
  defineFeatureContract({ id: "data.manager", label: "数据管理", resource: "data", actions: { open: "data.view", manage: "data.manage" }, sync: "local_only", storageKeys: [], offline: { ...cachedReadOnly, requiresOnlineActions: ["manage"] } }),

  // 鸡尾酒内容与研发
  defineFeatureContract({ id: "recipes.workspace", label: "配方库", resource: "recipes", actions: { open: "recipes.view", edit: "recipes.edit", import: "recipes.import", manage: "recipes.manage" }, sync: "shared", storageKeys: ["cocktail.recipes", "cocktail.categories", "cocktail.tags", "cocktail.tagGroups", "cocktail.categoryGroups", "cocktail.seeded"], offline: { ...cachedEditable, requiresOnlineActions: ["import"] } }),
  defineFeatureContract({ id: "bottles.workspace", label: "酒款库", resource: "bottles", actions: { open: "bottles.view", edit: "bottles.edit", import: "bottles.import", manage: "bottles.manage" }, sync: "shared", storageKeys: ["cocktail.bottles", "bottles.price-alerts.v1", "cocktail.bottles.seeded", "bottles.taxonomy.categories.v1", "bottles.taxonomy.styles.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["import"] } }),
  defineFeatureContract({ id: "homemade.workspace", label: "自制品", resource: "homemade", actions: { open: "homemade.view", edit: "homemade.edit", import: "homemade.import", manage: "homemade.manage" }, sync: "shared", storageKeys: ["homemade.preps.v1", "homemade.sections.v1", "homemade.types.v1", "homemade.taxonomy.v2"], offline: { ...cachedEditable, requiresOnlineActions: ["import"] } }),
  defineFeatureContract({ id: "lab.projects", label: "研发项目", resource: "lab_projects", actions: { open: "lab_projects.view", edit: "lab_projects.edit" }, sync: "shared", storageKeys: ["cocktail.lab.projects"], offline: cachedEditable }),
  defineFeatureContract({ id: "lab.batches", label: "研发批次", resource: "lab_batches", actions: { open: "lab_batches.view", edit: "lab_batches.edit" }, sync: "shared", storageKeys: ["cocktail.lab.batches"], offline: cachedEditable }),
  defineFeatureContract({ id: "lab.plan", label: "研发计划", resource: "lab_plan", actions: { open: "lab_plan.view", edit: "lab_plan.edit" }, sync: "shared", storageKeys: ["lab.plan.v1"], offline: cachedEditable }),

  // 酒单、采购、餐食与葡萄酒
  defineFeatureContract({ id: "menu.workspace", label: "门店酒单", resource: "menu", actions: { open: "menu.view", edit: "menu.edit" }, sync: "shared", storageKeys: ["menu_store_v1", "menu.packages.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "shopping.workspace", label: "采购清单", resource: "shopping", actions: { open: "shopping.view", edit: "shopping.edit" }, sync: "shared", storageKeys: ["shopping_store_v1", "store.purchase.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "wine.catalog", label: "葡萄酒库", resource: "wine_catalog", actions: { open: "wine_catalog.view", edit: "wine_catalog.edit" }, sync: "shared", storageKeys: ["wine.bottles.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "wine.inventory", label: "葡萄酒工作台", resource: "inventory_wine", actions: { open: "inventory_wine.view", edit: "inventory_wine.edit", import: "inventory_wine.import", export: "inventory_wine.export", close: "inventory_wine.close" }, sync: "shared", storageKeys: ["wine.snapshots.v2", "wine.manual_purchases.v1", "wine.import_control.v1", "wine.master_data.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["import", "export", "close"] } }),
  defineFeatureContract({ id: "food.menu", label: "餐食菜单", resource: "food_menu", actions: { open: "food_menu.view", edit: "food_menu.edit" }, sync: "shared", storageKeys: ["food.menu.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "food.ingredients", label: "食材库", resource: "food_ingredients", actions: { open: "food_ingredients.view", edit: "food_ingredients.edit" }, sync: "shared", storageKeys: ["food.ingredients.v2"], offline: cachedEditable }),

  // 库存六类与店铺四类
  defineFeatureContract({ id: "inventory.spirits", label: "烈酒库存", resource: "inventory_spirits", actions: { open: "inventory_spirits.view", edit: "inventory_spirits.edit", import: "inventory_spirits.import", export: "inventory_spirits.export", close: "inventory_spirits.close", manage: "inventory_spirits.manage" }, sync: "shared", storageKeys: ["spirits.items.v3", "spirits.purchases.v3", "spirits.ledger.v3", "spirits.refPrices.v1", "spirits.suppliers.v1", "spirits.groups.v1", "spirits.matchMemory.v1", "spirits.selfBuyConfig.v1", "spirits.customCategories.v1", "spirits.groupMatchMemory.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["import", "export", "close"] } }),
  defineFeatureContract({ id: "inventory.fruit", label: "水果库存", resource: "inventory_fruit", actions: { open: "inventory_fruit.view", edit: "inventory_fruit.edit", close: "inventory_fruit.close" }, sync: "shared", storageKeys: ["fruit.items.v1", "fruit.transactions.v1", "fruit.snapshots.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["close"] } }),
  defineFeatureContract({ id: "inventory.food", label: "食材库存", resource: "inventory_food", actions: { open: "inventory_food.view", edit: "inventory_food.edit", close: "inventory_food.close" }, sync: "shared", storageKeys: ["food.purchases.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["close"] } }),
  defineFeatureContract({ id: "inventory.beer", label: "啤酒库存", resource: "inventory_beer", actions: { open: "inventory_beer.view", edit: "inventory_beer.edit", close: "inventory_beer.close" }, sync: "shared", storageKeys: ["beer.items.v1", "beer.transactions.v1", "beer.snapshots.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["close"] } }),
  defineFeatureContract({ id: "inventory.ice", label: "冰块库存", resource: "inventory_ice", actions: { open: "inventory_ice.view", edit: "inventory_ice.edit", close: "inventory_ice.close", manage: "inventory_ice.manage" }, sync: "shared", storageKeys: ["ice.inv.items.v1", "ice.inv.tx.v1", "ice.inventory.v1", "cocktail.iceSettings.v2"], offline: { ...cachedEditable, requiresOnlineActions: ["close"] } }),
  defineFeatureContract({ id: "shop.glassware", label: "杯具台账", resource: "shop_glassware", actions: { open: "shop_glassware.view", edit: "shop_glassware.edit" }, sync: "local_only", storageKeys: [], offline: cachedEditable }),
  defineFeatureContract({ id: "shop.tableware", label: "餐具台账", resource: "shop_tableware", actions: { open: "shop_tableware.view", edit: "shop_tableware.edit" }, sync: "local_only", storageKeys: [], offline: cachedEditable }),
  defineFeatureContract({ id: "shop.supplies", label: "日用品台账", resource: "shop_supplies", actions: { open: "shop_supplies.view", edit: "shop_supplies.edit" }, sync: "local_only", storageKeys: [], offline: cachedEditable }),
  defineFeatureContract({ id: "shop.equipment", label: "设备台账", resource: "shop_equipment", actions: { open: "shop_equipment.view", edit: "shop_equipment.edit" }, sync: "shared", storageKeys: ["equipment.inventory.v1", "store.inventory.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "suppliers.workspace", label: "供应商", resource: "suppliers", actions: { open: "suppliers.view", edit: "suppliers.edit", manage: "suppliers.manage" }, sync: "shared", storageKeys: ["monthly_summary.suppliers.v1", "supplier.match.memory.v1"], offline: cachedEditable }),

  // 员工与薪资
  defineFeatureContract({ id: "labor.employees", label: "员工档案", resource: "labor_employees", actions: { open: "labor_employees.view", edit: "labor_employees.edit", manage: "labor_employees.manage" }, sync: "shared", storageKeys: ["labor_employees_v1", "labor_employee_groups_v1", "labor_custom_depts_v1", "labor_dept_order_v1", "store.employee_name_aliases.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "labor.schedule", label: "排班", resource: "labor_schedule", actions: { open: "labor_schedule.view", edit: "labor_schedule.edit", manage: "labor_schedule.manage" }, sync: "shared", storageKeys: ["labor_shifts_v1", "labor_shift_templates_v1", "labor_shift_groups_v1", "labor_fill_presets_v1", "labor_business_hours_v1", "labor_month_configs_v1", "labor_holiday_configs_v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "labor.attendance", label: "考勤", resource: "labor_attendance", actions: { open: "labor_attendance.view", edit: "labor_attendance.edit", manage: "labor_attendance.manage" }, sync: "shared", storageKeys: ["labor_attendance_v1", "labor_special_statuses_v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "labor.comp_off", label: "加班与调休", resource: "labor_comp_off", actions: { open: "labor_comp_off.view", edit: "labor_comp_off.edit", manage: "labor_comp_off.manage" }, sync: "shared", storageKeys: ["labor_comp_off_v1", "labor_comp_off_entries_v1", "labor_holiday_comp_off_v1", "labor_unexplained_rest_alerts_v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "payroll.workspace", label: "薪资管理", resource: "payroll", actions: { open: "payroll.view", edit: "payroll.edit", close: "payroll.close", manage: "payroll.manage" }, sync: "shared", storageKeys: ["labor_payslips_v1", "labor.separate_payments.v1", "labor_month_close_archives_v1", "labor_month_adjustment_sessions_v1", "labor.salary_advances.v1", "labor.advance_categories.v1", "labor_performance_templates_v1", "labor_performance_records_v1", "labor_global_payroll_settings_v1"], offline: { ...cachedEditable, requiresOnlineActions: ["close"] } }),

  // 报表、账户、经营与门店配置
  defineFeatureContract({ id: "reports.monthly", label: "总月报", resource: "reports_monthly", actions: { open: "reports_monthly.view", edit: "reports_monthly.edit", import: "reports_monthly.import", export: "reports_monthly.export", close: "reports_monthly.close", manage: "reports_monthly.manage" }, sync: "shared", storageKeys: ["monthly_summary.reports.v1", "monthly_reports_v1", "monthly_summary.inventory_configs.v1", "module_month_close_archives_v1", "module_month_adjustment_sessions_v1"], offline: { ...cachedReadOnly, requiresOnlineActions: ["import", "export", "close"] } }),
  defineFeatureContract({ id: "accounts.workspace", label: "账户", resource: "accounts", actions: { open: "accounts.view", edit: "accounts.edit", export: "accounts.export" }, sync: "shared", storageKeys: ["store.revenue.v1", "monthly_summary.payments.v1", "monthly_summary.balances.v1"], offline: { ...cachedEditable, requiresOnlineActions: ["export"] } }),
  defineFeatureContract({ id: "analytics.business", label: "经营分析", resource: "analytics_business", actions: { open: "analytics_business.view", edit: "analytics_business.edit" }, sync: "shared", storageKeys: ["dish_analysis.snapshots.v1"], offline: cachedReadOnly }),
  defineFeatureContract({ id: "analytics.period", label: "时段经营分析", resource: "analytics_period", actions: { open: "analytics_period.view", edit: "analytics_period.edit", manage: "analytics_period.manage" }, sync: "shared", storageKeys: ["period_analysis.reports.v1", "period_analysis.settings.v1"], offline: cachedReadOnly }),
  defineFeatureContract({ id: "petty.cash", label: "备用金", resource: "petty_cash", actions: { open: "petty_cash.view", edit: "petty_cash.edit", manage: "petty_cash.manage" }, sync: "shared", storageKeys: ["store.petty.v1", "store.petty_categories.v1", "store.petty_inv_links.v1", "store.petty_labor_links.v1", "monthly_summary.petty_configs.v1"], offline: cachedEditable }),
  defineFeatureContract({ id: "store.schedule", label: "门店营业设置", resource: "store_schedule", actions: { open: "store_schedule.view", manage: "store_schedule.manage" }, sync: "shared", storageKeys: ["schedule.business_hours.v1", "schedule.shift_templates.v1"], offline: cachedReadOnly }),
  defineFeatureContract({ id: "preferences.workspace", label: "偏好设置", resource: "preferences", actions: { open: "preferences.view", edit: "preferences.edit" }, sync: "shared", storageKeys: ["cocktail.prefs.v1", "app.lang.v1"], offline: cachedEditable }),
] as const;

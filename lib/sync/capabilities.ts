import type { SyncStorageKey } from "./engine";

/**
 * 全 App 权限能力模型。
 *
 * 规则：页面展示、按钮动作、Worker pull/push 和业务命令均只能引用此文件。
 * 不允许以成员角色或单个 storage key 推断用户权限。
 */
export const CAPABILITY_ACTIONS = [
  "view",
  "edit",
  "import",
  "export",
  "close",
  "manage",
] as const;

export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

export const CAPABILITY_RESOURCES = [
  "devices",
  "sync_diagnostics",
  "backup",
  "data",
  "recipes",
  "bottles",
  "homemade",
  "lab_projects",
  "lab_batches",
  "lab_plan",
  "books",
  "menu",
  "shopping",
  "wine_catalog",
  "food_menu",
  "food_ingredients",
  "inventory_spirits",
  "inventory_wine",
  "inventory_fruit",
  "inventory_food",
  "inventory_beer",
  "inventory_ice",
  "shop_glassware",
  "shop_tableware",
  "shop_supplies",
  "shop_equipment",
  "suppliers",
  "reports_monthly",
  "accounts",
  "analytics_business",
  "analytics_period",
  "petty_cash",
  "store_schedule",
  "labor_employees",
  "labor_schedule",
  "labor_attendance",
  "labor_comp_off",
  "payroll",
  "preferences",
] as const;

export type CapabilityResource = (typeof CAPABILITY_RESOURCES)[number];
export type Capability = `${CapabilityResource}.${CapabilityAction}`;

export type StorageCapabilityPolicy = Readonly<{
  /** 拉取此键到设备与展示相应业务页面需要的能力。 */
  read: Capability;
  /** 变更此键并同步至云端需要的能力；null 表示仅由服务端命令写入。 */
  write: Capability | null;
}>;

const policy = (read: Capability, write: Capability | null = read.replace(/\.view$/, ".edit") as Capability): StorageCapabilityPolicy => ({ read, write });

/**
 * 所有同步键必须有且只有一个资源归属。该映射是策略契约测试的强制门禁。
 * 用户个人界面偏好也保持显式归属，避免把共享业务数据和本机外观设置混淆。
 */
export const STORAGE_POLICY: Readonly<Record<SyncStorageKey, StorageCapabilityPolicy>> = {
  // 配方与分类
  "cocktail.recipes": policy("recipes.view", "recipes.edit"),
  "cocktail.categories": policy("recipes.view", "recipes.manage"),
  "cocktail.tags": policy("recipes.view", "recipes.manage"),
  "cocktail.tagGroups": policy("recipes.view", "recipes.manage"),
  "cocktail.categoryGroups": policy("recipes.view", "recipes.manage"),
  "cocktail.seeded": policy("recipes.view", "recipes.manage"),
  "cocktail_waldorf_imported_v1": policy("recipes.view", "recipes.import"),

  // 酒款库
  "cocktail.bottles": policy("bottles.view", "bottles.edit"),
  "cocktail.bottles.seeded": policy("bottles.view", "bottles.manage"),
  "cocktail.bottles.waldorf.v1": policy("bottles.view", "bottles.import"),
  "bottles.taxonomy.categories.v1": policy("bottles.view", "bottles.manage"),
  "bottles.taxonomy.styles.v1": policy("bottles.view", "bottles.manage"),

  // 自制品与研发
  "homemade.preps.v1": policy("homemade.view", "homemade.edit"),
  "homemade.seeded.v1": policy("homemade.view", "homemade.manage"),
  "homemade.sections.v1": policy("homemade.view", "homemade.manage"),
  "homemade.types.v1": policy("homemade.view", "homemade.manage"),
  "homemade.taxonomy.v2": policy("homemade.view", "homemade.manage"),
  "homemade.waldorf.v1": policy("homemade.view", "homemade.import"),
  "homemade.waldorf.v2": policy("homemade.view", "homemade.import"),
  "homemade.source.v3": policy("homemade.view", "homemade.manage"),
  "cocktail.lab.projects": policy("lab_projects.view", "lab_projects.edit"),
  "cocktail.lab.batches": policy("lab_batches.view", "lab_batches.edit"),
  "lab.plan.v1": policy("lab_plan.view", "lab_plan.edit"),

  // 用户内容、酒单和采购
  "cocktail.books.v1": policy("books.view", "books.manage"),
  "menu_store_v1": policy("menu.view", "menu.edit"),
  "menu.packages.v1": policy("menu.view", "menu.edit"),
  "shopping_store_v1": policy("shopping.view", "shopping.edit"),
  "cocktail.prefs.v1": policy("preferences.view", "preferences.edit"),
  "app.lang.v1": policy("preferences.view", "preferences.edit"),

  // 葡萄酒与餐食
  "wine.bottles.v1": policy("wine_catalog.view", "wine_catalog.edit"),
  "wine.snapshots.v2": policy("inventory_wine.view", "inventory_wine.close"),
  "wine.manual_purchases.v1": policy("inventory_wine.view", "inventory_wine.edit"),
  "food.menu.v1": policy("food_menu.view", "food_menu.edit"),
  "food.ingredients.v2": policy("food_ingredients.view", "food_ingredients.edit"),
  "food.purchases.v1": policy("inventory_food.view", "inventory_food.edit"),

  // 门店财务、月报与时段经营
  "store.revenue.v1": policy("accounts.view", "accounts.edit"),
  "store.petty.v1": policy("petty_cash.view", "petty_cash.edit"),
  "store.petty_categories.v1": policy("petty_cash.view", "petty_cash.manage"),
  "store.petty_inv_links.v1": policy("petty_cash.view", "petty_cash.manage"),
  "store.petty_labor_links.v1": policy("petty_cash.view", "petty_cash.manage"),
  "store.employee_name_aliases.v1": policy("labor_employees.view", "labor_employees.manage"),
  "store.inventory.v1": policy("shop_equipment.view", "shop_equipment.edit"),
  "monthly_summary.reports.v1": policy("reports_monthly.view", "reports_monthly.edit"),
  "monthly_summary.suppliers.v1": policy("suppliers.view", "suppliers.edit"),
  "monthly_summary.payments.v1": policy("accounts.view", "accounts.edit"),
  "monthly_summary.balances.v1": policy("accounts.view", "accounts.edit"),
  "monthly_summary.petty_configs.v1": policy("petty_cash.view", "petty_cash.manage"),
  "monthly_summary.inventory_configs.v1": policy("reports_monthly.view", "reports_monthly.manage"),
  "monthly_reports_v1": policy("reports_monthly.view", "reports_monthly.import"),
  "period_analysis.reports.v1": policy("analytics_period.view", "analytics_period.edit"),
  "period_analysis.settings.v1": policy("analytics_period.view", "analytics_period.manage"),
  "dish_analysis.snapshots.v1": policy("analytics_business.view", "analytics_business.edit"),
  "schedule.business_hours.v1": policy("store_schedule.view", "store_schedule.manage"),
  "schedule.shift_templates.v1": policy("store_schedule.view", "store_schedule.manage"),

  // 员工、排班、考勤、调休与工资
  "labor_employees_v1": policy("labor_employees.view", "labor_employees.edit"),
  "labor_employee_groups_v1": policy("labor_employees.view", "labor_employees.manage"),
  "labor_custom_depts_v1": policy("labor_employees.view", "labor_employees.manage"),
  "labor_dept_order_v1": policy("labor_employees.view", "labor_employees.manage"),
  "labor_shifts_v1": policy("labor_schedule.view", "labor_schedule.edit"),
  "labor_shift_templates_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_shift_groups_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_fill_presets_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_business_hours_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_attendance_v1": policy("labor_attendance.view", "labor_attendance.edit"),
  "labor_month_configs_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_holiday_configs_v1": policy("labor_schedule.view", "labor_schedule.manage"),
  "labor_comp_off_v1": policy("labor_comp_off.view", "labor_comp_off.edit"),
  "labor_comp_off_entries_v1": policy("labor_comp_off.view", "labor_comp_off.edit"),
  "labor_holiday_comp_off_v1": policy("labor_comp_off.view", "labor_comp_off.edit"),
  "labor_unexplained_rest_alerts_v1": policy("labor_comp_off.view", "labor_comp_off.manage"),
  "labor_special_statuses_v1": policy("labor_attendance.view", "labor_attendance.manage"),
  "labor_payslips_v1": policy("payroll.view", "payroll.edit"),
  "labor_month_close_archives_v1": policy("payroll.view", "payroll.close"),
  "labor_month_adjustment_sessions_v1": policy("payroll.view", "payroll.edit"),
  "labor.salary_advances.v1": policy("payroll.view", "payroll.edit"),
  "labor.advance_categories.v1": policy("payroll.view", "payroll.manage"),
  "labor_performance_templates_v1": policy("payroll.view", "payroll.manage"),
  "labor_performance_records_v1": policy("payroll.view", "payroll.edit"),
  "labor_global_payroll_settings_v1": policy("payroll.view", "payroll.manage"),

  // 烈酒进销存
  "spirits.items.v3": policy("inventory_spirits.view", "inventory_spirits.edit"),
  "spirits.purchases.v3": policy("inventory_spirits.view", "inventory_spirits.edit"),
  "spirits.ledger.v3": policy("inventory_spirits.view", "inventory_spirits.edit"),
  "spirits.refPrices.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),
  "spirits.suppliers.v1": policy("inventory_spirits.view", "suppliers.edit"),
  "spirits.groups.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),
  "spirits.matchMemory.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),
  "spirits.selfBuyConfig.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),
  "spirits.customCategories.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),
  "spirits.groupMatchMemory.v1": policy("inventory_spirits.view", "inventory_spirits.manage"),

  // 水果、啤酒、冰块与店铺
  "fruit.items.v1": policy("inventory_fruit.view", "inventory_fruit.edit"),
  "fruit.transactions.v1": policy("inventory_fruit.view", "inventory_fruit.edit"),
  "fruit.snapshots.v1": policy("inventory_fruit.view", "inventory_fruit.close"),
  "beer.items.v1": policy("inventory_beer.view", "inventory_beer.edit"),
  "beer.transactions.v1": policy("inventory_beer.view", "inventory_beer.edit"),
  "beer.snapshots.v1": policy("inventory_beer.view", "inventory_beer.close"),
  "ice.inv.items.v1": policy("inventory_ice.view", "inventory_ice.edit"),
  "ice.inv.tx.v1": policy("inventory_ice.view", "inventory_ice.edit"),
  "ice.inventory.v1": policy("inventory_ice.view", "inventory_ice.close"),
  "cocktail.iceSettings.v2": policy("inventory_ice.view", "inventory_ice.manage"),
  "equipment.inventory.v1": policy("shop_equipment.view", "shop_equipment.edit"),
  "supplier.match.memory.v1": policy("suppliers.view", "suppliers.manage"),
} as const;

export type BusinessCommand =
  | "report.import"
  | "report.export"
  | "report.close"
  | "analytics.rebuild"
  | "wine.import"
  | "wine.export"
  | "wine.clear_monthly_purchases"
  | "wine.recalculate_inventory"
  | "inventory.close_month"
  | "payroll.close_month"
  | "device.manage";

export const COMMAND_POLICY: Readonly<Record<BusinessCommand, Capability>> = {
  "report.import": "reports_monthly.import",
  "report.export": "reports_monthly.export",
  "report.close": "reports_monthly.close",
  "analytics.rebuild": "analytics_business.edit",
  "wine.import": "inventory_wine.import",
  "wine.export": "inventory_wine.export",
  "wine.clear_monthly_purchases": "inventory_wine.close",
  "wine.recalculate_inventory": "inventory_wine.close",
  "inventory.close_month": "inventory_spirits.close",
  "payroll.close_month": "payroll.close",
  "device.manage": "devices.manage",
} as const;

export function capabilitiesForRole(role: "owner" | "collaborator" | "guest"): readonly Capability[] {
  if (role === "owner") {
    return CAPABILITY_RESOURCES.flatMap((resource) =>
      CAPABILITY_ACTIONS.map((action) => `${resource}.${action}` as Capability),
    );
  }
  return [];
}

export function storagePolicyFor(storageKey: SyncStorageKey): StorageCapabilityPolicy {
  return STORAGE_POLICY[storageKey];
}

export function isStorageKeyReadable(storageKey: SyncStorageKey, capabilities: readonly Capability[]): boolean {
  return capabilities.includes(STORAGE_POLICY[storageKey].read);
}

export function isStorageKeyWritable(storageKey: SyncStorageKey, capabilities: readonly Capability[]): boolean {
  const write = STORAGE_POLICY[storageKey].write;
  return write !== null && capabilities.includes(write);
}

/** 在线核验前或离线缓存下禁止的高风险能力。 */
export const ONLINE_REQUIRED_CAPABILITIES = new Set<Capability>([
  "devices.manage",
  "backup.export",
  "data.manage",
  "reports_monthly.import",
  "reports_monthly.export",
  "reports_monthly.close",
  "accounts.export",
  "petty_cash.close",
  "inventory_spirits.import",
  "inventory_spirits.export",
  "inventory_spirits.close",
  "inventory_wine.import",
  "inventory_wine.export",
  "inventory_wine.close",
  "inventory_fruit.import",
  "inventory_fruit.export",
  "inventory_fruit.close",
  "inventory_food.import",
  "inventory_food.export",
  "inventory_food.close",
  "inventory_beer.import",
  "inventory_beer.export",
  "inventory_beer.close",
  "inventory_ice.import",
  "inventory_ice.export",
  "inventory_ice.close",
  "payroll.close",
]);

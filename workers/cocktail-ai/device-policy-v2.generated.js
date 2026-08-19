// Generated from lib/sync/capabilities.ts by scripts/generate-device-policy-v2-worker-map.mjs.
// Do not edit manually; regenerate whenever capabilities or storage policy changes.
const V2_ACTIONS = ["view","edit","import","export","close","manage"];
const V2_RESOURCES = ["devices","sync_diagnostics","backup","data","recipes","bottles","homemade","lab_projects","lab_batches","lab_plan","books","menu","shopping","wine_catalog","food_menu","food_ingredients","inventory_spirits","inventory_wine","inventory_fruit","inventory_food","inventory_beer","inventory_ice","shop_glassware","shop_tableware","shop_supplies","shop_equipment","suppliers","reports_monthly","accounts","analytics_business","analytics_period","petty_cash","store_schedule","labor_employees","labor_schedule","labor_attendance","labor_comp_off","payroll","preferences"];
const V2_BUSINESS_TABS = ["cocktail","wine","lab","food","store"];
const V2_BUSINESS_TAB_RESOURCES = {"cocktail":["recipes","bottles","homemade","books","menu","shopping"],"wine":["wine_catalog","inventory_wine"],"lab":["lab_projects","lab_batches","lab_plan"],"food":["food_menu","food_ingredients","inventory_food"],"store":["inventory_spirits","inventory_fruit","inventory_beer","inventory_ice","shop_glassware","shop_tableware","shop_supplies","shop_equipment","suppliers","reports_monthly","accounts","analytics_business","analytics_period","petty_cash","store_schedule","labor_employees","labor_schedule","labor_attendance","labor_comp_off","payroll"]};
const V2_RESOURCE_TAB = {"recipes":"cocktail","bottles":"cocktail","homemade":"cocktail","books":"cocktail","menu":"cocktail","shopping":"cocktail","wine_catalog":"wine","inventory_wine":"wine","lab_projects":"lab","lab_batches":"lab","lab_plan":"lab","food_menu":"food","food_ingredients":"food","inventory_food":"food","inventory_spirits":"store","inventory_fruit":"store","inventory_beer":"store","inventory_ice":"store","shop_glassware":"store","shop_tableware":"store","shop_supplies":"store","shop_equipment":"store","suppliers":"store","reports_monthly":"store","accounts":"store","analytics_business":"store","analytics_period":"store","petty_cash":"store","store_schedule":"store","labor_employees":"store","labor_schedule":"store","labor_attendance":"store","labor_comp_off":"store","payroll":"store"};
const V2_ALL_CAPABILITIES = V2_RESOURCES.flatMap((resource) => V2_ACTIONS.map((action) => `${resource}.${action}`));
const V2_CAPABILITY_SET = new Set(V2_ALL_CAPABILITIES);
const V2_TAB_GRANT_SET = new Set(V2_BUSINESS_TABS.map((tab) => `${tab}.access`));
const V2_STORAGE_CAPABILITY = {
  "cocktail.recipes": [
    "recipes.view",
    "recipes.edit"
  ],
  "cocktail.categories": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.tags": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.tagGroups": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.categoryGroups": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail.seeded": [
    "recipes.view",
    "recipes.manage"
  ],
  "cocktail_waldorf_imported_v1": [
    "recipes.view",
    "recipes.import"
  ],
  "cocktail.bottles": [
    "bottles.view",
    "bottles.edit"
  ],
  "cocktail.bottles.seeded": [
    "bottles.view",
    "bottles.manage"
  ],
  "cocktail.bottles.waldorf.v1": [
    "bottles.view",
    "bottles.import"
  ],
  "bottles.taxonomy.categories.v1": [
    "bottles.view",
    "bottles.manage"
  ],
  "bottles.taxonomy.styles.v1": [
    "bottles.view",
    "bottles.manage"
  ],
  "homemade.preps.v1": [
    "homemade.view",
    "homemade.edit"
  ],
  "homemade.seeded.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.sections.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.types.v1": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.taxonomy.v2": [
    "homemade.view",
    "homemade.manage"
  ],
  "homemade.waldorf.v1": [
    "homemade.view",
    "homemade.import"
  ],
  "homemade.waldorf.v2": [
    "homemade.view",
    "homemade.import"
  ],
  "homemade.source.v3": [
    "homemade.view",
    "homemade.manage"
  ],
  "cocktail.lab.projects": [
    "lab_projects.view",
    "lab_projects.edit"
  ],
  "cocktail.lab.batches": [
    "lab_batches.view",
    "lab_batches.edit"
  ],
  "lab.plan.v1": [
    "lab_plan.view",
    "lab_plan.edit"
  ],
  "cocktail.books.v1": [
    "books.view",
    "books.manage"
  ],
  "menu_store_v1": [
    "menu.view",
    "menu.edit"
  ],
  "menu.packages.v1": [
    "menu.view",
    "menu.edit"
  ],
  "shopping_store_v1": [
    "shopping.view",
    "shopping.edit"
  ],
  "cocktail.prefs.v1": [
    "preferences.view",
    "preferences.edit"
  ],
  "app.lang.v1": [
    "preferences.view",
    "preferences.edit"
  ],
  "wine.bottles.v1": [
    "wine_catalog.view",
    "wine_catalog.edit"
  ],
  "wine.snapshots.v2": [
    "inventory_wine.view",
    "inventory_wine.close"
  ],
  "wine.manual_purchases.v1": [
    "inventory_wine.view",
    "inventory_wine.edit"
  ],
  "food.menu.v1": [
    "food_menu.view",
    "food_menu.edit"
  ],
  "food.ingredients.v2": [
    "food_ingredients.view",
    "food_ingredients.edit"
  ],
  "food.purchases.v1": [
    "inventory_food.view",
    "inventory_food.edit"
  ],
  "store.revenue.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "store.petty.v1": [
    "petty_cash.view",
    "petty_cash.edit"
  ],
  "store.petty_categories.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.petty_inv_links.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.petty_labor_links.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "store.employee_name_aliases.v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "store.inventory.v1": [
    "shop_equipment.view",
    "shop_equipment.edit"
  ],
  "monthly_summary.reports.v1": [
    "reports_monthly.view",
    "reports_monthly.edit"
  ],
  "monthly_summary.suppliers.v1": [
    "suppliers.view",
    "suppliers.edit"
  ],
  "monthly_summary.payments.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "monthly_summary.balances.v1": [
    "accounts.view",
    "accounts.edit"
  ],
  "monthly_summary.petty_configs.v1": [
    "petty_cash.view",
    "petty_cash.manage"
  ],
  "monthly_summary.inventory_configs.v1": [
    "reports_monthly.view",
    "reports_monthly.manage"
  ],
  "monthly_reports_v1": [
    "reports_monthly.view",
    "reports_monthly.import"
  ],
  "period_analysis.reports.v1": [
    "analytics_period.view",
    "analytics_period.edit"
  ],
  "period_analysis.settings.v1": [
    "analytics_period.view",
    "analytics_period.manage"
  ],
  "dish_analysis.snapshots.v1": [
    "analytics_business.view",
    "analytics_business.edit"
  ],
  "schedule.business_hours.v1": [
    "store_schedule.view",
    "store_schedule.manage"
  ],
  "schedule.shift_templates.v1": [
    "store_schedule.view",
    "store_schedule.manage"
  ],
  "labor_employees_v1": [
    "labor_employees.view",
    "labor_employees.edit"
  ],
  "labor_employee_groups_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_custom_depts_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_dept_order_v1": [
    "labor_employees.view",
    "labor_employees.manage"
  ],
  "labor_shifts_v1": [
    "labor_schedule.view",
    "labor_schedule.edit"
  ],
  "labor_shift_templates_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_shift_groups_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_fill_presets_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_business_hours_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_attendance_v1": [
    "labor_attendance.view",
    "labor_attendance.edit"
  ],
  "labor_month_configs_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_holiday_configs_v1": [
    "labor_schedule.view",
    "labor_schedule.manage"
  ],
  "labor_comp_off_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_comp_off_entries_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_holiday_comp_off_v1": [
    "labor_comp_off.view",
    "labor_comp_off.edit"
  ],
  "labor_unexplained_rest_alerts_v1": [
    "labor_comp_off.view",
    "labor_comp_off.manage"
  ],
  "labor_special_statuses_v1": [
    "labor_attendance.view",
    "labor_attendance.manage"
  ],
  "labor_payslips_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor_month_close_archives_v1": [
    "payroll.view",
    "payroll.close"
  ],
  "labor_month_adjustment_sessions_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor.salary_advances.v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor.advance_categories.v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "labor_performance_templates_v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "labor_performance_records_v1": [
    "payroll.view",
    "payroll.edit"
  ],
  "labor_global_payroll_settings_v1": [
    "payroll.view",
    "payroll.manage"
  ],
  "spirits.items.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.purchases.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.ledger.v3": [
    "inventory_spirits.view",
    "inventory_spirits.edit"
  ],
  "spirits.refPrices.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.suppliers.v1": [
    "inventory_spirits.view",
    "suppliers.edit"
  ],
  "spirits.groups.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.matchMemory.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.selfBuyConfig.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.customCategories.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "spirits.groupMatchMemory.v1": [
    "inventory_spirits.view",
    "inventory_spirits.manage"
  ],
  "fruit.items.v1": [
    "inventory_fruit.view",
    "inventory_fruit.edit"
  ],
  "fruit.transactions.v1": [
    "inventory_fruit.view",
    "inventory_fruit.edit"
  ],
  "fruit.snapshots.v1": [
    "inventory_fruit.view",
    "inventory_fruit.close"
  ],
  "beer.items.v1": [
    "inventory_beer.view",
    "inventory_beer.edit"
  ],
  "beer.transactions.v1": [
    "inventory_beer.view",
    "inventory_beer.edit"
  ],
  "beer.snapshots.v1": [
    "inventory_beer.view",
    "inventory_beer.close"
  ],
  "ice.inv.items.v1": [
    "inventory_ice.view",
    "inventory_ice.edit"
  ],
  "ice.inv.tx.v1": [
    "inventory_ice.view",
    "inventory_ice.edit"
  ],
  "ice.inventory.v1": [
    "inventory_ice.view",
    "inventory_ice.close"
  ],
  "cocktail.iceSettings.v2": [
    "inventory_ice.view",
    "inventory_ice.manage"
  ],
  "equipment.inventory.v1": [
    "shop_equipment.view",
    "shop_equipment.edit"
  ],
  "supplier.match.memory.v1": [
    "suppliers.view",
    "suppliers.manage"
  ]
};

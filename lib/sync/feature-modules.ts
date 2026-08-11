/**
 * 功能模块定义（纯 TypeScript，无 React Native 依赖）
 *
 * 此文件被以下地方引用：
 * - app/role-settings.tsx（UI 层）
 * - app/device-manager.tsx（UI 层）
 * - tests/sync-permissions.test.ts（测试层）
 *
 * 规范：每次修改 lib/sync/engine.ts 中的 SYNC_KEYS 时，
 * 必须同步更新此文件中对应模块的 storageKeys。
 */

// ─── 功能模块定义（全覆盖 SYNC_KEYS 中所有 100 个键）─────────────────────────
export type FeatureKey =
  | "recipes"        // 配方库
  | "bottles"        // 酒款库
  | "homemade"       // 自制品
  | "lab"            // 研发室
  | "books"          // 书库
  | "menu"           // 门店酒单 + 套餐
  | "shopping"       // 采购清单
  | "wine"           // 葡萄酒库
  | "food"           // 餐食菜单
  | "spirits"        // 烈酒库存
  | "beer"           // 啤酒库存
  | "fruit"          // 水果库存
  | "ice"            // 冰块库存
  | "equipment"      // 器具库存
  | "store_ops"      // 门店运营（月报/备用金/库存管理）
  | "labor"          // 员工管理（排班/考勤/底薪）
  | "payroll"        // 薪资数据（薪资单/预支/全局设置）
  | "prefs";         // 偏好设置（收藏/评分/语言）

export interface FeatureModule {
  key: FeatureKey;
  labelZh: string;
  labelEn: string;
  icon: string;
  color: string;
  descZh: string;
  descEn: string;
  storageKeys: string[];
}

export const FEATURE_MODULES: FeatureModule[] = [
  {
    key: "recipes",
    labelZh: "配方库",
    labelEn: "Recipes",
    icon: "🍸",
    color: "#0A84FF",
    descZh: "配方、分类、标签、偏好",
    descEn: "Recipes, categories, tags, prefs",
    storageKeys: [
      "cocktail.recipes",
      "cocktail.categories",
      "cocktail.tags",
      "cocktail.tagGroups",
      "cocktail.categoryGroups",
      "cocktail.seeded",
      "cocktail_waldorf_imported_v1",
    ],
  },
  {
    key: "bottles",
    labelZh: "酒款库",
    labelEn: "Bottles",
    icon: "🍾",
    color: "#FF9500",
    descZh: "酒款信息、分类体系",
    descEn: "Bottle info, taxonomy",
    storageKeys: [
      "cocktail.bottles",
      "cocktail.bottles.seeded",
      "cocktail.bottles.waldorf.v1",
      "bottles.taxonomy.categories.v1",
      "bottles.taxonomy.styles.v1",
    ],
  },
  {
    key: "homemade",
    labelZh: "自制品",
    labelEn: "Homemade",
    icon: "🧪",
    color: "#34C759",
    descZh: "自制配料、分类、来源",
    descEn: "Homemade preps, categories, sources",
    storageKeys: [
      "homemade.preps.v1",
      "homemade.seeded.v1",
      "homemade.sections.v1",
      "homemade.types.v1",
      "homemade.taxonomy.v2",
      "homemade.waldorf.v1",
      "homemade.waldorf.v2",
      "homemade.source.v3",
    ],
  },
  {
    key: "lab",
    labelZh: "研发室",
    labelEn: "Lab",
    icon: "⚗️",
    color: "#5856D6",
    descZh: "研发项目、批次记录、研发计划",
    descEn: "Lab projects, batches, plans",
    storageKeys: ["cocktail.lab.projects", "cocktail.lab.batches", "lab.plan.v1"],
  },
  {
    key: "books",
    labelZh: "书库",
    labelEn: "Books",
    icon: "📚",
    color: "#FF2D55",
    descZh: "酒小课、EPUB 书籍",
    descEn: "Books and EPUB library",
    storageKeys: ["cocktail.books.v1"],
  },
  {
    key: "menu",
    labelZh: "门店酒单",
    labelEn: "Menu",
    icon: "🗒️",
    color: "#FF6B35",
    descZh: "酒单内容、套餐配置",
    descEn: "Menu items and packages",
    storageKeys: ["menu_store_v1", "menu.packages.v1"],
  },
  {
    key: "shopping",
    labelZh: "采购清单",
    labelEn: "Shopping",
    icon: "🛒",
    color: "#30B0C7",
    descZh: "采购项目列表",
    descEn: "Shopping list",
    storageKeys: ["shopping_store_v1"],
  },
  {
    key: "wine",
    labelZh: "葡萄酒库",
    labelEn: "Wine",
    icon: "🍷",
    color: "#9B59B6",
    descZh: "葡萄酒款、快照、采购记录",
    descEn: "Wine bottles, snapshots, purchases",
    storageKeys: ["wine.bottles.v1", "wine.snapshots.v2", "wine.manual_purchases.v1"],
  },
  {
    key: "food",
    labelZh: "餐食菜单",
    labelEn: "Food",
    icon: "🍽️",
    color: "#E67E22",
    descZh: "菜单、食材、采购记录",
    descEn: "Food menu, ingredients, purchases",
    storageKeys: ["food.menu.v1", "food.ingredients.v2", "food.purchases.v1"],
  },
  {
    key: "spirits",
    labelZh: "烈酒库存",
    labelEn: "Spirits Inventory",
    icon: "🥃",
    color: "#C0392B",
    descZh: "烈酒库存、采购、台账、供应商",
    descEn: "Spirits stock, purchases, ledger, suppliers",
    storageKeys: [
      "spirits.items.v3",
      "spirits.purchases.v3",
      "spirits.ledger.v3",
      "spirits.refPrices.v1",
      "spirits.suppliers.v1",
      "spirits.groups.v1",
      "spirits.matchMemory.v1",
      "spirits.selfBuyConfig.v1",
      "spirits.customCategories.v1",
      "spirits.groupMatchMemory.v1",
      "spirits.snapshots.v1",
      "spirits.match_records.v1",
      "supplier.match.memory.v1",
    ],
  },
  {
    key: "beer",
    labelZh: "啤酒库存",
    labelEn: "Beer Inventory",
    icon: "🍺",
    color: "#F39C12",
    descZh: "啤酒库存、交易记录、快照",
    descEn: "Beer stock, transactions, snapshots",
    storageKeys: ["beer.items.v1", "beer.transactions.v1", "beer.snapshots.v1"],
  },
  {
    key: "fruit",
    labelZh: "水果库存",
    labelEn: "Fruit Inventory",
    icon: "🍊",
    color: "#27AE60",
    descZh: "水果库存、交易记录、快照",
    descEn: "Fruit stock, transactions, snapshots",
    storageKeys: ["fruit.items.v1", "fruit.transactions.v1", "fruit.snapshots.v1"],
  },
  {
    key: "ice",
    labelZh: "冰块库存",
    labelEn: "Ice Inventory",
    icon: "❄️",
    color: "#3498DB",
    descZh: "冰块库存、冰泡设置、成本配置",
    descEn: "Ice inventory, bubble settings, cost config",
    storageKeys: ["ice.inv.items.v1", "ice.inv.tx.v1", "ice.inventory.v1", "cocktail.iceSettings.v2"],
  },
  {
    key: "equipment",
    labelZh: "器具库存",
    labelEn: "Equipment",
    icon: "🔧",
    color: "#7F8C8D",
    descZh: "器具设备清单",
    descEn: "Equipment inventory",
    storageKeys: ["equipment.inventory.v1"],
  },
  {
    key: "store_ops",
    labelZh: "门店运营",
    labelEn: "Store Operations",
    icon: "🏪",
    color: "#1ABC9C",
    descZh: "月报、备用金、供应商货款、库存管理、经营分析",
    descEn: "Monthly reports, petty cash, suppliers, inventory, analytics",
    storageKeys: [
      "store.revenue.v1",
      "store.petty.v1",
      "store.petty_categories.v1",
      "store.petty_inv_links.v1",
      "store.petty_labor_links.v1",
      "store.employee_name_aliases.v1",
      "store.inventory.v1",
      "monthly_summary.reports.v1",
      "monthly_summary.suppliers.v1",
      "monthly_summary.payments.v1",
      "monthly_summary.balances.v1",
      "monthly_summary.petty_configs.v1",
      "monthly_summary.inventory_configs.v1",
      "monthly_reports_v1",
      "period_analysis.reports.v1",
      "period_analysis.settings.v1",
      "schedule.business_hours.v1",
      "schedule.shift_templates.v1",
      "dish_analysis.snapshots.v1",
    ],
  },
  {
    key: "labor",
    labelZh: "员工管理",
    labelEn: "Staff Management",
    icon: "👥",
    color: "#2980B9",
    descZh: "员工档案、排班表、考勤记录、节假日配置",
    descEn: "Employees, shifts, attendance, holiday configs",
    storageKeys: [
      "labor_employees_v1",
      "labor_employee_groups_v1",
      "labor_shifts_v1",
      "labor_shift_templates_v1",
      "labor_attendance_v1",
      "labor_month_configs_v1",
      "labor_holiday_configs_v1",
      "labor_comp_off_v1",
      "labor_comp_off_entries_v1",
      "labor_holiday_comp_off_v1",
      "labor_unexplained_rest_alerts_v1",
      "labor_special_statuses_v1",
      "labor_custom_depts_v1",
      "labor_business_hours_v1",
      "labor_shift_groups_v1",
      "labor_fill_presets_v1",
    ],
  },
  {
    key: "payroll",
    labelZh: "薪资数据",
    labelEn: "Payroll",
    icon: "💰",
    color: "#E74C3C",
    descZh: "薪资单、月度归档、调整会话、预支记录、绩效模板、全局薪资设置",
    descEn: "Pay slips, advances, performance templates, global settings",
    storageKeys: [
      "labor_payslips_v1",
      "labor_month_close_archives_v1",
      "labor_month_adjustment_sessions_v1",
      "labor.salary_advances.v1",
      "labor.advance_categories.v1",
      "labor_performance_templates_v1",
      "labor_performance_records_v1",
      "labor_global_payroll_settings_v1",
    ],
  },
  {
    key: "prefs",
    labelZh: "偏好设置",
    labelEn: "Preferences",
    icon: "⭐",
    color: "#95A5A6",
    descZh: "收藏、评分、已制作、语言设置",
    descEn: "Favorites, ratings, made status, language",
    storageKeys: ["cocktail.prefs.v1", "app.lang.v1"],
  },
];

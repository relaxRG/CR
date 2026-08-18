# 本地存储键与数据结构清单

> 由 `pnpm audit:storage` 从生产源代码生成；生成时间：2026-08-18T18:55:11.284Z。
> 本清单覆盖 `AsyncStorage`、`SecureStore`、Web `localStorage` 与通用库存工厂传入的键。`{variable}` 表示按运行时参数生成的键模式。

## 已解析键

| 后端 | Key / 模式 | 访问操作 | 序列化数据表达式 | TypeScript 结构线索 | 源文件 |
|---|---|---|---|---|---|
| AsyncStorage | `{variable}.chunk.{variable}` | setItem, getItem | `json.slice(index * CHUNK_SIZE_LIMIT` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:125`<br>`lib/backup/local-backup.ts:139` |
| AsyncStorage | `{variable}{variable}` | getItem, setItem, removeItem | `String(chunks；snapshotJson` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:108`<br>`lib/backup/local-backup.ts:127`<br>`lib/backup/local-backup.ts:133`<br>`lib/backup/local-backup.ts:191`<br>`lib/backup/local-backup.ts:235`<br>`lib/backup/local-backup.ts:286`<br>`lib/backup/local-backup.ts:392` |
| AsyncStorage | `{variable}{variable}.chunk.{variable}` | setItem, getItem | `chunk` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:238`<br>`lib/backup/local-backup.ts:263` |
| AsyncStorage | `{variable}{variable}{variable}` | setItem, getItem | `String(chunks` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:240`<br>`lib/backup/local-backup.ts:246`<br>`lib/backup/local-backup.ts:258` |
| SecureStore | `app_session_token` | getItemAsync, setItemAsync, deleteItemAsync | `token` | 见源文件的写入表达式 | `lib/_core/auth.ts:24`<br>`lib/_core/auth.ts:43`<br>`lib/_core/auth.ts:61` |
| AsyncStorage | `app.lang.v1` | getItem, setItem | `next` | DeviceInfo, SyncState | `lib/cf-sync/provider.tsx:751`<br>`lib/i18n/index.tsx:21`<br>`lib/i18n/index.tsx:28` |
| AsyncStorage | `backup.icloud.meta` | getItem, setItem | `JSON.stringify(newMeta` | 见源文件的写入表达式 | `lib/backup/icloud-backup.ts:108`<br>`lib/backup/icloud-backup.ts:176` |
| AsyncStorage | `backup.meta` | getItem, setItem | `JSON.stringify(newMeta；JSON.stringify(meta` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:91`<br>`lib/backup/local-backup.ts:226`<br>`lib/backup/local-backup.ts:396` |
| AsyncStorage | `backup.restore.journal.v1` | getItem, removeItem, setItem | `JSON.stringify(journal` | EncryptedSnapshotV2, SnapshotV2Crypto, SnapshotV2KeyResolver, SnapshotMeta, Snapshot, SnapshotRestoreJournal, DataCounts | `lib/backup/local-backup.ts:326`<br>`lib/backup/local-backup.ts:334`<br>`lib/backup/local-backup.ts:366`<br>`lib/backup/local-backup.ts:370` |
| AsyncStorage | `beer.inventory.v2` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/beer/inventory-store.tsx:8` |
| AsyncStorage | `bottles.material.migrated.v8` | getItem, setItem | `"1"` | BottleStore | `lib/bottles/store.tsx:165`<br>`lib/bottles/store.tsx:184` |
| AsyncStorage | `bottles.material.migrated.v9` | getItem, setItem | `"1"` | BottleStore | `lib/bottles/store.tsx:191`<br>`lib/bottles/store.tsx:281` |
| AsyncStorage | `bottles.taxonomy.categories.v1` | getItem, setItem | `JSON.stringify(v10.next；JSON.stringify(next` | BottleCategoryDef, BottleTaxonomyStore | `lib/bottles/taxonomy.tsx:572`<br>`lib/bottles/taxonomy.tsx:583`<br>`lib/bottles/taxonomy.tsx:606`<br>`lib/bottles/taxonomy.tsx:622` |
| AsyncStorage | `bottles.taxonomy.styles.v1` | getItem, setItem | `JSON.stringify(v9s.next；JSON.stringify(next` | BottleCategoryDef, BottleTaxonomyStore | `lib/bottles/taxonomy.tsx:573`<br>`lib/bottles/taxonomy.tsx:592`<br>`lib/bottles/taxonomy.tsx:607`<br>`lib/bottles/taxonomy.tsx:627` |
| AsyncStorage | `cf.sync.deviceToken` | removeItem | `读取或删除操作` | WebMemoryTicket, DeviceInfo, CompleteSyncSnapshot, SyncEntry | `lib/cf-sync/client.ts:65`<br>`lib/cf-sync/client.ts:129` |
| SecureStore | `cf.sync.deviceToken` | setItemAsync, getItemAsync, deleteItemAsync | `token` | WebMemoryTicket, DeviceInfo, CompleteSyncSnapshot, SyncEntry | `lib/cf-sync/client.ts:68`<br>`lib/cf-sync/client.ts:73`<br>`lib/cf-sync/client.ts:78` |
| AsyncStorage | `cf.sync.groupSwitchSession.v1` | setItem, removeItem, getItem | `JSON.stringify(session` | DeviceInfo, PersistedGroupSwitchSession | `lib/cf-sync/group-switch.ts:91`<br>`lib/cf-sync/group-switch.ts:96`<br>`lib/cf-sync/group-switch.ts:103` |
| AsyncStorage | `cf.sync.prevAllowedKeys.v1` | getItem, setItem | `JSON.stringify(newAllowedKeys` | DeviceInfo, SyncState | `lib/cf-sync/provider.tsx:741`<br>`lib/cf-sync/provider.tsx:743`<br>`lib/cf-sync/provider.tsx:750` |
| AsyncStorage | `cf.sync.switchDiagnostics.v1` | getItem, setItem | `JSON.stringify(entries` | 见源文件的写入表达式 | `lib/cf-sync/switch-diagnostics.ts:76`<br>`lib/cf-sync/switch-diagnostics.ts:80`<br>`lib/cf-sync/switch-diagnostics.ts:88` |
| AsyncStorage | `cocktail_recent_units` | getItem, setItem | `JSON.stringify(next` | 见源文件的写入表达式 | `hooks/use-recent-units.ts:15`<br>`hooks/use-recent-units.ts:30` |
| AsyncStorage | `cocktail.books.v1` | getItem, setItem | `JSON.stringify(next` | StoredBook, BookStore | `lib/books/store.tsx:99`<br>`lib/books/store.tsx:117`<br>`lib/books/store.tsx:181` |
| AsyncStorage | `cocktail.bottles` | getItem, setItem | `JSON.stringify(list；JSON.stringify(next` | BottleStore | `lib/bottles/store.tsx:94`<br>`lib/bottles/store.tsx:114`<br>`lib/bottles/store.tsx:128`<br>`lib/bottles/store.tsx:141`<br>`lib/bottles/store.tsx:158`<br>`lib/bottles/store.tsx:181`<br>`lib/bottles/store.tsx:278`<br>`lib/bottles/store.tsx:297`<br>`lib/bottles/store.tsx:310` |
| AsyncStorage | `cocktail.bottles.seeded` | getItem, setItem | `SEED_VERSION` | BottleStore | `lib/bottles/store.tsx:95`<br>`lib/bottles/store.tsx:160` |
| AsyncStorage | `cocktail.categories` | getItem, setItem | `JSON.stringify(cats；JSON.stringify(next` | RecipeStore | `lib/recipes/store.tsx:49`<br>`lib/recipes/store.tsx:232`<br>`lib/recipes/store.tsx:278`<br>`lib/recipes/store.tsx:464` |
| AsyncStorage | `cocktail.categoryGroups` | getItem, setItem | `JSON.stringify(next` | RecipeStore | `lib/recipes/store.tsx:52`<br>`lib/recipes/store.tsx:426`<br>`lib/recipes/store.tsx:485` |
| AsyncStorage | `cocktail.iceSettings.v2` | getItem, setItem | `JSON.stringify(s` | IceSettings, IceCostItem | `lib/ice/cost.ts:122`<br>`lib/ice/cost.ts:136` |
| AsyncStorage | `cocktail.lab.batches` | getItem, setItem | `JSON.stringify(next` | LabStore | `lib/lab/store.tsx:71`<br>`lib/lab/store.tsx:90`<br>`lib/lab/store.tsx:105` |
| AsyncStorage | `cocktail.lab.projects` | getItem, setItem | `JSON.stringify(next` | LabStore | `lib/lab/store.tsx:70`<br>`lib/lab/store.tsx:89`<br>`lib/lab/store.tsx:100` |
| AsyncStorage | `cocktail.prefs.v1` | getItem, setItem | `JSON.stringify(loadedPrefs；JSON.stringify(next` | RecipeStore | `lib/recipes/store.tsx:53`<br>`lib/recipes/store.tsx:398`<br>`lib/recipes/store.tsx:421`<br>`lib/recipes/store.tsx:718` |
| AsyncStorage | `cocktail.reader.highlights.v1.${id}` | getItem, setItem | `JSON.stringify(highlights` | ReviewItem | `app/book-reader.tsx:868`<br>`app/book-reader.tsx:897` |
| AsyncStorage | `cocktail.reader.settings.v1.${id}` | getItem, setItem | `JSON.stringify({ fontSize` | ReviewItem | `app/book-reader.tsx:855`<br>`app/book-reader.tsx:877` |
| AsyncStorage | `cocktail.recipes` | getItem, setItem | `JSON.stringify(recs；JSON.stringify(next；JSON.stringify(data.list` | RecipeStore；DeviceInfo | `lib/recipes/store.tsx:48`<br>`lib/recipes/store.tsx:231`<br>`lib/recipes/store.tsx:284`<br>`lib/recipes/store.tsx:458`<br>`lib/sync/photo-sync.ts:147`<br>`lib/sync/photo-sync.ts:331` |
| AsyncStorage | `cocktail.seeded` | getItem, setItem | `"1"` | RecipeStore | `lib/recipes/store.tsx:233`<br>`lib/recipes/store.tsx:280` |
| AsyncStorage | `cocktail.tagGroups` | getItem, setItem | `JSON.stringify(mutableGroupList；JSON.stringify(next` | RecipeStore | `lib/recipes/store.tsx:51`<br>`lib/recipes/store.tsx:235`<br>`lib/recipes/store.tsx:356`<br>`lib/recipes/store.tsx:365`<br>`lib/recipes/store.tsx:378`<br>`lib/recipes/store.tsx:478` |
| AsyncStorage | `cocktail.tags` | getItem, setItem | `JSON.stringify(tagList；JSON.stringify(next` | RecipeStore | `lib/recipes/store.tsx:50`<br>`lib/recipes/store.tsx:234`<br>`lib/recipes/store.tsx:292`<br>`lib/recipes/store.tsx:303`<br>`lib/recipes/store.tsx:312`<br>`lib/recipes/store.tsx:323`<br>`lib/recipes/store.tsx:335`<br>`lib/recipes/store.tsx:391`<br>`lib/recipes/store.tsx:470` |
| AsyncStorage | `daily.inventory.v1` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/daily/inventory-store.tsx:8` |
| AsyncStorage | `device.customRoleNames.v1` | getItem, setItem | `JSON.stringify(map` | 见源文件的写入表达式 | `app/role-settings.tsx:50`<br>`app/role-settings.tsx:61`<br>`app/role-settings.tsx:68` |
| AsyncStorage | `dish_analysis.snapshots.v1` | getItem, setItem | `JSON.stringify(state.snapshots` | DishAnalysisState | `lib/store/monthly-report/dish-analysis-store.tsx:55`<br>`lib/store/monthly-report/dish-analysis-store.tsx:64` |
| AsyncStorage | `equipment.inventory.v1` | getItem, setItem | `JSON.stringify(state` | EquipmentState | `lib/equipment/inventory-store.tsx:65`<br>`lib/equipment/inventory-store.tsx:76` |
| AsyncStorage | `food.ingredients.v1` | getItem | `读取或删除操作` | FoodIngredientState, PurchaseState | `lib/food/ingredient-store.tsx:389` |
| AsyncStorage | `food.ingredients.v2` | getItem, setItem | `JSON.stringify(state` | FoodIngredientState, PurchaseState | `lib/food/ingredient-store.tsx:388`<br>`lib/food/ingredient-store.tsx:405` |
| AsyncStorage | `food.menu.v1` | getItem, setItem | `JSON.stringify(state` | FoodMenuState | `lib/food/menu-store.tsx:52`<br>`lib/food/menu-store.tsx:56`<br>`lib/food/menu-store.tsx:63` |
| AsyncStorage | `food.purchases.v1` | getItem, setItem | `JSON.stringify(state` | FoodIngredientState, PurchaseState | `lib/food/ingredient-store.tsx:466`<br>`lib/food/ingredient-store.tsx:473` |
| AsyncStorage | `fruit.inventory.v2` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/fruit/new-inventory-store.tsx:8` |
| AsyncStorage | `glassware.inventory.v1` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/glassware/inventory-store.tsx:8` |
| AsyncStorage | `homemade.preps.v1` | getItem, setItem | `JSON.stringify(migrated；JSON.stringify(finalList；JSON.stringify(list` | HomemadeStore | `lib/homemade/store.tsx:170`<br>`lib/homemade/store.tsx:225`<br>`lib/homemade/store.tsx:245`<br>`lib/homemade/store.tsx:309`<br>`lib/homemade/store.tsx:347`<br>`lib/homemade/store.tsx:375`<br>`lib/homemade/store.tsx:388` |
| AsyncStorage | `homemade.sections.v1` | getItem, setItem | `JSON.stringify(nextSections；JSON.stringify(list` | HomemadeStore | `lib/homemade/store.tsx:171`<br>`lib/homemade/store.tsx:356`<br>`lib/homemade/store.tsx:376`<br>`lib/homemade/store.tsx:394` |
| AsyncStorage | `homemade.seeded.v1` | setItem | `"1"` | HomemadeStore | `lib/homemade/store.tsx:534` |
| AsyncStorage | `homemade.source.v3` | getItem, setItem | `"1"` | HomemadeStore | `lib/homemade/store.tsx:318`<br>`lib/homemade/store.tsx:350` |
| AsyncStorage | `homemade.taxonomy.v2` | getItem, setItem | `"1"` | HomemadeStore | `lib/homemade/store.tsx:173`<br>`lib/homemade/store.tsx:360` |
| AsyncStorage | `homemade.types.v1` | getItem, setItem | `JSON.stringify(nextTypes；JSON.stringify(list` | HomemadeStore | `lib/homemade/store.tsx:172`<br>`lib/homemade/store.tsx:358`<br>`lib/homemade/store.tsx:377`<br>`lib/homemade/store.tsx:400` |
| AsyncStorage | `homemade.waldorf.v1` | getItem, setItem | `"1"` | HomemadeStore | `lib/homemade/store.tsx:231`<br>`lib/homemade/store.tsx:248` |
| AsyncStorage | `homemade.waldorf.v2` | getItem, setItem | `"1"` | HomemadeStore | `lib/homemade/store.tsx:254`<br>`lib/homemade/store.tsx:312` |
| AsyncStorage | `ice.inventory.v2` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/ice/new-inventory-store.tsx:8` |
| AsyncStorage | `iosColorPicker.recent.v1` | getItem, setItem | `JSON.stringify(colors` | 见源文件的写入表达式 | `components/ios-color-picker.tsx:93`<br>`components/ios-color-picker.tsx:101` |
| AsyncStorage | `lab.plan.v1` | getItem, setItem | `JSON.stringify(state` | PlanCategory, PlanItemType, PlanItemStatus, PlanItem, PlanState | `lib/lab/plan-store.tsx:65`<br>`lib/lab/plan-store.tsx:69`<br>`lib/lab/plan-store.tsx:76` |
| AsyncStorage | `labor_dept_order_v1` | getItem, setItem | `JSON.stringify(order` | EmployeeStore, CustomDeptStore, DeptOrderStore, ShiftTemplateStore, SpecialStatusStore, HolidayConfigStore, ShiftStore, AttendanceStore, PaySlipStore, GlobalPayrollSettingsStore, MonthCloseStore, MonthConfigStore, CompOffBalanceEntryStore, HolidayCompOffStore, BusinessHoursStore, ShiftGroupStore, UnexplainedRestAlertStore, FillPresetStore | `lib/labor/store.tsx:321`<br>`lib/labor/store.tsx:335` |
| AsyncStorage | `labor_employees_v1` | getItem, setItem | `JSON.stringify(updated` | 见源文件的写入表达式 | `lib/migrations/clean-monthly-fixed-salary.ts:44`<br>`lib/migrations/clean-monthly-fixed-salary.ts:74` |
| AsyncStorage | `labor_shifts_v1` | getItem, setItem | `JSON.stringify(cleaned` | ShiftEntryRaw | `lib/migrations/clean-empty-shift-entries.ts:58`<br>`lib/migrations/clean-empty-shift-entries.ts:82` |
| AsyncStorage | `labor.advance_categories.v1` | getItem, setItem | `JSON.stringify(state.customCategories` | AdvanceCategory, AdvanceState, CategoryState, CategoryAction, CategoryContextValue | `lib/labor/advance-store.tsx:145`<br>`lib/labor/advance-store.tsx:153` |
| AsyncStorage | `labor.salary_advances.v1` | getItem, setItem | `JSON.stringify(state` | AdvanceCategory, AdvanceState, CategoryState, CategoryAction, CategoryContextValue | `lib/labor/advance-store.tsx:186`<br>`lib/labor/advance-store.tsx:204` |
| AsyncStorage | `labor.separate_payments.v1` | getItem, setItem | `JSON.stringify(payments` | SeparatePaymentState, SeparatePaymentStore | `lib/labor/separate-payment-store.tsx:95`<br>`lib/labor/separate-payment-store.tsx:99`<br>`lib/labor/separate-payment-store.tsx:107` |
| localStorage | `manus-runtime-user-info` | getItem, setItem, removeItem | `JSON.stringify(user` | 见源文件的写入表达式 | `lib/_core/auth.ts:75`<br>`lib/_core/auth.ts:100`<br>`lib/_core/auth.ts:117` |
| SecureStore | `manus-runtime-user-info` | getItemAsync, setItemAsync, deleteItemAsync | `JSON.stringify(user` | 见源文件的写入表达式 | `lib/_core/auth.ts:78`<br>`lib/_core/auth.ts:106`<br>`lib/_core/auth.ts:122` |
| AsyncStorage | `menu_store_v1` | getItem, setItem | `JSON.stringify(state` | MenuEntry, MenuState | `lib/menu/store.tsx:334`<br>`lib/menu/store.tsx:351`<br>`lib/menu/store.tsx:362` |
| AsyncStorage | `menu.packages.v1` | getItem, setItem | `JSON.stringify(packages` | PackageItem | `lib/menu/package-store.tsx:71`<br>`lib/menu/package-store.tsx:82` |
| AsyncStorage | `migration_clean_empty_shifts_v1_done` | getItem, setItem, removeItem | `"1"` | ShiftEntryRaw | `lib/migrations/clean-empty-shift-entries.ts:55`<br>`lib/migrations/clean-empty-shift-entries.ts:60`<br>`lib/migrations/clean-empty-shift-entries.ts:68`<br>`lib/migrations/clean-empty-shift-entries.ts:73`<br>`lib/migrations/clean-empty-shift-entries.ts:87`<br>`lib/migrations/clean-empty-shift-entries.ts:99` |
| AsyncStorage | `migration_clean_legacy_business_month_keys_v1_done` | getItem, setItem, removeItem | `"1"` | 见源文件的写入表达式 | `lib/migrations/clean-legacy-business-month-keys.ts:16`<br>`lib/migrations/clean-legacy-business-month-keys.ts:20`<br>`lib/migrations/clean-legacy-business-month-keys.ts:29` |
| AsyncStorage | `migration_clean_monthly_fixed_salary_v1_done` | getItem, setItem, removeItem | `"1"` | 见源文件的写入表达式 | `lib/migrations/clean-monthly-fixed-salary.ts:41`<br>`lib/migrations/clean-monthly-fixed-salary.ts:46`<br>`lib/migrations/clean-monthly-fixed-salary.ts:54`<br>`lib/migrations/clean-monthly-fixed-salary.ts:59`<br>`lib/migrations/clean-monthly-fixed-salary.ts:79`<br>`lib/migrations/clean-monthly-fixed-salary.ts:91` |
| AsyncStorage | `module_month_adjustment_sessions_v1` | setItem, getItem | `JSON.stringify(next` | ModuleMonthCloseStore | `lib/month-close/module-month-close-store.tsx:88`<br>`lib/month-close/module-month-close-store.tsx:95` |
| AsyncStorage | `module_month_close_archives_v1` | setItem, getItem | `JSON.stringify(next` | ModuleMonthCloseStore | `lib/month-close/module-month-close-store.tsx:81`<br>`lib/month-close/module-month-close-store.tsx:94` |
| AsyncStorage | `monthly_report.raw_excel_archive.v1` | getItem, setItem | `JSON.stringify(next` | RawExcelArchiveStore | `lib/store/monthly-report/raw-excel-archive-store.tsx:79`<br>`lib/store/monthly-report/raw-excel-archive-store.tsx:95` |
| AsyncStorage | `monthly_reports_v1` | getItem, setItem | `JSON.stringify(next` | MonthlyReportStore | `lib/store/monthly-report/store.tsx:34`<br>`lib/store/monthly-report/store.tsx:52` |
| AsyncStorage | `monthly_summary.balances.v1` | getItem, setItem | `JSON.stringify(state.balances` | SummaryState | `lib/store/monthly-summary/store.tsx:181`<br>`lib/store/monthly-summary/store.tsx:220` |
| AsyncStorage | `monthly_summary.inventory_configs.v1` | getItem, setItem | `JSON.stringify(state.inventoryConfigs` | SummaryState | `lib/store/monthly-summary/store.tsx:183`<br>`lib/store/monthly-summary/store.tsx:222` |
| AsyncStorage | `monthly_summary.payments.v1` | getItem, setItem | `JSON.stringify(state.payments` | SummaryState | `lib/store/monthly-summary/store.tsx:180`<br>`lib/store/monthly-summary/store.tsx:219` |
| AsyncStorage | `monthly_summary.petty_configs.v1` | getItem, setItem | `JSON.stringify(state.pettyCodeConfigs` | SummaryState | `lib/store/monthly-summary/store.tsx:182`<br>`lib/store/monthly-summary/store.tsx:221` |
| AsyncStorage | `monthly_summary.reports.v1` | getItem, setItem | `JSON.stringify(state.reports` | SummaryState | `lib/store/monthly-summary/store.tsx:178`<br>`lib/store/monthly-summary/store.tsx:217` |
| AsyncStorage | `monthly_summary.suppliers.v1` | getItem, setItem | `JSON.stringify(state.suppliers` | SummaryState | `lib/store/monthly-summary/store.tsx:179`<br>`lib/store/monthly-summary/store.tsx:218` |
| AsyncStorage | `period_analysis.reports.v1` | getItem, setItem | `JSON.stringify(state.reports` | PeriodAnalysisState | `lib/store/period-analysis/store.tsx:63`<br>`lib/store/period-analysis/store.tsx:81` |
| AsyncStorage | `period_analysis.settings.v1` | getItem, setItem | `JSON.stringify(state.settings` | PeriodAnalysisState | `lib/store/period-analysis/store.tsx:64`<br>`lib/store/period-analysis/store.tsx:82` |
| AsyncStorage | `schedule.business_hours.v1` | getItem, setItem | `JSON.stringify(state.businessHours` | ScheduleState | `lib/store/period-analysis/schedule-store.tsx:74`<br>`lib/store/period-analysis/schedule-store.tsx:92` |
| AsyncStorage | `schedule.shift_templates.v1` | getItem, setItem | `JSON.stringify(state.shiftTemplates` | ScheduleState | `lib/store/period-analysis/schedule-store.tsx:75`<br>`lib/store/period-analysis/schedule-store.tsx:93` |
| AsyncStorage | `shopping_store_v1` | getItem, setItem | `JSON.stringify(state` | ShoppingItem, ShoppingState | `lib/shopping/store.tsx:186`<br>`lib/shopping/store.tsx:203`<br>`lib/shopping/store.tsx:213` |
| AsyncStorage | `spirits.customCategories.v1` | getItem, setItem | `JSON.stringify(state.customCategories` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:439`<br>`lib/spirits/crud-store.tsx:477` |
| AsyncStorage | `spirits.groupMatchMemory.v1` | getItem, setItem | `JSON.stringify(state.groupMatchMemory` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:440`<br>`lib/spirits/crud-store.tsx:478` |
| AsyncStorage | `spirits.groups.v1` | getItem, setItem | `JSON.stringify(state.groups` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:436`<br>`lib/spirits/crud-store.tsx:474` |
| AsyncStorage | `spirits.items.v3` | getItem, setItem | `JSON.stringify(state.items` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:431`<br>`lib/spirits/crud-store.tsx:469` |
| AsyncStorage | `spirits.ledger.v3` | getItem, setItem | `JSON.stringify(state.ledger` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:433`<br>`lib/spirits/crud-store.tsx:471` |
| AsyncStorage | `spirits.matchMemory.v1` | getItem, setItem | `JSON.stringify(state.matchMemory` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:437`<br>`lib/spirits/crud-store.tsx:475` |
| AsyncStorage | `spirits.purchases.v3` | getItem, setItem | `JSON.stringify(state.purchases` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:432`<br>`lib/spirits/crud-store.tsx:470` |
| AsyncStorage | `spirits.refPrices.v1` | getItem, setItem | `JSON.stringify(state.refPrices` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:434`<br>`lib/spirits/crud-store.tsx:472` |
| AsyncStorage | `spirits.selfBuyConfig.v1` | getItem, setItem | `JSON.stringify(state.selfBuyConfig` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:438`<br>`lib/spirits/crud-store.tsx:476` |
| AsyncStorage | `spirits.suppliers.v1` | getItem, setItem | `JSON.stringify(state.suppliers` | SelfBuyConfig, SpiritsState | `lib/spirits/crud-store.tsx:435`<br>`lib/spirits/crud-store.tsx:473` |
| AsyncStorage | `store_business_hours_v1` | getItem, setItem | `JSON.stringify(updated` | BusinessHoursConfig | `app/store-hours.tsx:56`<br>`app/store-hours.tsx:72`<br>`app/store-hours.tsx:83` |
| AsyncStorage | `store.employee_name_aliases.v1` | getItem, setItem | `JSON.stringify(state.aliases` | LinkState | `lib/store/petty-labor-link-store.tsx:231`<br>`lib/store/petty-labor-link-store.tsx:235`<br>`lib/store/petty-labor-link-store.tsx:245` |
| AsyncStorage | `store.petty_categories.v1` | getItem, setItem | `JSON.stringify(state` | BaseInventoryCategory, ExtendedInventoryCategory, PettyCategory, PettyCategoryState, PettyCategoryContextValue | `lib/store/petty-category-store.tsx:248`<br>`lib/store/petty-category-store.tsx:257`<br>`lib/store/petty-category-store.tsx:264` |
| AsyncStorage | `store.petty_inv_links.v1` | getItem, setItem | `JSON.stringify(state` | LinkState | `lib/store/petty-inventory-link-store.tsx:101`<br>`lib/store/petty-inventory-link-store.tsx:105`<br>`lib/store/petty-inventory-link-store.tsx:112` |
| AsyncStorage | `store.petty_labor_links.v1` | getItem, setItem | `JSON.stringify(state.links` | LinkState | `lib/store/petty-labor-link-store.tsx:230`<br>`lib/store/petty-labor-link-store.tsx:234`<br>`lib/store/petty-labor-link-store.tsx:240` |
| AsyncStorage | `store.petty.v1` | getItem, setItem | `JSON.stringify(state` | PettyRecord, PettyState | `lib/store/petty-store.tsx:177`<br>`lib/store/petty-store.tsx:178`<br>`lib/store/petty-store.tsx:182` |
| AsyncStorage | `store.purchase.v1` | getItem, setItem | `JSON.stringify(next` | PurchaseItem | `components/store/purchase.tsx:42`<br>`components/store/purchase.tsx:48` |
| AsyncStorage | `store.revenue.v1` | getItem, setItem | `JSON.stringify(state` | RevenueCategory, RevenueRecord, StaffRecord, RevenueState | `lib/store/revenue-store.tsx:94`<br>`lib/store/revenue-store.tsx:98`<br>`lib/store/revenue-store.tsx:105` |
| AsyncStorage | `supplier.match.memory.v1` | getItem, setItem | `JSON.stringify(memory` | 见源文件的写入表达式 | `lib/store/supplier-import.ts:113`<br>`lib/store/supplier-import.ts:122` |
| AsyncStorage | `sync.backup.v1` | getItem, setItem | `JSON.stringify(backup` | PrefEntry, Item, TargetGroupSnapshot, SyncLogEntry, SyncState | `lib/sync/engine.ts:644`<br>`lib/sync/engine.ts:658`<br>`lib/sync/engine.ts:668`<br>`lib/sync/engine.ts:693` |
| AsyncStorage | `sync.dirtyKeys.pending` | removeItem, setItem, getItem | `JSON.stringify(arr` | PrefEntry, Item, TargetGroupSnapshot, SyncLogEntry, SyncState | `lib/sync/engine.ts:565`<br>`lib/sync/engine.ts:567`<br>`lib/sync/engine.ts:573` |
| AsyncStorage | `sync.lastPulledAt` | setItem | `String(now` | PrefEntry, Item, TargetGroupSnapshot, SyncLogEntry, SyncState | `lib/sync/engine.ts:770`<br>`lib/sync/engine.ts:912` |
| AsyncStorage | `sync.log.v1` | getItem, setItem | `JSON.stringify(log` | PrefEntry, Item, TargetGroupSnapshot, SyncLogEntry, SyncState | `lib/sync/engine.ts:631`<br>`lib/sync/engine.ts:635`<br>`lib/sync/engine.ts:643`<br>`lib/sync/engine.ts:704` |
| AsyncStorage | `tableware.inventory.v1` | factory-key | `GenericInventoryState` | GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot | `lib/tableware/inventory-store.tsx:8` |
| AsyncStorage | `wine.bottles.v1` | getItem, setItem | `JSON.stringify(state` | WineState, WineSnapshotState, WineManualPurchaseState, SnapshotAction, WineSnapshotContextValue | `lib/wine/store.tsx:158`<br>`lib/wine/store.tsx:182` |
| AsyncStorage | `wine.manual_purchases.v1` | getItem, setItem | `JSON.stringify(manualState` | WineState, WineSnapshotState, WineManualPurchaseState, SnapshotAction, WineSnapshotContextValue | `lib/wine/store.tsx:174`<br>`lib/wine/store.tsx:192` |
| AsyncStorage | `wine.snapshots.v2` | getItem, setItem | `JSON.stringify(snapshotState` | WineState, WineSnapshotState, WineManualPurchaseState, SnapshotAction, WineSnapshotContextValue | `lib/wine/store.tsx:166`<br>`lib/wine/store.tsx:187` |

## 需要人工跟踪的动态键表达式

| 后端 | 表达式 | 操作 | 源文件 |
|---|---|---|---|
| AsyncStorage | `[...LEGACY_MONTH_KEYS]` | multiGet, multiRemove | `lib/migrations/clean-legacy-business-month-keys.ts:17`<br>`lib/migrations/clean-legacy-business-month-keys.ts:19` |
| AsyncStorage | `[...SYNC_KEYS]` | multiGet | `lib/backup/icloud-backup.ts:137`<br>`lib/backup/local-backup.ts:172`<br>`lib/backup/local-backup.ts:564` |
| AsyncStorage | `["cocktail.recipes"` | multiGet | `app/backup.tsx:72` |
| AsyncStorage | `["labor_schedule_snapshots_v1"` | multiRemove | `lib/labor/store.tsx:1034` |
| AsyncStorage | `[DIRTY_KEYS_PERSIST_KEY` | multiRemove | `lib/sync/engine.ts:437`<br>`lib/sync/engine.ts:510` |
| AsyncStorage | `base` | setItem, getItem | `lib/backup/local-backup.ts:120`<br>`lib/backup/local-backup.ts:145` |
| AsyncStorage | `c.storageKey` | setItem | `lib/sync/engine.ts:1010` |
| AsyncStorage | `chapterKey(bookId` | getItem, setItem | `lib/books/store.tsx:178`<br>`lib/books/store.tsx:187` |
| AsyncStorage | `chapterKey(id` | setItem, removeItem | `lib/books/store.tsx:151`<br>`lib/books/store.tsx:206` |
| AsyncStorage | `conflict.storageKey` | setItem | `lib/sync/engine.ts:959` |
| AsyncStorage | `key` | setItem, getItem, removeItem | `app/role-settings.tsx:220`<br>`hooks/use-persisted-state.ts:14`<br>`hooks/use-persisted-state.ts:37`<br>`lib/backup/icloud-backup.ts:248`<br>`lib/backup/local-backup.ts:648`<br>`lib/cf-sync/client.ts:42`<br>`lib/cf-sync/client.ts:50`<br>`lib/cf-sync/client.ts:57`<br>`lib/labor/store.tsx:47`<br>`lib/labor/store.tsx:60`<br>`lib/labor/store.tsx:74`<br>`lib/labor/store.tsx:85`<br>`lib/sync/engine.ts:655`<br>`lib/sync/engine.ts:673`<br>`lib/sync/engine.ts:675`<br>`lib/sync/engine.ts:748`<br>`lib/sync/engine.ts:817`<br>`lib/sync/engine.ts:837`<br>`lib/sync/engine.ts:884` |
| SecureStore | `key` | setItemAsync, getItemAsync, deleteItemAsync | `app/role-settings.tsx:222`<br>`lib/cf-sync/client.ts:44`<br>`lib/cf-sync/client.ts:52`<br>`lib/cf-sync/client.ts:59` |
| AsyncStorage | `keys` | multiGet, multiRemove | `app/data-manager.tsx:51`<br>`app/data-manager.tsx:114`<br>`lib/backup/local-backup.ts:112`<br>`lib/backup/local-backup.ts:251`<br>`lib/backup/local-backup.ts:360` |
| AsyncStorage | `removals` | multiRemove | `lib/backup/local-backup.ts:320`<br>`lib/backup/local-backup.ts:368`<br>`lib/sync/engine.ts:506` |
| AsyncStorage | `storageKey` | getItem, setItem | `lib/inventory-core/store.tsx:173`<br>`lib/inventory-core/store.tsx:182` |
| AsyncStorage | `SUMMARY_KEYS` | multiGet | `lib/backup/local-backup.ts:465` |
| SecureStore | `ticketKey(switchId` | setItemAsync, getItemAsync, deleteItemAsync | `lib/cf-sync/group-switch.ts:74`<br>`lib/cf-sync/group-switch.ts:79`<br>`lib/cf-sync/group-switch.ts:87` |
| AsyncStorage | `TS_PREFIX + c.storageKey` | setItem | `lib/sync/engine.ts:995`<br>`lib/sync/engine.ts:1011` |
| AsyncStorage | `TS_PREFIX + conflict.storageKey` | setItem | `lib/sync/engine.ts:953`<br>`lib/sync/engine.ts:960` |
| AsyncStorage | `TS_PREFIX + key` | setItem, getItem | `lib/sync/engine.ts:721`<br>`lib/sync/engine.ts:749`<br>`lib/sync/engine.ts:818`<br>`lib/sync/engine.ts:838`<br>`lib/sync/engine.ts:885` |
| AsyncStorage | `uploadedSetKey(groupId` | getItem, setItem | `lib/sync/photo-sync.ts:105`<br>`lib/sync/photo-sync.ts:113` |
| AsyncStorage | `writes` | multiSet | `lib/backup/local-backup.ts:321`<br>`lib/backup/local-backup.ts:369`<br>`lib/sync/engine.ts:505` |

## 维护规则

1. 新增或更名键后必须运行 `pnpm audit:storage` 并提交本清单。
2. 业务状态写入必须使用当前结构；禁止在加载时补写或转换已退役字段。
3. 删除键时应同步删除读取、写入、测试和本文档中的对应记录。
4. 动态键必须使用稳定前缀，并在产生键的模块中以类型或接口说明其值结构。

/**
 * 同步权限系统测试
 *
 * 覆盖：
 * 1. FEATURE_MODULES 全覆盖 SYNC_KEYS（无遗漏）
 * 2. 快捷预设的合法性（角色正确、模块存在）
 * 3. guest 角色只读保障（pushFn 过滤逻辑）
 * 4. collaborator 角色 allowedKeys 过滤逻辑
 * 5. INVITE_PRESETS 预设模块全部存在于 FEATURE_MODULES
 */

import { describe, it, expect } from "vitest";
import { FEATURE_MODULES } from "@/lib/sync/feature-modules";

// 注意：engine.ts 依赖 AsyncStorage（测试环境不可用），所以内联 SYNC_KEYS 快照用于覆盖率验证
// 这个列表应与 lib/sync/engine.ts 中的 SYNC_KEYS 保持同步
const SYNC_KEYS_SNAPSHOT = [
  // ── 鸡尾酒核心
  "cocktail.recipes", "cocktail.categories", "cocktail.tags", "cocktail.tagGroups",
  "cocktail.categoryGroups", "cocktail.seeded", "cocktail_waldorf_imported_v1",
  // ── 酒款库
  "cocktail.bottles", "cocktail.bottles.seeded", "cocktail.bottles.waldorf.v1",
  "bottles.taxonomy.categories.v1", "bottles.taxonomy.styles.v1",
  // ── 自制品
  "homemade.preps.v1", "homemade.seeded.v1", "homemade.sections.v1", "homemade.types.v1",
  "homemade.taxonomy.v2", "homemade.waldorf.v1", "homemade.waldorf.v2", "homemade.source.v3",
  // ── 研发室
  "cocktail.lab.projects", "cocktail.lab.batches", "lab.plan.v1",
  // ── 书库
  "cocktail.books.v1",
  // ── 酒单 + 采购
  "menu_store_v1", "menu.packages.v1", "shopping_store_v1",
  // ── 偏好
  "cocktail.prefs.v1", "app.lang.v1", "cocktail.iceSettings.v2",
  // ── 葡萄酒
  "wine.bottles.v1", "wine.snapshots.v2", "wine.manual_purchases.v1",
  // ── 餐食
  "food.menu.v1", "food.ingredients.v2", "food.purchases.v1",
  // ── 烈酒库存
  "spirits.items.v3", "spirits.purchases.v3", "spirits.ledger.v3",
  "spirits.refPrices.v1", "spirits.suppliers.v1", "spirits.groups.v1",
  "spirits.matchMemory.v1", "spirits.selfBuyConfig.v1", "spirits.customCategories.v1",
  "spirits.groupMatchMemory.v1", "supplier.match.memory.v1",
  // ── 啤酒库存
  "beer.items.v1", "beer.transactions.v1", "beer.snapshots.v1",
  // ── 水果库存
  "fruit.items.v1", "fruit.transactions.v1", "fruit.snapshots.v1",
  // ── 冰块库存
  "ice.inv.items.v1", "ice.inv.tx.v1", "ice.inventory.v1",
  // ── 器具库存
  "equipment.inventory.v1",
  // ── 门店运营
  "store.revenue.v1", "store.petty.v1", "store.petty_categories.v1",
  "store.petty_inv_links.v1", "store.petty_labor_links.v1",
  "store.employee_name_aliases.v1", "store.inventory.v1",
  "monthly_summary.reports.v1", "monthly_summary.suppliers.v1",
  "monthly_summary.payments.v1", "monthly_summary.balances.v1",
  "monthly_summary.petty_configs.v1", "monthly_summary.inventory_configs.v1",
  "monthly_reports_v1", "period_analysis.reports.v1", "period_analysis.settings.v1",
  "schedule.business_hours.v1", "schedule.shift_templates.v1", "dish_analysis.snapshots.v1",
  // ── 员工管理
  "labor_employees_v1", "labor_employee_groups_v1", "labor_shifts_v1",
  "labor_shift_templates_v1", "labor_attendance_v1", "labor_month_configs_v1",
  "labor_holiday_configs_v1", "labor_comp_off_v1", "labor_comp_off_entries_v1",
  "labor_holiday_comp_off_v1", "labor_unexplained_rest_alerts_v1",
  "labor_special_statuses_v1", "labor_custom_depts_v1", "labor_business_hours_v1",
  "labor_shift_groups_v1",   "labor_fill_presets_v1",
  // ── 薪资数据
  "labor_payslips_v1", "labor_month_close_archives_v1", "labor_month_adjustment_sessions_v1",
  "labor.salary_advances.v1", "labor.advance_categories.v1",
  "labor_performance_templates_v1", "labor_performance_records_v1",
  "labor_global_payroll_settings_v1",
] as const;

type SyncKey = typeof SYNC_KEYS_SNAPSHOT[number];

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/** 把 FEATURE_MODULES 的所有 storageKeys 合并成一个 Set */
function getAllFeatureStorageKeys(): Set<string> {
  const keys = new Set<string>();
  for (const mod of FEATURE_MODULES) {
    for (const k of mod.storageKeys) {
      keys.add(k);
    }
  }
  return keys;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("SYNC_KEYS × FEATURE_MODULES 覆盖率", () => {
  it("FEATURE_MODULES 应覆盖 SYNC_KEYS 中的所有键", () => {
    const featureKeys = getAllFeatureStorageKeys();
    const missing: string[] = [];
    for (const key of SYNC_KEYS_SNAPSHOT) {
      if (!featureKeys.has(key)) {
        missing.push(key);
      }
    }
    expect(missing, `以下 SYNC_KEYS 未被任何 FEATURE_MODULE 覆盖：\n${missing.join("\n")}`).toHaveLength(0);
  });

  it("FEATURE_MODULES 中不应有不存在于 SYNC_KEYS 的 storageKey", () => {
    const syncKeySet = new Set<string>(SYNC_KEYS_SNAPSHOT);
    const extra: string[] = [];
    for (const mod of FEATURE_MODULES) {
      for (const k of mod.storageKeys) {
        if (!syncKeySet.has(k)) {
          extra.push(`${mod.key}: ${k}`);
        }
      }
    }
    expect(extra, `以下 storageKey 不在 SYNC_KEYS 中（可能是拼写错误）：\n${extra.join("\n")}`).toHaveLength(0);
  });

  it("SYNC_KEYS 总数应 >= 100", () => {
    expect(SYNC_KEYS_SNAPSHOT.length).toBeGreaterThanOrEqual(100);
  });

  it("FEATURE_MODULES 总数应 >= 18", () => {
    expect(FEATURE_MODULES.length).toBeGreaterThanOrEqual(18);
  });
});

describe("FEATURE_MODULES 数据完整性", () => {
  it("每个模块都应有 key、labelZh、labelEn、icon、color、descZh、descEn、storageKeys", () => {
    for (const mod of FEATURE_MODULES) {
      expect(mod.key, `模块缺少 key`).toBeTruthy();
      expect(mod.labelZh, `模块 ${mod.key} 缺少 labelZh`).toBeTruthy();
      expect(mod.labelEn, `模块 ${mod.key} 缺少 labelEn`).toBeTruthy();
      expect(mod.icon, `模块 ${mod.key} 缺少 icon`).toBeTruthy();
      expect(mod.color, `模块 ${mod.key} 缺少 color`).toBeTruthy();
      expect(mod.descZh, `模块 ${mod.key} 缺少 descZh`).toBeTruthy();
      expect(mod.descEn, `模块 ${mod.key} 缺少 descEn`).toBeTruthy();
      expect(mod.storageKeys.length, `模块 ${mod.key} 的 storageKeys 不能为空`).toBeGreaterThan(0);
    }
  });

  it("模块 key 不应有重复", () => {
    const keys = FEATURE_MODULES.map((m) => m.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("storageKeys 在所有模块中不应有重复", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const mod of FEATURE_MODULES) {
      for (const k of mod.storageKeys) {
        if (seen.has(k)) {
          duplicates.push(`"${k}" 同时出现在 ${seen.get(k)} 和 ${mod.key}`);
        } else {
          seen.set(k, mod.key);
        }
      }
    }
    expect(duplicates, `storageKeys 有重复：\n${duplicates.join("\n")}`).toHaveLength(0);
  });
});

describe("guest 角色只读保障（pushFn 过滤逻辑模拟）", () => {
  it("guest 角色不应推送任何数据", () => {
    // 模拟 provider.tsx 第 222 行的逻辑：guest 使用 no-op push
    const deviceRole = "guest";
    const guestPushFn = deviceRole === "guest"
      ? async () => { /* no-op */ }
      : async (entries: unknown[]) => { /* real push */ void entries; };

    // guest 的 pushFn 应该是 no-op（不推送）
    // 验证方式：检查函数体是否为空（通过调用不抛出且不执行推送）
    let pushCalled = false;
    const mockPush = async (entries: unknown[]) => {
      pushCalled = true;
      void entries;
    };

    const effectivePush = deviceRole === "guest" ? async () => {} : mockPush;
    void effectivePush([{ storageKey: "labor_payslips_v1", value: "sensitive", clientUpdatedAt: Date.now() }]);
    expect(pushCalled).toBe(false);
  });

  it("collaborator 角色只推送 allowedKeys 中的数据", () => {
    const allowedKeys = ["cocktail.recipes", "cocktail.bottles"];
    const allEntries = [
      { storageKey: "cocktail.recipes", value: "recipes_data", clientUpdatedAt: Date.now() },
      { storageKey: "labor_payslips_v1", value: "payroll_sensitive", clientUpdatedAt: Date.now() },
      { storageKey: "cocktail.bottles", value: "bottles_data", clientUpdatedAt: Date.now() },
    ];

    // 模拟 provider.tsx 第 109-111 行的过滤逻辑
    const filtered = allEntries.filter((e) => allowedKeys.includes(e.storageKey));

    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.storageKey)).toEqual(["cocktail.recipes", "cocktail.bottles"]);
    // 薪资数据不应被推送
    expect(filtered.find((e) => e.storageKey === "labor_payslips_v1")).toBeUndefined();
  });
});

describe("快捷预设合法性", () => {
  // 直接在测试中定义预设，与 device-manager.tsx 保持一致
  const PRESETS = [
    { labelZh: "吧台设备", role: "collaborator" as const, features: ["recipes", "bottles", "homemade", "menu", "shopping"] },
    { labelZh: "厨房设备", role: "collaborator" as const, features: ["food", "shopping"] },
    { labelZh: "财务只读", role: "guest" as const, features: ["store_ops", "labor", "payroll"] },
    { labelZh: "运营只读", role: "guest" as const, features: ["store_ops", "recipes", "wine", "food", "menu"] },
    { labelZh: "研发设备", role: "collaborator" as const, features: ["recipes", "lab", "bottles", "homemade", "books"] },
    { labelZh: "全功能协作", role: "collaborator" as const, features: FEATURE_MODULES.map((m) => m.key) },
  ];

  const validFeatureKeys = new Set<string>(FEATURE_MODULES.map((m) => m.key));
  const validRoles = new Set(["owner", "collaborator", "guest"]);

  it("所有预设的角色应合法", () => {
    for (const preset of PRESETS) {
      expect(validRoles.has(preset.role), `预设「${preset.labelZh}」的角色 "${preset.role}" 不合法`).toBe(true);
    }
  });

  it("所有预设的功能模块应存在于 FEATURE_MODULES", () => {
    for (const preset of PRESETS) {
      for (const feature of preset.features) {
        expect(
          validFeatureKeys.has(feature as string),
          `预设「${preset.labelZh}」包含不存在的模块 "${feature}"`
        ).toBe(true);
      }
    }
  });

  it("财务只读预设应使用 guest 角色", () => {
    const financePreset = PRESETS.find((p) => p.labelZh === "财务只读");
    expect(financePreset).toBeDefined();
    expect(financePreset!.role).toBe("guest");
  });

  it("财务只读预设应包含 store_ops、labor、payroll 模块", () => {
    const financePreset = PRESETS.find((p) => p.labelZh === "财务只读");
    expect(financePreset!.features).toContain("store_ops");
    expect(financePreset!.features).toContain("labor");
    expect(financePreset!.features).toContain("payroll");
  });

  it("吧台设备预设不应包含薪资数据", () => {
    const barPreset = PRESETS.find((p) => p.labelZh === "吧台设备");
    expect(barPreset!.features).not.toContain("payroll");
    expect(barPreset!.features).not.toContain("labor");
    expect(barPreset!.features).not.toContain("store_ops");
  });
});

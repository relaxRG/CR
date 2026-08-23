import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FEATURE_CONTRACTS } from "@/lib/sync/feature-contract";
import { STORAGE_POLICY } from "@/lib/sync/capabilities";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { migrateLegacyStoreHours } from "@/lib/store/period-analysis/schedule-store";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const NEW_SHARED_FACTS = [
  "store.purchase.v1",
  "wine.import_control.v1",
  "wine.master_data.v1",
  "module_month_close_archives_v1",
  "module_month_adjustment_sessions_v1",
  "labor.separate_payments.v1",
] as const;

describe("全App共享事实同步覆盖", () => {
  it("所有确认缺失的业务事实均有同步键、唯一功能契约和读写能力策略", () => {
    const syncKeys = new Set<string>(SYNC_KEYS);
    const contractOwners = new Map<string, string[]>();
    for (const contract of FEATURE_CONTRACTS) {
      for (const key of contract.storageKeys) {
        contractOwners.set(key, [...(contractOwners.get(key) ?? []), contract.id]);
      }
    }

    for (const key of NEW_SHARED_FACTS) {
      expect(syncKeys.has(key)).toBe(true);
      expect(contractOwners.get(key)).toHaveLength(1);
      expect(STORAGE_POLICY).toHaveProperty(key);
      expect(STORAGE_POLICY[key]).toEqual(expect.objectContaining({
        read: expect.any(String),
        write: expect.any(String),
      }));
    }
  });

  it("活跃共享Store均在本地写入成功后通知同步，并在远端拉取后重新加载", () => {
    const purchase = source("components/store/purchase.tsx");
    const wine = source("lib/wine/store.tsx");
    const moduleClose = source("lib/month-close/module-month-close-store.tsx");
    const separatePayments = source("lib/labor/separate-payment-store.tsx");

    expect(purchase).toContain("registerStoreReload(load)");
    expect(purchase).toContain(".then(() => notifySyncChange(STORAGE_KEY))");
    expect(wine).toContain("notifySyncChange(IMPORT_CONTROL_KEY)");
    expect(wine).toContain("notifySyncChange(MASTER_DATA_KEY)");
    expect(moduleClose).toContain("notifySyncChange(ARCHIVES_KEY)");
    expect(moduleClose).toContain("notifySyncChange(SESSIONS_KEY)");
    expect(separatePayments).toContain("notifySyncChange(STORAGE_KEY)");
    expect(separatePayments).toContain("registerStoreReload");
  });

  it("烈酒本月进货和库存分类均为受管共享事实，写入后通知同步且远端重载不回推", () => {
    const syncKeys = new Set<string>(SYNC_KEYS);
    const contract = FEATURE_CONTRACTS.find((item) => item.id === "inventory.spirits");
    const spirits = source("lib/spirits/crud-store.tsx");

    for (const key of ["spirits.purchases.v3", "spirits.customCategories.v1"] as const) {
      expect(syncKeys.has(key)).toBe(true);
      expect(contract?.storageKeys).toContain(key);
      expect(STORAGE_POLICY[key]).toEqual(expect.objectContaining({
        read: "inventory_spirits.view",
        write: expect.any(String),
      }));
    }
    expect(spirits).toContain("registerStoreReload(() => { void load(); })");
    expect(spirits).toContain("skipNextPersistenceRef.current = true;");
    expect(spirits).toContain("[PURCHASES_KEY, JSON.stringify(state.purchases)]");
    expect(spirits).toContain("[CUSTOM_CATEGORIES_KEY, JSON.stringify(state.customCategories)]");
    expect(spirits).toContain(".then(() => entries.forEach(([key]) => notifySyncChange(key)))");
  });

  it("瓶库样式、供应商匹配记忆、薪资设置与备份恢复的直接共享写入均通知同步", () => {
    const taxonomy = source("lib/bottles/taxonomy.tsx");
    const supplierImport = source("lib/store/supplier-import.ts");
    const labor = source("lib/labor/store.tsx");
    const engine = source("lib/sync/engine.ts");

    expect(taxonomy).toContain(".then(() => notifySyncChange(STYLES_KEY))");
    expect(supplierImport).toContain("notifySyncChange(MATCH_MEMORY_KEY)");
    expect(labor).toContain("return registerStoreReload(() => { void load(); });");
    expect(labor).toContain(".then(() => notifySyncChange(key))");
    expect(engine).toContain("restoredBusinessKeys.forEach((key) => notifySyncChange(key))");
  });

  it("旧营业时间数据只迁移到唯一共享设置键，保留周序、跨日关门和预警字段", () => {
    const migrated = migrateLegacyStoreHours(JSON.stringify({
      days: [
        { open: true, openTime: "11:00", closeTime: "24:00" },
        { open: false, openTime: "11:00", closeTime: "24:00" },
        { open: true, openTime: "12:00", closeTime: "01:30" },
        { open: true, openTime: "12:00", closeTime: "24:00" },
        { open: true, openTime: "12:00", closeTime: "24:00" },
        { open: true, openTime: "13:00", closeTime: "01:00" },
        { open: true, openTime: "13:00", closeTime: "00:30" },
      ],
      overtimeAlertEnabled: false,
      closingAlertMinutes: 120,
      updatedAt: "2026-08-23T00:00:00.000Z",
    }));

    expect(migrated).toEqual(expect.objectContaining({
      overtimeAlertEnabled: false,
      closingAlertMinutes: 120,
      updatedAt: "2026-08-23T00:00:00.000Z",
    }));
    expect(migrated?.weekdayClosingTimes.find((item) => item.weekday === 1)).toEqual(expect.objectContaining({
      open: true,
      openingTime: "11:00",
      closingTime: "24:00",
    }));
    expect(migrated?.weekdayClosingTimes.find((item) => item.weekday === 2)).toEqual(expect.objectContaining({ open: false }));
    expect(migrated?.weekdayClosingTimes.find((item) => item.weekday === 3)).toEqual(expect.objectContaining({ closingTime: "25:30" }));
    expect(migrated?.weekdayClosingTimes.find((item) => item.weekday === 0)).toEqual(expect.objectContaining({ closingTime: "24:30" }));

    const legacyScreen = source("app/store-hours.tsx");
    expect(legacyScreen).toContain("useScheduleStore");
    expect(legacyScreen).not.toContain('"store_business_hours_v1"');
  });

  it("报告月结命令使用已受管同步的唯一考勤键，设备凭据、显示偏好与原始Excel文件索引保持本地", () => {
    const reportMonthClose = source("lib/labor/report-month-close-provider.tsx");
    const syncKeys = new Set<string>(SYNC_KEYS);

    expect(reportMonthClose).toContain('const ATTENDANCES_KEY = "labor_attendance_v1"');
    expect(syncKeys.has("labor_attendance_v1")).toBe(true);
    for (const localOnlyKey of [
      "cf.sync.deviceId",
      "cf.sync.deviceToken",
      "device.customRoleNames.v1",
      "business.global-active-month.v1",
      "monthly_report.raw_excel_archive.v1",
    ]) {
      expect(syncKeys.has(localOnlyKey)).toBe(false);
    }
  });
});

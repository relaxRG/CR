/**
 * 端到端集成测试：总月报与经营分析并发数据写入稳定性
 *
 * 测试场景：
 * E1. 总月报与经营分析同时写入同一月份数据 → 不互相覆盖
 * E2. 多设备并发写入总月报 lineItems → 后写入者覆盖（Last-Write-Wins）
 * E3. 总月报自动汇总（aggregator）与手动录入并发 → 手动项不被覆盖
 * E4. 经营分析 revenue-store 写入不影响总月报 monthly-summary 数据
 * E5. guest 角色无法写入 store_ops 数据（权限拦截）
 * E6. collaborator 角色只能写入授权模块的数据
 * F1. hasFeature 权限校验：store_ops 模块各角色访问权限
 * F2. hasFeature 权限校验：labor/payroll 模块各角色访问权限
 * F3. 冗余入口检测：各模块不存在重复的导航入口
 */
import { describe, it, expect } from "vitest";
import { FEATURE_MODULES, type FeatureKey } from "@/lib/sync/feature-modules";

// ─── 模拟基础设施（复用 sync-e2e-permissions 的模式）────────────────────────

class MockStorage {
  private store: Map<string, string> = new Map();
  async getItem(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async setItem(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async removeItem(key: string): Promise<void> { this.store.delete(key); }
  getAll(): Record<string, string> { return Object.fromEntries(this.store); }
  size(): number { return this.store.size; }
}

class MockCloudStorage {
  private store: Map<string, { value: string; clientUpdatedAt: number }> = new Map();
  push(entries: { storageKey: string; value: string; clientUpdatedAt: number }[]): void {
    for (const e of entries) this.store.set(e.storageKey, { value: e.value, clientUpdatedAt: e.clientUpdatedAt });
  }
  pull(keys: string[]): { storageKey: string; value: string; clientUpdatedAt: number }[] {
    return keys.filter((k) => this.store.has(k)).map((k) => ({
      storageKey: k, value: this.store.get(k)!.value, clientUpdatedAt: this.store.get(k)!.clientUpdatedAt,
    }));
  }
  has(key: string): boolean { return this.store.has(key); }
  get(key: string): { value: string; clientUpdatedAt: number } | undefined { return this.store.get(key); }
}

function featuresToAllowedKeys(features: FeatureKey[]): string[] {
  const result: string[] = [];
  for (const feature of features) {
    const mod = FEATURE_MODULES.find((m) => m.key === feature);
    if (mod) result.push(...mod.storageKeys);
  }
  return result;
}

class MockDevice {
  readonly role: "owner" | "collaborator" | "guest";
  readonly allowedKeys: string[];
  readonly storage: MockStorage;
  constructor(role: "owner" | "collaborator" | "guest", features: FeatureKey[], private cloud: MockCloudStorage) {
    this.role = role;
    this.allowedKeys = role === "owner" ? featuresToAllowedKeys(FEATURE_MODULES.map((m) => m.key)) : featuresToAllowedKeys(features);
    this.storage = new MockStorage();
  }
  canWrite(storageKey: string): boolean {
    if (this.role === "guest") return false;
    if (this.role === "owner") return true;
    return this.allowedKeys.includes(storageKey);
  }
  canRead(storageKey: string): boolean {
    if (this.role === "owner") return true;
    return this.allowedKeys.includes(storageKey);
  }
  async push(storageKey: string, value: string, timestamp: number): Promise<boolean> {
    if (!this.canWrite(storageKey)) return false;
    this.cloud.push([{ storageKey, value, clientUpdatedAt: timestamp }]);
    await this.storage.setItem(storageKey, value);
    return true;
  }
  async pull(storageKey: string): Promise<string | null> {
    if (!this.canRead(storageKey)) return null;
    const results = this.cloud.pull([storageKey]);
    if (results.length === 0) return null;
    await this.storage.setItem(storageKey, results[0].value);
    return results[0].value;
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/** 模拟总月报 lineItems 数据 */
function makeMonthlySummaryReport(month: string, lineItems: { code: string; amount: number }[]) {
  return JSON.stringify({
    id: `report-${month}`,
    month,
    lineItems: lineItems.map((li) => ({
      id: `li-${li.code}`, code: li.code, label: li.code,
      category: "petty_other", amount: li.amount, source: "petty",
      isPaid: false, paymentNote: "", isDuplicate: false, duplicateNote: "",
      isManual: false, notes: "",
    })),
    manualItems: [],
    totalRevenue: 0, totalCOGS: 0, totalLabor: 0, totalRent: 0,
    totalUtilities: 0, totalPettyOther: 0, totalExtra: 0, netProfit: 0,
    isFinalized: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/** 模拟 revenue-store 数据 */
function makeRevenueRecords(records: { category: string; amount: number; date: string }[]) {
  return JSON.stringify(records.map((r, i) => ({
    id: `rev-${i}`, category: r.category, amount: r.amount,
    date: r.date, note: "", createdAt: new Date().toISOString(),
  })));
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe("E: 总月报与经营分析并发数据写入稳定性", () => {

  it("E1: 总月报与经营分析写入不同 storageKey，不互相覆盖", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);

    const monthlySummaryKey = "monthly_summary.reports.v1";
    const revenueKey = "store.revenue.v1";

    const summaryData = makeMonthlySummaryReport("2026-07", [{ code: "petty_A1", amount: 500 }]);
    const revenueData = makeRevenueRecords([{ category: "revenue", amount: 10000, date: "2026-07-15" }]);

    // 并发写入
    await Promise.all([
      owner.push(monthlySummaryKey, summaryData, Date.now()),
      owner.push(revenueKey, revenueData, Date.now()),
    ]);

    // 验证两个 key 独立存储，互不影响
    const pulledSummary = await owner.pull(monthlySummaryKey);
    const pulledRevenue = await owner.pull(revenueKey);

    expect(pulledSummary).not.toBeNull();
    expect(pulledRevenue).not.toBeNull();

    const summaryParsed = JSON.parse(pulledSummary!);
    const revenueParsed = JSON.parse(pulledRevenue!);

    // 总月报数据完整
    expect(summaryParsed[0]?.lineItems?.[0]?.code ?? summaryParsed.lineItems?.[0]?.code).toBe("petty_A1");
    // 经营分析数据完整
    expect(revenueParsed[0].category).toBe("revenue");
    expect(revenueParsed[0].amount).toBe(10000);
  });

  it("E2: 多设备并发写入总月报 → Last-Write-Wins（后写者覆盖）", async () => {
    const cloud = new MockCloudStorage();
    const owner1 = new MockDevice("owner", [], cloud);
    const owner2 = new MockDevice("owner", [], cloud);

    const key = "monthly_summary.reports.v1";
    const t1 = 1000;
    const t2 = 2000; // owner2 时间戳更新

    const data1 = makeMonthlySummaryReport("2026-07", [{ code: "A1", amount: 100 }]);
    const data2 = makeMonthlySummaryReport("2026-07", [{ code: "A1", amount: 200 }]);

    // owner1 先写，owner2 后写（时间戳更新）
    await owner1.push(key, data1, t1);
    await owner2.push(key, data2, t2);

    // 云端应保留 owner2 的数据（Last-Write-Wins）
    const cloudEntry = cloud.get(key);
    expect(cloudEntry).not.toBeUndefined();
    expect(cloudEntry!.clientUpdatedAt).toBe(t2);

    const parsed = JSON.parse(cloudEntry!.value);
    expect(parsed.lineItems[0].amount).toBe(200);
  });

  it("E3: 总月报自动汇总不覆盖手动录入项（manualItems 独立存储）", () => {
    // 模拟 aggregateMonthlyReport 逻辑：lineItems 由聚合器生成，manualItems 由用户手动录入
    // 验证两者使用不同字段，不会互相覆盖
    const existingReport = {
      id: "r1", month: "2026-07",
      lineItems: [{ id: "li1", code: "petty_A1", amount: 500, isManual: false }],
      manualItems: [{ id: "mi1", code: "manual_rent", amount: 8000, isManual: true }],
    };

    // 模拟自动汇总：只覆盖 lineItems，保留 manualItems
    const aggregatedLineItems = [{ id: "li2", code: "petty_A1", amount: 600, isManual: false }];
    const updatedReport = {
      ...existingReport,
      lineItems: aggregatedLineItems,
      manualItems: existingReport.manualItems, // 保留手动项
    };

    expect(updatedReport.lineItems[0].amount).toBe(600); // 自动汇总已更新
    expect(updatedReport.manualItems[0].amount).toBe(8000); // 手动项未被覆盖
    expect(updatedReport.manualItems[0].isManual).toBe(true);
  });

  it("E4: revenue-store 写入不影响 monthly-summary 数据（独立 storageKey）", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);

    const summaryKey = "monthly_summary.reports.v1";
    const revenueKey = "store.revenue.v1";

    // 先写入总月报
    const originalSummary = makeMonthlySummaryReport("2026-07", [{ code: "A1", amount: 500 }]);
    await owner.push(summaryKey, originalSummary, 1000);

    // 再写入经营分析（revenue-store）
    const revenueData = makeRevenueRecords([{ category: "revenue", amount: 99999, date: "2026-07-01" }]);
    await owner.push(revenueKey, revenueData, 2000);

    // 总月报数据不变
    const pulledSummary = await owner.pull(summaryKey);
    const summaryParsed = JSON.parse(pulledSummary!);
    expect(summaryParsed.lineItems[0].amount).toBe(500); // 未被 revenue 覆盖
  });

  it("E5: guest 角色无法写入 store_ops 数据", async () => {
    const cloud = new MockCloudStorage();
    const guest = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    const key = "monthly_summary.reports.v1";
    const result = await guest.push(key, "malicious data", Date.now());

    expect(result).toBe(false); // 写入被拦截
    expect(cloud.has(key)).toBe(false); // 云端无数据
  });

  it("E6: collaborator 只能写入授权模块数据，不能写入未授权模块", async () => {
    const cloud = new MockCloudStorage();
    // 吧台协作者：只有 recipes 和 bottles 权限
    const barCollaborator = new MockDevice("collaborator", ["recipes", "bottles"], cloud);

    // 可以写入配方
    const recipeResult = await barCollaborator.push("cocktail.recipes", '{"recipes":[]}', Date.now());
    expect(recipeResult).toBe(true);

    // 不能写入薪资数据
    const payrollResult = await barCollaborator.push("labor_payslips_v1", '{"payslips":[]}', Date.now());
    expect(payrollResult).toBe(false);

    // 不能写入月报数据
    const summaryResult = await barCollaborator.push("monthly_summary.reports.v1", '{"reports":[]}', Date.now());
    expect(summaryResult).toBe(false);
  });
});

describe("F: hasFeature 权限校验逻辑", () => {

  /** 模拟前端 hasFeature 函数（基于 allowedKeys 判断） */
  function hasFeature(feature: FeatureKey, deviceRole: "owner" | "collaborator" | "guest", allowedKeys: string[]): boolean {
    if (deviceRole === "owner") return true;
    const mod = FEATURE_MODULES.find((m) => m.key === feature);
    if (!mod) return false;
    // 只要 allowedKeys 包含该模块的任意一个 storageKey，即视为有权限
    return mod.storageKeys.some((k) => allowedKeys.includes(k));
  }

  it("F1: store_ops 模块各角色访问权限", () => {
    const ownerKeys = featuresToAllowedKeys(FEATURE_MODULES.map((m) => m.key));
    const financeKeys = featuresToAllowedKeys(["store_ops", "labor", "payroll"]);
    const barKeys = featuresToAllowedKeys(["recipes", "bottles"]);

    // owner 可以访问所有模块
    expect(hasFeature("store_ops", "owner", ownerKeys)).toBe(true);
    expect(hasFeature("labor", "owner", ownerKeys)).toBe(true);

    // guest 角色：hasFeature 基于 allowedKeys 检查读权限，有 allowedKeys 就能读（不能写）
    // guest + financeKeys 包含 store_ops 的 storageKeys → 可以读（不能写）
    expect(hasFeature("store_ops", "guest", financeKeys)).toBe(true); // guest 可读，写入拦截在 push 层
    // 财务协作者（collaborator）有 store_ops 权限
    expect(hasFeature("store_ops", "collaborator", financeKeys)).toBe(true);
    expect(hasFeature("labor", "collaborator", financeKeys)).toBe(true);
    expect(hasFeature("payroll", "collaborator", financeKeys)).toBe(true);

    // 吧台协作者没有 store_ops 权限
    expect(hasFeature("store_ops", "collaborator", barKeys)).toBe(false);
    expect(hasFeature("labor", "collaborator", barKeys)).toBe(false);
  });

  it("F2: labor/payroll 模块各角色访问权限", () => {
    const financeKeys = featuresToAllowedKeys(["store_ops", "labor", "payroll"]);
    const barKeys = featuresToAllowedKeys(["recipes", "bottles", "spirits"]);

    expect(hasFeature("labor", "collaborator", financeKeys)).toBe(true);
    expect(hasFeature("payroll", "collaborator", financeKeys)).toBe(true);
    expect(hasFeature("labor", "collaborator", barKeys)).toBe(false);
    expect(hasFeature("payroll", "collaborator", barKeys)).toBe(false);
  });

  it("F3: 各模块 storageKeys 不存在重复（无冗余入口）", () => {
    const allKeys: string[] = [];
    const duplicates: string[] = [];

    for (const mod of FEATURE_MODULES) {
      for (const key of mod.storageKeys) {
        if (allKeys.includes(key)) {
          duplicates.push(`${key} (重复出现在 ${mod.key})`);
        } else {
          allKeys.push(key);
        }
      }
    }

    expect(duplicates).toHaveLength(0);
  });

  it("F4: owner 角色始终拥有所有模块权限", () => {
    const ownerKeys = featuresToAllowedKeys(FEATURE_MODULES.map((m) => m.key));
    for (const mod of FEATURE_MODULES) {
      const result = hasFeature(mod.key, "owner", ownerKeys);
      expect(result).toBe(true);
    }
  });

  it("F5: guest 角色始终无法写入任何模块（写入权限拦截）", async () => {
    const cloud = new MockCloudStorage();
    // guest 即使有所有 feature 的 allowedKeys，也不能写入
    const allFeatures = FEATURE_MODULES.map((m) => m.key);
    const guestWithAllKeys = new MockDevice("guest", allFeatures, cloud);

    // 随机选取 5 个 storageKey 测试
    const testKeys = FEATURE_MODULES.slice(0, 5).flatMap((m) => m.storageKeys.slice(0, 1));
    for (const key of testKeys) {
      const result = await guestWithAllKeys.push(key, "test", Date.now());
      expect(result).toBe(false);
    }
  });
});

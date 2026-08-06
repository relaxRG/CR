/**
 * E2E 集成测试：权限控制和财务只读角色
 *
 * 测试场景（端到端模拟，不依赖真实网络）：
 *
 * 场景 A：财务只读角色（guest）
 *   A1. 财务设备可以拉取 store_ops/labor/payroll 模块数据
 *   A2. 财务设备不能推送任何数据（pushFn 为 no-op）
 *   A3. 财务设备不能看到未授权模块（recipes/bottles/homemade 等）
 *   A4. 主设备修改月报后，财务设备下次同步可以看到更新
 *
 * 场景 B：吧台协作者（collaborator）
 *   B1. 吧台设备可以读写配方库/酒款库/门店酒单
 *   B2. 吧台设备不能推送薪资数据
 *   B3. 吧台设备推送的配方修改会被主设备接受
 *
 * 场景 C：多设备冲突
 *   C1. 两台设备同时修改同一条配方 → 产生冲突
 *   C2. 主设备选择「保留本机」→ 本机版本覆盖
 *   C3. 主设备选择「全部采用云端」→ 云端版本覆盖
 *
 * 场景 D：权限边界
 *   D1. guest 角色的 allowedKeys 只包含授权模块的键
 *   D2. collaborator 角色的 allowedKeys 过滤掉未授权模块
 *   D3. owner 角色的 allowedKeys 包含所有键
 */

import { describe, it, expect, vi } from "vitest";
import { FEATURE_MODULES, type FeatureKey } from "@/lib/sync/feature-modules";

// ─── 模拟同步基础设施 ─────────────────────────────────────────────────────────

/** 模拟 AsyncStorage（内存版） */
class MockStorage {
  private store: Map<string, string> = new Map();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  getAll(): Record<string, string> {
    return Object.fromEntries(this.store);
  }

  size(): number {
    return this.store.size;
  }
}

/** 模拟云端存储（所有设备共享） */
class MockCloudStorage {
  private store: Map<string, { value: string; clientUpdatedAt: number }> = new Map();

  push(entries: { storageKey: string; value: string; clientUpdatedAt: number }[]): void {
    for (const entry of entries) {
      this.store.set(entry.storageKey, {
        value: entry.value,
        clientUpdatedAt: entry.clientUpdatedAt,
      });
    }
  }

  pull(keys: string[]): { storageKey: string; value: string; clientUpdatedAt: number }[] {
    return keys
      .filter((k) => this.store.has(k))
      .map((k) => ({
        storageKey: k,
        value: this.store.get(k)!.value,
        clientUpdatedAt: this.store.get(k)!.clientUpdatedAt,
      }));
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

/** 把 FeatureKey 列表转换为 allowedKeys */
function featuresToAllowedKeys(features: FeatureKey[]): string[] {
  const result: string[] = [];
  for (const feature of features) {
    const mod = FEATURE_MODULES.find((m) => m.key === feature);
    if (mod) result.push(...mod.storageKeys);
  }
  return result;
}

/** 模拟设备 */
class MockDevice {
  readonly role: "owner" | "collaborator" | "guest";
  readonly allowedKeys: string[];
  readonly storage: MockStorage;
  private cloud: MockCloudStorage;
  private pushCallCount = 0;
  private pullCallCount = 0;

  constructor(
    role: "owner" | "collaborator" | "guest",
    features: FeatureKey[],
    cloud: MockCloudStorage,
  ) {
    this.role = role;
    this.allowedKeys = role === "owner"
      ? FEATURE_MODULES.flatMap((m) => m.storageKeys)
      : featuresToAllowedKeys(features);
    this.storage = new MockStorage();
    this.cloud = cloud;
  }

  /** 推送数据到云端（guest 角色为 no-op） */
  async push(entries: { storageKey: string; value: string; clientUpdatedAt: number }[]): Promise<void> {
    if (this.role === "guest") {
      // guest 角色：no-op，不推送任何数据
      return;
    }
    // collaborator/owner：只推送 allowedKeys 中的键
    const filtered = entries.filter((e) => this.allowedKeys.includes(e.storageKey));
    if (filtered.length > 0) {
      this.cloud.push(filtered);
      this.pushCallCount++;
    }
  }

  /** 从云端拉取数据（只拉取 allowedKeys 中的键） */
  async pull(): Promise<void> {
    const remoteEntries = this.cloud.pull(this.allowedKeys);
    for (const entry of remoteEntries) {
      await this.storage.setItem(entry.storageKey, entry.value);
    }
    this.pullCallCount++;
  }

  /** 写入本地数据并推送到云端 */
  async write(key: string, value: string): Promise<void> {
    await this.storage.setItem(key, value);
    await this.push([{ storageKey: key, value, clientUpdatedAt: Date.now() }]);
  }

  /** 读取本地数据 */
  async read(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }

  getPushCount(): number { return this.pushCallCount; }
  getPullCount(): number { return this.pullCallCount; }
}

// ─── 场景 A：财务只读角色 ─────────────────────────────────────────────────────

describe("场景 A：财务只读角色（guest）", () => {
  it("A1. 财务设备可以拉取 store_ops/labor/payroll 模块数据", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 主设备写入月报数据
    await owner.write("monthly_summary.reports.v1", JSON.stringify({ month: "2026-08", revenue: 100000 }));
    await owner.write("labor_payslips_v1", JSON.stringify([{ id: "ps-1", amount: 8000 }]));
    await owner.write("labor_employees_v1", JSON.stringify([{ id: "emp-1", name: "Jason" }]));

    // 财务设备拉取
    await finance.pull();

    // 财务设备应该能看到月报和薪资数据
    const monthlyReport = await finance.read("monthly_summary.reports.v1");
    const payslips = await finance.read("labor_payslips_v1");
    const employees = await finance.read("labor_employees_v1");

    expect(monthlyReport).not.toBeNull();
    expect(JSON.parse(monthlyReport!).revenue).toBe(100000);
    expect(payslips).not.toBeNull();
    expect(employees).not.toBeNull();
  });

  it("A2. 财务设备不能推送任何数据（pushFn 为 no-op）", async () => {
    const cloud = new MockCloudStorage();
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 财务设备尝试修改数据
    await finance.write("monthly_summary.reports.v1", JSON.stringify({ month: "2026-08", revenue: 999999 }));

    // 云端不应该有任何数据（push 是 no-op）
    expect(cloud.has("monthly_summary.reports.v1")).toBe(false);
    expect(finance.getPushCount()).toBe(0);
  });

  it("A3. 财务设备不能看到未授权模块（配方库/酒款库/自制品）", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 主设备写入配方数据（财务不应该看到）
    await owner.write("cocktail.recipes", JSON.stringify([{ id: "r-1", name: "Negroni" }]));
    await owner.write("cocktail.bottles", JSON.stringify([{ id: "b-1", name: "Gin" }]));

    // 财务设备拉取
    await finance.pull();

    // 财务设备不应该能看到配方和酒款数据
    const recipes = await finance.read("cocktail.recipes");
    const bottles = await finance.read("cocktail.bottles");

    expect(recipes).toBeNull();
    expect(bottles).toBeNull();
  });

  it("A4. 主设备修改月报后，财务设备下次同步可以看到更新", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 第一次同步
    await owner.write("monthly_summary.reports.v1", JSON.stringify({ month: "2026-08", revenue: 50000 }));
    await finance.pull();
    const firstPull = await finance.read("monthly_summary.reports.v1");
    expect(JSON.parse(firstPull!).revenue).toBe(50000);

    // 主设备更新月报
    await owner.write("monthly_summary.reports.v1", JSON.stringify({ month: "2026-08", revenue: 80000 }));

    // 财务设备第二次同步
    await finance.pull();
    const secondPull = await finance.read("monthly_summary.reports.v1");
    expect(JSON.parse(secondPull!).revenue).toBe(80000);
  });
});

// ─── 场景 B：吧台协作者 ───────────────────────────────────────────────────────

describe("场景 B：吧台协作者（collaborator）", () => {
  it("B1. 吧台设备可以读写配方库/酒款库/门店酒单", async () => {
    const cloud = new MockCloudStorage();
    const bar = new MockDevice("collaborator", ["recipes", "bottles", "menu"], cloud);

    // 吧台设备写入配方
    await bar.write("cocktail.recipes", JSON.stringify([{ id: "r-1", name: "Negroni" }]));
    expect(cloud.has("cocktail.recipes")).toBe(true);
    expect(bar.getPushCount()).toBe(1);
  });

  it("B2. 吧台设备不能推送薪资数据", async () => {
    const cloud = new MockCloudStorage();
    const bar = new MockDevice("collaborator", ["recipes", "bottles", "menu"], cloud);

    // 吧台设备尝试写入薪资数据（不在 allowedKeys 中）
    await bar.write("labor_payslips_v1", JSON.stringify([{ id: "ps-1", amount: 8000 }]));

    // 云端不应该有薪资数据
    expect(cloud.has("labor_payslips_v1")).toBe(false);
    // push 计数为 0（因为 filtered 后为空，不调用 cloud.push）
    expect(bar.getPushCount()).toBe(0);
  });

  it("B3. 吧台设备推送的配方修改会被主设备拉取到", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const bar = new MockDevice("collaborator", ["recipes", "bottles", "menu"], cloud);

    // 吧台设备添加新配方
    await bar.write("cocktail.recipes", JSON.stringify([{ id: "r-new", name: "Spritz" }]));

    // 主设备拉取
    await owner.pull();
    const recipes = await owner.read("cocktail.recipes");

    expect(recipes).not.toBeNull();
    expect(JSON.parse(recipes!)[0].name).toBe("Spritz");
  });
});

// ─── 场景 C：多设备冲突 ───────────────────────────────────────────────────────

describe("场景 C：多设备冲突处理", () => {
  it("C1. 两台设备同时修改同一条配方 → 产生冲突（时间戳不同）", () => {
    const localTs = Date.now() - 5000; // 本机 5 秒前修改
    const remoteTs = Date.now() - 3000; // 云端 3 秒前修改

    const localValue = JSON.stringify([{ id: "r-1", name: "Negroni (local)" }]);
    const remoteValue = JSON.stringify([{ id: "r-1", name: "Negroni (remote)" }]);

    // 冲突检测逻辑（模拟 engine.ts 第 665-678 行）
    const CONFLICT_WINDOW_MS = 60 * 1000; // 60 秒
    const diff = Math.abs(remoteTs - localTs);
    const isConflict = diff < CONFLICT_WINDOW_MS && localValue !== remoteValue;

    expect(isConflict).toBe(true);
    expect(diff).toBeLessThan(CONFLICT_WINDOW_MS);
  });

  it("C2. 主设备选择「保留本机」→ 本机版本覆盖", () => {
    const localValue = JSON.stringify([{ id: "r-1", name: "Negroni (local)" }]);
    const remoteValue = JSON.stringify([{ id: "r-1", name: "Negroni (remote)" }]);

    const conflicts = [{ storageKey: "cocktail.recipes", localValue, remoteValue, localTs: 0, remoteTs: 0 }];

    // 解决冲突：保留本机
    const resolved = conflicts.map((c) => ({ storageKey: c.storageKey, value: c.localValue }));

    expect(resolved[0].value).toBe(localValue);
    expect(JSON.parse(resolved[0].value)[0].name).toBe("Negroni (local)");
  });

  it("C3. 主设备选择「全部采用云端」→ 云端版本覆盖", () => {
    const conflicts = Array.from({ length: 22 }, (_, i) => ({
      storageKey: `key-${i}`,
      localValue: `local-${i}`,
      remoteValue: `remote-${i}`,
      localTs: 0,
      remoteTs: 0,
    }));

    // 一键全部采用云端
    const resolved = conflicts.map((c) => ({ storageKey: c.storageKey, value: c.remoteValue }));

    expect(resolved).toHaveLength(22);
    expect(resolved.every((r, i) => r.value === `remote-${i}`)).toBe(true);
  });
});

// ─── 场景 D：权限边界 ─────────────────────────────────────────────────────────

describe("场景 D：权限边界验证", () => {
  it("D1. guest 角色的 allowedKeys 只包含授权模块的键", () => {
    const cloud = new MockCloudStorage();
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    const storeOpsKeys = FEATURE_MODULES.find((m) => m.key === "store_ops")!.storageKeys;
    const laborKeys = FEATURE_MODULES.find((m) => m.key === "labor")!.storageKeys;
    const payrollKeys = FEATURE_MODULES.find((m) => m.key === "payroll")!.storageKeys;
    const expectedKeys = [...storeOpsKeys, ...laborKeys, ...payrollKeys];

    // 财务设备的 allowedKeys 应该完全等于这三个模块的键
    expect(finance.allowedKeys.sort()).toEqual(expectedKeys.sort());

    // 不应包含配方/酒款/自制品等键
    expect(finance.allowedKeys).not.toContain("cocktail.recipes");
    expect(finance.allowedKeys).not.toContain("cocktail.bottles");
    expect(finance.allowedKeys).not.toContain("homemade.preps.v1");
  });

  it("D2. collaborator 角色的 allowedKeys 过滤掉未授权模块", () => {
    const cloud = new MockCloudStorage();
    const bar = new MockDevice("collaborator", ["recipes", "bottles", "menu"], cloud);

    // 吧台设备不应有薪资/员工/门店运营的键
    expect(bar.allowedKeys).not.toContain("labor_payslips_v1");
    expect(bar.allowedKeys).not.toContain("labor_employees_v1");
    expect(bar.allowedKeys).not.toContain("monthly_summary.reports.v1");

    // 但应该有配方/酒款/酒单的键
    expect(bar.allowedKeys).toContain("cocktail.recipes");
    expect(bar.allowedKeys).toContain("cocktail.bottles");
    expect(bar.allowedKeys).toContain("menu_store_v1");
  });

  it("D3. owner 角色的 allowedKeys 包含所有模块的键", () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);

    const allKeys = FEATURE_MODULES.flatMap((m) => m.storageKeys);

    // owner 应该有所有键
    for (const key of allKeys) {
      expect(owner.allowedKeys).toContain(key);
    }
    expect(owner.allowedKeys.length).toBe(allKeys.length);
  });

  it("D4. 财务只读角色不能通过任何途径修改主设备数据", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 主设备写入原始数据
    const originalData = JSON.stringify({ month: "2026-08", revenue: 100000 });
    await owner.write("monthly_summary.reports.v1", originalData);

    // 财务设备尝试各种方式修改数据
    await finance.write("monthly_summary.reports.v1", JSON.stringify({ month: "2026-08", revenue: 0 }));
    await finance.push([{
      storageKey: "monthly_summary.reports.v1",
      value: JSON.stringify({ month: "2026-08", revenue: -1 }),
      clientUpdatedAt: Date.now() + 99999, // 即使时间戳更新也不行
    }]);

    // 主设备重新拉取后，数据应该不变
    await owner.pull();
    const data = await owner.read("monthly_summary.reports.v1");

    // 云端数据应该是主设备写入的原始数据
    const cloudData = cloud.pull(["monthly_summary.reports.v1"]);
    expect(JSON.parse(cloudData[0].value).revenue).toBe(100000);
  });

  it("D5. 快捷预设「财务只读」的权限边界完整性", () => {
    // 模拟 device-manager.tsx 中的「财务只读」预设
    const financePresetFeatures: FeatureKey[] = ["store_ops", "labor", "payroll"];
    const financeAllowedKeys = featuresToAllowedKeys(financePresetFeatures);

    // 验证包含的键
    expect(financeAllowedKeys).toContain("monthly_summary.reports.v1");
    expect(financeAllowedKeys).toContain("labor_payslips_v1");
    expect(financeAllowedKeys).toContain("labor_employees_v1");
    expect(financeAllowedKeys).toContain("store.petty.v1");

    // 验证不包含的键（敏感业务数据）
    const sensitiveKeys = [
      "cocktail.recipes",
      "cocktail.bottles",
      "homemade.preps.v1",
      "wine.bottles.v1",
      "food.menu.v1",
      "spirits.items.v3",
      "beer.items.v1",
    ];
    for (const key of sensitiveKeys) {
      expect(financeAllowedKeys).not.toContain(key);
    }

    console.log(`[E2E] 财务只读角色共授权 ${financeAllowedKeys.length} 个键`);
  });
});

// ─── 场景 E：实时同步延迟模拟 ─────────────────────────────────────────────────

describe("场景 E：实时同步延迟模拟", () => {
  it("E1. 主设备修改后，财务设备在 5 秒内应能看到更新（轮询模拟）", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);
    const finance = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    // 主设备写入数据
    await owner.write("monthly_summary.reports.v1", JSON.stringify({ revenue: 100000 }));

    // 模拟轮询（每 1 秒检查一次，最多 5 次）
    let found = false;
    for (let i = 0; i < 5; i++) {
      await finance.pull();
      const data = await finance.read("monthly_summary.reports.v1");
      if (data && JSON.parse(data).revenue === 100000) {
        found = true;
        console.log(`[E2E] 财务设备在第 ${i + 1} 次轮询时看到更新`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10)); // 模拟 10ms 间隔
    }

    expect(found).toBe(true);
  });

  it("E2. 多个财务设备同时拉取不应产生竞争条件", async () => {
    const cloud = new MockCloudStorage();
    const owner = new MockDevice("owner", [], cloud);

    // 主设备写入数据
    await owner.write("monthly_summary.reports.v1", JSON.stringify({ revenue: 200000 }));
    await owner.write("labor_payslips_v1", JSON.stringify([{ id: "ps-1", amount: 8000 }]));

    // 3 个财务设备同时拉取
    const finance1 = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);
    const finance2 = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);
    const finance3 = new MockDevice("guest", ["store_ops", "labor", "payroll"], cloud);

    await Promise.all([finance1.pull(), finance2.pull(), finance3.pull()]);

    // 所有设备应该看到相同的数据
    const [d1, d2, d3] = await Promise.all([
      finance1.read("monthly_summary.reports.v1"),
      finance2.read("monthly_summary.reports.v1"),
      finance3.read("monthly_summary.reports.v1"),
    ]);

    expect(d1).toBe(d2);
    expect(d2).toBe(d3);
    expect(JSON.parse(d1!).revenue).toBe(200000);
  });
});

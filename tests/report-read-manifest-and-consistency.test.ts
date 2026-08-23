import { describe, expect, it, vi } from "vitest";
import { createReportReadRefreshController } from "@/lib/store/report-read-refresh-controller";
import { loadConsistentReportSnapshot } from "@/lib/store/report-read-consistent-snapshot";
import {
  BUILTIN_STORE_REPORT_MANIFEST,
  createReportReadManifestRegistry,
  resolveReportReadManifest,
  STORE_REPORT_MODEL_ID,
  type ReportReadManifest,
} from "@/lib/store/report-read-manifest";

const LEGACY_KEYS = [
  "store.revenue.v1", "store.petty.v1", "labor_employees_v1", "labor_payslips_v1", "labor_dept_order_v1",
  "labor_shifts_v1", "spirits.purchases.v3", "spirits.suppliers.v1", "food.purchases.v1",
  "store.petty_labor_links.v1", "wine.snapshots.v2", "wine.manual_purchases.v1",
].sort();

function manifest(id: string, modelId: string = STORE_REPORT_MODEL_ID, key = "equipment.inventory.v1"): ReportReadManifest {
  return {
    id,
    modelId,
    version: 1,
    segments: [{ id: `${id}.segment`, ownerFeatureId: "shop.equipment", storageKeys: [key as "equipment.inventory.v1"], decoderVersion: 1 }],
  };
}

const emptyFacts = { payslips: [], pettyRecords: [], purchases: [], inventory: [] };

describe("动态报表revision manifest", () => {
  it("内置 store.report manifest 与原固定12键严格等价", () => {
    const resolved = resolveReportReadManifest([BUILTIN_STORE_REPORT_MANIFEST]);
    expect(resolved.storageKeys).toEqual(LEGACY_KEYS);
  });

  it("解析结果对manifest和键输入顺序稳定排序", () => {
    const reversed: ReportReadManifest = {
      ...BUILTIN_STORE_REPORT_MANIFEST,
      segments: [...BUILTIN_STORE_REPORT_MANIFEST.segments].reverse(),
    };
    const left = resolveReportReadManifest([BUILTIN_STORE_REPORT_MANIFEST]);
    const right = resolveReportReadManifest([reversed]);
    expect(right.storageKeys).toEqual(left.storageKeys);
    expect(right.revisionNamespace).toBe(left.revisionNamespace);
  });

  it("受控内置模块可注册附加报表段，并使store.report revision命名空间失效", () => {
    const registry = createReportReadManifestRegistry({ builtins: [BUILTIN_STORE_REPORT_MANIFEST] });
    const before = registry.snapshot();
    registry.registerBuiltinExtension(manifest("builtin.equipment"));
    const after = registry.snapshot();

    expect(after.storageKeys).toContain("equipment.inventory.v1");
    expect(after.revisionNamespace).not.toBe(before.revisionNamespace);
  });

  it("拒绝未知键、所有者不符和与内置依赖重复的键", () => {
    const registry = createReportReadManifestRegistry({ builtins: [BUILTIN_STORE_REPORT_MANIFEST] });
    expect(() => registry.registerBuiltinExtension({
      id: "unknown", modelId: STORE_REPORT_MODEL_ID, version: 1,
      segments: [{ id: "unknown.segment", ownerFeatureId: "accounts.workspace", storageKeys: ["unknown.table.v1" as never], decoderVersion: 1 }],
    })).toThrow("REPORT_MANIFEST_UNKNOWN_STORAGE_KEY");
    expect(() => registry.registerBuiltinExtension({
      id: "wrong-owner", modelId: STORE_REPORT_MODEL_ID, version: 1,
      segments: [{ id: "wrong-owner.segment", ownerFeatureId: "inventory.spirits", storageKeys: ["store.revenue.v1"], decoderVersion: 1 }],
    })).toThrow("REPORT_MANIFEST_OWNER_MISMATCH");
    expect(() => registry.registerBuiltinExtension({
      id: "duplicate-key", modelId: STORE_REPORT_MODEL_ID, version: 1,
      segments: [{ id: "duplicate-key.segment", ownerFeatureId: "accounts.workspace", storageKeys: ["store.revenue.v1"], decoderVersion: 1 }],
    })).toThrow("REPORT_MANIFEST_DUPLICATE_STORAGE_KEY");
  });

  it("插件移除会使所属模型的revision namespace失效", () => {
    const registry = createReportReadManifestRegistry({
      builtins: [BUILTIN_STORE_REPORT_MANIFEST],
      pluginAllowlist: ["trusted-key"],
      verifyPluginSignature: () => true,
    });
    const before = registry.snapshot();
    registry.registerSignedPlugin({ keyId: "trusted-key", signature: "ok", manifest: manifest("plugin.cost") });
    const withPlugin = registry.snapshot();
    registry.unregisterPlugin("plugin.cost");
    const afterRemoval = registry.snapshot();

    expect(withPlugin.revisionNamespace).not.toBe(before.revisionNamespace);
    expect(afterRemoval.revisionNamespace).toBe(before.revisionNamespace);
    expect(afterRemoval).not.toBe(withPlugin);
  });

  it("未获白名单或签名校验失败的插件均不能注册", () => {
    const registry = createReportReadManifestRegistry({ pluginAllowlist: ["trusted-key"], verifyPluginSignature: () => false });
    expect(() => registry.registerSignedPlugin({ keyId: "unknown-key", signature: "bad", manifest: manifest("plugin.unknown") }))
      .toThrow("REPORT_PLUGIN_KEY_NOT_ALLOWLISTED");
    expect(() => registry.registerSignedPlugin({ keyId: "trusted-key", signature: "bad", manifest: manifest("plugin.bad-signature") }))
      .toThrow("REPORT_PLUGIN_SIGNATURE_INVALID");
  });

  it("单插件变更只通知其所属模型，不使无关模型缓存失效", () => {
    const registry = createReportReadManifestRegistry({
      builtins: [BUILTIN_STORE_REPORT_MANIFEST],
      pluginAllowlist: ["trusted-key"],
      verifyPluginSignature: () => true,
    });
    const storeBefore = registry.snapshot(STORE_REPORT_MODEL_ID);
    const otherBefore = registry.snapshot("other.report");
    const storeListener = vi.fn();
    const otherListener = vi.fn();
    registry.subscribe(STORE_REPORT_MODEL_ID, storeListener);
    registry.subscribe("other.report", otherListener);

    registry.registerSignedPlugin({ keyId: "trusted-key", signature: "ok", manifest: manifest("plugin.other", "other.report") });
    expect(storeListener).not.toHaveBeenCalled();
    expect(otherListener).toHaveBeenCalledTimes(1);
    expect(registry.snapshot(STORE_REPORT_MODEL_ID)).toBe(storeBefore);
    expect(registry.snapshot("other.report")).not.toBe(otherBefore);
  });
});

describe("双读revision与generation ticket协同", () => {
  it("revision在事实读取期间变化时丢弃混合快照并重试稳定版本", async () => {
    const resolved = resolveReportReadManifest([BUILTIN_STORE_REPORT_MANIFEST]);
    const revisionKeys = resolved.storageKeys.map((key) => `sync.ts.${key}`);
    let call = 0;
    const storage = {
      multiGet: vi.fn(async (keys: readonly string[]) => {
        call += 1;
        const revision = call >= 3 ? "2" : "1";
        if (keys[0]?.startsWith("sync.ts.")) return keys.map((key) => [key, revision] as [string, string]);
        const amount = call >= 5 ? 20 : 10;
        return keys.map((key) => [key, key === "store.revenue.v1" ? JSON.stringify({ records: [{ date: "2026-08-01", category: "cash", amount }] }) : null] as [string, string | null]);
      }),
    };
    const controller = createReportReadRefreshController();
    const ticket = controller.begin();
    const result = await loadConsistentReportSnapshot({
      storage,
      manifest: resolved,
      ticket,
      guard: controller,
      decode: (snapshot) => ({ ...emptyFacts, revenueRecords: JSON.parse(snapshot.get("store.revenue.v1") ?? "{\"records\":[]}").records }),
    });

    expect(result).toEqual(expect.objectContaining({ attempts: 2, unchanged: false }));
    expect(result?.facts?.revenueRecords?.[0]?.amount).toBe(20);
    expect(storage.multiGet).toHaveBeenCalledWith(revisionKeys);
  });

  it("generation ticket在旧读取完成前失效时禁止任何事实提交", async () => {
    const resolved = resolveReportReadManifest([BUILTIN_STORE_REPORT_MANIFEST]);
    const delayedRead: { release: (() => void) | null } = { release: null };
    const storage = {
      multiGet: vi.fn(() => new Promise<readonly [string, string | null][]>((resolve) => { delayedRead.release = () => resolve([]); })),
    };
    const controller = createReportReadRefreshController();
    const oldTicket = controller.begin();
    const pending = loadConsistentReportSnapshot({ storage, manifest: resolved, ticket: oldTicket, guard: controller, decode: () => emptyFacts });
    controller.begin();
    const finish = delayedRead.release;
    if (!finish) throw new Error("旧revision读取未启动");
    finish();

    await expect(pending).resolves.toBeNull();
  });
});

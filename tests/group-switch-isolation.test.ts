import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, storage.get(key) ?? null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      pairs.forEach(([key, value]) => storage.set(key, value));
    }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); }),
  },
}));

import {
  SYNC_KEYS,
  __resetGroupSwitchBarrierForTests,
  beginGroupSwitchWriteBarrier,
  completeGroupSwitchWriteBarrier,
  hydrateTargetGroupSnapshot,
  isGroupSwitchWriteBarrierActive,
  notifySyncChange,
  runInitialSync,
  type TargetGroupSnapshot,
} from "@/lib/sync/engine";

const A_MARKER = "__GROUP_A_PRIVATE__c72f4784";
const B_MARKER = "__GROUP_B_PRIVATE__c6ef4b9c";
const GROUP_A = "group-a";
const GROUP_B = "group-b";

function aValue(key: string): string {
  return JSON.stringify({ group: GROUP_A, key, marker: A_MARKER, nested: [{ marker: A_MARKER }] });
}

function bValue(key: string): string {
  return JSON.stringify({ group: GROUP_B, key, marker: B_MARKER, nested: [{ marker: B_MARKER }] });
}

async function seedA(): Promise<void> {
  for (const key of SYNC_KEYS) {
    storage.set(key, aValue(key));
    storage.set(`sync.ts.${key}`, "1730000000000");
  }
  storage.set("sync.dirtyKeys.pending", JSON.stringify([...SYNC_KEYS]));
  storage.set("sync.lastPulledAt", "1730000000000");
}

function snapshotForB(keys: string[]): TargetGroupSnapshot {
  return {
    groupId: GROUP_B,
    revision: "revision-b-1",
    complete: true,
    presentKeys: keys,
    entries: keys.map((storageKey, index) => ({
      storageKey,
      value: bValue(storageKey),
      clientUpdatedAt: 1740000000000 + index,
    })),
  };
}

describe("同步组切换：目标组完整水合隔离", () => {
  beforeEach(() => {
    storage.clear();
    __resetGroupSwitchBarrierForTests();
    vi.clearAllMocks();
  });

  it("A组全部业务数据、时间戳和脏键均不会进入B组", async () => {
    await seedA();
    const epoch = await beginGroupSwitchWriteBarrier("switch-a-to-b");

    // 模拟被卸载组件的陈旧保存回调：屏障期间不得产生新的脏键。
    notifySyncChange("spirits.ledger.v3");

    const keptKeys = ["cocktail.recipes", "spirits.ledger.v3", "labor_payslips_v1"];
    const result = await hydrateTargetGroupSnapshot(snapshotForB(keptKeys), GROUP_B, epoch);

    expect(result.written).toBe(keptKeys.length);
    expect(result.removed).toBe(SYNC_KEYS.length - keptKeys.length);
    expect(isGroupSwitchWriteBarrierActive()).toBe(true);
    expect(storage.get("sync.dirtyKeys.pending")).toBeUndefined();
    expect(storage.get("sync.lastPulledAt")).toBeUndefined();

    for (const key of SYNC_KEYS) {
      const value = storage.get(key);
      const timestamp = storage.get(`sync.ts.${key}`);
      expect(value ?? "").not.toContain(A_MARKER);
      expect(timestamp).not.toBe("1730000000000");
      if (keptKeys.includes(key)) {
        expect(value).toBe(bValue(key));
        expect(timestamp).toMatch(/^174000000000/);
      } else {
        expect(value).toBeUndefined();
        expect(timestamp).toBeUndefined();
      }
    }
  });

  it("屏障期间禁止常规LWW同步、字段合并和普通推送入口", async () => {
    await seedA();
    const epoch = await beginGroupSwitchWriteBarrier("switch-regular-sync-denied");

    await expect(runInitialSync([], vi.fn())).rejects.toThrow("SYNC_GROUP_SWITCH_IN_PROGRESS");
    expect(isGroupSwitchWriteBarrierActive()).toBe(true);

    await hydrateTargetGroupSnapshot(snapshotForB(["spirits.ledger.v3"]), GROUP_B, epoch);
    const nextPush = vi.fn(async () => undefined);
    completeGroupSwitchWriteBarrier(epoch, nextPush);

    expect(isGroupSwitchWriteBarrierActive()).toBe(false);
    expect(nextPush).not.toHaveBeenCalled();
  });

  it("不完整、错组、未知键或清单不一致的目标快照都不可覆盖A组数据", async () => {
    const invalidSnapshots: Array<Partial<TargetGroupSnapshot>> = [
      { complete: false as never },
      { groupId: GROUP_A },
      { presentKeys: ["unknown.sync.key"], entries: [] },
      { presentKeys: ["spirits.ledger.v3"], entries: [] },
    ];

    for (const invalid of invalidSnapshots) {
      storage.clear();
      __resetGroupSwitchBarrierForTests();
      await seedA();
      const epoch = await beginGroupSwitchWriteBarrier(`switch-invalid-${Math.random()}`);
      const base = snapshotForB(["spirits.ledger.v3"]);

      await expect(hydrateTargetGroupSnapshot({ ...base, ...invalid } as TargetGroupSnapshot, GROUP_B, epoch))
        .rejects.toThrow();
      expect(storage.get("spirits.ledger.v3")).toContain(A_MARKER);
      expect(storage.get("sync.ts.spirits.ledger.v3")).toBe("1730000000000");
      expect(isGroupSwitchWriteBarrierActive()).toBe(true);
    }
  });

  it("旧epoch的陈旧异步任务无法覆盖新切换会话", async () => {
    await seedA();
    const oldEpoch = await beginGroupSwitchWriteBarrier("switch-old");
    const currentEpoch = await beginGroupSwitchWriteBarrier("switch-current");

    await expect(hydrateTargetGroupSnapshot(snapshotForB(["cocktail.recipes"]), GROUP_B, oldEpoch))
      .rejects.toThrow("SYNC_GROUP_SWITCH_WRITE_BLOCKED");
    expect(storage.get("cocktail.recipes")).toContain(A_MARKER);

    await hydrateTargetGroupSnapshot(snapshotForB(["cocktail.recipes"]), GROUP_B, currentEpoch);
    expect(storage.get("cocktail.recipes")).toBe(bValue("cocktail.recipes"));
  });
});

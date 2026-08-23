import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, storageApi } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    storage: values,
    storageApi: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn(async (key: string) => { values.delete(key); }),
      multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, values.get(key) ?? null] as [string, string | null])),
      multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([key, value]) => values.set(key, value)); }),
      multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => values.delete(key)); }),
    },
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storageApi }));

import { SYNC_KEYS, backupLocalData, runInitialSync } from "@/lib/sync/engine";

describe("首次同步批量 I/O", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("首次同步以一个 multiGet 读取业务键与时间戳快照，而不逐键读取 95 个同步键", async () => {
    storage.set("cocktail.recipes", JSON.stringify([{ id: "local" }]));
    storage.set("sync.ts.cocktail.recipes", "1800000000000");
    const push = vi.fn(async () => undefined);

    await runInitialSync([], push);

    expect(storageApi.multiGet).toHaveBeenCalledTimes(1);
    expect(storageApi.multiGet).toHaveBeenCalledWith(expect.arrayContaining([
      "cocktail.recipes", "sync.ts.cocktail.recipes", "wine.bottles.v1", "sync.ts.wine.bottles.v1",
    ]));
    expect(storageApi.multiGet.mock.calls[0][0]).toHaveLength(SYNC_KEYS.length * 2);
    expect(push).toHaveBeenCalledWith([expect.objectContaining({ storageKey: "cocktail.recipes", clientUpdatedAt: 1800000000000 })]);
  });

  it("自动备份同样以一次 multiGet 采集全部业务键，保留完整可恢复快照", async () => {
    storage.set("wine.bottles.v1", JSON.stringify([{ id: "wine-1" }]));
    await backupLocalData();

    expect(storageApi.multiGet).toHaveBeenCalledTimes(1);
    expect(storageApi.multiGet).toHaveBeenCalledWith([...SYNC_KEYS]);
    const backup = JSON.parse(storage.get("sync.backup.v1") ?? "{}");
    expect(backup.data["wine.bottles.v1"]).toContain("wine-1");
    expect(Object.keys(backup.data)).toHaveLength(SYNC_KEYS.length);
  });
});

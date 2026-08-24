import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storage, storageApi, reloadHandlers, rejectedKeys, notifySyncChange } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const handlers = new Set<() => void>();
  const rejected = new Set<string>();
  const rejectIfNeeded = (key: string) => {
    if (rejected.has(key)) throw new Error(`storage unavailable: ${key}`);
  };

  return {
    storage: values,
    rejectedKeys: rejected,
    reloadHandlers: handlers,
    notifySyncChange: vi.fn(),
    storageApi: {
      getItem: vi.fn(async (key: string) => {
        rejectIfNeeded(key);
        return values.get(key) ?? null;
      }),
      multiGet: vi.fn(async (keys: readonly string[]) => {
        rejectIfNeeded("__multiGet__");
        return keys.map((key) => [key, values.get(key) ?? null] as [string, string | null]);
      }),
      setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      multiSet: vi.fn(async (pairs: readonly [string, string][]) => { pairs.forEach(([key, value]) => values.set(key, value)); }),
    },
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storageApi }));
vi.mock("@/lib/sync/engine", () => ({
  notifySyncChange,
  registerStoreReload: vi.fn((handler: () => void) => {
    reloadHandlers.add(handler);
    return () => reloadHandlers.delete(handler);
  }),
}));

import { BottleProvider, useBottleStore } from "@/lib/bottles/store";
import { SpiritsInventoryProvider, useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { WineProvider, useWineStore } from "@/lib/wine/store";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BottleStore = ReturnType<typeof useBottleStore>;
type SpiritsStore = ReturnType<typeof useSpiritsInventoryStore>;
type WineStore = ReturnType<typeof useWineStore>;

function BottleCapture({ onValue }: { onValue: (value: BottleStore) => void }) {
  const value = useBottleStore();
  useEffect(() => { onValue(value); }, [onValue, value]);
  return null;
}

function SpiritsCapture({ onValue }: { onValue: (value: SpiritsStore) => void }) {
  const value = useSpiritsInventoryStore();
  useEffect(() => { onValue(value); }, [onValue, value]);
  return null;
}

function WineCapture({ onValue }: { onValue: (value: WineStore) => void }) {
  const value = useWineStore();
  useEffect(() => { onValue(value); }, [onValue, value]);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("关键数据Provider真实React水合与重载稳定性", () => {
  let renderer: ReactTestRenderer | null = null;
  let warning: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    storage.clear();
    rejectedKeys.clear();
    reloadHandlers.clear();
    vi.clearAllMocks();
    warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    warning?.mockRestore();
    warning = null;
  });

  it("鸡尾酒酒库同步重载时消费AsyncStorage拒绝，保留已水合状态而不抛出未处理Promise", async () => {
    const capture: { current: BottleStore | null } = { current: null };
    await act(async () => {
      renderer = create(<BottleProvider><BottleCapture onValue={(value) => { capture.current = value; }} /></BottleProvider>);
    });
    await flush();
    expect(capture.current?.ready).toBe(true);

    rejectedKeys.add("cocktail.bottles");
    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();

    expect(capture.current?.ready).toBe(true);
    expect(warning).toHaveBeenCalledWith("酒款同步重载失败", expect.any(Error));
  });

  it("烈酒库存遇到单个损坏JSON时仍完成Provider渲染，并在重载读取失败时留在安全状态", async () => {
    storage.set("spirits.items.v3", "{malformed");
    const capture: { current: SpiritsStore | null } = { current: null };
    await act(async () => {
      renderer = create(<SpiritsInventoryProvider><SpiritsCapture onValue={(value) => { capture.current = value; }} /></SpiritsInventoryProvider>);
    });
    await flush();

    expect(capture.current?.items).toEqual([]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("烈酒库存数据解析失败"), expect.any(Error));

    rejectedKeys.add("spirits.items.v3");
    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();

    expect(capture.current?.items).toEqual([]);
    expect(warning).toHaveBeenCalledWith("烈酒库存加载失败", expect.any(Error));
  });

  it("葡萄酒五个事实源同时读取失败时，真实Provider仍完成水合并接受后续重载", async () => {
    for (const key of [
      "wine.bottles.v1",
      "wine.snapshots.v2",
      "wine.manual_purchases.v1",
      "wine.import_control.v1",
      "wine.master_data.v1",
    ]) rejectedKeys.add(key);

    const capture: { current: WineStore | null } = { current: null };
    await act(async () => {
      renderer = create(<WineProvider><WineCapture onValue={(value) => { capture.current = value; }} /></WineProvider>);
    });
    await flush();

    expect(capture.current?.bottles).toEqual([]);
    expect(storageApi.getItem).toHaveBeenCalledTimes(5);
    expect(warning).toHaveBeenCalledWith("葡萄酒库存档案加载失败", expect.any(Error));
    expect(warning).toHaveBeenCalledWith("葡萄酒库存快照加载失败", expect.any(Error));
    expect(warning).toHaveBeenCalledWith("葡萄酒采购记录加载失败", expect.any(Error));
    expect(warning).toHaveBeenCalledWith("葡萄酒采购导入控制数据加载失败", expect.any(Error));
    expect(warning).toHaveBeenCalledWith("葡萄酒采购主数据加载失败", expect.any(Error));

    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();
    expect(storageApi.getItem).toHaveBeenCalledTimes(10);
    expect(capture.current?.bottles).toEqual([]);
  });
});

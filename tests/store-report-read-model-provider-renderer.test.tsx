import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storage, storageApi, reloadHandlers } = vi.hoisted(() => {
  const values = new Map<string, string>();
  const handlers = new Set<() => void>();
  return {
    storage: values,
    storageApi: {
      multiGet: vi.fn(async (keys: readonly string[]) => keys.map((key) => [key, values.get(key) ?? null] as [string, string | null])),
    },
    reloadHandlers: handlers,
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storageApi }));
vi.mock("@/lib/sync/engine", () => ({
  registerStoreReload: vi.fn((handler: () => void) => {
    reloadHandlers.add(handler);
    return () => reloadHandlers.delete(handler);
  }),
}));
vi.mock("@/lib/months/global-business-month", () => ({
  useGlobalBusinessMonth: () => ({ month: "2026-08" }),
}));

import {
  StoreReportReadModelProvider,
  useStoreReportReadModel,
} from "@/components/providers/StoreReportReadModelProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ReportContext = ReturnType<typeof useStoreReportReadModel>;
const reportKeys = [
  "store.revenue.v1", "store.petty.v1", "labor_employees_v1", "labor_payslips_v1", "labor_dept_order_v1",
  "labor_shifts_v1", "spirits.purchases.v3", "spirits.suppliers.v1", "food.purchases.v1",
  "store.petty_labor_links.v1", "wine.snapshots.v2", "wine.manual_purchases.v1",
] as const;

function seedRevision(revision: string, revenue: number) {
  for (const key of reportKeys) storage.set(`sync.ts.${key}`, revision);
  storage.set("store.revenue.v1", JSON.stringify({ records: [{ date: "2026-08-01", category: "cash", amount: revenue }] }));
  storage.set("store.petty.v1", JSON.stringify({ records: [] }));
}

function Capture({ onValue }: { onValue: (value: ReportContext) => void }) {
  const value = useStoreReportReadModel();
  useEffect(() => { onValue(value); }, [onValue, value]);
  return null;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("报表只读快照 Provider 渲染器刷新", () => {
  let renderer: ReactTestRenderer | null = null;
  let latest: ReportContext | null = null;

  beforeEach(() => {
    storage.clear();
    reloadHandlers.clear();
    vi.clearAllMocks();
    seedRevision("1", 10);
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    latest = null;
  });

  async function mount() {
    await act(async () => {
      renderer = create(<StoreReportReadModelProvider><Capture onValue={(value) => { latest = value; }} /></StoreReportReadModelProvider>);
    });
    await flush();
    expect(latest?.ready).toBe(true);
    return latest!;
  }

  it("相同 revision 的 reload 只读取轻量修订键，不重复读取和解析大事实载荷", async () => {
    await mount();
    const callsAfterInitialLoad = storageApi.multiGet.mock.calls.length;

    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();

    expect(storageApi.multiGet.mock.calls).toHaveLength(callsAfterInitialLoad + 2);
    const postReloadReads = storageApi.multiGet.mock.calls.slice(callsAfterInitialLoad).map(([keys]) => keys);
    expect(postReloadReads).toHaveLength(2);
    expect(postReloadReads).toEqual(postReloadReads.map(() => expect.arrayContaining(["sync.ts.store.revenue.v1"])));
    expect(postReloadReads.every((keys) => !keys.includes("store.revenue.v1"))).toBe(true);
  });

  it("慢旧 revision 完成后不能覆盖最新 revision 的物化模型", async () => {
    await mount();
    seedRevision("2", 20);
    const delayedPayload: { release: (() => void) | null } = { release: null };
    const baseMultiGet = storageApi.multiGet.getMockImplementation();
    storageApi.multiGet.mockImplementation((keys: readonly string[]) => {
      const isPayload = keys.includes("store.revenue.v1");
      if (isPayload && !delayedPayload.release) {
        const delayedRows = keys.map((key) => [key, key === "store.revenue.v1"
          ? JSON.stringify({ records: [{ date: "2026-08-01", category: "cash", amount: 20 }] })
          : storage.get(key) ?? null] as [string, string | null]);
        return new Promise<[string, string | null][]>((resolve) => { delayedPayload.release = () => resolve(delayedRows); });
      }
      return baseMultiGet?.(keys) ?? Promise.resolve([]);
    });

    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();
    seedRevision("3", 30);
    await act(async () => { reloadHandlers.forEach((handler) => handler()); });
    await flush();
    expect(latest?.model.analyticsByDate[0]?.amounts.cash).toBe(30);

    const release = delayedPayload.release;
    if (!release) throw new Error("旧载荷读取未进入延迟状态");
    await act(async () => { release(); });
    await flush();
    expect(latest?.model.analyticsByDate[0]?.amounts.cash).toBe(30);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY,
  ArchiveMutationCoordinator,
  ArchiveRemoteIndex,
} from "@/lib/store/monthly-report/archive-sync-coordinator";

const request = {
  endpoint: "https://sync.example.invalid/api/archives/commit",
  accessToken: "never-persist-this-token",
  operationId: "op-power-loss-1",
  body: {
    entryId: "entry-power-loss-1",
    parentRevision: 0,
    objectKey: "groups/g1/monthly-raw/2026-08/revenue/1.xlsx",
    localSourceUri: "file:///Documents/monthly-raw/2026-08/revenue/1.xlsx",
  },
} as const;

function createPersistentHarness() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  const index: ArchiveRemoteIndex = { entries: [], fetchedAt: 1_700_000_000_000 };
  const indexApi = { fetchAuthoritativeIndex: vi.fn(async () => index) };
  return { values, storage, indexApi };
}

describe("归档协调器outbox断电恢复", () => {
  it("断电发生在操作入队后：新进程从持久化pending恢复提交，且令牌与Base64从未写入AsyncStorage", async () => {
    const { values, storage, indexApi } = createPersistentHarness();
    const beforePowerLoss = new ArchiveMutationCoordinator(
      storage,
      indexApi,
      async () => "first-session-token",
      fetch,
      () => 1_700_000_000_100,
    );
    await beforePowerLoss.enqueue(request);

    const serialized = values.get(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY);
    expect(serialized).toContain("op-power-loss-1");
    expect(serialized).toContain("localSourceUri");
    expect(serialized).not.toContain("never-persist-this-token");
    expect(serialized).not.toContain("first-session-token");
    expect(serialized).not.toContain("dataBase64");

    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      entryId: "entry-power-loss-1",
      revision: 1,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const afterRestart = new ArchiveMutationCoordinator(
      storage,
      indexApi,
      async () => "fresh-session-token",
      fetcher,
      () => 1_700_000_000_200,
      async (item) => ({ ...item.request.body, dataBase64: "transient-base64" }),
    );

    await expect(afterRestart.resumePending()).resolves.toEqual([
      expect.objectContaining({ status: "committed" }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(values.get(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY) ?? "[]") as Array<{ state: string }>;
    expect(persisted).toEqual([expect.objectContaining({ state: "committed" })]);
  });

  it("断电发生在applying或retry_scheduled：新进程只恢复应恢复项，终态deleted和conflict绝不自动复活", async () => {
    const { storage, indexApi } = createPersistentHarness();
    await storage.setItem(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY, JSON.stringify([
      {
        operationId: "op-applying",
        entryId: "entry-applying",
        request: { endpoint: request.endpoint, operationId: "op-applying", body: { entryId: "entry-applying" } },
        state: "applying",
        retryAttempt: 1,
        nextRetryAt: null,
        authoritativeRevision: null,
        terminalReason: null,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        operationId: "op-retry-later",
        entryId: "entry-retry-later",
        request: { endpoint: request.endpoint, operationId: "op-retry-later", body: { entryId: "entry-retry-later" } },
        state: "retry_scheduled",
        retryAttempt: 1,
        nextRetryAt: 9_999,
        authoritativeRevision: null,
        terminalReason: null,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        operationId: "op-deleted",
        entryId: "entry-deleted",
        request: { endpoint: request.endpoint, operationId: "op-deleted", body: { entryId: "entry-deleted" } },
        state: "deleted",
        retryAttempt: 0,
        nextRetryAt: null,
        authoritativeRevision: 5,
        terminalReason: "remote_deleted",
        createdAt: 1,
        updatedAt: 2,
      },
      {
        operationId: "op-conflict",
        entryId: "entry-conflict",
        request: { endpoint: request.endpoint, operationId: "op-conflict", body: { entryId: "entry-conflict" } },
        state: "conflict",
        retryAttempt: 0,
        nextRetryAt: null,
        authoritativeRevision: 4,
        terminalReason: "revision_conflict",
        createdAt: 1,
        updatedAt: 2,
      },
    ]));

    const fetcher = vi.fn(async () => new Response(JSON.stringify({ entryId: "entry-applying", revision: 2 }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    const afterRestart = new ArchiveMutationCoordinator(
      storage,
      indexApi,
      async () => "fresh-session-token",
      fetcher,
      () => 5_000,
    );

    await expect(afterRestart.resumePending()).resolves.toEqual([
      expect.objectContaining({ status: "committed", outcome: expect.objectContaining({ entryId: "entry-applying" }) }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const states = (await afterRestart.list()).map((item) => [item.operationId, item.state]);
    expect(states).toEqual(expect.arrayContaining([
      ["op-applying", "committed"],
      ["op-retry-later", "retry_scheduled"],
      ["op-deleted", "deleted"],
      ["op-conflict", "conflict"],
    ]));
  });
});

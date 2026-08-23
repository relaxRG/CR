import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY,
  ArchiveMutationCoordinator,
  ArchiveRemoteIndex,
} from "@/lib/store/monthly-report/archive-sync-coordinator";

const request = {
  endpoint: "https://sync.example.invalid/api/archives/commit",
  accessToken: "ephemeral-device-token",
  operationId: "op-archive-1",
  body: {
    entryId: "entry-1",
    parentRevision: 2,
    objectKey: "groups/g1/monthly-raw/2026-08/revenue/1.xlsx",
  },
} as const;

function createHarness(response: Response) {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
  const authoritative: ArchiveRemoteIndex = {
    entries: [{
      entryId: "entry-1",
      revision: 4,
      status: "active",
      objectKey: "groups/g1/monthly-raw/2026-08/revenue/4.xlsx",
    }],
    fetchedAt: 1_700_000_000_000,
  };
  const indexApi = { fetchAuthoritativeIndex: vi.fn(async () => authoritative) };
  const fetcher = vi.fn(async () => response);
  const coordinator = new ArchiveMutationCoordinator(
    storage,
    indexApi,
    async () => "fresh-session-token",
    fetcher,
    () => 1_700_000_000_100,
  );
  return { coordinator, storage, values, indexApi, fetcher, authoritative };
}

async function createConflict(response?: Response, expectedStatus: "conflict" | "deleted" = "conflict") {
  const harness = createHarness(response ?? new Response(JSON.stringify({
    code: "ARCHIVE_REVISION_CONFLICT",
    currentRevision: 4,
    currentStatus: "active",
  }), { status: 409, headers: { "content-type": "application/json" } }));
  await harness.coordinator.enqueue(request);
  const result = await harness.coordinator.apply(request.operationId);
  expect(result.status).toBe(expectedStatus);
  return harness;
}

describe("归档对象远端协调器与本地outbox", () => {
  it("查看云端版本：409后刷新权威索引，保留终态冲突，不重放条件写入", async () => {
    const { coordinator, indexApi, fetcher, authoritative } = await createConflict();

    const resolution = await coordinator.viewRemote(request.operationId);

    expect(resolution).toEqual({ strategy: "view_remote", index: authoritative });
    expect(indexApi.fetchAuthoritativeIndex).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(coordinator.list()).resolves.toEqual([
      expect.objectContaining({
        operationId: request.operationId,
        state: "conflict",
        terminalReason: "revision_conflict",
        authoritativeRevision: 4,
      }),
    ]);
  });

  it("重新导入为新条目：旧冲突操作被放弃，新operation与新entry保持待提交，不复活旧revision", async () => {
    const { coordinator, values, fetcher } = await createConflict();
    const replacement = {
      ...request,
      accessToken: "another-ephemeral-token",
      operationId: "op-archive-2",
      body: {
        ...request.body,
        entryId: "entry-2",
        parentRevision: 0,
        objectKey: "groups/g1/monthly-raw/2026-08/revenue/2.xlsx",
      },
    } as const;

    const resolution = await coordinator.reimportAsNewEntry(request.operationId, replacement);

    expect(resolution).toEqual(expect.objectContaining({
      strategy: "reimport_new",
      source: expect.objectContaining({ state: "conflict", entryId: "entry-1" }),
      replacement: expect.objectContaining({ state: "pending", entryId: "entry-2", operationId: "op-archive-2" }),
    }));
    await expect(coordinator.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: "op-archive-1", state: "abandoned" }),
      expect.objectContaining({ operationId: "op-archive-2", state: "pending" }),
    ]));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(values.get(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY)).not.toContain("ephemeral-device-token");
    expect(values.get(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY)).not.toContain("another-ephemeral-token");
  });

  it("放弃本机副本：已删除终态不重试，outbox只改变本地操作状态且不改动服务端墓碑", async () => {
    const { coordinator, fetcher, indexApi } = await createConflict(new Response(JSON.stringify({
      code: "ENTRY_DELETED",
      tombstoneRevision: 5,
    }), { status: 409, headers: { "content-type": "application/json" } }), "deleted");

    const resolution = await coordinator.discardLocalCopy(request.operationId);

    expect(resolution).toEqual(expect.objectContaining({
      strategy: "discard_local",
      discarded: expect.objectContaining({
        state: "abandoned",
        terminalReason: "abandoned",
        authoritativeRevision: 5,
      }),
    }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(indexApi.fetchAuthoritativeIndex).toHaveBeenCalledTimes(1);
    await expect(coordinator.list()).resolves.toEqual([
      expect.objectContaining({ state: "abandoned", terminalReason: "abandoned" }),
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildArchiveConflictViewModel } from "@/lib/store/monthly-report/archive-conflict-view-model";
import type { ArchiveFetch } from "@/lib/store/monthly-report/archive-remote-client";
import {
  ArchiveMutationCoordinator,
  ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY,
  type ArchiveOutboxStorage,
} from "@/lib/store/monthly-report/archive-sync-coordinator";

type DeviceStorage = ArchiveOutboxStorage & { values: Map<string, string> };

function createDeviceStorage(): DeviceStorage {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  } as DeviceStorage;
}

type ServerState = { revision: number; entryId: string };
function createConditionalArchiveServer(state: ServerState) {
  const mock = vi.fn(async (_input: Parameters<ArchiveFetch>[0], init?: Parameters<ArchiveFetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as { entryId: string; parentRevision: number };
    if (body.entryId === state.entryId && body.parentRevision !== state.revision) {
      return new Response(JSON.stringify({
        code: "ARCHIVE_REVISION_CONFLICT",
        currentRevision: state.revision,
        currentStatus: "active",
      }), { status: 409, headers: { "content-type": "application/json" } });
    }
    state.entryId = body.entryId;
    state.revision = body.parentRevision + 1;
    return new Response(JSON.stringify({ entryId: body.entryId, revision: state.revision }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  return { mock, fetcher: mock as unknown as ArchiveFetch };
}

const request = (operationId: string) => ({
  endpoint: "https://worker.example/api/archives/commit",
  operationId,
  accessToken: "ephemeral-device-token",
  body: {
    entryId: "entry-shared",
    parentRevision: 0,
    month: "2026-08",
    fileType: "overview",
    filename: "August.xlsx",
    dataBase64: "QUJD",
  },
});

describe("多设备归档并发提交端到端模拟", () => {
  it("设备A先提交成功；设备B以旧revision提交收到409、刷新权威索引并切换到冲突UI；冲突项不得自动重试", async () => {
    const server = { revision: 0, entryId: "entry-shared" };
    const { mock: fetcherMock, fetcher } = createConditionalArchiveServer(server);
    const indexApi = {
      fetchAuthoritativeIndex: vi.fn(async () => ({
        entries: [{ entryId: server.entryId, revision: server.revision, status: "active" as const, objectKey: "groups/g/monthly-raw/objects/entry-shared-op-a.xlsx" }],
        fetchedAt: 100,
      })),
    };
    const deviceA = new ArchiveMutationCoordinator(createDeviceStorage(), indexApi, async () => "token-a", fetcher, () => 100);
    const deviceBStorage = createDeviceStorage();
    const deviceB = new ArchiveMutationCoordinator(deviceBStorage, indexApi, async () => "token-b", fetcher, () => 100);

    await deviceA.enqueue(request("op-device-a"));
    await expect(deviceA.apply("op-device-a")).resolves.toEqual(expect.objectContaining({
      status: "committed",
      outcome: expect.objectContaining({ revision: 1 }),
    }));

    await deviceB.enqueue(request("op-device-b"));
    const conflict = await deviceB.apply("op-device-b");
    expect(conflict).toEqual(expect.objectContaining({
      status: "conflict",
      outcome: expect.objectContaining({ currentRevision: 1, currentStatus: "active" }),
      index: expect.objectContaining({ entries: [expect.objectContaining({ revision: 1 })] }),
    }));
    expect(indexApi.fetchAuthoritativeIndex).toHaveBeenCalledTimes(1);

    if (conflict.status !== "conflict" || conflict.outcome.status !== "conflict") throw new Error("预期设备B进入冲突状态");
    const view = buildArchiveConflictViewModel({ status: "conflict", outcome: conflict.outcome, index: conflict.index });
    expect(view).toEqual(expect.objectContaining({
      title: "另一台设备已更新归档",
      revision: 1,
      terminalDeleted: false,
      actions: ["view_remote", "reimport_as_new", "discard_local"],
    }));
    await expect(deviceB.apply("op-device-b")).rejects.toThrow("不可再次提交");
    expect(fetcherMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(deviceBStorage.values.get(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY) ?? "[]"))
      .toEqual([expect.objectContaining({ state: "conflict", authoritativeRevision: 1, terminalReason: "revision_conflict" })]);
  });
});

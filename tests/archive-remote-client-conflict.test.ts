import { describe, expect, it, vi } from "vitest";
import { commitArchiveMutation } from "@/lib/store/monthly-report/archive-remote-client";

const request = {
  endpoint: "https://sync.example.invalid/api/archives/commit",
  accessToken: "test-device-token",
  operationId: "op-archive-1",
  body: { entryId: "entry-1", parentRevision: 2, objectKey: "groups/g1/monthly-raw/2026-08/revenue/1.xlsx" },
} as const;

describe("归档对象客户端并发冲突处理", () => {
  it("409 ARCHIVE_REVISION_CONFLICT 保留操作标识和权威revision，且不盲目重试", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: "ARCHIVE_REVISION_CONFLICT",
      currentRevision: 4,
      currentStatus: "active",
    }), { status: 409, headers: { "content-type": "application/json" } }));

    const outcome = await commitArchiveMutation(request, fetcher);

    expect(outcome).toEqual({
      status: "conflict",
      currentRevision: 4,
      currentStatus: "active",
      operationId: "op-archive-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(request.endpoint, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "idempotency-key": "op-archive-1" }),
    }));
  });

  it("409 ENTRY_DELETED 是终态：旧离线条目不能重试并复活已经删除的归档", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: "ENTRY_DELETED",
      tombstoneRevision: 5,
    }), { status: 409, headers: { "content-type": "application/json" } }));

    await expect(commitArchiveMutation(request, fetcher)).resolves.toEqual({
      status: "deleted",
      tombstoneRevision: 5,
      operationId: "op-archive-1",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("提交成功时返回服务端revision，网络异常才标记为可重试", async () => {
    const success = await commitArchiveMutation(request, async () => new Response(JSON.stringify({
      entryId: "entry-1",
      revision: 3,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    expect(success).toEqual({ status: "committed", entryId: "entry-1", revision: 3 });

    const retryable = await commitArchiveMutation(request, async () => {
      throw new Error("offline");
    });
    expect(retryable).toEqual({
      status: "failed",
      retryable: true,
      operationId: "op-archive-1",
      message: "offline",
    });
  });
});

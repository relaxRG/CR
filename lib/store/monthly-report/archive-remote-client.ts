export type ArchiveMutationRequest = Readonly<{
  endpoint: string;
  accessToken: string;
  operationId: string;
  body: Readonly<Record<string, unknown>>;
}>;

export type ArchiveMutationOutcome =
  | Readonly<{ status: "committed"; entryId: string; revision: number }>
  | Readonly<{ status: "conflict"; currentRevision: number; currentStatus: "active" | "deleted"; operationId: string }>
  | Readonly<{ status: "deleted"; tombstoneRevision: number; operationId: string }>
  | Readonly<{ status: "forbidden"; operationId: string }>
  | Readonly<{ status: "failed"; retryable: boolean; operationId: string; message: string }>;

export type ArchiveFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ErrorPayload = Readonly<{
  code?: unknown;
  currentRevision?: unknown;
  currentStatus?: unknown;
  tombstoneRevision?: unknown;
  message?: unknown;
}>;

function asNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

async function parsePayload(response: Response): Promise<ErrorPayload> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" ? payload as ErrorPayload : {};
  } catch {
    return {};
  }
}

/**
 * 归档对象的客户端条件写入。409 永远不会自动重试：调用方必须先刷新权威索引，
 * 再由用户决定以新条目重新导入还是放弃本地离线修改。
 */
export async function commitArchiveMutation(
  request: ArchiveMutationRequest,
  fetcher: ArchiveFetch = fetch,
): Promise<ArchiveMutationOutcome> {
  let response: Response;
  try {
    response = await fetcher(request.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.accessToken}`,
        "content-type": "application/json",
        "idempotency-key": request.operationId,
      },
      body: JSON.stringify({ ...request.body, operationId: request.operationId }),
    });
  } catch (error) {
    return {
      status: "failed",
      retryable: true,
      operationId: request.operationId,
      message: error instanceof Error ? error.message : "ARCHIVE_NETWORK_FAILED",
    };
  }

  const payload = await parsePayload(response);
  if (response.ok) {
    const entryId = typeof (payload as { entryId?: unknown }).entryId === "string"
      ? (payload as { entryId: string }).entryId
      : "";
    return {
      status: "committed",
      entryId,
      revision: asNonNegativeInteger((payload as { revision?: unknown }).revision),
    };
  }

  if (response.status === 409 && payload.code === "ARCHIVE_REVISION_CONFLICT") {
    return {
      status: "conflict",
      currentRevision: asNonNegativeInteger(payload.currentRevision),
      currentStatus: payload.currentStatus === "deleted" ? "deleted" : "active",
      operationId: request.operationId,
    };
  }
  if (response.status === 409 && payload.code === "ENTRY_DELETED") {
    return {
      status: "deleted",
      tombstoneRevision: asNonNegativeInteger(payload.tombstoneRevision),
      operationId: request.operationId,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "forbidden", operationId: request.operationId };
  }
  return {
    status: "failed",
    retryable: response.status >= 500 || response.status === 429,
    operationId: request.operationId,
    message: typeof payload.message === "string" ? payload.message : `ARCHIVE_HTTP_${response.status}`,
  };
}

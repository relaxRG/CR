import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ArchiveFetch,
  ArchiveMutationOutcome,
  ArchiveMutationRequest,
  commitArchiveMutation,
} from "./archive-remote-client";

export const ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY = "monthly_report.archive_remote_outbox.v1";

export type ArchiveOutboxTerminalReason = "revision_conflict" | "remote_deleted" | "abandoned";

export type ArchiveOutboxRequest = Readonly<{
  endpoint: string;
  operationId: string;
  body: Readonly<Record<string, unknown>>;
}>;

export type ArchiveOutboxItem = Readonly<{
  operationId: string;
  entryId: string;
  /** 仅保存可重放的业务载荷；访问令牌绝不进入本地outbox。 */
  request: ArchiveOutboxRequest;
  state: "pending" | "applying" | "retry_scheduled" | "conflict" | "deleted" | "committed" | "abandoned";
  retryAttempt: number;
  nextRetryAt: number | null;
  authoritativeRevision: number | null;
  terminalReason: ArchiveOutboxTerminalReason | null;
  createdAt: number;
  updatedAt: number;
}>;

export type ArchiveRemoteIndexEntry = Readonly<{
  entryId: string;
  revision: number;
  status: "active" | "deleted";
  objectKey: string;
}>;

export type ArchiveRemoteIndex = Readonly<{
  entries: readonly ArchiveRemoteIndexEntry[];
  fetchedAt: number;
}>;

export type ArchiveOutboxStorage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

export type ArchiveIndexApi = Readonly<{
  fetchAuthoritativeIndex: () => Promise<ArchiveRemoteIndex>;
}>;

export type ArchiveConflictResolution =
  | Readonly<{ strategy: "view_remote"; index: ArchiveRemoteIndex }>
  | Readonly<{ strategy: "reimport_new"; source: ArchiveOutboxItem; replacement: ArchiveOutboxItem }>
  | Readonly<{ strategy: "discard_local"; discarded: ArchiveOutboxItem }>;

export type ArchiveMutationCoordinatorResult =
  | Readonly<{ status: "committed"; outcome: Extract<ArchiveMutationOutcome, { status: "committed" }> }>
  | Readonly<{ status: "retry_scheduled"; outcome: Extract<ArchiveMutationOutcome, { status: "failed" }>; nextRetryAt: number }>
  | Readonly<{
    status: "conflict" | "deleted";
    outcome: Extract<ArchiveMutationOutcome, { status: "conflict" | "deleted" }>;
    index: ArchiveRemoteIndex;
  }>
  | Readonly<{ status: "forbidden" | "failed"; outcome: Extract<ArchiveMutationOutcome, { status: "forbidden" | "failed" }> }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isArchiveOutboxItem(value: unknown): value is ArchiveOutboxItem {
  if (!isRecord(value) || !isRecord(value.request)) return false;
  return typeof value.operationId === "string"
    && typeof value.entryId === "string"
    && typeof value.request.endpoint === "string"
    && typeof value.request.operationId === "string"
    && isRecord(value.request.body)
    && typeof value.state === "string";
}

function normalizeOutbox(raw: string | null): ArchiveOutboxItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArchiveOutboxItem);
  } catch {
    return [];
  }
}

function replaceItem(items: readonly ArchiveOutboxItem[], next: ArchiveOutboxItem): ArchiveOutboxItem[] {
  return items.map((item) => item.operationId === next.operationId ? next : item);
}

function toOutboxRequest(request: ArchiveMutationRequest): ArchiveOutboxRequest {
  return Object.freeze({ endpoint: request.endpoint, operationId: request.operationId, body: request.body });
}

function buildItem(request: ArchiveMutationRequest, now: number): ArchiveOutboxItem {
  const entryId = typeof request.body.entryId === "string" ? request.body.entryId : "";
  if (!entryId) throw new Error("归档远端写入必须包含 entryId");
  return Object.freeze({
    operationId: request.operationId,
    entryId,
    request: toOutboxRequest(request),
    state: "pending",
    retryAttempt: request.retryAttempt ?? 0,
    nextRetryAt: null,
    authoritativeRevision: null,
    terminalReason: null,
    createdAt: now,
    updatedAt: now,
  });
}

export class ArchiveMutationCoordinator {
  private cache: ArchiveOutboxItem[] | null = null;
  private readonly applying = new Set<string>();

  constructor(
    private readonly storage: ArchiveOutboxStorage,
    private readonly indexApi: ArchiveIndexApi,
    private readonly getAccessToken: () => Promise<string | null>,
    private readonly fetcher: ArchiveFetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<readonly ArchiveOutboxItem[]> {
    if (!this.cache) this.cache = normalizeOutbox(await this.storage.getItem(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY));
    return this.cache;
  }

  private async persist(items: readonly ArchiveOutboxItem[]): Promise<void> {
    this.cache = [...items];
    await this.storage.setItem(ARCHIVE_REMOTE_OUTBOX_STORAGE_KEY, JSON.stringify(items));
  }

  async enqueue(request: ArchiveMutationRequest): Promise<ArchiveOutboxItem> {
    const current = [...await this.list()];
    const existing = current.find((item) => item.operationId === request.operationId);
    if (existing) return existing;
    const item = buildItem(request, this.now());
    await this.persist([...current, item]);
    return item;
  }

  private async update(item: ArchiveOutboxItem): Promise<ArchiveOutboxItem> {
    await this.persist(replaceItem(await this.list(), item));
    return item;
  }

  async apply(operationId: string): Promise<ArchiveMutationCoordinatorResult> {
    const item = (await this.list()).find((candidate) => candidate.operationId === operationId);
    if (!item) throw new Error(`找不到归档离线操作：${operationId}`);
    if (item.state === "committed" || item.state === "deleted" || item.state === "abandoned") {
      throw new Error(`归档离线操作不可再次提交：${operationId}`);
    }
    if (this.applying.has(operationId)) throw new Error(`归档离线操作正在执行：${operationId}`);

    this.applying.add(operationId);
    try {
      const applying = await this.update(Object.freeze({
        ...item,
        state: "applying" as const,
        nextRetryAt: null,
        updatedAt: this.now(),
      }));
      const accessToken = await this.getAccessToken();
      if (!accessToken) {
        const outcome: Extract<ArchiveMutationOutcome, { status: "forbidden" }> = {
          status: "forbidden",
          operationId: applying.operationId,
        };
        await this.update(Object.freeze({ ...applying, state: "pending", updatedAt: this.now() }));
        return { status: "forbidden", outcome };
      }
      const outcome = await commitArchiveMutation({
        ...applying.request,
        accessToken,
        retryAttempt: applying.retryAttempt,
      }, this.fetcher);

      if (outcome.status === "committed") {
        await this.update(Object.freeze({
          ...applying,
          state: "committed",
          authoritativeRevision: outcome.revision,
          updatedAt: this.now(),
        }));
        return { status: "committed", outcome };
      }

      if (outcome.status === "conflict" || outcome.status === "deleted") {
        const index = await this.indexApi.fetchAuthoritativeIndex();
        await this.update(Object.freeze({
          ...applying,
          state: outcome.status === "deleted" ? "deleted" : "conflict",
          authoritativeRevision: outcome.status === "deleted" ? outcome.tombstoneRevision : outcome.currentRevision,
          terminalReason: outcome.status === "deleted" ? "remote_deleted" : "revision_conflict",
          updatedAt: this.now(),
        }));
        return { status: outcome.status, outcome, index };
      }

      if (outcome.status === "failed" && outcome.retryable) {
        const delay = asNonNegativeInteger(outcome.retryAfterMs, 1_000);
        const nextRetryAt = this.now() + delay;
        await this.update(Object.freeze({
          ...applying,
          state: "retry_scheduled",
          retryAttempt: applying.retryAttempt + 1,
          nextRetryAt,
          updatedAt: this.now(),
        }));
        return { status: "retry_scheduled", outcome, nextRetryAt };
      }

      await this.update(Object.freeze({
        ...applying,
        state: "pending",
        updatedAt: this.now(),
      }));
      return { status: outcome.status, outcome };
    } finally {
      this.applying.delete(operationId);
    }
  }

  async viewRemote(operationId: string): Promise<ArchiveConflictResolution> {
    await this.requireConflict(operationId);
    const index = await this.indexApi.fetchAuthoritativeIndex();
    return { strategy: "view_remote", index: Object.freeze({ ...index, entries: [...index.entries] }) };
  }

  async reimportAsNewEntry(operationId: string, replacement: ArchiveMutationRequest): Promise<ArchiveConflictResolution> {
    const source = await this.requireConflict(operationId);
    if (replacement.operationId === source.operationId) throw new Error("重新导入必须使用新的 operationId");
    if (replacement.body.entryId === source.entryId) throw new Error("重新导入必须使用新的 entryId");
    const replacementItem = await this.enqueue(replacement);
    await this.update(Object.freeze({
      ...source,
      state: "abandoned",
      terminalReason: source.terminalReason ?? "revision_conflict",
      updatedAt: this.now(),
    }));
    return { strategy: "reimport_new", source, replacement: replacementItem };
  }

  async discardLocalCopy(operationId: string): Promise<ArchiveConflictResolution> {
    const source = await this.requireConflict(operationId);
    const discarded = await this.update(Object.freeze({
      ...source,
      state: "abandoned",
      terminalReason: "abandoned",
      updatedAt: this.now(),
    }));
    return { strategy: "discard_local", discarded };
  }

  private async requireConflict(operationId: string): Promise<ArchiveOutboxItem> {
    const item = (await this.list()).find((candidate) => candidate.operationId === operationId);
    if (!item || (item.state !== "conflict" && item.state !== "deleted")) {
      throw new Error(`归档离线操作不是可处理冲突：${operationId}`);
    }
    return item;
  }
}

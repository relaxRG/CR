import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  cfFetch,
  getDeviceCredentials,
  getDeviceSessionV2,
} from "@/lib/cf-sync/client";
import type { RawExcelArchiveEntry } from "./raw-excel-archive";
import {
  ArchiveIndexApi,
  ArchiveMutationCoordinator,
  ArchiveMutationCoordinatorResult,
  ArchiveRemoteIndex,
  ArchiveRequestHydrator,
  ArchiveOutboxItem,
} from "./archive-sync-coordinator";

const ARCHIVE_COMMIT_PATH = "/api/archives/commit";
const ARCHIVE_INDEX_PATH = "/api/archives/index";

function archiveOperationId(entry: RawExcelArchiveEntry): string {
  return `archive-${entry.id}-${entry.revision}`;
}

function ensureArchiveImportCapability(capabilities: readonly string[]): void {
  if (!capabilities.includes("reports_monthly.import")) {
    throw new Error("CAPABILITY_DENIED");
  }
}

function ensureArchiveViewCapability(capabilities: readonly string[]): void {
  if (!capabilities.includes("reports_monthly.view")) {
    throw new Error("CAPABILITY_DENIED");
  }
}

async function requestHeaders(): Promise<Readonly<Record<string, string>>> {
  const credentials = await getDeviceCredentials();
  if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
  return Object.freeze({
    "X-Device-Id": credentials.deviceId,
    ...(credentials.deviceToken ? { "X-Device-Token": credentials.deviceToken } : {}),
    ...(credentials.webMemoryTicket ? { "X-Web-Device-Ticket": credentials.webMemoryTicket } : {}),
  });
}

async function hydrateArchivePayload(item: ArchiveOutboxItem): Promise<Readonly<Record<string, unknown>>> {
  const localSourceUri = item.request.localSourceUri;
  if (!localSourceUri) throw new Error("ARCHIVE_LOCAL_SOURCE_MISSING");
  const info = await FileSystem.getInfoAsync(localSourceUri);
  if (!info.exists) throw new Error("ARCHIVE_LOCAL_SOURCE_MISSING");
  const dataBase64 = await FileSystem.readAsStringAsync(localSourceUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!dataBase64) throw new Error("ARCHIVE_LOCAL_SOURCE_EMPTY");
  return Object.freeze({ ...item.request.body, dataBase64 });
}

function toRemoteIndex(payload: unknown): ArchiveRemoteIndex {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(value.entries) ? value.entries : [];
  const entries = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const candidate = row as Record<string, unknown>;
    if (
      typeof candidate.entryId !== "string"
      || typeof candidate.objectKey !== "string"
      || typeof candidate.revision !== "number"
      || (candidate.status !== "active" && candidate.status !== "deleted")
    ) return [];
    return [{
      entryId: candidate.entryId,
      objectKey: candidate.objectKey,
      revision: candidate.revision,
      status: candidate.status,
    } as const];
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    fetchedAt: typeof value.serverTime === "number" ? value.serverTime : Date.now(),
  });
}

async function fetchAuthoritativeIndex(): Promise<ArchiveRemoteIndex> {
  const session = await getDeviceSessionV2();
  ensureArchiveViewCapability(session.policy.capabilities);
  const credentials = await getDeviceCredentials();
  if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
  const response = await cfFetch(ARCHIVE_INDEX_PATH, { method: "GET", deviceInfo: credentials });
  if (!response.ok) throw new Error(`ARCHIVE_INDEX_HTTP_${response.status}`);
  return toRemoteIndex(await response.json());
}

const indexApi: ArchiveIndexApi = Object.freeze({ fetchAuthoritativeIndex });
const hydrator: ArchiveRequestHydrator = hydrateArchivePayload;

/**
 * 原始Excel云端桥。outbox只保存元数据与本机URI；文件Base64只在实际提交时短暂读取。
 * 未加入同步组、无月报导入权限或Worker暂不可达时，本机归档仍保持可用，操作留在本机队列等待。
 */
export class RawExcelArchiveRemoteBridge {
  private readonly coordinator = new ArchiveMutationCoordinator(
    AsyncStorage,
    indexApi,
    async () => null,
    fetch,
    Date.now,
    hydrator,
    requestHeaders,
  );

  async enqueueEntry(entry: RawExcelArchiveEntry): Promise<string> {
    const credentials = await getDeviceCredentials();
    if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
    const operationId = archiveOperationId(entry);
    await this.coordinator.enqueue({
      endpoint: ARCHIVE_COMMIT_PATH,
      accessToken: null,
      operationId,
      body: {
        entryId: entry.id,
        parentRevision: Math.max(0, entry.revision - 1),
        month: entry.month,
        fileType: entry.fileType,
        filename: entry.filename,
        sizeBytes: entry.sizeBytes,
        archivedAt: entry.archivedAt,
        localSourceUri: entry.uri,
        groupId: credentials.groupId,
      },
    });
    return operationId;
  }

  async submit(operationId: string): Promise<ArchiveMutationCoordinatorResult> {
    const session = await getDeviceSessionV2();
    ensureArchiveImportCapability(session.policy.capabilities);
    return this.coordinator.apply(operationId);
  }

  async enqueueAndSubmit(entry: RawExcelArchiveEntry): Promise<ArchiveMutationCoordinatorResult> {
    const operationId = await this.enqueueEntry(entry);
    return this.submit(operationId);
  }

  async refreshIndex(): Promise<ArchiveRemoteIndex> {
    return indexApi.fetchAuthoritativeIndex();
  }

  async resumePending(): Promise<readonly ArchiveMutationCoordinatorResult[]> {
    const [session, credentials] = await Promise.all([getDeviceSessionV2(), getDeviceCredentials()]);
    ensureArchiveImportCapability(session.policy.capabilities);
    if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
    return this.coordinator.resumePending((item) => item.request.groupId === credentials.groupId);
  }

  getCoordinator(): ArchiveMutationCoordinator {
    return this.coordinator;
  }
}

let sharedBridge: RawExcelArchiveRemoteBridge | null = null;
export function getRawExcelArchiveRemoteBridge(): RawExcelArchiveRemoteBridge {
  if (!sharedBridge) sharedBridge = new RawExcelArchiveRemoteBridge();
  return sharedBridge;
}

/**
 * Cloudflare Worker 同步客户端
 * 方案 C+: 设备配对 + 角色权限 + 云端同步
 *
 * Worker URL: https://cocktail-ai.kikikong2017.workers.dev
 * 设备令牌只由 Worker 签发和校验；客户端绝不持有可派生访问令牌的服务端密钥。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { resolveSyncDevicePlatform, type SyncDevicePlatform } from "@/lib/sync/device-platform";
import type { DeviceSessionV2 } from "@/lib/sync/device-session";
import type { BusinessTab } from "@/lib/sync/capabilities";

export const CF_WORKER_URL = "https://cocktail-ai.kikikong2017.workers.dev";
// AsyncStorage keys for device identity
const DEVICE_ID_KEY = "cf.sync.deviceId";
const GROUP_ID_KEY = "cf.sync.groupId";
const DEVICE_TOKEN_KEY = "cf.sync.deviceToken";
const DEVICE_NAME_KEY = "cf.sync.deviceName";
const WEB_MEMORY_TOKEN_TTL_MS = 10 * 60 * 1000;

type WebMemoryTicket = { ticket: string; expiresAt: number };
const webMemoryTickets = new Map<string, WebMemoryTicket>();

// ─── UUID generation ──────────────────────────────────────────────────────────
function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Device identity storage ──────────────────────────────────────────────────
async function storeSecure(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getSecure(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function deleteSecure(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

async function storeDeviceToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(DEVICE_TOKEN_KEY).catch(() => {});
    return;
  }
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
}

async function getDeviceToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  return SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
}

async function deleteDeviceToken(): Promise<void> {
  if (Platform.OS === "web") return;
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);
}

function storeWebMemoryTicket(deviceId: string, ticket: string | undefined): void {
  if (Platform.OS !== "web") return;
  if (!ticket) webMemoryTickets.delete(deviceId);
  else webMemoryTickets.set(deviceId, { ticket, expiresAt: Date.now() + WEB_MEMORY_TOKEN_TTL_MS });
}

function getWebMemoryTicket(deviceId: string | null): string | undefined {
  if (Platform.OS !== "web" || !deviceId) return undefined;
  const entry = webMemoryTickets.get(deviceId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    webMemoryTickets.delete(deviceId);
    return undefined;
  }
  return entry.ticket;
}

// ─── Device info ──────────────────────────────────────────────────────────────
export type DeviceRole = "owner" | "collaborator" | "guest";

/**
 * 同步身份的平台分类必须优先使用expo-device的硬件类型，而不是只看Platform.OS。
 * Apple Silicon Mac运行iOS应用时Platform.OS仍可能是ios；deviceType=DESKTOP才是权威信号。
 */
export function getSyncDevicePlatform(): SyncDevicePlatform {
  return resolveSyncDevicePlatform({
    nativePlatform: Platform.OS,
    deviceType: Device.deviceType,
    desktopType: Device.DeviceType.DESKTOP,
    osName: Device.osName,
    modelName: Device.modelName,
  });
}

export type DeviceCredentials = {
  deviceId: string;
  groupId: string;
  /** 原生端为 SecureStore 令牌；Web 端只保留页面内短期票据。 */
  deviceToken?: string;
  /** Worker 为 Web Cookie 受阻场景签发的短期内存票据；绝不持久化。 */
  webMemoryTicket?: string;
  deviceName: string;
};

export async function getDeviceCredentials(): Promise<DeviceCredentials | null> {
  // 退役旧版本持久化的角色与授权键：成员和能力只能来自 DeviceSessionV2。
  if (Platform.OS === "web") await AsyncStorage.removeItem(DEVICE_TOKEN_KEY).catch(() => {});
  await Promise.all([deleteSecure("cf.sync.deviceRole"), deleteSecure("cf.sync.allowedKeys")]);
  const [deviceId, groupId, deviceName] = await Promise.all([
    getSecure(DEVICE_ID_KEY),
    getSecure(GROUP_ID_KEY),
    getSecure(DEVICE_NAME_KEY),
  ]);
  const deviceToken = await getDeviceToken();
  const webMemoryTicket = getWebMemoryTicket(deviceId);
  if (!deviceId || !groupId || (Platform.OS !== "web" && !deviceToken)) return null;
  return {
    deviceId,
    groupId,
    ...(deviceToken ? { deviceToken } : {}),
    ...(webMemoryTicket ? { webMemoryTicket } : {}),
    deviceName: deviceName ?? "Unknown Device",
  };
}

export async function saveDeviceCredentials(info: DeviceCredentials): Promise<void> {
  await Promise.all([
    storeSecure(DEVICE_ID_KEY, info.deviceId),
    storeSecure(GROUP_ID_KEY, info.groupId),
    storeDeviceToken(info.deviceToken ?? ""),
    Promise.resolve(storeWebMemoryTicket(info.deviceId, info.webMemoryTicket)),
    storeSecure(DEVICE_NAME_KEY, info.deviceName),
  ]);
}

export async function clearDeviceCredentials(): Promise<void> {
  const deviceId = await getSecure(DEVICE_ID_KEY);
  await Promise.all([
    deleteSecure(DEVICE_ID_KEY),
    deleteSecure(GROUP_ID_KEY),
    deleteDeviceToken(),
    Promise.resolve(storeWebMemoryTicket(deviceId ?? "", undefined)),
    deleteSecure("cf.sync.deviceRole"),
    deleteSecure("cf.sync.allowedKeys"),
    deleteSecure(DEVICE_NAME_KEY),
  ]);
}

// ─── API helpers ──────────────────────────────────────────────────────────────
export async function cfFetch(
  path: string,
  options: RequestInit & { deviceInfo?: DeviceCredentials } = {},
): Promise<Response> {
  const { deviceInfo, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };
  if (deviceInfo) {
    headers["X-Device-Id"] = deviceInfo.deviceId;
    // Web优先由HttpOnly Cookie鉴权；短期内存票据仅在Cookie受策略阻止时作为同页降级。
    if (deviceInfo.deviceToken) headers["X-Device-Token"] = deviceInfo.deviceToken;
    if (deviceInfo.webMemoryTicket) headers["X-Web-Device-Ticket"] = deviceInfo.webMemoryTicket;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(`${CF_WORKER_URL}${path}`, {
      ...fetchOptions,
      headers,
      credentials: Platform.OS === "web" ? "include" : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function upsertPriceAlertsRemote(alerts: unknown[]): Promise<number> {
  const credentials = await getDeviceCredentials();
  if (!credentials || !alerts.length) return 0;
  const res = await cfFetch("/api/price-alerts/upsert", { method: "POST", deviceInfo: credentials, body: JSON.stringify({ alerts }) });
  if (!res.ok) return 0;
  const body = await res.json() as { accepted?: number };
  return Number(body.accepted || 0);
}

export async function listPriceAlertsRemote(): Promise<unknown[]> {
  const credentials = await getDeviceCredentials();
  if (!credentials) return [];
  const res = await cfFetch("/api/price-alerts", { method: "GET", deviceInfo: credentials });
  if (!res.ok) return [];
  const body = await res.json() as { alerts?: unknown[] };
  return Array.isArray(body.alerts) ? body.alerts : [];
}

// ─── Registration ─────────────────────────────────────────────────────────────
/**
 * 显式创建一个新的独立同步组。
 * 只能由用户点击“创建新的同步组”后调用；启动、重试、前后台回归和退出操作绝不能调用它。
 */
export async function createNewSyncGroup(deviceName?: string): Promise<DeviceCredentials> {
  const existing = await getDeviceCredentials();
  if (existing) throw new Error("SYNC_GROUP_ALREADY_ACTIVE");

  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getSuggestedDeviceName();

  const res = await cfFetch("/api/device/register", {
    method: "POST",
    body: JSON.stringify({ deviceId, deviceName: name, platform: getSyncDevicePlatform() }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Device registration failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { membership?: DeviceCredentials; groupId?: string; deviceToken?: string; role?: DeviceRole };
  // Worker的安全会话包装会返回membership；兼容已部署的扁平响应，但不依赖任一固定形状。
  const membership = data.membership ?? data;
  if (!membership.groupId || !membership.deviceToken) throw new Error("DEVICE_REGISTRATION_RESPONSE_INVALID");
  const info: DeviceCredentials = {
    deviceId,
    groupId: membership.groupId,
    deviceToken: membership.deviceToken,
    deviceName: name,
  };
  await saveDeviceCredentials(info);
  return info;
}

/**
 * 初始展示名：优先使用系统公开的型号名，不读取序列号、广告ID或用户Apple设备名。
 * 用户后续改名会永久覆盖该建议值，身份与令牌始终保持独立。
 */
export function getSuggestedDeviceName(): string {
  const platform = getSyncDevicePlatform();
  const modelName = typeof Device.modelName === "string" ? Device.modelName.trim() : "";
  // iOS-on-Mac有时会回报通用iPad型号；桌面硬件判定优先，防止初始名称误导用户。
  if (platform === "macos") {
    return /^ipad\b/i.test(modelName) || !modelName ? "Mac" : modelName.slice(0, 40);
  }
  if (modelName) return modelName.slice(0, 40);
  if (platform === "ios") return "iPhone";
  if (platform === "android") return "Android";
  if (platform === "web") return "Web 浏览器";
  return "设备";
}

// ─── Pair code ────────────────────────────────────────────────────────────────
export type GenerateCodeResult = {
  code: string;
  expiresAt: number;
  role: DeviceRole;
  /** 用户可配置的唯一业务授权：五个底部 Tab。 */
  tabs: readonly BusinessTab[];
};

export async function generatePairCode(
  role: DeviceRole,
  tabs: readonly BusinessTab[],
): Promise<GenerateCodeResult> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");
  const session = await getDeviceSessionV2();
  if (!session.policy.capabilities.includes("devices.manage")) {
    throw new Error("CAPABILITY_DENIED");
  }

  const res = await cfFetch("/api/device/generate-code", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ role, tabs }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Generate code failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<GenerateCodeResult>;
}

export async function pairWithCode(
  code: string,
  deviceName?: string,
): Promise<DeviceCredentials> {
  // 旧 /pair 协议只能安全用于未加入任何同步组的设备。
  // 已激活设备切换群组必须使用Worker原子switch协议，不能覆盖旧成员资格。
  if (await getDeviceCredentials()) throw new Error("SYNC_GROUP_SWITCH_REQUIRES_ATOMIC_WORKER_PROTOCOL");
  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getSuggestedDeviceName();

  const res = await cfFetch("/api/device/pair", {
    method: "POST",
    body: JSON.stringify({ code, deviceId, deviceName: name, platform: getSyncDevicePlatform() }),
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Pair failed: ${res.status}`);
  }

  const data = await res.json() as {
    groupId: string;
    deviceToken: string;
  };

  const info: DeviceCredentials = {
    deviceId,
    groupId: data.groupId,
    deviceToken: data.deviceToken,
    deviceName: name,
  };
  await saveDeviceCredentials(info);
  return info;
}

// ─── Safe group switching ─────────────────────────────────────────────────────
export type GroupSwitchTargetPreview = {
  groupId: string;
  role: DeviceRole;
  expiresAt: number;
};

export type GroupSwitchPreparation = {
  switchId: string;
  recoveryTicket: string;
  target: GroupSwitchTargetPreview;
};

export type GroupSwitchStatus =
  | { state: "prepared" | "cancelled" }
  | { state: "committed"; membership: DeviceCredentials };

export type CompleteSyncSnapshot = {
  groupId: string;
  revision: string;
  complete: true;
  presentKeys: string[];
  entries: SyncEntry[];
};

async function readError(res: Response, fallback: string): Promise<never> {
  let code = fallback;
  try {
    const body = await res.json() as { error?: string };
    code = body.error ?? fallback;
  } catch {}
  throw new Error(code);
}

/**
 * 取得 Worker 已核验的唯一会话事实。
 * 角色和业务能力不能再从本机存储推断；后续所有页面守卫应以此响应为准。
 */
export async function getDeviceSessionV2(): Promise<DeviceSessionV2> {
  const credentials = await getDeviceCredentials();
  if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
  const res = await cfFetch("/api/device/session-v2", {
    method: "GET",
    deviceInfo: credentials,
  });
  if (!res.ok) return readError(res, `DEVICE_SESSION_FAILED_${res.status}`);
  const session = await res.json() as DeviceSessionV2;
  if (session.schemaVersion !== 2 || !session.membership?.groupId || !Array.isArray(session.policy?.tabs) || !Array.isArray(session.policy?.capabilities)) {
    throw new Error("DEVICE_SESSION_INVALID");
  }
  return session;
}

export async function recoverJoinWithCode(input: {
  code: string;
  deviceName?: string;
}): Promise<DeviceCredentials> {
  if (!/^\d{6}$/.test(input.code)) throw new Error("PAIR_CODE_INVALID");
  const deviceId = generateUUID();
  const deviceName = input.deviceName?.trim() || getSuggestedDeviceName();
  const res = await cfFetch("/api/device/recover-join", {
    method: "POST",
    body: JSON.stringify({ deviceId, deviceName, platform: getSyncDevicePlatform(), code: input.code }),
  });
  if (!res.ok) return readError(res, `RECOVERY_JOIN_FAILED_${res.status}`);
  const data = await res.json() as { membership: DeviceCredentials };
  if (!data.membership?.deviceId || !data.membership?.deviceToken || !data.membership?.groupId) {
    throw new Error("RECOVERY_MEMBERSHIP_INVALID");
  }
  return data.membership;
}

/** 仅更新服务端展示元数据；不会修改本地名称、角色、组或权限。 */
export async function refreshCurrentDevicePlatform(): Promise<void> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) return;
  const res = await cfFetch("/api/device/update-metadata", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ platform: getSyncDevicePlatform() }),
  });
  if (!res.ok) return;
}

export async function prepareGroupSwitch(input: {
  code: string;
  switchId: string;
  handoffDeviceId?: string;
  deviceName?: string;
  platform?: string;
}): Promise<GroupSwitchPreparation> {
  const source = await getDeviceCredentials();
  if (!source) throw new Error("SYNC_GROUP_NOT_ACTIVE");
  const res = await cfFetch("/api/device/prepare-switch", {
    method: "POST",
    deviceInfo: source,
    body: JSON.stringify(input),
  });
  if (!res.ok) return readError(res, `SWITCH_PREPARE_FAILED_${res.status}`);
  return res.json() as Promise<GroupSwitchPreparation>;
}

export async function commitGroupSwitch(input: {
  switchId: string;
  recoveryTicket: string;
}): Promise<GroupSwitchStatus> {
  const source = await getDeviceCredentials();
  if (!source) throw new Error("SYNC_GROUP_NOT_ACTIVE");
  const res = await cfFetch("/api/device/commit-switch", {
    method: "POST",
    deviceInfo: source,
    body: JSON.stringify(input),
  });
  if (!res.ok) return readError(res, `SWITCH_COMMIT_FAILED_${res.status}`);
  return res.json() as Promise<GroupSwitchStatus>;
}

export async function getGroupSwitchStatus(input: {
  switchId: string;
  recoveryTicket: string;
}): Promise<GroupSwitchStatus> {
  const res = await cfFetch("/api/device/switch-status", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return readError(res, `SWITCH_STATUS_FAILED_${res.status}`);
  return res.json() as Promise<GroupSwitchStatus>;
}

export async function cancelPreparedGroupSwitch(input: {
  switchId: string;
  recoveryTicket: string;
}): Promise<void> {
  const res = await cfFetch("/api/device/cancel-switch", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return readError(res, `SWITCH_CANCEL_FAILED_${res.status}`);
}

export async function pullCompleteTargetSnapshot(membership: DeviceCredentials): Promise<CompleteSyncSnapshot> {
  const res = await cfFetch("/api/sync/snapshot", {
    method: "GET",
    deviceInfo: membership,
  });
  if (!res.ok) return readError(res, `TARGET_SNAPSHOT_FAILED_${res.status}`);
  return res.json() as Promise<CompleteSyncSnapshot>;
}

// ─── Device list ──────────────────────────────────────────────────────────────
export type RemoteDevice = {
  id: string;
  name: string;
  platform: SyncDevicePlatform;
  /** 成员身份，仅用于设备归属与主设备交接；业务权限由五个 tabs 决定。 */
  role: DeviceRole;
  tabs: readonly BusinessTab[];
  policyRevision: number;
  last_seen: number | null;
  created_at: number;
  isCurrentDevice: boolean;
};

export async function listDevices(): Promise<RemoteDevice[]> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/device/list", { method: "GET", deviceInfo });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `List failed: ${res.status}`);
  }
  const data = await res.json() as { devices: RemoteDevice[] };
  return data.devices;
}

export async function kickDevice(targetDeviceId: string): Promise<void> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/device/kick", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ targetDeviceId }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Kick failed: ${res.status}`);
  }
}

/**
 * 当前设备主动退出同步组。必须先让 Worker 原子撤销远端成员行，
 * 调用方才能清除本机凭据，避免“本机未配对但其他设备仍显示成员”的状态分裂。
 */
export async function leaveCurrentSyncGroup(): Promise<void> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) return;
  const res = await cfFetch("/api/device/leave", {
    method: "POST",
    deviceInfo,
  });
  if (!res.ok) return readError(res, `DEVICE_LEAVE_FAILED_${res.status}`);
}

/**
 * 显式恢复失联主设备：仅当服务端确认主设备从未在线或超过恢复阈值未在线时可用。
 * Worker 会撤销旧主设备并把当前活跃设备提升为主设备；不会删除同步数据。
 */
export type StaleOwnerRecoveryResult = Readonly<{
  outcome: "RECOVERED" | "ALREADY_OWNER";
  membership: DeviceCredentials;
  previousOwnerDeviceId: string | null;
}>;

export async function recoverStaleOwner(): Promise<StaleOwnerRecoveryResult> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("DEVICE_CREDENTIALS_MISSING");
  const res = await cfFetch("/api/device/recover-stale-owner", {
    method: "POST",
    deviceInfo,
  });
  if (!res.ok) {
    // 生产端尚未部署该路由时，边缘层会返回纯文本 Not found；不能直接暴露给用户。
    if (res.status === 404) {
      const raw = await res.text().catch(() => "");
      if (!raw || /not found/i.test(raw)) throw new Error("STALE_OWNER_RECOVERY_ROUTE_UNAVAILABLE");
      try {
        const body = JSON.parse(raw) as { error?: string };
        throw new Error(body.error ?? "STALE_OWNER_RECOVERY_ROUTE_UNAVAILABLE");
      } catch (error) {
        if (error instanceof Error && error.message !== raw) throw error;
        throw new Error("STALE_OWNER_RECOVERY_ROUTE_UNAVAILABLE");
      }
    }
    return readError(res, `STALE_OWNER_RECOVERY_FAILED_${res.status}`);
  }
  const result = await res.json() as StaleOwnerRecoveryResult;
  if (!result.membership?.deviceId || !result.membership?.deviceToken || !result.membership?.groupId || !["RECOVERED", "ALREADY_OWNER"].includes(result.outcome)) {
    throw new Error("STALE_OWNER_RECOVERY_INVALID_RESPONSE");
  }
  await saveDeviceCredentials(result.membership);
  return result;
}

export type UpdateDevicePolicyV2Result = Readonly<{
  success: true;
  targetDeviceId: string;
  tabs: readonly BusinessTab[];
  policyRevision: number;
  updatedAt: number;
}>;

/**
 * 唯一业务授权写入接口。用户只能配置五个底部业务Tab；角色只描述成员身份。
 */
export async function updateDevicePolicyV2(
  targetDeviceId: string,
  tabs: readonly BusinessTab[],
): Promise<UpdateDevicePolicyV2Result> {
  const credentials = await getDeviceCredentials();
  if (!credentials) throw new Error("DEVICE_CREDENTIALS_MISSING");
  const res = await cfFetch("/api/device/update-policy-v2", {
    method: "POST",
    deviceInfo: credentials,
    body: JSON.stringify({ targetDeviceId, tabs }),
  });
  if (!res.ok) return readError(res, `DEVICE_POLICY_UPDATE_FAILED_${res.status}`);
  return res.json() as Promise<UpdateDevicePolicyV2Result>;
}

export async function updateDeviceRole(
  targetDeviceId: string,
  role: DeviceRole,
): Promise<void> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/device/update-role", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ targetDeviceId, role }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Update role failed: ${res.status}`);
  }
}

/**
 * 重命名当前设备。名称是展示字段，必须由Worker在当前组内持久化后再写回本机，
 * 不会改变设备 ID、令牌、成员角色、能力策略或同步组。
 */
export async function renameCurrentDevice(newName: string): Promise<void> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");
  const normalized = newName.trim();
  if (!normalized) throw new Error("DEVICE_NAME_REQUIRED");
  if (normalized.length > 40 || /[\u0000-\u001F\u007F]/.test(normalized)) throw new Error("DEVICE_NAME_INVALID");

  const res = await cfFetch("/api/device/rename", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ deviceName: normalized }),
  });
  if (!res.ok) return readError(res, `DEVICE_RENAME_FAILED_${res.status}`);
  const data = await res.json() as { deviceName?: string };
  await saveDeviceCredentials({ ...deviceInfo, deviceName: data.deviceName ?? normalized });
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
export type SyncEntry = {
  storageKey: string;
  value: string;
  clientUpdatedAt: number;
};

export async function cfPull(since?: number): Promise<{
  entries: SyncEntry[];
  policyRevision: number;
}> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/sync/pull", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify(since ? { since } : {}),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Pull failed: ${res.status}`);
  }
  return res.json();
}

export async function cfPush(entries: SyncEntry[], policyRevision: number): Promise<{ count: number }> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/sync/push", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ entries, policyRevision }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Push failed: ${res.status}`);
  }
  return res.json();
}

// ─── Balance check ────────────────────────────────────────────────────────────
export async function checkBalance(): Promise<{ balance: number | null; currency: string; checkedAt: number }> {
  const deviceInfo = await getDeviceCredentials();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/balance", { method: "GET", deviceInfo });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Balance check failed: ${res.status}`);
  }
  return res.json();
}

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

export const CF_WORKER_URL = "https://cocktail-ai.kikikong2017.workers.dev";
// AsyncStorage keys for device identity
const DEVICE_ID_KEY = "cf.sync.deviceId";
const GROUP_ID_KEY = "cf.sync.groupId";
const DEVICE_TOKEN_KEY = "cf.sync.deviceToken";
const DEVICE_ROLE_KEY = "cf.sync.deviceRole";
const DEVICE_ALLOWED_KEYS_KEY = "cf.sync.allowedKeys";
const DEVICE_NAME_KEY = "cf.sync.deviceName";

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

// ─── Device info ──────────────────────────────────────────────────────────────
export type DeviceRole = "owner" | "collaborator" | "guest";

export type DeviceInfo = {
  deviceId: string;
  groupId: string;
  deviceToken: string;
  role: DeviceRole;
  allowedKeys: string[] | null;
  deviceName: string;
};

export async function getDeviceInfo(): Promise<DeviceInfo | null> {
  const [deviceId, groupId, deviceToken, role, allowedKeysRaw, deviceName] = await Promise.all([
    getSecure(DEVICE_ID_KEY),
    getSecure(GROUP_ID_KEY),
    getSecure(DEVICE_TOKEN_KEY),
    getSecure(DEVICE_ROLE_KEY),
    getSecure(DEVICE_ALLOWED_KEYS_KEY),
    getSecure(DEVICE_NAME_KEY),
  ]);
  if (!deviceId || !groupId || !deviceToken || !role) return null;
  let allowedKeys: string[] | null = null;
  if (allowedKeysRaw) {
    try { allowedKeys = JSON.parse(allowedKeysRaw); } catch { allowedKeys = null; }
  }
  return {
    deviceId,
    groupId,
    deviceToken,
    role: role as DeviceRole,
    allowedKeys,
    deviceName: deviceName ?? "Unknown Device",
  };
}

export async function saveDeviceInfo(info: DeviceInfo): Promise<void> {
  await Promise.all([
    storeSecure(DEVICE_ID_KEY, info.deviceId),
    storeSecure(GROUP_ID_KEY, info.groupId),
    storeSecure(DEVICE_TOKEN_KEY, info.deviceToken),
    storeSecure(DEVICE_ROLE_KEY, info.role),
    storeSecure(DEVICE_ALLOWED_KEYS_KEY, info.allowedKeys ? JSON.stringify(info.allowedKeys) : "null"),
    storeSecure(DEVICE_NAME_KEY, info.deviceName),
  ]);
}

export async function clearDeviceInfo(): Promise<void> {
  await Promise.all([
    deleteSecure(DEVICE_ID_KEY),
    deleteSecure(GROUP_ID_KEY),
    deleteSecure(DEVICE_TOKEN_KEY),
    deleteSecure(DEVICE_ROLE_KEY),
    deleteSecure(DEVICE_ALLOWED_KEYS_KEY),
    deleteSecure(DEVICE_NAME_KEY),
  ]);
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function cfFetch(
  path: string,
  options: RequestInit & { deviceInfo?: DeviceInfo } = {},
): Promise<Response> {
  const { deviceInfo, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };
  if (deviceInfo) {
    headers["X-Device-Id"] = deviceInfo.deviceId;
    headers["X-Device-Token"] = deviceInfo.deviceToken;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(`${CF_WORKER_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────
/**
 * 显式创建一个新的独立同步组。
 * 只能由用户点击“创建新的同步组”后调用；启动、重试、前后台回归和退出操作绝不能调用它。
 */
export async function createNewSyncGroup(deviceName?: string): Promise<DeviceInfo> {
  const existing = await getDeviceInfo();
  if (existing) throw new Error("SYNC_GROUP_ALREADY_ACTIVE");

  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getSuggestedDeviceName();

  const res = await cfFetch("/api/device/register", {
    method: "POST",
    body: JSON.stringify({ deviceId, deviceName: name }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Device registration failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { groupId: string; deviceToken: string; role: DeviceRole };
  const info: DeviceInfo = {
    deviceId,
    groupId: data.groupId,
    deviceToken: data.deviceToken,
    role: data.role,
    allowedKeys: null,
    deviceName: name,
  };
  await saveDeviceInfo(info);
  return info;
}

/**
 * 初始展示名：优先使用系统公开的型号名，不读取序列号、广告ID或用户Apple设备名。
 * 用户后续改名会永久覆盖该建议值，身份与令牌始终保持独立。
 */
export function getSuggestedDeviceName(): string {
  const modelName = typeof Device.modelName === "string" ? Device.modelName.trim() : "";
  if (modelName) return modelName.slice(0, 40);
  if (Platform.OS === "ios") return "iPhone";
  if (Platform.OS === "android") return "Android";
  if (Platform.OS === "web") return "Web 浏览器";
  return "设备";
}

// ─── Pair code ────────────────────────────────────────────────────────────────
export type GenerateCodeResult = {
  code: string;
  expiresAt: number;
  role: DeviceRole;
  allowedKeys: string[] | null;
};

export async function generatePairCode(
  role: DeviceRole,
  allowedKeys: string[] | null = null,
): Promise<GenerateCodeResult> {
  const deviceInfo = await getDeviceInfo();
  if (!deviceInfo) throw new Error("Device not registered");
  if (deviceInfo.role !== "owner") throw new Error("Only owner can generate pair codes");

  const res = await cfFetch("/api/device/generate-code", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ role, allowedKeys }),
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
): Promise<DeviceInfo> {
  // 旧 /pair 协议只能安全用于未加入任何同步组的设备。
  // 已激活设备切换群组必须使用Worker原子switch协议，不能覆盖旧成员资格。
  if (await getDeviceInfo()) throw new Error("SYNC_GROUP_SWITCH_REQUIRES_ATOMIC_WORKER_PROTOCOL");
  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getSuggestedDeviceName();

  const res = await cfFetch("/api/device/pair", {
    method: "POST",
    body: JSON.stringify({ code, deviceId, deviceName: name }),
  });

  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Pair failed: ${res.status}`);
  }

  const data = await res.json() as {
    groupId: string;
    deviceToken: string;
    role: DeviceRole;
    allowedKeys: string[] | null;
  };

  const info: DeviceInfo = {
    deviceId,
    groupId: data.groupId,
    deviceToken: data.deviceToken,
    role: data.role,
    allowedKeys: data.allowedKeys,
    deviceName: name,
  };
  await saveDeviceInfo(info);
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
  | { state: "committed"; membership: DeviceInfo };

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

export async function recoverJoinWithCode(input: {
  code: string;
  deviceName?: string;
}): Promise<DeviceInfo> {
  if (!/^\d{6}$/.test(input.code)) throw new Error("PAIR_CODE_INVALID");
  const deviceId = generateUUID();
  const deviceName = input.deviceName?.trim() || getSuggestedDeviceName();
  const res = await cfFetch("/api/device/recover-join", {
    method: "POST",
    body: JSON.stringify({ deviceId, deviceName, platform: Platform.OS, code: input.code }),
  });
  if (!res.ok) return readError(res, `RECOVERY_JOIN_FAILED_${res.status}`);
  const data = await res.json() as { membership: DeviceInfo };
  if (!data.membership?.deviceId || !data.membership?.deviceToken || !data.membership?.groupId) {
    throw new Error("RECOVERY_MEMBERSHIP_INVALID");
  }
  return data.membership;
}

export async function prepareGroupSwitch(input: {
  code: string;
  switchId: string;
  handoffDeviceId?: string;
  deviceName?: string;
  platform?: string;
}): Promise<GroupSwitchPreparation> {
  const source = await getDeviceInfo();
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
  const source = await getDeviceInfo();
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

export async function pullCompleteTargetSnapshot(membership: DeviceInfo): Promise<CompleteSyncSnapshot> {
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
  role: DeviceRole;
  allowedKeys: string[] | null;
  last_seen: number | null;
  created_at: number;
  isCurrentDevice: boolean;
};

export async function listDevices(): Promise<RemoteDevice[]> {
  const deviceInfo = await getDeviceInfo();
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
  const deviceInfo = await getDeviceInfo();
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

export async function updateDeviceRole(
  targetDeviceId: string,
  role: DeviceRole,
  allowedKeys: string[] | null = null,
): Promise<void> {
  const deviceInfo = await getDeviceInfo();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/device/update-role", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ targetDeviceId, role, allowedKeys }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Update role failed: ${res.status}`);
  }
}

/**
 * 重命名当前设备。名称是展示字段，必须由Worker在当前组内持久化后再写回本机，
 * 不会改变设备ID、令牌、角色、授权键或同步组。
 */
export async function renameCurrentDevice(newName: string): Promise<void> {
  const deviceInfo = await getDeviceInfo();
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
  await saveDeviceInfo({ ...deviceInfo, deviceName: data.deviceName ?? normalized });
}

// ─── Sync ─────────────────────────────────────────────────────────────────────
export type SyncEntry = {
  storageKey: string;
  value: string;
  clientUpdatedAt: number;
};

export async function cfPull(since?: number): Promise<{
  entries: SyncEntry[];
  role: DeviceRole;
  allowedKeys: string[] | null;
}> {
  const deviceInfo = await getDeviceInfo();
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

export async function cfPush(entries: SyncEntry[]): Promise<{ count: number }> {
  const deviceInfo = await getDeviceInfo();
  if (!deviceInfo) throw new Error("Device not registered");
  if (deviceInfo.role === "guest") return { count: 0 };

  const res = await cfFetch("/api/sync/push", {
    method: "POST",
    deviceInfo,
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Push failed: ${res.status}`);
  }
  return res.json();
}

// ─── Balance check ────────────────────────────────────────────────────────────
export async function checkBalance(): Promise<{ balance: number | null; currency: string; checkedAt: number }> {
  const deviceInfo = await getDeviceInfo();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/balance", { method: "GET", deviceInfo });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error ?? `Balance check failed: ${res.status}`);
  }
  return res.json();
}

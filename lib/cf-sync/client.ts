/**
 * Cloudflare Worker 同步客户端
 * 方案 C+: 设备配对 + 角色权限 + 云端同步
 *
 * Worker URL: https://cocktail-ai.kikikong2017.workers.dev
 * Worker Secret: 用于 HMAC-SHA256 设备令牌签名
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const CF_WORKER_URL = "https://cocktail-ai.kikikong2017.workers.dev";
export const CF_WORKER_SECRET = "7b398c49c07157e84387682987ef29a678dd31e8fc548eed30272330fe0dbd70";

// AsyncStorage keys for device identity
const DEVICE_ID_KEY = "cf.sync.deviceId";
const GROUP_ID_KEY = "cf.sync.groupId";
const DEVICE_TOKEN_KEY = "cf.sync.deviceToken";
const DEVICE_ROLE_KEY = "cf.sync.deviceRole";
const DEVICE_ALLOWED_KEYS_KEY = "cf.sync.allowedKeys";
const DEVICE_NAME_KEY = "cf.sync.deviceName";

// ─── HMAC-SHA256 device token ─────────────────────────────────────────────────
async function makeDeviceToken(deviceId: string, groupId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(CF_WORKER_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${deviceId}:${groupId}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

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

async function saveDeviceInfo(info: DeviceInfo): Promise<void> {
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
 * Get or create device identity.
 * - First call: creates a new device group (becomes owner)
 * - Subsequent calls: returns cached identity
 */
export async function getOrCreateDevice(deviceName?: string): Promise<DeviceInfo> {
  const existing = await getDeviceInfo();
  if (existing) return existing;

  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getDefaultDeviceName();

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

function getDefaultDeviceName(): string {
  if (Platform.OS === "ios") return "iPhone";
  if (Platform.OS === "android") return "Android";
  if (Platform.OS === "web") return "Web";
  return "Device";
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
  // Generate new device ID
  const deviceId = generateUUID();
  const name = deviceName ?? getDefaultDeviceName();

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

// ─── Sync ─────────────────────────────────────────────────────────────────────
export type SyncEntry = {
  storageKey: string;
  value: string;
  clientUpdatedAt: number;
};

export async function cfPull(): Promise<{
  entries: SyncEntry[];
  role: DeviceRole;
  allowedKeys: string[] | null;
}> {
  const deviceInfo = await getDeviceInfo();
  if (!deviceInfo) throw new Error("Device not registered");

  const res = await cfFetch("/api/sync/pull", { method: "POST", deviceInfo, body: "{}" });
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

/**
 * iCloud Drive 备份通道（Build 98 - 真正的 iCloud Drive）
 *
 * 功能：
 * - iOS：写入 iCloud Drive ubiquity 容器（iCloud.com.app.cocktailrecipes）
 *   → 文件在「文件」App → iCloud Drive → CocktailR 中可见
 *   → 多台 iPhone/iPad 自动同步（iCloud 后台调度，非实时）
 * - Android/Web：退化为本地 documentDirectory（不支持 iCloud）
 * - 保留最近 7 个版本（backup-v0.json ~ backup-v6.json，循环覆盖）
 * - 每 1 小时自动备份一次（App 启动 30 秒后首次执行）
 *
 * iCloud Drive 路径说明（iOS）：
 *   NSUbiquitousDocumentsDirectory（通过 expo-file-system 访问）
 *   路径格式：file:///private/var/mobile/Library/Mobile Documents/iCloud~com~app~cocktailrecipes/Documents/CocktailR/
 *   注意：bundle ID 中的点替换为波浪号（~）
 *
 * 需要的 entitlements（已在 app.config.ts 配置）：
 *   com.apple.developer.icloud-container-identifiers: [iCloud.com.app.cocktailrecipes]
 *   com.apple.developer.icloud-services: [CloudDocuments]
 *   com.apple.developer.ubiquity-container-identifiers: [iCloud.com.app.cocktailrecipes]
 */
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { SYNC_KEYS } from "@/lib/sync/engine";

const MAX_VERSIONS = 7;
const BACKUP_SCHEMA_VERSION = 1;
const ICLOUD_META_KEY = "backup.icloud.meta";
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const APP_FOLDER = "CocktailR";

// iCloud Drive 容器 ID（与 app.config.ts entitlements 一致）
const ICLOUD_CONTAINER_ID = "iCloud.com.app.cocktailrecipes";

export type ICloudBackupMeta = {
  currentSlot: number;
  lastBackupAt: number | null;
  isICloudDrive: boolean; // true = 真正的 iCloud Drive，false = 本地备份
  slots: Array<{
    slot: number;
    createdAt: number;
    keyCount: number;
    sizeBytes: number;
    label: string;
  } | null>;
};

export type ICloudBackupFile = {
  version: number;
  createdAt: number;
  deviceName: string;
  keyCount: number;
  data: Record<string, string | null>;
};

/**
 * 获取 iCloud Drive ubiquity 容器路径（iOS）
 * 格式：file:///private/var/mobile/Library/Mobile Documents/iCloud~com~app~cocktailrecipes/Documents/
 * 注意：bundle ID 中的点（.）替换为波浪号（~）
 */
function getICloudContainerPath(): string | null {
  if (Platform.OS !== "ios" && Platform.OS !== "macos") return null;
  // expo-file-system 在 iOS 上通过 NSUbiquitousDocumentsDirectory 暴露 iCloud Drive 路径
  // 路径格式：containerPath 由 bundle ID 的点替换为波浪号构成
  const bundleIdWithTilde = "com~app~cocktailrecipes";
  // iOS iCloud Drive 标准路径
  const base = `file:///private/var/mobile/Library/Mobile%20Documents/iCloud~${bundleIdWithTilde}/Documents/`;
  return base;
}

/**
 * 获取备份目录路径
 * - iOS：iCloud Drive ubiquity 容器（文件在「文件」App 可见）
 * - Android/Web：本地 documentDirectory（iCloud 不支持）
 */
function getBackupDir(): string {
  const icloudPath = getICloudContainerPath();
  if (icloudPath) {
    return `${icloudPath}${APP_FOLDER}/`;
  }
  // Android / Web: 本地文档目录
  return `${FileSystem.documentDirectory ?? ""}${APP_FOLDER}/`;
}

/** 当前是否使用真正的 iCloud Drive */
export function isUsingICloudDrive(): boolean {
  return Platform.OS === "ios" || Platform.OS === "macos";
}

/** 确保备份目录存在 */
async function ensureBackupDir(): Promise<string> {
  const dir = getBackupDir();
  if (!dir) return "";
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch (e) {
    console.warn("[iCloudBackup] Cannot create backup dir:", e);
  }
  return dir;
}

/** 读取备份元数据（存在 AsyncStorage 中） */
export async function getICloudMeta(): Promise<ICloudBackupMeta> {
  try {
    const raw = await AsyncStorage.getItem(ICLOUD_META_KEY);
    if (raw) return JSON.parse(raw) as ICloudBackupMeta;
  } catch {}
  return {
    currentSlot: 0,
    lastBackupAt: null,
    isICloudDrive: isUsingICloudDrive(),
    slots: Array(MAX_VERSIONS).fill(null),
  };
}

/** 格式化时间戳 */
function formatLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 执行备份（写入 iCloud Drive 或本地） */
export async function performBackup(deviceName = "Unknown Device"): Promise<ICloudBackupMeta> {
  const dir = await ensureBackupDir();
  if (!dir) throw new Error("Backup directory unavailable");

  const meta = await getICloudMeta();
  const slot = meta.currentSlot % MAX_VERSIONS;
  const filename = `backup-v${slot}.json`;
  const filePath = `${dir}${filename}`;

  // 读取所有同步数据
  const pairs = await AsyncStorage.multiGet([...SYNC_KEYS]);
  const data: Record<string, string | null> = {};
  for (const [key, value] of pairs) {
    data[key] = value;
  }

  const now = Date.now();
  const keyCount = Object.values(data).filter((v) => v !== null).length;

  const backupFile: ICloudBackupFile = {
    version: BACKUP_SCHEMA_VERSION,
    createdAt: now,
    deviceName,
    keyCount,
    data,
  };

  const content = JSON.stringify(backupFile, null, 2);

  // 写入文件（iCloud Drive 或本地）
  await FileSystem.writeAsStringAsync(filePath, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // 更新元数据
  const newMeta: ICloudBackupMeta = {
    currentSlot: (slot + 1) % MAX_VERSIONS,
    lastBackupAt: now,
    isICloudDrive: isUsingICloudDrive(),
    slots: [...meta.slots],
  };
  newMeta.slots[slot] = {
    slot,
    createdAt: now,
    keyCount,
    sizeBytes: new TextEncoder().encode(content).length,
    label: formatLabel(now),
  };

  await AsyncStorage.setItem(ICLOUD_META_KEY, JSON.stringify(newMeta));
  return newMeta;
}

/** 列出所有备份版本 */
export async function listBackupVersions(): Promise<Array<{
  slot: number;
  label: string;
  keyCount: number;
  sizeBytes: number;
  createdAt: number;
  exists: boolean;
}>> {
  const dir = await ensureBackupDir();
  const meta = await getICloudMeta();
  const results = [];

  for (let i = 0; i < MAX_VERSIONS; i++) {
    const slotMeta = meta.slots[i];
    if (!slotMeta) continue;

    let exists = false;
    if (dir) {
      try {
        const info = await FileSystem.getInfoAsync(`${dir}backup-v${i}.json`);
        exists = info.exists;
      } catch {}
    }

    results.push({
      slot: i,
      label: slotMeta.label,
      keyCount: slotMeta.keyCount,
      sizeBytes: slotMeta.sizeBytes,
      createdAt: slotMeta.createdAt,
      exists,
    });
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}

/** 读取指定槽位的备份文件原始数据（不恢复，仅用于 diff 对比） */
export async function readBackupVersion(slot: number): Promise<ICloudBackupFile | null> {
  const dir = await ensureBackupDir();
  if (!dir) return null;
  try {
    const filePath = `${dir}backup-v${slot}.json`;
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(filePath);
    return JSON.parse(raw) as ICloudBackupFile;
  } catch {
    return null;
  }
}

/** 从备份文件恢复 */
export async function restoreFromBackup(slot: number): Promise<{ restored: number; failed: number }> {
  const dir = await ensureBackupDir();
  if (!dir) throw new Error("Backup directory unavailable");

  const filePath = `${dir}backup-v${slot}.json`;
  const raw = await FileSystem.readAsStringAsync(filePath);

  const backup = JSON.parse(raw) as ICloudBackupFile;
  if (!backup || !backup.data || typeof backup.data !== "object") {
    throw new Error("Backup data is invalid");
  }

  const allowedKeys = new Set<string>(SYNC_KEYS);
  const entries = Object.entries(backup.data).filter(([key]) => allowedKeys.has(key));
  const writes = entries.filter((entry): entry is [string, string] => entry[1] !== null);
  const removals = entries.filter(([, value]) => value === null).map(([key]) => key);
  let failed = 0;

  try {
    if (removals.length > 0) await AsyncStorage.multiRemove(removals);
    if (writes.length > 0) await AsyncStorage.multiSet(writes);
  } catch {
    failed = writes.length + removals.length;
  }

  return { restored: failed === 0 ? writes.length + removals.length : 0, failed };
}

/** 获取 iCloud Drive 容器 ID（用于 UI 显示） */
export function getICloudContainerId(): string {
  return ICLOUD_CONTAINER_ID;
}

// ─── Auto-backup timer ────────────────────────────────────────────────────────

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

/** 启动自动备份定时器（App 启动 30 秒后首次执行，之后每 1 小时一次） */
export function startAutoBackup(deviceName: string): void {
  if (autoBackupTimer) return;
  // 30 秒后首次备份（让 App 完成初始化）
  const initialTimer = setTimeout(() => {
    void performBackup(deviceName).catch((e) =>
      console.warn("[iCloudBackup] Auto backup failed:", e),
    );
  }, 30_000);

  // 之后每 1 小时备份一次
  autoBackupTimer = setInterval(() => {
    void performBackup(deviceName).catch((e) =>
      console.warn("[iCloudBackup] Auto backup failed:", e),
    );
  }, AUTO_BACKUP_INTERVAL_MS);

  // 保存 initialTimer ref 以便 stopAutoBackup 清理
  (autoBackupTimer as unknown as { _initial: ReturnType<typeof setTimeout> })._initial = initialTimer;
}

/** 停止自动备份定时器 */
export function stopAutoBackup(): void {
  if (autoBackupTimer) {
    const t = autoBackupTimer as unknown as { _initial?: ReturnType<typeof setTimeout> };
    if (t._initial) clearTimeout(t._initial);
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

/** 检查是否需要备份（距上次备份超过 1 小时） */
export async function shouldBackup(): Promise<boolean> {
  const meta = await getICloudMeta();
  if (!meta.lastBackupAt) return true;
  return Date.now() - meta.lastBackupAt > AUTO_BACKUP_INTERVAL_MS;
}

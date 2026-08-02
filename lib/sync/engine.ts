import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 云端同步引擎(类 iCloud 体验):
 * - 各 store 持久化后调用 notifySyncChange(key) 标记脏键
 * - 登录后 initialSync: 云端有数据 → 按键比较时间戳合并;首次 → 上传本地全量
 * - 脏键 debounce 3s 批量 push,last-write-wins per key
 * - 同步前自动备份本地数据，出错可一键恢复
 * - 60秒内双端都修改同一键 → 冲突，弹框让用户决策
 */

/** 参与云端同步的全部 AsyncStorage 键 */
export const SYNC_KEYS = [
  "cocktail.recipes",
  "cocktail.categories",
  "cocktail.tags",
  "cocktail.tagGroups",
  "cocktail.categoryGroups",
  "cocktail.seeded",
  "cocktail_waldorf_imported_v1",
  "cocktail.bottles",
  "cocktail.bottles.seeded",
  "cocktail.bottles.waldorf.v1",
  "homemade.preps.v1",
  "homemade.seeded.v1",
  "homemade.sections.v1",
  "homemade.types.v1",
  "homemade.taxonomy.v2",
  "homemade.waldorf.v1",
  "bottles.taxonomy.categories.v1",
  "bottles.taxonomy.styles.v1",
  "cocktail.lab.projects",
  "cocktail.lab.batches",
  "app.lang.v1",
  "cocktail.books.v1",
  "menu_store_v1",
  "shopping_store_v1",
  "cocktail.iceSettings.v2",
] as const;

const TS_PREFIX = "sync.ts.";
const LAST_SYNC_KEY = "sync.lastPulledAt";
const BACKUP_KEY = "sync.backup.v1";
const SYNC_LOG_KEY = "sync.log.v1";
const MAX_LOG_ENTRIES = 50;

/** 冲突判定窗口：60 秒内双端都有修改则视为冲突 */
const CONFLICT_WINDOW_MS = 60_000;

type PushFn = (
  entries: { storageKey: string; value: string; clientUpdatedAt: number }[],
) => Promise<unknown>;

/** 同步冲突：两端在 CONFLICT_WINDOW_MS 内都修改了同一个键 */
export type SyncConflict = {
  storageKey: string;
  localValue: string;
  localTs: number;
  remoteValue: string;
  remoteTs: number;
};

const dirtyKeys = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushFn: PushFn | null = null;
let syncEnabled = false;
const listeners = new Set<(state: SyncState) => void>();

export type SyncLogEntry = {
  time: number;
  type: "push" | "pull" | "backup" | "restore" | "error" | "conflict";
  keys?: string[];
  message?: string;
};

export type SyncState = {
  enabled: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
  hasBackup: boolean;
  log: SyncLogEntry[];
};

let state: SyncState = {
  enabled: false,
  syncing: false,
  lastSyncedAt: null,
  error: null,
  hasBackup: false,
  log: [],
};

function setState(patch: Partial<SyncState>) {
  const changed = (Object.keys(patch) as (keyof SyncState)[]).some((k) => state[k] !== patch[k]);
  if (!changed) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getSyncState() {
  return state;
}

export function subscribeSyncState(fn: (s: SyncState) => void) {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

async function appendLog(entry: SyncLogEntry) {
  try {
    const raw = await AsyncStorage.getItem(SYNC_LOG_KEY);
    const log: SyncLogEntry[] = raw ? JSON.parse(raw) : [];
    log.unshift(entry);
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    await AsyncStorage.setItem(SYNC_LOG_KEY, JSON.stringify(log));
    setState({ log });
  } catch {}
}

export async function initSyncState() {
  try {
    const [logRaw, backupRaw] = await Promise.all([
      AsyncStorage.getItem(SYNC_LOG_KEY),
      AsyncStorage.getItem(BACKUP_KEY),
    ]);
    const log: SyncLogEntry[] = logRaw ? JSON.parse(logRaw) : [];
    setState({ log, hasBackup: !!backupRaw });
  } catch {}
}

export async function backupLocalData(): Promise<void> {
  try {
    const snapshot: Record<string, string | null> = {};
    for (const key of SYNC_KEYS) {
      snapshot[key] = await AsyncStorage.getItem(key);
    }
    const backup = { time: Date.now(), data: snapshot };
    await AsyncStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    setState({ hasBackup: true });
    await appendLog({ time: Date.now(), type: "backup", message: "同步前自动备份" });
  } catch (e) {
    console.warn("Backup failed", e);
  }
}

export async function restoreFromBackup(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BACKUP_KEY);
    if (!raw) return false;
    const backup: { time: number; data: Record<string, string | null> } = JSON.parse(raw);
    for (const [key, value] of Object.entries(backup.data)) {
      if (value != null) {
        await AsyncStorage.setItem(key, value);
      } else {
        await AsyncStorage.removeItem(key);
      }
    }
    triggerStoreReload();
    await appendLog({
      time: Date.now(),
      type: "restore",
      message: `已恢复至 ${new Date(backup.time).toLocaleString()} 的备份`,
    });
    return true;
  } catch (e) {
    console.warn("Restore failed", e);
    return false;
  }
}

export async function getBackupInfo(): Promise<{ time: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const backup: { time: number } = JSON.parse(raw);
    return { time: backup.time };
  } catch {
    return null;
  }
}

export async function getSyncLog(): Promise<SyncLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SYNC_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 用户主动查看同步日志后调用，清除错误状态（消除红点角标） */
export function clearSyncError(): void {
  setState({ error: null });
}

/** store 持久化后调用:标记键为脏并调度推送 */
export function notifySyncChange(key: string) {
  if (!(SYNC_KEYS as readonly string[]).includes(key)) return;
  const now = Date.now();
  AsyncStorage.setItem(TS_PREFIX + key, String(now)).catch(() => {});
  if (!syncEnabled || !pushFn) return;
  dirtyKeys.add(key);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushDirtyKeys();
  }, 3000);
}

async function flushDirtyKeys() {
  if (!syncEnabled || !pushFn || dirtyKeys.size === 0) return;
  const keys = Array.from(dirtyKeys);
  dirtyKeys.clear();
  setState({ syncing: true });
  try {
    const entries: { storageKey: string; value: string; clientUpdatedAt: number }[] = [];
    for (const key of keys) {
      const [value, ts] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      if (value == null) continue;
      entries.push({
        storageKey: key,
        value,
        clientUpdatedAt: ts ? Number(ts) : Date.now(),
      });
    }
    if (entries.length > 0) {
      await pushFn(entries);
      const now = Date.now();
      setState({ lastSyncedAt: now, error: null, syncing: false });
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
      await appendLog({ time: now, type: "push", keys, message: `推送 ${keys.length} 个键` });
    } else {
      setState({ syncing: false });
    }
  } catch (err) {
    keys.forEach((k) => dirtyKeys.add(k));
    const msg = err instanceof Error ? err.message : "sync push failed";
    setState({ error: msg, syncing: false });
    await appendLog({ time: Date.now(), type: "error", message: msg });
  }
}

/**
 * 带冲突检测的初始同步。
 * 冲突定义：本地和云端都在 CONFLICT_WINDOW_MS 内修改了同一个键。
 * 冲突键不会自动覆盖，而是收集后返回给调用方，由 UI 弹框让用户选择。
 */
export async function runInitialSync(
  remoteEntries: { storageKey: string; value: string; clientUpdatedAt: number }[],
  push: PushFn,
): Promise<{ overwritten: boolean; conflicts: SyncConflict[] }> {
  pushFn = push;
  syncEnabled = true;
  setState({ enabled: true, syncing: true, error: null });
  let localOverwritten = false;
  const conflicts: SyncConflict[] = [];

  try {
    const remoteMap = new Map(remoteEntries.map((e) => [e.storageKey, e]));
    const toUpload: { storageKey: string; value: string; clientUpdatedAt: number }[] = [];
    const pulledKeys: string[] = [];

    // 预扫描：是否需要备份
    let willOverwrite = false;
    for (const key of SYNC_KEYS) {
      const [localValue, localTsRaw] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      const localTs = localTsRaw ? Number(localTsRaw) : 0;
      const remote = remoteMap.get(key);
      if (remote && localValue && localTs > 0 && remote.clientUpdatedAt > localTs) {
        const diff = Math.abs(remote.clientUpdatedAt - localTs);
        if (diff >= CONFLICT_WINDOW_MS) {
          willOverwrite = true;
          break;
        }
      }
    }
    if (willOverwrite) {
      await backupLocalData();
    }

    // 主同步循环
    for (const key of SYNC_KEYS) {
      const [localValue, localTsRaw] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      const localTs = localTsRaw ? Number(localTsRaw) : 0;
      const remote = remoteMap.get(key);

      if (remote && localValue && localTs > 0 && remote.clientUpdatedAt !== localTs) {
        const diff = Math.abs(remote.clientUpdatedAt - localTs);
        if (diff < CONFLICT_WINDOW_MS) {
          // 冲突：60秒内双端都有修改，不自动覆盖，交给用户决定
          conflicts.push({
            storageKey: key,
            localValue,
            localTs,
            remoteValue: remote.value,
            remoteTs: remote.clientUpdatedAt,
          });
          continue;
        }
      }

      if (remote && (!localValue || (localTs > 0 && remote.clientUpdatedAt > localTs))) {
        // 云端更新 → 覆盖本地
        await AsyncStorage.setItem(key, remote.value);
        await AsyncStorage.setItem(TS_PREFIX + key, String(remote.clientUpdatedAt));
        localOverwritten = true;
        pulledKeys.push(key);
      } else if (localValue != null && (!remote || localTs > remote.clientUpdatedAt)) {
        // 本地更新 → 上传
        toUpload.push({
          storageKey: key,
          value: localValue,
          clientUpdatedAt: localTs || Date.now(),
        });
      }
    }

    if (toUpload.length > 0) {
      for (let i = 0; i < toUpload.length; i += 8) {
        await push(toUpload.slice(i, i + 8));
      }
    }

    const now = Date.now();
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
    setState({ syncing: false, lastSyncedAt: now });

    if (pulledKeys.length > 0) {
      await appendLog({ time: now, type: "pull", keys: pulledKeys, message: `从云端拉取 ${pulledKeys.length} 个键` });
    }
    if (toUpload.length > 0) {
      await appendLog({ time: now, type: "push", keys: toUpload.map((e) => e.storageKey), message: `上传本地 ${toUpload.length} 个键` });
    }
    if (conflicts.length > 0) {
      await appendLog({ time: now, type: "conflict", keys: conflicts.map((c) => c.storageKey), message: `检测到 ${conflicts.length} 个冲突，等待用户决策` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sync failed";
    setState({ syncing: false, error: msg });
    await appendLog({ time: Date.now(), type: "error", message: msg });
  }
  return { overwritten: localOverwritten, conflicts };
}

/**
 * 解决冲突：用户选择保留本地或云端数据后调用。
 * keepLocal=true → 将本地数据上传覆盖云端
 * keepLocal=false → 将云端数据写入本地并触发 store 重载
 */
export async function resolveConflict(
  conflict: SyncConflict,
  keepLocal: boolean,
  push: PushFn,
): Promise<void> {
  if (keepLocal) {
    const now = Date.now();
    await push([{ storageKey: conflict.storageKey, value: conflict.localValue, clientUpdatedAt: now }]);
    await AsyncStorage.setItem(TS_PREFIX + conflict.storageKey, String(now));
    await appendLog({ time: now, type: "push", keys: [conflict.storageKey], message: `冲突解决：保留本地版本` });
  } else {
    await AsyncStorage.setItem(conflict.storageKey, conflict.remoteValue);
    await AsyncStorage.setItem(TS_PREFIX + conflict.storageKey, String(conflict.remoteTs));
    triggerStoreReload();
    await appendLog({ time: Date.now(), type: "pull", keys: [conflict.storageKey], message: `冲突解决：采用云端版本` });
  }
}

/** 登出或权限被拒时停用同步 */
export function disableSync() {
  syncEnabled = false;
  pushFn = null;
  dirtyKeys.clear();
  if (pushTimer) clearTimeout(pushTimer);
  setState({ enabled: false, syncing: false });
}

const reloadCallbacks = new Set<() => void>();

export function registerStoreReload(fn: () => void): () => void {
  reloadCallbacks.add(fn);
  return () => reloadCallbacks.delete(fn);
}

export function triggerStoreReload() {
  reloadCallbacks.forEach((fn) => fn());
}

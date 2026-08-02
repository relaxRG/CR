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
  "homemade.waldorf.v2",
  "homemade.source.v3",
  "bottles.taxonomy.categories.v1",
  "bottles.taxonomy.styles.v1",
  "cocktail.lab.projects",
  "cocktail.lab.batches",
  "app.lang.v1",
  "cocktail.books.v1",
  "menu_store_v1",
  "shopping_store_v1",
  "cocktail.iceSettings.v2",
  "cocktail.prefs.v1",
] as const;

const TS_PREFIX = "sync.ts.";
const LAST_SYNC_KEY = "sync.lastPulledAt";
const BACKUP_KEY = "sync.backup.v1";
const SYNC_LOG_KEY = "sync.log.v1";
const MAX_LOG_ENTRIES = 50;

/** 冲突判定窗口：60 秒内双端都有修改则视为冲突 */
const CONFLICT_WINDOW_MS = 60_000;

// ─── prefs 有利优先合并 ────────────────────────────────────────────────────────
/** 单条 pref 记录的类型 */
type PrefEntry = { favorite?: boolean; rating?: number | null; made?: boolean };
type PrefsMap = Record<string, PrefEntry>;

/**
 * 将两个 cocktail.prefs.v1 JSON 字符串按「有利优先」策略合并：
 * - favorite / made: 任一为 true 则保留 true（any-true-wins）
 * - rating: 取较高值；若一方为 null/undefined 则保留另一方的非空值
 * 返回合并后的 JSON 字符串，以及是否比本地原始值「更有利」（用于决定是否主动推送）。
 */
function mergePrefs(localJson: string, remoteJson: string): { merged: string; changed: boolean } {
  try {
    const local: PrefsMap = JSON.parse(localJson);
    const remote: PrefsMap = JSON.parse(remoteJson);
    const allIds = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const merged: PrefsMap = {};
    for (const id of allIds) {
      const l = local[id] ?? {};
      const r = remote[id] ?? {};
      const entry: PrefEntry = {};
      // favorite: any-true-wins
      if (l.favorite === true || r.favorite === true) {
        entry.favorite = true;
      } else if (l.favorite === false || r.favorite === false) {
        entry.favorite = false;
      }
      // made: any-true-wins
      if (l.made === true || r.made === true) {
        entry.made = true;
      } else if (l.made === false || r.made === false) {
        entry.made = false;
      }
      // rating: keep higher non-null value
      const lRating = typeof l.rating === "number" ? l.rating : null;
      const rRating = typeof r.rating === "number" ? r.rating : null;
      if (lRating !== null && rRating !== null) {
        entry.rating = Math.max(lRating, rRating);
      } else if (lRating !== null) {
        entry.rating = lRating;
      } else if (rRating !== null) {
        entry.rating = rRating;
      } else {
        entry.rating = null;
      }
      merged[id] = entry;
    }
    const mergedJson = JSON.stringify(merged);
    // 若合并结果与本地原始值不同，说明云端带来了更有利的数据，需要推送回去
    const changed = mergedJson !== localJson;
    return { merged: mergedJson, changed };
  } catch {
    // 解析失败时回退到本地值（保守策略）
    return { merged: localJson, changed: false };
  }
}

/** 是否为需要有利优先合并的 prefs 键 */
const PREFS_MERGE_KEYS = new Set<string>(["cocktail.prefs.v1"]);

// ─── ID 级别列表合并 ──────────────────────────────────────────────────────────
/**
 * 对「数组型」键执行 ID 级别合并：两端各自新增的条目取并集，不丢数据。
 */
function mergeIdList(
  localJson: string,
  remoteJson: string,
): { merged: string; changed: boolean } {
  try {
    type Item = { id: string; updatedAt?: number; clientUpdatedAt?: number; [k: string]: unknown };
    const local: Item[] = JSON.parse(localJson);
    const remote: Item[] = JSON.parse(remoteJson);
    if (!Array.isArray(local) || !Array.isArray(remote)) {
      return { merged: localJson, changed: false };
    }
    const map = new Map<string, Item>();
    for (const item of local) {
      if (item?.id) map.set(item.id, item);
    }
    for (const item of remote) {
      if (!item?.id) continue;
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, item);
      } else {
        const localTs = (existing.updatedAt ?? existing.clientUpdatedAt ?? 0) as number;
        const remoteTs = (item.updatedAt ?? item.clientUpdatedAt ?? 0) as number;
        if (remoteTs > localTs) map.set(item.id, item);
      }
    }
    const mergedJson = JSON.stringify(Array.from(map.values()));
    return { merged: mergedJson, changed: mergedJson !== localJson };
  } catch {
    return { merged: localJson, changed: false };
  }
}

function mergeStoreObject(
  localJson: string,
  remoteJson: string,
  arrayFields: string[],
): { merged: string; changed: boolean } {
  try {
    const local: Record<string, unknown> = JSON.parse(localJson);
    const remote: Record<string, unknown> = JSON.parse(remoteJson);
    if (typeof local !== "object" || typeof remote !== "object") {
      return { merged: localJson, changed: false };
    }
    const merged: Record<string, unknown> = { ...remote };
    let anyChanged = false;
    for (const field of arrayFields) {
      const localArr = local[field];
      const remoteArr = remote[field];
      if (!Array.isArray(localArr) || !Array.isArray(remoteArr)) continue;
      const { merged: mergedField, changed } = mergeIdList(
        JSON.stringify(localArr),
        JSON.stringify(remoteArr),
      );
      if (changed) {
        merged[field] = JSON.parse(mergedField);
        anyChanged = true;
      }
    }
    return { merged: JSON.stringify(merged), changed: anyChanged };
  } catch {
    return { merged: localJson, changed: false };
  }
}

const ID_LIST_KEYS = new Set<string>([
  "cocktail.recipes",
  "cocktail.bottles",
  "homemade.preps.v1",
  "cocktail.lab.projects",
  "cocktail.lab.batches",
]);

const STORE_OBJECT_KEYS = new Map<string, string[]>([
  ["menu_store_v1", ["groups"]],
  ["shopping_store_v1", ["items"]],
]);

function mergeByKey(
  key: string,
  localJson: string,
  remoteJson: string,
): { merged: string; changed: boolean } {
  if (PREFS_MERGE_KEYS.has(key)) return mergePrefs(localJson, remoteJson);
  if (ID_LIST_KEYS.has(key)) return mergeIdList(localJson, remoteJson);
  const storeFields = STORE_OBJECT_KEYS.get(key);
  if (storeFields) return mergeStoreObject(localJson, remoteJson, storeFields);
  return { merged: remoteJson, changed: remoteJson !== localJson };
}

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

const DIRTY_KEYS_PERSIST_KEY = "sync.dirtyKeys.pending";

async function persistDirtyKeys(): Promise<void> {
  const arr = Array.from(dirtyKeys);
  if (arr.length === 0) {
    await AsyncStorage.removeItem(DIRTY_KEYS_PERSIST_KEY).catch(() => {});
  } else {
    await AsyncStorage.setItem(DIRTY_KEYS_PERSIST_KEY, JSON.stringify(arr)).catch(() => {});
  }
}

async function loadPersistedDirtyKeys(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DIRTY_KEYS_PERSIST_KEY);
    if (!raw) return;
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const k of arr) {
      if (typeof k === "string" && (SYNC_KEYS as readonly string[]).includes(k)) {
        dirtyKeys.add(k);
      }
    }
  } catch { /* ignore */ }
}

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
  void persistDirtyKeys();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushDirtyKeys();
  }, 3000);
}

async function flushDirtyKeys() {
  if (!syncEnabled || !pushFn || dirtyKeys.size === 0) return;
  const keys = Array.from(dirtyKeys);
  dirtyKeys.clear();
  void persistDirtyKeys(); // clear persisted queue
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
    void persistDirtyKeys(); // re-persist failed keys
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

  // 加载上次会话中未推送的脏键
  await loadPersistedDirtyKeys();

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
        // 云端更新 → 按键类型选择合并策略
        let mergedValue = remote.value;
        if (localValue) {
          const { merged, changed } = mergeByKey(key, localValue, remote.value);
          mergedValue = merged;
          if (changed) {
            const now2 = Date.now();
            toUpload.push({ storageKey: key, value: merged, clientUpdatedAt: now2 });
          }
        }
        await AsyncStorage.setItem(key, mergedValue);
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
    // prefs 键：有利优先合并（不丢弃任何一方的正向数据）
    const valueToWrite = PREFS_MERGE_KEYS.has(conflict.storageKey)
      ? mergePrefs(conflict.localValue, conflict.remoteValue).merged
      : conflict.remoteValue;
    await AsyncStorage.setItem(conflict.storageKey, valueToWrite);
    await AsyncStorage.setItem(TS_PREFIX + conflict.storageKey, String(conflict.remoteTs));
    // 若合并结果比云端更有利，主动推送回去
    if (PREFS_MERGE_KEYS.has(conflict.storageKey)) {
      const { merged, changed } = mergePrefs(conflict.localValue, conflict.remoteValue);
      if (changed) {
        const now = Date.now();
        void push([{ storageKey: conflict.storageKey, value: merged, clientUpdatedAt: now }])
          .catch(() => {});
      }
    }
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

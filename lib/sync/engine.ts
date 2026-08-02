import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 云端同步引擎(类 iCloud 体验):
 * - 各 store 持久化后调用 notifySyncChange(key) 标记脏键
 * - 登录后 initialSync: 云端有数据 → 按键比较时间戳合并;首次 → 上传本地全量
 * - 脏键 debounce 3s 批量 push,last-write-wins per key
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

const TS_PREFIX = "sync.ts."; // 每个键的本地最后修改时间戳
const LAST_SYNC_KEY = "sync.lastPulledAt";

type PushFn = (
  entries: { storageKey: string; value: string; clientUpdatedAt: number }[],
) => Promise<unknown>;

const dirtyKeys = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushFn: PushFn | null = null;
let syncEnabled = false;
const listeners = new Set<(state: SyncState) => void>();

export type SyncState = {
  enabled: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
};

let state: SyncState = { enabled: false, syncing: false, lastSyncedAt: null, error: null };

function setState(patch: Partial<SyncState>) {
  // 仅在实际变化时更新并通知,避免订阅组件陷入 setState 循环
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
      setState({ lastSyncedAt: Date.now(), error: null });
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    }
  } catch (err) {
    // 推送失败:键重新标脏,等待下次调度
    keys.forEach((k) => dirtyKeys.add(k));
    setState({ error: err instanceof Error ? err.message : "sync push failed" });
  }
}

/**
 * 登录后初始同步。
 * @param remoteEntries 云端全部键值
 * @param push 推送函数
 * @returns 是否有云端数据覆盖了本地(需要 reload store)
 */
export async function runInitialSync(
  remoteEntries: { storageKey: string; value: string; clientUpdatedAt: number }[],
  push: PushFn,
): Promise<boolean> {
  pushFn = push;
  syncEnabled = true;
  setState({ enabled: true, syncing: true, error: null });
  let localOverwritten = false;
  try {
    const remoteMap = new Map(remoteEntries.map((e) => [e.storageKey, e]));
    const toUpload: { storageKey: string; value: string; clientUpdatedAt: number }[] = [];

    for (const key of SYNC_KEYS) {
      const [localValue, localTsRaw] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      const localTs = localTsRaw ? Number(localTsRaw) : 0;
      const remote = remoteMap.get(key);

      if (remote && (!localValue || (localTs > 0 && remote.clientUpdatedAt > localTs))) {
        // 云端更新 → 覆盖本地
        // 条件：本地无数据，或本地有时间戳且云端更新时间更新
        // 注意：localTs === 0 且本地有数据时，说明是本地新建但未同步过，
        // 此时不应直接被云端覆盖，而应上传本地数据（走下面的 else if 分支）
        await AsyncStorage.setItem(key, remote.value);
        await AsyncStorage.setItem(TS_PREFIX + key, String(remote.clientUpdatedAt));
        localOverwritten = true;
      } else if (localValue != null && (!remote || localTs > remote.clientUpdatedAt)) {
        // 本地更新（或云端没有，或本地有数据但无时间戳）→ 上传
        toUpload.push({
          storageKey: key,
          value: localValue,
          clientUpdatedAt: localTs || Date.now(),
        });
      }
    }

    if (toUpload.length > 0) {
      // 分批上传,避免单请求过大
      for (let i = 0; i < toUpload.length; i += 8) {
        await push(toUpload.slice(i, i + 8));
      }
    }
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    setState({ syncing: false, lastSyncedAt: Date.now() });
  } catch (err) {
    setState({ syncing: false, error: err instanceof Error ? err.message : "sync failed" });
  }
  return localOverwritten;
}

/** 登出或权限被拒时停用同步 */
export function disableSync() {
  syncEnabled = false;
  pushFn = null;
  dirtyKeys.clear();
  if (pushTimer) clearTimeout(pushTimer);
  setState({ enabled: false, syncing: false });
}

/**
 * 原生端 store 重载机制:
 * 初始同步覆盖本地 AsyncStorage 后,各 store 需要重新从 AsyncStorage 加载。
 * 通过注册/取消注册回调实现,避免在 engine 里直接依赖 React。
 */
const reloadCallbacks = new Set<() => void>();

export function registerStoreReload(fn: () => void): () => void {
  reloadCallbacks.add(fn);
  return () => reloadCallbacks.delete(fn);
}

export function triggerStoreReload() {
  reloadCallbacks.forEach((fn) => fn());
}

/**
 * 轻量版单条记录版本历史（P1-B）
 *
 * 对配方库、酒款库、自制品库的每条记录保留最近 5 个版本。
 * 用途：误删/误改单条记录时可从历史版本恢复，无需恢复整个快照。
 *
 * 存储键格式：sync.history.{storageKey}.{recordId}
 * 完全非阻塞：所有操作失败时静默降级，不影响主流程。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const MAX_VERSIONS = 5;
const HISTORY_PREFIX = "sync.history.";

export type RecordVersion = {
  version: number;       // 版本号（递增）
  savedAt: number;       // 保存时间戳
  data: unknown;         // 完整记录数据快照
  deviceName?: string;   // 保存时的设备名（可选）
};

/** 支持版本历史的存储键 */
const VERSIONED_KEYS = new Set([
  "cocktail.recipes",
  "cocktail.bottles",
  "homemade.preps.v1",
]);

/**
 * 保存记录版本（在 store 修改/删除记录时调用）
 * 完全非阻塞，失败时静默忽略。
 */
export async function saveRecordVersion(
  storageKey: string,
  recordId: string,
  data: unknown,
  deviceName?: string,
): Promise<void> {
  if (!VERSIONED_KEYS.has(storageKey)) return;
  try {
    const key = `${HISTORY_PREFIX}${storageKey}.${recordId}`;
    const raw = await AsyncStorage.getItem(key);
    const versions: RecordVersion[] = raw ? JSON.parse(raw) : [];
    const newVersion: RecordVersion = {
      version: (versions[0]?.version ?? 0) + 1,
      savedAt: Date.now(),
      data,
      deviceName,
    };
    versions.unshift(newVersion);
    if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
    await AsyncStorage.setItem(key, JSON.stringify(versions));
  } catch {
    // 静默忽略，不影响主流程
  }
}

/**
 * 获取记录的版本历史列表（按时间倒序）
 */
export async function getRecordHistory(
  storageKey: string,
  recordId: string,
): Promise<RecordVersion[]> {
  try {
    const key = `${HISTORY_PREFIX}${storageKey}.${recordId}`;
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * 恢复指定版本的记录数据
 * @returns 版本数据，未找到时返回 null
 */
export async function restoreRecordVersion(
  storageKey: string,
  recordId: string,
  version: number,
): Promise<unknown | null> {
  const history = await getRecordHistory(storageKey, recordId);
  return history.find((v) => v.version === version)?.data ?? null;
}

/**
 * 清理指定记录的所有历史版本（删除记录时调用）
 */
export async function clearRecordHistory(
  storageKey: string,
  recordId: string,
): Promise<void> {
  try {
    const key = `${HISTORY_PREFIX}${storageKey}.${recordId}`;
    await AsyncStorage.removeItem(key);
  } catch {
    // 静默忽略
  }
}

/**
 * 批量清理历史版本（数据重置时调用）
 */
export async function clearAllRecordHistory(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const historyKeys = allKeys.filter((k) => k.startsWith(HISTORY_PREFIX));
    if (historyKeys.length > 0) {
      await AsyncStorage.multiRemove(historyKeys);
    }
  } catch {
    // 静默忽略
  }
}

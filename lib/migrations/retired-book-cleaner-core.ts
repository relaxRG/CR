import { isRetiredBookStorageKey } from "@/lib/migrations/retired-book-storage";

export type RetiredBookStorageAdapter = {
  getAllKeys: () => Promise<readonly string[]>;
  multiRemove: (keys: string[]) => Promise<void>;
  deleteRetiredDirectory?: () => Promise<void>;
};

export type RetiredBookPurgeResult = {
  removedStorageKeys: number;
  directoryDeleteFailed: boolean;
};

/**
 * 一次性退役清理的纯核心。
 * 只有严格匹配的历史书库键可以被移除；目录清理失败不会阻断启动，并会在下次启动继续重试。
 */
export async function purgeRetiredBookStorage(adapter: RetiredBookStorageAdapter): Promise<RetiredBookPurgeResult> {
  const retiredKeys = (await adapter.getAllKeys()).filter(isRetiredBookStorageKey);
  if (retiredKeys.length > 0) await adapter.multiRemove(retiredKeys);

  let directoryDeleteFailed = false;
  if (adapter.deleteRetiredDirectory) {
    try {
      await adapter.deleteRetiredDirectory();
    } catch {
      directoryDeleteFailed = true;
    }
  }

  return { removedStorageKeys: retiredKeys.length, directoryDeleteFailed };
}

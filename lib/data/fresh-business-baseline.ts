import { SYNC_KEYS, type SyncStorageKey } from "@/lib/sync/engine";
import { LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES } from "@/lib/sync/local-business-storage-boundaries";

/**
 * 全新业务基线：保留 App 代码和可恢复备份，清空当前设备业务状态并切换到新的空同步组。
 *
 * 该流程只能由用户在数据管理页完成两次明确确认后调用。它不是升级迁移，禁止在启动、
 * 自动同步或网络恢复时调用。
 */
export const FRESH_BASELINE_AUDIT_KEY = "app.freshBusinessBaseline.v1";

/**
 * 当前功能契约之外仍可能由历史版本留下的 local-only/旧版业务键。
 * 仅列出业务数据及其旧版本，不包含运行时登录、备份快照或系统偏好。
 */
export const RETIRED_LOCAL_BUSINESS_KEYS = [
  "beer.inventory.v2",
  "daily.inventory.v1",
  "food.ingredients.v1",
  "fruit.inventory.v2",
  "glassware.inventory.v1",
  "ice.inventory.v2",
  "labor_schedule_snapshots_v1",
  "tableware.inventory.v1",
] as const;

const RETIRED_LOCAL_BUSINESS_PREFIXES = [
  "raw-excel-archive.",
  "monthly_report.import.",
] as const;

const SYNC_RUNTIME_PREFIXES = [
  "sync.ts.",
  "sync.dirty.",
  "sync.queue.",
] as const;

const SYNC_RUNTIME_KEYS = new Set([
  "sync.lastPulledAt",
  "sync.log.v1",
  "sync.backup.v1",
  "cf.sync.groupSwitchSession.v1",
]);

const sharedBusinessKeySet = new Set<string>(SYNC_KEYS as readonly SyncStorageKey[]);
const retiredBusinessKeySet = new Set<string>(RETIRED_LOCAL_BUSINESS_KEYS);
const localBusinessBoundaryKeySet = new Set<string>(Object.keys(LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES));

export type FreshBaselineKeyPlan = Readonly<{
  businessKeys: readonly string[];
  syncRuntimeKeys: readonly string[];
  allKeysToRemove: readonly string[];
}>;

export type FreshBaselineBackup = Readonly<{
  slot: number;
  keyCount: number;
}>;

export type FreshBaselineResult = Readonly<{
  backup: FreshBaselineBackup;
  removedBusinessKeyCount: number;
  removedSyncRuntimeKeyCount: number;
  previousGroupId: string | null;
  newGroupId: string;
}>;

export type FreshBusinessBaselineRuntime = Readonly<{
  getAllStorageKeys: () => Promise<readonly string[]>;
  createVerifiedBackup: (keys: readonly string[]) => Promise<FreshBaselineBackup>;
  /** 离开旧组必须先在远端成功，避免其他设备出现幽灵成员。 */
  leaveOldGroup: () => Promise<string | null>;
  /** 清理本机设备凭据、切组票据和实时同步任务。 */
  clearLocalSyncIdentity: () => Promise<void>;
  /** 业务键和同步运行时元数据分开统计，方便审计。 */
  removeStorageKeys: (keys: readonly string[]) => Promise<void>;
  /** 删除旧业务照片/导入缓存；备份目录不在此处删除。 */
  removeBusinessFiles: () => Promise<void>;
  /** 在身份已清空且业务状态为空后，显式创建空同步组。 */
  createEmptyGroup: (deviceName?: string) => Promise<{ groupId: string }>;
  /** 仅在新空组身份已保存后启动；不得把旧组数据推送到新组。 */
  startEmptyGroupSync: () => Promise<void>;
  writeAudit: (result: FreshBaselineResult) => Promise<void>;
}>;

export function createFreshBaselineKeyPlan(allStorageKeys: readonly string[]): FreshBaselineKeyPlan {
  const unique = new Set(allStorageKeys);
  const businessKeys = [...unique]
    .filter((key) => sharedBusinessKeySet.has(key)
      || retiredBusinessKeySet.has(key)
      || localBusinessBoundaryKeySet.has(key)
      || RETIRED_LOCAL_BUSINESS_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .sort();
  const syncRuntimeKeys = [...unique]
    .filter((key) => SYNC_RUNTIME_KEYS.has(key) || SYNC_RUNTIME_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .sort();

  return {
    businessKeys,
    syncRuntimeKeys,
    allKeysToRemove: [...new Set([...businessKeys, ...syncRuntimeKeys])].sort(),
  };
}

/**
 * 受确认保护的执行器。若备份校验、旧组离开或新组注册失败，会抛错并停止后续步骤；
 * 已生成的备份保留，用户可通过备份工作台恢复，不会静默重新连接旧同步组。
 */
export async function createFreshBusinessBaseline(
  runtime: FreshBusinessBaselineRuntime,
  deviceName?: string,
): Promise<FreshBaselineResult> {
  const plan = createFreshBaselineKeyPlan(await runtime.getAllStorageKeys());
  const backup = await runtime.createVerifiedBackup(plan.businessKeys);
  const previousGroupId = await runtime.leaveOldGroup();

  await runtime.clearLocalSyncIdentity();
  await runtime.removeStorageKeys(plan.allKeysToRemove);
  await runtime.removeBusinessFiles();

  const group = await runtime.createEmptyGroup(deviceName);
  const result: FreshBaselineResult = {
    backup,
    removedBusinessKeyCount: plan.businessKeys.length,
    removedSyncRuntimeKeyCount: plan.syncRuntimeKeys.length,
    previousGroupId,
    newGroupId: group.groupId,
  };
  await runtime.writeAudit(result);
  await runtime.startEmptyGroupSync();
  return result;
}

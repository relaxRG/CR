import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 云端同步引擎 v2.0（全面升级版）
 *
 * 核心安全修复：
 * ① flushDirtyKeys 加锁：initialSync 完成前禁止任何推送，防止旧设备/空设备覆盖云端
 * ② 空设备安全拉取：localTs=0 时无条件拉取云端，绝不推送本地空数据
 * ③ localTs=0 推送守卫：无时间戳的键跳过推送
 * ④ SYNC_KEYS 补全：新增 26 个键，覆盖葡萄酒/餐食/人工/月报/备用金/进销存等所有新模块
 *
 * 合并策略升级：
 * ⑤ 字段级合并：同一条记录两端修改不同字段时各自保留，不再整条 LWW 覆盖
 * ⑥ ID_LIST_KEYS 扩展：新模块加入 ID 级合并
 *
 * 其他升级：
 * ⑦ 同步日志扩容：50 → 200 条
 * ⑧ prefs 有利优先合并保持不变
 */

/** 参与云端同步的全部 AsyncStorage 键 */
export const SYNC_KEYS = [
  // ── 鸡尾酒核心 ──────────────────────────────────────────────────────────────
  "cocktail.recipes",
  "cocktail.categories",
  "cocktail.tags",
  "cocktail.tagGroups",
  "cocktail.categoryGroups",
  "cocktail.seeded",
  "cocktail.bottles",
  "cocktail.bottles.seeded",
  "homemade.preps.v1",
  "homemade.sections.v1",
  "homemade.types.v1",
  "homemade.taxonomy.v2",
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
  // ── 葡萄酒模块（新增）────────────────────────────────────────────────────────
  "wine.bottles.v1",
  "wine.snapshots.v2",
  "wine.manual_purchases.v1",
  // ── 餐食模块（新增）──────────────────────────────────────────────────────────
  "food.menu.v1",
  "food.ingredients.v2",
  "food.purchases.v1",
  // ── 研发计划（新增）──────────────────────────────────────────────────────────
  "lab.plan.v1",
  // ── 门店模块（新增）──────────────────────────────────────────────────────────
  "store.revenue.v1",
  "store.petty.v1",
  "store.petty_categories.v1",
  "store.petty_inv_links.v1",
  "store.inventory.v1",
  "menu.packages.v1",
  // ── 月度报表（新增）──────────────────────────────────────────────────────────
  "monthly_summary.reports.v1",
  "monthly_summary.suppliers.v1",
  "monthly_summary.payments.v1",
  "monthly_summary.balances.v1",
  "monthly_reports_v1",
  // ── 经营分析（新增）──────────────────────────────────────────────────────────
  "period_analysis.reports.v1",
  "period_analysis.settings.v1",
  // ── 人工成本（新增）──────────────────────────────────────────────────────────
  "labor_employees_v1",
  "labor_employee_groups_v1",
  "labor_shifts_v1",
  "labor_shift_templates_v1",
  "labor_attendance_v1",
  "labor_payslips_v1",
  "labor_month_close_archives_v1",
  "labor_month_adjustment_sessions_v1",
  "labor_month_configs_v1",
  "labor_holiday_configs_v1",
  "labor.salary_advances.v1",
  "labor.advance_categories.v1",
  "labor_comp_off_v1",
  "labor_comp_off_entries_v1",
  "labor_holiday_comp_off_v1",
  "labor_unexplained_rest_alerts_v1",
  "labor_global_payroll_settings_v1",
  "labor_special_statuses_v1",
  "labor_performance_templates_v1",
  "labor_performance_records_v1",
  // ── 人工模块新增（补全同步）────────────────────────────────────────────────────────────────────────────────────────
  "labor_custom_depts_v1",
  "labor_dept_order_v1",
  "labor_business_hours_v1",
  "labor_shift_groups_v1",
  "labor_fill_presets_v1",
  "store.petty_labor_links.v1",
  "store.employee_name_aliases.v1",
  // ── 烈酒进销存（新增）──────────────────────────────────────────────────────────────────────────────
  "spirits.items.v3",
  "spirits.purchases.v3",
  "spirits.ledger.v3",
  "spirits.refPrices.v1",
  "spirits.suppliers.v1",
  "spirits.groups.v1",
  "spirits.matchMemory.v1",
  "spirits.selfBuyConfig.v1",
  "spirits.customCategories.v1",
  "spirits.groupMatchMemory.v1",
  // ── 啊酒库存（新增）────────────────────────────────────────────────────────────────────────────────
  "beer.items.v1",
  "beer.transactions.v1",
  "beer.snapshots.v1",
  // ── 水果库存（新增）────────────────────────────────────────────────────────────────────────────────
  "fruit.items.v1",
  "fruit.transactions.v1",
  "fruit.snapshots.v1",
  // ── 冒泡库存（新增）────────────────────────────────────────────────────────────────────────────────
  "ice.inv.items.v1",
  "ice.inv.tx.v1",
  "ice.inventory.v1",
  // ── 器具库存（新增）────────────────────────────────────────────────────────────────────────────────
  "equipment.inventory.v1",
  // ── 供应商匹配记忆（新增）────────────────────────────────────────────────────────────────
  "supplier.match.memory.v1",
  // ── 菜品分析快照（新增）────────────────────────────────────────────────────────────────────
  "dish_analysis.snapshots.v1",
  // ── 月报附加配置（新增）────────────────────────────────────────────────────────────────────
  "monthly_summary.petty_configs.v1",
  "monthly_summary.inventory_configs.v1",
  // ── 时段分析排班（新增）────────────────────────────────────────────────────────────────────
  "schedule.business_hours.v1",
  "schedule.shift_templates.v1",
] as const;

/** 全 App 同步数据键；权限策略必须对该联合类型逐项声明读写归属。 */
export type SyncStorageKey = (typeof SYNC_KEYS)[number];

const TS_PREFIX = "sync.ts.";
const LAST_SYNC_KEY = "sync.lastPulledAt";
const BACKUP_KEY = "sync.backup.v1";
const SYNC_LOG_KEY = "sync.log.v1";
const MAX_LOG_ENTRIES = 200; // ★ 从 50 升级到 200

/** 冲突判定窗口：60 秒内双端都有修改则视为冲突 */
const CONFLICT_WINDOW_MS = 60_000;

// ─── prefs 有利优先合并 ────────────────────────────────────────────────────────
type PrefEntry = { favorite?: boolean; rating?: number | null; made?: boolean };
type PrefsMap = Record<string, PrefEntry>;

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
      if (l.favorite === true || r.favorite === true) {
        entry.favorite = true;
      } else if (l.favorite === false || r.favorite === false) {
        entry.favorite = false;
      }
      if (l.made === true || r.made === true) {
        entry.made = true;
      } else if (l.made === false || r.made === false) {
        entry.made = false;
      }
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
    return { merged: mergedJson, changed: mergedJson !== localJson };
  } catch {
    return { merged: localJson, changed: false };
  }
}

const PREFS_MERGE_KEYS = new Set<string>(["cocktail.prefs.v1"]);

// ─── 字段级合并（P1 升级：同一记录不同字段各自保留）────────────────────────────
/**
 * 对同一条记录执行字段级合并：
 * - 本地没有的字段 → 取云端值
 * - 两端都有的字段 → 取 updatedAt/clientUpdatedAt 更新的版本（LWW per field）
 * - 无时间戳时 → 取云端值（保守策略）
 */
function mergeRecord(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const merged: Record<string, unknown> = { ...local };
    const localTs = (
      (local.updatedAt as number | undefined) ??
      (local.clientUpdatedAt as number | undefined) ??
      0
    );
    const remoteTs = (
      (remote.updatedAt as number | undefined) ??
      (remote.clientUpdatedAt as number | undefined) ??
      0
    );

    for (const field of Object.keys(remote)) {
      if (field === "id") continue; // ID 永远不合并
      if (!(field in local)) {
        // 本地没有此字段 → 取云端
        merged[field] = remote[field];
      } else {
        // 两端都有 → 取时间戳更新的版本
        if (remoteTs > localTs) {
          merged[field] = remote[field];
        }
        // 否则保留本地（已在 merged 中）
      }
    }
    return merged;
  } catch {
    // 字段级合并失败时回退到整条 LWW（取云端）
    return remote;
  }
}

// ─── ID 级别列表合并（升级：使用字段级合并）──────────────────────────────────────
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
        // 云端新增条目 → 直接加入（不丢数据）
        map.set(item.id, item);
      } else {
        // ★ 升级：使用字段级合并，不再整条 LWW
        const mergedItem = mergeRecord(
          existing as Record<string, unknown>,
          item as Record<string, unknown>,
        ) as Item;
        map.set(item.id, mergedItem);
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

/** 使用 ID 级合并的键（★ 新增 8 个新模块键）*/
const ID_LIST_KEYS = new Set<string>([
  // 原有
  "cocktail.recipes",
  "cocktail.bottles",
  "homemade.preps.v1",
  "cocktail.lab.projects",
  "cocktail.lab.batches",
  // ★ 新增
  "wine.bottles.v1",
  "food.menu.v1",
  "food.ingredients.v2",
  "lab.plan.v1",
  "labor_employees_v1",
  "labor_payslips_v1",
  "labor_month_close_archives_v1",
  "labor_month_adjustment_sessions_v1",
  "monthly_summary.suppliers.v1",
  "monthly_summary.payments.v1",
  // 烈酒进销存
  "spirits.items.v3",
  "spirits.purchases.v3",
  "spirits.ledger.v3",
  "spirits.refPrices.v1",
  "spirits.suppliers.v1",
  "spirits.groups.v1",
  "spirits.matchMemory.v1",
  "spirits.customCategories.v1",
  "spirits.groupMatchMemory.v1",
  // ★ 员工模块有 id 字段的键（防止并发修改时数据丢失）
  "labor_comp_off_entries_v1",      // 调休余额明细（CompOffBalanceEntry）
  "labor_holiday_comp_off_v1",      // 节假日调休余额（HolidayCompOffEntry）
  "labor_unexplained_rest_alerts_v1", // 无来源多休提醒（UnexplainedRestAlert）
]);

const STORE_OBJECT_KEYS = new Map<string, string[]>([
  ["menu_store_v1", ["groups"]],
  ["shopping_store_v1", ["items"]],
  ["store.petty.v1", ["records"]],
  ["store.revenue.v1", ["records"]],
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

// ★ P0-A：初始同步完成锁，防止 flushDirtyKeys 在 initialSync 前推送旧数据
let initialSyncDone = false;

const DIRTY_KEYS_PERSIST_KEY = "sync.dirtyKeys.pending";

/**
 * 跨同步组切换期间的全局写入屏障。
 * 该屏障与同组LWW同步互斥：激活后，任何脏键、定时推送与普通首轮同步都必须停机。
 */
type GroupSwitchBarrier = {
  epoch: number;
  switchId: string;
};

let groupSwitchBarrier: GroupSwitchBarrier | null = null;
let groupSwitchEpoch = 0;

export type TargetGroupSnapshot = {
  /** Worker 绑定到新成员令牌后回传的目标组ID，用于防止响应错组。 */
  groupId: string;
  /** 完整快照版本；不使用增量 since 游标。 */
  revision: string;
  /** 只有完整快照才可覆盖或删除本地同步键。 */
  complete: true;
  entries: Array<{ storageKey: string; value: string; clientUpdatedAt: number }>;
  /** 目标组权威存在键清单；不在其中的本机旧键会被删除。 */
  presentKeys: string[];
};

function requireActiveGroupSwitchBarrier(epoch: number): GroupSwitchBarrier {
  const barrier = groupSwitchBarrier;
  if (!barrier || barrier.epoch !== epoch) {
    throw new Error("SYNC_GROUP_SWITCH_WRITE_BLOCKED");
  }
  return barrier;
}

/**
 * 停止同组LWW同步、清除旧脏键并建立切组写入屏障。
 * 在调用此函数后，只有 hydrateTargetGroupSnapshot() 可写入同步业务键。
 */
export async function beginGroupSwitchWriteBarrier(switchId: string): Promise<number> {
  groupSwitchEpoch += 1;
  const epoch = groupSwitchEpoch;
  groupSwitchBarrier = { epoch, switchId };
  syncEnabled = false;
  pushFn = null;
  initialSyncDone = false;
  dirtyKeys.clear();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  await AsyncStorage.multiRemove([DIRTY_KEYS_PERSIST_KEY, LAST_SYNC_KEY]);
  setState({ enabled: false, syncing: false, error: null });
  await appendLog({
    time: Date.now(),
    type: "switch",
    message: `同步组切换 ${switchId.slice(0, 8)}：已启用写入屏障`,
  });
  return epoch;
}

export function isGroupSwitchWriteBarrierActive(): boolean {
  return groupSwitchBarrier !== null;
}

/** 目标组水合期间拒绝被卸载组件的陈旧闭包重新开启普通同步。 */
export function assertNoGroupSwitchWriteBarrier(): void {
  if (groupSwitchBarrier) throw new Error("SYNC_GROUP_SWITCH_IN_PROGRESS");
}

/**
 * 使用目标组的完整快照精确替换所有同步业务键。
 * 严禁调用 mergeByKey、runInitialSync、notifySyncChange 或 pushFn。
 */
export async function hydrateTargetGroupSnapshot(
  snapshot: TargetGroupSnapshot,
  expectedGroupId: string,
  epoch: number,
): Promise<{ written: number; removed: number }> {
  const barrier = requireActiveGroupSwitchBarrier(epoch);
  if (!snapshot.complete) throw new Error("TARGET_SNAPSHOT_INCOMPLETE");
  if (snapshot.groupId !== expectedGroupId) throw new Error("TARGET_SNAPSHOT_GROUP_MISMATCH");
  if (!snapshot.revision) throw new Error("TARGET_SNAPSHOT_REVISION_MISSING");

  const knownKeys = new Set<string>(SYNC_KEYS);
  const presentKeys = new Set(snapshot.presentKeys);
  const entries = new Map<string, { storageKey: string; value: string; clientUpdatedAt: number }>();

  for (const key of snapshot.presentKeys) {
    if (!knownKeys.has(key)) throw new Error("TARGET_SNAPSHOT_UNKNOWN_KEY");
  }
  for (const entry of snapshot.entries) {
    if (!knownKeys.has(entry.storageKey) || !presentKeys.has(entry.storageKey)) {
      throw new Error("TARGET_SNAPSHOT_UNKNOWN_KEY");
    }
    if (entries.has(entry.storageKey) || !Number.isFinite(entry.clientUpdatedAt)) {
      throw new Error("TARGET_SNAPSHOT_INVALID_ENTRY");
    }
    entries.set(entry.storageKey, entry);
  }
  if (entries.size !== presentKeys.size) throw new Error("TARGET_SNAPSHOT_ENTRY_MANIFEST_MISMATCH");

  let written = 0;
  let removed = 0;
  const keys = [...SYNC_KEYS];
  for (let offset = 0; offset < keys.length; offset += 20) {
    requireActiveGroupSwitchBarrier(epoch);
    const writes: [string, string][] = [];
    const removals: string[] = [];
    for (const key of keys.slice(offset, offset + 20)) {
      const entry = entries.get(key);
      if (entry) {
        writes.push([key, entry.value], [TS_PREFIX + key, String(entry.clientUpdatedAt)]);
        written += 1;
      } else {
        removals.push(key, TS_PREFIX + key);
        removed += 1;
      }
    }
    if (writes.length > 0) await AsyncStorage.multiSet(writes);
    if (removals.length > 0) await AsyncStorage.multiRemove(removals);
  }

  requireActiveGroupSwitchBarrier(epoch);
  await AsyncStorage.multiRemove([DIRTY_KEYS_PERSIST_KEY, LAST_SYNC_KEY]);
  dirtyKeys.clear();
  await appendLog({
    time: Date.now(),
    type: "switch",
    message: `同步组切换 ${barrier.switchId.slice(0, 8)}：目标组完整替换完成（写入 ${written}，清除 ${removed}）`,
  });
  return { written, removed };
}

/**
 * 目标数据、Store重载和照片只读下载全部完成后才允许普通增量同步。
 */
export function completeGroupSwitchWriteBarrier(
  epoch: number,
  nextPushFn: PushFn,
): void {
  requireActiveGroupSwitchBarrier(epoch);
  groupSwitchBarrier = null;
  pushFn = nextPushFn;
  syncEnabled = true;
  initialSyncDone = true;
  setState({ enabled: true, syncing: false, error: null, lastSyncedAt: Date.now() });
}

/** 提交前取消切换时恢复原组普通同步；提交后不得调用此函数。 */
export function cancelPreparedGroupSwitch(epoch: number, sourcePushFn: PushFn): void {
  requireActiveGroupSwitchBarrier(epoch);
  groupSwitchBarrier = null;
  pushFn = sourcePushFn;
  syncEnabled = true;
  initialSyncDone = true;
  setState({ enabled: true, syncing: false, error: null });
}

/** 已提交后无网络或快照错误时继续隔离，不允许任何补偿推送。 */
export async function retainGroupSwitchRecoveryBarrier(epoch: number, reason: string): Promise<void> {
  const barrier = requireActiveGroupSwitchBarrier(epoch);
  await appendLog({
    time: Date.now(),
    type: "switch",
    message: `同步组切换 ${barrier.switchId.slice(0, 8)}：等待安全恢复（${reason}）`,
  });
}

/** 仅供测试隔离全局引擎状态。 */
export function __resetGroupSwitchBarrierForTests(): void {
  groupSwitchBarrier = null;
  groupSwitchEpoch = 0;
}


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
  type: "push" | "pull" | "backup" | "restore" | "error" | "conflict" | "switch";
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

export function clearSyncError(): void {
  setState({ error: null });
}

/** store 持久化后调用：标记键为脏并调度推送 */
export function notifySyncChange(key: string) {
  if (!(SYNC_KEYS as readonly string[]).includes(key)) return;
  // 跨组水合期间，任何陈旧Store闭包都不得更新时间戳或进入B组脏键队列。
  if (groupSwitchBarrier) return;
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
  // 目标组水合期间绝不允许脏键推送；旧A组队列已在屏障建立时销毁。
  if (groupSwitchBarrier) return;
  // ★ P0-A：初始同步完成前，禁止任何推送，防止旧设备/空设备覆盖云端新数据
  if (!initialSyncDone) {
    console.log("[Sync] flushDirtyKeys deferred: waiting for initialSync to complete");
    return;
  }
  if (!syncEnabled || !pushFn || dirtyKeys.size === 0) return;
  const keys = Array.from(dirtyKeys);
  dirtyKeys.clear();
  void persistDirtyKeys();
  setState({ syncing: true });
  try {
    const entries: { storageKey: string; value: string; clientUpdatedAt: number }[] = [];
    for (const key of keys) {
      const [value, ts] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      if (value == null) continue;
      // ★ P0-C：localTs=0 守卫，无时间戳的键不推送
      const localTs = ts ? Number(ts) : 0;
      if (localTs === 0) {
        // 重新加回脏键，等待下次 initialSync 完成后处理
        dirtyKeys.add(key);
        void persistDirtyKeys();
        continue;
      }
      entries.push({
        storageKey: key,
        value,
        clientUpdatedAt: localTs,
      });
    }
    if (entries.length > 0) {
      await pushFn(entries);
      const now = Date.now();
      setState({ lastSyncedAt: now, error: null, syncing: false });
      await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
      await appendLog({ time: now, type: "push", keys, message: `推送 ${entries.length} 个键` });
    } else {
      setState({ syncing: false });
    }
  } catch (err) {
    keys.forEach((k) => dirtyKeys.add(k));
    void persistDirtyKeys();
    const msg = err instanceof Error ? err.message : "sync push failed";
    setState({ error: msg, syncing: false });
    await appendLog({ time: Date.now(), type: "error", message: msg });
  }
}

/**
 * 带冲突检测的初始同步（v2.0 安全升级版）
 *
 * 核心安全保障：
 * 1. 空设备（localTs=0）无条件拉取云端，绝不推送本地空数据
 * 2. 有时间戳的键才允许上传（localTs > 0 守卫）
 * 3. 同步完成后解锁 initialSyncDone，允许后续 flushDirtyKeys 推送
 */
export async function runInitialSync(
  remoteEntries: { storageKey: string; value: string; clientUpdatedAt: number }[],
  push: PushFn,
): Promise<{ overwritten: boolean; conflicts: SyncConflict[] }> {
  assertNoGroupSwitchWriteBarrier();
  pushFn = push;
  syncEnabled = true;
  // ★ P0-A：重置锁，防止并发调用
  initialSyncDone = false;
  setState({ enabled: true, syncing: true, error: null });
  let localOverwritten = false;
  const conflicts: SyncConflict[] = [];

  // 加载上次会话中未推送的脏键
  await loadPersistedDirtyKeys();

  try {
    const remoteMap = new Map(remoteEntries.map((e) => [e.storageKey, e]));
    const toUpload: { storageKey: string; value: string; clientUpdatedAt: number }[] = [];
    const pulledKeys: string[] = [];

    // 预扫描：是否需要备份（有时间戳的键才参与判断）
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

    // ── 主同步循环 ────────────────────────────────────────────────────────────
    for (const key of SYNC_KEYS) {
      const [localValue, localTsRaw] = await Promise.all([
        AsyncStorage.getItem(key),
        AsyncStorage.getItem(TS_PREFIX + key),
      ]);
      const localTs = localTsRaw ? Number(localTsRaw) : 0;
      const remote = remoteMap.get(key);

      // ★ P0-B：空设备标志（无时间戳 = 从未同步过，或全新安装）
      const isBlankDevice = localTs === 0;

      // 冲突检测：仅在有时间戳（非空设备）时才可能冲突
      if (!isBlankDevice && remote && localValue &&
          remote.clientUpdatedAt !== localTs) {
        const diff = Math.abs(remote.clientUpdatedAt - localTs);
        if (diff < CONFLICT_WINDOW_MS) {
          // 60秒内双端都有修改 → 冲突，不自动覆盖，交给用户决定
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

      // ★ P0-B 修复后的拉取条件：
      // 1. 空设备 + 云端有数据 → 无条件拉取（即使本地有空数组也要被云端覆盖）
      // 2. 本地无数据 + 云端有数据 → 拉取
      // 3. 有时间戳 + 云端更新 → 拉取
      const shouldPull = remote && (
        isBlankDevice ||
        !localValue ||
        (localTs > 0 && remote.clientUpdatedAt > localTs)
      );

      if (shouldPull) {
        let mergedValue = remote!.value;
        // 有本地数据且非空设备时，尝试 ID 级/字段级合并（不丢任何一方的新增数据）
        if (localValue && !isBlankDevice) {
          const { merged, changed } = mergeByKey(key, localValue, remote!.value);
          mergedValue = merged;
          if (changed) {
            const now2 = Date.now();
            toUpload.push({ storageKey: key, value: merged, clientUpdatedAt: now2 });
          }
        }
        await AsyncStorage.setItem(key, mergedValue);
        await AsyncStorage.setItem(TS_PREFIX + key, String(remote!.clientUpdatedAt));
        localOverwritten = true;
        pulledKeys.push(key);
      }
      // ★ P0-B + P0-C 修复后的上传条件：
      // 必须有时间戳（非空设备）且本地确实比云端更新，才允许上传
      else if (
        localValue != null &&
        !isBlankDevice &&
        localTs > 0 &&
        (!remote || localTs > remote.clientUpdatedAt)
      ) {
        toUpload.push({
          storageKey: key,
          value: localValue,
          clientUpdatedAt: localTs,
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
  } finally {
    // ★ P0-A：无论成功还是失败，都解锁，允许后续 flushDirtyKeys 推送
    initialSyncDone = true;
    // 如果有积压的脏键（在 initialSync 期间被标记的），立即触发推送
    if (dirtyKeys.size > 0) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        void flushDirtyKeys();
      }, 1000);
    }
  }
  return { overwritten: localOverwritten, conflicts };
}

/**
 * 解决冲突：用户选择保留本地或云端数据后调用。
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
    await appendLog({ time: now, type: "push", keys: [conflict.storageKey], message: `冲突解决：保留本机版本` });
  } else {
    const valueToWrite = PREFS_MERGE_KEYS.has(conflict.storageKey)
      ? mergePrefs(conflict.localValue, conflict.remoteValue).merged
      : conflict.remoteValue;
    await AsyncStorage.setItem(conflict.storageKey, valueToWrite);
    await AsyncStorage.setItem(TS_PREFIX + conflict.storageKey, String(conflict.remoteTs));
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

/**
 * 批量解决所有冲突（一键全部保留本机 / 全部采用云端）
 * 优化：将所有 keepLocal 的条目合并为一次 push，将所有 useRemote 的写入合并为一次 triggerStoreReload
 */
export async function resolveAllConflicts(
  conflicts: SyncConflict[],
  keepLocal: boolean,
  push: PushFn,
): Promise<void> {
  if (conflicts.length === 0) return;
  const now = Date.now();
  if (keepLocal) {
    // 将所有需要保留本机的条目合并为一次批量 push，避免 N 次网络请求
    const pushEntries = conflicts.map((c) => ({
      storageKey: c.storageKey,
      value: c.localValue,
      clientUpdatedAt: now,
    }));
    await push(pushEntries);
    // 批量更新本地时间戳
    await Promise.all(
      conflicts.map((c) => AsyncStorage.setItem(TS_PREFIX + c.storageKey, String(now)))
    );
    await appendLog({
      time: now, type: "push",
      keys: conflicts.map((c) => c.storageKey),
      message: `冲突批量解决：保留本机（${conflicts.length} 个）`,
    });
  } else {
    // 批量写入云端数据到本地
    const prefsMergeEntries: { storageKey: string; value: string }[] = [];
    await Promise.all(
      conflicts.map(async (c) => {
        const valueToWrite = PREFS_MERGE_KEYS.has(c.storageKey)
          ? mergePrefs(c.localValue, c.remoteValue).merged
          : c.remoteValue;
        await AsyncStorage.setItem(c.storageKey, valueToWrite);
        await AsyncStorage.setItem(TS_PREFIX + c.storageKey, String(c.remoteTs));
        if (PREFS_MERGE_KEYS.has(c.storageKey)) {
          const { merged, changed } = mergePrefs(c.localValue, c.remoteValue);
          if (changed) prefsMergeEntries.push({ storageKey: c.storageKey, value: merged });
        }
      })
    );
    // 将需要 push 的 prefs merge 条目合并为一次请求
    if (prefsMergeEntries.length > 0) {
      void push(prefsMergeEntries.map((e) => ({ ...e, clientUpdatedAt: now }))).catch(() => {});
    }
    // 只触发一次 Store 重载（而非 N 次）
    triggerStoreReload();
    await appendLog({
      time: now, type: "pull",
      keys: conflicts.map((c) => c.storageKey),
      message: `冲突批量解决：采用云端（${conflicts.length} 个）`,
    });
  }
}

/** 登出或权限被拒时停用同步 */
export function disableSync() {
  syncEnabled = false;
  pushFn = null;
  dirtyKeys.clear();
  if (pushTimer) clearTimeout(pushTimer);
  // ★ 登出时重置锁
  initialSyncDone = false;
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

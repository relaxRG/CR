/**
 * 本地快照通道（V1：明文；不提供保密性）
 *
 * 功能：
 * - 每次 app 启动时自动创建快照（最多保留 7 个，循环覆盖）
 * - 每个快照包含非密码学校验值，只用于发现意外变更
 * - 支持从任意快照恢复
 * - 快照存储在 AsyncStorage（key: backup.snapshot.{0..6}）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SYNC_KEYS } from "@/lib/sync/engine";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import {
  createStaticSnapshotV2KeyResolver,
  decryptSnapshotV2,
  migrateSnapshotV1ToEncryptedV2,
  type EncryptedSnapshotV2,
  type SnapshotV2Crypto,
  type SnapshotV2KeyResolver,
} from "@/lib/backup/snapshot-v2";

const SNAPSHOT_PREFIX = "backup.snapshot.";
const SNAPSHOT_V2_PREFIX = "backup.snapshot.v2.";
const SNAPSHOT_META_KEY = "backup.meta";
const V1_FALLBACK_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const SNAPSHOT_RESTORE_JOURNAL_KEY = "backup.restore.journal.v1";
let snapshotV2KeyResolver: SnapshotV2KeyResolver | null = null;

/** 旧单密钥注入入口保留为安全适配；正式原生模块应改用configureSnapshotV2KeyResolver。 */
export function configureSnapshotV2Crypto(crypto: SnapshotV2Crypto | null): void {
  snapshotV2KeyResolver = crypto ? createStaticSnapshotV2KeyResolver(crypto) : null;
}

/** 原生AES-GCM提供器接入后由应用启动层注入；支持密钥轮换后读取历史V2快照。 */
export function configureSnapshotV2KeyResolver(resolver: SnapshotV2KeyResolver | null): void {
  snapshotV2KeyResolver = resolver;
}
const MAX_SNAPSHOTS = 7; // ★ 升级：3 → 7 个循环快照
const CHUNK_SIZE_LIMIT = 1.5 * 1024 * 1024; // ★ 1.5MB 分片阈値（防 AsyncStorage 2MB 上限）
const CHUNK_SUFFIX = ".chunks";

export type SnapshotMeta = {
  /** 当前写入槽位（0-6 循环） */
  currentSlot: number;
  /** 各槽位的快照信息 */
  slots: Array<{
    slot: number;
    createdAt: number;
    hash: string;
    keyCount: number;
    label: string; // e.g. "2026-07-14 17:30"
    v2State?: "verified" | "unavailable" | "failed";
    v1RetireAt?: number;
    v1Retired?: boolean;
  } | null>;
};

export type Snapshot = {
  createdAt: number;
  hash: string;
  data: Record<string, string | null>;
};

/** 计算非密码学校验值（不提供防篡改或保密性保证） */
function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
  return combined.toString(16).padStart(16, "0");
}

/** 格式化时间戳为可读标签 */
function formatLabel(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 读取快照元数据 */
export async function getSnapshotMeta(): Promise<SnapshotMeta> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_META_KEY);
    if (raw) {
      const meta = JSON.parse(raw) as SnapshotMeta;
      // ★ 兼容升级：老用户 slots 可能只有3个，自动扩展到 7 个
      while (meta.slots.length < MAX_SNAPSHOTS) meta.slots.push(null);
      return meta;
    }
  } catch {}
  return { currentSlot: 0, slots: Array(MAX_SNAPSHOTS).fill(null) };
}

function snapshotV2Key(slot: number): string {
  return `${SNAPSHOT_V2_PREFIX}${slot}`;
}

async function clearSnapshotV2(slot: number): Promise<void> {
  const base = snapshotV2Key(slot);
  const chunksRaw = await AsyncStorage.getItem(`${base}${CHUNK_SUFFIX}`).catch(() => null);
  const keys = [base, `${base}${CHUNK_SUFFIX}`];
  const chunks = Number(chunksRaw || 0);
  for (let index = 0; index < chunks; index += 1) keys.push(`${base}.chunk.${index}`);
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

async function writeSnapshotV2(slot: number, snapshot: EncryptedSnapshotV2): Promise<void> {
  const base = snapshotV2Key(slot);
  const json = JSON.stringify(snapshot);
  await clearSnapshotV2(slot);
  if (json.length <= CHUNK_SIZE_LIMIT) {
    await AsyncStorage.setItem(base, json);
    return;
  }
  const chunks = Math.ceil(json.length / CHUNK_SIZE_LIMIT);
  for (let index = 0; index < chunks; index += 1) {
    await AsyncStorage.setItem(`${base}.chunk.${index}`, json.slice(index * CHUNK_SIZE_LIMIT, (index + 1) * CHUNK_SIZE_LIMIT));
  }
  await AsyncStorage.setItem(`${base}${CHUNK_SUFFIX}`, String(chunks));
}

async function readSnapshotV2(slot: number): Promise<EncryptedSnapshotV2 | null> {
  try {
    const base = snapshotV2Key(slot);
    const chunksRaw = await AsyncStorage.getItem(`${base}${CHUNK_SUFFIX}`);
    if (chunksRaw) {
      const chunks = Number(chunksRaw);
      if (!Number.isInteger(chunks) || chunks < 1 || chunks > 10_000) return null;
      let json = "";
      for (let index = 0; index < chunks; index += 1) {
        const part = await AsyncStorage.getItem(`${base}.chunk.${index}`);
        if (!part) return null;
        json += part;
      }
      return JSON.parse(json) as EncryptedSnapshotV2;
    }
    const raw = await AsyncStorage.getItem(base);
    return raw ? JSON.parse(raw) as EncryptedSnapshotV2 : null;
  } catch {
    return null;
  }
}

async function decryptSnapshotV2ForSlot(slot: number, encrypted: EncryptedSnapshotV2): Promise<Record<string, string | null>> {
  if (!snapshotV2KeyResolver) throw new Error("SNAPSHOT_V2_KEY_RESOLVER_UNAVAILABLE");
  const crypto = await snapshotV2KeyResolver.getByKeyId(encrypted.keyId);
  if (!crypto) throw new Error("SNAPSHOT_V2_KEY_UNAVAILABLE");
  const meta = await getSnapshotMeta();
  const mirror = meta.slots[slot];
  if (!mirror || mirror.createdAt !== encrypted.source.createdAt || mirror.hash !== encrypted.source.hash) {
    throw new Error("SNAPSHOT_V2_MIRROR_STALE");
  }
  return decryptSnapshotV2(encrypted, crypto);
}

/** 创建新快照（循环覆盖最旧的槽位） */
export async function createSnapshot(keys: readonly string[] = SYNC_KEYS): Promise<SnapshotMeta> {
  await recoverPendingSnapshotRestore();
  await retireVerifiedV1Snapshots();
  const meta = await getSnapshotMeta();
  const slot = meta.currentSlot % MAX_SNAPSHOTS;

  // 仅读取调用方明确声明的业务键。默认仍是完整同步键集合；全新业务基线会传入经注册表筛选的业务键。
  const pairs = await AsyncStorage.multiGet([...new Set(keys)]);
  const data: Record<string, string | null> = {};
  for (const [key, value] of pairs) {
    data[key] = value;
  }

  const now = Date.now();
  const serialized = JSON.stringify(data);
  const hash = simpleHash(serialized);

  const snapshot: Snapshot = { createdAt: now, hash, data };

  // ★ 分片写入：超过 1.5MB 时自动分片存储，防止 AsyncStorage 2MB 上限
  const snapshotJson = JSON.stringify(snapshot);
  if (snapshotJson.length > CHUNK_SIZE_LIMIT) {
    await saveSnapshotChunked(slot, snapshotJson);
  } else {
    // 如果之前有分片，先清除它们
    await clearSnapshotChunks(slot);
    await AsyncStorage.setItem(`${SNAPSHOT_PREFIX}${slot}`, snapshotJson);
  }

  // V2 双写只在受审查的原生 AES-GCM 提供器已注入时发生。写入后立即解密验证；
  // V2认证失败时不删除V1，避免生成不可恢复的唯一快照。
  let v2State: "verified" | "unavailable" | "failed" = "unavailable";
  if (snapshotV2KeyResolver) {
    try {
      const crypto = await snapshotV2KeyResolver.getActive();
      const encrypted = await migrateSnapshotV1ToEncryptedV2(snapshot, crypto);
      await writeSnapshotV2(slot, encrypted);
      const verified = await decryptSnapshotV2(encrypted, crypto);
      if (Object.keys(verified).length !== encrypted.manifest.keyCount) throw new Error("SNAPSHOT_V2_VERIFY_COUNT_MISMATCH");
      v2State = "verified";
    } catch {
      await clearSnapshotV2(slot);
      v2State = "failed";
    }
  }

  // 更新元数据。仅在V2认证验证完成后启动V1淘汰窗口。
  const newMeta: SnapshotMeta = {
    currentSlot: (slot + 1) % MAX_SNAPSHOTS,
    slots: [...meta.slots],
  };
  newMeta.slots[slot] = {
    slot,
    createdAt: now,
    hash,
    keyCount: Object.keys(data).filter((k) => data[k] !== null).length,
    label: formatLabel(now),
    v2State,
    ...(v2State === "verified" ? { v1RetireAt: now + V1_FALLBACK_RETAIN_MS } : {}),
  };

  await AsyncStorage.setItem(SNAPSHOT_META_KEY, JSON.stringify(newMeta));
  return newMeta;
}

/**
 * 创建并验证一个快照。任何校验失败都会抛错，调用方不得继续执行不可逆的数据清理。
 */
export async function createVerifiedSnapshot(keys: readonly string[] = SYNC_KEYS): Promise<{ meta: SnapshotMeta; slot: number; keyCount: number }> {
  const meta = await createSnapshot(keys);
  const slot = (meta.currentSlot + MAX_SNAPSHOTS - 1) % MAX_SNAPSHOTS;
  const verified = await verifySnapshot(slot);
  if (!verified) throw new Error("SNAPSHOT_VERIFICATION_FAILED");
  const keyCount = meta.slots[slot]?.keyCount ?? 0;
  return { meta, slot, keyCount };
}

/** ★ 分片写入快照 */
async function saveSnapshotChunked(slot: number, json: string): Promise<void> {
  const chunkSize = Math.floor(CHUNK_SIZE_LIMIT);
  const chunks = Math.ceil(json.length / chunkSize);
  // 先清除旧单条存储
  await AsyncStorage.removeItem(`${SNAPSHOT_PREFIX}${slot}`).catch(() => {});
  for (let i = 0; i < chunks; i++) {
    const chunk = json.slice(i * chunkSize, (i + 1) * chunkSize);
    await AsyncStorage.setItem(`${SNAPSHOT_PREFIX}${slot}.chunk.${i}`, chunk);
  }
  await AsyncStorage.setItem(`${SNAPSHOT_PREFIX}${slot}${CHUNK_SUFFIX}`, String(chunks));
}

/** ★ 清除分片数据 */
async function clearSnapshotChunks(slot: number): Promise<void> {
  try {
    const chunksRaw = await AsyncStorage.getItem(`${SNAPSHOT_PREFIX}${slot}${CHUNK_SUFFIX}`);
    if (!chunksRaw) return;
    const chunks = Number(chunksRaw);
    const keys = [`${SNAPSHOT_PREFIX}${slot}${CHUNK_SUFFIX}`];
    for (let i = 0; i < chunks; i++) keys.push(`${SNAPSHOT_PREFIX}${slot}.chunk.${i}`);
    await AsyncStorage.multiRemove(keys);
  } catch {}
}

/** ★ 分片读取快照 */
async function readSnapshotChunked(slot: number): Promise<string | null> {
  try {
    const chunksRaw = await AsyncStorage.getItem(`${SNAPSHOT_PREFIX}${slot}${CHUNK_SUFFIX}`);
    if (!chunksRaw) return null;
    const chunks = Number(chunksRaw);
    let json = "";
    for (let i = 0; i < chunks; i++) {
      const chunk = await AsyncStorage.getItem(`${SNAPSHOT_PREFIX}${slot}.chunk.${i}`);
      if (!chunk) return null; // 分片不完整，放弃
      json += chunk;
    }
    return json;
  } catch {
    return null;
  }
}

/** 读取指定槽位的快照：V2存在时必须成功认证解密，绝不降级读取V1。 */
export async function readSnapshot(slot: number): Promise<Snapshot | null> {
  const encrypted = await readSnapshotV2(slot);
  if (encrypted) {
    const data = await decryptSnapshotV2ForSlot(slot, encrypted);
    return { createdAt: encrypted.createdAt, hash: encrypted.source.hash, data };
  }
  try {
    const meta = await getSnapshotMeta();
    const slotMeta = meta.slots[slot];
    if (slotMeta?.v1Retired) return null;
    const chunked = await readSnapshotChunked(slot);
    if (chunked) return JSON.parse(chunked) as Snapshot;
    const raw = await AsyncStorage.getItem(`${SNAPSHOT_PREFIX}${slot}`);
    return raw ? JSON.parse(raw) as Snapshot : null;
  } catch {
    return null;
  }
}

/** 校验快照完整性：V2依赖AEAD认证标签；V1仅用于淘汰窗口内的意外损坏检测。 */
export async function verifySnapshot(slot: number): Promise<boolean> {
  try {
    const encrypted = await readSnapshotV2(slot);
    if (encrypted) {
      await decryptSnapshotV2ForSlot(slot, encrypted);
      return true;
    }
    const snapshot = await readSnapshot(slot);
    if (!snapshot) return false;
    return simpleHash(JSON.stringify(snapshot.data)) === snapshot.hash;
  } catch {
    return false;
  }
}

type SnapshotRestoreJournal = {
  slot: number;
  before: Record<string, string | null>;
};

async function rollbackSnapshotRestore(journal: SnapshotRestoreJournal): Promise<void> {
  const writes = Object.entries(journal.before)
    .filter((entry): entry is [string, string] => entry[1] !== null);
  const removals = Object.entries(journal.before)
    .filter((entry) => entry[1] === null)
    .map(([key]) => key);
  if (removals.length) await AsyncStorage.multiRemove(removals);
  if (writes.length) await AsyncStorage.multiSet(writes);
}

/** 应用启动时调用：检测崩溃遗留恢复日志并回滚到恢复前的完整本地状态。 */
export async function recoverPendingSnapshotRestore(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_RESTORE_JOURNAL_KEY).catch(() => null);
  if (!raw) return false;
  try {
    const journal = JSON.parse(raw) as SnapshotRestoreJournal;
    if (!journal || typeof journal.slot !== "number" || !journal.before || typeof journal.before !== "object") {
      throw new Error("SNAPSHOT_RESTORE_JOURNAL_INVALID");
    }
    await rollbackSnapshotRestore(journal);
    await AsyncStorage.removeItem(SNAPSHOT_RESTORE_JOURNAL_KEY);
    return true;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "SNAPSHOT_RESTORE_RECOVERY_FAILED");
  }
}

/** 从快照恢复数据；采用恢复日志、null键删除和失败回滚，避免半恢复状态。 */
export async function restoreFromSnapshot(slot: number): Promise<{ restored: number; failed: number }> {
  let snapshot: Snapshot;
  try {
    const resolved = await readSnapshot(slot);
    if (!resolved) throw new Error("SNAPSHOT_UNAVAILABLE_OR_RETIRED");
    snapshot = resolved;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "SNAPSHOT_RESTORE_REJECTED");
  }

  const encrypted = await readSnapshotV2(slot);
  if (!encrypted && simpleHash(JSON.stringify(snapshot.data)) !== snapshot.hash) {
    throw new Error("SNAPSHOT_V1_INTEGRITY_FAILED");
  }

  const applicable = Object.entries(snapshot.data)
    .filter(([key]) => (SYNC_KEYS as readonly string[]).includes(key));
  const keys = applicable.map(([key]) => key);
  const before = Object.fromEntries(await AsyncStorage.multiGet(keys));
  const journal: SnapshotRestoreJournal = { slot, before };
  const writes = applicable
    .filter((entry): entry is [string, string] => entry[1] !== null);
  const removals = applicable.filter(([, value]) => value === null).map(([key]) => key);

  await AsyncStorage.setItem(SNAPSHOT_RESTORE_JOURNAL_KEY, JSON.stringify(journal));
  try {
    if (removals.length) await AsyncStorage.multiRemove(removals);
    if (writes.length) await AsyncStorage.multiSet(writes);
    await AsyncStorage.removeItem(SNAPSHOT_RESTORE_JOURNAL_KEY);
    return { restored: writes.length + removals.length, failed: 0 };
  } catch {
    try { await rollbackSnapshotRestore(journal); } catch {}
    throw new Error("SNAPSHOT_RESTORE_WRITE_FAILED");
  }
}

/** 淘汰已认证V2副本对应的V1明文；只能在30天回退窗口结束后调用。 */
export async function retireVerifiedV1Snapshots(now = Date.now()): Promise<number> {
  const meta = await getSnapshotMeta();
  let retired = 0;
  for (const slotMeta of meta.slots) {
    if (!slotMeta || slotMeta.v2State !== "verified" || slotMeta.v1Retired || !slotMeta.v1RetireAt || slotMeta.v1RetireAt > now) continue;
    const encrypted = await readSnapshotV2(slotMeta.slot);
    if (!encrypted) continue;
    try {
      await decryptSnapshotV2ForSlot(slotMeta.slot, encrypted);
    } catch {
      continue;
    }
    await clearSnapshotChunks(slotMeta.slot);
    await AsyncStorage.removeItem(`${SNAPSHOT_PREFIX}${slotMeta.slot}`);
    slotMeta.v1Retired = true;
    retired += 1;
  }
  if (retired) await AsyncStorage.setItem(SNAPSHOT_META_KEY, JSON.stringify(meta));
  return retired;
}

/** ★ 升级：全模块数据摘要统计 */
export type DataCounts = {
  recipes: number;
  bottles: number;
  homemade: number;
  wine: number;
  foodMenu: number;
  foodIngredients: number;
  labProjects: number;
  labPlan: number;
  employees: number;
  paySlips: number;
  monthlyReports: number;
  pettyRecords: number;
};

function parseDataCounts(data: Record<string, string | null>): DataCounts {
  const parse = (key: string): number => {
    const raw = data[key];
    if (!raw) return 0;
    try {
      const val = JSON.parse(raw);
      if (Array.isArray(val)) return val.length;
      // 对象类型（如 { records: [] }）取第一个数组字段的长度
      if (val && typeof val === "object") {
        const firstArr = Object.values(val).find(Array.isArray);
        return firstArr ? (firstArr as unknown[]).length : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  };
  return {
    recipes:        parse("cocktail.recipes"),
    bottles:        parse("cocktail.bottles"),
    homemade:       parse("homemade.preps.v1"),
    wine:           parse("wine.bottles.v1"),
    foodMenu:       parse("food.menu.v1"),
    foodIngredients: parse("food.ingredients.v2"),
    labProjects:    parse("cocktail.lab.projects"),
    labPlan:        parse("lab.plan.v1"),
    employees:      parse("labor_employees_v1"),
    paySlips:       parse("labor_payslips_v1"),
    monthlyReports: parse("monthly_summary.reports.v1"),
    pettyRecords:   parse("store.petty.v1"),
  };
}

/** ★ 升级：计算快照与当前数据的差异摘要（全模块） */
export async function computeSnapshotDiff(slot: number): Promise<{
  snapshot: DataCounts;
  current: DataCounts;
} | null> {
  const snapshot = await readSnapshot(slot);
  if (!snapshot) return null;
  const SUMMARY_KEYS = [
    "cocktail.recipes", "cocktail.bottles", "homemade.preps.v1",
    "wine.bottles.v1", "food.menu.v1", "food.ingredients.v2",
    "cocktail.lab.projects", "lab.plan.v1",
    "labor_employees_v1", "labor_payslips_v1",
    "monthly_summary.reports.v1", "store.petty.v1",
  ];
  const currentPairs = await AsyncStorage.multiGet(SUMMARY_KEYS);
  const currentData: Record<string, string | null> = {};
  for (const [k, v] of currentPairs) currentData[k] = v;
  return {
    snapshot: parseDataCounts(snapshot.data),
    current: parseDataCounts(currentData),
  };
}

/** ★ 升级：从任意 data 字段计算差异摘要（用于 iCloud 备份 diff） */
export function computeBackupFileDiff(
  backupData: Record<string, string | null>,
  currentData: Record<string, string | null>,
): { snapshot: DataCounts; current: DataCounts } {
  return {
    snapshot: parseDataCounts(backupData),
    current: parseDataCounts(currentData),
  };
}

/** 获取所有有效快照的摘要（用于 UI 展示） */
export async function listSnapshots(): Promise<Array<{
  slot: number;
  label: string;
  keyCount: number;
  hash: string;
  createdAt: number;
  isValid: boolean;
}>> {
  const meta = await getSnapshotMeta();
  const results = [];
  for (let i = 0; i < MAX_SNAPSHOTS; i++) {
    const slotMeta = meta.slots[i];
    if (!slotMeta) continue;
    const isValid = await verifySnapshot(i);
    results.push({
      slot: i,
      label: slotMeta.label,
      keyCount: slotMeta.keyCount,
      hash: slotMeta.hash.slice(0, 8) + "...",
      createdAt: slotMeta.createdAt,
      isValid,
    });
  }
  // 按时间倒序
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 将指定槽位的快照导出为 JSON 文件并通过系统分享面板分享
 * 支持保存到 Files、发送到邮件/AirDrop 等
 */
export async function exportSnapshotToFile(slot: number): Promise<void> {
  if (Platform.OS === "web") {
    throw new Error("Web 平台不支持文件导出，请使用移动设备");
  }
  const snapshot = await readSnapshot(slot);
  if (!snapshot) throw new Error(`快照槽位 ${slot} 不存在`);

  const meta = await getSnapshotMeta();
  const slotMeta = meta.slots[slot];
  const label = slotMeta?.label ?? new Date(snapshot.createdAt).toISOString().slice(0, 16).replace("T", "_");
  const safeLabel = label.replace(/[: ]/g, "-");

  const exportData = {
    version: 1,
    appId: "cocktail-r",
    exportedAt: new Date().toISOString(),
    snapshotCreatedAt: new Date(snapshot.createdAt).toISOString(),
    hash: snapshot.hash,
    keyCount: Object.keys(snapshot.data).filter((k) => snapshot.data[k] !== null).length,
    data: snapshot.data,
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `cocktail-r-backup-${safeLabel}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("当前设备不支持文件分享");

  await Sharing.shareAsync(fileUri, {
    mimeType: "application/json",
    dialogTitle: "导出 cocktail R 备份",
    UTI: "public.json",
  });
}

/**
 * 将当前所有数据（实时读取，不依赖快照）导出为 JSON 文件
 * 适合在没有快照时直接导出当前状态
 */
export async function exportCurrentDataToFile(): Promise<void> {
  if (Platform.OS === "web") {
    throw new Error("Web 平台不支持文件导出，请使用移动设备");
  }

  const pairs = await AsyncStorage.multiGet([...SYNC_KEYS]);
  const data: Record<string, string | null> = {};
  for (const [key, value] of pairs) {
    data[key] = value;
  }

  const now = Date.now();
  const label = new Date(now).toISOString().slice(0, 16).replace("T", "_").replace(/:/g, "-");

  const exportData = {
    version: 1,
    appId: "cocktail-r",
    exportedAt: new Date(now).toISOString(),
    snapshotCreatedAt: new Date(now).toISOString(),
    keyCount: Object.keys(data).filter((k) => data[k] !== null).length,
    data,
  };

  const json = JSON.stringify(exportData, null, 2);
  const filename = `cocktail-r-backup-${label}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("当前设备不支持文件分享");

  await Sharing.shareAsync(fileUri, {
    mimeType: "application/json",
    dialogTitle: "导出 cocktail R 备份",
    UTI: "public.json",
  });
}

/**
 * 从 JSON 文件导入数据（恢复备份）
 * @param jsonString 从文件读取的 JSON 字符串
 */
export async function importFromJsonFile(jsonString: string): Promise<{ restored: number; failed: number }> {
  let parsed: { version?: number; appId?: string; data?: Record<string, string | null> };
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("文件格式无效，请选择正确的 cocktail R 备份文件");
  }

  if (parsed.appId !== "cocktail-r") {
    throw new Error("该文件不是 cocktail R 的备份文件");
  }
  if (!parsed.data || typeof parsed.data !== "object") {
    throw new Error("备份文件数据损坏");
  }

  // 版本兼容性检查（当前支持 version 1）
  const fileVersion = typeof parsed.version === "number" ? parsed.version : 1;
  if (fileVersion > 1) {
    throw new Error(`备份文件版本 (v${fileVersion}) 高于当前应用支持版本 (v1)，请升级应用后再导入`);
  }

  // 数据结构深度校验：每个值必须是字符串或 null，且值本身应为合法 JSON
  const dataEntries = Object.entries(parsed.data);
  if (dataEntries.length === 0) {
    throw new Error("备份文件不包含任何数据");
  }
  let validCount = 0;
  for (const [, value] of dataEntries) {
    if (value === null) continue;
    if (typeof value !== "string") {
      throw new Error("备份文件数据格式错误：数据值必须为字符串或 null");
    }
    // 验证每个值是否为合法 JSON（cocktail R 所有存储值均为 JSON 序列化字符串）
    try {
      JSON.parse(value);
      validCount++;
    } catch {
      throw new Error(`备份文件数据损坏：键 "${Object.keys(parsed.data ?? {})[validCount]}" 的值不是合法的 JSON`);
    }
  }

  let restored = 0;
  let failed = 0;
  for (const [key, value] of Object.entries(parsed.data)) {
    try {
      if (value !== null && (SYNC_KEYS as readonly string[]).includes(key)) {
        await AsyncStorage.setItem(key, value);
        restored++;
      }
    } catch {
      failed++;
    }
  }
  return { restored, failed };
}

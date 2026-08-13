/**
 * 成品照片云端同步（Cloudflare D1 base64 存储）
 *
 * 设计要点：
 * - photoId = 文件名（recipeId_ts.ext），全组唯一，跨设备稳定
 * - photoUris 存的是绝对路径（file:///...documentDirectory...），不同设备前缀不同，
 *   因此下载恢复后需要按「文件名尾段」把 recipe.photoUris 重写为本机路径。
 * - 上传去重：AsyncStorage 记录已上传 photoId 集合（cf.photoSync.uploaded）
 * - 非阻塞：挂在 performSync 之后 void 执行，失败静默（下轮同步重试）
 * - Web 端跳过（无 documentDirectory 文件系统）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { Platform } from "react-native";

import { CF_WORKER_URL, getDeviceInfo, type DeviceInfo } from "@/lib/cf-sync/client";

const LEGACY_PHOTO_DIR = `${FileSystem.documentDirectory ?? ""}recipe-photos/`;
const UPLOADED_SET_KEY_PREFIX = "cf.photoSync.uploaded";
const RECIPES_KEY = "cocktail.recipes";
/** 单张照片 base64 上限（Worker 端 1.5M 字符限制，留余量） */
const MAX_BASE64_LEN = 1_400_000;

/** 触发压缩的阈值（1MB base64 ≈ 750KB 文件） */
const COMPRESS_THRESHOLD = 1_000_000;
/** 最低压缩质量，低于此值直接放弃 */
const MIN_QUALITY = 0.3;

let running = false;

// ─── helpers ──────────────────────────────────────────────────────────────────

function photoDirectory(groupId: string): string {
  const safeGroupId = groupId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${LEGACY_PHOTO_DIR}${safeGroupId}/`;
}

async function ensurePhotoDirectory(groupId: string): Promise<string> {
  const directory = photoDirectory(groupId);
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

/**
 * 旧版本照片位于无分组目录。仅在当前成员资格的普通上传路径中迁入，
 * 目标组的 download-only 水合绝不读取该目录，避免A组文件穿透到B组。
 */
async function resolveScopedPhotoPath(groupId: string, name: string, allowLegacyMigration: boolean): Promise<string> {
  const directory = await ensurePhotoDirectory(groupId);
  const scopedPath = `${directory}${name}`;
  const scopedInfo = await FileSystem.getInfoAsync(scopedPath);
  if (scopedInfo.exists || !allowLegacyMigration) return scopedPath;
  const legacyPath = `${LEGACY_PHOTO_DIR}${name}`;
  const legacyInfo = await FileSystem.getInfoAsync(legacyPath);
  if (legacyInfo.exists) {
    await FileSystem.copyAsync({ from: legacyPath, to: scopedPath });
  }
  return scopedPath;
}

function fileNameOf(uri: string): string {
  return uri.split("/").pop() ?? "";
}

function contentTypeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "jpg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}

/**
 * 迭代压缩照片直到 base64 长度 ≤ MAX_BASE64_LEN。
 * 返回压缩后的 base64 字符串，若压缩失败则返回 null。
 */
async function compressToLimit(uri: string): Promise<string | null> {
  let quality = 0.8;
  while (quality >= MIN_QUALITY) {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (result.base64 && result.base64.length <= MAX_BASE64_LEN) {
        return result.base64;
      }
      quality = Math.round((quality - 0.15) * 100) / 100;
    } catch {
      return null;
    }
  }
  return null;
}

function uploadedSetKey(groupId: string): string {
  return `${UPLOADED_SET_KEY_PREFIX}:${groupId}`;
}

async function loadUploadedSet(groupId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(uploadedSetKey(groupId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}

async function saveUploadedSet(groupId: string, set: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(uploadedSetKey(groupId), JSON.stringify([...set]));
  } catch {}
}

async function photoFetch(
  path: string,
  deviceInfo: DeviceInfo,
  body: unknown,
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${CF_WORKER_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceInfo.deviceId,
        "X-Device-Token": deviceInfo.deviceToken,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 读取 recipes JSON，提取 recipeId → photoUris 映射 */
async function readRecipesRaw(): Promise<{ raw: string; list: any[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(RECIPES_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    return { raw, list };
  } catch {
    return null;
  }
}

// ─── upload ───────────────────────────────────────────────────────────────────

/** 扫描本地 photoUris，上传尚未上传的照片文件 */
async function uploadPendingPhotos(
  deviceInfo: DeviceInfo,
  onProgress?: (phase: "upload" | "download" | "repair", done: number, total: number) => void,
): Promise<number> {
  if (deviceInfo.role === "guest") return 0;
  const data = await readRecipesRaw();
  if (!data) return 0;

  const uploaded = await loadUploadedSet(deviceInfo.groupId);
  let count = 0;
  let oversizedCount = 0;
  const pendingNames: string[] = [];
  for (const recipe of data.list) {
    const uris: string[] = Array.isArray(recipe?.photoUris) ? recipe.photoUris : [];
    for (const uri of uris) {
      const name = fileNameOf(uri);
      if (name && !uploaded.has(name)) pendingNames.push(name);
    }
  }
  let done = 0;

  for (const recipe of data.list) {
    const uris: string[] = Array.isArray(recipe?.photoUris) ? recipe.photoUris : [];
    for (const uri of uris) {
      const name = fileNameOf(uri);
      if (!name || uploaded.has(name)) continue;
      try {
        const localPath = await resolveScopedPhotoPath(deviceInfo.groupId, name, true);
        const info = await FileSystem.getInfoAsync(localPath);
        if (!info.exists) continue; // 本机没有该文件（等对端上传）
        const base64 = await FileSystem.readAsStringAsync(localPath, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (base64.length > MAX_BASE64_LEN) {
          // 超大照片先尝试压缩再上传
          if (base64.length > COMPRESS_THRESHOLD) {
            const compressed = await compressToLimit(localPath);
            if (compressed) {
              // 压缩成功，用压缩后的 base64 继续上传
              const res = await photoFetch("/api/photos/upload", deviceInfo, {
                photoId: name,
                recipeId: recipe?.id ?? "",
                dataBase64: compressed,
                contentType: "image/jpeg",
              });
              if (res.ok) {
                uploaded.add(name);
                count++;
              }
              done++;
              onProgress?.("upload", done, pendingNames.length);
              continue;
            }
          }
          // 压缩失败或仍超限，跳过并标记
          uploaded.add(name);
          oversizedCount++;
          done++;
          onProgress?.("upload", done, pendingNames.length);
          continue;
        }
        const res = await photoFetch("/api/photos/upload", deviceInfo, {
          photoId: name,
          recipeId: recipe?.id ?? "",
          dataBase64: base64,
          contentType: contentTypeOf(name),
        });
        if (res.ok) {
          uploaded.add(name);
          count++;
        }
      } catch {
        // 单张失败不影响其它照片，下轮重试
      }
      done++;
      onProgress?.("upload", done, pendingNames.length);
    }
  }

  if (count > 0) await saveUploadedSet(deviceInfo.groupId, uploaded);
  return oversizedCount;
}

// ─── download ─────────────────────────────────────────────────────────────────

/**
 * 下载云端存在但本机缺失的照片，并把 recipes.photoUris 中
 * 指向其它设备路径的 URI 重写为本机路径。
 */
async function downloadMissingPhotos(deviceInfo: DeviceInfo): Promise<number> {
  const res = await photoFetch("/api/photos/list", deviceInfo, {});
  if (!res.ok) return 0;
  const { photos } = (await res.json()) as {
    photos: { photoId: string; deleted: boolean }[];
  };
  if (!Array.isArray(photos) || photos.length === 0) return 0;

  // 目标组下载仅使用其专属目录，不读取旧无分组目录。
  let directory = "";
  try { directory = await ensurePhotoDirectory(deviceInfo.groupId); } catch { return 0; }

  const uploaded = await loadUploadedSet(deviceInfo.groupId);
  let downloadedCount = 0;

  for (const p of photos) {
    if (p.deleted || !p.photoId) continue;
    const localPath = `${directory}${p.photoId}`;
    try {
      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists) {
        uploaded.add(p.photoId); // 本机已有 = 无需再上传
        continue;
      }
      const dl = await photoFetch("/api/photos/download", deviceInfo, {
        photoId: p.photoId,
      });
      if (!dl.ok) continue;
      const { dataBase64 } = (await dl.json()) as { dataBase64: string };
      if (!dataBase64) continue;
      await FileSystem.writeAsStringAsync(localPath, dataBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uploaded.add(p.photoId);
      downloadedCount++;
    } catch {
      // 单张失败跳过
    }
  }

  await saveUploadedSet(deviceInfo.groupId, uploaded);
  return downloadedCount;
}

/**
 * 修复 photoUris 路径：把非本机前缀的 URI 重写为本机 PHOTO_DIR 路径
 * （仅当本机文件确实存在时才重写；返回是否有修改）。
 */
async function repairPhotoUriPaths(deviceInfo: DeviceInfo): Promise<boolean> {
  const data = await readRecipesRaw();
  if (!data) return false;

  let changed = false;
  for (const recipe of data.list) {
    const uris: string[] = Array.isArray(recipe?.photoUris) ? recipe.photoUris : [];
    if (uris.length === 0) continue;
    const next: string[] = [];
    for (const uri of uris) {
      const name = fileNameOf(uri);
      const localPath = await resolveScopedPhotoPath(deviceInfo.groupId, name, false);
      if (uri === localPath) {
        next.push(uri);
        continue;
      }
      try {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
          next.push(localPath);
          changed = true;
          continue;
        }
      } catch {}
      next.push(uri); // 本机没有文件，保留原样（等下轮下载）
    }
    if (JSON.stringify(next) !== JSON.stringify(recipe.photoUris)) {
      recipe.photoUris = next;
      changed = true;
    }
  }

  if (changed) {
    try {
      await AsyncStorage.setItem(RECIPES_KEY, JSON.stringify(data.list));
    } catch {
      return false;
    }
  }
  return changed;
}

// ─── delete ───────────────────────────────────────────────────────────────────

/** 删除照片时同步删除云端副本（在 UI 删除流程中调用，非阻塞） */
export async function deleteCloudPhoto(photoUri: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const deviceInfo = await getDeviceInfo();
    if (!deviceInfo || deviceInfo.role === "guest") return;
    const name = fileNameOf(photoUri);
    if (!name) return;
    await photoFetch("/api/photos/delete", deviceInfo, { photoId: name });
    const uploaded = await loadUploadedSet(deviceInfo.groupId);
    if (uploaded.delete(name)) await saveUploadedSet(deviceInfo.groupId, uploaded);
  } catch {
    // 静默失败（云端照片残留无害）
  }
}

// ─── entry point ──────────────────────────────────────────────────────────────

/**
 * 完整照片同步：上传本地新照片 → 下载云端缺失照片 → 修复路径。
 * 返回是否有下载/路径修复（调用方可据此触发 store 重载）。
 */
export async function syncPhotos(
  onProgress?: (phase: "upload" | "download" | "repair", done: number, total: number) => void,
  mode: "full" | "download-only" = "full",
): Promise<{ downloaded: number; repaired: boolean; oversized: number }> {
  if (Platform.OS === "web") return { downloaded: 0, repaired: false, oversized: 0 };
  if (running) return { downloaded: 0, repaired: false, oversized: 0 };
  running = true;
  try {
    const deviceInfo = await getDeviceInfo();
    if (!deviceInfo) return { downloaded: 0, repaired: false, oversized: 0 };
    // 目标组首次水合只能下载，绝不允许把旧组文件上传到新成员资格。
    const oversized = mode === "full" ? await uploadPendingPhotos(deviceInfo, onProgress) : 0;
    const downloaded = await downloadMissingPhotos(deviceInfo);
    const repaired = await repairPhotoUriPaths(deviceInfo);
    onProgress?.("repair", 1, 1);
    return { downloaded, repaired, oversized };
  } catch {
    return { downloaded: 0, repaired: false, oversized: 0 };
  } finally {
    running = false;
  }
}

import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Alert, Platform } from "react-native";

/** 照片保存目录（App documentDirectory 下，iCloud 备份范围内） */
const PHOTO_DIR = `${FileSystem.documentDirectory}recipe-photos/`;

/** 确保照片目录存在 */
async function ensurePhotoDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

/**
 * 将 ImagePicker 返回的 URI 复制到 App 私有目录并返回持久化路径。
 * iOS 的 ph:// URI 不可直接读取，必须先复制到 cache/document 目录。
 */
async function persistPhoto(sourceUri: string, recipeId: string): Promise<string> {
  await ensurePhotoDir();
  const ext = sourceUri.split(".").pop()?.split("?")[0] ?? "jpg";
  const destPath = `${PHOTO_DIR}${recipeId}_${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destPath });
  return destPath;
}

/**
 * 删除旧照片文件（更换照片时清理旧文件）
 */
export async function deletePhoto(photoUri: string | undefined) {
  if (!photoUri) return;
  try {
    const info = await FileSystem.getInfoAsync(photoUri);
    if (info.exists) await FileSystem.deleteAsync(photoUri, { idempotent: true });
  } catch {
    // 静默忽略
  }
}

/**
 * 请求相册权限（iOS 13+ 需要 READ_MEDIA_IMAGES / MEDIA_LIBRARY）
 * 返回 true 表示已授权，false 表示被拒绝
 */
async function requestMediaPermission(i18n: { denied: string; settings: string; cancel: string }): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status === "granted") return true;
  if (!canAskAgain) {
    Alert.alert(i18n.denied, i18n.settings, [
      { text: i18n.cancel, style: "cancel" },
    ]);
  }
  return false;
}

/**
 * 请求相机权限
 */
async function requestCameraPermission(i18n: { denied: string; settings: string; cancel: string }): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  if (!canAskAgain) {
    Alert.alert(i18n.denied, i18n.settings, [
      { text: i18n.cancel, style: "cancel" },
    ]);
  }
  return false;
}

export interface PickPhotoResult {
  uri: string;
}

export interface PickPhotoOptions {
  recipeId: string;
  /** 当前已有的照片路径（更换时先删除旧文件） */
  currentPhotoUri?: string;
  i18n: {
    permissionDenied: string;
    permissionSettings: string;
    permissionCancel: string;
  };
}

/**
 * 从相册选择照片，压缩后保存到 App 私有目录。
 * 返回持久化路径，取消时返回 null。
 */
export async function pickPhotoFromLibrary(opts: PickPhotoOptions): Promise<PickPhotoResult | null> {
  const granted = await requestMediaPermission({
    denied: opts.i18n.permissionDenied,
    settings: opts.i18n.permissionSettings,
    cancel: opts.i18n.permissionCancel,
  });
  if (!granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.75,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  // iOS: ph:// URI 不可直接读取，必须复制
  const sourceUri = Platform.OS === "ios" && asset.uri.startsWith("ph://")
    ? asset.uri
    : asset.uri;

  const persistedUri = await persistPhoto(sourceUri, opts.recipeId);
  if (opts.currentPhotoUri) await deletePhoto(opts.currentPhotoUri);
  return { uri: persistedUri };
}

/**
 * 拍照并保存到 App 私有目录。
 * 返回持久化路径，取消时返回 null。
 */
export async function takePhoto(opts: PickPhotoOptions): Promise<PickPhotoResult | null> {
  const granted = await requestCameraPermission({
    denied: opts.i18n.permissionDenied,
    settings: opts.i18n.permissionSettings,
    cancel: opts.i18n.permissionCancel,
  });
  if (!granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    quality: 0.75,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const persistedUri = await persistPhoto(result.assets[0].uri, opts.recipeId);
  if (opts.currentPhotoUri) await deletePhoto(opts.currentPhotoUri);
  return { uri: persistedUri };
}

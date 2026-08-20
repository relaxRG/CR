import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { isRetiredBookStorageKey } from "@/lib/migrations/retired-book-storage";

/**
 * 升级到移除书库的版本时清理遗留的本地书库有效载荷。
 * 此过程幂等：重复执行不会重建或读取书库内容。
 */
export async function purgeRetiredBookLibrary(): Promise<number> {
  const keys = await AsyncStorage.getAllKeys();
  const retiredKeys = keys.filter(isRetiredBookStorageKey);
  if (retiredKeys.length > 0) await AsyncStorage.multiRemove(retiredKeys);

  const libraryDirectory = `${FileSystem.documentDirectory ?? ""}books/`;
  if (libraryDirectory) {
    await FileSystem.deleteAsync(libraryDirectory, { idempotent: true }).catch(() => undefined);
  }

  return retiredKeys.length;
}

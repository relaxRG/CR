import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { notifySyncChange } from "@/lib/sync/engine";
import {
  purgeRetiredBookStorage,
  type RetiredBookPurgeResult,
} from "@/lib/migrations/retired-book-cleaner-core";
import { purgeRetiredBookSourceFields } from "@/lib/migrations/retired-book-source-ref";

const RECIPES_KEY = "cocktail.recipes";

export type RetiredBookLibraryPurgeResult = RetiredBookPurgeResult & {
  cleanedRecipeSourceRefs: number;
};

/**
 * 升级到移除书库的版本时清理遗留有效载荷。
 * 只删除严格命名空间内的本地索引、章节缓存、阅读设置、批注和历史文件目录；
 * 同时从配方快照物理剥离旧书库来源字段，不读取、恢复或同步退役内容。
 */
export async function purgeRetiredBookLibrary(): Promise<RetiredBookLibraryPurgeResult> {
  const documentDirectory = FileSystem.documentDirectory;
  const storageResult = await purgeRetiredBookStorage({
    getAllKeys: () => AsyncStorage.getAllKeys(),
    multiRemove: (keys) => AsyncStorage.multiRemove(keys),
    deleteRetiredDirectory: documentDirectory
      ? () => FileSystem.deleteAsync(`${documentDirectory}books/`, { idempotent: true })
      : undefined,
  });

  const serializedRecipes = await AsyncStorage.getItem(RECIPES_KEY);
  if (!serializedRecipes) return { ...storageResult, cleanedRecipeSourceRefs: 0 };

  const sourceFieldResult = purgeRetiredBookSourceFields(serializedRecipes);
  if (sourceFieldResult.changedRecipeCount > 0) {
    await AsyncStorage.setItem(RECIPES_KEY, sourceFieldResult.serializedRecipes);
    notifySyncChange(RECIPES_KEY);
  }

  return { ...storageResult, cleanedRecipeSourceRefs: sourceFieldResult.changedRecipeCount };
}

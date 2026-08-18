import AsyncStorage from "@react-native-async-storage/async-storage";

const LEGACY_MONTH_KEYS = [
  "store.report.active-month.v1",
  "store.inventory.month.v1",
  "store.shop.month.v1",
] as const;
const MIGRATION_DONE_KEY = "migration_clean_legacy_business_month_keys_v1_done";

/**
 * 全局业务月份启用后，删除旧的模块私有月份键。
 * 不迁移旧值：全局月份以用户最后一次在任意模块明确选择的月份为唯一来源。
 */
export async function cleanLegacyBusinessMonthKeys(): Promise<number> {
  try {
    if (await AsyncStorage.getItem(MIGRATION_DONE_KEY) === "1") return 0;
    const existing = await AsyncStorage.multiGet([...LEGACY_MONTH_KEYS]);
    const count = existing.filter(([, value]) => value !== null).length;
    await AsyncStorage.multiRemove([...LEGACY_MONTH_KEYS]);
    await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
    return count;
  } catch (error) {
    console.warn("[Migration] clean-legacy-business-month-keys 执行失败:", error);
    return 0;
  }
}

export async function resetLegacyBusinessMonthKeyMigration(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_DONE_KEY);
}

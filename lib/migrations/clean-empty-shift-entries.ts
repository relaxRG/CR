/**
 * 迁移脚本：清理 labor_shifts_v1 中历史遗留的空排班记录
 *
 * 背景：
 *   Bug（已修复于 commit e70c4c5）：SchHoursModal 清空工时后点击「保存」时，
 *   调用 upsertShift({ hoursValue: null }) 保留了空记录，而不是调用 deleteShift。
 *   这些空记录（hoursValue=null 且 specialStatusId=null）会导致：
 *   1. 员工仍然出现在排班表中（格子空白但行存在）
 *   2. 考勤概况卡片可能显示旧的出勤天数
 *
 * 清理规则：
 *   删除所有满足以下条件的 ShiftEntry：
 *   - hoursValue === null 或 hoursValue === undefined
 *   - specialStatusId === null 或 specialStatusId === undefined
 *   （即：既没有工时，也没有特殊状态的完全空记录）
 *
 * 安全性：
 *   - 幂等：多次运行结果相同
 *   - 只删除真正的空记录，不影响有特殊状态的记录（如调休、换休、旷工等）
 *   - 不影响有工时的记录（正常班次）
 *
 * 运行方式：
 *   在 App 启动时（_layout.tsx 的 useEffect 中）调用一次
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const SHIFTS_KEY = "labor_shifts_v1";
const MIGRATION_DONE_KEY = "migration_clean_empty_shifts_v1_done";

export interface ShiftEntryRaw {
  employeeId: string;
  date: string;
  shift: string;
  hoursValue: number | string | null | undefined;
  specialStatusId?: string | null;
}

/**
 * 判断一条 ShiftEntry 是否是空记录（应该被清理）
 */
export function isEmptyShiftEntry(entry: ShiftEntryRaw): boolean {
  const hasHours = entry.hoursValue !== null && entry.hoursValue !== undefined && entry.hoursValue !== 0;
  const hasSpecialStatus = entry.specialStatusId !== null && entry.specialStatusId !== undefined && entry.specialStatusId !== "";
  return !hasHours && !hasSpecialStatus;
}

/**
 * 执行迁移：清理空排班记录
 * @returns 清理的记录数量
 */
export async function cleanEmptyShiftEntries(): Promise<number> {
  try {
    // 检查是否已执行过
    const done = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
    if (done === "1") return 0;

    const raw = await AsyncStorage.getItem(SHIFTS_KEY);
    if (!raw) {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    let entries: ShiftEntryRaw[];
    try {
      entries = JSON.parse(raw) as ShiftEntryRaw[];
    } catch {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    if (!Array.isArray(entries)) {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    const before = entries.length;
    const cleaned = entries.filter((e) => !isEmptyShiftEntry(e));
    const removed = before - cleaned.length;

    if (removed > 0) {
      await AsyncStorage.setItem(SHIFTS_KEY, JSON.stringify(cleaned));
      console.log(`[Migration] clean-empty-shift-entries: 清理了 ${removed} 条空排班记录`);
    }

    // 标记迁移完成（幂等）
    await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
    return removed;
  } catch (err) {
    console.warn("[Migration] clean-empty-shift-entries 执行失败:", err);
    return 0;
  }
}

/**
 * 重置迁移状态（仅用于测试）
 */
export async function resetMigrationState(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_DONE_KEY);
}

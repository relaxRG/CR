/**
 * 迁移脚本：清理 labor_employees_v1 中历史遗留的 monthlyFixedSalary 字段
 *
 * 背景：
 *   monthlyFixedSalary 是一个幽灵字段（已删除于 commit be4f76e）：
 *   - 在 Employee 接口中存在
 *   - 有 UI 输入框（长期兼职专属）和展示
 *   - 但从未被任何薪资计算引擎（calcFromShifts / buildPaySlipDraft）引用
 *   - 用户可能已经填写了该字段，数据存在于 AsyncStorage 中
 *
 * 清理规则：
 *   遍历所有员工记录，删除 monthlyFixedSalary 字段（如果存在）
 *
 * 安全性：
 *   - 幂等：多次运行结果相同
 *   - 只删除 monthlyFixedSalary 字段，不影响其他字段
 *   - 不影响薪资计算（该字段从未被计算引擎使用）
 *
 * 运行方式：
 *   在 App 启动时（_layout.tsx 的 useEffect 中）调用一次
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const EMPLOYEES_KEY = "labor_employees_v1";
const MIGRATION_DONE_KEY = "migration_clean_monthly_fixed_salary_v1_done";

export interface EmployeeRaw {
  id: string;
  monthlyFixedSalary?: number;
  [key: string]: unknown;
}

/**
 * 执行迁移：清理 monthlyFixedSalary 字段
 * @returns 清理的员工记录数量
 */
export async function cleanMonthlyFixedSalary(): Promise<number> {
  try {
    // 检查是否已执行过
    const done = await AsyncStorage.getItem(MIGRATION_DONE_KEY);
    if (done === "1") return 0;

    const raw = await AsyncStorage.getItem(EMPLOYEES_KEY);
    if (!raw) {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    let employees: EmployeeRaw[];
    try {
      employees = JSON.parse(raw) as EmployeeRaw[];
    } catch {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    if (!Array.isArray(employees)) {
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
      return 0;
    }

    let cleaned = 0;
    const updated = employees.map((emp) => {
      if ("monthlyFixedSalary" in emp) {
        const { monthlyFixedSalary: _, ...rest } = emp;
        cleaned++;
        return rest;
      }
      return emp;
    });

    if (cleaned > 0) {
      await AsyncStorage.setItem(EMPLOYEES_KEY, JSON.stringify(updated));
      console.log(`[Migration] clean-monthly-fixed-salary: 清理了 ${cleaned} 条员工记录中的 monthlyFixedSalary 字段`);
    }

    // 标记迁移完成（幂等）
    await AsyncStorage.setItem(MIGRATION_DONE_KEY, "1");
    return cleaned;
  } catch (err) {
    console.warn("[Migration] clean-monthly-fixed-salary 执行失败:", err);
    return 0;
  }
}

/**
 * 重置迁移状态（仅用于测试）
 */
export async function resetMigrationState(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_DONE_KEY);
}

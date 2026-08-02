/**
 * 备用金分类自定义管理 Store
 * - 支持增删改备用金分类（在系统默认分类基础上）
 * - 每个分类可绑定进销存品类（inventoryCategory）
 * - 支持标记为「收入类」（N 类）
 * - 持久化到 AsyncStorage
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { InventoryCategory } from "./inventory-store";

const STORAGE_KEY = "store.petty_categories.v1";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 进销存品类（扩展，含啤酒和冰块） */
export type ExtendedInventoryCategory =
  | InventoryCategory
  | "beer"
  | "ice"
  | "none";

export const EXTENDED_INVENTORY_LABELS: Record<ExtendedInventoryCategory, string> = {
  spirit: "烈酒",
  wine: "葡萄酒",
  food: "食材",
  equipment: "设备",
  tableware: "杯具餐具",
  daily: "日用品",
  beer: "啤酒",
  ice: "冰块",
  none: "不关联",
};

export const EXTENDED_INVENTORY_COLORS: Record<ExtendedInventoryCategory, string> = {
  spirit: "#5856D6",
  wine: "#C2185B",
  food: "#34C759",
  equipment: "#FF9500",
  tableware: "#007AFF",
  daily: "#8E8E93",
  beer: "#F4A300",
  ice: "#00BCD4",
  none: "#C7C7CC",
};

/** 单个备用金分类定义 */
export interface PettyCategory {
  /** 分类代码，如 "A1"、"B1"、自定义如 "Z1" */
  code: string;
  /** 显示标签，如 "A1 新鲜肉类" */
  label: string;
  /** 所属分组，如 "A" */
  group: string;
  /** 分组标签，如 "A 食材采购" */
  groupLabel: string;
  /** 是否为收入类（N0-N2 转入，N3-N5 其他收入） */
  isIncome: boolean;
  /** 是否为备用金转入（N0/N1/N2） */
  isTransfer: boolean;
  /** 关联的进销存品类（可选） */
  inventoryCategory: ExtendedInventoryCategory;
  /** 是否为系统默认分类（系统默认不可删除，但可修改映射） */
  isDefault: boolean;
  /** 排序权重 */
  sortOrder: number;
  /** 是否启用 */
  enabled: boolean;
}

/** 分类状态 */
export interface PettyCategoryState {
  /** 自定义覆盖（仅存储与默认不同的分类，或新增分类） */
  customCategories: PettyCategory[];
  /** 是否已初始化（首次加载时从默认生成） */
  initialized: boolean;
}

// ─── 默认分类定义 ─────────────────────────────────────────────────────────────

export const DEFAULT_PETTY_CATEGORIES: PettyCategory[] = [
  // A 食材采购
  { code: "A1", label: "A1 新鲜肉类", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 1, enabled: true },
  { code: "A2", label: "A2 新鲜海鲜", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 2, enabled: true },
  { code: "A3", label: "A3 各种冻品", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 3, enabled: true },
  { code: "A4", label: "A4 米面粮油", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 4, enabled: true },
  { code: "A5", label: "A5 蔬菜水果", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 5, enabled: true },
  { code: "A6", label: "A6 牛排", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 6, enabled: true },
  { code: "A7", label: "A7 火腿", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 7, enabled: true },
  { code: "A8", label: "A8 三文鱼", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 8, enabled: true },
  { code: "A9", label: "A9 临时采购", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 9, enabled: true },
  { code: "A10", label: "A10 研发采购", group: "A", groupLabel: "A 食材采购", isIncome: false, isTransfer: false, inventoryCategory: "food", isDefault: true, sortOrder: 10, enabled: true },
  // B 酒水耗材
  { code: "B1", label: "B1 酒水现结", group: "B", groupLabel: "B 酒水耗材", isIncome: false, isTransfer: false, inventoryCategory: "spirit", isDefault: true, sortOrder: 11, enabled: true },
  { code: "B2", label: "B2 酒水配料", group: "B", groupLabel: "B 酒水耗材", isIncome: false, isTransfer: false, inventoryCategory: "wine", isDefault: true, sortOrder: 12, enabled: true },
  { code: "B3", label: "B3 酒水耗材", group: "B", groupLabel: "B 酒水耗材", isIncome: false, isTransfer: false, inventoryCategory: "ice", isDefault: true, sortOrder: 13, enabled: true },
  // C 设备工具
  { code: "C1", label: "C1 厨房设备", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 14, enabled: true },
  { code: "C2", label: "C2 厨房工具", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 15, enabled: true },
  { code: "C3", label: "C3 吧台设备", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 16, enabled: true },
  { code: "C4", label: "C4 吧台工具", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 17, enabled: true },
  { code: "C5", label: "C5 前厅硬装", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 18, enabled: true },
  { code: "C6", label: "C6 前厅软装", group: "C", groupLabel: "C 设备工具", isIncome: false, isTransfer: false, inventoryCategory: "equipment", isDefault: true, sortOrder: 19, enabled: true },
  // D 员工福利
  { code: "D1", label: "D1 员工聚餐", group: "D", groupLabel: "D 员工福利", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 20, enabled: true },
  { code: "D2", label: "D2 员工工餐", group: "D", groupLabel: "D 员工福利", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 21, enabled: true },
  { code: "D3", label: "D3 员工福利", group: "D", groupLabel: "D 员工福利", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 22, enabled: true },
  // E 营销推广
  { code: "E1", label: "E1 设计创意", group: "E", groupLabel: "E 营销推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 23, enabled: true },
  { code: "E2", label: "E2 图文广告", group: "E", groupLabel: "E 营销推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 24, enabled: true },
  { code: "E3", label: "E3 节日采购", group: "E", groupLabel: "E 营销推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 25, enabled: true },
  // F 餐具酒具
  { code: "F1", label: "F1 餐具", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 26, enabled: true },
  { code: "F2", label: "F2 酒杯", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 27, enabled: true },
  { code: "F3", label: "F3 餐具一次性", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 28, enabled: true },
  { code: "F4", label: "F4 酒杯一次性", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 29, enabled: true },
  { code: "F5", label: "F5 包装袋", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 30, enabled: true },
  { code: "F6", label: "F6 杯垫", group: "F", groupLabel: "F 餐具酒具", isIncome: false, isTransfer: false, inventoryCategory: "tableware", isDefault: true, sortOrder: 31, enabled: true },
  // G 平台推广
  { code: "G1", label: "G1 点星", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 32, enabled: true },
  { code: "G2", label: "G2 大众点评美团", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 33, enabled: true },
  { code: "G3", label: "G3 小红书", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 34, enabled: true },
  { code: "G4", label: "G4 抖音", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 35, enabled: true },
  { code: "G5", label: "G5 美团外卖", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 36, enabled: true },
  { code: "G6", label: "G6 饿了么", group: "G", groupLabel: "G 平台推广", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 37, enabled: true },
  // H 探店差旅
  { code: "H1", label: "H1 餐食探店", group: "H", groupLabel: "H 探店差旅", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 38, enabled: true },
  { code: "H2", label: "H2 酒水探店", group: "H", groupLabel: "H 探店差旅", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 39, enabled: true },
  { code: "H3", label: "H3 差旅费用", group: "H", groupLabel: "H 探店差旅", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 40, enabled: true },
  // I 物流运输
  { code: "I1", label: "I1 闪送、跑腿", group: "I", groupLabel: "I 物流运输", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 41, enabled: true },
  { code: "I2", label: "I2 交通、运输", group: "I", groupLabel: "I 物流运输", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 42, enabled: true },
  { code: "I3", label: "I3 快递", group: "I", groupLabel: "I 物流运输", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 43, enabled: true },
  // J 客户维护
  { code: "J1", label: "J1 客户维护", group: "J", groupLabel: "J 客户维护", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 44, enabled: true },
  { code: "J2", label: "J2 处理客诉", group: "J", groupLabel: "J 客户维护", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 45, enabled: true },
  { code: "J3", label: "J3 会员福利", group: "J", groupLabel: "J 客户维护", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 46, enabled: true },
  // K 日常运营
  { code: "K1", label: "K1 固定兼职", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 47, enabled: true },
  { code: "K2", label: "K2 日常消耗", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "daily", isDefault: true, sortOrder: 48, enabled: true },
  { code: "K3", label: "K3 洗手间消耗", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "daily", isDefault: true, sortOrder: 49, enabled: true },
  { code: "K4", label: "K4 维护维修", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 50, enabled: true },
  { code: "K5", label: "K5 消杀工作", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 51, enabled: true },
  { code: "K6", label: "K6 电话网费", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 52, enabled: true },
  { code: "K7", label: "K7 账号费用", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 53, enabled: true },
  { code: "K8", label: "K8 其他", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 54, enabled: true },
  { code: "K9", label: "K9 临时兼职", group: "K", groupLabel: "K 日常运营", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 55, enabled: true },
  // L 水电费
  { code: "L1", label: "L1 上月电费", group: "L", groupLabel: "L 水电费", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 56, enabled: true },
  { code: "L2", label: "L2 上月水费", group: "L", groupLabel: "L 水电费", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 57, enabled: true },
  // M 房租
  { code: "M1", label: "M1 247房租", group: "M", groupLabel: "M 房租", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 58, enabled: true },
  { code: "M2", label: "M2 仓库房租", group: "M", groupLabel: "M 房租", isIncome: false, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 59, enabled: true },
  // N 备用金账户（收入类）
  { code: "N0", label: "N0 （招商）备用金", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: true, inventoryCategory: "none", isDefault: true, sortOrder: 60, enabled: true },
  { code: "N1", label: "N1 （工商）备用金", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: true, inventoryCategory: "none", isDefault: true, sortOrder: 61, enabled: true },
  { code: "N2", label: "N2 （微信）备用金", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: true, inventoryCategory: "none", isDefault: true, sortOrder: 62, enabled: true },
  { code: "N3", label: "N3 返点", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 63, enabled: true },
  { code: "N4", label: "N4 充电宝", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 64, enabled: true },
  { code: "N5", label: "N5 其他", group: "N", groupLabel: "N 备用金账户", isIncome: true, isTransfer: false, inventoryCategory: "none", isDefault: true, sortOrder: 65, enabled: true },
];

// ─── Actions ──────────────────────────────────────────────────────────────────
type Action =
  | { type: "LOAD"; payload: PettyCategoryState }
  | { type: "UPSERT"; category: PettyCategory }
  | { type: "DELETE"; code: string }
  | { type: "TOGGLE_ENABLED"; code: string }
  | { type: "UPDATE_MAPPING"; code: string; inventoryCategory: ExtendedInventoryCategory }
  | { type: "RESET_TO_DEFAULT" };

function reducer(state: PettyCategoryState, action: Action): PettyCategoryState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "UPSERT": {
      const idx = state.customCategories.findIndex((c) => c.code === action.category.code);
      if (idx >= 0) {
        const next = [...state.customCategories];
        next[idx] = action.category;
        return { ...state, customCategories: next };
      }
      return { ...state, customCategories: [...state.customCategories, action.category] };
    }
    case "DELETE":
      return { ...state, customCategories: state.customCategories.filter((c) => c.code !== action.code) };
    case "TOGGLE_ENABLED": {
      const idx = state.customCategories.findIndex((c) => c.code === action.code);
      if (idx >= 0) {
        const next = [...state.customCategories];
        next[idx] = { ...next[idx], enabled: !next[idx].enabled };
        return { ...state, customCategories: next };
      }
      // 默认分类：新增一条覆盖记录
      const def = DEFAULT_PETTY_CATEGORIES.find((c) => c.code === action.code);
      if (def) return { ...state, customCategories: [...state.customCategories, { ...def, enabled: false }] };
      return state;
    }
    case "UPDATE_MAPPING": {
      const idx = state.customCategories.findIndex((c) => c.code === action.code);
      if (idx >= 0) {
        const next = [...state.customCategories];
        next[idx] = { ...next[idx], inventoryCategory: action.inventoryCategory };
        return { ...state, customCategories: next };
      }
      const def = DEFAULT_PETTY_CATEGORIES.find((c) => c.code === action.code);
      if (def) return { ...state, customCategories: [...state.customCategories, { ...def, inventoryCategory: action.inventoryCategory }] };
      return state;
    }
    case "RESET_TO_DEFAULT":
      return { customCategories: [], initialized: true };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface PettyCategoryContextValue {
  /** 合并后的完整分类列表（默认 + 自定义覆盖） */
  categories: PettyCategory[];
  /** 按分组聚合 */
  groups: { groupLabel: string; group: string; categories: PettyCategory[] }[];
  /** 获取单个分类 */
  getCategory: (code: string) => PettyCategory | undefined;
  /** 新增或更新分类 */
  upsertCategory: (cat: PettyCategory) => void;
  /** 删除自定义分类（系统默认分类只能禁用，不能删除） */
  deleteCategory: (code: string) => void;
  /** 切换启用/禁用 */
  toggleEnabled: (code: string) => void;
  /** 修改进销存映射 */
  updateMapping: (code: string, inventoryCategory: ExtendedInventoryCategory) => void;
  /** 重置为默认 */
  resetToDefault: () => void;
  /** 是否为收入类 */
  isIncomeCode: (code: string) => boolean;
  /** 是否为备用金转入 */
  isTransferCode: (code: string) => boolean;
}

const PettyCategoryContext = createContext<PettyCategoryContextValue | null>(null);

export function PettyCategoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { customCategories: [], initialized: false });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PettyCategoryState;
          dispatch({ type: "LOAD", payload: parsed });
        } catch {}
      }
    });
    registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  // 合并默认分类和自定义覆盖
  const categories: PettyCategory[] = React.useMemo(() => {
    const customMap = new Map(state.customCategories.map((c) => [c.code, c]));
    // 默认分类（被自定义覆盖的用自定义版本）
    const merged = DEFAULT_PETTY_CATEGORIES.map((def) => customMap.get(def.code) ?? def);
    // 追加纯自定义新增分类（code 不在默认列表中）
    const defaultCodes = new Set(DEFAULT_PETTY_CATEGORIES.map((d) => d.code));
    state.customCategories.forEach((c) => {
      if (!defaultCodes.has(c.code)) merged.push(c);
    });
    return merged.filter((c) => c.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state.customCategories]);

  const groups = React.useMemo(() => {
    const map = new Map<string, { groupLabel: string; group: string; categories: PettyCategory[] }>();
    categories.forEach((c) => {
      if (!map.has(c.group)) map.set(c.group, { groupLabel: c.groupLabel, group: c.group, categories: [] });
      map.get(c.group)!.categories.push(c);
    });
    return Array.from(map.values());
  }, [categories]);

  const getCategory = useCallback((code: string) => categories.find((c) => c.code === code), [categories]);
  const upsertCategory = useCallback((cat: PettyCategory) => dispatch({ type: "UPSERT", category: cat }), []);
  const deleteCategory = useCallback((code: string) => dispatch({ type: "DELETE", code }), []);
  const toggleEnabled = useCallback((code: string) => dispatch({ type: "TOGGLE_ENABLED", code }), []);
  const updateMapping = useCallback((code: string, inventoryCategory: ExtendedInventoryCategory) =>
    dispatch({ type: "UPDATE_MAPPING", code, inventoryCategory }), []);
  const resetToDefault = useCallback(() => dispatch({ type: "RESET_TO_DEFAULT" }), []);
  const isIncomeCode = useCallback((code: string) => getCategory(code)?.isIncome ?? ["N0","N1","N2","N3","N4","N5"].includes(code), [getCategory]);
  const isTransferCode = useCallback((code: string) => getCategory(code)?.isTransfer ?? ["N0","N1","N2"].includes(code), [getCategory]);

  return (
    <PettyCategoryContext.Provider value={{
      categories, groups, getCategory,
      upsertCategory, deleteCategory, toggleEnabled, updateMapping, resetToDefault,
      isIncomeCode, isTransferCode,
    }}>
      {children}
    </PettyCategoryContext.Provider>
  );
}

export function usePettyCategoryStore(): PettyCategoryContextValue {
  const ctx = useContext(PettyCategoryContext);
  if (!ctx) throw new Error("usePettyCategoryStore must be used within PettyCategoryProvider");
  return ctx;
}

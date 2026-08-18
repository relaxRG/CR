import React, { createContext, useCallback, useContext, useMemo } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  getCurrentInventoryMonth,
  normalizeInventoryMonth,
  type InventoryMonth,
} from "@/lib/inventory-core/month-browser";

const STORAGE_KEY = "business.global-active-month.v1";

interface GlobalBusinessMonthContextValue {
  month: InventoryMonth;
  selectMonth: (month: string) => void;
}

const GlobalBusinessMonthContext = createContext<GlobalBusinessMonthContextValue | null>(null);

/**
 * 全应用唯一业务月份。
 *
 * 报表、员工、备用金、库存、店铺只能读取和更新这个状态；模块自身只负责
 * 用空状态解释无数据月份，不能把全局月份跳回自己的数据月份。
 */
export function GlobalBusinessMonthProvider({ children }: { children: React.ReactNode }) {
  const [storedMonth, setStoredMonth] = usePersistedState<InventoryMonth>(STORAGE_KEY, getCurrentInventoryMonth());
  const month = normalizeInventoryMonth(storedMonth) ?? getCurrentInventoryMonth();

  const selectMonth = useCallback((next: string) => {
    const normalized = normalizeInventoryMonth(next);
    if (normalized) setStoredMonth(normalized);
  }, [setStoredMonth]);

  const value = useMemo(() => ({ month, selectMonth }), [month, selectMonth]);
  return <GlobalBusinessMonthContext.Provider value={value}>{children}</GlobalBusinessMonthContext.Provider>;
}

export function useGlobalBusinessMonth() {
  const context = useContext(GlobalBusinessMonthContext);
  if (!context) throw new Error("useGlobalBusinessMonth 必须在 GlobalBusinessMonthProvider 内使用");
  return context;
}

export { STORAGE_KEY as GLOBAL_BUSINESS_MONTH_STORAGE_KEY };

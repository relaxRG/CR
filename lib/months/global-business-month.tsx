import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import {
  getCurrentInventoryMonth,
  normalizeInventoryMonth,
  type InventoryMonth,
} from "@/lib/inventory-core/month-browser";

const STORAGE_KEY = "business.global-active-month.v1";
/** 快速点按月份时，界面立即响应；持久化只写入最后一次选择。 */
export const BUSINESS_MONTH_PERSIST_DEBOUNCE_MS = 120;

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
  const normalizedStoredMonth = normalizeInventoryMonth(storedMonth) ?? getCurrentInventoryMonth();
  const [month, setMonth] = useState<InventoryMonth>(normalizedStoredMonth);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 只同步外部加载或跨设备恢复后的存储值；本地连续点按由 selectMonth 立即驱动。
  useEffect(() => {
    setMonth(normalizedStoredMonth);
  }, [normalizedStoredMonth]);

  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);

  const selectMonth = useCallback((next: string) => {
    const normalized = normalizeInventoryMonth(next);
    if (!normalized || normalized === month) return;
    setMonth(normalized);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      setStoredMonth(normalized);
      persistTimer.current = null;
    }, BUSINESS_MONTH_PERSIST_DEBOUNCE_MS);
  }, [month, setStoredMonth]);

  const value = useMemo(() => ({ month, selectMonth }), [month, selectMonth]);
  return <GlobalBusinessMonthContext.Provider value={value}>{children}</GlobalBusinessMonthContext.Provider>;
}

export function useGlobalBusinessMonth() {
  const context = useContext(GlobalBusinessMonthContext);
  if (!context) throw new Error("useGlobalBusinessMonth 必须在 GlobalBusinessMonthProvider 内使用");
  return context;
}

export { STORAGE_KEY as GLOBAL_BUSINESS_MONTH_STORAGE_KEY };

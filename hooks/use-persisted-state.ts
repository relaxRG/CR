import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 持久化 useState:挂载时从 AsyncStorage 读取,变更时写回。
 * 用于快捷筛选的选中/展开状态,在明确清除前一直保留。
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(initial);
  const loadedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (alive && raw != null) {
          try {
            setState(JSON.parse(raw) as T);
          } catch {
            // 忽略损坏数据
          }
        }
      })
      .finally(() => {
        loadedRef.current = true;
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (p: T) => T)(prev) : value;
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [key],
  );

  return [state, set] as const;
}

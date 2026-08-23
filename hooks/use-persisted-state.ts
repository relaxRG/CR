import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

const PERSIST_DEBOUNCE_MS = 180;

/**
 * 用于界面偏好、快捷筛选和展开状态的持久化 useState。
 *
 * 读取完成前的用户交互优先于陈旧缓存；连续交互会合并为一次写入，
 * 以避免切换分段、筛选或折叠项时在 AsyncStorage 中产生写入风暴。
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(initial);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSerializedRef = useRef<string | null>(null);
  const hasLocalUpdateRef = useRef(false);

  const flushPendingWrite = useCallback((storageKey: string) => {
    const serialized = pendingSerializedRef.current;
    if (serialized == null) return;
    pendingSerializedRef.current = null;
    AsyncStorage.setItem(storageKey, serialized).catch(() => {});
  }, []);

  const scheduleWrite = useCallback((serialized: string) => {
    pendingSerializedRef.current = serialized;
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      flushPendingWrite(key);
    }, PERSIST_DEBOUNCE_MS);
  }, [flushPendingWrite, key]);

  useEffect(() => {
    let alive = true;
    pendingSerializedRef.current = null;
    hasLocalUpdateRef.current = false;

    AsyncStorage.getItem(key)
      .then((raw) => {
        // 若用户在异步水合完成前已交互，保留最新交互而不回写陈旧缓存。
        if (!alive || raw == null || hasLocalUpdateRef.current) return;
        try {
          setState(JSON.parse(raw) as T);
        } catch {
          // 忽略损坏数据，继续使用调用方提供的安全默认值。
        }
      })
      .finally(() => {
        if (!alive) return;
        if (pendingSerializedRef.current != null) scheduleWrite(pendingSerializedRef.current);
      });

    return () => {
      alive = false;
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      flushPendingWrite(key);
    };
  }, [flushPendingWrite, key, scheduleWrite]);

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (previous: T) => T)(prev) : value;
        hasLocalUpdateRef.current = true;
        scheduleWrite(JSON.stringify(next));
        return next;
      });
    },
    [scheduleWrite],
  );

  return [state, set] as const;
}

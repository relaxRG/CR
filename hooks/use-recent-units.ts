import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "cocktail_recent_units";
const MAX_RECENT = 3;

/**
 * Persists and retrieves the most recently used measurement units.
 * Returns up to MAX_RECENT units, ordered from most-recent to least-recent.
 */
export function useRecentUnits() {
  const [recentUnits, setRecentUnits] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed)) setRecentUnits(parsed.slice(0, MAX_RECENT));
        }
      })
      .catch(() => {});
  }, []);

  const addRecentUnit = useCallback((unit: string) => {
    if (!unit.trim()) return;
    setRecentUnits((prev) => {
      const filtered = prev.filter((u) => u !== unit);
      const next = [unit, ...filtered].slice(0, MAX_RECENT);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { recentUnits, addRecentUnit };
}

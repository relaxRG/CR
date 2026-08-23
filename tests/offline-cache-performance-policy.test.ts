import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("离线缓存性能护栏", () => {
  it("将界面偏好的连续写入合并为短防抖，并在卸载时安全落盘", () => {
    const hook = source("hooks/use-persisted-state.ts");

    expect(hook).toContain("const PERSIST_DEBOUNCE_MS = 180");
    expect(hook).toContain("const writeTimerRef = useRef");
    expect(hook).toContain("const pendingSerializedRef = useRef");
    expect(hook).toContain("const hasLocalUpdateRef = useRef");
    expect(hook).toContain("if (!alive || raw == null || hasLocalUpdateRef.current) return");
    expect(hook).toContain("flushPendingWrite(key)");
    expect(hook).toContain("pendingSerializedRef.current != null");
    expect(hook).toContain("AsyncStorage.setItem(storageKey, serialized)");
  });

  it("将配方仓库的首次水合和同步重载收敛为批量读取，避免多键逐项桥接", () => {
    const recipes = source("lib/recipes/store.tsx");

    expect(recipes).toContain("AsyncStorage.multiGet([");
    expect(recipes).toContain("CATEGORY_GROUPS_KEY");
    expect(recipes).toContain("PREFS_KEY");
    expect(recipes).not.toContain("const prefsRaw = await AsyncStorage.getItem(PREFS_KEY)");
    expect(recipes).not.toContain("const cgRaw = await AsyncStorage.getItem(CATEGORY_GROUPS_KEY)");
  });
});

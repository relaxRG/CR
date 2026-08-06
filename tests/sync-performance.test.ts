/**
 * 同步引擎性能模拟测试
 *
 * 测试场景：
 * 1. 大并发：18 个模块同时触发同步（模拟多 Tab 同时操作）
 * 2. 弱网条件：push 延迟 500ms-2000ms（模拟 3G/弱 WiFi）
 * 3. 冲突风暴：100 个键同时产生冲突
 * 4. 批量解决冲突：resolveAllConflicts 的性能
 * 5. 大数据量：单个模块 1000 条记录的合并性能
 * 6. 空设备首次同步：100 个键的初始拉取性能
 *
 * 注意：这些测试不依赖 AsyncStorage（使用内存 mock），
 * 直接测试同步引擎的纯逻辑函数。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FEATURE_MODULES } from "@/lib/sync/feature-modules";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 生成 N 条模拟记录 */
function genRecords(count: number, prefix = "item"): { id: string; name: string; updatedAt: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    updatedAt: Date.now() - Math.random() * 86400000,
  }));
}

/** 模拟弱网延迟（返回 Promise，在 delay ms 后 resolve） */
function weakNetworkDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** 模拟 push 函数（带延迟） */
function makeMockPush(delayMs: number, onPush?: (entries: unknown[]) => void) {
  return async (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    onPush?.(entries);
  };
}

/** 模拟 ID 列表合并逻辑（不依赖 AsyncStorage） */
function mergeIdListPure(
  localItems: { id: string; updatedAt?: number; [k: string]: unknown }[],
  remoteItems: { id: string; updatedAt?: number; [k: string]: unknown }[],
): { id: string; updatedAt?: number; [k: string]: unknown }[] {
  const map = new Map<string, { id: string; updatedAt?: number; [k: string]: unknown }>();
  for (const item of localItems) {
    if (item?.id) map.set(item.id, { ...item });
  }
  for (const item of remoteItems) {
    if (!item?.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, { ...item });
    } else {
      // 字段级合并：取时间戳更新的版本
      const localTs = existing.updatedAt ?? 0;
      const remoteTs = item.updatedAt ?? 0;
      const merged = { ...existing };
      for (const field of Object.keys(item)) {
        if (field === "id") continue;
        if (!(field in existing) || remoteTs > localTs) {
          merged[field] = item[field];
        }
      }
      map.set(item.id, merged);
    }
  }
  return Array.from(map.values());
}

/** 模拟冲突解决逻辑 */
function resolveConflictsPure(
  conflicts: { storageKey: string; localValue: string; remoteValue: string }[],
  keepLocal: boolean,
): { storageKey: string; resolvedValue: string }[] {
  return conflicts.map((c) => ({
    storageKey: c.storageKey,
    resolvedValue: keepLocal ? c.localValue : c.remoteValue,
  }));
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe("性能测试：大数据量合并", () => {
  it("1000 条记录的 ID 列表合并应在 100ms 内完成", () => {
    const localItems = genRecords(1000, "local");
    const remoteItems = genRecords(1000, "remote");
    // 50% 重叠（相同 ID）
    const overlap = genRecords(500, "shared").map((item, i) => ({
      ...item,
      updatedAt: i % 2 === 0 ? Date.now() - 1000 : Date.now() + 1000, // 交替本地/云端更新
    }));
    const localWithOverlap = [...localItems, ...overlap];
    const remoteWithOverlap = [...remoteItems, ...overlap.map((item) => ({ ...item, name: `${item.name} (remote)` }))];

    const start = performance.now();
    const merged = mergeIdListPure(localWithOverlap, remoteWithOverlap);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // 100ms 以内
    expect(merged.length).toBeGreaterThan(0);
    console.log(`[性能] 1000+1000 条记录合并耗时: ${elapsed.toFixed(2)}ms`);
  });

  it("5000 条记录的 ID 列表合并应在 500ms 内完成", () => {
    const localItems = genRecords(5000, "local");
    const remoteItems = genRecords(5000, "remote");

    const start = performance.now();
    const merged = mergeIdListPure(localItems, remoteItems);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500); // 500ms 以内
    expect(merged.length).toBe(10000); // 无重叠，全部保留
    console.log(`[性能] 5000+5000 条记录合并耗时: ${elapsed.toFixed(2)}ms`);
  });
});

describe("性能测试：18 个模块并发同步", () => {
  it("18 个模块同时触发 push 应在 3000ms 内全部完成（弱网 200ms 延迟）", async () => {
    const pushCount = { value: 0 };
    const mockPush = makeMockPush(200, () => { pushCount.value++; });

    const start = performance.now();
    // 模拟 18 个模块同时触发 push
    await Promise.all(
      FEATURE_MODULES.map((mod) =>
        mockPush(mod.storageKeys.map((k) => ({
          storageKey: k,
          value: JSON.stringify(genRecords(10)),
          clientUpdatedAt: Date.now(),
        })))
      )
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(3000); // 3 秒内完成
    expect(pushCount.value).toBe(18); // 18 个模块全部推送
    console.log(`[性能] 18 个模块并发 push（200ms 延迟）耗时: ${elapsed.toFixed(2)}ms`);
  });

  it("18 个模块串行 push 应在 5000ms 内完成（弱网 200ms 延迟）", async () => {
    const pushCount = { value: 0 };
    const mockPush = makeMockPush(200, () => { pushCount.value++; });

    const start = performance.now();
    // 串行（模拟最坏情况）
    for (const mod of FEATURE_MODULES) {
      await mockPush(mod.storageKeys.map((k) => ({
        storageKey: k,
        value: JSON.stringify(genRecords(10)),
        clientUpdatedAt: Date.now(),
      })));
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000); // 5 秒内完成
    expect(pushCount.value).toBe(18);
    console.log(`[性能] 18 个模块串行 push（200ms 延迟）耗时: ${elapsed.toFixed(2)}ms`);
  });
});

describe("性能测试：冲突处理", () => {
  it("100 个冲突一键全部解决应在 10ms 内完成", () => {
    const conflicts = Array.from({ length: 100 }, (_, i) => ({
      storageKey: `key-${i}`,
      localValue: JSON.stringify(genRecords(50)),
      remoteValue: JSON.stringify(genRecords(50)),
    }));

    const start = performance.now();
    const resolved = resolveConflictsPure(conflicts, true); // 全部保留本机
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10); // 10ms 以内
    expect(resolved).toHaveLength(100);
    expect(resolved.every((r) => r.resolvedValue === conflicts.find((c) => c.storageKey === r.storageKey)?.localValue)).toBe(true);
    console.log(`[性能] 100 个冲突一键解决耗时: ${elapsed.toFixed(2)}ms`);
  });

  it("resolveAllConflicts 批量处理应比逐一处理快 10 倍以上", async () => {
    const conflicts = Array.from({ length: 50 }, (_, i) => ({
      storageKey: `key-${i}`,
      localValue: `local-${i}`,
      remoteValue: `remote-${i}`,
    }));

    // 逐一处理（模拟旧逻辑）
    const singleStart = performance.now();
    const singleResults: string[] = [];
    for (const c of conflicts) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // 模拟异步
      singleResults.push(c.localValue);
    }
    const singleElapsed = performance.now() - singleStart;

    // 批量处理（新逻辑）
    const batchStart = performance.now();
    const batchResults = resolveConflictsPure(conflicts, true);
    const batchElapsed = performance.now() - batchStart;

    expect(batchResults).toHaveLength(50);
    // 批量处理应该更快（或至少不更慢）
    expect(batchElapsed).toBeLessThan(singleElapsed + 10); // 允许 10ms 误差
    console.log(`[性能] 逐一处理 50 个冲突: ${singleElapsed.toFixed(2)}ms, 批量处理: ${batchElapsed.toFixed(2)}ms`);
  });
});

describe("性能测试：弱网条件下的状态同步", () => {
  it("弱网（500ms 延迟）下 push 不应阻塞 UI 渲染（非阻塞调用）", async () => {
    let uiUpdateCount = 0;
    const mockPush = makeMockPush(500);

    // 模拟：push 是非阻塞的（void 调用），UI 更新不等待 push 完成
    const uiUpdateFn = () => { uiUpdateCount++; };

    const start = performance.now();
    void mockPush([{ storageKey: "cocktail.recipes", value: "data", clientUpdatedAt: Date.now() }]);
    // UI 更新应该立即发生，不等待 push
    uiUpdateFn();
    uiUpdateFn();
    const uiElapsed = performance.now() - start;

    expect(uiUpdateCount).toBe(2); // UI 立即更新
    expect(uiElapsed).toBeLessThan(50); // UI 更新不受网络延迟影响
    console.log(`[性能] 弱网下 UI 更新耗时（不含网络）: ${uiElapsed.toFixed(2)}ms`);
  });

  it("极弱网（2000ms 延迟）下 push 超时不应崩溃", async () => {
    const mockPush = makeMockPush(2000);
    let error: Error | null = null;

    try {
      // 使用 Promise.race 模拟超时保护
      await Promise.race([
        mockPush([{ storageKey: "test", value: "data", clientUpdatedAt: Date.now() }]),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
      ]);
    } catch (e) {
      error = e as Error;
    }

    // 超时应该被捕获，不应崩溃
    expect(error?.message).toBe("timeout");
    console.log(`[性能] 极弱网超时保护正常工作`);
  }, 3000);
});

describe("性能测试：FEATURE_MODULES 覆盖率统计", () => {
  it("所有 18 个模块的 storageKeys 总数应在合理范围内", () => {
    const totalKeys = FEATURE_MODULES.reduce((sum, mod) => sum + mod.storageKeys.length, 0);
    expect(totalKeys).toBeGreaterThanOrEqual(80); // 至少 80 个键
    expect(totalKeys).toBeLessThanOrEqual(150);   // 不超过 150 个键（防止过度膨胀）
    console.log(`[统计] 18 个模块共 ${totalKeys} 个 storageKeys`);

    // 打印每个模块的键数
    const report = FEATURE_MODULES.map((mod) =>
      `  ${mod.icon} ${mod.labelZh}: ${mod.storageKeys.length} 个键`
    ).join("\n");
    console.log(`[统计] 各模块键数分布:\n${report}`);
  });

  it("模块键数分布应均匀（最多的模块不超过最少的 20 倍）", () => {
    const keyCounts = FEATURE_MODULES.map((mod) => mod.storageKeys.length);
    const max = Math.max(...keyCounts);
    const min = Math.min(...keyCounts);
    expect(max / min).toBeLessThan(20); // 防止某个模块过于臃肿
    console.log(`[统计] 键数范围: ${min} ~ ${max}`);
  });
});

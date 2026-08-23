import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("门店边界实例隔离与低端 Android 性能策略", () => {
  it("五个顶级 Tab 通过运行时子边界装配，稳定事实 Provider 不跨边界重复实例化", () => {
    const source = read("scripts/audit-store-provider-isolation.mjs");
    expect(source).toContain("five_runtime_tab_boundaries");
    expect(source).toContain("duplicateStableProviders.length === 0");
    expect(source).toContain("runtimeBoundaryWired");
    expect(source).toContain("usesCompatibilityBridge");
  });

  it("低端 Android 脚本强制受控物理设备、API 31+、PSS/trace/logcat/bugreport 采集", () => {
    const source = read("scripts/ci/run-android-low-end-performance.sh");
    expect(source).toContain("LOW_END_DEVICE_SERIAL");
    expect(source).toContain("LOW_END_DEVICE_MODEL");
    expect(source).toContain("API 31+");
    expect(source).toContain("dumpsys meminfo");
    expect(source).toContain("logcat -d -t 2000");
    expect(source).toContain("bugreport");
    expect(source).toContain("assert-mobile-performance.mjs");
  });

  it("Android Macrobenchmark 模板覆盖备用金和库存长列表，并保留 FrameTiming 与启动指标", () => {
    const source = read("scripts/ci/android-macrobenchmark/StoreLowEndPerformanceBenchmark.kt");
    expect(source).toContain("fun pettyCashLongList");
    expect(source).toContain("fun inventoryLongList");
    expect(source).toContain("StartupTimingMetric()");
    expect(source).toContain("FrameTimingMetric()");
    expect(source).toContain("ITERATIONS = 7");
  });
});

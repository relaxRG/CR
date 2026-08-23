import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("门店边界实例隔离与低端 Android 性能策略", () => {
  it("当前门店复合边界中每个事实 Provider 只装配一次，并明确尚未拆为五个运行时子边界", () => {
    const source = read("scripts/audit-store-provider-isolation.mjs");
    expect(source).toContain('currentArchitecture: "single_store_feature_boundary"');
    expect(source).toContain("duplicatedProviders.length === 0");
    expect(source).toContain("subBoundaryInstances");
    expect(source).toContain("implicitCouplingRisk");
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

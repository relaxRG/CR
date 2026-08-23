import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirs: string[] = [];
const metricValues = {
  timeToInitialDisplayMs: 1100,
  timeToFullDisplayMs: 1700,
  peakPssMB: 200,
  frameDurationCpuP95Ms: 12,
  frameOverrunP95Ms: 1,
  jankFramesOver16Ms: 0,
  photoUploadPeakPssMB: 210,
};

function writeFixture(value: unknown, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-android-perf-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function report(multiplier = 1, device = { model: "Pixel 8", apiLevel: 35, abi: "arm64-v8a", buildType: "benchmark", compilationMode: "Partial" }) {
  const sample = Object.fromEntries(Object.entries(metricValues).map(([key, value]) => [key, value * multiplier]));
  return { platform: "android", device, scenarios: { store_inventory_long_list: { samples: Array.from({ length: 5 }, () => sample) } } };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Android 性能 CI", () => {
  it("使用 Android 平台阈值、设备字段和 P95 比较通过可比候选构建", () => {
    const baseline = writeFixture(report(), "baseline.json");
    const candidate = writeFixture(report(1.05), "candidate.json");
    const result = spawnSync("node", ["scripts/ci/assert-mobile-performance.mjs", candidate, baseline, "scripts/ci/android-performance-thresholds.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).platform).toBe("android");
  });

  it("拒绝 Android 设备 API 或编译模式不一致的候选基线比较", () => {
    const baseline = writeFixture(report(), "baseline.json");
    const candidate = writeFixture(report(1, { model: "Pixel 8", apiLevel: 34, abi: "arm64-v8a", buildType: "benchmark", compilationMode: "Partial" }), "candidate.json");
    const result = spawnSync("node", ["scripts/ci/assert-mobile-performance.mjs", candidate, baseline, "scripts/ci/android-performance-thresholds.json"], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures.join(" ")).toContain("设备可比字段不一致");
  });

  it("为 Android 回归输出可供 Webhook 去重的 Android 告警类型", () => {
    const input = writeFixture({ platform: "android", candidateDevice: { model: "Pixel 8" }, failures: ["inventory.frameDurationCpuP95Ms: exceeded"], warnings: [] }, "comparison.json");
    const result = spawnSync("node", ["scripts/ci/notify-ios-performance.mjs", input], { cwd: root, encoding: "utf8", env: { ...process.env, PERFORMANCE_ALERT_WEBHOOK_URL: "" } });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.type).toBe("android_performance_regression");
    expect(payload.platform).toBe("android");
  });
});

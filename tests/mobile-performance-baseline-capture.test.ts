import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const requiredMetrics = [
  "launchMs", "interactiveMs", "peakMemoryMB", "scrollFrameP95Ms", "hitchesOver100Ms", "photoUploadPeakMemoryMB",
];

function fixture(samples = 5) {
  return {
    platform: "ios",
    device: { model: "Fixed iPhone", osVersion: "18.0", buildType: "release" },
    scenarios: {
      store_inventory_long_list: {
        samples: Array.from({ length: samples }, () => Object.fromEntries(requiredMetrics.map((metric) => [metric, 1]))),
      },
    },
  };
}

function runCapture(candidate: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cocktail-r-baseline-"));
  tempDirs.push(dir);
  const candidatePath = path.join(dir, "candidate.json");
  const baselinePath = path.join(dir, "baseline.json");
  fs.writeFileSync(candidatePath, JSON.stringify(candidate));
  const result = spawnSync("node", [
    "scripts/ci/capture-mobile-performance-baseline.mjs",
    candidatePath,
    baselinePath,
    "scripts/ci/ios-performance-thresholds.json",
  ], { cwd: process.cwd(), encoding: "utf8" });
  return { result, baselinePath };
}

describe("固定真机性能基线捕获", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("完整物理设备样本会生成带审批标识的候选基线", () => {
    const { result, baselinePath } = runCapture(fixture());

    expect(result.status).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    expect(baseline.baselineMetadata).toEqual(expect.objectContaining({
      dataClassification: "physical_device_performance_samples",
      approvalRequired: true,
    }));
    expect(baseline.scenarios.store_inventory_long_list.samples).toHaveLength(5);
  });

  it("缺少最小样本数或必要指标时拒绝生成基线", () => {
    const invalid = fixture(1);
    delete invalid.scenarios.store_inventory_long_list.samples[0]?.launchMs;
    const { result, baselinePath } = runCapture(invalid);

    expect(result.status).toBe(1);
    expect(fs.existsSync(baselinePath)).toBe(false);
    expect(result.stderr).toContain("requires at least 5 samples");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirs: string[] = [];
const baseMetrics = {
  launchMs: 1200,
  interactiveMs: 1800,
  peakMemoryMB: 220,
  scrollFrameP95Ms: 16.7,
  hitchesOver100Ms: 0,
  photoUploadPeakMemoryMB: 240,
};

function fixture(multiplier = 1, device = { model: "iPhone 15", osMajor: 18, perfMode: "release" }) {
  const sample = Object.fromEntries(Object.entries(baseMetrics).map(([key, value]) => [key, value * multiplier]));
  return {
    device,
    scenarios: {
      store_inventory_long_list: {
        samples: Array.from({ length: 5 }, () => sample),
      },
    },
  };
}

function writeFixture(value: unknown, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-ios-perf-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function runChecker(candidate: string, baseline: string) {
  return spawnSync("node", ["scripts/ci/assert-ios-performance.mjs", candidate, baseline], { cwd: root, encoding: "utf8" });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("iOS 性能阈值校验器", () => {
  it("接受同设备、足够样本且未超过相对和绝对阈值的候选构建", () => {
    const baseline = writeFixture(fixture(), "baseline.json");
    const candidate = writeFixture(fixture(1.05), "candidate.json");
    const result = runChecker(candidate, baseline);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).failures).toEqual([]);
  });

  it("拒绝设备不一致或样本不足的候选构建，并在报告中保留原因", () => {
    const baseline = writeFixture(fixture(), "baseline.json");
    const candidate = fixture(1, { model: "iPhone 16", osMajor: 18, perfMode: "release" });
    candidate.scenarios.store_inventory_long_list.samples = candidate.scenarios.store_inventory_long_list.samples.slice(0, 4);
    const candidatePath = writeFixture(candidate, "candidate.json");
    const result = runChecker(candidatePath, baseline);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.failures.join(" ")).toMatch(/拒绝比较|至少需要/);
  });
});

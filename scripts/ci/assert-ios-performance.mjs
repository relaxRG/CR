#!/usr/bin/env node
import fs from "node:fs";

const [candidatePath, baselinePath] = process.argv.slice(2);
if (!candidatePath || !baselinePath) {
  console.error("Usage: node scripts/ci/assert-ios-performance.mjs <candidate.json> <baseline.json>");
  process.exit(2);
}

const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const candidate = read(candidatePath);
const baseline = read(baselinePath);

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

const metricNames = ["launchMs", "interactiveMs", "peakMemoryMB", "scrollFrameP95Ms", "hitchesOver100Ms", "photoUploadPeakMemoryMB"];
const regressionAllowance = {
  launchMs: 0.15,
  interactiveMs: 0.15,
  peakMemoryMB: 0.12,
  scrollFrameP95Ms: 0.12,
  hitchesOver100Ms: 0.2,
  photoUploadPeakMemoryMB: 0.12,
};

const summarize = (scenario) => {
  const samples = scenario?.samples ?? [];
  if (samples.length < 5) throw new Error("每个场景至少需要 5 次独立采样");
  const summary = {};
  for (const metric of metricNames) {
    const values = samples.map((sample) => sample[metric]).filter((value) => Number.isFinite(value));
    if (!values.length) throw new Error(`缺少指标：${metric}`);
    summary[metric] = percentile(values, 0.95);
  }
  return summary;
};

const failures = [];
for (const [name, baselineScenario] of Object.entries(baseline.scenarios ?? {})) {
  const candidateScenario = candidate.scenarios?.[name];
  if (!candidateScenario) {
    failures.push(`${name}: 缺少候选场景`);
    continue;
  }
  const baselineSummary = summarize(baselineScenario);
  const candidateSummary = summarize(candidateScenario);
  for (const metric of metricNames) {
    const limit = baselineSummary[metric] * (1 + regressionAllowance[metric]);
    if (candidateSummary[metric] > limit) {
      failures.push(`${name}.${metric}: ${candidateSummary[metric].toFixed(2)} 超过基线 ${baselineSummary[metric].toFixed(2)} 的允许上限 ${limit.toFixed(2)}`);
    }
  }
}

const report = {
  device: candidate.device,
  scenarios: Object.fromEntries(Object.entries(candidate.scenarios ?? {}).map(([name, scenario]) => [name, summarize(scenario)])),
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);

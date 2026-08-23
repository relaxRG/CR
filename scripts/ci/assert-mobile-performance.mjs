#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [candidatePath, baselinePath, configPath] = process.argv.slice(2);
if (!candidatePath || !baselinePath || !configPath) {
  console.error("Usage: node scripts/ci/assert-mobile-performance.mjs <candidate.json> <baseline.json> <thresholds.json>");
  process.exit(2);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const candidate = readJson(candidatePath);
const baseline = readJson(baselinePath);
const config = readJson(configPath);

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

const comparableDevice = (a, b, fields) => fields.every((field) => a?.device?.[field] === b?.device?.[field]);

const summarizeScenario = (scenario, requiredMetrics, minSamples, p) => {
  const samples = scenario?.samples ?? [];
  if (samples.length < minSamples) throw new Error(`每个场景至少需要 ${minSamples} 次独立采样`);
  const summary = {};
  for (const metric of requiredMetrics) {
    const values = samples.map((sample) => sample[metric]).filter((value) => Number.isFinite(value));
    if (values.length < minSamples) throw new Error(`指标 ${metric} 的有效样本少于 ${minSamples}`);
    summary[metric] = percentile(values, p);
  }
  return summary;
};

const mergeLimits = (base, override) => ({ ...base, ...(override ?? {}) });
const failures = [];
const warnings = [];
const platform = config.platform;

if (candidate.platform !== platform || baseline.platform !== platform) {
  failures.push(`候选与基线必须声明平台 ${platform}`);
}
if (config.requireComparableDevice && !comparableDevice(candidate, baseline, config.comparableDeviceFields ?? [])) {
  failures.push(`候选构建与基线的 ${platform} 设备可比字段不一致，拒绝比较 P95 回归`);
}

const baselineScenarios = baseline.scenarios ?? {};
const candidateScenarios = candidate.scenarios ?? {};
for (const [name, baselineScenario] of Object.entries(baselineScenarios)) {
  const candidateScenario = candidateScenarios[name];
  if (!candidateScenario) {
    failures.push(`${name}: 缺少候选场景`);
    continue;
  }

  try {
    const baselineSummary = summarizeScenario(baselineScenario, config.requiredMetrics, config.minSamples, config.percentile);
    const candidateSummary = summarizeScenario(candidateScenario, config.requiredMetrics, config.minSamples, config.percentile);
    const scenarioConfig = config.scenarioOverrides?.[name] ?? {};
    const tolerance = mergeLimits(config.defaultTolerance, scenarioConfig.tolerance);
    const absoluteLimit = mergeLimits(config.defaultAbsoluteLimit, scenarioConfig.absoluteLimit);

    for (const metric of config.requiredMetrics) {
      const relativeLimit = baselineSummary[metric] * (1 + tolerance[metric]);
      const hardLimit = absoluteLimit[metric];
      const limit = Number.isFinite(hardLimit) ? Math.min(relativeLimit, hardLimit) : relativeLimit;
      if (candidateSummary[metric] > limit) {
        failures.push(`${name}.${metric}: P95=${candidateSummary[metric].toFixed(2)}，基线=${baselineSummary[metric].toFixed(2)}，允许上限=${limit.toFixed(2)}（相对=${relativeLimit.toFixed(2)}，绝对=${hardLimit ?? "无"}）`);
      }
    }
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : "场景汇总失败"}`);
  }
}

for (const name of Object.keys(candidateScenarios)) {
  if (!baselineScenarios[name]) warnings.push(`${name}: 尚无基线，仅记录候选结果，不作为通过依据`);
}

const report = {
  schemaVersion: 2,
  platform,
  candidateDevice: candidate.device,
  baselineDevice: baseline.device,
  thresholdConfig: path.resolve(configPath),
  warnings,
  failures,
  scenarios: Object.fromEntries(Object.entries(candidateScenarios).map(([name, scenario]) => {
    try {
      return [name, summarizeScenario(scenario, config.requiredMetrics, config.minSamples, config.percentile)];
    } catch (error) {
      return [name, { error: error instanceof Error ? error.message : "场景汇总失败" }];
    }
  })),
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);

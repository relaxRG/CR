#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [candidatePath, baselinePath, configPath] = process.argv.slice(2);
if (!candidatePath || !baselinePath || !configPath) {
  console.error("Usage: node scripts/ci/capture-mobile-performance-baseline.mjs <candidate.json> <baseline.json> <thresholds.json>");
  process.exit(2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const candidate = readJson(candidatePath);
const config = readJson(configPath);
const requiredMetrics = config.requiredMetrics ?? [];
const minSamples = config.minSamples ?? 1;
const failures = [];

if (candidate.platform !== config.platform && config.platform) {
  failures.push(`platform mismatch: expected ${config.platform}, got ${candidate.platform ?? "missing"}`);
}
if (!candidate.device || typeof candidate.device !== "object") {
  failures.push("missing device identity");
}
for (const field of config.comparableDeviceFields ?? []) {
  if (!candidate.device || !candidate.device[field]) failures.push(`missing device.${field}`);
}

const scenarios = candidate.scenarios ?? {};
if (Object.keys(scenarios).length === 0) failures.push("missing scenarios");
for (const [name, scenario] of Object.entries(scenarios)) {
  const samples = scenario?.samples;
  if (!Array.isArray(samples) || samples.length < minSamples) {
    failures.push(`${name}: requires at least ${minSamples} samples`);
    continue;
  }
  samples.forEach((sample, index) => {
    for (const metric of requiredMetrics) {
      if (!Number.isFinite(sample?.[metric])) failures.push(`${name}.samples[${index}].${metric}: missing or non-finite`);
    }
  });
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, mode: "capture", failures }, null, 2));
  process.exit(1);
}

const baseline = {
  ...candidate,
  baselineMetadata: {
    capturedAt: new Date().toISOString(),
    sourceCandidate: path.basename(candidatePath),
    dataClassification: "physical_device_performance_samples",
    approvalRequired: true,
  },
};
fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  mode: "capture",
  baselinePath: path.resolve(baselinePath),
  platform: candidate.platform,
  device: candidate.device,
  scenarios: Object.keys(scenarios),
}, null, 2));

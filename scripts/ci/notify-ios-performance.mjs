#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const [reportPath] = process.argv.slice(2);
if (!reportPath) {
  console.error("Usage: node scripts/ci/notify-ios-performance.mjs <performance-report.json>");
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const failures = Array.isArray(report.failures) ? report.failures : [];
const platform = report.platform ?? report.candidateDevice?.platform ?? "ios";
const build = process.env.GITHUB_SHA?.slice(0, 12) ?? process.env.PERFORMANCE_BUILD_ID ?? "local";
const workflowUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const fingerprint = crypto.createHash("sha256")
  .update(JSON.stringify({ failures: [...failures].sort(), device: report.candidateDevice ?? null }))
  .digest("hex")
  .slice(0, 24);

const payload = {
  version: 1,
  type: `${platform}_performance_regression`,
  platform,
  severity: failures.length ? "warning" : "info",
  fingerprint,
  build,
  workflowUrl,
  candidateDevice: report.candidateDevice ?? null,
  baselineDevice: report.baselineDevice ?? null,
  failures,
  warnings: Array.isArray(report.warnings) ? report.warnings : [],
  occurredAt: new Date().toISOString(),
};

console.log(JSON.stringify(payload, null, 2));
if (!failures.length) process.exit(0);

const webhook = process.env.PERFORMANCE_ALERT_WEBHOOK_URL;
if (!webhook) {
  console.error("[performance-alert] 性能失败已生成报告；未配置 PERFORMANCE_ALERT_WEBHOOK_URL，因此不发送外部通知。");
  process.exit(0);
}

const response = await fetch(webhook, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Performance-Alert-Fingerprint": fingerprint,
    "Idempotency-Key": fingerprint,
  },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) {
  const message = `[performance-alert] webhook 返回 ${response.status}`;
  if (process.env.PERFORMANCE_ALERT_STRICT === "true") {
    console.error(message);
    process.exit(1);
  }
  console.error(`${message}；不覆盖原始性能回归结果。`);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const tempDirs: string[] = [];

function reportFile(report: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-perf-alert-"));
  tempDirs.push(dir);
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, JSON.stringify(report));
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("iOS 性能告警机制", () => {
  it("为失败生成稳定指纹，并在未配置 webhook 时安全保留本地报告", () => {
    const file = reportFile({ candidateDevice: { model: "iPhone 15" }, failures: ["inventory.scrollFrameP95Ms: exceeded"], warnings: [] });
    const result = spawnSync("node", ["scripts/ci/notify-ios-performance.mjs", file], { cwd: root, encoding: "utf8", env: { ...process.env, PERFORMANCE_ALERT_WEBHOOK_URL: "" } });
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.type).toBe("ios_performance_regression");
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(payload.failures).toEqual(["inventory.scrollFrameP95Ms: exceeded"]);
    expect(result.stderr).toContain("未配置 PERFORMANCE_ALERT_WEBHOOK_URL");
  });

  it("不将原始业务数据放入性能告警载荷", () => {
    const source = fs.readFileSync(path.join(root, "scripts/ci/notify-ios-performance.mjs"), "utf8");
    expect(source).toContain("Idempotency-Key");
    expect(source).toContain("X-Performance-Alert-Fingerprint");
    expect(source).not.toContain("AsyncStorage");
    expect(source).not.toContain("records:");
  });
});

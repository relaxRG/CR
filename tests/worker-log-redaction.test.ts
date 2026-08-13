import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync("workers/cocktail-ai/worker-v4.js", "utf8");

describe("Worker日志与错误码脱敏", () => {
  it("控制台日志不拼接异常message、余额、令牌、配对码或设备令牌", () => {
    expect(worker).not.toMatch(/console\.(?:log|warn|error)\([^\n]*\.(?:message|stack)/);
    expect(worker).not.toMatch(/console\.(?:log|warn|error)\([^\n]*(?:balance|token|pair.?code|deviceToken)\s*[,)}]/i);
  });

  it("同步认证仅记录固定诊断码与布尔存在性，不回显身份值", () => {
    expect(worker).toContain('console.warn("[cf-sync] source_membership_unavailable", { hasDeviceId: Boolean(headers.get("X-Device-Id")) })');
    expect(worker).toContain('console.error("[cf-sync] recovery_join_failed", { code: "RECOVERY_JOIN_WRITE_FAILED" })');
    expect(worker).not.toContain("headers.get(\"X-Device-Token\") });");
  });

  it("所有后台降级和定时任务日志使用固定脱敏码", () => {
    for (const code of [
      "[AI] DEEPSEEK_FALLBACK",
      "[OCR] PRIMARY_MODEL_FALLBACK",
      "[OCR] BULK_MODEL_FALLBACK",
      "[initDB] INIT_DB_FAILED",
      "[Cron] BALANCE_CHECK_SUCCEEDED",
      "[Cron] BALANCE_ALERT_DISPATCHED",
      "[Cron] BALANCE_CHECK_FAILED",
    ]) {
      expect(worker).toContain(code);
    }
  });
});

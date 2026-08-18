import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("本地存储安全回归", () => {
  it("认证日志不输出会话令牌片段或完整用户对象", () => {
    const source = readFileSync("lib/_core/auth.ts", "utf8");
    expect(source).not.toContain("token.substring(");
    expect(source).not.toContain('"[Auth] User info retrieved:", user');
    expect(source).not.toContain('"[Auth] Setting user info...", user');
  });

  it("存储审计清单持续覆盖凭据与同步关键模式", () => {
    const schema = JSON.parse(readFileSync("docs/local-storage-schema.json", "utf8")) as {
      records: Array<{ key: string; backend: string }>;
    };
    const keys = new Set(schema.records.map((record) => record.key));
    expect(keys).toContain("app_session_token");
    expect(keys).toContain("cf.sync.groupSwitchSession.v1");
    expect(keys).toContain("monthly_reports_v1");
    expect(schema.records.some((record) => record.backend === "SecureStore")).toBe(true);
  });

  it("长期策略明确禁止凭据进入未加密持久化、同步和备份", () => {
    const strategy = readFileSync("docs/local-storage-security-and-lifecycle-strategy.md", "utf8");
    expect(strategy).toContain("禁止出现在 AsyncStorage、备份、日志和同步白名单");
    expect(strategy).toContain("凭据绝不进入备份或同步");
    expect(strategy).toContain("deviceToken");
    expect(strategy).toContain("recoveryTicket");
  });
});

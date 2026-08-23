import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const worker = fs.readFileSync(path.join(process.cwd(), "workers/cocktail-ai/worker-v4.js"), "utf8");

describe("归档对象服务端路由契约", () => {
  it("索引读取和条件提交均使用DeviceSessionV2权限、组范围与D1/R2受控事实", () => {
    expect(worker).toContain('path === "/api/archives/index" && method === "GET"');
    expect(worker).toContain('path === "/api/archives/commit" && method === "POST"');
    expect(worker).toContain('archiveSession(env, headers, "reports_monthly.view", origin)');
    expect(worker).toContain('archiveSession(env, headers, "reports_monthly.import", origin)');
    expect(worker).toContain("resolved.session.membership.groupId");
    expect(worker).toContain("env.ARCHIVES.put(objectKey, bytes");
    expect(worker).toContain("archiveObjectKey(groupId, entryId, operationId)");
  });

  it("提交采用operation幂等、revision条件写入、墓碑拒绝和失败对象清理，不会让旧设备覆盖权威版本", () => {
    expect(worker).toContain("archive_operations");
    expect(worker).toContain("ARCHIVE_REVISION_CONFLICT");
    expect(worker).toContain("ENTRY_DELETED");
    expect(worker).toContain("AND revision = ? AND status = 'active'");
    expect(worker).toContain("await env.ARCHIVES.delete(objectKey)");
    expect(worker).toContain("archiveDigest(bytes)");
  });
});

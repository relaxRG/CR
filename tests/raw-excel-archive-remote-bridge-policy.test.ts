import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function source(relative: string): string {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("原始Excel归档云端协调器接入契约", () => {
  it("Provider先持久化本机归档，再异步入队并恢复云端outbox，失败不得阻塞本机归档", () => {
    const provider = source("lib/store/monthly-report/raw-excel-archive-store.tsx");

    expect(provider).toContain('import { getRawExcelArchiveRemoteBridge } from "./archive-remote-bridge";');
    expect(provider).toContain("await persist(appendRawExcelArchiveEntries(entriesRef.current, incoming));");
    expect(provider).toContain("remoteBridgeRef.current.enqueueEntry(entry)");
    expect(provider).toContain("remoteBridgeRef.current.submit(operationId)");
    expect(provider).toContain("void resumeRemoteArchiveSync();");
    expect(provider).toContain("云端归档提交延后");
    expect(provider).toContain("remoteResults,");
    expect(provider).toContain("refreshRemoteArchiveIndex,");
  });

  it("远端桥只按需水合本机文件，outbox不持久化令牌或Base64，并使用DeviceSessionV2能力门禁", () => {
    const bridge = source("lib/store/monthly-report/archive-remote-bridge.ts");
    const coordinator = source("lib/store/monthly-report/archive-sync-coordinator.ts");

    expect(bridge).toContain("getDeviceSessionV2");
    expect(bridge).toContain('"reports_monthly.import"');
    expect(bridge).toContain("FileSystem.readAsStringAsync(localSourceUri");
    expect(coordinator).toContain("localSourceUri?: string");
    expect(coordinator).toContain("访问令牌绝不进入本地outbox");
    expect(coordinator).toContain("resumePending(shouldResume");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("设备权限授予后的刷新与服务端边界", () => {
  it("角色设置提交的allowedKeys必须由Worker持久化，而不是只更新角色", () => {
    const worker = source("workers/cocktail-ai/worker-v4.js");

    expect(worker).toContain("const { targetDeviceId, role, allowedKeys = null } = body || {}");
    expect(worker).toContain("const normalizedRole = normalizeDeviceRole(role)");
    expect(worker).toContain("const normalizedAllowedKeys = normalizeRequestedAllowedKeys(allowedKeys)");
    expect(worker).toContain("UPDATE devices SET role = ?, allowed_keys = ?");
    expect(worker).toContain("allowedKeys: normalizedRole === \"owner\" ? null : normalizedAllowedKeys");
  });

  it("Worker必须按当前设备授权过滤拉取、墓碑和推送，客户端不能单独承担安全边界", () => {
    const worker = source("workers/cocktail-ai/worker-v4.js");

    expect(worker).toContain("filterSyncEntriesForDevice(device");
    expect(worker).toContain("parseStoredAllowedKeys(device.allowed_keys)");
    expect(worker).toContain("allowedKeys === null");
    expect(worker).toContain("new Set(allowedKeys)");
    expect(worker).toContain("const writableEntries = filterSyncEntriesForDevice(device, entries)");
  });

  it("权限变更会唤醒组内实时同步，目标设备本轮先写回授权缓存再决定读写行为", () => {
    const worker = source("workers/cocktail-ai/worker-v4.js");
    const provider = source("lib/cf-sync/provider.tsx");

    expect(worker).toContain("UPDATE SET last_push_at = excluded.last_push_at");
    expect(provider).toContain("const effectiveInfo: DeviceInfo");
    expect(provider).toContain("await saveDeviceInfo(effectiveInfo)");
    expect(provider).toContain("effectiveInfo.role === \"guest\" ? async () => {} : pushWithEffectivePermission");
    expect(provider).toContain("startRealtimeSync(() => {");
    expect(provider).toContain("void performSync()");
  });
});

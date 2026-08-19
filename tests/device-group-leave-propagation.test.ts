import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync("lib/cf-sync/client.ts", "utf8");
const provider = readFileSync("lib/cf-sync/provider.tsx", "utf8");
const deviceManager = readFileSync("app/device-manager.tsx", "utf8");
const worker = readFileSync("workers/cocktail-ai/worker-v4.js", "utf8");

function handler(name: string, nextName: string): string {
  const start = worker.indexOf(`async function ${name}`);
  const end = worker.indexOf(`async function ${nextName}`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return worker.slice(start, end);
}

describe("设备组退出远端传播与失联主设备恢复", () => {
  it("客户端通过专用端点退出，并且 Provider 先完成远端撤销才清除本机凭据", () => {
    expect(client).toContain('export async function leaveCurrentSyncGroup()');
    expect(client).toContain('cfFetch("/api/device/leave"');

    const logoutStart = provider.indexOf("const logout = useCallback");
    const logoutEnd = provider.indexOf("const restartSync", logoutStart);
    const logout = provider.slice(logoutStart, logoutEnd);
    expect(logout.indexOf("await leaveCurrentSyncGroup()")).toBeGreaterThanOrEqual(0);
    expect(logout.indexOf("await clearDeviceInfo()")).toBeGreaterThan(logout.indexOf("await leaveCurrentSyncGroup()"));
    expect(deviceManager).toContain("leaveCurrentGroupSafely");
    expect(deviceManager).toContain("远端成员撤销未完成");
  });

  it("主设备仍有其他活跃成员时拒绝自助退出，防止产生无主同步组", () => {
    const leave = handler("handleDeviceLeave", "handleDeviceRecoverStaleOwner");
    expect(leave).toContain('err("OWNER_HANDOFF_REQUIRED", 409');
    expect(leave).toContain('device.role === "owner"');
    expect(leave).toContain("COUNT(*) AS count");
    expect(leave).toContain("UPDATE devices SET is_active = 0");
    expect(leave).toContain("clearWebDeviceSessions(env, device.device_id)");
  });

  it("失联主设备恢复按七天阈值保护，并原子撤销旧主设备后交接当前设备", () => {
    const recovery = handler("handleDeviceRecoverStaleOwner", "handleDeviceUpdateRole");
    expect(recovery).toContain("7 * 24 * 60 * 60 * 1000");
    expect(recovery).toContain('err("STALE_OWNER_RECOVERY_TOO_EARLY", 409');
    expect(recovery).toContain("UPDATE devices SET is_active = 0");
    expect(recovery).toContain("UPDATE devices SET role = 'owner'");
    expect(recovery).toContain("UPDATE device_groups SET owner_device_id");
    expect(recovery).toContain("await env.DB.batch");
    expect(recovery).toContain("clearWebDeviceSessions(env, owner.device_id)");
    expect(client).toContain('cfFetch("/api/device/recover-stale-owner"');
    expect(provider).toContain("recoverStaleGroupOwner");
    expect(deviceManager).toContain('testID="recover-stale-sync-owner"');
    expect(deviceManager).toContain("连续 7 天未在线");
  });

  it("紧急本机凭据清除不访问远端、不删除业务数据，并要求明确二次确认", () => {
    const clearStart = provider.indexOf("const forceClearLocalSyncCredentials");
    const clearEnd = provider.indexOf("const openPairModal", clearStart);
    const forceClear = provider.slice(clearStart, clearEnd);
    expect(forceClear).toContain("await clearDeviceInfo()");
    expect(forceClear).toContain("disableSync()");
    expect(forceClear).toContain("resetRealtimeSync()");
    expect(forceClear).not.toContain("leaveCurrentSyncGroup");
    expect(forceClear).not.toContain("AsyncStorage.clear");
    expect(deviceManager).toContain('testID="force-clear-local-sync-credentials"');
    expect(deviceManager).toContain("const finalConfirm");
    expect(deviceManager).toContain("最后确认");
    expect(deviceManager).toContain("远端成员记录会保留");
  });

  it("Worker 将成员变更写入组时间戳，并且恢复日志不输出任何令牌", () => {
    const leave = handler("handleDeviceLeave", "handleDeviceRecoverStaleOwner");
    const recovery = handler("handleDeviceRecoverStaleOwner", "handleDeviceUpdateRole");
    expect(leave).toContain("INSERT INTO group_ts");
    expect(recovery).toContain("INSERT INTO group_ts");
    const recoveryLog = recovery.match(/console\.warn\("\[cf-sync\] stale_owner_recovered"[^\n]*/)?.[0] ?? "";
    expect(recoveryLog).toContain("String(device.group_id).slice(0, 8)");
    expect(recoveryLog).not.toContain("token:");
    expect(recoveryLog).not.toContain("device.token");
  });
});

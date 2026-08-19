import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("设备会话恢复与身份展示契约", () => {
  const manager = read("app/device-manager.tsx");
  const client = read("lib/cf-sync/client.ts");
  const provider = read("lib/cf-sync/provider.tsx");
  const worker = read("workers/cocktail-ai/worker-v4.js");

  it("未核验会话绝不降级显示为访客，主设备操作必须要求在线已验证身份", () => {
    expect(manager).not.toContain('const currentRole: DeviceRole = deviceRole ?? "guest"');
    expect(manager).toContain('const isVerifiedOnline = deviceSessionState.tag === "authorized"');
    expect(manager).toContain('const canRecoverStaleOwner = isVerifiedOnline');
    expect(manager).toContain('设备身份暂未核验');
    expect(manager).toContain('远端登记，待核验');
    expect(manager).toContain('disabled={!isVerifiedOnline || isGroupSwitching}');
  });

  it("恢复接口将旧生产Worker的404 Not found映射为稳定错误码，且不再假定平面凭据响应", () => {
    expect(client).toContain('export type StaleOwnerRecoveryResult');
    expect(client).toContain('STALE_OWNER_RECOVERY_ROUTE_UNAVAILABLE');
    expect(client).toContain('result.membership');
    expect(client).toContain('STALE_OWNER_RECOVERY_INVALID_RESPONSE');
    expect(provider).toContain('const result = await recoverStaleOwner()');
    expect(provider).toContain('setDeviceCredentials(result.membership)');
  });

  it("Worker恢复必须幂等、能修复无活跃主设备并以原子写入交接角色和组指针", () => {
    expect(worker).toContain('DEVICE_GROUP_NOT_FOUND');
    expect(worker).toContain('owner_recovered_without_active_owner');
    expect(worker).toContain('outcome: "ALREADY_OWNER"');
    expect(worker).toContain('outcome: "RECOVERED"');
    expect(worker).toContain('UPDATE devices SET role = \'owner\'');
    expect(worker).toContain('UPDATE device_groups SET owner_device_id = ?');
    expect(worker).toContain('previousOwnerDeviceId');
  });

  it("安全退出或强制清除本机凭据后立即清空陈旧设备列表，不继续把远端成员当作本机事实展示", () => {
    const emptyListCalls = manager.match(/setDevices\(\[\]\);/g) ?? [];
    expect(emptyListCalls.length).toBeGreaterThanOrEqual(2);
    expect(manager).toContain('setCustomRoleNames({});');
    expect(manager).toContain('远端设备组仍可能显示本机');
  });

  it("恢复提示必须对部署缺失、保护期、组不存在和成员未核验分别给出可执行说明", () => {
    expect(manager).toContain('服务器尚未部署“恢复失联主设备”功能');
    expect(manager).toContain('最近 7 天内仍有活动记录');
    expect(manager).toContain('该同步组的远端记录已不存在');
    expect(manager).toContain('本机成员资格未通过核验');
  });
});

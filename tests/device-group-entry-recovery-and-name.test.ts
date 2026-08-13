import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deviceManager = readFileSync("app/device-manager.tsx", "utf8");
const pairDevice = readFileSync("app/pair-device.tsx", "utf8");
const client = readFileSync("lib/cf-sync/client.ts", "utf8");
const provider = readFileSync("lib/cf-sync/provider.tsx", "utf8");
const worker = readFileSync("workers/cocktail-ai/worker-v4.js", "utf8");

describe("设备组创建、恢复加入与命名护栏", () => {
  it("未配对本地模式提供显式创建与加入入口，且创建不依赖隐式注册", () => {
    expect(deviceManager).toContain('testID="create-sync-group"');
    expect(deviceManager).toContain('testID="join-existing-sync-group"');
    expect(deviceManager).toContain("handleCreateSyncGroup");
    expect(deviceManager).toContain("createSyncGroup()");
    expect(provider).toContain("createNewSyncGroup");
    expect(provider).toContain("SYNC_GROUP_ALREADY_ACTIVE");
  });

  it("初始名称优先使用公开设备型号，用户改名经Worker持久化且不触及身份字段", () => {
    expect(client).toContain('import * as Device from "expo-device"');
    expect(client).toContain("getSuggestedDeviceName");
    expect(client).toContain("Device.modelName");
    expect(client).toContain('"/api/device/rename"');
    expect(worker).toContain("handleDeviceRename");
    expect(worker).toContain("DEVICE_NAME_INVALID");
    expect(worker).toContain('UPDATE devices SET name = ?');
  });

  it("来源成员失效使用稳定错误码和用户二次确认恢复，不把网络错误自动降级为配对", () => {
    expect(worker).toContain('err("SOURCE_MEMBERSHIP_UNAVAILABLE", 401');
    expect(worker).toContain('"/api/device/recover-join"');
    expect(pairDevice).toContain("SOURCE_MEMBERSHIP_UNAVAILABLE");
    expect(pairDevice).toContain("确认恢复加入");
    expect(pairDevice).toContain("recoverJoinToAnotherGroup");
    expect(pairDevice).toContain("网络、超时和其他401绝不自动降级");
    expect(client).toContain("recoverJoinWithCode");
  });

  it("恢复加入端点只消费有效目标码并创建新目标身份，不复用来源令牌", () => {
    const start = worker.indexOf("async function handleDeviceRecoverJoin");
    const end = worker.indexOf("async function handleDeviceCommitSwitch", start);
    const handler = worker.slice(start, end);
    expect(handler).toContain("reserved_switch_id");
    expect(handler).toContain("PAIR_CODE_UNAVAILABLE");
    expect(handler).toContain("generateToken()");
    expect(handler).toContain("deviceToken: token");
    expect(handler).not.toContain('headers.get("X-Device-Token")');
  });
});

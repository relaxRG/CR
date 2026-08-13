import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname, "..");
const readProjectFile = (relativePath: string) => readFileSync(resolve(projectRoot, relativePath), "utf8");

describe("未配对本地模式回归护栏", () => {
  it("同步Provider启动、重试和前后台回归不再调用隐式设备注册", () => {
    const source = readProjectFile("lib/cf-sync/provider.tsx");

    expect(source).not.toContain("getOrCreateDevice");
    expect(source).toContain("const info = await getDeviceInfo();");
    expect(source).toContain("未配对状态是本地模式");
    expect(source).toContain("else if (await getDeviceInfo())");
  });

  it("客户端仅允许用户显式创建新同步组，且旧配对协议不能覆盖已有成员资格", () => {
    const source = readProjectFile("lib/cf-sync/client.ts");

    expect(source).toContain("export async function createNewSyncGroup");
    expect(source).not.toContain("export async function getOrCreateDevice");
    expect(source).toContain("SYNC_GROUP_ALREADY_ACTIVE");
    expect(source).toContain("SYNC_GROUP_SWITCH_REQUIRES_ATOMIC_WORKER_PROTOCOL");
  });

  it("客户端包中不保留可伪造设备令牌的Worker服务端密钥", () => {
    const source = readProjectFile("lib/cf-sync/client.ts");

    expect(source).not.toContain("CF_WORKER_SECRET");
    expect(source).not.toContain("makeDeviceToken");
    expect(source).not.toContain('crypto.subtle.importKey');
  });
});

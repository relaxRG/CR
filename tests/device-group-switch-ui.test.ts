import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const readSource = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("设备管理安全切组入口", () => {
  it("所有已激活设备均可看到加入其他同步组入口，主设备有交接保护", () => {
    const source = readSource("app/device-manager.tsx");

    expect(source).toContain("同步组切换");
    expect(source).toContain("加入其他同步组");
    expect(source).toContain("交接主设备后加入新组");
    expect(source).toContain('params: { switch: "1", handoffDeviceId');
    expect(source).toContain("isGroupSwitching");
  });

  it("配对页在已有成员资格时必须调用原子切组，而新设备仍沿用普通配对", () => {
    const source = readSource("app/pair-device.tsx");

    expect(source).toContain("const isSwitchMode = params.switch === \"1\" && !!deviceInfo");
    expect(source).toContain("await switchToAnotherGroup(trimmed, params.handoffDeviceId || undefined)");
    expect(source).toContain("await pairWithCode(trimmed)");
    expect(source).toContain("当前组数据不会上传到目标组");
  });

  it("Provider在启动时先恢复未完成切组，再允许常规同步或实时连接", () => {
    const source = readSource("lib/cf-sync/provider.tsx");

    expect(source).toContain("const recovery = await recoverPendingGroupSwitch(groupSwitchRuntime)");
    expect(source).toContain('if (recovery === "blocked")');
    expect(source).toContain("switchToAnotherGroup: switchCurrentDeviceToAnotherGroup");
  });
});

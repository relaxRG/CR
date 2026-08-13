import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
const source = {
  deviceId: "device-a",
  groupId: "group-a",
  deviceToken: "token-a",
  role: "owner" as const,
  allowedKeys: null,
  deviceName: "A owner",
};
const target = {
  deviceId: "device-b",
  groupId: "group-b",
  deviceToken: "token-b",
  role: "collaborator" as const,
  allowedKeys: ["cocktail.recipes"],
  deviceName: "B member",
};

const calls: string[] = [];
let currentMember: {
  deviceId: string;
  groupId: string;
  deviceToken: string;
  role: "owner" | "collaborator" | "guest";
  allowedKeys: string[] | null;
  deviceName: string;
} = source;
let preparedStatus: "prepared" | "committed" = "committed";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => storage.get(`secure:${key}`) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { storage.set(`secure:${key}`, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { storage.delete(`secure:${key}`); }),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/backup/local-backup", () => ({
  createSnapshot: vi.fn(async () => {
    calls.push("snapshot");
    return { currentSlot: 3 };
  }),
}));
vi.mock("@/lib/cf-sync/switch-diagnostics", () => ({
  appendGroupSwitchDiagnostic: vi.fn(async ({ event }: { event: string }) => calls.push(`log:${event}`)),
}));
vi.mock("@/lib/sync/engine", () => ({
  beginGroupSwitchWriteBarrier: vi.fn(async () => { calls.push("barrier"); return 41; }),
  cancelPreparedGroupSwitch: vi.fn(() => calls.push("release-source")),
  completeGroupSwitchWriteBarrier: vi.fn(() => calls.push("complete-barrier")),
  hydrateTargetGroupSnapshot: vi.fn(async () => calls.push("hydrate-target")),
  retainGroupSwitchRecoveryBarrier: vi.fn(async () => calls.push("retain-barrier")),
  triggerStoreReload: vi.fn(() => calls.push("reload-stores")),
}));
vi.mock("@/lib/cf-sync/client", () => ({
  getDeviceInfo: vi.fn(async () => currentMember),
  prepareGroupSwitch: vi.fn(async () => {
    calls.push("prepare");
    return { switchId: "switch-a-b", recoveryTicket: "ticket-" + "x".repeat(32), target: { groupId: "group-b", role: "collaborator", expiresAt: 1 } };
  }),
  commitGroupSwitch: vi.fn(async () => {
    calls.push("commit");
    if (preparedStatus === "prepared") return { state: "prepared" as const };
    return { state: "committed" as const, membership: target };
  }),
  getGroupSwitchStatus: vi.fn(async () => {
    calls.push("status");
    return preparedStatus === "prepared" ? { state: "prepared" as const } : { state: "committed" as const, membership: target };
  }),
  cancelPreparedGroupSwitch: vi.fn(async () => calls.push("cancel-server")),
  pullCompleteTargetSnapshot: vi.fn(async () => {
    calls.push("pull-target-snapshot");
    return { groupId: "group-b", revision: "1:1", complete: true as const, presentKeys: ["cocktail.recipes"], entries: [{ storageKey: "cocktail.recipes", value: "B", clientUpdatedAt: 2 }] };
  }),
  saveDeviceInfo: vi.fn(async (member: typeof currentMember) => { calls.push("save-target-membership"); currentMember = member; }),
}));

import {
  recoverPendingGroupSwitch,
  switchToAnotherGroup,
  type GroupSwitchRuntime,
} from "@/lib/cf-sync/group-switch";

function runtime(): GroupSwitchRuntime {
  return {
    stopSourceRealtime: () => calls.push("stop-source-realtime"),
    setActiveMembership: () => calls.push("set-target-membership"),
    syncTargetPhotosReadOnly: async () => { calls.push("download-target-photos"); },
    createTargetPush: () => async () => undefined,
  };
}

describe("同步组切换状态机", () => {
  beforeEach(() => {
    storage.clear();
    calls.length = 0;
    currentMember = source;
    preparedStatus = "committed";
    vi.clearAllMocks();
  });

  it("正常切换严格先建快照、再屏障、后提交，并只水合B组快照", async () => {
    await switchToAnotherGroup({ code: "123456", switchId: "switch-a-b" }, runtime());

    expect(calls).toEqual(expect.arrayContaining([
      "snapshot", "prepare", "barrier", "stop-source-realtime", "commit",
      "save-target-membership", "set-target-membership", "pull-target-snapshot",
      "hydrate-target", "reload-stores", "download-target-photos", "complete-barrier",
    ]));
    expect(calls.indexOf("snapshot")).toBeLessThan(calls.indexOf("prepare"));
    expect(calls.indexOf("prepare")).toBeLessThan(calls.indexOf("barrier"));
    expect(calls.indexOf("barrier")).toBeLessThan(calls.indexOf("commit"));
    expect(calls.indexOf("commit")).toBeLessThan(calls.indexOf("pull-target-snapshot"));
    expect(storage.get("cf.sync.groupSwitchSession.v1")).toBeUndefined();
  });

  it("提交后目标快照失败时持续保留写入屏障和恢复会话，绝不恢复A组推送", async () => {
    const client = await import("@/lib/cf-sync/client");
    vi.mocked(client.pullCompleteTargetSnapshot).mockRejectedValueOnce(new Error("NETWORK_OFFLINE"));

    await expect(switchToAnotherGroup({ code: "123456", switchId: "switch-a-b" }, runtime()))
      .rejects.toThrow("NETWORK_OFFLINE");

    expect(calls).toContain("retain-barrier");
    expect(calls).not.toContain("release-source");
    expect(storage.get("cf.sync.groupSwitchSession.v1")).toContain('"mode":"error"');
  });

  it("冷启动发现提交前中断时撤销服务端准备、释放屏障并恢复A组，不会水合B组", async () => {
    preparedStatus = "prepared";
    storage.set("cf.sync.groupSwitchSession.v1", JSON.stringify({
      version: 1,
      switchId: "switch-a-b",
      mode: "prepared",
      source: { deviceId: "device-a", groupId: "group-a", deviceName: "A owner" },
      targetGroupId: "group-b",
      localSnapshotSlot: 2,
      writeEpoch: 1,
      createdAt: 1,
    }));
    storage.set("secure:cf.sync.groupSwitchTicket.switch-a-b", "ticket-" + "x".repeat(32));

    await expect(recoverPendingGroupSwitch(runtime())).resolves.toBe("source-resumed");

    expect(calls).toEqual(expect.arrayContaining(["barrier", "status", "cancel-server", "release-source"]));
    expect(calls).not.toContain("hydrate-target");
    expect(storage.get("cf.sync.groupSwitchSession.v1")).toBeUndefined();
  });
});

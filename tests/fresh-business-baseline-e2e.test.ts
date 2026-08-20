import { describe, expect, it, vi } from "vitest";
import {
  createFreshBaselineKeyPlan,
  createFreshBusinessBaseline,
  type FreshBusinessBaselineRuntime,
} from "@/lib/data/fresh-business-baseline";

describe("fresh business baseline", () => {
  it("只计划删除业务键与同步运行时键，保留备份和非业务运行时数据", () => {
    const plan = createFreshBaselineKeyPlan([
      "cocktail.recipes",
      "labor_payslips_v1",
      "glassware.inventory.v1",
      "monthly_report.raw_excel_archive.v1",
      "sync.ts.cocktail.recipes",
      "sync.lastPulledAt",
      "backup.snapshot.0",
      "backup.meta",
      "manus-runtime-user-info",
      "unrelated.runtime.cache",
    ]);

    expect(plan.businessKeys).toEqual([
      "cocktail.recipes",
      "glassware.inventory.v1",
      "labor_payslips_v1",
      "monthly_report.raw_excel_archive.v1",
    ]);
    expect(plan.syncRuntimeKeys).toEqual([
      "sync.lastPulledAt",
      "sync.ts.cocktail.recipes",
    ]);
    expect(plan.allKeysToRemove).not.toContain("backup.snapshot.0");
    expect(plan.allKeysToRemove).not.toContain("backup.meta");
    expect(plan.allKeysToRemove).not.toContain("manus-runtime-user-info");
    expect(plan.allKeysToRemove).not.toContain("unrelated.runtime.cache");
  });

  it("先验证备份并退出旧组，再删除本地业务数据，最后创建并同步新的空组", async () => {
    const calls: string[] = [];
    const removeStorageKeys = vi.fn(async (keys: readonly string[]) => {
      calls.push(`remove:${keys.join(",")}`);
    });
    const runtime: FreshBusinessBaselineRuntime = {
      getAllStorageKeys: async () => ["cocktail.recipes", "sync.ts.cocktail.recipes", "backup.snapshot.0"],
      createVerifiedBackup: async (keys) => {
        calls.push(`backup:${keys.join(",")}`);
        return { slot: 3, keyCount: 1 };
      },
      leaveOldGroup: async () => {
        calls.push("leave:legacy-group");
        return "legacy-group";
      },
      clearLocalSyncIdentity: async () => { calls.push("clear-identity"); },
      removeStorageKeys,
      removeBusinessFiles: async () => { calls.push("remove-files"); },
      createEmptyGroup: async () => {
        calls.push("create:new-empty-group");
        return { groupId: "new-empty-group" };
      },
      writeAudit: async (result) => { calls.push(`audit:${result.newGroupId}`); },
      startEmptyGroupSync: async () => { calls.push("sync:new-empty-group"); },
    };

    const result = await createFreshBusinessBaseline(runtime, "Current device");

    expect(result).toMatchObject({
      previousGroupId: "legacy-group",
      newGroupId: "new-empty-group",
      backup: { slot: 3, keyCount: 1 },
    });
    expect(calls).toEqual([
      "backup:cocktail.recipes",
      "leave:legacy-group",
      "clear-identity",
      "remove:cocktail.recipes,sync.ts.cocktail.recipes",
      "remove-files",
      "create:new-empty-group",
      "audit:new-empty-group",
      "sync:new-empty-group",
    ]);
    expect(calls.indexOf("sync:new-empty-group")).toBeGreaterThan(calls.indexOf("create:new-empty-group"));
  });

  it("备份验证失败时绝不退出旧组、清空本机或创建新组", async () => {
    const leaveOldGroup = vi.fn();
    const removeStorageKeys = vi.fn();
    const createEmptyGroup = vi.fn();
    const runtime: FreshBusinessBaselineRuntime = {
      getAllStorageKeys: async () => ["cocktail.recipes"],
      createVerifiedBackup: async () => { throw new Error("SNAPSHOT_VERIFICATION_FAILED"); },
      leaveOldGroup,
      clearLocalSyncIdentity: vi.fn(),
      removeStorageKeys,
      removeBusinessFiles: vi.fn(),
      createEmptyGroup,
      writeAudit: vi.fn(),
      startEmptyGroupSync: vi.fn(),
    };

    await expect(createFreshBusinessBaseline(runtime)).rejects.toThrow("SNAPSHOT_VERIFICATION_FAILED");
    expect(leaveOldGroup).not.toHaveBeenCalled();
    expect(removeStorageKeys).not.toHaveBeenCalled();
    expect(createEmptyGroup).not.toHaveBeenCalled();
  });

  it("旧组退出失败时保留本机业务数据，不进入清理或新组创建", async () => {
    const clearLocalSyncIdentity = vi.fn();
    const removeStorageKeys = vi.fn();
    const createEmptyGroup = vi.fn();
    const runtime: FreshBusinessBaselineRuntime = {
      getAllStorageKeys: async () => ["cocktail.recipes"],
      createVerifiedBackup: async () => ({ slot: 1, keyCount: 1 }),
      leaveOldGroup: async () => { throw new Error("DEVICE_LEAVE_FAILED_503"); },
      clearLocalSyncIdentity,
      removeStorageKeys,
      removeBusinessFiles: vi.fn(),
      createEmptyGroup,
      writeAudit: vi.fn(),
      startEmptyGroupSync: vi.fn(),
    };

    await expect(createFreshBusinessBaseline(runtime)).rejects.toThrow("DEVICE_LEAVE_FAILED_503");
    expect(clearLocalSyncIdentity).not.toHaveBeenCalled();
    expect(removeStorageKeys).not.toHaveBeenCalled();
    expect(createEmptyGroup).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { can, type DeviceSessionState } from "../lib/sync/device-session";
import { reducePayrollReconciliationState } from "../lib/labor/payroll-reconciliation-state";

const panel = fs.readFileSync(path.resolve(__dirname, "../components/labor/PayrollReconciliationPanel.tsx"), "utf8");

describe("薪资核对与修正面板：弱网与长列表交互", () => {
  it("弱网缓存只允许核对，禁止薪资修改；在线核验恢复后自动重新获得编辑能力", () => {
    const offline: Extract<DeviceSessionState, { tag: "offline_cache" }> = {
      tag: "offline_cache",
      retryAt: Date.now() + 30_000,
      session: {
        schemaVersion: 2,
        device: { id: "device-1", name: "iPhone", platform: "ios" },
        membership: { groupId: "group-1", status: "active", role: "owner", ownerDeviceId: "device-1", lastVerifiedAt: Date.now() },
        policy: { revision: 3, issuedAt: Date.now(), tabs: ["store"], capabilities: ["payroll.view", "payroll.edit"] },
        sync: { freshness: "offline_cache", serverTime: Date.now(), latestGroupChangeAt: 0 },
      },
    };
    expect(can(offline, "payroll.edit")).toMatchObject({ allowed: false, reason: "offline" });

    const online: Extract<DeviceSessionState, { tag: "authorized" }> = { tag: "authorized", session: { ...offline.session, sync: { ...offline.session.sync, freshness: "verified_online" } } };
    expect(can(online, "payroll.edit")).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("面板在修正执行中锁定关闭和重复提交，失败后允许安全重试", () => {
    const inspecting = reducePayrollReconciliationState({ tag: "closed" }, { type: "OPEN" });
    const pending = reducePayrollReconciliationState(inspecting, { type: "REBUILD_DRAFT" });
    expect(reducePayrollReconciliationState(pending, { type: "OPEN_ADJUSTMENT" })).toEqual(pending);
    expect(reducePayrollReconciliationState(pending, { type: "CLOSE" })).toEqual(pending);
    expect(reducePayrollReconciliationState(pending, { type: "FAIL", message: "网络暂不可用" })).toEqual({ tag: "failed", message: "网络暂不可用" });
  });

  it("使用 FlatList 虚拟化长员工列表，并保留固定底部操作区与安全窗口参数", () => {
    expect(panel).toContain("<FlatList");
    expect(panel).toContain("initialNumToRender={8}");
    expect(panel).toContain("maxToRenderPerBatch={10}");
    expect(panel).toContain("windowSize={5}");
    expect(panel).toContain("removeClippedSubviews");
    expect(panel).toContain("<View style={[S.actions");
  });

  it("在离线、策略核验和成员失效时禁用修正，并通过文字而非仅颜色说明原因", () => {
    expect(panel).toContain('const payrollEditAccess = useCan("payroll.edit")');
    expect(panel).toContain("accessMessage(payrollEditAccess.reason)");
    expect(panel).toContain("disabled={!actionable}");
    expect(panel).toContain("网络恢复并完成会话核验后");
    expect(panel).toContain("当前设备成员资格已失效");
  });
});

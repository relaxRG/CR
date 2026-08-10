/**
 * Suite L：数据一致性检查与清洗容错测试
 * 验证 checkPettyLaborIntegrity 和 repairPettyLaborData 在极端异常数据下的表现
 */
import { describe, it, expect } from "vitest";
import { checkPettyLaborIntegrity, repairPettyLaborData } from "../lib/labor/data-integrity-check";
import type { PaySlip } from "../lib/labor/types";

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

function makeSlip(overrides: Partial<PaySlip> = {}): PaySlip {
  return {
    id: "slip-" + Math.random().toString(36).slice(2, 8),
    employeeId: "emp-001",
    month: "2026-07",
    attendanceSalary: 8000,
    grossSalary: 8000,
    finalSalary: 8000,
    advanceAmount: 0,
    pettyLaborPaid: 0,
    pettyLaborLinkIds: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PaySlip;
}

function makeLink(id: string, amount: number, employeeId = "emp-001") {
  return { id, amount, employeeId, month: "2026-07" };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite L：数据一致性检查与清洗容错", () => {

  describe("L1. checkPettyLaborIntegrity 正常场景", () => {
    it("无 pettyLaborPaid 的 slip 不检查", () => {
      const slips = [makeSlip({ pettyLaborPaid: 0, pettyLaborLinkIds: [] })];
      const result = checkPettyLaborIntegrity(slips, []);
      expect(result.totalSlipsChecked).toBe(0);
      expect(result.issuesFound).toBe(0);
    });

    it("数据一致时无问题", () => {
      const links = [makeLink("link-1", 5000), makeLink("link-2", 1000)];
      const slips = [makeSlip({ pettyLaborPaid: 6000, pettyLaborLinkIds: ["link-1", "link-2"] })];
      const result = checkPettyLaborIntegrity(slips, links);
      expect(result.issuesFound).toBe(0);
    });
  });

  describe("L2. checkPettyLaborIntegrity 异常场景", () => {
    it("检测孤立 linkId（link 已删除）", () => {
      const links = [makeLink("link-1", 5000)]; // link-2 已删除
      const slips = [makeSlip({ pettyLaborPaid: 6000, pettyLaborLinkIds: ["link-1", "link-2"] })];
      const result = checkPettyLaborIntegrity(slips, links);
      expect(result.issuesFound).toBe(1);
      expect(result.issues[0].type).toBe("orphan_link_ids");
      expect(result.issues[0].currentValue).toBe(6000);
      expect(result.issues[0].expectedValue).toBe(5000);
    });

    it("检测金额不一致", () => {
      const links = [makeLink("link-1", 5000), makeLink("link-2", 1000)];
      const slips = [makeSlip({ pettyLaborPaid: 7000, pettyLaborLinkIds: ["link-1", "link-2"] })]; // 应为 6000
      const result = checkPettyLaborIntegrity(slips, links);
      expect(result.issuesFound).toBe(1);
      expect(result.issues[0].type).toBe("amount_mismatch");
      expect(result.issues[0].expectedValue).toBe(6000);
    });

    it("检测有金额但无 linkIds（旧版数据）", () => {
      const slips = [makeSlip({ pettyLaborPaid: 3000, pettyLaborLinkIds: [] })];
      const result = checkPettyLaborIntegrity(slips, []);
      expect(result.issuesFound).toBe(1);
      expect(result.issues[0].type).toBe("missing_link_ids");
    });
  });

  describe("L3. 极端异常数据容错", () => {
    it("空数组输入", () => {
      const result = checkPettyLaborIntegrity([], []);
      expect(result.totalSlipsChecked).toBe(0);
      expect(result.issuesFound).toBe(0);
    });

    it("pettyLaborPaid 为 NaN", () => {
      const slips = [makeSlip({ pettyLaborPaid: NaN, pettyLaborLinkIds: ["link-1"] })];
      const links = [makeLink("link-1", 1000)];
      // NaN > 0 = false，所以不会被检查
      const result = checkPettyLaborIntegrity(slips, links);
      expect(result.totalSlipsChecked).toBeLessThanOrEqual(1);
    });

    it("pettyLaborPaid 为负数", () => {
      const slips = [makeSlip({ pettyLaborPaid: -100, pettyLaborLinkIds: [] })];
      const result = checkPettyLaborIntegrity(slips, []);
      // -100 > 0 = false, linkIds.length = 0, 不会被检查
      expect(result.totalSlipsChecked).toBe(0);
    });

    it("pettyLaborLinkIds 为 undefined", () => {
      const slips = [makeSlip({ pettyLaborPaid: 5000, pettyLaborLinkIds: undefined as any })];
      const result = checkPettyLaborIntegrity(slips, []);
      expect(result.issuesFound).toBe(1);
      expect(result.issues[0].type).toBe("missing_link_ids");
    });

    it("大量 slip（100条）性能不退化", () => {
      const links = Array.from({ length: 50 }, (_, i) => makeLink(`link-${i}`, 100));
      const slips = Array.from({ length: 100 }, (_, i) => makeSlip({
        id: `slip-${i}`,
        pettyLaborPaid: 200,
        pettyLaborLinkIds: [`link-${i % 50}`, `link-${(i + 1) % 50}`],
      }));
      const start = Date.now();
      const result = checkPettyLaborIntegrity(slips, links);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // < 100ms
      expect(result.totalSlipsChecked).toBe(100);
    });

    it("linkId 重复引用（同一 link 被多个 slip 引用）", () => {
      const links = [makeLink("link-shared", 5000)];
      const slips = [
        makeSlip({ id: "s1", pettyLaborPaid: 5000, pettyLaborLinkIds: ["link-shared"] }),
        makeSlip({ id: "s2", pettyLaborPaid: 5000, pettyLaborLinkIds: ["link-shared"] }),
      ];
      const result = checkPettyLaborIntegrity(slips, links);
      // 每个 slip 独立检查，link-shared 存在所以两个都通过
      expect(result.issuesFound).toBe(0);
    });
  });

  describe("L4. repairPettyLaborData 修复逻辑", () => {
    it("修复孤立 linkId", () => {
      const links = [makeLink("link-1", 5000)]; // link-2 已删除
      const slips = [makeSlip({
        pettyLaborPaid: 6000,
        pettyLaborLinkIds: ["link-1", "link-2"],
        finalSalary: 2000, // grossSalary(8000) - pettyLaborPaid(6000)
      })];
      const repaired = repairPettyLaborData(slips, links);
      expect(repaired).toHaveLength(1);
      expect(repaired[0].pettyLaborPaid).toBe(5000);
      expect(repaired[0].pettyLaborLinkIds).toEqual(["link-1"]);
      expect(repaired[0].finalSalary).toBe(3000); // 2000 + (6000-5000)
    });

    it("修复金额不一致", () => {
      const links = [makeLink("link-1", 3000)];
      const slips = [makeSlip({
        pettyLaborPaid: 5000, // 应为 3000
        pettyLaborLinkIds: ["link-1"],
        finalSalary: 3000,
      })];
      const repaired = repairPettyLaborData(slips, links);
      expect(repaired).toHaveLength(1);
      expect(repaired[0].pettyLaborPaid).toBe(3000);
      expect(repaired[0].finalSalary).toBe(5000); // 3000 + (5000-3000)
    });

    it("无问题时不返回修复结果", () => {
      const links = [makeLink("link-1", 5000)];
      const slips = [makeSlip({ pettyLaborPaid: 5000, pettyLaborLinkIds: ["link-1"] })];
      const repaired = repairPettyLaborData(slips, links);
      expect(repaired).toHaveLength(0);
    });

    it("空输入不崩溃", () => {
      expect(repairPettyLaborData([], [])).toHaveLength(0);
    });

    it("所有 linkId 都孤立时 pettyLaborPaid 归零", () => {
      const slips = [makeSlip({
        pettyLaborPaid: 8000,
        pettyLaborLinkIds: ["gone-1", "gone-2"],
        finalSalary: 0,
      })];
      const repaired = repairPettyLaborData(slips, []);
      expect(repaired[0].pettyLaborPaid).toBe(0);
      expect(repaired[0].pettyLaborLinkIds).toEqual([]);
      expect(repaired[0].finalSalary).toBe(8000); // 0 + (8000-0)
    });
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createMonthCloseOperationGate } from "../lib/labor/month-close-operation-gate";

describe("所选月草稿薪资强制重算并发保护", () => {
  it("同月两个并发重算请求只允许一个进入，完成后才可再次执行", async () => {
    const gate = createMonthCloseOperationGate();
    const starts: string[] = [];
    const run = async (name: string) => {
      if (!gate.tryAcquire("2026-08")) return "PAYROLL_MONTH_RECALCULATION_IN_PROGRESS";
      starts.push(name);
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "OK";
      } finally {
        gate.release("2026-08");
      }
    };

    const [first, second] = await Promise.all([run("first"), run("second")]);
    expect([first, second].filter((result) => result === "OK")).toHaveLength(1);
    expect([first, second]).toContain("PAYROLL_MONTH_RECALCULATION_IN_PROGRESS");
    expect(starts).toHaveLength(1);
    expect(gate.tryAcquire("2026-08")).toBe(true);
    gate.release("2026-08");
  });

  it("不同月份不互相阻塞，避免八月重算误影响七月草稿", () => {
    const gate = createMonthCloseOperationGate();
    expect(gate.tryAcquire("2026-07")).toBe(true);
    expect(gate.tryAcquire("2026-08")).toBe(true);
    gate.release("2026-07");
    gate.release("2026-08");
  });

  it("页面在重算前创建快照，按月批量替换而非逐员工upsert，并只允许DRAFT执行", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/labor/LaborWorkspaceScreen.tsx"), "utf8");
    expect(source).toContain('getRosterMonthStatus(month) !== "draft"');
    expect(source).toContain("createSnapshot()");
    expect(source).toContain("replaceMonthPaySlips(month, nextMonthSlips)");
    expect(source).not.toContain("PAYROLL_MONTH_RECALCULATION_IN_PROGRESS");
    expect(source).toContain('accessibilityLabel={`重新计算所选月 ${month} 草稿薪资`}');
    expect(source).toContain('accessibilityHint="仅重建所选月草稿薪资，不修改其他月份或已确认发薪数据"');
  });
});

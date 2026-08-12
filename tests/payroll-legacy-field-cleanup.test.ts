import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const storeSource = fs.readFileSync(path.resolve(process.cwd(), "lib/labor/store.tsx"), "utf8");
const typeSource = fs.readFileSync(path.resolve(process.cwd(), "lib/labor/types.ts"), "utf8");

describe("薪资旧字段物理清理", () => {
  it("加载本地薪资单时必须删除废弃字段，阻止旧草稿回流", () => {
    expect(storeSource).toContain('"performanceBonus"');
    expect(storeSource).toContain('"salesCommission"');
    expect(storeSource).toContain("for (const key of legacyKeys) delete next[key]");
  });

  it("薪资单类型不再声明旧聚合金额或重复业绩字段", () => {
    const paySlipSection = typeSource.slice(typeSource.indexOf("export interface PaySlip"), typeSource.indexOf("export interface MonthlyAttendance"));
    expect(paySlipSection).not.toContain("performanceBonus:");
    expect(paySlipSection).not.toContain("salesCommission:");
  });
});

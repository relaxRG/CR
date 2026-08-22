import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "lib/labor/store.tsx"), "utf8");

describe("员工归档恢复状态", () => {
  it("恢复归档员工时同时清除归档状态、恢复在职状态并更新时间", () => {
    const restoreBlock = source.slice(source.indexOf("const restoreEmployee"), source.indexOf("const reorderEmployees"));
    expect(restoreBlock).toContain("archived: false");
    expect(restoreBlock).toContain("archivedAt: undefined");
    expect(restoreBlock).toContain("active: true");
    expect(restoreBlock).toContain("updatedAt: Date.now()");
  });

  it("永久删除档案仍不删除历史排班和薪资数据，归档恢复是唯一的在职恢复路径", () => {
    expect(source).toContain("/** 删除员工档案（不删除历史排班/薪资数据） */");
    expect(source).toContain("/** 恢复归档员工为在职 */");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeMonthlyReportMonth } from "@/lib/store/monthly-report/rebuild-dish-categories";
import {
  appendRawExcelArchiveEntries,
  formatArchiveMonthLabel,
  getArchiveEntryId,
  getNextRawExcelRevision,
  getRawExcelExportFilename,
  groupRawExcelArchiveEntries,
  normalizeRawExcelArchiveEntries,
  RawExcelArchiveEntry,
} from "@/lib/store/monthly-report/raw-excel-archive";

function entry(overrides: Partial<RawExcelArchiveEntry> = {}): RawExcelArchiveEntry {
  return {
    id: "2026-07:overview:1",
    month: "2026-07",
    monthLabel: "2026年7月",
    fileType: "overview",
    revision: 1,
    filename: "营业概览-原始导出.xlsx",
    uri: "file:///documents/monthly-report-raw-excel-v1/2026-07/overview/1.xlsx",
    sizeBytes: 1024,
    archivedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("月报原始 Excel 归档规则", () => {
  it("用业务月份、报表类型和导入序号生成稳定标识，避免历史文件被覆盖", () => {
    expect(getArchiveEntryId("2026-07", "dish_by_category", 2)).toBe("2026-07:dish_by_category:2");
  });

  it("将导出文件重命名为月份加中文报表分类，历史版本附带导入序号并保留扩展名", () => {
    expect(getRawExcelExportFilename(entry())).toBe("2026年7月_营业概览.xlsx");
    expect(getRawExcelExportFilename(entry({
      revision: 2,
      fileType: "revenue_statement",
      filename: "营业收入.xls",
    }))).toBe("2026年7月_营业收入与收款统计_第2次导入.xls");
  });

  it("按月份从新到旧分组，并在每个月内保留各报表分类及历史版本", () => {
    const groups = groupRawExcelArchiveEntries([
      entry({ id: "2026-06:overview:1", month: "2026-06", monthLabel: "2026年6月" }),
      entry({ id: "2026-07:overview:2", revision: 2, archivedAt: "2026-08-19T00:00:00.000Z" }),
      entry({ id: "2026-07:revenue_statement:1", fileType: "revenue_statement" }),
      entry(),
    ]);

    expect(groups.map((group) => group.month)).toEqual(["2026-07", "2026-06"]);
    expect(groups[0].files.map((file) => file.id)).toEqual([
      "2026-07:overview:2",
      "2026-07:overview:1",
      "2026-07:revenue_statement:1",
    ]);
  });

  it("重新确认导入会为同月同类型追加版本，不会删除任何旧文件或其他分类", () => {
    const existing = [
      entry({ archivedAt: "2026-07-01T00:00:00.000Z" }),
      entry({ id: "2026-07:dish_by_name:1", fileType: "dish_by_name" }),
      entry({ id: "2026-06:overview:1", month: "2026-06", monthLabel: "2026年6月" }),
    ];
    const revision = getNextRawExcelRevision(existing, "2026-07", "overview");
    const newImport = entry({
      id: getArchiveEntryId("2026-07", "overview", revision),
      revision,
      filename: "重新导出的营业概览.xlsx",
      uri: "file:///documents/monthly-report-raw-excel-v1/2026-07/overview/2.xlsx",
      archivedAt: "2026-08-18T00:00:00.000Z",
    });

    const next = appendRawExcelArchiveEntries(existing, [newImport]);
    expect(next).toHaveLength(4);
    expect(next.filter((file) => file.month === "2026-07" && file.fileType === "overview"))
      .toEqual([expect.objectContaining({ revision: 2 }), expect.objectContaining({ revision: 1 })]);
    expect(next.find((file) => file.id === "2026-07:dish_by_name:1")).toBeDefined();
    expect(next.find((file) => file.id === "2026-06:overview:1")).toBeDefined();
  });

  it("升级旧版索引时为未带导入序号的条目补齐序号，确保历史文件仍可访问", () => {
    const old = entry({ id: "2026-07:overview", revision: undefined as unknown as number });
    const normalized = normalizeRawExcelArchiveEntries([old]);
    expect(normalized[0]).toMatchObject({ id: "2026-07:overview", revision: 1 });
  });

  it("将同一业务月份的斜杠与连字符格式归一，避免归档目录和分析校验串月", () => {
    expect(normalizeMonthlyReportMonth("2026/07")).toBe("2026-07");
    expect(normalizeMonthlyReportMonth("2026-7")).toBe("2026-07");
    expect(formatArchiveMonthLabel(normalizeMonthlyReportMonth("2026/07"))).toBe("2026年7月");
  });

  it("非法月份不会伪造中文日期标签或归档月份", () => {
    expect(normalizeMonthlyReportMonth("2026-13")).toBe("");
    expect(formatArchiveMonthLabel("2026-13")).toBe("2026-13");
  });
});

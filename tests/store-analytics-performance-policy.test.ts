import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = () => readFileSync(join(process.cwd(), "components/store/analytics.tsx"), "utf8");

describe("门店经营分析性能护栏", () => {
  it("当前期与对比期在一次记录遍历中汇总，避免每次月份切换重复 filter 与中间数组分配", () => {
    const analytics = source();
    expect(analytics).toContain("const { cur, prev } = useMemo");
    expect(analytics).toContain("useStoreReportReadModel");
    expect(analytics).toContain("reportReadModel.analyticsByDate.forEach((daily) => {");
    expect(analytics).toContain('if (compare === "prev" && inRange(date, previousRange))');
    expect(analytics).not.toContain("const calcSummary =");
    expect(analytics).not.toContain("useRevenueStore");
    expect(analytics).not.toContain("usePettyCashStore");
    expect(analytics).not.toContain("records.filter((r)");
    expect(analytics).not.toContain("pettyRecords.filter((r)");
  });
});

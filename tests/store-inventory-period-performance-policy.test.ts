import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("门店库存与时段分析性能护栏", () => {
  it("库存入口只向当前分类工作台传递分类与月份，隔离其他分类异步更新的无效重渲染", () => {
    const inventory = source("components/store/inventory.tsx");
    expect(inventory).toContain("const MemoizedInventoryBusinessPanel = React.memo(InventoryBusinessPanel)");
    expect(inventory).toContain("<MemoizedInventoryBusinessPanel category={currentCategory.key} month={selectedMonth} />");
  });

  it("烈酒采购台账对万级数据按 32 行日期块虚拟化，并使用固定窗口参数", () => {
    const spirits = source("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");
    expect(spirits).toContain("const purchaseVirtualGroups = useMemo");
    expect(spirits).toContain("start += 32");
    expect(spirits).toContain("initialNumToRender={4}");
    expect(spirits).toContain("maxToRenderPerBatch={3}");
    expect(spirits).toContain("windowSize={5}");
  });

  it("时段分析先以日期索引 dailyRecords，再按排班直接读取，避免每个班次线性查找当天记录", () => {
    const periods = source("app/period-analysis.tsx");
    expect(periods).toContain("const dailyRecordByDate = useMemo");
    expect(periods).toContain("dailyRecordByDate.get(shift.date)");
    expect(periods).not.toContain("report.dailyRecords.find((dr) => dr.date === shift.date)");
  });
});

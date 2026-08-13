import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../app/labor.tsx"), "utf8");

describe("排班表响应式分页与网页缩放护栏", () => {
  it("不再读取模块加载时的静态窗口宽度", () => {
    expect(source).not.toContain('Dimensions.get("window")');
    expect(source).not.toContain("SCREEN_W");
  });

  it("外层三页与排班内部两页均以当前useWindowDimensions宽度作为唯一分页基准", () => {
    expect(source).toContain("const { width: winW } = useWindowDimensions();");
    expect(source).toContain("<SchedulePage colors={colors} month={currentMonth} onMonthChange={setCurrentMonth} pageWidth={winW} />");
    expect(source).toContain("const schPageWidth = pageWidth;");
    expect(source).toContain("style={{ width: schPageWidth, flexGrow: 0, flexShrink: 0 }}");
    expect(source).toContain("style={{ width: winW, flexGrow: 0, flexShrink: 0 }}");
  });

  it("外层与内层分页均在宽度变化后对齐当前页，并保存当前分页索引", () => {
    expect(source).toContain("const previousPagerWidth = useRef(winW);");
    expect(source).toContain("scrollRef.current?.scrollTo({ x: Math.max(0, pageIndex) * winW, animated: false })");
    expect(source).toContain("const previousSchedulePageWidth = useRef(schPageWidth);");
    expect(source).toContain("schedulePagerRef.current?.scrollTo({ x: schedulePagerIndex * schPageWidth, animated: false })");
    expect(source).toContain("setSchedulePagerIndex(Math.max(0, Math.min(1, Math.round(offset / schPageWidth))))");
  });

  it("排班控制栏可换行，缩放时不会为了保持单行而挤压日历网格", () => {
    expect(source).toContain('controlBar: { flexDirection: "row", flexWrap: "wrap"');
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAppPerformanceMarks,
  getAppPerformanceMarks,
  markAppPerformance,
} from "@/lib/performance/app-performance-marks";

describe("应用内性能标记", () => {
  beforeEach(() => {
    clearAppPerformanceMarks();
  });

  it("以单调相对时间记录关键启动与功能域事件，不写入持久化存储", () => {
    const first = markAppPerformance("root.runtime_ready");
    const second = markAppPerformance("feature_boundary.mounted", "path=/store;boundary=store");
    const marks = getAppPerformanceMarks();

    expect(first.atMs).toBeGreaterThanOrEqual(0);
    expect(second.atMs).toBeGreaterThanOrEqual(first.atMs);
    expect(marks).toEqual([
      expect.objectContaining({ name: "root.runtime_ready" }),
      expect.objectContaining({ name: "feature_boundary.mounted", detail: "path=/store;boundary=store" }),
    ]);
  });

  it("限制内存中标记数量，防止长时间使用时观测记录自身形成泄漏", () => {
    for (let index = 0; index < 100; index += 1) markAppPerformance(`sample.${index}`);
    const marks = getAppPerformanceMarks();

    expect(marks).toHaveLength(80);
    expect(marks[0]?.name).toBe("sample.20");
    expect(marks.at(-1)?.name).toBe("sample.99");
  });
});

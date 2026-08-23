import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("iOS 真机性能 CI 协议", () => {
  it("以至少五次独立采样和 P95 比较启动、滚动与图片内存指标", () => {
    const checker = read("scripts/ci/assert-ios-performance.mjs");
    expect(checker).toContain("samples.length < 5");
    expect(checker).toContain("percentile(values, 0.95)");
    expect(checker).toContain('"scrollFrameP95Ms"');
    expect(checker).toContain('"photoUploadPeakMemoryMB"');
    expect(checker).toContain("regressionAllowance");
  });

  it("使用独立性能 scheme 与 xcresult，且不读取业务数据", () => {
    const runner = read("scripts/ci/run-ios-performance.sh");
    expect(runner).toContain("-only-testing:CocktailRPerformanceTests");
    expect(runner).toContain("IOS_METRICS_NORMALIZER");
    expect(runner).toContain('"$IOS_METRICS_NORMALIZER" "$RESULT_BUNDLE" "$METRICS_JSON"');
    expect(runner).toContain("PERFORMANCE_BASELINE");
    expect(runner).toContain("无业务数据测试账户");
  });
});

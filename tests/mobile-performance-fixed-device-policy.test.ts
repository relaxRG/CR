import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("固定真机性能基线策略", () => {
  it("iOS 与 Android 脚本均区分 capture 和 compare，且 capture 只通过完整样本捕获器生成基线", () => {
    const ios = read("scripts/ci/run-ios-performance.sh");
    const android = read("scripts/ci/run-android-low-end-performance.sh");

    for (const script of [ios, android]) {
      expect(script).toContain('PERFORMANCE_MODE="${PERFORMANCE_MODE:-compare}"');
      expect(script).toContain('"$PERFORMANCE_MODE" == "capture"');
      expect(script).toContain("capture-mobile-performance-baseline.mjs");
    }
    expect(android).toContain("LOW_END_DEVICE_SERIAL");
    expect(android).toContain("LOW_END_DEVICE_MODEL");
  });

  it("手动性能工作流只在带固定平台标签的自托管设备运行器执行，并上传候选与诊断工件", () => {
    const workflow = read(".github/workflows/mobile-performance-baseline.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: [self-hosted, cocktail-r, ios, performance]");
    expect(workflow).toContain("runs-on: [self-hosted, cocktail-r, android, performance]");
    expect(workflow).toContain("PERFORMANCE_MODE: ${{ inputs.mode }}");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("artifacts/android-low-end");
    expect(workflow).toContain("artifacts/ios-performance-candidate.json");
  });
});

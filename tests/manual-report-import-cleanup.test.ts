import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const platformName = ["mei", "tuan"].join("");
const retiredPaths = [
  join(root, "lib", "integrations", platformName),
  join(root, "scripts", `h5-${platformName}-single-store-import-e2e.mjs`),
];

describe("手动月度报表导入回退清理", () => {
  it("仅保留通用手动文件选择与解析入口", () => {
    const source = readFileSync(join(root, "app", "monthly-report-import.tsx"), "utf8");

    expect(source).toContain("handlePickFiles");
    expect(source).toContain("handleParse");
    expect(source).toContain('testID="monthly-report-pick-files"');
    expect(source).toContain('testID="monthly-report-parse-files"');
    expect(source).not.toContain(`${platformName}-single-store-import`);
    expect(source).not.toContain(`handlePick${platformName[0].toUpperCase()}${platformName.slice(1)}File`);
  });

  it("解析与确认导入均使用单飞门闩，且只在确认后写入业务 Store", () => {
    const source = readFileSync(join(root, "app", "monthly-report-import.tsx"), "utf8");

    expect(source).toContain("createSingleFlightGate");
    expect(source).toContain("pickGateRef.current.tryAcquire()");
    expect(source).toContain("pickGateRef.current.release()");
    expect(source).toContain("parseGateRef.current.tryAcquire()");
    expect(source).toContain("confirmGateRef.current.tryAcquire()");
    expect(source).toContain("parseGateRef.current.release()");
    expect(source).toContain("confirmGateRef.current.release()");
    expect(source).toContain("disabled={loading} onPress={() => handleSetType(f.name, t)}");
    expect(source.indexOf("await archiveFiles(")).toBeLessThan(source.indexOf("addReport(preview)"));
    expect(source.indexOf("addReport(preview)")).toBeLessThan(source.indexOf("setShowPreview(false)"));
  });

  it("不保留已移除专用集成目录或移动端回归脚本", () => {
    retiredPaths.forEach((path) => expect(existsSync(path)).toBe(false));
  });
});

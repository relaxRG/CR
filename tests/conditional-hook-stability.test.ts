import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expectHooksBeforeNotFoundReturn(source: string, hookMarkers: string[], missingReturnMarker: string) {
  const missingReturnIndex = source.indexOf(missingReturnMarker);
  expect(missingReturnIndex).toBeGreaterThan(-1);

  for (const hookMarker of hookMarkers) {
    const hookIndex = source.indexOf(hookMarker);
    expect(hookIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeLessThan(missingReturnIndex);
  }
}

describe("异步水合期间的条件Hook稳定性", () => {
  it("绩效补贴编辑页在员工档案尚未水合时，仍先按固定顺序调用全部Hook", () => {
    const source = readSource("app/labor-kpi-allowance-edit.tsx");

    expectHooksBeforeNotFoundReturn(
      source,
      [
        "useEffect(() =>",
        "const attendanceDays = useMemo(() =>",
        "const extras = useMemo(() =>",
        "const hasChanges = useCallback(() =>",
        "const handleSave = useCallback(() =>",
        "const handleCancel = useCallback(() =>",
      ],
      'if (!employee) {\n    return (\n      <ScreenContainer>'
    );
    expect(source).toContain("if (!employee || !employeeId || !month) return;");
  });

  it("绩效补贴只读页在员工档案尚未水合时，仍先计算安全的零值预览", () => {
    const source = readSource("app/labor-kpi-allowance.tsx");

    expectHooksBeforeNotFoundReturn(
      source,
      ["const extras = useMemo(() =>"],
      'if (!employee) {\n    return (\n      <ScreenContainer>'
    );
    expect(source).toContain("if (!employee) {");
    expect(source).toContain("allowanceDetails: {}");
    expect(source).toContain("revenueKPIDetails: {}");
  });

  it("配方详情在配方加载完成前也无条件订阅冰块设置", () => {
    const source = readSource("app/recipe/[id].tsx");

    expectHooksBeforeNotFoundReturn(
      source,
      ["const { ice: iceSettings } = useIceSettings();"],
      'if (!recipe) {\n    return (\n      <ScreenContainer'
    );
  });
});

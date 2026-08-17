import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/monthly-report-import.tsx"), "utf8");

describe("美团当前门店导入页面", () => {
  it("提供两份文件选择、单店自动绑定与预览确认入口，不提供账号密码字段", () => {
    expect(source).toContain('testID="meituan-single-store-import"');
    expect(source).toContain('testID="meituan-pick-revenue"');
    expect(source).toContain('testID="meituan-pick-category"');
    expect(source).toContain('testID="meituan-parse-preview"');
    expect(source).toContain("createMeituanSingleStoreBinding");
    expect(source).toContain("buildCurrentStoreMonthlyImportPreview");
    expect(source).toContain("createMonthlyReportFromMeituanPreview");
    expect(source).not.toMatch(/password|账号密码|cookie/i);
  });

  it("将文件中的门店 ID 与已绑定门店做严格比对，并拒绝跨店或跨月文件", () => {
    expect(source).toContain("storeIds.length !== 1");
    expect(source).toContain("months.length !== 1");
    expect(source).toContain("meituanBinding.storeId !== incomingStoreId");
  });
});

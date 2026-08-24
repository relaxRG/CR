import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("旧路由与文件导入稳定性", () => {
  it("仍可被深链访问的旧酒款和配方列表路由不会回退到全量Provider边界", () => {
    const featureBoundary = source("lib/navigation/feature-boundary.ts");

    expect(featureBoundary).toContain('path.startsWith("/recipes")');
    expect(featureBoundary).toContain('path.startsWith("/bottles")');
  });

  it("设备和葡萄酒导入只接受Excel、小于10MB且阻止重复解析", () => {
    const equipment = source("app/equipment-inventory.tsx");
    const wineImport = source("app/wine-inventory-import.tsx");

    for (const page of [equipment, wineImport]) {
      expect(page).toContain('"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
      expect(page).toContain('"application/vnd.ms-excel"');
      expect(page).not.toContain('"*/*"');
      expect(page).toContain("10 * 1024 * 1024");
    }
    expect(equipment).toContain("if (importLoading) return;");
    expect(wineImport).toContain("if (loading) return;");
  });
});

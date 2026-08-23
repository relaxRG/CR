import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("路由按需加载护栏", () => {
  it("仅在员工用户主动导入或导出时加载 XLSX 业务模块", () => {
    const workspace = source("components/labor/LaborWorkspaceScreen.tsx");

    expect(workspace).toContain('import type { ExportType } from "@/lib/labor/export"');
    expect(workspace).toContain('import type { ImportResult } from "@/lib/labor/import"');
    expect(workspace).toContain('await import("@/lib/labor/export")');
    expect(workspace).toContain('await import("@/lib/labor/import")');
    expect(workspace).not.toContain('import { exportLaborData');
    expect(workspace).not.toContain('import { buildImportTemplate');
  });

  it("仅在备用金用户确认导入时加载 iCost Excel 解析模块", () => {
    const pettyCash = source("components/store/petty-cash.tsx");

    expect(pettyCash).toContain('await import("@/lib/store/icost-import")');
    expect(pettyCash).not.toContain('import { importIcostExcel }');
  });

  it("仅在选择葡萄酒工作簿后加载 XLSX 读取器", () => {
    const engine = source("lib/wine/workbook-engine.ts");
    const importer = source("app/wine-inventory-import.tsx");

    expect(engine).toContain('await import("xlsx")');
    expect(engine).not.toContain('import { utils, read as xlsxRead } from "xlsx"');
    expect(importer).toContain("await parseWineWorkbook(base64, activeMonth)");
    expect(importer).toContain('import("@/lib/wine/workbook-export")');
    expect(importer).not.toContain('import { downloadWineWorkbookTemplate }');
  });

  it("仅在选择或确认月报文件后加载营业、菜品和时段 Excel 解析器", () => {
    const importer = source("app/monthly-report-import.tsx");

    expect(importer).toContain('await import("@/lib/store/monthly-report/dish-analysis-parser")');
    expect(importer).toContain('import("@/lib/store/monthly-report/excel-parser")');
    expect(importer).toContain('import("@/lib/store/period-analysis/excel-parser")');
    expect(importer).not.toContain('import { parseMonthlyReport }');
  });

  it("保持根布局的启动维护任务为交互后动态加载，避免迁移逻辑进入首轮渲染路径", () => {
    const root = source("app/_layout.tsx");

    expect(root).toContain("InteractionManager.runAfterInteractions");
    expect(root).toContain('await import("@/lib/migrations/clean-empty-shift-entries")');
    expect(root).toContain('await import("@/lib/migrations/clean-monthly-fixed-salary")');
  });
});

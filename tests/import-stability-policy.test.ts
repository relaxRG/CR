import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("高负载导入稳定性策略", () => {
  it("时段分析导入不依赖atob，并限制并发、文件数量与单文件大小", () => {
    const periodAnalysis = source("app/period-analysis.tsx");

    expect(periodAnalysis).toContain('import { decodeBase64ToArrayBuffer } from "@/lib/utils/base64"');
    expect(periodAnalysis).not.toContain("atob(base64)");
    expect(periodAnalysis).toContain("MAX_PERIOD_IMPORT_FILES");
    expect(periodAnalysis).toContain("MAX_PERIOD_IMPORT_BYTES");
    expect(periodAnalysis).toContain("if (importing) return;");
    expect(periodAnalysis).toContain("decodeBase64ToArrayBuffer(base64)");
  });

  it("月报多文件导入限制数量和总大小，并仅在解析或归档时短暂读取Base64", () => {
    const monthlyImport = source("app/monthly-report-import.tsx");

    expect(monthlyImport).toContain("MAX_MONTHLY_IMPORT_FILES");
    expect(monthlyImport).toContain("MAX_MONTHLY_IMPORT_TOTAL_BYTES");
    expect(monthlyImport).toContain("readImportedFileBase64");
    expect(monthlyImport).toContain("const filePayloads = new Map<string, string>()");
    expect(monthlyImport).toContain("const archivePayloads = await Promise.all");
    expect(monthlyImport).not.toContain("base64?: string");
    expect(monthlyImport).not.toContain("newFiles.push({ name: asset.name, uri: asset.uri, type, base64 })");
  });

  it("批量AI识别在请求期间锁定入口，并在成功或失败后释放锁", () => {
    const bulkImport = source("app/bulk-import.tsx");

    expect(bulkImport).toContain("const [busy, setBusy] = useState(false)");
    expect(bulkImport).toContain("if (busy) return;");
    expect(bulkImport).toContain("setBusy(true);");
    expect(bulkImport).toContain("finally {\n      setBusy(false);");
    expect(bulkImport).not.toContain("const busy = false;");
  });
});

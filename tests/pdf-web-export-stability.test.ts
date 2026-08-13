import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const extractSource = readFileSync("lib/import/extract.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
};

describe("PDF H5导出稳定性", () => {
  it("不静态导入本地pdf.worker.entry，避免Metro将大型Worker交给转换子进程", () => {
    expect(extractSource).not.toMatch(/await\s+import\(\s*["']pdfjs-dist\/legacy\/build\/pdf\.worker\.entry/);
  });

  it("Web Worker地址与锁定的pdfjs-dist版本一致，防止主库和Worker协议不匹配", () => {
    const version = packageJson.dependencies["pdfjs-dist"];
    expect(version).toBe("2.16.105");
    expect(extractSource).toContain(`pdf.js/${version}/pdf.worker.min.js`);
    expect(extractSource).toContain("GlobalWorkerOptions.workerSrc");
  });
});

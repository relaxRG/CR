import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
const worker = source("workers/cocktail-ai/worker-v4.js");
const controller = source("components/store/ArchiveConflictResolutionController.tsx");
const archiveStore = source("lib/store/monthly-report/raw-excel-archive-store.tsx");
const importScreen = source("app/monthly-report-import.tsx");

describe("归档存储异常与冲突交互契约", () => {
  it("D1/R2运行时异常会清理本次上传对象并返回不泄露内部细节的503", () => {
    expect(worker).toContain("let uploadedObjectKey = null");
    expect(worker).toContain("uploadedObjectKey = objectKey");
    expect(worker).toContain("ARCHIVE_STORAGE_FAILURE");
    expect(worker).toContain("return archiveError(\"ARCHIVE_STORAGE_FAILURE\", 503, origin)");
    expect(worker).toContain("try { await env.ARCHIVES.delete(uploadedObjectKey); } catch {}");
    expect(worker).not.toContain("archiveError(\"ARCHIVE_STORAGE_FAILURE\", 500");
  });

  it("冲突容器将三种显式策略绑定到Provider，并在真实月报导入页呈现", () => {
    expect(controller).toContain("viewRemoteArchiveConflict(operationId)");
    expect(controller).toContain("reimportArchiveConflictAsNew(operationId)");
    expect(controller).toContain("discardLocalArchiveConflict(operationId)");
    expect(controller).toContain("已刷新云端权威版本。");
    expect(controller).toContain("已将本机文件作为新条目重新提交。");
    expect(controller).toContain("已放弃旧本机提交，不会修改云端版本。");
    expect(archiveStore).toContain("viewRemoteArchiveConflict");
    expect(archiveStore).toContain("reimportArchiveConflictAsNew");
    expect(archiveStore).toContain("discardLocalArchiveConflict");
    expect(importScreen).toContain("monthly-report-archive-conflict");
    expect(importScreen).toContain("ArchiveConflictResolutionController");
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "lib/sync/photo-sync.ts"), "utf8");

describe("照片同步内存峰值策略", () => {
  it("在读取 Base64 前依据文件尺寸决定是否压缩", () => {
    const fileInfoIndex = source.indexOf("const info = await FileSystem.getInfoAsync(localPath)");
    const sizeGateIndex = source.indexOf("const estimatedBase64Length = (info.size ?? 0) * 4 / 3");
    const readBase64Index = source.indexOf("await FileSystem.readAsStringAsync(localPath");

    expect(fileInfoIndex).toBeGreaterThanOrEqual(0);
    expect(sizeGateIndex).toBeGreaterThan(fileInfoIndex);
    expect(readBase64Index).toBeGreaterThan(sizeGateIndex);
    expect(source).toContain("const useCompression = estimatedBase64Length > COMPRESS_THRESHOLD");
    expect(source).toContain("? await compressToLimit(localPath)");
  });

  it("压缩路径限制最长边并保留单任务同步保护", () => {
    expect(source).toContain("const MAX_UPLOAD_EDGE = 1600");
    expect(source).toContain("[{ resize: { width: MAX_UPLOAD_EDGE } }]");
    expect(source).toContain("if (running) return");
    expect(source).toContain("running = true");
    expect(source).toContain("running = false");
  });
});

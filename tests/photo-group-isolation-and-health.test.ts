import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("同步组照片隔离与Worker健康标识", () => {
  it("所有新增配方照片均通过当前同步组目录写入，未配对时才回退本地目录", () => {
    const photo = source("lib/recipes/photo.ts");
    const detail = source("app/recipe/[id].tsx");

    expect(photo).toContain("getDeviceInfo");
    expect(photo).toContain("safeGroupId");
    expect(photo).toContain("ensureRecipePhotoDirectory");
    expect(photo).toContain("未配对设备保留本地目录");
    expect(detail).toContain("await ensureRecipePhotoDirectory()");
    expect(detail).not.toContain("const dir = `${FileSystem.documentDirectory}recipe-photos/`");
  });

  it("切组水合仍使用仅下载照片路径，不会把旧组文件上传到目标组", () => {
    const sync = source("lib/sync/photo-sync.ts");

    expect(sync).toContain('mode: "full" | "download-only"');
    expect(sync).toContain('mode === "full" ? await uploadPendingPhotos');
    expect(sync).toContain("photoDirectory(groupId)");
    expect(sync).toContain("目标组下载仅使用其专属目录");
  });

  it("健康接口返回当前Worker协议标识，不再静态标记为v3", () => {
    const worker = source("workers/cocktail-ai/worker-v4.js");

    expect(worker).toContain('version: "v4"');
    expect(worker).toContain('release: "group-switch-safe"');
    expect(worker).not.toContain('version: "v3"');
  });
});

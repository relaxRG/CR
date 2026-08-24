import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("关键数据Provider异步重载稳定性", () => {
  it("鸡尾酒酒款同步重载会消费存储读取拒绝，不留下未处理Promise", () => {
    const bottleStore = source("lib/bottles/store.tsx");

    expect(bottleStore).toContain("void AsyncStorage.getItem(BOTTLES_KEY)");
    expect(bottleStore).toContain("酒款同步重载失败");
    expect(bottleStore).toContain("registerStoreReload(() =>");
  });

  it("烈酒与葡萄酒Provider均为初次水合和远端重载建立错误边界", () => {
    const spiritsStore = source("lib/spirits/crud-store.tsx");
    const wineStore = source("lib/wine/store.tsx");

    expect(spiritsStore).toContain("烈酒库存加载失败");
    expect(spiritsStore).toContain("registerStoreReload(() => { void load(); })");
    expect(wineStore).toContain("葡萄酒库存档案加载失败");
    expect(wineStore).toContain("registerStoreReload(() => { void loadBottles(); })");
  });
});

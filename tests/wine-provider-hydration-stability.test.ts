import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(resolve(process.cwd(), "lib/wine/store.tsx"), "utf8");

describe("葡萄酒Provider水合稳定性", () => {
  it("为每个独立事实源捕获AsyncStorage读取拒绝，并在失败后仍标记水合完成", () => {
    const store = source();

    expect(store).toContain("葡萄酒库存档案加载失败");
    expect(store).toContain("葡萄酒库存快照加载失败");
    expect(store).toContain("葡萄酒采购记录加载失败");
    expect(store).toContain("葡萄酒采购导入控制数据加载失败");
    expect(store).toContain("葡萄酒采购主数据加载失败");
    expect((store.match(/\.catch\(\(error: unknown\) =>/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((store.match(/\.finally\(\(\) => markStoreLoaded/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("初次水合和远端重载均以已处理的Promise执行", () => {
    const store = source();

    expect((store.match(/void load[A-Za-z]+\(\);/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((store.match(/registerStoreReload\(\(\) => \{ void load/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

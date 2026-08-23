import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(resolve(process.cwd(), "lib/inventory-core/store.tsx"), "utf8");

describe("通用库存首轮水合安全护栏", () => {
  it("在异步读取完成后等待加载渲染提交，并跳过首次持久化写回", () => {
    const store = source();
    expect(store).toContain("const initialPersistPendingRef = useRef(true)");
    expect(store).toContain("requestAnimationFrame(() => { if (alive) setReady(true); })");
    expect(store).toContain("if (initialPersistPendingRef.current)");
    expect(store).toContain("initialPersistPendingRef.current = false");
    expect(store).toContain("if (!ready) return;");
  });

  it("首轮水合 effect 在卸载时取消，避免异步读取结束后写入已卸载 Provider", () => {
    expect(source()).toContain("return () => { alive = false; };");
  });
});

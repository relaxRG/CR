import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "components/store/purchase.tsx"),
  "utf8",
);

describe("门店采购长列表性能策略", () => {
  it("以单次遍历生成分类后的待办与完成队列", () => {
    expect(source).toContain("const visibleItems = useMemo(() =>");
    expect(source).toContain("for (const item of items)");
    expect(source).toContain("(item.done ? done : pending).push(item)");
    expect(source).toContain("data={visibleItems}");
    expect(source).not.toContain("const filtered = useMemo(() => items.filter");
  });

  it("继续使用统一移动端窗口化参数渲染采购项", () => {
    expect(source).toContain("<FlatList {...MOBILE_VIRTUAL_LIST_PROPS}");
    expect(source).toContain("useScrollPreservation(cat)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/inventory/ItemEditModal.tsx", "utf8");

describe("通用库存数量写入护栏", () => {
  it("既有商品编辑不暴露当前库存输入，新增商品仅允许录入期初库存", () => {
    expect(source).toContain("...(item ? [] : [{ label: \"期初库存\"");
    expect(source).not.toContain('{ label: "当前库存", value: currentStock');
  });

  it("既有商品保存时保留原库存，后续数量必须由采购、出库、盘点或月结领域动作变更", () => {
    expect(source).toContain("currentStock: item ? item.currentStock : (Number(currentStock) || 0)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/supplier-import.tsx", "utf8");

describe("食品供应商导入与月度台账连接", () => {
  it("新建食材必须同步取得稳定ID，并作为同一批入库和供应商记录的归属ID", () => {
    expect(source).toContain("const newIngredientId = addIngredient(newIng);");
    expect(source).toContain("newIdMap[rs.row.rawName] = newIngredientId;");
    expect(source).toContain("const ingredientId = rs.matchedId ?? newIdMap[rs.row.rawName];");
    expect(source).toContain("id: ingredientId,");
    expect(source).toContain("matchedIngredientId: rs.matchedId ?? newIdMap[rs.row.rawName] ?? null,");
  });

  it("批量更新继续只通过 batchImport 进入食材采购动作，不能直接覆盖库存", () => {
    expect(source).toContain("if (updates.length > 0) batchImport(updates);");
    expect(source).not.toContain("updateIngredient(ingredientId, { stock:");
  });
});

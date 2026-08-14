import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const embeddedGenericPanels = [
  "app/fruit-inventory.tsx",
  "app/beer-inventory.tsx",
  "app/ice-inventory.tsx",
  "app/glassware-inventory.tsx",
  "app/tableware-inventory.tsx",
  "app/daily-inventory.tsx",
  "app/food-inventory.tsx",
  "app/equipment-inventory.tsx",
];

describe("库存与店铺批量操作栏审计", () => {
  it("烈酒的全选、清空选择和批量编辑仅在多选模式条件内渲染", () => {
    const spirits = read("app/spirits-inventory.tsx");
    const start = spirits.indexOf('{selectMode && (\n        <View style={{ backgroundColor: "#FEF2F2"');
    const end = spirits.indexOf('{/* 供应商信息头 */}', start);
    const toolbar = spirits.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(toolbar).toContain("全选");
    expect(toolbar).toContain("清空选择");
    expect(toolbar).toContain("取消多选");
  });

  it("葡萄酒的批量操作已由selectMode与已选数量共同守卫", () => {
    const wine = read("app/wine-inventory.tsx");
    expect(wine).toContain("{selectMode && selectedIds.size > 0 && (");
  });

  it("其余六类通用库存与三个店铺面板不包含另一套常驻多选工具栏", () => {
    for (const panel of embeddedGenericPanels) {
      const source = read(panel);
      expect(source).not.toContain("取消全选");
      expect(source).not.toContain("setSelectMode");
      expect(source).not.toContain("selectedIds");
    }
  });
});

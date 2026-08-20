import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const spirits = fs.readFileSync(path.join(root, "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");

describe("烈酒导入与台账移动端回归", () => {
  it("默认台账模式不渲染全选和批量编辑工具栏", () => {
    const conditionalStart = spirits.indexOf('{selectMode && (\n        <View style={{ backgroundColor: "#FEF2F2"');
    const batchToolbarEnd = spirits.indexOf('{/* 供应商信息头 */}', conditionalStart);
    const batchToolbar = spirits.slice(conditionalStart, batchToolbarEnd);

    expect(conditionalStart).toBeGreaterThan(-1);
    expect(batchToolbar).toContain("已选 {selectedIds.size}/{supPurchases.length}");
    expect(batchToolbar).toContain("全选");
    expect(batchToolbar).toContain("清空选择");
    expect(batchToolbar).toContain("取消多选");
    expect(batchToolbar).toContain("{selectedIds.size > 0 && (");
    expect(batchToolbar).not.toContain("取消全选");
  });

  it("导入预览对刘海屏安全区、底部确认栏和超长商品名提供防遮挡约束", () => {
    expect(spirits).toContain("const insets = useSafeAreaInsets();");
    expect(spirits).toContain("paddingTop: Math.max(insets.top, 16) + 12");
    expect(spirits).toContain("paddingBottom: 112 + Math.max(insets.bottom, 16)");
    expect(spirits).toContain("paddingBottom: 16 + Math.max(insets.bottom, 0)");
    expect(spirits).toContain("flex: 1, minWidth: 0, marginRight: 8");
    expect(spirits).toContain("numberOfLines={2}");
    expect(spirits).toContain("flexShrink: 0 }}>¥{formatMoney(row.amount)}");
    expect(spirits).toContain("minWidth: 44, minHeight: 44");
  });

  it("多选模式才显示复选框，普通模式保留单条删除入口", () => {
    expect(spirits).toContain("{selectMode && (\n                  <View style={{ paddingLeft: 12, paddingRight: 4 }}>");
    expect(spirits).toContain("{!selectMode && (\n                  <TouchableOpacity onPress={() => {");
  });
});

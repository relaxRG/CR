import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("供应商当月进货表展示", () => {
  const screen = read("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");

  it("将分类作为固定列，按商品名称、数量、单价、总价、集团的紧凑顺序渲染", () => {
    const headerStart = screen.indexOf('testID="spirits-purchase-header"');
    const headerEnd = screen.indexOf("{/* 数据行始终按完整年月日分组", headerStart);
    const header = screen.slice(headerStart, headerEnd);

    expect(header).toContain(">序号</Text>");
    expect(header).toContain(">分类</Text>");
    expect(header).toContain("商品名称");
    expect(header.indexOf(">分类</Text>")).toBeLessThan(header.indexOf("商品名称"));
    expect(header.indexOf("商品名称")).toBeLessThan(header.indexOf(">数量<"));
    expect(header.indexOf(">数量<")).toBeLessThan(header.indexOf(">单价<"));
    expect(header.indexOf(">单价<")).toBeLessThan(header.indexOf(">总价<"));
    expect(header.indexOf(">总价<")).toBeLessThan(header.indexOf(">集团<"));
    expect(header).not.toContain(">月日<");
    expect(header).not.toContain(">规格<");
  });

  it("按完整 ISO 年月日显示采购日期分组，分类由单条记录显示且不再占用分组行", () => {
    expect(screen).toContain('const date = /^\\d{4}-\\d{2}-\\d{2}$/.test(purchase.date) ? purchase.date : "未填写日期"');
    expect(screen).toContain("return right.localeCompare(left);");
    expect(screen).toContain("{/* 数据行始终按完整年月日分组；分类在每条采购记录中显示。 */}");
    expect(screen).toContain("resolvePurchaseDisplayCategory(p, item)");
    expect(screen).toContain('from "@/lib/spirits/purchase-category-sync"');
    expect(screen).not.toContain("formatInventoryMonthDay(p.date)");
    expect(screen).toContain('{ text: "修改日期"');
  });

  it("使用高密度固定行、紧凑列轨道与低内边距，避免表头、分组行、数据行和合计行错位", () => {
    expect(screen).toContain("SPIRIT_PURCHASE_COLUMN_WIDTH");
    expect(screen).toContain("spiritPurchaseTableWidth(selectMode)");
    expect(screen).toContain("width: SPIRIT_PURCHASE_COLUMN_WIDTH.category");
    expect(screen).toContain("width: SPIRIT_PURCHASE_COLUMN_WIDTH.name");
    expect(screen).toContain("width: SPIRIT_PURCHASE_COLUMN_WIDTH.amount");
    expect(screen).toContain("height: INVENTORY_WORKSPACE_METRICS.phoneRowHeight");
    expect(screen).toContain("minHeight: INVENTORY_WORKSPACE_METRICS.phoneRowHeight");
    expect(screen).toContain("S.ledgerCell");
    expect(screen).toContain("numberOfLines={2}");
  });

  it("商品名称中英文切换仅使用本机展示状态，并为缺失语言回退原始导入名", () => {
    expect(screen).toContain('usePersistedState<"zh" | "en">("spirits.purchase.name-language.v1", "zh")');
    expect(screen).toContain('testID="spirits-purchase-column-name"');
    expect(screen).toContain("<SupplierPurchaseColumnMenu");
    expect(screen).toContain("onNameLanguageChange={setPurchaseNameLanguage}");
    expect(screen).toContain('const preferred = purchaseNameLanguage === "zh" ? item?.name : item?.nameEn;');
    expect(screen).toContain('displayName: preferred?.trim() || fallback?.trim() || purchase.rawName');
  });

  it("表头整列点击筛选排序且不再显示重复下拉箭头", () => {
    expect(screen).toContain("tableHeaderAccessibilityLabel");
    expect(screen).not.toContain(">⌄<");
  });

  it("Excel解析继续使用原有字段映射，不感知表格显示语言或列重排", () => {
    const parser = read("lib/spirits/excel-parser.ts");
    expect(parser).toContain("列：0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加");
    expect(parser).not.toContain("purchaseNameLanguage");
    expect(parser).not.toContain("spirits-purchase-name-language-toggle");
  });
});

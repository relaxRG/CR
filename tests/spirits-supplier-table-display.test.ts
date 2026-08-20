import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("供应商当月进货表展示", () => {
  const screen = read("components/inventory/SpiritsInventoryWorkspaceScreen.tsx");

  it("按数量、既有瓶箱规格、单价、总价、集团的顺序渲染表头", () => {
    const headerStart = screen.indexOf('testID="spirits-purchase-column-name"');
    const headerEnd = screen.indexOf("{/* 数据行：常规浏览按分类分组", headerStart);
    const header = screen.slice(headerStart, headerEnd);

    expect(header).toContain("商品名称");
    expect(header.indexOf(">数量<")).toBeLessThan(header.indexOf(">规格<"));
    expect(header.indexOf(">规格<")).toBeLessThan(header.indexOf(">单价<"));
    expect(header.indexOf(">单价<")).toBeLessThan(header.indexOf(">总价<"));
    expect(header.indexOf(">总价<")).toBeLessThan(header.indexOf(">集团<"));
  });

  it("商品名称中英文切换仅使用本机展示状态，并为缺失语言回退原始导入名", () => {
    expect(screen).toContain('usePersistedState<"zh" | "en">("spirits.purchase.name-language.v1", "zh")');
    expect(screen).toContain('testID="spirits-purchase-column-name"');
    expect(screen).toContain("<SupplierPurchaseColumnMenu");
    expect(screen).toContain("onNameLanguageChange={setPurchaseNameLanguage}");
    expect(screen).toContain('const preferred = purchaseNameLanguage === "zh" ? item?.name : item?.nameEn;');
    expect(screen).toContain('displayName: preferred?.trim() || fallback?.trim() || purchase.rawName');
  });

  it("使用高密度固定行、单行名称与无色分类分组，避免名称高度不齐和重复分类标签", () => {
    expect(screen).toContain("height: INVENTORY_WORKSPACE_METRICS.phoneRowHeight");
    expect(screen).toContain("minHeight: INVENTORY_WORKSPACE_METRICS.phoneRowHeight");
    expect(screen).toContain("purchaseDisplayGroups.map");
    expect(screen).toContain("group.label} · {group.rows.length} 笔");
    expect(screen).toContain("numberOfLines={2}");
    expect(screen).not.toContain("{/* 分类列 */}");
  });

  it("表头整列点击筛选排序且不再显示重复下拉箭头", () => {
    expect(screen).toContain("tableHeaderAccessibilityLabel");
    expect(screen).not.toContain(">⌄<");
    expect(screen).toContain("formatInventoryMonthDay(p.date)");
  });

  it("Excel解析继续使用原有字段映射，不感知表格显示语言或列重排", () => {
    const parser = read("lib/spirits/excel-parser.ts");
    expect(parser).toContain("列：0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加");
    expect(parser).not.toContain("purchaseNameLanguage");
    expect(parser).not.toContain("spirits-purchase-name-language-toggle");
  });
});

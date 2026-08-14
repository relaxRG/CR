import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("供应商当月进货表展示", () => {
  const screen = read("app/spirits-inventory.tsx");

  it("按数量、既有瓶箱规格、单价、应收增加、集团的顺序渲染表头", () => {
    const headerStart = screen.indexOf('testID="spirits-purchase-name-language-toggle"');
    const headerEnd = screen.indexOf("{/* 数据行 */}", headerStart);
    const header = screen.slice(headerStart, headerEnd);

    expect(header).toContain("商品名称");
    expect(header.indexOf(">数量<")).toBeLessThan(header.indexOf(">规格<"));
    expect(header.indexOf(">规格<")).toBeLessThan(header.indexOf(">单价<"));
    expect(header.indexOf(">单价<")).toBeLessThan(header.indexOf(">应收增加<"));
    expect(header.indexOf(">应收增加<")).toBeLessThan(header.indexOf(">集团<"));
  });

  it("商品名称中英文切换仅使用本机展示状态，并为缺失语言回退原始导入名", () => {
    expect(screen).toContain('usePersistedState<"zh" | "en">("spirits.purchase.name-language.v1", "zh")');
    expect(screen).toContain('testID="spirits-purchase-name-language-toggle"');
    expect(screen).toContain('setPurchaseNameLanguage((language) => language === "zh" ? "en" : "zh")');
    expect(screen).toContain('const preferred = purchaseNameLanguage === "zh" ? item.name : item.nameEn;');
    expect(screen).toContain('return preferred?.trim() || fallback?.trim() || p.rawName;');
  });

  it("每个数据行固定高度并为名称预留两行，避免一行和两行名称造成高低不齐", () => {
    expect(screen).toContain("height: 58,");
    expect(screen).toContain("minHeight: 58,");
    expect(screen).toContain('height: 34 }}');
    expect(screen).toContain("lineHeight: 16");
    expect(screen).toContain("numberOfLines={2}");
  });

  it("Excel解析继续使用原有字段映射，不感知表格显示语言或列重排", () => {
    const parser = read("lib/spirits/excel-parser.ts");
    expect(parser).toContain("列：0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加");
    expect(parser).not.toContain("purchaseNameLanguage");
    expect(parser).not.toContain("spirits-purchase-name-language-toggle");
  });
});

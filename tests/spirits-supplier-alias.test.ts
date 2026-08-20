import { describe, expect, it } from "vitest";
import { buildImportedPurchaseRecords, findImportedPurchaseItem } from "@/lib/spirits/import-bridge";
import {
  createSpiritSupplierAlias,
  normalizeSpiritSupplierAliases,
  resolveSpiritItemForSupplierName,
  upsertSpiritSupplierAlias,
} from "@/lib/spirits/supplier-alias";
import type { SpiritItem, SpiritPurchaseOrderItem } from "@/lib/spirits/types";

const item = (id: string, name: string, supplier?: string): SpiritItem => ({
  id,
  name,
  category: "Base (Whisky)",
  unit: "瓶",
  refPrice: 100,
  supplier,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const order = (supplier: string, rawName: string): SpiritPurchaseOrderItem => ({
  supplier,
  rawName,
  nameZh: rawName,
  nameEn: "",
  unitPrice: 100,
  quantity: 1,
  amount: 100,
  spec: "瓶",
  date: "2026-01-10",
});

describe("烈酒供应商专属采购名称", () => {
  it("同一标准烈酒可保存多个供应商名称且会规范化去重", () => {
    const aliases = normalizeSpiritSupplierAliases([
      createSpiritSupplierAlias("至缘", "白占边（金宾波本）"),
      createSpiritSupplierAlias(" 至缘 ", "白占边（金宾波本）700ml"),
      createSpiritSupplierAlias("戎恒", "Jim Beam White"),
    ]);
    expect(aliases).toHaveLength(2);
    expect(aliases.map((entry) => entry.supplier)).toEqual(["至缘", "戎恒"]);
  });

  it("供应商别名优先于标准名，且仅在唯一时关联主档", () => {
    const beam = { ...item("beam", "金宾白占边", "至缘"), supplierAliases: [createSpiritSupplierAlias("至缘", "白占边（金宾波本）")] };
    const another = item("other", "白占边", "戎恒");
    expect(resolveSpiritItemForSupplierName([beam, another], "至缘", "白占边（金宾波本）700ML")?.item.id).toBe("beam");
    expect(resolveSpiritItemForSupplierName([beam, another], "未知", "白占边")?.item.id).toBe("other");
    const duplicate = item("duplicate", "白占边", "另一供应商");
    expect(resolveSpiritItemForSupplierName([beam, another, duplicate], "未知", "白占边")).toBeNull();
  });

  it("更新同一供应商同名别名不会创建第二条映射", () => {
    const first = createSpiritSupplierAlias("至缘", "金宾白占边");
    const aliases = upsertSpiritSupplierAlias([first], "至缘", "金宾白占边 700ml");
    expect(aliases).toHaveLength(1);
    expect(aliases[0].purchaseName).toBe("金宾白占边 700ml");
  });

  it("Excel 导入优先按供应商别名关联并同步分类、集团", () => {
    const beam = {
      ...item("beam", "金宾白占边", "至缘"),
      group: "百富门 (Brown-Forman)",
      supplierAliases: [createSpiritSupplierAlias("至缘", "白占边（金宾波本）")],
    };
    expect(findImportedPurchaseItem(order("至缘", "白占边（金宾波本）"), [beam])?.id).toBe("beam");
    const result = buildImportedPurchaseRecords([order("至缘", "白占边（金宾波本）")], [beam], "2026-01");
    expect(result.unmatched).toHaveLength(0);
    expect(result.records[0]).toMatchObject({ itemId: "beam", category: "Base (Whisky)", group: "百富门 (Brown-Forman)" });
  });
});

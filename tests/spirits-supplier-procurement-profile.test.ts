import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const types = readFileSync(resolve(process.cwd(), "lib/spirits/types.ts"), "utf8");
const store = readFileSync(resolve(process.cwd(), "lib/spirits/crud-store.tsx"), "utf8");

describe("烈酒采购档案供应商事实", () => {
  it("区分集中付款供货商与网络采购，并只保存文档元数据而非二进制内容", () => {
    expect(types).toContain('export type SpiritProcurementChannelType = "supplier" | "online"');
    expect(types).toContain("paymentCycleDays?: number");
    expect(types).toContain("paymentTerms?: string");
    expect(types).toContain("platformUrl?: string");
    expect(types).toContain("documents?: SpiritSupplierDocument[]");
    expect(types).toContain("storageKey: string");
    expect(types).toContain('@deprecated 使用 channelType: "online"');
  });

  it("供应商顺序由唯一命令维护，编辑资料保留已有排序和渠道类型", () => {
    expect(store).toContain('| { type: "REORDER_SUPPLIERS"; suppliers: SpiritSupplierInfo[] }');
    expect(store).toContain('moveSupplier: (id: string, direction: "up" | "down") => void');
    expect(store).toContain('const moveSupplier = (id: string, direction: "up" | "down") =>');
    expect(store).toContain('channelType: data.channelType ?? existing?.channelType');
    expect(store).toContain('sortOrder: Number.isFinite(data.sortOrder) ? data.sortOrder : existing?.sortOrder ?? state.suppliers.length');
    expect(store).toContain('type: "REORDER_SUPPLIERS"');
  });
});

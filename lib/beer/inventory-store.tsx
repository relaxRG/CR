/**
 * 啤酒进销存 Store（基于通用核心库）
 * 特点：全部自采，关联备用金 B1，追踪毛利率
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: BeerInventoryProvider, useStore: useBeerInventoryStore } =
  createGenericInventoryStore("beer.inventory.v2", "beer");

export { BeerInventoryProvider, useBeerInventoryStore };

// ─── 啤酒专用分类 ─────────────────────────────────────────────────────────────
export const BEER_PACKAGE_TYPES = [
  { value: "bottle", label: "瓶装", color: "#F4A300" },
  { value: "can", label: "罐装", color: "#EF4444" },
  { value: "draft", label: "扎装", color: "#10B981" },
  { value: "barrel", label: "桶装", color: "#6366F1" },
] as const;

export const BEER_EXCEL_HINT =
  "A列：名称 | B列：英文名 | C列：规格 | D列：包装类型(瓶装/罐装/扎装/桶装)\n" +
  "E列：期初库存(瓶) | F列：本月进货量 | G列：本月消耗量 | H列：进价(元/瓶) | I列：售价 | J列：供应商";

/** 解析啤酒 Excel */
export async function parseBeerInventoryExcel(base64: string): Promise<{
  items?: import("@/lib/inventory-core/store").GenericInventoryItem extends infer T ? Omit<T, "id" | "createdAt" | "updatedAt">[] : never;
  error?: string;
}> {
  try {
    const { utils, read } = await import("xlsx");
    const wb = read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = utils.sheet_to_json(ws, { header: 1, defval: "" });
    const items: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[0] ?? "").trim();
      if (!name) continue;
      const pkgRaw = String(r[3] ?? "").trim();
      let pkg = "bottle";
      if (pkgRaw.includes("罐")) pkg = "can";
      else if (pkgRaw.includes("扎")) pkg = "draft";
      else if (pkgRaw.includes("桶")) pkg = "barrel";
      items.push({
        name,
        nameEn: String(r[1] ?? "").trim() || undefined,
        category: pkg,
        spec: String(r[2] ?? "").trim(),
        unit: "瓶",
        currentStock: Number(r[4]) || 0,
        latestCostPrice: Number(r[7]) || 0,
        supplier: String(r[9] ?? "").trim(),
        notes: "",
        active: true,
        extra: { sellingPrice: Number(r[8]) || 0 },
      });
    }
    return { items };
  } catch (e) {
    return { error: String(e) };
  }
}

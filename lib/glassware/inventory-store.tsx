/**
 * 杯具进销存 Store（基于通用核心库）
 * 特点：按杯型分组，低频进货，损耗录入是核心，关联备用金 C 类
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: GlasswareInventoryProvider, useStore: useGlasswareInventoryStore } =
  createGenericInventoryStore("glassware.inventory.v1", "glassware");

export { GlasswareInventoryProvider, useGlasswareInventoryStore };

export const GLASSWARE_TYPES = [
  { value: "highball", label: "高球杯", color: "#6366F1" },
  { value: "martini", label: "马天尼杯", color: "#8B5CF6" },
  { value: "whisky", label: "威士忌杯", color: "#A78BFA" },
  { value: "champagne", label: "香槟杯", color: "#F59E0B" },
  { value: "wine", label: "品酒杯", color: "#EF4444" },
  { value: "shot", label: "Shot 杯", color: "#10B981" },
  { value: "beer", label: "啤酒杯", color: "#F4A300" },
  { value: "cocktail", label: "鸡尾酒杯", color: "#EC4899" },
  { value: "other", label: "其他杯具", color: "#94A3B8" },
] as const;

export const GLASSWARE_EXCEL_HINT =
  "A列：名称 | B列：杯型 | C列：规格(容量) | D列：期初库存(个)\n" +
  "E列：本月进货量 | F列：本月损耗量 | G列：单价(元/个) | H列：供应商";

export async function parseGlasswareExcel(base64: string): Promise<{
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
      const typeRaw = String(r[1] ?? "").trim();
      let category = "other";
      for (const t of GLASSWARE_TYPES) {
        if (typeRaw.includes(t.label) || typeRaw.includes(t.value)) { category = t.value; break; }
      }
      items.push({
        name,
        category,
        spec: String(r[2] ?? "").trim(),
        unit: "个",
        currentStock: Number(r[3]) || 0,
        alertThreshold: 10,
        latestCostPrice: Number(r[6]) || 0,
        supplier: String(r[7] ?? "").trim(),
        notes: "",
        active: true,
      });
    }
    return { items };
  } catch (e) {
    return { error: String(e) };
  }
}

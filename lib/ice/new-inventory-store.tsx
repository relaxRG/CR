/**
 * 冰块进销存 Store（基于通用核心库）
 * 特点：SKU 极少，全部自采，单位多样，关联备用金 B1/B2/B3
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: IceNewInventoryProvider, useStore: useIceNewInventoryStore } =
  createGenericInventoryStore("ice.inventory.v2", "ice");

export { IceNewInventoryProvider, useIceNewInventoryStore };

export const ICE_CATEGORIES = [
  { value: "shake", label: "摇冰", color: "#00BCD4" },
  { value: "ball", label: "冰球", color: "#0288D1" },
  { value: "cube", label: "方冰", color: "#0097A7" },
  { value: "stick", label: "直条冰", color: "#00ACC1" },
  { value: "crushed", label: "碎冰", color: "#26C6DA" },
  { value: "dry", label: "干冰", color: "#80DEEA" },
  { value: "other", label: "其他", color: "#B2EBF2" },
] as const;

export const ICE_EXCEL_HINT =
  "A列：名称 | B列：规格 | C列：单位(袋/kg/颗/箱)\n" +
  "D列：期初库存 | E列：本月进货量 | F列：本月消耗量 | G列：进价(元/单位) | H列：供应商";

export async function parseIceInventoryExcel(base64: string): Promise<{
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
      items.push({
        name,
        category: "other",
        spec: String(r[1] ?? "").trim(),
        unit: String(r[2] ?? "袋").trim(),
        currentStock: Number(r[3]) || 0,
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

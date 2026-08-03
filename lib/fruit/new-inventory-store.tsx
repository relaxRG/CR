/**
 * 水果进销存 Store（基于通用核心库）
 * 特点：按品类（柑橘/浆果/热带等）分组，全部自采，关联备用金 A5
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: FruitNewInventoryProvider, useStore: useFruitNewInventoryStore } =
  createGenericInventoryStore("fruit.inventory.v2", "fruit");

export { FruitNewInventoryProvider, useFruitNewInventoryStore };

export const FRUIT_CATEGORIES = [
  { value: "citrus", label: "柑橘类", color: "#F59E0B" },
  { value: "berry", label: "浆果类", color: "#EC4899" },
  { value: "tropical", label: "热带水果", color: "#10B981" },
  { value: "stone", label: "核果类", color: "#EF4444" },
  { value: "melon", label: "瓜果类", color: "#84CC16" },
  { value: "apple_pear", label: "苹果梨类", color: "#6366F1" },
  { value: "herb", label: "香草类", color: "#14B8A6" },
  { value: "vegetable", label: "蔬菜类", color: "#22C55E" },
  { value: "other", label: "其他", color: "#94A3B8" },
] as const;

export const FRUIT_UNITS = [
  { value: "kg", label: "kg" },
  { value: "piece", label: "个/只" },
  { value: "box", label: "箱" },
  { value: "bag", label: "袋" },
  { value: "bunch", label: "串/把" },
] as const;

export const FRUIT_EXCEL_HINT =
  "A列：名称 | B列：英文名 | C列：品类 | D列：规格 | E列：单位(kg/个/箱/袋/串)\n" +
  "F列：期初库存 | G列：本月进货量 | H列：本月消耗量 | I列：进价(元/单位) | J列：供应商 | K列：用途";

export async function parseFruitInventoryExcel(base64: string): Promise<{
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
      // 品类匹配
      const catRaw = String(r[2] ?? "").trim();
      let category = "other";
      for (const cat of FRUIT_CATEGORIES) {
        if (catRaw.includes(cat.label) || catRaw.includes(cat.value)) { category = cat.value; break; }
      }
      // 单位匹配
      const unitRaw = String(r[4] ?? "kg").trim();
      let unit = "kg";
      if (unitRaw.includes("个") || unitRaw.includes("只")) unit = "piece";
      else if (unitRaw.includes("箱")) unit = "box";
      else if (unitRaw.includes("袋")) unit = "bag";
      else if (unitRaw.includes("串") || unitRaw.includes("把")) unit = "bunch";
      items.push({
        name,
        nameEn: String(r[1] ?? "").trim() || undefined,
        category,
        spec: String(r[3] ?? "").trim(),
        unit,
        currentStock: Number(r[5]) || 0,
        alertThreshold: 1,
        latestCostPrice: Number(r[8]) || 0,
        supplier: String(r[9] ?? "").trim(),
        notes: "",
        active: true,
        extra: { usage: String(r[10] ?? "").trim() },
      });
    }
    return { items };
  } catch (e) {
    return { error: String(e) };
  }
}

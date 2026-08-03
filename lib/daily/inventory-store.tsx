/**
 * 日用品进销存 Store（基于通用核心库）
 * 特点：SKU 多，高频消耗，按场所分组，批量快速录入，关联备用金 D 类
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: DailyInventoryProvider, useStore: useDailyInventoryStore } =
  createGenericInventoryStore("daily.inventory.v1", "daily");

export { DailyInventoryProvider, useDailyInventoryStore };

export const DAILY_CATEGORIES = [
  { value: "bar", label: "吧台耗材", color: "#F59E0B" },
  { value: "restroom", label: "洗手间", color: "#0EA5E9" },
  { value: "kitchen", label: "厨房用品", color: "#10B981" },
  { value: "cleaning", label: "清洁用品", color: "#6366F1" },
  { value: "packaging", label: "包装材料", color: "#EC4899" },
  { value: "office", label: "办公用品", color: "#8B5CF6" },
  { value: "other", label: "其他", color: "#94A3B8" },
] as const;

export const DAILY_EXCEL_HINT =
  "A列：名称 | B列：分类(吧台耗材/洗手间/厨房/清洁/包装/办公/其他)\n" +
  "C列：规格 | D列：单位 | E列：期初库存 | F列：本月进货量 | G列：本月消耗量\n" +
  "H列：进价(元/单位) | I列：预警线 | J列：供应商";

export async function parseDailyExcel(base64: string): Promise<{
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
      const catRaw = String(r[1] ?? "").trim();
      let category = "other";
      for (const c of DAILY_CATEGORIES) {
        if (catRaw.includes(c.label) || catRaw.includes(c.value)) { category = c.value; break; }
      }
      items.push({
        name,
        category,
        spec: String(r[2] ?? "").trim(),
        unit: String(r[3] ?? "个").trim(),
        currentStock: Number(r[4]) || 0,
        alertThreshold: Number(r[8]) || 3,
        latestCostPrice: Number(r[7]) || 0,
        supplier: String(r[9] ?? "").trim(),
        notes: "",
        active: true,
      });
    }
    return { items };
  } catch (e) {
    return { error: String(e) };
  }
}

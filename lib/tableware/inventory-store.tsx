/**
 * 餐具进销存 Store（基于通用核心库）
 * 特点：按餐具类型分组，损耗录入，低频进货，关联备用金 C 类
 */
import { createGenericInventoryStore } from "@/lib/inventory-core/store";

const { Provider: TablewareInventoryProvider, useStore: useTablewareInventoryStore } =
  createGenericInventoryStore("tableware.inventory.v1", "tableware");

export { TablewareInventoryProvider, useTablewareInventoryStore };

export const TABLEWARE_TYPES = [
  { value: "plate", label: "碟/盘", color: "#0EA5E9" },
  { value: "bowl", label: "碗", color: "#0284C7" },
  { value: "chopsticks", label: "筷子", color: "#0369A1" },
  { value: "fork_knife", label: "刀叉勺", color: "#075985" },
  { value: "tray", label: "托盘", color: "#0C4A6E" },
  { value: "coaster", label: "杯垫/杯托", color: "#38BDF8" },
  { value: "napkin", label: "餐巾/纸巾", color: "#7DD3FC" },
  { value: "other", label: "其他餐具", color: "#94A3B8" },
] as const;

export const TABLEWARE_EXCEL_HINT =
  "A列：名称 | B列：类型 | C列：规格 | D列：期初库存\n" +
  "E列：本月进货量 | F列：本月损耗量 | G列：单价(元) | H列：供应商";

export async function parseTablewareExcel(base64: string): Promise<{
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
      for (const t of TABLEWARE_TYPES) {
        if (typeRaw.includes(t.label) || typeRaw.includes(t.value)) { category = t.value; break; }
      }
      items.push({
        name,
        category,
        spec: String(r[2] ?? "").trim(),
        unit: "个",
        currentStock: Number(r[3]) || 0,
        alertThreshold: 5,
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

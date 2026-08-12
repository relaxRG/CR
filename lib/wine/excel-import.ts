import { utils, read as xlsxRead } from "xlsx";
import { normalizeImportDate } from "@/lib/import/date-utils";
import { dominantPurchaseMonth } from "@/lib/spirits/import-bridge";
import type { WineInventoryItem, WinePurchaseOrderItem, WineMonthlySnapshot } from "@/lib/wine/types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/** 解析葡萄酒库存工作簿；非法显式日期会跳过，空日期仅继承上一条已验证日期。 */
export function parseWineInventoryExcel(base64: string): WineMonthlySnapshot | null {
  try {
    const workbook = xlsxRead(base64, { type: "base64", cellDates: true });

    const ledgerSheet = workbook.Sheets["葡萄酒盘点"];
    const items: WineInventoryItem[] = [];
    if (ledgerSheet) {
      const rows = utils.sheet_to_json<any[]>(ledgerSheet, { header: 1, defval: null });
      for (let index = 1; index < rows.length; index++) {
        const row = rows[index];
        const seq = row[0];
        const name = row[3];
        if (!name || typeof name !== "string") continue;
        items.push({
          seq: Number(seq) || index,
          wineType: String(row[1] || ""),
          supplier: String(row[2] || ""),
          name: String(name).trim(),
          initUnitCost: Number(row[4]) || 0,
          initQty: Number(row[5]) || 0,
          initCost: Number(row[6]) || 0,
          purchaseQty: Number(row[7]) || 0,
          purchaseCost: Number(row[8]) || 0,
          endQty: Number(row[9]) || 0,
          unitCost: Number(row[10]) || 0,
          endCost: Number(row[11]) || 0,
          consumeBottles: Number(row[12]) || 0,
          consumeQty: Number(row[13]) || 0,
        });
      }
    }

    const purchaseSheet = workbook.Sheets["进货总单"];
    const purchaseOrders: WinePurchaseOrderItem[] = [];
    if (purchaseSheet) {
      const rows = utils.sheet_to_json<any[]>(purchaseSheet, { header: 1, defval: null });
      let lastValidDate = "";
      for (let index = 2; index < rows.length; index++) {
        const row = rows[index];
        const dateValue = row[1];
        const supplier = row[2];
        const productName = row[3];
        if (!supplier || !productName) continue;

        const parsedDate = normalizeImportDate(dateValue);
        const hasDateValue = dateValue !== null && dateValue !== undefined && String(dateValue).trim() !== "";
        if (hasDateValue && !parsedDate) continue;
        const date = parsedDate ?? lastValidDate;
        if (!date) continue;
        if (parsedDate) lastValidDate = parsedDate;

        purchaseOrders.push({
          date,
          supplier: String(supplier).trim(),
          productName: String(productName).trim(),
          unitPrice: Number(row[4]) || 0,
          quantity: Number(row[5]) || 0,
          amount: Number(row[6]) || 0,
        });
      }
    }

    const supplierTotals: Record<string, number> = {};
    items.forEach((item) => {
      if (item.purchaseCost > 0) {
        supplierTotals[item.supplier] = (supplierTotals[item.supplier] ?? 0) + item.purchaseCost;
      }
    });

    const now = new Date();
    const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const snapshotMonth = dominantPurchaseMonth(purchaseOrders, fallbackMonth);
    const [year, month] = snapshotMonth.split("-");

    return {
      id: uuid(),
      monthLabel: `${year}年${Number(month)}月`,
      importedAt: new Date().toISOString(),
      items,
      purchaseOrders,
      supplierTotals,
      totalPurchase: Object.values(supplierTotals).reduce((sum, value) => sum + value, 0),
      totalConsume: items.reduce((sum, item) => sum + item.consumeQty, 0),
      totalEndCost: items.reduce((sum, item) => sum + item.endCost, 0),
    };
  } catch (error) {
    console.error("葡萄酒 Excel 解析失败", error);
    return null;
  }
}

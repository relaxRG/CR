/**
 * 冰块进销存独立页面
 * 特点：SKU 极少，全部自采，单位多样，关联备用金 B1/B2/B3
 */
import React from "react";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useIceNewInventoryStore, ICE_CATEGORIES, ICE_EXCEL_HINT, parseIceInventoryExcel } from "@/lib/ice/new-inventory-store";

const ICE_COLOR = "#00BCD4";

export default function IceInventoryScreen() {
  const store = useIceNewInventoryStore();
  return (
    <BaseInventoryScreen
      store={store}
      title="冰块进销存"
      emoji="🧊"
      accentColor={ICE_COLOR}
      categoryId="ice"
      categoryLabel="冰块"
      pettyHint="B1/B2/B3（酒水相关）"
      categoryOptions={ICE_CATEGORIES.map((c) => ({ value: c.value, label: c.label, color: c.color }))}
      defaultUnit="袋"
      parseExcel={parseIceInventoryExcel}
      excelFormatHint={ICE_EXCEL_HINT}
    />
  );
}

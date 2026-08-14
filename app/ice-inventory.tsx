/**
 * 冰块进销存独立页面
 * 特点：SKU 极少，全部自采，单位多样，关联备用金 B1/B2/B3
 */
import React from "react";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useIceNewInventoryStore, ICE_CATEGORIES, ICE_EXCEL_HINT, parseIceInventoryExcel } from "@/lib/ice/new-inventory-store";
import IceCostLinkTab from "@/components/inventory/IceCostLinkTab";

const ICE_COLOR = "#00BCD4";

export interface IceInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function IceInventoryScreen({ month, embedded = false }: IceInventoryScreenProps) {
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
      month={month}
      embedded={embedded}
      extraTabs={[{ key: "costLink", label: "💡 成本联动" }]}
      renderExtraTabContent={(tab) => {
        if (tab === "costLink") return <IceCostLinkTab />;
        return null;
      }}
    />
  );
}

/**
 * 啤酒进销存独立页面
 * 特点：全部自采、按包装类型分组、毛利率追踪、关联备用金 B1
 */
import React from "react";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useBeerInventoryStore, BEER_PACKAGE_TYPES, BEER_EXCEL_HINT, parseBeerInventoryExcel } from "@/lib/beer/inventory-store";
import { GenericInventoryItem } from "@/lib/inventory-core/store";

const BEER_COLOR = "#F4A300";

const EXTRA_FIELDS = [
  { key: "sellingPrice", label: "售价（元/瓶）", placeholder: "0.00", keyboardType: "decimal-pad" as const },
];

function getGroupLabel(item: GenericInventoryItem): string {
  const pkg = BEER_PACKAGE_TYPES.find((p) => p.value === item.category);
  return pkg?.label ?? "其他";
}

export interface BeerInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function BeerInventoryScreen({ month, embedded = false }: BeerInventoryScreenProps) {
  const store = useBeerInventoryStore();
  return (
    <BaseInventoryScreen
      store={store}
      title="啤酒进销存"
      emoji="🍺"
      accentColor={BEER_COLOR}
      categoryId="beer"
      categoryLabel="啤酒"
      pettyHint="B1（酒水现结）"
      categoryOptions={BEER_PACKAGE_TYPES.map((p) => ({ value: p.value, label: p.label, color: p.color }))}
      defaultUnit="瓶"
      extraFields={EXTRA_FIELDS}
      getGroupLabel={getGroupLabel}
      parseExcel={parseBeerInventoryExcel}
      excelFormatHint={BEER_EXCEL_HINT}
      month={month}
      embedded={embedded}
    />
  );
}

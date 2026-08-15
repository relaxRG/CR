/**
 * 水果进销存独立页面
 * 特点：按品类（柑橘/浆果/热带等）分组，全部自采，关联备用金 A5
 */
import React from "react";
import { BaseInventoryScreen } from "@/components/inventory/BaseInventoryScreen";
import { useFruitNewInventoryStore, FRUIT_CATEGORIES, FRUIT_EXCEL_HINT, parseFruitInventoryExcel } from "@/lib/fruit/new-inventory-store";
import { GenericInventoryItem } from "@/lib/inventory-core/store";

const FRUIT_COLOR = "#22C55E";

const EXTRA_FIELDS = [
  { key: "usage", label: "用途", placeholder: "如 装饰/果汁/调酒" },
];

function getGroupLabel(item: GenericInventoryItem): string {
  const cat = FRUIT_CATEGORIES.find((c) => c.value === item.category);
  return cat?.label ?? "其他";
}

export interface FruitInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function FruitInventoryScreen({ month, embedded = false }: FruitInventoryScreenProps) {
  const store = useFruitNewInventoryStore();
  return (
    <BaseInventoryScreen
      store={store}
      title="水果进销存"
      emoji="🍋"
      accentColor={FRUIT_COLOR}
      categoryId="fruit"
      categoryLabel="水果"
      pettyHint="A5（蔬菜水果）"
      categoryOptions={FRUIT_CATEGORIES.map((c) => ({ value: c.value, label: c.label, color: c.color }))}
      defaultUnit="kg"
      extraFields={EXTRA_FIELDS}
      getGroupLabel={getGroupLabel}
      parseExcel={parseFruitInventoryExcel}
      excelFormatHint={FRUIT_EXCEL_HINT}
      defaultTab="ledger"
      ledgerPresentation="table"
      month={month}
      embedded={embedded}
    />
  );
}

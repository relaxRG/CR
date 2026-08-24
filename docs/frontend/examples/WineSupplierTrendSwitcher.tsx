import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { resolveWineSupplierTrendLayout } from "@/lib/wine/supplier-trend-responsive";

export type TrendViewMode = "bar" | "table";
export interface SupplierTrendRow {
  supplierId: string;
  supplierName: string;
  currentAmount: number;
  compareAmount: number;
  cumulativeAmount: number;
}

/**
 * 核心规则：rows 必须来自唯一的只读比较模型；切换视图只改变视图状态，
 * 不重置月份、供应商筛选、对比期或累计/本月指标。
 */
export function WineSupplierTrendSwitcher({
  rows,
  month,
  measureLabel,
  onOpenSupplier,
}: {
  rows: readonly SupplierTrendRow[];
  month: string;
  measureLabel: string;
  onOpenSupplier: (supplierId: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const layout = resolveWineSupplierTrendLayout(width);
  const [viewMode, setViewMode] = useState<TrendViewMode>(layout.mode === "compact" ? "table" : "bar");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const visibleRows = useMemo(() => [...rows].sort((a, b) => b.currentAmount - a.currentAmount), [rows]);
  const maximum = Math.max(1, ...visibleRows.map((row) => row.currentAmount));
  const rowHeight = Math.max(44, 44 * Math.min(fontScale, 1.45));

  const choose = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    onOpenSupplier(supplierId);
  };

  return (
    <View accessibilityLabel={`${month}供应商${measureLabel}趋势`} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <View><Text style={{ fontSize: 17, fontWeight: "700" }}>供应商月度进货趋势</Text><Text style={{ fontSize: 13, color: "#6B7280" }}>{month} · {measureLabel}</Text></View>
        <View style={{ flexDirection: "row", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10 }}>
          {(["bar", "table"] as const).map((mode) => <Pressable key={mode} onPress={() => setViewMode(mode)} style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: viewMode === mode ? "#E8F0FE" : "transparent" }}><Text>{mode === "bar" ? "柱状图" : "表格"}</Text></Pressable>)}
        </View>
      </View>

      {viewMode === "bar" ? (
        <ScrollView horizontal={layout.mode === "compact"} contentContainerStyle={{ minWidth: layout.mode === "compact" ? 520 : undefined, gap: 10 }}>
          {visibleRows.slice(0, layout.maxBars).map((row) => <Pressable key={row.supplierId} onPress={() => choose(row.supplierId)} style={{ width: Math.max(72, Math.floor((Math.max(width, 520) - 40) / layout.maxBars)), height: layout.chartHeight, justifyContent: "flex-end", gap: 8 }}>
            <View style={{ height: `${(row.currentAmount / maximum) * 75}%`, minHeight: 4, backgroundColor: selectedSupplierId === row.supplierId ? "#0A84FF" : "#5E9CFF", borderRadius: 4 }} />
            <Text numberOfLines={2} style={{ fontSize: 12, minHeight: 32 }}>{row.supplierName}</Text><Text style={{ fontSize: 12, color: "#374151" }}>¥{row.currentAmount.toFixed(2)}</Text>
          </Pressable>)}
        </ScrollView>
      ) : (
        <View style={{ borderTopWidth: 1, borderColor: "#E5E7EB" }}>
          {visibleRows.map((row) => <Pressable key={row.supplierId} onPress={() => choose(row.supplierId)} style={{ minHeight: rowHeight, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: "#E5E7EB", gap: 8 }}>
            <Text numberOfLines={2} style={{ flex: 1, fontSize: 14, fontWeight: selectedSupplierId === row.supplierId ? "700" : "500" }}>{row.supplierName}</Text><Text style={{ width: 88, textAlign: "right" }}>¥{row.currentAmount.toFixed(2)}</Text><Text style={{ width: 72, textAlign: "right", color: row.currentAmount >= row.compareAmount ? "#15803D" : "#B91C1C" }}>{row.compareAmount === 0 ? "新增" : `${((row.currentAmount - row.compareAmount) / row.compareAmount * 100).toFixed(1)}%`}</Text>
          </Pressable>)}
        </View>
      )}
    </View>
  );
}

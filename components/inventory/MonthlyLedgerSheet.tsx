/**
 * 月度台账通用组件
 * 展示：期初 → 进货 → 消耗 → 期末 的标准台账行
 * 所有进销存品类共用此组件
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { MonthlyLedgerItem } from "@/lib/inventory-core/types";

interface Props {
  item: MonthlyLedgerItem;
  accentColor?: string;
  /** 是否显示损耗列（杯具/餐具专用） */
  showLoss?: boolean;
}

export function MonthlyLedgerRow({ item, accentColor, showLoss = false }: Props) {
  const colors = useColors();
  const accent = accentColor ?? colors.primary;
  const [expanded, setExpanded] = useState(false);

  const hasMovement = item.purchaseQty > 0 || item.consumeQty > 0 || item.lossQty > 0;
  const isLowClose = item.closingQty === 0;

  return (
    <Pressable onPress={() => setExpanded(!expanded)}
      style={[S.row, { backgroundColor: colors.surface, borderColor: isLowClose ? colors.error + "44" : colors.border }]}>
      {/* 主行 */}
      <View style={S.mainRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[S.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          {item.nameEn ? <Text style={[S.nameEn, { color: colors.muted }]} numberOfLines={1}>{item.nameEn}</Text> : null}
          {item.spec ? <Text style={[S.spec, { color: colors.muted }]}>{item.spec}</Text> : null}
        </View>
        <View style={S.cells}>
          <NumCell label="期初" value={item.openingQty} unit={item.unit} color={colors.muted} />
          <NumCell label="进货" value={item.purchaseQty} unit={item.unit} color={item.purchaseQty > 0 ? accent : colors.muted} />
          <NumCell label="消耗" value={item.consumeQty} unit={item.unit} color={item.consumeQty > 0 ? colors.warning : colors.muted} />
          {showLoss && <NumCell label="损耗" value={item.lossQty} unit={item.unit} color={item.lossQty > 0 ? colors.error : colors.muted} />}
          <NumCell label="期末" value={item.closingQty} unit={item.unit} color={isLowClose ? colors.error : accent} bold />
        </View>
      </View>

      {/* 展开详情 */}
      {expanded && (
        <View style={[S.detail, { borderTopColor: colors.border }]}>
          <DetailRow label="期初单位成本" value={`¥${item.openingUnitCost.toFixed(2)}`} colors={colors} />
          <DetailRow label="期初库存成本" value={`¥${item.openingCost.toFixed(2)}`} colors={colors} />
          <DetailRow label="本月进货成本" value={`¥${item.purchaseCost.toFixed(2)}`} colors={colors} />
          <DetailRow label="本月消耗成本" value={`¥${item.consumeCost.toFixed(2)}`} colors={colors} />
          {showLoss && item.lossQty > 0 && (
            <DetailRow label="损耗金额" value={`¥${item.lossCost.toFixed(2)}`} colors={colors} valueColor={colors.error} />
          )}
          <DetailRow label="期末单位成本" value={`¥${item.closingUnitCost.toFixed(2)}`} colors={colors} />
          <DetailRow label="期末库存成本" value={`¥${item.closingCost.toFixed(2)}`} colors={colors} valueColor={accent} />
          {item.notes ? <DetailRow label="备注" value={item.notes} colors={colors} /> : null}
        </View>
      )}
    </Pressable>
  );
}

function NumCell({ label, value, unit, color, bold = false }: {
  label: string; value: number; unit: string; color: string; bold?: boolean;
}) {
  return (
    <View style={S.cell}>
      <Text style={[S.cellLabel, { color }]}>{label}</Text>
      <Text style={[S.cellValue, { color, fontWeight: bold ? "800" : "600" }]}>{value}</Text>
      <Text style={[S.cellUnit, { color }]}>{unit}</Text>
    </View>
  );
}

function DetailRow({ label, value, colors, valueColor }: {
  label: string; value: string; colors: any; valueColor?: string;
}) {
  return (
    <View style={S.detailRow}>
      <Text style={[S.detailLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[S.detailValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  row: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: "hidden" },
  mainRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  name: { fontSize: 14, fontWeight: "600" },
  nameEn: { fontSize: 11, marginTop: 1 },
  spec: { fontSize: 11, marginTop: 1 },
  cells: { flexDirection: "row", gap: 10 },
  cell: { alignItems: "center", minWidth: 36 },
  cellLabel: { fontSize: 10 },
  cellValue: { fontSize: 15 },
  cellUnit: { fontSize: 9 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6 },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12, fontWeight: "500" },
});

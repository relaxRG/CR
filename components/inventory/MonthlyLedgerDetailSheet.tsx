import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { MonthlyLedgerItem } from "@/lib/inventory-core/types";

interface MonthlyLedgerDetailSheetProps {
  item: MonthlyLedgerItem | null;
  accentColor: string;
  onClose: () => void;
  /** 领域页面可在标准月度摘要下追加安全操作，例如查看商品档案。 */
  footer?: React.ReactNode;
}

/** 通用台账名称详情：桌面宽表与移动端卡片阅读共用同一数据，不引入第二份汇总逻辑。 */
export function MonthlyLedgerDetailSheet({ item, accentColor, onClose, footer }: MonthlyLedgerDetailSheetProps) {
  const colors = useColors();
  if (!item) return null;
  const metrics: [string, string][] = [
    ["期初", `${item.openingQty.toFixed(2)} ${item.unit} · ¥${item.openingCost.toFixed(2)}`],
    ["本月进货", `${item.purchaseQty.toFixed(2)} ${item.unit} · ¥${item.purchaseCost.toFixed(2)}`],
    ["本月消耗", `${item.consumeQty.toFixed(2)} ${item.unit} · ¥${item.consumeCost.toFixed(2)}`],
    ["期末库存", `${item.closingQty.toFixed(2)} ${item.unit} · ¥${item.closingCost.toFixed(2)}`],
  ];
  if (item.lossQty > 0) metrics.splice(3, 0, ["损耗", `${item.lossQty.toFixed(2)} ${item.unit} · ¥${item.lossCost.toFixed(2)}`]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={S.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View testID="generic-ledger-detail-sheet" style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={S.handle} />
          <View style={S.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 19, fontWeight: "800" }}>{item.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>{item.category || "未分类"}{item.spec ? ` · ${item.spec}` : ""}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}><IconSymbol name="xmark" size={18} color={colors.muted} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            {metrics.map(([label, value]) => <View key={label} style={[S.metric, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "800" }}>{value}</Text></View>)}
            <View style={[S.metric, { backgroundColor: accentColor + "12", borderColor: accentColor + "33" }]}><Text style={{ color: accentColor, fontSize: 13 }}>期末单位成本</Text><Text style={{ color: accentColor, fontSize: 14, fontWeight: "800" }}>¥{item.closingUnitCost.toFixed(2)}</Text></View>
            {item.notes ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>备注：{item.notes}</Text> : null}
            {footer}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.42)" },
  sheet: { maxHeight: "82%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingBottom: 16 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#94A3B8", marginTop: 10, marginBottom: 12 },
  header: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 12 },
  metric: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginTop: 8 },
});

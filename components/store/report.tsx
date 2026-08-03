/**
 * 月度总报表
 * 功能：月份筛选 + 跳转月度经营分析 + 跳转月度总报表导入
 */
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { MonthlySummaryReport } from "@/lib/store/monthly-summary/types";
import { usePettyCashStore } from "@/lib/store/petty-store";

function getRecentMonths(count = 12): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export default function StoreReportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const currentMonth = new Date().toISOString().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const recentMonths = getRecentMonths(12);

  const { reports } = useMonthlySummaryStore();
  const selectedSummary = reports?.find?.((s: MonthlySummaryReport) => s.month === selectedMonth);
  const { calcPeriod } = usePettyCashStore();
  const pettyData = calcPeriod(selectedMonth);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 16 }}>

      {/* 月份选择器 */}
      <View>
        <Text style={[S.sectionTitle, { color: colors.muted }]}>选择月份</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {recentMonths.map((month) => {
            const active = selectedMonth === month;
            const           hasSummary = (reports ?? []).some((s: MonthlySummaryReport) => s.month === month);
            return (
              <Pressable key={month} onPress={() => { tap(); setSelectedMonth(month); }}
                style={[S.monthChip, {
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : hasSummary ? colors.primary + "55" : colors.border,
                }]}>
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? "#fff" : colors.foreground }}>
                  {month}
                </Text>
                {hasSummary && !active && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 2 }} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 选中月份摘要 */}
      {selectedSummary ? (
        <View style={[S.summaryCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary, marginBottom: 10 }}>
            {`${Number(selectedMonth.slice(5, 7))}月报表`}
          </Text>
          {[
            { label: "营业收入", value: selectedSummary.totalRevenue != null ? `¥${selectedSummary.totalRevenue.toFixed(0)}` : "-", color: colors.success },
            { label: "进货成本", value: selectedSummary.totalCOGS != null ? `¥${selectedSummary.totalCOGS.toFixed(0)}` : "-", color: colors.warning },
            { label: "人工成本", value: selectedSummary.totalLabor != null ? `¥${selectedSummary.totalLabor.toFixed(0)}` : "-", color: "#6366F1" },
            { label: "房租", value: selectedSummary.totalRent != null ? `¥${selectedSummary.totalRent.toFixed(0)}` : "-", color: "#F59E0B" },
            { label: "净利润", value: selectedSummary.netProfit != null ? `¥${selectedSummary.netProfit.toFixed(0)}` : "-", color: selectedSummary.netProfit != null && selectedSummary.netProfit >= 0 ? colors.success : colors.error },
            { label: "备用金支出", value: pettyData.expense > 0 ? `¥${pettyData.expense.toFixed(0)}` : "-", color: colors.muted },
            { label: "备用金期末", value: `¥${pettyData.closingBalance.toFixed(0)}`, color: pettyData.closingBalance >= 0 ? colors.success : colors.error },
          ].map((row, i) => (
            <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: i < 6 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 14, color: colors.muted }}>{row.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: row.color }}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={[S.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>
            {selectedMonth} 暂无月度报表数据
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 4 }}>
            导入月度营业数据后自动生成
          </Text>
          {pettyData.expense > 0 && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, width: "100%" }}>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginBottom: 6 }}>备用金数据（已有记录）</Text>
              {[
                { label: "备用金支出", value: `¥${pettyData.expense.toFixed(0)}`, color: colors.error },
                { label: "备用金期末", value: `¥${pettyData.closingBalance.toFixed(0)}`, color: pettyData.closingBalance >= 0 ? colors.success : colors.error },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: row.color }}>{row.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* 功能入口 */}
      <Text style={[S.sectionTitle, { color: colors.muted }]}>报表功能</Text>
      <View style={[S.entryGroup, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {[
          {
            icon: "chart.bar.doc.horizontal.fill", color: "#007AFF",
            title: `${Number(selectedMonth.slice(5, 7))}月报表`, sub: "导入营业数据 · 生成当月汇总",
            route: "/monthly-summary",
          },
          {
            icon: "arrow.down.doc.fill", color: "#34C759",
            title: "导入营业数据", sub: "上传月度营业 Excel",
            route: "/monthly-report-import",
          },
          {
            icon: "chart.line.uptrend.xyaxis", color: "#FF9500",
            title: "店铺月度经营分析", sub: "收入 · 成本 · 利润趋势",
            route: "/monthly-report",
          },
          {
            icon: "clock.arrow.2.circlepath", color: "#AF52DE",
            title: "时段营业分析", sub: "各时段营业数据对比",
            route: "/period-analysis",
          },
        ].map((item, i, arr) => (
          <Pressable key={item.route} onPress={() => { tap(); router.push(item.route as any); }}
            style={({ pressed }) => [{
              flexDirection: "row" as const, alignItems: "center" as const, gap: 12, padding: 14,
              borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            }]}>
            <View style={[S.entryIcon, { backgroundColor: item.color + "22" }]}>
              <IconSymbol name={item.icon as any} size={20} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{item.sub}</Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  monthChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", minWidth: 80 },
  summaryCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  emptyCard: { borderRadius: 14, borderWidth: 1, padding: 20, alignItems: "center" },
  entryGroup: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  entryIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});

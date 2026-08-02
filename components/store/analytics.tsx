/**
 * 经营分析（成本对比：烈酒/葡萄酒/餐食/备用金，支持天/周/月/年/上期对比）
 */
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { useEmployeeStore, usePaySlipStore } from "@/lib/labor/store";
import { useRevenueStore, REVENUE_CATEGORY_LABELS, RevenueCategory } from "@/lib/store/revenue-store";
import { usePettyCashStore, PETTY_GROUPS } from "@/lib/store/petty-store";

type Period = "day" | "week" | "month" | "year";
type CompareMode = "none" | "prev";

const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "year", label: "今年" },
];

function getRange(period: Period, offset = 0): { start: Date; end: Date } {
  const now = new Date();
  const s = new Date(now);
  const e = new Date(now);
  if (period === "day") {
    s.setDate(now.getDate() - offset); s.setHours(0, 0, 0, 0);
    e.setDate(now.getDate() - offset); e.setHours(23, 59, 59, 999);
  } else if (period === "week") {
    const dow = now.getDay();
    s.setDate(now.getDate() - dow - offset * 7); s.setHours(0, 0, 0, 0);
    e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999);
  } else if (period === "month") {
    s.setMonth(now.getMonth() - offset, 1); s.setHours(0, 0, 0, 0);
    e.setMonth(s.getMonth() + 1, 0); e.setHours(23, 59, 59, 999);
  } else {
    s.setFullYear(now.getFullYear() - offset, 0, 1); s.setHours(0, 0, 0, 0);
    e.setFullYear(s.getFullYear(), 11, 31); e.setHours(23, 59, 59, 999);
  }
  return { start: s, end: e };
}

export default function StoreAnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>("month");
  const [compare, setCompare] = useState<CompareMode>("prev");
    const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const router = useRouter();
  const { reports: monthlyReports } = useMonthlyReportStore();
  const { employees } = useEmployeeStore();
  const { paySlips } = usePaySlipStore();
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLaborCost = paySlips.filter((s) => s.month === currentMonthStr).reduce((sum, s) => sum + s.finalSalary, 0);
  const { records } = useRevenueStore();
  const { records: pettyRecords } = usePettyCashStore();

  const { start: curStart, end: curEnd } = useMemo(() => getRange(period, 0), [period]);
  const { start: prevStart, end: prevEnd } = useMemo(() => getRange(period, 1), [period]);

  const calcSummary = (start: Date, end: Date) => {
    const map: Partial<Record<RevenueCategory, number>> = {};
    records.filter((r) => { const d = new Date(r.date); return d >= start && d <= end; })
      .forEach((r) => { map[r.category] = (map[r.category] ?? 0) + r.amount; });
    const pettyTotal = pettyRecords.filter((r) => { const d = new Date(r.date); return d >= start && d <= end; })
      .reduce((s, r) => s + r.amount, 0);
    map.petty_cash = (map.petty_cash ?? 0) + pettyTotal;
    return map;
  };

  const cur = useMemo(() => calcSummary(curStart, curEnd), [records, pettyRecords, curStart, curEnd]);
  const prev = useMemo(() => calcSummary(prevStart, prevEnd), [records, pettyRecords, prevStart, prevEnd]);

  const totalRevCur = cur.revenue ?? 0;
  const totalCostCur = Object.entries(cur).filter(([k]) => k !== "revenue").reduce((s, [, v]) => s + (v ?? 0), 0);
  const profitCur = totalRevCur - totalCostCur;

  const totalRevPrev = prev.revenue ?? 0;
  const totalCostPrev = Object.entries(prev).filter(([k]) => k !== "revenue").reduce((s, [, v]) => s + (v ?? 0), 0);
  const profitPrev = totalRevPrev - totalCostPrev;

  const costCategories: RevenueCategory[] = ["food_cost", "spirit_cost", "wine_cost", "petty_cash", "labor_cost", "rent", "utilities", "operations"];

  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return null;
    return ((cur - prev) / prev * 100).toFixed(1);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      {/* 月度经营分析入口 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <Pressable
          onPress={() => { tap(); router.push("/monthly-report" as any); }}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33",
            borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <IconSymbol name="chart.bar.fill" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>店铺月度经营分析</Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
              {monthlyReports.length > 0
                ? `已有 ${monthlyReports.length} 份月度报告 · 最新：${monthlyReports[0].monthLabel}`
                : "导入美团收银报表，查看完整经营分析"}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={14} color={colors.primary} />
        </Pressable>
        {/* 人工成本入口 */}
        <Pressable
          onPress={() => { tap(); router.push("/labor" as any); }}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: "#FF9500" + "0e", borderColor: "#FF9500" + "33",
            borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.7 : 1, marginTop: 8,
          })}
        >
          <IconSymbol name="person.2.fill" size={18} color="#FF9500" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#FF9500" }}>人工成本管理</Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
              {employees.filter((e) => e.active).length > 0
                ? `${employees.filter((e) => e.active).length} 名员工 · 本月薪资${monthLaborCost > 0 ? ` ¥${monthLaborCost.toFixed(0)}` : "未填写"}`
                : "排班表 / 考勤工资 / 薪资汇总"}
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={14} color="#FF9500" />
        </Pressable>
        {/* 时段分析入口 */}
        <Pressable
          onPress={() => { tap(); router.push("/period-analysis" as any); }}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: "#007AFF" + "0e", borderColor: "#007AFF" + "33",
            borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.7 : 1, marginTop: 8,
          })}
        >
          <Text style={{ fontSize: 18 }}>🕐</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#007AFF" }}>时段营业分析</Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>凌晨开台 · 加班性价比提醒 · 半小时热力图</Text>
          </View>
          <IconSymbol name="chevron.right" size={14} color="#007AFF" />
        </Pressable>
        {/* 啤酒冰块进销存入口 */}
        <Pressable
          onPress={() => { tap(); router.push("/beer-ice-inventory" as any); }}
          style={({ pressed }) => ({
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: "#F4A300" + "0e", borderColor: "#F4A300" + "33",
            borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.7 : 1, marginTop: 8,
          })}
        >
          <Text style={{ fontSize: 18 }}>🍺</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#F4A300" }}>啤酒 & 冰块进销存</Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>自采备用金 B1/B2/B3 自动识别 · 库存预警</Text>
          </View>
          <IconSymbol name="chevron.right" size={14} color="#F4A300" />
        </Pressable>
      </View>
      {/* 时间段 + 对比 */}
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <Pressable key={p.key} onPress={() => { tap(); setPeriod(p.key); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}>
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {(["none", "prev"] as CompareMode[]).map((m) => (
            <Pressable key={m} onPress={() => { tap(); setCompare(m); }}
              style={[styles.compareChip, { borderColor: compare === m ? colors.primary : colors.border, backgroundColor: compare === m ? colors.primary + "22" : colors.surface }]}>
              <Text style={{ color: compare === m ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>
                {m === "none" ? "不对比" : "与上期对比"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 总览卡片 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <View style={[styles.overviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {[
            { label: "营收", cur: totalRevCur, prev: totalRevPrev, isRevenue: true },
            { label: "总成本", cur: totalCostCur, prev: totalCostPrev, isRevenue: false },
            { label: "利润", cur: profitCur, prev: profitPrev, isRevenue: profitCur >= 0 },
          ].map((item, i, arr) => {
            const pct = compare === "prev" ? pctChange(item.cur, item.prev) : null;
            return (
              <React.Fragment key={item.label}>
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewLabel, { color: colors.muted }]}>{item.label}</Text>
                  <Text style={[styles.overviewValue, { color: item.isRevenue ? colors.success : colors.error }]}>
                    ¥{item.cur.toFixed(0)}
                  </Text>
                  {pct !== null && (
                    <Text style={[styles.overviewPct, { color: parseFloat(pct) > 0 ? colors.success : colors.error }]}>
                      {parseFloat(pct) > 0 ? "▲" : "▼"}{Math.abs(parseFloat(pct))}%
                    </Text>
                  )}
                </View>
                {i < arr.length - 1 && <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: "stretch" }} />}
              </React.Fragment>
            );
          })}
        </View>
      </View>

      {/* 成本明细 */}
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>成本明细</Text>
        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {costCategories.map((cat, i) => {
            const curVal = cur[cat] ?? 0;
            const prevVal = prev[cat] ?? 0;
            const pct = compare === "prev" ? pctChange(curVal, prevVal) : null;
            if (curVal === 0 && prevVal === 0) return null;
            return (
              <React.Fragment key={cat}>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.foreground }]}>{REVENUE_CATEGORY_LABELS[cat]}</Text>
                  <Text style={[styles.detailValue, { color: colors.error }]}>¥{curVal.toFixed(0)}</Text>
                  {compare === "prev" && (
                    <Text style={[styles.detailPrev, { color: colors.muted }]}>上期 ¥{prevVal.toFixed(0)}</Text>
                  )}
                  {pct !== null && (
                    <Text style={[styles.detailPct, { color: parseFloat(pct) > 0 ? colors.error : colors.success }]}>
                      {parseFloat(pct) > 0 ? "▲" : "▼"}{Math.abs(parseFloat(pct))}%
                    </Text>
                  )}
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 }} />
              </React.Fragment>
            );
          })}
          {costCategories.every((cat) => (cur[cat] ?? 0) === 0) && (
            <Text style={[styles.emptyText, { color: colors.muted }]}>暂无数据</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  compareChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  overviewCard: { borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: "row", justifyContent: "space-around" },
  overviewItem: { alignItems: "center", gap: 4 },
  overviewLabel: { fontSize: 13 },
  overviewValue: { fontSize: 20, fontWeight: "700" },
  overviewPct: { fontSize: 12, fontWeight: "600" },
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 8, marginLeft: 4 },
  detailCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  detailRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  detailLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  detailValue: { fontSize: 15, fontWeight: "600" },
  detailPrev: { fontSize: 12 },
  detailPct: { fontSize: 12, fontWeight: "600" },
  emptyText: { padding: 16, fontSize: 14 },
});

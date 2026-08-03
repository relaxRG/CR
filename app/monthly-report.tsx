/**
 * 店铺月度经营分析主页面
 * 参考 predawn 美团收银系统 UI 设计
 *
 * 模块：
 * 1. KPI 总览（营业收入/营业额/订单量/优惠金额/消费桌数/赠菜/退菜/人均）
 * 2. 收入构成（环形图 + 收款方式列表）
 * 3. 菜品大类（横向条形图 + 列表，含同比/环比变化）
 * 4. Top 菜品（销售额排行）
 * 5. 日度营收趋势（折线图）
 * 6. 退菜排行
 * 7. 顾客数据
 * 8. 业务洞察（自动生成）
 * 9. 历史月份快照选择
 */
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import {
  MonthlyReport, DishCategory, PaymentMethod, DailyRevenue,
  generateInsights, BusinessInsight
} from "@/lib/store/monthly-report/types";

// ─── 颜色映射 ─────────────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  "Food": "#FF9500",
  "House Cocktail": "#007AFF",
  "Classic Cocktail": "#5856D6",
  "House wine": "#FF2D55",
  "White wine list": "#34C759",
  "Beer": "#FFCC00",
  "Straight-up": "#FF6B35",
  "Shot": "#AF52DE",
  "Beverage": "#32ADE6",
  "Set Menu": "#30B0C7",
  "Custom Cocktail": "#FF375F",
  "美团团购套餐": "#FF9F0A",
  "Red wine list": "#C0392B",
};

const PAYMENT_COLORS = ["#FF9500", "#007AFF", "#34C759", "#5856D6", "#FF2D55", "#FFCC00", "#AF52DE"];

function catColor(name: string): string {
  return CATEGORY_COLORS[name] ?? "#8E8E93";
}

// ─── KPI 卡片 ─────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, vsValue, colors, highlight = false
}: {
  label: string; value: string; vsValue?: number; colors: any; highlight?: boolean;
}) {
  const isUp = (vsValue ?? 0) >= 0;
  const hasVs = vsValue !== undefined && vsValue !== 0;
  return (
    <View style={[S.kpiCard, {
      backgroundColor: highlight ? colors.primary + "10" : colors.surface,
      borderColor: highlight ? colors.primary + "44" : colors.border,
    }]}>
      <Text style={[S.kpiLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[S.kpiValue, { color: highlight ? colors.primary : colors.foreground }]} numberOfLines={1}>{value}</Text>
      {hasVs && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 }}>
          <Text style={{ fontSize: 10, color: isUp ? colors.error : colors.success }}>
            {isUp ? "▲" : "▼"} {isUp ? "+" : ""}{vsValue!.toFixed(0)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── 环形图（收入构成） ───────────────────────────────────────────────────────
function DonutChart({ data, total, colors }: {
  data: { name: string; value: number; color: string }[];
  total: number;
  colors: any;
}) {
  const SIZE = 160;
  const cx = SIZE / 2, cy = SIZE / 2;
  const R = 58, r = 36;
  let startAngle = -Math.PI / 2;

  const segments = data.map((d) => {
    const angle = (d.value / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const ix1 = cx + r * Math.cos(startAngle);
    const iy1 = cy + r * Math.sin(startAngle);
    const ix2 = cx + r * Math.cos(endAngle);
    const iy2 = cy + r * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z`;
    const result = { ...d, path, startAngle, endAngle };
    startAngle = endAngle;
    return result;
  });

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={SIZE} height={SIZE}>
        {segments.map((seg, i) => (
          <Path key={i} d={seg.path} fill={seg.color} />
        ))}
        <SvgText x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill={colors.muted}>营业收入</SvgText>
        <SvgText x={cx} y={cy + 10} textAnchor="middle" fontSize={13} fontWeight="bold" fill={colors.foreground}>
          {total >= 10000 ? `${(total / 10000).toFixed(1)}万` : total.toFixed(0)}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─── 日度趋势折线图 ───────────────────────────────────────────────────────────
function DailyTrendChart({ dailies, colors }: { dailies: DailyRevenue[]; colors: any }) {
  if (dailies.length === 0) return null;
  const W = 340, H = 120, PAD = { t: 10, b: 24, l: 44, r: 10 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const maxVal = Math.max(...dailies.map((d) => d.total), 1);
  const minVal = 0;
  const range = maxVal - minVal;

  const pts = dailies.map((d, i) => {
    const x = PAD.l + (i / Math.max(dailies.length - 1, 1)) * chartW;
    const y = PAD.t + chartH - ((d.total - minVal) / range) * chartH;
    return { x, y, d };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");

  // Y 轴刻度
  const yTicks = [0, maxVal * 0.5, maxVal].map((v) => ({
    y: PAD.t + chartH - ((v - minVal) / range) * chartH,
    label: v >= 10000 ? `${(v / 10000).toFixed(1)}w` : v.toFixed(0),
  }));

  // X 轴标签（每5天一个）
  const xLabels = pts.filter((_, i) => i % 5 === 0 || i === pts.length - 1).map((p) => ({
    x: p.x,
    label: p.d.date.slice(8),
  }));

  return (
    <Svg width={W} height={H}>
      {/* 网格线 */}
      {yTicks.map((t, i) => (
        <Line key={i} x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y}
          stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
      ))}
      {/* Y 轴标签 */}
      {yTicks.map((t, i) => (
        <SvgText key={i} x={PAD.l - 4} y={t.y + 4} textAnchor="end" fontSize={9} fill={colors.muted}>{t.label}</SvgText>
      ))}
      {/* X 轴标签 */}
      {xLabels.map((l, i) => (
        <SvgText key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize={9} fill={colors.muted}>{l.label}</SvgText>
      ))}
      {/* 折线 */}
      <Polyline points={polyline} fill="none" stroke={colors.primary} strokeWidth={2} strokeLinejoin="round" />
      {/* 数据点 */}
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={colors.primary} />
      ))}
    </Svg>
  );
}

// ─── 菜品大类条形图 ───────────────────────────────────────────────────────────
function CategoryBar({ cat, maxAmount, colors }: {
  cat: DishCategory; maxAmount: number; colors: any;
}) {
  const color = catColor(cat.name);
  const barPct = maxAmount > 0 ? cat.salesAmount / maxAmount : 0;
  const isUp = (cat.vsAmount ?? 0) >= 0;
  const hasVs = cat.vsAmount !== undefined && cat.vsAmount !== 0;

  return (
    <View style={[S.catBarRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <View style={[S.catDot, { backgroundColor: color }]} />
          <Text style={[S.catBarName, { color: colors.foreground }]} numberOfLines={1}>{cat.name}</Text>
          {hasVs && (
            <Text style={{ fontSize: 11, fontWeight: "600", color: isUp ? colors.error : colors.success }}>
              {isUp ? "+" : ""}{cat.vsAmount!.toFixed(0)}
            </Text>
          )}
        </View>
        <View style={[S.barTrack, { backgroundColor: colors.border + "66" }]}>
          <View style={[S.barFill, { backgroundColor: color, width: `${(barPct * 100).toFixed(1)}%` as any }]} />
        </View>
      </View>
      <View style={{ alignItems: "flex-end", marginLeft: 10, minWidth: 80 }}>
        <Text style={[S.catBarAmt, { color: colors.foreground }]}>¥{cat.salesAmount.toFixed(0)}</Text>
        <Text style={[S.catBarPct, { color: colors.muted }]}>{(cat.salesAmountPct * 100).toFixed(1)}%</Text>
      </View>
    </View>
  );
}

// ─── 业务洞察卡片 ─────────────────────────────────────────────────────────────
function InsightCard({ insight, colors }: { insight: BusinessInsight; colors: any }) {
  const iconMap = {
    growth: { icon: "arrow.up.circle.fill" as const, color: colors.success },
    decline: { icon: "arrow.down.circle.fill" as const, color: colors.error },
    alert: { icon: "exclamationmark.triangle.fill" as const, color: colors.warning },
    info: { icon: "info.circle.fill" as const, color: colors.primary },
  };
  const { icon, color } = iconMap[insight.type];
  return (
    <View style={[S.insightCard, { backgroundColor: color + "0e", borderColor: color + "33" }]}>
      <IconSymbol name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[S.insightTitle, { color: colors.foreground }]}>{insight.title}</Text>
        <Text style={[S.insightDesc, { color: colors.muted }]}>{insight.desc}</Text>
      </View>
      {insight.value && (
        <Text style={[S.insightValue, { color }]}>{insight.value}</Text>
      )}
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function MonthlyReportScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { reports, deleteReport } = useMonthlyReportStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const report: MonthlyReport | null = useMemo(() => {
    if (selectedId) return reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;
    return reports[0] ?? null;
  }, [reports, selectedId]);

  const insights = useMemo(() => report ? generateInsights(report) : [], [report]);

  // 收入构成环形图数据
  const donutData = useMemo(() => {
    if (!report) return [];
    return report.paymentMethods
      .filter((p) => p.amount > 0)
      .slice(0, 6)
      .map((p, i) => ({ name: p.name, value: p.amount, color: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }));
  }, [report]);

  const maxCatAmount = useMemo(() =>
    Math.max(...(report?.dishCategories.map((c) => c.salesAmount) ?? [1])),
    [report]
  );

  const handleDelete = (id: string, label: string) => {
    Alert.alert("删除报告", `确认删除「${label}」的月度报告？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteReport(id); setSelectedId(null); } },
    ]);
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>
            {report ? report.monthLabel : "月度经营分析"}
          </Text>
          {report && (
            <Text style={{ fontSize: 11, color: colors.muted }}>predawn</Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={() => { tap(); router.push("/dish-analysis" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.grid.2x2.fill" size={20} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => { tap(); router.push("/monthly-report-import" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.and.arrow.down.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* 月份选择器 */}
      {reports.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
          {reports.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => { tap(); setSelectedId(r.id); }}
              style={[S.monthChip, {
                backgroundColor: (report?.id === r.id) ? colors.primary : colors.surface,
                borderColor: (report?.id === r.id) ? colors.primary : colors.border,
              }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: (report?.id === r.id) ? "#fff" : colors.muted }}>
                {r.monthLabel}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 无数据 */}
      {!report && (
        <View style={S.emptyWrap}>
          <IconSymbol name="chart.bar.fill" size={56} color={colors.border} />
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无经营分析数据</Text>
          <Text style={[S.emptyDesc, { color: colors.muted }]}>点击右上角导入按钮，上传美团收银报表</Text>
          <Pressable onPress={() => { tap(); router.push("/monthly-report-import" as any); }}
            style={[S.importBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="square.and.arrow.down.fill" size={16} color="#fff" />
            <Text style={S.importBtnText}>导入报表</Text>
          </Pressable>
        </View>
      )}

      {report && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>

          {/* ── 1. KPI 总览 ── */}
          <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={S.sectionHeader}>
              <Text style={[S.sectionTitle, { color: colors.foreground }]}>营业概览</Text>
              <Text style={[S.sectionSub, { color: colors.muted }]}>同比去年{report.monthLabel.slice(-2)}</Text>
            </View>

            {/* 营业收入大卡 */}
            <View style={[S.revenueCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
              <Text style={[S.revenueLabel, { color: colors.muted }]}>营业收入</Text>
              <Text style={[S.revenueValue, { color: colors.foreground }]}>
                ¥{report.kpi.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
              </Text>
              {report.kpi.revenueVs !== undefined && (
                <Text style={{ fontSize: 13, color: (report.kpi.revenueVs ?? 0) >= 0 ? colors.error : colors.success, marginTop: 2 }}>
                  较对比周期 {(report.kpi.revenueVs ?? 0) >= 0 ? "+" : ""}{report.kpi.revenueVs!.toFixed(2)}
                </Text>
              )}
            </View>

            {/* KPI 网格 */}
            <View style={S.kpiGrid}>
              <KpiCard label="营业额" value={`¥${report.kpi.turnover.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`}
                vsValue={report.kpi.turnoverVs} colors={colors} />
              <KpiCard label="订单量" value={String(report.kpi.orderCount)}
                vsValue={report.kpi.orderCountVs} colors={colors} />
              <KpiCard label="优惠金额" value={`¥${report.kpi.discountAmount.toFixed(0)}`}
                vsValue={report.kpi.discountAmountVs} colors={colors} />
              <KpiCard label="优惠占比" value={`${(report.kpi.discountRate * 100).toFixed(2)}%`} colors={colors} />
              <KpiCard label="消费桌数" value={String(report.kpi.tableCount)}
                vsValue={report.kpi.tableCountVs} colors={colors} />
              <KpiCard label="赠菜数量" value={String(report.kpi.giftDishCount)}
                vsValue={report.kpi.giftDishCountVs} colors={colors} />
              <KpiCard label="退菜数量" value={String(report.kpi.returnDishCount)} colors={colors} />
              <KpiCard label="反结单量" value={String(report.kpi.refundOrderCount)}
                vsValue={report.kpi.refundOrderCountVs} colors={colors} />
              <KpiCard label="非会员人均" value={`¥${report.kpi.avgSpendPerPerson.toFixed(2)}`} colors={colors} />
              <KpiCard label="菜品销量" value={`${report.kpi.dishSalesCount}份`} colors={colors} />
            </View>
          </View>

          {/* ── 2. 收入构成（环形图） ── */}
          {donutData.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>收入构成</Text>
                <Text style={[S.sectionSub, { color: colors.muted }]}>结账方式</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <DonutChart data={donutData} total={report.kpi.revenue} colors={colors} />
                <View style={{ flex: 1, gap: 6 }}>
                  {donutData.map((d, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color }} />
                      <Text style={{ fontSize: 11, color: colors.muted, flex: 1 }} numberOfLines={1}>{d.name}</Text>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>
                        {(d.value / report.kpi.revenue * 100).toFixed(1)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* 收款方式列表 */}
              <View style={[S.payList, { borderTopColor: colors.border }]}>
                {report.paymentMethods.filter((p) => p.amount > 0).map((p, i) => (
                  <View key={i} style={[S.payRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PAYMENT_COLORS[i % PAYMENT_COLORS.length] }} />
                      <Text style={[S.payName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                    </View>
                    <Text style={[S.payAmt, { color: colors.foreground }]}>¥{p.amount.toFixed(2)}</Text>
                    <Text style={[S.payPct, { color: colors.muted }]}>{(p.pct * 100).toFixed(1)}%</Text>
                    {p.vsAmount !== undefined && p.vsAmount !== 0 && (
                      <Text style={{ fontSize: 11, color: p.vsAmount >= 0 ? colors.error : colors.success, width: 70, textAlign: "right" }}>
                        {p.vsAmount >= 0 ? "+" : ""}{p.vsAmount.toFixed(0)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── 3. 菜品大类 ── */}
          {report.dishCategories.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>菜品大类</Text>
                <Text style={[S.sectionSub, { color: colors.muted }]}>按销售额排序</Text>
              </View>
              {report.dishCategories.map((cat, i) => (
                <CategoryBar key={i} cat={cat} maxAmount={maxCatAmount} colors={colors} />
              ))}
            </View>
          )}

          {/* ── 4. Top 菜品 ── */}
          {report.topDishes.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>菜品销售排行</Text>
                <Text style={[S.sectionSub, { color: colors.muted }]}>Top {Math.min(report.topDishes.length, 15)}</Text>
              </View>
              {report.topDishes.slice(0, 15).map((dish, i) => (
                <View key={i} style={[S.dishRow, { borderBottomColor: colors.border }]}>
                  <View style={[S.dishRank, {
                    backgroundColor: i < 3 ? colors.primary : colors.border + "55",
                  }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: i < 3 ? "#fff" : colors.muted }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.dishName, { color: colors.foreground }]} numberOfLines={1}>{dish.name}</Text>
                    <Text style={[S.dishMeta, { color: colors.muted }]}>
                      {dish.salesQty}份 · {dish.status} · 优惠¥{dish.discountAmount.toFixed(0)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[S.dishAmt, { color: colors.foreground }]}>¥{dish.salesAmount.toFixed(0)}</Text>
                    <Text style={[S.dishPct, { color: colors.muted }]}>{(dish.salesAmountPct * 100).toFixed(1)}%</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* ── 5. 日度营收趋势 ── */}
          {report.dailyRevenues.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>日度营收趋势</Text>
                <Text style={[S.sectionSub, { color: colors.muted }]}>{report.dailyRevenues.length}天</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <DailyTrendChart dailies={report.dailyRevenues} colors={colors} />
              </ScrollView>
              {/* 日度数据列表 */}
              <View style={[S.dailyList, { borderTopColor: colors.border }]}>
                {report.dailyRevenues.slice().reverse().slice(0, 7).map((d, i) => (
                  <View key={i} style={[S.dailyRow, { borderBottomColor: colors.border }]}>
                    <Text style={[S.dailyDate, { color: colors.muted }]}>{d.date.slice(5)}</Text>
                    <Text style={[S.dailyTotal, { color: colors.foreground }]}>¥{d.total.toFixed(0)}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Text style={{ fontSize: 10, color: "#FF9500" }}>微信¥{d.wechat.toFixed(0)}</Text>
                      <Text style={{ fontSize: 10, color: "#007AFF" }}>支付宝¥{d.alipay.toFixed(0)}</Text>
                      {d.meituan > 0 && <Text style={{ fontSize: 10, color: "#FF6B35" }}>美团¥{d.meituan.toFixed(0)}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── 6. 退菜排行 ── */}
          {report.returnDishes.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>退菜排行</Text>
                <Text style={[S.sectionSub, { color: colors.muted }]}>共{report.kpi.returnDishCount}份</Text>
              </View>
              {report.returnDishes.map((d, i) => (
                <View key={i} style={[S.dishRow, { borderBottomColor: colors.border }]}>
                  <View style={[S.dishRank, { backgroundColor: colors.error + "22" }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.error }}>{i + 1}</Text>
                  </View>
                  <Text style={[S.dishName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{d.name}</Text>
                  <Text style={[S.dishAmt, { color: colors.error }]}>{d.count}份</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── 7. 顾客数据 ── */}
          <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={S.sectionHeader}>
              <Text style={[S.sectionTitle, { color: colors.foreground }]}>顾客数据</Text>
            </View>
            <View style={S.kpiGrid}>
              <KpiCard label="会员营业额占比" value={`${(report.customerStats.memberRevenuePct * 100).toFixed(2)}%`} colors={colors} />
              <KpiCard label="非会员人均" value={`¥${report.customerStats.nonMemberAvgSpend.toFixed(2)}`} colors={colors} />
              <KpiCard label="新增会员" value={`${report.customerStats.newMembers}人`} colors={colors} />
              <KpiCard label="会员消费笔数" value={`${report.customerStats.memberOrderCount}笔`} colors={colors} />
              <KpiCard label="储值余额消费" value={`¥${report.customerStats.storedBalanceConsume.toFixed(2)}`} colors={colors} />
              <KpiCard label="积分赠送" value={`${report.customerStats.pointsEarned}分`} colors={colors} />
            </View>
          </View>

          {/* ── 8. 业务洞察 ── */}
          {insights.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>业务洞察</Text>
                <IconSymbol name="sparkles" size={14} color={colors.primary} />
              </View>
              {insights.map((ins, i) => (
                <InsightCard key={i} insight={ins} colors={colors} />
              ))}
            </View>
          )}

          {/* ── 9b. 多月对比 ── */}
          {reports.length >= 2 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>多月趋势对比</Text>
                <Pressable onPress={() => { tap(); router.push("/dish-analysis" as any); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.primary }}>菜品对比</Text>
                  <IconSymbol name="chevron.right" size={12} color={colors.primary} />
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {reports.slice().sort((a, b) => a.monthLabel.localeCompare(b.monthLabel)).map((r) => (
                    <TouchableOpacity key={r.id} onPress={() => { tap(); setSelectedId(r.id); }}
                      style={[{ borderRadius: 10, borderWidth: 1, padding: 10, minWidth: 110,
                        borderColor: r.id === report.id ? colors.primary : colors.border,
                        backgroundColor: r.id === report.id ? colors.primary + "0a" : colors.background }]}>
                      <Text style={{ fontSize: 11, color: r.id === report.id ? colors.primary : colors.muted, marginBottom: 4 }}>{r.monthLabel}</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: r.id === report.id ? colors.primary : colors.foreground }}>¥{(r.kpi.revenue / 10000).toFixed(1)}w</Text>
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{r.kpi.orderCount}单 · 均¥{r.kpi.avgSpendPerPerson.toFixed(0)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── 9. 历史快照 ── */}
          {reports.length > 0 && (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <Text style={[S.sectionTitle, { color: colors.foreground }]}>历史月份（{reports.length}份）</Text>
              </View>
              {reports.map((r) => (
                <View key={r.id} style={[S.historyRow, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity onPress={() => { tap(); setSelectedId(r.id); }} style={{ flex: 1 }}>
                    <Text style={[S.historyMonth, { color: r.id === report.id ? colors.primary : colors.foreground }]}>{r.monthLabel}</Text>
                    <Text style={[S.historyMeta, { color: colors.muted }]}>
                      营业收入 ¥{r.kpi.revenue.toFixed(0)} · 订单 {r.kpi.orderCount}单 · {r.importedAt.slice(0, 10)}
                    </Text>
                  </TouchableOpacity>
                  <Pressable onPress={() => handleDelete(r.id, r.monthLabel)} style={{ padding: 8 }}>
                    <IconSymbol name="trash" size={14} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  section: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  sectionSub: { fontSize: 12 },
  revenueCard: { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12 },
  revenueLabel: { fontSize: 12 },
  revenueValue: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpiCard: { borderRadius: 10, borderWidth: 1, padding: 10, width: "47%", minWidth: 120 },
  kpiLabel: { fontSize: 11, marginBottom: 4 },
  kpiValue: { fontSize: 16, fontWeight: "700" },
  payList: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  payRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  payName: { fontSize: 13, flex: 1 },
  payAmt: { fontSize: 13, fontWeight: "600", marginRight: 8 },
  payPct: { fontSize: 12, width: 44, textAlign: "right" },
  catBarRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catBarName: { fontSize: 13, fontWeight: "500", flex: 1 },
  catBarAmt: { fontSize: 14, fontWeight: "700" },
  catBarPct: { fontSize: 11 },
  barTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  dishRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  dishRank: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  dishName: { fontSize: 13, fontWeight: "500" },
  dishMeta: { fontSize: 11, marginTop: 1 },
  dishAmt: { fontSize: 13, fontWeight: "700" },
  dishPct: { fontSize: 11 },
  dailyList: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  dailyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  dailyDate: { fontSize: 12, width: 40 },
  dailyTotal: { fontSize: 13, fontWeight: "600", width: 70 },
  insightCard: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 8 },
  insightTitle: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  insightDesc: { fontSize: 12, lineHeight: 17 },
  insightValue: { fontSize: 13, fontWeight: "700" },
  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  historyMonth: { fontSize: 14, fontWeight: "600" },
  historyMeta: { fontSize: 11, marginTop: 2 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyDesc: { fontSize: 14, textAlign: "center" },
  importBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  importBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});

/**
 * 经营分析（成本对比：烈酒/葡萄酒/餐食/备用金，支持天/月/年/自定义时间段）
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StoreMetric, StoreSectionHeader } from "@/components/store/store-visual-primitives";
import { storeTone, STORE_TEXT } from "@/lib/theme/store-visual-system";
import { BoundedBusinessMonthNavigator } from "@/components/months/BoundedBusinessMonthNavigator";
import { useReportMonthNavigation } from "@/hooks/use-report-month-navigation";
import { REVENUE_CATEGORY_LABELS, type RevenueCategory } from "@/lib/store/revenue-store";
import { useStoreReportReadModel } from "@/components/providers/StoreReportReadModelProvider";

type PeriodMode = "day" | "month" | "year" | "custom";
type CompareMode = "none" | "prev";

const PERIOD_MODES: { key: PeriodMode; label: string }[] = [
  { key: "day", label: "某天" },
  { key: "month", label: "某月" },
  { key: "year", label: "某年" },
  { key: "custom", label: "时间段" },
];

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }
function parseDate(s: string): Date { const d = new Date(s + "T00:00:00"); return isNaN(d.getTime()) ? new Date() : d; }

function dayRange(dateStr: string): { start: Date; end: Date } {
  const s = parseDate(dateStr); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setHours(23, 59, 59, 999);
  return { start: s, end: e };
}
function monthRange(monthStr: string): { start: Date; end: Date } {
  const [y, m] = monthStr.split("-").map(Number);
  return { start: new Date(y, m - 1, 1, 0, 0, 0), end: new Date(y, m, 0, 23, 59, 59, 999) };
}
function yearRange(yearStr: string): { start: Date; end: Date } {
  const y = parseInt(yearStr, 10);
  return { start: new Date(y, 0, 1, 0, 0, 0), end: new Date(y, 11, 31, 23, 59, 59, 999) };
}
function prevRange(mode: PeriodMode, day: string, month: string, year: string, cStart: string, cEnd: string): { start: Date; end: Date } {
  if (mode === "day") { const d = parseDate(day); d.setDate(d.getDate() - 1); return dayRange(fmtDate(d)); }
  if (mode === "month") { const [y, m] = month.split("-").map(Number); const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; return monthRange(`${py}-${String(pm).padStart(2, "0")}`); }
  if (mode === "year") { return yearRange(String(parseInt(year, 10) - 1)); }
  const s = parseDate(cStart); const e = parseDate(cEnd); const len = e.getTime() - s.getTime();
  return { start: new Date(s.getTime() - len - 86400000), end: new Date(s.getTime() - 86400000) };
}
function periodLabel(mode: PeriodMode, day: string, month: string, year: string, cStart: string, cEnd: string): string {
  if (mode === "day") return day === fmtDate(new Date()) ? "今天" : day;
  if (mode === "month") return `${Number(month.slice(5, 7))}月${month.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${month.slice(0, 4)}年` : ""}`;
  if (mode === "year") return `${year}年`;
  return `${cStart} ~ ${cEnd}`;
}

function CustomRangePicker({ visible, start, end, onConfirm, onClose, colors }: { visible: boolean; start: string; end: string; onConfirm: (s: string, e: string) => void; onClose: () => void; colors: any }) {
  const [s, setS] = useState(start); const [e, setE] = useState(end);
  React.useEffect(() => { if (visible) { setS(start); setE(end); } }, [visible, start, end]);
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: "#00000066", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }}>
          <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>选择时间段</Text>
          {[{ label: "开始日期", value: s, onChange: setS }, { label: "结束日期", value: e, onChange: setE }].map((f) => (
            <View key={f.label}>
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>{f.label}</Text>
              <TextInput value={f.value} onChangeText={f.onChange} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
                style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.foreground, backgroundColor: colors.surface }} keyboardType="numbers-and-punctuation" />
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {[{ label: "近7天", days: 7 }, { label: "近30天", days: 30 }, { label: "近90天", days: 90 }, { label: "近180天", days: 180 }].map((q) => (
              <TouchableOpacity key={q.label} onPress={() => { const ed = new Date(); const sd = new Date(); sd.setDate(ed.getDate() - q.days + 1); setS(fmtDate(sd)); setE(fmtDate(ed)); }}
                style={{ backgroundColor: colors.primary + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, color: colors.primary }}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { if (!s || !e) { Alert.alert("请填写完整日期"); return; } if (parseDate(s) > parseDate(e)) { Alert.alert("开始日期不能晚于结束日期"); return; } onConfirm(s, e); }}
              style={{ flex: 1, borderRadius: 12, backgroundColor: colors.primary, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function YearPicker({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  const years = useMemo(() => { const cur = new Date().getFullYear(); return Array.from({ length: 5 }, (_, i) => String(cur - i)); }, []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
      {years.map((y) => (
        <TouchableOpacity key={y} onPress={() => onChange(y)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: value === y ? colors.primary : colors.border, backgroundColor: value === y ? colors.primary : colors.surface }}>
          <Text style={{ fontSize: 13, fontWeight: value === y ? "600" : "400", color: value === y ? "#fff" : colors.muted }}>{y}年</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function DayPicker({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  const days = useMemo(() => { const r: string[] = []; const now = new Date(); for (let i = 0; i < 30; i++) { const d = new Date(now); d.setDate(now.getDate() - i); r.push(fmtDate(d)); } return r; }, []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
      {days.map((d) => (
        <TouchableOpacity key={d} onPress={() => onChange(d)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: value === d ? colors.primary : colors.border, backgroundColor: value === d ? colors.primary : colors.surface }}>
          <Text style={{ fontSize: 12, fontWeight: value === d ? "600" : "400", color: value === d ? "#fff" : colors.muted }}>{d === fmtDate(new Date()) ? "今天" : d.slice(5)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function StoreAnalyticsScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { model: reportReadModel } = useStoreReportReadModel();
  const { month: reportMonth, bounds: reportMonthBounds, selectMonth: selectReportMonth } = useReportMonthNavigation();
  const [mode, setMode] = useState<PeriodMode>("month");
  const [compare, setCompare] = useState<CompareMode>("prev");
  const [selectedDay, setSelectedDay] = useState(fmtDate(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return fmtDate(d); });
  const [customEnd, setCustomEnd] = useState(fmtDate(new Date()));
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const costCategories: RevenueCategory[] = ["food_cost", "spirit_cost", "wine_cost", "petty_cash", "labor_cost", "rent", "utilities", "operations"];
  const currentRange = useMemo((): { start: Date; end: Date } => {
    if (mode === "day") return dayRange(selectedDay);
    if (mode === "month") return monthRange(reportMonth);
    if (mode === "year") return yearRange(selectedYear);
    return { start: parseDate(customStart), end: parseDate(customEnd) };
  }, [mode, selectedDay, reportMonth, selectedYear, customStart, customEnd]);
  const previousRange = useMemo(() => prevRange(mode, selectedDay, reportMonth, selectedYear, customStart, customEnd), [mode, selectedDay, reportMonth, selectedYear, customStart, customEnd]);
  const { cur, prev } = useMemo(() => {
    const current: Partial<Record<RevenueCategory, number>> = {};
    const previous: Partial<Record<RevenueCategory, number>> = {};
    const add = (target: Partial<Record<RevenueCategory, number>>, category: RevenueCategory, amount: number) => {
      target[category] = (target[category] ?? 0) + amount;
    };
    const inRange = (date: Date, range: { start: Date; end: Date }) => date >= range.start && date <= range.end;
    reportReadModel.analyticsByDate.forEach((daily) => {
      const date = new Date(daily.date);
      for (const [category, amount] of Object.entries(daily.amounts)) {
        if (inRange(date, currentRange)) add(current, category as RevenueCategory, amount);
        if (compare === "prev" && inRange(date, previousRange)) add(previous, category as RevenueCategory, amount);
      }
    });
    return { cur: current, prev: previous };
  }, [compare, currentRange, previousRange, reportReadModel.analyticsByDate]);
  const totalRevCur = cur.revenue ?? 0;
  const totalCostCur = Object.entries(cur).filter(([k]) => k !== "revenue").reduce((s, [, v]) => s + (v ?? 0), 0);
  const profitCur = totalRevCur - totalCostCur;
  const totalRevPrev = prev.revenue ?? 0;
  const totalCostPrev = Object.entries(prev).filter(([k]) => k !== "revenue").reduce((s, [, v]) => s + (v ?? 0), 0);
  const profitPrev = totalRevPrev - totalCostPrev;
  const pctChange = (cur: number, prev: number) => { if (prev === 0) return null; return ((cur - prev) / prev * 100).toFixed(1); };
  const label = periodLabel(mode, selectedDay, reportMonth, selectedYear, customStart, customEnd);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {PERIOD_MODES.map((p) => {
            const active = mode === p.key;
            return (
              <Pressable key={p.key} onPress={() => { tap(); setMode(p.key); if (p.key === "custom") setShowCustomPicker(true); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}>
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: 8 }}>
          {mode === "day" && <DayPicker value={selectedDay} onChange={setSelectedDay} colors={colors} />}
          {mode === "month" && !embedded && (
            <BoundedBusinessMonthNavigator
              testID="analytics-month-navigator"
              subject="经营分析"
              month={reportMonth}
              bounds={reportMonthBounds}
              onChange={selectReportMonth}
            />
          )}
          {mode === "year" && <YearPicker value={selectedYear} onChange={setSelectedYear} colors={colors} />}
          {mode === "custom" && (
            <TouchableOpacity onPress={() => setShowCustomPicker(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 }}>
              <IconSymbol name="calendar" size={15} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{customStart} ~ {customEnd}</Text>
              <IconSymbol name="chevron.right" size={13} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          {(["none", "prev"] as CompareMode[]).map((m) => (
            <Pressable key={m} onPress={() => { tap(); setCompare(m); }}
              style={[styles.compareChip, { borderColor: compare === m ? colors.primary : colors.border, backgroundColor: compare === m ? colors.primary + "22" : colors.surface }]}>
              <Text style={{ color: compare === m ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>{m === "none" ? "不对比" : "与上期对比"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <StoreSectionHeader label={`${label} 总览`} icon="chart.pie.fill" tone="primary" colors={colors} />
        <View style={[styles.overviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {[
            { label: "营收", cur: totalRevCur, prev: totalRevPrev, tone: "settled" as const, icon: "banknote.fill" as const },
            { label: "总成本", cur: totalCostCur, prev: totalCostPrev, tone: "neutral" as const, icon: "cart.fill" as const },
            { label: "利润", cur: profitCur, prev: profitPrev, tone: profitCur >= 0 ? "settled" as const : "danger" as const, icon: "chart.line.uptrend.xyaxis" as const },
          ].map((item, i, arr) => {
            const pct = compare === "prev" ? pctChange(item.cur, item.prev) : null;
            return (
              <React.Fragment key={item.label}>
                <View style={styles.overviewMetric}>
                  <StoreMetric label={item.label} value={`¥${item.cur.toFixed(0)}`} tone={item.tone} icon={item.icon} colors={colors} primary={item.label === "利润"} />
                  {pct !== null ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ ...STORE_TEXT.caption, color: parseFloat(pct) > 0 ? storeTone(colors, "settled") : storeTone(colors, "danger") }}>{parseFloat(pct) > 0 ? "▲" : "▼"}{Math.abs(parseFloat(pct))}%</Text> : null}
                </View>
                {i < arr.length - 1 && <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: "stretch" }} />}
              </React.Fragment>
            );
          })}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <StoreSectionHeader label="成本明细" icon="list.bullet" tone="neutral" colors={colors} />
        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {costCategories.map((cat) => {
            const curVal = cur[cat] ?? 0; const prevVal = prev[cat] ?? 0;
            const pct = compare === "prev" ? pctChange(curVal, prevVal) : null;
            if (curVal === 0 && prevVal === 0) return null;
            return (
              <React.Fragment key={cat}>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.foreground }]}>{REVENUE_CATEGORY_LABELS[cat]}</Text>
                  <Text style={[styles.detailValue, { color: storeTone(colors, "neutral") }]}>¥{curVal.toFixed(0)}</Text>
                  {compare === "prev" && <Text style={[styles.detailPrev, { color: colors.muted }]}>上期 ¥{prevVal.toFixed(0)}</Text>}
                  {pct !== null && <Text style={[styles.detailPct, { color: parseFloat(pct) > 0 ? colors.error : colors.success }]}>{parseFloat(pct) > 0 ? "▲" : "▼"}{Math.abs(parseFloat(pct))}%</Text>}
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 }} />
              </React.Fragment>
            );
          })}
          {costCategories.every((cat) => (cur[cat] ?? 0) === 0) && <Text style={[styles.emptyText, { color: colors.muted }]}>{label} 暂无数据</Text>}
        </View>
      </View>
      <CustomRangePicker visible={showCustomPicker} start={customStart} end={customEnd}
        onConfirm={(s, e) => { setCustomStart(s); setCustomEnd(e); setShowCustomPicker(false); }}
        onClose={() => setShowCustomPicker(false)} colors={colors} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 13, lineHeight: 19 },
  compareChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  overviewCard: { borderRadius: 16, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "stretch" },
  // 三项概览各自收纳指标与对比值；iPhone 不把百分比作为同级列，避免金额被挤压换行。
  overviewMetric: { flex: 1, minWidth: 0, gap: 3, paddingHorizontal: 4 },
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

/**
 * 备用金页面 - iCost 风格，跟随系统主题
 * 三视图：账本（流水）/ 日历 / 统计（饼图+分类详情）
 * 按钮：下载图标（Tab 行右侧）+ 蓝色 FAB（右下角）
 */
import React, { useMemo, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  usePettyCashStore, PETTY_CODE_LABELS, PETTY_GROUPS, PettyCode,
  PettyRecord,
} from "@/lib/store/petty-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { importIcostExcel } from "@/lib/store/icost-import";
import { useColors } from "@/hooks/use-colors";

// ─── 大类颜色池（iCost 风格）──────────────────────────────────────────────────
const GROUP_COLORS = [
  "#4A90E2","#E8864A","#50C878","#9B59B6","#E74C3C",
  "#1ABC9C","#F39C12","#3498DB","#E91E63","#00BCD4",
  "#8BC34A","#FF5722","#607D8B","#795548",
];

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function getMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${y}年${parseInt(m)}月`;
}
function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function firstDayOfWeek(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1).getDay();
  return d === 0 ? 6 : d - 1;
}
function fmtAmt(n: number, decimals = 3) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtShort(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return n.toFixed(0);
}

// ─── 环形饼图 ─────────────────────────────────────────────────────────────────
interface PieSlice { label: string; value: number; color: string; pct: number }
function DonutChart({ slices, total, size = 200, textColor, subColor, centerLabel = "总支出" }: {
  slices: PieSlice[]; total: number; size?: number; textColor: string; subColor: string; centerLabel?: string;
}) {
  const cx = size / 2, cy = size / 2;
  const R = size * 0.40, r = size * 0.24;
  let angle = -Math.PI / 2;
  const paths: { d: string; color: string }[] = [];
  for (const s of slices) {
    if (s.pct < 0.005) continue;
    const sweep = s.pct * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(angle + sweep), y2 = cy + R * Math.sin(angle + sweep);
    const xi1 = cx + r * Math.cos(angle), yi1 = cy + r * Math.sin(angle);
    const xi2 = cx + r * Math.cos(angle + sweep), yi2 = cy + r * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M${xi1} ${yi1} L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z`;
    paths.push({ d, color: s.color });
    angle += sweep;
  }
  return (
    <Svg width={size} height={size}>
      {paths.map((p, i) => <Path key={i} d={p.d} fill={p.color} />)}
      <SvgText x={cx} y={cy - 8} textAnchor="middle" fontSize={10} fill={subColor}>{centerLabel}</SvgText>
      <SvgText x={cx} y={cy + 14} textAnchor="middle" fontSize={18} fontWeight="bold" fill={textColor}>
        {total >= 10000 ? `¥${(total / 10000).toFixed(2)}w` : `¥${total.toFixed(0)}`}
      </SvgText>
    </Svg>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────
type ViewMode = "ledger" | "calendar" | "stats";
type StatsTab = "expense" | "income";
type PeriodMode = "week" | "month" | "year" | "all" | "range";

// ─── 年月快速选择器 Modal ──────────────────────────────────────────────────────
function MonthPickerModal({
  visible, currentMonth, onSelect, onClose, colors,
}: {
  visible: boolean; currentMonth: string;
  onSelect: (month: string) => void; onClose: () => void; colors: any;
}) {
  const parts = currentMonth.split("-").map(Number);
  const selYear = parts[0]; const selMonth = parts[1];
  const [pickerYear, setPickerYear] = React.useState(selYear);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_: any, i: number) => currentYear - 4 + i);
  const months = Array.from({ length: 12 }, (_: any, i: number) => i + 1);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={SP.backdrop} onPress={onClose}>
        <Pressable style={[SP.pickerCard, { backgroundColor: colors.surface }]}>
          <Text style={[SP.pickerTitle, { color: colors.foreground }]}>选择年月</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={SP.yearRow}>
            {years.map((yr: number) => (
              <Pressable key={yr} onPress={() => setPickerYear(yr)}
                style={[SP.yearChip, { backgroundColor: pickerYear === yr ? colors.primary : colors.background, borderColor: pickerYear === yr ? colors.primary : colors.border }]}>
                <Text style={[SP.yearChipText, { color: pickerYear === yr ? "#fff" : colors.foreground }]}>{yr}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={SP.monthGrid}>
            {months.map((mo: number) => {
              const isSel = pickerYear === selYear && mo === selMonth;
              return (
                <Pressable key={mo}
                  onPress={() => { onSelect(`${pickerYear}-${String(mo).padStart(2, "0")}`); onClose(); }}
                  style={[SP.monthCell, { backgroundColor: isSel ? colors.primary : colors.background, borderColor: isSel ? colors.primary : colors.border }]}>
                  <Text style={[SP.monthCellText, { color: isSel ? "#fff" : colors.foreground }]}>{mo}月</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={onClose} style={[SP.cancelBtn, { borderTopColor: colors.border }]}>
            <Text style={[SP.cancelText, { color: colors.muted }]}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const PERIOD_MODE_LABELS: Record<PeriodMode, string> = {
  week: "按周统计", month: "按月统计", year: "按年统计", all: "全部统计", range: "范围统计",
};
const INCOME_CODES = ["N0","N1","N2","N3","N4","N5"];

export default function StorePettyCashScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { records, addRecord, updateRecord, deleteRecord, setPeriod, calcPeriod, periods } = usePettyCashStore();

  const [month, setMonth] = useState(todayMonth());
  const [viewMode, setViewMode] = useState<ViewMode>("ledger");
  const [statsTab, setStatsTab] = useState<StatsTab>("expense");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // 添加/编辑记录弹窗
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addCode, setAddCode] = useState<PettyCode>("A1");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addDesc, setAddDesc] = useState("");
  const [addPayment, setAddPayment] = useState("微信");
  const [addType, setAddType] = useState<"expense" | "inflow" | "other">("expense");
  const [showOpeningEdit, setShowOpeningEdit] = useState(false);
  const [openingInput, setOpeningInput] = useState("");
  const [importing, setImporting] = useState(false);

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const router = useRouter();

  // ── 当月数据 ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => calcPeriod(month), [calcPeriod, month, records, periods]);
  const monthRecords = useMemo(() => records.filter(r => r.date.startsWith(month)), [records, month]);

  // ── 账本分组 ──────────────────────────────────────────────────────────────
  const ledgerGroups = useMemo(() => {
    const map = new Map<string, PettyRecord[]>();
    const sorted = [...monthRecords].sort((a, b) => b.date.localeCompare(a.date));
    for (const r of sorted) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return Array.from(map.entries()).map(([date, recs]) => ({
      date, records: recs,
      dayExpense: recs.filter(r => !INCOME_CODES.includes(r.code)).reduce((s, r) => s + r.amount, 0),
      dayIncome: recs.filter(r => INCOME_CODES.includes(r.code)).reduce((s, r) => s + r.amount, 0),
    }));
  }, [monthRecords]);

  const calendarGroups = useMemo(() => {
    if (selectedDay === null) return ledgerGroups;
    const dayStr = `${month}-${String(selectedDay).padStart(2, "0")}`;
    return ledgerGroups.filter(g => g.date === dayStr);
  }, [ledgerGroups, selectedDay, month]);

  // ── 日历数据 ──────────────────────────────────────────────────────────────
  const calendarData = useMemo(() => {
    const days = daysInMonth(month);
    const firstDay = firstDayOfWeek(month);
    const dayMap = new Map<number, { expense: number; income: number }>();
    for (let d = 1; d <= days; d++) dayMap.set(d, { expense: 0, income: 0 });
    for (const r of monthRecords) {
      const day = parseInt(r.date.slice(8, 10));
      const d = dayMap.get(day)!;
      if (INCOME_CODES.includes(r.code)) d.income += r.amount; else d.expense += r.amount;
    }
    return { days, firstDay, dayMap };
  }, [monthRecords, month]);

  // ── 统计数据 ──────────────────────────────────────────────────────────────
  const statsData = useMemo(() => {
    const isExpense = statsTab === "expense";
    const filtered = monthRecords.filter(r => isExpense ? !INCOME_CODES.includes(r.code) : INCOME_CODES.includes(r.code));
    const total = filtered.reduce((s, r) => s + r.amount, 0);
    const groupMap = new Map<string, { label: string; total: number; count: number; codes: Map<string, { total: number; count: number }> }>();
    for (const r of filtered) {
      const g = r.code[0];
      const groupInfo = PETTY_GROUPS.find(pg => pg.codes.some(c => c === r.code));
      const groupLabel = groupInfo ? groupInfo.label : g;
      if (!groupMap.has(g)) groupMap.set(g, { label: groupLabel, total: 0, count: 0, codes: new Map() });
      const gd = groupMap.get(g)!;
      gd.total += r.amount; gd.count++;
      if (!gd.codes.has(r.code)) gd.codes.set(r.code, { total: 0, count: 0 });
      const cd = gd.codes.get(r.code)!;
      cd.total += r.amount; cd.count++;
    }
    const groups = Array.from(groupMap.entries())
      .map(([key, v]) => ({ key, ...v, pct: total > 0 ? v.total / total : 0 }))
      .sort((a, b) => b.total - a.total);
    const slices: PieSlice[] = groups.map((g, i) => ({
      label: g.label, value: g.total, color: GROUP_COLORS[i % GROUP_COLORS.length], pct: g.pct,
    }));
    // 上月对比
    const prevM = prevMonth(month);
    const prevRecords = records.filter(r => r.date.startsWith(prevM) && (isExpense ? !INCOME_CODES.includes(r.code) : INCOME_CODES.includes(r.code)));
    const prevGroupMap = new Map<string, number>();
    for (const r of prevRecords) {
      const g = r.code[0];
      prevGroupMap.set(g, (prevGroupMap.get(g) ?? 0) + r.amount);
    }
    return { total, groups, slices, prevGroupMap };
  }, [monthRecords, statsTab, month, records]);

  // ── 操作 ──────────────────────────────────────────────────────────────────
  const handleImportExcel = useCallback(async () => {
    tap();
    setImporting(true);
    try {
      const result = await importIcostExcel();
      if (!result) { setImporting(false); return; }
      for (const rec of result.records) addRecord(rec);
      Alert.alert("导入成功 ✓", `成功导入 ${result.imported} 条${result.skipped > 0 ? `\n跳过 ${result.skipped} 行` : ""}`);
    } catch (e: unknown) {
      Alert.alert("导入失败", e instanceof Error ? e.message : "请重试");
    } finally { setImporting(false); }
  }, [addRecord]);

  const openEdit = (item: PettyRecord) => {
    setEditingId(item.id);
    setAddCode(item.code);
    setAddAmount(String(item.amount));
    setAddDate(item.date);
    setAddDesc(item.description || "");
    setAddPayment(item.paymentMethod || "微信");
    setAddType(["N0","N1","N2"].includes(item.code) ? "inflow" : ["N3","N4","N5"].includes(item.code) ? "other" : "expense");
    setShowAdd(true);
  };
  const handleAdd = () => {
    if (!addAmount || isNaN(parseFloat(addAmount))) { Alert.alert("请输入金额"); return; }
    const payload = { date: addDate, code: addCode, amount: parseFloat(addAmount), description: addDesc, paymentMethod: addPayment, receiptUri: "" };
    if (editingId) { updateRecord(editingId, payload); } else { addRecord(payload); }
    setAddAmount(""); setAddDesc(""); setEditingId(null); setShowAdd(false);
    tap();
  };

  const handleSaveOpening = () => {
    const val = parseFloat(openingInput);
    if (isNaN(val)) { Alert.alert("请输入有效金额"); return; }
    const autoVal = summary.openingAutoValue;
    if (Math.abs(val - autoVal) > 0.01) {
      Alert.alert("期初不一致", `手动输入 ¥${val.toFixed(2)}\n上月期末 ¥${autoVal.toFixed(2)}\n\n确认使用手动值？`, [
        { text: "取消", style: "cancel" },
        { text: "确认", onPress: () => { setPeriod({ month, openingBalance: val, note: "" }); setShowOpeningEdit(false); } },
      ]);
    } else { setPeriod({ month, openingBalance: val, note: "" }); setShowOpeningEdit(false); }
  };

  const toggleGroup = (key: string) => {
    tap();
    setExpandedGroups(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s; });
  };

  // ── 月份导航栏 ────────────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={[S.header, { backgroundColor: colors.background }]}>
      <Pressable onPress={() => { tap(); setMonth(prevMonth(month)); setSelectedDay(null); }}
        style={[S.navBtn, { backgroundColor: colors.primary }]}>
        <IconSymbol name="chevron.left" size={18} color="#fff" />
      </Pressable>
      <Pressable onPress={() => { tap(); setShowMonthPicker(true); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={[S.monthLabel, { color: colors.foreground }]}>{getMonthLabel(month)}</Text>
        <IconSymbol name="chevron.down" size={14} color={colors.muted} />
      </Pressable>
      <Pressable onPress={() => { tap(); setMonth(nextMonth(month)); setSelectedDay(null); }}
        style={[S.navBtn, { backgroundColor: colors.primary }]}>
        <IconSymbol name="chevron.right" size={18} color="#fff" />
      </Pressable>
    </View>
  );

  // ── 视图切换 Tab + 下载按钮 ───────────────────────────────────────────────
  const renderViewTabs = () => (
    <View style={[S.viewTabs, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      {([["ledger","账本"],["calendar","日历"],["stats","统计"]] as [ViewMode, string][]).map(([v, label]) => (
        <Pressable key={v} onPress={() => { tap(); setViewMode(v); }} style={S.viewTab}>
          <Text style={[S.viewTabText, { color: viewMode === v ? colors.primary : colors.muted }]}>{label}</Text>
          {viewMode === v && <View style={[S.viewTabUnderline, { backgroundColor: colors.primary }]} />}
        </Pressable>
      ))}
      <View style={{ flex: 1 }} />
      <Pressable onPress={handleImportExcel} disabled={importing}
        style={[S.downloadBtn, { backgroundColor: colors.surface }]}>
        {importing
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <IconSymbol name="arrow.down.doc.fill" size={20} color={colors.primary} />}
      </Pressable>
      <Pressable onPress={() => { tap(); router.push("/petty-category-settings" as any); }}
        style={[S.downloadBtn, { backgroundColor: colors.surface, marginLeft: 4 }]}>
        <IconSymbol name="slider.horizontal.3" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );

  // ── 月度总览卡片 ──────────────────────────────────────────────────────────
  const renderSummaryCard = () => (
    <View style={[S.summaryCard, { backgroundColor: colors.surface }]}>
      <View style={[S.summaryRow, { borderBottomColor: colors.border }]}>
        <View style={[S.summaryHalf, { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }]}>
          <View style={S.summaryHalfHeader}>
            <View style={[S.summaryDot, { backgroundColor: colors.error }]} />
            <Text style={[S.summaryHalfTitle, { color: colors.muted }]}>总支出</Text>
          </View>
          <Text style={[S.summaryBigAmt, { color: colors.foreground }]}>¥{fmtAmt(summary.expense)}</Text>
          <View style={S.summarySubRow}>
            <Text style={[S.summarySub, { color: colors.muted }]}>总收入</Text>
            <Text style={[S.summarySub, { color: colors.muted }]}>¥{fmtAmt(summary.inflow + summary.otherIncome)}</Text>
          </View>
          <View style={S.summarySubRow}>
            <Text style={[S.summarySub, { color: colors.muted }]}>结余</Text>
            <Text style={[S.summarySub, { color: colors.muted }]}>{summary.closingBalance >= 0 ? "" : "-"}¥{fmtAmt(Math.abs(summary.closingBalance))}</Text>
          </View>
        </View>
        <View style={S.summaryHalf}>
          <View style={S.summaryHalfHeader}>
            <View style={[S.summaryDot, { backgroundColor: colors.primary }]} />
            <Text style={[S.summaryHalfTitle, { color: colors.muted }]}>备用金</Text>
          </View>
          <Pressable onPress={() => { tap(); setOpeningInput(summary.openingBalance.toFixed(2)); setShowOpeningEdit(true); }}>
            <Text style={[S.summaryBigAmt, { color: colors.foreground }]}>¥{fmtAmt(summary.closingBalance)}</Text>
          </Pressable>
          <View style={S.summarySubRow}>
            <Text style={[S.summarySub, { color: colors.muted }]}>期初</Text>
            <Text style={[S.summarySub, { color: colors.muted }]}>¥{fmtAmt(summary.openingBalance)}</Text>
          </View>
          <View style={S.summarySubRow}>
            <Text style={[S.summarySub, { color: colors.muted }]}>转入</Text>
            <Text style={[S.summarySub, { color: colors.muted }]}>+¥{fmtAmt(summary.inflow)}</Text>
          </View>
        </View>
      </View>
      {/* 期初→转入→其他收入→期末 */}
      <View style={[S.periodRow, { borderTopColor: colors.border }]}>
        <Pressable onPress={() => { tap(); setOpeningInput(summary.openingBalance.toFixed(2)); setShowOpeningEdit(true); }} style={S.periodItem}>
          <Text style={[S.periodLabel, { color: colors.muted }]}>期初备用金</Text>
          <Text style={[S.periodValue, { color: colors.foreground }]}>¥{fmtAmt(summary.openingBalance)}</Text>
        </Pressable>
        <Text style={[S.periodArrow, { color: colors.muted }]}>›</Text>
        <View style={S.periodItem}>
          <Text style={[S.periodLabel, { color: colors.muted }]}>转入</Text>
          <Text style={[S.periodValue, { color: colors.foreground }]}>+¥{fmtAmt(summary.inflow)}</Text>
        </View>
        <Text style={[S.periodArrow, { color: colors.muted }]}>›</Text>
        <View style={S.periodItem}>
          <Text style={[S.periodLabel, { color: colors.muted }]}>其他收入</Text>
          <Text style={[S.periodValue, { color: colors.foreground }]}>+¥{fmtAmt(summary.otherIncome)}</Text>
        </View>
        <Text style={[S.periodArrow, { color: colors.muted }]}>›</Text>
        <View style={S.periodItem}>
          <Text style={[S.periodLabel, { color: colors.muted }]}>期末备用金</Text>
          <Text style={[S.periodValue, { color: colors.foreground }]}>¥{fmtAmt(summary.closingBalance)}</Text>
        </View>
      </View>
    </View>
  );

  // ── 账本视图 ──────────────────────────────────────────────────────────────
  const renderLedger = () => (
    <FlatList
      data={ledgerGroups}
      keyExtractor={g => g.date}
      ListHeaderComponent={renderSummaryCard}
      renderItem={({ item: group }) => (
        <View>
          <View style={[S.dayHeader, { backgroundColor: colors.background }]}>
            <Text style={[S.dayHeaderDate, { color: colors.muted }]}>{group.date.slice(5)}</Text>
            {group.dayExpense > 0 && <Text style={[S.dayHeaderAmt, { color: colors.muted }]}>支出 ¥{fmtShort(group.dayExpense)}</Text>}
            {group.dayIncome > 0 && <Text style={[S.dayHeaderAmt, { color: colors.muted, marginLeft: 10 }]}>收入 ¥{fmtShort(group.dayIncome)}</Text>}
          </View>
          {group.records.map(item => (
            <Pressable key={item.id}
              onPress={() => { tap(); openEdit(item); }}
              onLongPress={() => Alert.alert("删除", "确认删除？", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteRecord(item.id) }])}
              style={[S.recordRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <View style={[S.codeBadge, { backgroundColor: INCOME_CODES.includes(item.code) ? colors.success + "33" : colors.primary + "33" }]}>
                <Text style={[S.codeText, { color: INCOME_CODES.includes(item.code) ? colors.success : colors.primary }]}>{item.code}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[S.recordName, { color: colors.foreground }]} numberOfLines={1}>
                  {(PETTY_CODE_LABELS[item.code as PettyCode] ?? item.code).replace(/^[A-Z0-9]+ /, "")}
                </Text>
                {(item.description || item.paymentMethod) && (
                  <Text style={[S.recordSub, { color: colors.muted }]} numberOfLines={1}>
                    {[item.paymentMethod, item.description].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              <Text style={[S.recordAmt, { color: INCOME_CODES.includes(item.code) ? colors.success : colors.error }]}>
                {INCOME_CODES.includes(item.code) ? "+" : "-"}¥{item.amount.toFixed(3)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      ListEmptyComponent={
        <View style={S.empty}>
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>本月暂无记录</Text>
          <Text style={[S.emptyDesc, { color: colors.muted }]}>点击右下角 + 手动添加，或点击下载图标导入 Excel</Text>
        </View>
      }
      contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
    />
  );

  // ── 日历视图 ──────────────────────────────────────────────────────────────
  const renderCalendar = () => {
    const { days, firstDay, dayMap } = calendarData;
    // 构建格子：前置空格 + 日期
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    // 补齐末尾使每行7格
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = cells.length / 7;
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}>
        {renderSummaryCard()}
        <View style={[S.calendarWrap, { backgroundColor: colors.surface }]}>
          <View style={S.calWeekRow}>
            {["一","二","三","四","五","六","日"].map(d => (
              <Text key={d} style={[S.calWeekLabel, { color: colors.muted }]}>{d}</Text>
            ))}
          </View>
          {Array.from({ length: weeks }).map((_, wi) => (
            <View key={wi} style={S.calRow}>
              {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
                const data = day ? dayMap.get(day) : null;
                const isSelected = day !== null && day === selectedDay;
                const isToday = day !== null && `${month}-${String(day).padStart(2, "0")}` === new Date().toISOString().slice(0, 10);
                const hasData = data && (data.expense > 0 || data.income > 0);
                return (
                  <Pressable key={di}
                    onPress={() => { if (day) { tap(); setSelectedDay(isSelected ? null : day); } }}
                    style={[
                      S.calCell,
                      isSelected && { backgroundColor: colors.primary + "33" },
                    ]}>
                    <Text style={[
                      S.calDayNum,
                      { color: day ? (isToday ? colors.primary : colors.foreground) : "transparent" },
                      isToday && { fontWeight: "700" },
                    ]}>
                      {day ?? " "}
                    </Text>
                    {hasData && data.expense > 0 ? (
                      <Text style={[S.calAmt, { color: colors.muted }]}>{fmtShort(data.expense)}</Text>
                    ) : null}
                    {hasData && data.income > 0 ? (
                      <Text style={[S.calAmt, { color: colors.muted, opacity: 0.6 }]}>{fmtShort(data.income)}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        {selectedDay !== null && (
          <View style={{ marginTop: 4 }}>
            {calendarGroups.length === 0
              ? <Text style={[S.emptyDesc, { textAlign: "center", marginTop: 20, color: colors.muted }]}>当日无记录</Text>
              : calendarGroups.map(group => group.records.map(item => (
                <Pressable key={item.id}
                  onPress={() => { tap(); openEdit(item); }}
                  onLongPress={() => Alert.alert("删除", "确认删除？", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteRecord(item.id) }])}
                  style={[S.recordRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
                  <View style={[S.codeBadge, { backgroundColor: colors.primary + "33" }]}>
                    <Text style={[S.codeText, { color: colors.primary }]}>{item.code}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[S.recordName, { color: colors.foreground }]} numberOfLines={1}>
                      {(PETTY_CODE_LABELS[item.code as PettyCode] ?? item.code).replace(/^[A-Z0-9]+ /, "")}
                    </Text>
                    {item.description ? <Text style={[S.recordSub, { color: colors.muted }]}>{item.description}</Text> : null}
                  </View>
                  <Text style={[S.recordAmt, { color: INCOME_CODES.includes(item.code) ? colors.success : colors.error }]}>
                    {INCOME_CODES.includes(item.code) ? "+" : "-"}¥{item.amount.toFixed(3)}
                  </Text>
                </Pressable>
              )))}
          </View>
        )}
      </ScrollView>
    );
  };

  // ── 统计视图 ──────────────────────────────────────────────────────────────
  const renderStats = () => {
    const { total, groups, slices, prevGroupMap } = statsData;
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}>
        {/* 顶部工具栏：左侧「按月统计」下拉 + 右侧支出/收入分段 */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
          {/* 左侧：统计周期下拉按钮 */}
          <Pressable
            onPress={() => { tap(); setShowPeriodMenu(v => !v); }}
            style={[S.periodBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[S.periodBtnText, { color: colors.primary }]}>{PERIOD_MODE_LABELS[periodMode]}</Text>
            <IconSymbol name="chevron.down" size={12} color={colors.primary} />
          </Pressable>
          {/* 右侧：支出/收入分段控件 */}
          <View style={[S.segControl, { backgroundColor: colors.border + "88", flex: 1 }]}>
          {([["expense","支出"],["income","收入"]] as [StatsTab, string][]).map(([v, label]) => (
            <Pressable key={v} onPress={() => { tap(); setStatsTab(v); }}
              style={[S.segItem, statsTab === v && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}>
              <Text style={[S.segText, { color: statsTab === v ? colors.foreground : colors.muted, fontWeight: statsTab === v ? "600" : "400" }]}>{label}</Text>
            </Pressable>
          ))}
          </View>
        </View>

        {/* 饼图区域 */}
        <View style={[S.pieWrap, { backgroundColor: colors.surface }]}>
          {total > 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 8 }}>
              <DonutChart slices={slices} total={total} size={200} textColor={colors.foreground} subColor={colors.muted} centerLabel={statsTab === "income" ? "总收入" : "总支出"} />
              <View style={S.legendWrap}>
                {slices.slice(0, 6).map((s, i) => (
                  <View key={i} style={S.legendItem}>
                    <View style={[S.legendDot, { backgroundColor: s.color }]} />
                    <Text style={[S.legendLabel, { color: colors.muted }]}>{s.label}</Text>
                    <Text style={[S.legendPct, { color: colors.foreground }]}>{(s.pct * 100).toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Text style={[S.emptyDesc, { textAlign: "center", marginVertical: 40, color: colors.muted }]}>本月暂无数据</Text>
          )}
        </View>

        {/* 大类列表 */}
        {groups.map((g, gi) => {
          const color = GROUP_COLORS[gi % GROUP_COLORS.length];
          const expanded = expandedGroups.has(g.key);
          const prevTotal = prevGroupMap.get(g.key) ?? 0;
          const diff = g.total - prevTotal;
          const subCodes = Array.from(g.codes.entries())
            .map(([code, v]) => ({ code, ...v, pct: g.total > 0 ? v.total / g.total : 0 }))
            .sort((a, b) => b.total - a.total);
          return (
            <View key={g.key} style={[S.groupCard, { backgroundColor: colors.surface }]}>
              <Pressable onPress={() => toggleGroup(g.key)} style={S.groupRow}>
                <View style={[S.groupColorDot, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[S.groupName, { color: colors.foreground }]}>{g.label}</Text>
                    <Text style={[S.groupPct, { color: colors.muted }]}>{(g.pct * 100).toFixed(1)}%</Text>
                    {prevTotal > 0 && (
                      <Text style={[S.groupDiff, { color: diff > 0 ? colors.error : colors.success }]}>
                        {diff > 0 ? "▲" : "▼"}¥{Math.abs(diff).toFixed(0)}
                      </Text>
                    )}
                  </View>
                  <View style={[S.progressBg, { backgroundColor: colors.border }]}>
                    <View style={[S.progressFg, { backgroundColor: color, width: `${g.pct * 100}%` as any }]} />
                  </View>
                </View>
                <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
                  <Text style={[S.groupTotal, { color: colors.foreground }]}>¥{g.total.toFixed(2)}</Text>
                  <Text style={[S.groupCount, { color: colors.muted }]}>{g.count}笔</Text>
                </View>
                <IconSymbol name={expanded ? "chevron.down" : "chevron.right"} size={14} color={colors.muted} style={{ marginLeft: 6 }} />
              </Pressable>
              {expanded && subCodes.map(sc => (
                <View key={sc.code} style={[S.subRow, { borderTopColor: colors.border }]}>
                  <Text style={[S.subCode, { color: colors.muted }]}>{PETTY_CODE_LABELS[sc.code as PettyCode] ?? sc.code}</Text>
                  <Text style={[S.subDetail, { color: colors.muted }]}>{sc.count}笔 {(sc.pct * 100).toFixed(1)}%</Text>
                  <Text style={[S.subAmt, { color: colors.foreground }]}>¥{sc.total.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ── 添加记录弹窗 ──────────────────────────────────────────────────────────
  const renderAddModal = () => {
    const incomeCodes: PettyCode[] = ["N0","N1","N2","N3","N4","N5"];
    const inflowCodes: PettyCode[] = ["N0","N1","N2"];
    const otherCodes: PettyCode[] = ["N3","N4","N5"];
    const expenseGroups = PETTY_GROUPS.filter(g => !g.codes.every(c => incomeCodes.includes(c)));
    const currentGroups = addType === "expense" ? expenseGroups
      : addType === "inflow" ? [{ label: "N 备用金转入", codes: inflowCodes }]
      : [{ label: "N 其他收入", codes: otherCodes }];
    return (
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setShowAdd(false); setEditingId(null); }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => { setShowAdd(false); setEditingId(null); }}><Text style={[S.sheetAction, { color: colors.primary }]}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>{editingId ? "编辑记录" : "添加记录"}</Text>
            <Pressable onPress={handleAdd}><Text style={[S.sheetAction, { color: colors.primary, fontWeight: "700" }]}>{editingId ? "保存" : "添加"}</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([["expense","支出"],["inflow","备用金转入"],["other","其他收入"]] as [typeof addType, string][]).map(([v, label]) => (
                <Pressable key={v} onPress={() => { setAddType(v); setAddCode(v === "inflow" ? "N0" : v === "other" ? "N3" : "A1"); }}
                  style={[S.typeBtn, { borderColor: addType === v ? colors.primary : colors.border, backgroundColor: addType === v ? colors.primary + "22" : colors.surface }]}>
                  <Text style={{ color: addType === v ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View>
              <Text style={[S.fieldLabel, { color: colors.muted }]}>分类</Text>
              <ScrollView style={{ maxHeight: 180 }}>
                {currentGroups.map(group => (
                  <View key={group.label}>
                    <Text style={[S.fieldLabel, { color: colors.muted, fontSize: 11 }]}>{group.label}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      {group.codes.map(code => (
                        <Pressable key={code} onPress={() => setAddCode(code)}
                          style={[S.codeChip, { borderColor: addCode === code ? colors.primary : colors.border, backgroundColor: addCode === code ? colors.primary + "22" : colors.surface }]}>
                          <Text style={{ color: addCode === code ? colors.primary : colors.muted, fontSize: 12, fontWeight: "700" }}>{code}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text style={[S.fieldLabel, { color: colors.foreground }]}>已选：{PETTY_CODE_LABELS[addCode] ?? addCode}</Text>
            </View>
            <View>
              <Text style={[S.fieldLabel, { color: colors.muted }]}>金额（元）*</Text>
              <TextInput value={addAmount} onChangeText={setAddAmount} placeholder="0.000" placeholderTextColor={colors.muted}
                style={[S.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground }]}
                keyboardType="decimal-pad" returnKeyType="next" />
            </View>
            <View>
              <Text style={[S.fieldLabel, { color: colors.muted }]}>日期</Text>
              <TextInput value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
                style={[S.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground }]}
                returnKeyType="next" />
            </View>
            <View>
              <Text style={[S.fieldLabel, { color: colors.muted }]}>支付方式</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["现金","微信","支付宝","招商银行","工商银行"].map(m => (
                  <Pressable key={m} onPress={() => setAddPayment(m)}
                    style={[S.payBtn, { borderColor: addPayment === m ? colors.primary : colors.border, backgroundColor: addPayment === m ? colors.primary + "22" : colors.surface }]}>
                    <Text style={{ color: addPayment === m ? colors.primary : colors.muted, fontSize: 11, fontWeight: "600" }}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View>
              <Text style={[S.fieldLabel, { color: colors.muted }]}>描述</Text>
              <TextInput value={addDesc} onChangeText={setAddDesc} placeholder="可选备注" placeholderTextColor={colors.muted}
                style={[S.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground }]}
                returnKeyType="done" />
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  // ── 期初编辑弹窗 ──────────────────────────────────────────────────────────
  const renderOpeningModal = () => (
    <Modal visible={showOpeningEdit} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowOpeningEdit(false)}>
      <View style={[S.sheet, { backgroundColor: colors.background }]}>
        <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setShowOpeningEdit(false)}><Text style={[S.sheetAction, { color: colors.primary }]}>取消</Text></Pressable>
          <Text style={[S.sheetTitle, { color: colors.foreground }]}>期初备用金</Text>
          <Pressable onPress={handleSaveOpening}><Text style={[S.sheetAction, { color: colors.primary, fontWeight: "700" }]}>保存</Text></Pressable>
        </View>
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={[S.fieldLabel, { color: colors.muted }]}>上月期末自动带入：¥{summary.openingAutoValue.toFixed(3)}</Text>
          <TextInput value={openingInput} onChangeText={setOpeningInput} placeholder="手动输入期初金额" placeholderTextColor={colors.muted}
            style={[S.input, { fontSize: 20, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground }]}
            keyboardType="decimal-pad" returnKeyType="done" autoFocus />
          <Text style={[S.fieldLabel, { color: colors.muted }]}>若与上月期末不一致，保存时会提醒确认。</Text>
        </View>
      </View>
    </Modal>
  );

  // ── 主渲染 ────────────────────────────────────────────────────────────────
  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {renderHeader()}
      {renderViewTabs()}
      {viewMode === "ledger" && renderLedger()}
      {viewMode === "calendar" && renderCalendar()}
      {viewMode === "stats" && renderStats()}
      {/* FAB：蓝色 + 按钮（右下角，iCost 位置）*/}
      <Pressable
        onPress={() => { tap(); setEditingId(null); setAddCode("A1"); setAddAmount(""); setAddDate(new Date().toISOString().slice(0, 10)); setAddDesc(""); setAddPayment("微信"); setAddType("expense"); setShowAdd(true); }}
        style={[S.fab, { bottom: 20 + insets.bottom, backgroundColor: colors.primary, shadowColor: colors.primary }]}>
        <Text style={S.fabIcon}>+</Text>
      </Pressable>
      {renderAddModal()}
      {renderOpeningModal()}
      {/* 统计周期下拉 Modal（顶层，不被饼图遮挡）*/}
      <Modal visible={showPeriodMenu} transparent animationType="fade" onRequestClose={() => setShowPeriodMenu(false)}>
        <Pressable style={SP.backdrop} onPress={() => setShowPeriodMenu(false)}>
          <View style={[S.periodMenu, { position: "absolute", top: 140, left: 16, backgroundColor: colors.surface, borderColor: colors.border, shadowColor: "#000" }]}>
            {(Object.keys(PERIOD_MODE_LABELS) as PeriodMode[]).map(mode => (
              <Pressable key={mode} onPress={() => { tap(); setPeriodMode(mode); setShowPeriodMenu(false); }}
                style={[S.periodMenuItem, periodMode === mode && { backgroundColor: colors.primary + "18" }]}>
                <Text style={[S.periodMenuText, { color: periodMode === mode ? colors.primary : colors.foreground, fontWeight: periodMode === mode ? "600" : "400" }]}>
                  {PERIOD_MODE_LABELS[mode]}
                </Text>
                {periodMode === mode && <IconSymbol name="checkmark" size={14} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      {/* 年月快速选择器 */}
      <MonthPickerModal
        visible={showMonthPicker}
        currentMonth={month}
        onSelect={(newM) => { setMonth(newM); setSelectedDay(null); }}
        onClose={() => setShowMonthPicker(false)}
        colors={colors}
      />
    </View>
  );
}

// ─── 样式（不含颜色，颜色全部通过 useColors() 动态注入）─────────────────────
const S = StyleSheet.create({
  root: { flex: 1 },
  // 导航
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 18, fontWeight: "700" },
  // 视图 Tab
  viewTabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  viewTab: { paddingVertical: 10, marginRight: 24, alignItems: "center" },
  viewTabText: { fontSize: 15, fontWeight: "600" },
  viewTabUnderline: { position: "absolute", bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1 },
  downloadBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  // 总览卡片
  summaryCard: { margin: 12, borderRadius: 16, overflow: "hidden" },
  summaryRow: { flexDirection: "row" },
  summaryHalf: { flex: 1, padding: 16 },
  summaryHalfHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  summaryDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  summaryHalfTitle: { fontSize: 13, fontWeight: "500" },
  summaryBigAmt: { fontSize: 22, fontWeight: "700", marginBottom: 6, lineHeight: 28 },
  summarySubRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, gap: 4 },
  summarySub: { fontSize: 12, flex: 1 },
  periodRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  periodItem: { flex: 1, alignItems: "center" },
  periodLabel: { fontSize: 10, marginBottom: 3 },
  periodValue: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  periodArrow: { fontSize: 16, marginHorizontal: 2 },
  // 账本
  dayHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6 },
  dayHeaderDate: { fontSize: 13, fontWeight: "600", flex: 1 },
  dayHeaderAmt: { fontSize: 13, fontWeight: "500" },
  recordRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  codeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, minWidth: 38, alignItems: "center" },
  codeText: { fontSize: 12, fontWeight: "700" },
  recordName: { fontSize: 15, fontWeight: "500", lineHeight: 21 },
  recordSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  recordAmt: { fontSize: 16, fontWeight: "700", marginLeft: 8 },
  // 空状态
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
  // 日历
  calendarWrap: { margin: 12, borderRadius: 16, padding: 10 },
  calWeekRow: { flexDirection: "row", marginBottom: 4 },
  calWeekLabel: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "600", paddingVertical: 4 },
  calRow: { flexDirection: "row" },
  calCell: { flex: 1, alignItems: "center", paddingVertical: 5, borderRadius: 8, minHeight: 44 },
  calDayNum: { fontSize: 14, lineHeight: 20 },
  calAmt: { fontSize: 9, lineHeight: 13 },
  // 统计 - 分段控件（iOS 风格）
  segControl: { flexDirection: "row", margin: 12, borderRadius: 10, padding: 2 },
  // 统计周期下拉按钮
  periodBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  periodBtnText: { fontSize: 13, fontWeight: "600" },
  periodMenu: { position: "absolute", top: 38, left: 0, zIndex: 999, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, minWidth: 130, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8, overflow: "hidden" },
  periodMenuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11 },
  periodMenuText: { fontSize: 14 },
  segItem: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  segText: { fontSize: 14 },
  pieWrap: { marginHorizontal: 12, marginBottom: 8, borderRadius: 16 },
  legendWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: "28%" },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, flex: 1 },
  legendPct: { fontSize: 11, fontWeight: "600" },
  groupCard: { marginHorizontal: 12, marginBottom: 6, borderRadius: 14, overflow: "hidden" },
  groupRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  groupColorDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  groupName: { fontSize: 14, fontWeight: "600" },
  groupPct: { fontSize: 12 },
  groupDiff: { fontSize: 11, fontWeight: "600" },
  progressBg: { height: 3, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  progressFg: { height: 3, borderRadius: 2 },
  groupTotal: { fontSize: 15, fontWeight: "700" },
  groupCount: { fontSize: 11, marginTop: 2 },
  subRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  subCode: { flex: 1, fontSize: 13 },
  subDetail: { fontSize: 11, marginHorizontal: 8 },
  subAmt: { fontSize: 13, fontWeight: "600" },
  // FAB
  fab: { position: "absolute", right: 20, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8, zIndex: 100 },
  fabIcon: { fontSize: 28, color: "#fff", fontWeight: "300", lineHeight: 34, marginTop: -2 },
  // 弹窗
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetAction: { fontSize: 17 },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  codeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  payBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  typeBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});

// ─── MonthPickerModal 专用样式 ─────────────────────────────────────────────────
const SP = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  pickerCard: { width: 300, borderRadius: 18, overflow: "hidden", paddingTop: 20 },
  pickerTitle: { fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 14 },
  yearRow: { paddingHorizontal: 12, gap: 8, paddingBottom: 12 },
  yearChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  yearChipText: { fontSize: 14, fontWeight: "600" },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, paddingBottom: 16 },
  monthCell: { width: "22%", paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  monthCellText: { fontSize: 14, fontWeight: "600" },
  cancelBtn: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontSize: 16 },
});

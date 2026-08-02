/**
 * 备用金页面 - 仿 iCost 风格
 * 三视图：账本（流水）/ 日历 / 统计（饼图+分类详情）
 */
import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, TouchableOpacity,
} from "react-native";
import Svg, { G, Path, Circle, Text as SvgText } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import {
  usePettyCashStore, PETTY_CODE_LABELS, PETTY_GROUPS, PettyCode,
  PettyRecord,
} from "@/lib/store/petty-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { importIcostExcel } from "@/lib/store/icost-import";

// ─── 颜色池（大类 A-N）────────────────────────────────────────────────────────
const GROUP_COLORS = [
  "#FF6B6B","#FF9F43","#FECA57","#48DBFB","#1DD1A1",
  "#54A0FF","#5F27CD","#C8D6E5","#EE5A24","#009432",
  "#0652DD","#9980FA","#ED4C67","#B53471",
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
  // 0=Sun, 1=Mon ... 6=Sat; we want Mon=0
  const d = new Date(y, m - 1, 1).getDay();
  return d === 0 ? 6 : d - 1;
}
function fmt(n: number) {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}w`;
  return n.toFixed(2);
}

// ─── 环形饼图组件 ─────────────────────────────────────────────────────────────
interface PieSlice { label: string; value: number; color: string; pct: number }
function DonutChart({ slices, total, size = 220 }: { slices: PieSlice[]; total: number; size?: number }) {
  const cx = size / 2, cy = size / 2;
  const R = size * 0.38, r = size * 0.22;
  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; midAngle: number; pct: number; label: string }[] = [];
  for (const s of slices) {
    if (s.pct < 0.001) continue;
    const sweep = s.pct * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle);
    const y1 = cy + R * Math.sin(angle);
    const x2 = cx + R * Math.cos(angle + sweep);
    const y2 = cy + R * Math.sin(angle + sweep);
    const xi1 = cx + r * Math.cos(angle);
    const yi1 = cy + r * Math.sin(angle);
    const xi2 = cx + r * Math.cos(angle + sweep);
    const yi2 = cy + r * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M${xi1} ${yi1} L${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z`;
    paths.push({ d, color: s.color, midAngle: angle + sweep / 2, pct: s.pct, label: s.label });
    angle += sweep;
  }
  return (
    <Svg width={size} height={size}>
      {paths.map((p, i) => (
        <Path key={i} d={p.d} fill={p.color} />
      ))}
      {/* 中心文字 */}
      <SvgText x={cx} y={cy - 10} textAnchor="middle" fontSize={11} fill="#888">总支出</SvgText>
      <SvgText x={cx} y={cy + 12} textAnchor="middle" fontSize={16} fontWeight="bold" fill="#fff">
        ¥{total >= 10000 ? `${(total / 10000).toFixed(2)}w` : total.toFixed(0)}
      </SvgText>
      {/* 外侧标签（只显示 >5% 的） */}
      {paths.filter(p => p.pct > 0.05).map((p, i) => {
        const labelR = R + 22;
        const lx = cx + labelR * Math.cos(p.midAngle);
        const ly = cy + labelR * Math.sin(p.midAngle);
        return (
          <SvgText key={i} x={lx} y={ly} textAnchor="middle" fontSize={9} fill={p.color}>
            {`${(p.pct * 100).toFixed(1)}%\n${p.label}`}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────
type ViewMode = "ledger" | "calendar" | "stats";
type StatsTab = "expense" | "income";

export default function StorePettyCashScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { records, addRecord, deleteRecord, setPeriod, calcPeriod, periods } = usePettyCashStore();

  const [month, setMonth] = useState(todayMonth());
  const [viewMode, setViewMode] = useState<ViewMode>("ledger");
  const [statsTab, setStatsTab] = useState<StatsTab>("expense");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // 添加记录弹窗
  const [showAdd, setShowAdd] = useState(false);
  const [addCode, setAddCode] = useState<PettyCode>("A1");
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addDesc, setAddDesc] = useState("");
  const [addPayment, setAddPayment] = useState("微信");
  const [addType, setAddType] = useState<"expense" | "inflow" | "other">("expense");

  // 期初编辑弹窗
  const [showOpeningEdit, setShowOpeningEdit] = useState(false);
  const [openingInput, setOpeningInput] = useState("");

  // 导入
  const [importing, setImporting] = useState(false);

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // ── 当月数据 ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => calcPeriod(month), [calcPeriod, month, records, periods]);
  const prevSummary = useMemo(() => calcPeriod(prevMonth(month)), [calcPeriod, month, records, periods]);
  const monthRecords = useMemo(() => records.filter(r => r.date.startsWith(month)), [records, month]);

  // ── 按日期分组（账本视图）────────────────────────────────────────────────
  const ledgerGroups = useMemo(() => {
    const map = new Map<string, PettyRecord[]>();
    const sorted = [...monthRecords].sort((a, b) => b.date.localeCompare(a.date));
    for (const r of sorted) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return Array.from(map.entries()).map(([date, recs]) => ({
      date,
      records: recs,
      dayExpense: recs.filter(r => !["N0","N1","N2","N3","N4","N5"].includes(r.code)).reduce((s, r) => s + r.amount, 0),
      dayIncome: recs.filter(r => ["N0","N1","N2","N3","N4","N5"].includes(r.code)).reduce((s, r) => s + r.amount, 0),
    }));
  }, [monthRecords]);

  // 日历视图过滤
  const calendarGroups = useMemo(() => {
    if (selectedDay === null) return ledgerGroups;
    const dayStr = `${month}-${String(selectedDay).padStart(2, "0")}`;
    return ledgerGroups.filter(g => g.date === dayStr);
  }, [ledgerGroups, selectedDay, month]);

  // ── 统计视图数据 ──────────────────────────────────────────────────────────
  const statsData = useMemo(() => {
    const isExpense = statsTab === "expense";
    const filtered = monthRecords.filter(r => {
      const isIncome = ["N0","N1","N2","N3","N4","N5"].includes(r.code);
      return isExpense ? !isIncome : isIncome;
    });
    const total = filtered.reduce((s, r) => s + r.amount, 0);
    // 大类汇总
    const groupMap = new Map<string, { label: string; total: number; count: number; codes: Map<string, { total: number; count: number }> }>();
    for (const r of filtered) {
      const g = r.code.replace(/[0-9]+$/, ""); // A, B, C...
      const groupInfo = PETTY_GROUPS.find(pg => pg.codes.some(c => c.startsWith(g) && c === r.code));
      const groupLabel = groupInfo ? groupInfo.label.split(" ")[0] : g;
      if (!groupMap.has(g)) groupMap.set(g, { label: groupLabel, total: 0, count: 0, codes: new Map() });
      const gd = groupMap.get(g)!;
      gd.total += r.amount;
      gd.count++;
      if (!gd.codes.has(r.code)) gd.codes.set(r.code, { total: 0, count: 0 });
      const cd = gd.codes.get(r.code)!;
      cd.total += r.amount;
      cd.count++;
    }
    const groups = Array.from(groupMap.entries())
      .map(([key, v]) => ({ key, ...v, pct: total > 0 ? v.total / total : 0 }))
      .sort((a, b) => b.total - a.total);
    // 饼图切片
    const slices: PieSlice[] = groups.map((g, i) => ({
      label: g.label,
      value: g.total,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      pct: g.pct,
    }));
    // 上月同期对比
    const prevFiltered = records.filter(r => {
      const pm = prevMonth(month);
      const isIncome = ["N0","N1","N2","N3","N4","N5"].includes(r.code);
      return r.date.startsWith(pm) && (isExpense ? !isIncome : isIncome);
    });
    const prevGroupMap = new Map<string, number>();
    for (const r of prevFiltered) {
      const g = r.code.replace(/[0-9]+$/, "");
      prevGroupMap.set(g, (prevGroupMap.get(g) ?? 0) + r.amount);
    }
    return { total, groups, slices, prevGroupMap };
  }, [monthRecords, statsTab, records, month]);

  // ── 日历数据 ──────────────────────────────────────────────────────────────
  const calendarData = useMemo(() => {
    const days = daysInMonth(month);
    const firstDay = firstDayOfWeek(month);
    const dayMap = new Map<number, { expense: number; income: number }>();
    for (const r of monthRecords) {
      const day = parseInt(r.date.split("-")[2]);
      if (!dayMap.has(day)) dayMap.set(day, { expense: 0, income: 0 });
      const d = dayMap.get(day)!;
      if (["N0","N1","N2","N3","N4","N5"].includes(r.code)) d.income += r.amount;
      else d.expense += r.amount;
    }
    return { days, firstDay, dayMap };
  }, [monthRecords, month]);

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

  const handleAdd = () => {
    if (!addAmount || isNaN(parseFloat(addAmount))) { Alert.alert("请输入金额"); return; }
    addRecord({ date: addDate, code: addCode, amount: parseFloat(addAmount), description: addDesc, paymentMethod: addPayment, receiptUri: "" });
    setAddAmount(""); setAddDesc(""); setShowAdd(false);
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
    } else {
      setPeriod({ month, openingBalance: val, note: "" });
      setShowOpeningEdit(false);
    }
  };

  const toggleGroup = (key: string) => {
    tap();
    setExpandedGroups(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  // ── 渲染：月份导航栏 ──────────────────────────────────────────────────────
  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <Pressable onPress={() => { tap(); setMonth(prevMonth(month)); setSelectedDay(null); }}
        style={[styles.navBtn, { backgroundColor: colors.primary }]}>
        <IconSymbol name="chevron.left" size={18} color="#fff" />
      </Pressable>
      <Pressable onPress={() => { tap(); setMonth(todayMonth()); setSelectedDay(null); }}>
        <Text style={[styles.monthLabel, { color: colors.foreground }]}>{getMonthLabel(month)}</Text>
      </Pressable>
      <Pressable onPress={() => { tap(); setMonth(nextMonth(month)); setSelectedDay(null); }}
        style={[styles.navBtn, { backgroundColor: colors.primary }]}>
        <IconSymbol name="chevron.right" size={18} color="#fff" />
      </Pressable>
    </View>
  );

  // ── 渲染：视图切换 Tab ────────────────────────────────────────────────────
  const renderViewTabs = () => (
    <View style={[styles.viewTabs, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {([["ledger","账本"],["calendar","日历"],["stats","统计"]] as [ViewMode, string][]).map(([v, label]) => (
        <Pressable key={v} onPress={() => { tap(); setViewMode(v); }}
          style={[styles.viewTab, viewMode === v && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
          <Text style={[styles.viewTabText, { color: viewMode === v ? colors.primary : colors.muted }]}>{label}</Text>
        </Pressable>
      ))}
      <View style={{ flex: 1 }} />
      {/* 操作按钮 */}
      <Pressable onPress={handleImportExcel} disabled={importing}
        style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
        {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <IconSymbol name="arrow.down.doc.fill" size={18} color={colors.primary} />}
      </Pressable>
      <Pressable onPress={() => { tap(); setShowAdd(true); }}
        style={[styles.iconBtn, { backgroundColor: colors.primary }]}>
        <IconSymbol name="plus" size={18} color="#fff" />
      </Pressable>
    </View>
  );

  // ── 渲染：月度总览卡片 ────────────────────────────────────────────────────
  const renderSummaryCard = () => (
    <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* 总支出/总收入/月结余 */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>总支出</Text>
          <Text style={[styles.summaryBig, { color: colors.error }]}>¥{summary.expense.toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>总收入</Text>
          <Text style={[styles.summaryBig, { color: colors.success }]}>¥{(summary.inflow + summary.otherIncome).toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>月结余</Text>
          <Text style={[styles.summaryBig, { color: summary.closingBalance >= 0 ? colors.success : colors.error }]}>
            ¥{summary.closingBalance.toFixed(2)}
          </Text>
        </View>
      </View>
      {/* 期初/期末详情 */}
      <View style={[styles.periodRow, { borderTopColor: colors.border }]}>
        <Pressable onPress={() => { tap(); setOpeningInput(summary.openingBalance.toFixed(2)); setShowOpeningEdit(true); }}
          style={styles.periodItem}>
          <Text style={[styles.periodLabel, { color: colors.muted }]}>期初备用金</Text>
          <Text style={[styles.periodValue, { color: colors.foreground }]}>¥{summary.openingBalance.toFixed(2)}</Text>
          {summary.openingOverridden && <Text style={[styles.periodTag, { color: colors.warning }]}>手动</Text>}
        </Pressable>
        <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        <View style={styles.periodItem}>
          <Text style={[styles.periodLabel, { color: colors.muted }]}>转入</Text>
          <Text style={[styles.periodValue, { color: colors.success }]}>+¥{summary.inflow.toFixed(2)}</Text>
        </View>
        <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        <View style={styles.periodItem}>
          <Text style={[styles.periodLabel, { color: colors.muted }]}>其他收入</Text>
          <Text style={[styles.periodValue, { color: colors.success }]}>+¥{summary.otherIncome.toFixed(2)}</Text>
        </View>
        <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        <View style={styles.periodItem}>
          <Text style={[styles.periodLabel, { color: colors.muted }]}>期末备用金</Text>
          <Text style={[styles.periodValue, { color: colors.primary }]}>¥{summary.closingBalance.toFixed(2)}</Text>
        </View>
      </View>
    </View>
  );

  // ── 渲染：账本视图 ────────────────────────────────────────────────────────
  const renderLedger = () => (
    <FlatList
      data={ledgerGroups}
      keyExtractor={g => g.date}
      ListHeaderComponent={renderSummaryCard}
      renderItem={({ item: group }) => (
        <View>
          {/* 日期分组头 */}
          <View style={[styles.dayHeader, { backgroundColor: colors.background }]}>
            <Text style={[styles.dayHeaderDate, { color: colors.muted }]}>
              {group.date.slice(5).replace("-", "/")}
            </Text>
            <View style={{ flex: 1 }} />
            {group.dayExpense > 0 && <Text style={[styles.dayHeaderAmt, { color: colors.error }]}>支出: ¥{group.dayExpense.toFixed(2)}</Text>}
            {group.dayIncome > 0 && <Text style={[styles.dayHeaderAmt, { color: colors.success, marginLeft: 8 }]}>收入: ¥{group.dayIncome.toFixed(2)}</Text>}
          </View>
          {/* 当日记录 */}
          {group.records.map(item => (
            <Pressable key={item.id}
              onLongPress={() => Alert.alert("删除", "确认删除此记录？", [
                { text: "取消", style: "cancel" },
                { text: "删除", style: "destructive", onPress: () => deleteRecord(item.id) },
              ])}
              style={[styles.recordRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            >
              <View style={[styles.codeBadge, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[styles.codeText, { color: colors.primary }]}>{item.code}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.recordName, { color: colors.foreground }]} numberOfLines={1}>
                  {PETTY_CODE_LABELS[item.code].replace(/^[A-Z0-9]+ /, "")}
                </Text>
                {(item.description || item.paymentMethod) && (
                  <Text style={[styles.recordSub, { color: colors.muted }]} numberOfLines={1}>
                    {[item.paymentMethod, item.description].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
              <Text style={[styles.recordAmt, {
                color: ["N0","N1","N2","N3","N4","N5"].includes(item.code) ? colors.success : colors.error
              }]}>
                {["N0","N1","N2","N3","N4","N5"].includes(item.code) ? "+" : "-"}¥{item.amount.toFixed(2)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>本月暂无记录</Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>点击右上角 + 手动添加，或导入 Excel</Text>
        </View>
      }
      contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
    />
  );

  // ── 渲染：日历视图 ────────────────────────────────────────────────────────
  const renderCalendar = () => {
    const { days, firstDay, dayMap } = calendarData;
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    const weeks = Math.ceil(cells.length / 7);
    const cellW = "13.5%";
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {renderSummaryCard()}
        <View style={[styles.calendarWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* 星期头 */}
          <View style={styles.calWeekRow}>
            {["一","二","三","四","五","六","日"].map(d => (
              <Text key={d} style={[styles.calWeekLabel, { color: colors.muted, width: cellW }]}>{d}</Text>
            ))}
          </View>
          {/* 日期格 */}
          {Array.from({ length: weeks }).map((_, wi) => (
            <View key={wi} style={styles.calRow}>
              {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => {
                const data = day ? dayMap.get(day) : null;
                const isSelected = day === selectedDay;
                const isToday = day !== null && `${month}-${String(day).padStart(2, "0")}` === new Date().toISOString().slice(0, 10);
                return (
                  <Pressable key={di} onPress={() => { if (day) { tap(); setSelectedDay(isSelected ? null : day); setViewMode("calendar"); } }}
                    style={[styles.calCell, { width: cellW, backgroundColor: isSelected ? colors.primary + "33" : "transparent" }]}>
                    <Text style={[styles.calDayNum, { color: isToday ? colors.primary : day ? colors.foreground : "transparent", fontWeight: isToday ? "700" : "400" }]}>
                      {day ?? ""}
                    </Text>
                    {data?.expense ? <Text style={[styles.calAmt, { color: colors.error }]}>-{fmt(data.expense)}</Text> : null}
                    {data?.income ? <Text style={[styles.calAmt, { color: colors.success }]}>+{fmt(data.income)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        {/* 选中日期的流水 */}
        {selectedDay !== null && (
          <View style={{ marginTop: 8 }}>
            {calendarGroups.length === 0
              ? <Text style={[styles.emptyDesc, { color: colors.muted, textAlign: "center", marginTop: 20 }]}>当日无记录</Text>
              : calendarGroups.map(group => group.records.map(item => (
                <Pressable key={item.id}
                  onLongPress={() => Alert.alert("删除", "确认删除？", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteRecord(item.id) }])}
                  style={[styles.recordRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
                  <View style={[styles.codeBadge, { backgroundColor: colors.primary + "22" }]}>
                    <Text style={[styles.codeText, { color: colors.primary }]}>{item.code}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.recordName, { color: colors.foreground }]} numberOfLines={1}>
                      {PETTY_CODE_LABELS[item.code].replace(/^[A-Z0-9]+ /, "")}
                    </Text>
                    {item.description ? <Text style={[styles.recordSub, { color: colors.muted }]}>{item.description}</Text> : null}
                  </View>
                  <Text style={[styles.recordAmt, { color: ["N0","N1","N2","N3","N4","N5"].includes(item.code) ? colors.success : colors.error }]}>
                    {["N0","N1","N2","N3","N4","N5"].includes(item.code) ? "+" : "-"}¥{item.amount.toFixed(2)}
                  </Text>
                </Pressable>
              )))}
          </View>
        )}
      </ScrollView>
    );
  };

  // ── 渲染：统计视图 ────────────────────────────────────────────────────────
  const renderStats = () => {
    const { total, groups, slices, prevGroupMap } = statsData;
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* 支出/收入切换 */}
        <View style={[styles.statsTabs, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {([["expense","支出"],["income","收入"]] as [StatsTab, string][]).map(([v, label]) => (
            <Pressable key={v} onPress={() => { tap(); setStatsTab(v); }}
              style={[styles.statsTab, statsTab === v && { backgroundColor: colors.primary }]}>
              <Text style={[styles.statsTabText, { color: statsTab === v ? "#fff" : colors.muted }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 环形饼图 */}
        <View style={[styles.pieWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.pieTitle, { color: colors.foreground }]}>
            {statsTab === "expense" ? "支出分类详情" : "收入分类详情"}
          </Text>
          {total > 0 ? (
            <View style={{ alignItems: "center", marginVertical: 8 }}>
              <DonutChart slices={slices} total={total} size={220} />
            </View>
          ) : (
            <Text style={[styles.emptyDesc, { color: colors.muted, textAlign: "center", marginVertical: 32 }]}>本月暂无数据</Text>
          )}
        </View>

        {/* 大类展开列表 */}
        {groups.map((g, gi) => {
          const color = GROUP_COLORS[gi % GROUP_COLORS.length];
          const expanded = expandedGroups.has(g.key);
          const prevTotal = prevGroupMap.get(g.key) ?? 0;
          const diff = g.total - prevTotal;
          const subCodes = Array.from(g.codes.entries())
            .map(([code, v]) => ({ code, ...v, pct: g.total > 0 ? v.total / g.total : 0 }))
            .sort((a, b) => b.total - a.total);
          return (
            <View key={g.key} style={[styles.groupCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {/* 大类行 */}
              <Pressable onPress={() => toggleGroup(g.key)} style={styles.groupRow}>
                <View style={[styles.groupColorDot, { backgroundColor: color }]} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.groupName, { color: colors.foreground }]}>{g.label}</Text>
                    <Text style={[styles.groupPct, { color: colors.muted }]}>{(g.pct * 100).toFixed(2)}%</Text>
                    {prevTotal > 0 && (
                      <Text style={[styles.groupDiff, { color: diff > 0 ? colors.error : colors.success }]}>
                        {diff > 0 ? "▲" : "▼"}¥{Math.abs(diff).toFixed(2)}
                      </Text>
                    )}
                  </View>
                  {/* 进度条 */}
                  <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
                    <View style={[styles.progressFg, { backgroundColor: color, width: `${g.pct * 100}%` }]} />
                  </View>
                </View>
                <View style={{ alignItems: "flex-end", marginLeft: 12 }}>
                  <Text style={[styles.groupTotal, { color: colors.foreground }]}>¥{g.total.toFixed(2)}</Text>
                  <Text style={[styles.groupCount, { color: colors.muted }]}>{g.count}笔</Text>
                </View>
                <IconSymbol name={expanded ? "chevron.down" : "chevron.right"} size={16} color={colors.muted} style={{ marginLeft: 8 }} />
              </Pressable>
              {/* 子分类展开 */}
              {expanded && subCodes.map(sc => (
                <View key={sc.code} style={[styles.subRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.subCode, { color: colors.muted }]}>{PETTY_CODE_LABELS[sc.code as PettyCode]}</Text>
                  <Text style={[styles.subDetail, { color: colors.muted }]}>
                    {sc.count}笔/{(sc.pct * 100).toFixed(2)}%
                  </Text>
                  <Text style={[styles.subAmt, { color: colors.foreground }]}>¥{sc.total.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ── 渲染：添加记录弹窗 ────────────────────────────────────────────────────
  const renderAddModal = () => {
    const incomeCodes: PettyCode[] = ["N0","N1","N2","N3","N4","N5"];
    const inflowCodes: PettyCode[] = ["N0","N1","N2"];
    const otherCodes: PettyCode[] = ["N3","N4","N5"];
    const expenseGroups = PETTY_GROUPS.filter(g => !g.codes.every(c => incomeCodes.includes(c)));
    const currentGroups = addType === "expense" ? expenseGroups
      : addType === "inflow" ? [{ label: "N 备用金转入", codes: inflowCodes }]
      : [{ label: "N 其他收入", codes: otherCodes }];
    return (
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowAdd(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>添加记录</Text>
            <Pressable onPress={handleAdd}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            {/* 类型切换 */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([["expense","支出"],["inflow","备用金转入"],["other","其他收入"]] as [typeof addType, string][]).map(([v, label]) => (
                <Pressable key={v} onPress={() => { setAddType(v); setAddCode(v === "inflow" ? "N0" : v === "other" ? "N3" : "A1"); }}
                  style={[styles.typeBtn, { borderColor: addType === v ? colors.primary : colors.border, backgroundColor: addType === v ? colors.primary + "22" : colors.surface }]}>
                  <Text style={{ color: addType === v ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {/* 分类选择 */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类</Text>
              <ScrollView style={{ maxHeight: 180 }}>
                {currentGroups.map(group => (
                  <View key={group.label}>
                    <Text style={[styles.groupTitle, { color: colors.muted }]}>{group.label}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      {group.codes.map(code => (
                        <Pressable key={code} onPress={() => setAddCode(code)}
                          style={[styles.codeChip, { borderColor: addCode === code ? colors.primary : colors.border, backgroundColor: addCode === code ? colors.primary + "22" : colors.surface }]}>
                          <Text style={{ color: addCode === code ? colors.primary : colors.muted, fontSize: 12, fontWeight: "600" }}>{code}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text style={[styles.selectedCode, { color: colors.foreground }]}>已选：{PETTY_CODE_LABELS[addCode]}</Text>
            </View>
            {/* 金额 */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>金额（元）*</Text>
              <TextInput value={addAmount} onChangeText={setAddAmount} placeholder="0.00" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                keyboardType="decimal-pad" returnKeyType="next" />
            </View>
            {/* 日期 */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>日期</Text>
              <TextInput value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="next" />
            </View>
            {/* 支付方式 */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>支付方式</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["现金","微信","支付宝","银行卡"].map(m => (
                  <Pressable key={m} onPress={() => setAddPayment(m)}
                    style={[styles.payBtn, { borderColor: addPayment === m ? colors.primary : colors.border, backgroundColor: addPayment === m ? colors.primary + "22" : colors.surface }]}>
                    <Text style={{ color: addPayment === m ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {/* 描述 */}
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>描述</Text>
              <TextInput value={addDesc} onChangeText={setAddDesc} placeholder="可选" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" />
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  // ── 渲染：期初编辑弹窗 ────────────────────────────────────────────────────
  const renderOpeningModal = () => (
    <Modal visible={showOpeningEdit} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowOpeningEdit(false)}>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => setShowOpeningEdit(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>期初备用金</Text>
          <Pressable onPress={handleSaveOpening}><Text style={[styles.sheetDone, { color: colors.primary }]}>保存</Text></Pressable>
        </View>
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            上月期末自动带入：¥{summary.openingAutoValue.toFixed(2)}
          </Text>
          <TextInput value={openingInput} onChangeText={setOpeningInput} placeholder="手动输入期初金额" placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground, fontSize: 18 }]}
            keyboardType="decimal-pad" returnKeyType="done" autoFocus />
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>
            若与上月期末不一致，保存时会提醒确认。
          </Text>
        </View>
      </View>
    </Modal>
  );

  // ── 主渲染 ────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {renderHeader()}
      {renderViewTabs()}
      {viewMode === "ledger" && renderLedger()}
      {viewMode === "calendar" && renderCalendar()}
      {viewMode === "stats" && renderStats()}
      {renderAddModal()}
      {renderOpeningModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  // 导航
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  navBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 17, fontWeight: "700" },
  // 视图切换
  viewTabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  viewTab: { paddingVertical: 10, marginRight: 20 },
  viewTabText: { fontSize: 15, fontWeight: "600" },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  // 月度总览卡片
  summaryCard: { margin: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  summaryRow: { flexDirection: "row", paddingVertical: 16 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryDivider: { width: StyleSheet.hairlineWidth, marginVertical: 8 },
  summaryLabel: { fontSize: 12, marginBottom: 4 },
  summaryBig: { fontSize: 18, fontWeight: "700" },
  periodRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: "wrap", gap: 4 },
  periodItem: { alignItems: "center", flex: 1 },
  periodLabel: { fontSize: 10, marginBottom: 2 },
  periodValue: { fontSize: 12, fontWeight: "600" },
  periodTag: { fontSize: 10, fontWeight: "600" },
  // 账本流水
  dayHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 6 },
  dayHeaderDate: { fontSize: 13, fontWeight: "600" },
  dayHeaderAmt: { fontSize: 13 },
  recordRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  codeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, minWidth: 36, alignItems: "center" },
  codeText: { fontSize: 12, fontWeight: "700" },
  recordName: { fontSize: 15, fontWeight: "500", lineHeight: 21 },
  recordSub: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  recordAmt: { fontSize: 16, fontWeight: "700", marginLeft: 8 },
  // 空状态
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
  // 日历
  calendarWrap: { margin: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 8 },
  calWeekRow: { flexDirection: "row", marginBottom: 4 },
  calWeekLabel: { textAlign: "center", fontSize: 12, fontWeight: "600", paddingVertical: 4 },
  calRow: { flexDirection: "row" },
  calCell: { alignItems: "center", paddingVertical: 4, borderRadius: 8 },
  calDayNum: { fontSize: 14, lineHeight: 20 },
  calAmt: { fontSize: 9, lineHeight: 13 },
  // 统计
  statsTabs: { flexDirection: "row", margin: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  statsTab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  statsTabText: { fontSize: 15, fontWeight: "600" },
  pieWrap: { margin: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  pieTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  groupCard: { marginHorizontal: 12, marginBottom: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  groupRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  groupColorDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  groupName: { fontSize: 15, fontWeight: "600" },
  groupPct: { fontSize: 13 },
  groupDiff: { fontSize: 12, fontWeight: "600" },
  progressBg: { height: 4, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  progressFg: { height: 4, borderRadius: 2 },
  groupTotal: { fontSize: 15, fontWeight: "700" },
  groupCount: { fontSize: 12, marginTop: 2 },
  subRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  subCode: { flex: 1, fontSize: 14 },
  subDetail: { fontSize: 12, marginHorizontal: 8 },
  subAmt: { fontSize: 14, fontWeight: "600" },
  // 弹窗
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  groupTitle: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 4 },
  codeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  selectedCode: { fontSize: 14, fontWeight: "500", marginTop: 8 },
  payBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  typeBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});

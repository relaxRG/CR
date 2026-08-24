/**
 * 时段营业分析主页面（Build 118）
 *
 * 四个 Tab：
 *   总览   — 四时段营业额对比 + 月度汇总卡片
 *   时段   — 各时段逐日明细 + 半小时热力图
 *   凌晨   — 凌晨加班时段详细分析（01:00后）
 *   提醒   — 加班性价比提醒（1:30am后营业额 < 阈值）
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { sumMoney } from "@/lib/finance/money";
import { numericColor } from "@/lib/theme/numeric-color-tokens";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useReportMonthNavigation } from "@/hooks/use-report-month-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StoreMetric, StoreSectionHeader, StoreSegmentedTabs } from "@/components/store/store-visual-primitives";
import { STORE_TEXT } from "@/lib/theme/store-visual-system";
import { ScreenContainer } from "@/components/screen-container";
import { usePeriodAnalysisStore } from "@/lib/store/period-analysis/store";
import { parsePeriodAnalysisExcel } from "@/lib/store/period-analysis/excel-parser";
import { pourCostColor } from "@/lib/spirits/pour-cost";
import {
  PeriodKey, PERIOD_LABELS, PERIOD_TIME_RANGE, PERIOD_COLORS,
  fmtRevenue, slotToMinutes,
} from "@/lib/store/period-analysis/types";
import { useScheduleStore } from "@/lib/store/period-analysis/schedule-store";
import {
  calcOvertimeJudgment,
} from "@/lib/store/period-analysis/schedule-types";
import { useStoreReportReadModel } from "@/components/providers/StoreReportReadModelProvider";

type MainTab = "overview" | "periods" | "latenight" | "alerts";

const TAB_ITEMS = [
  { key: "overview", label: "总览", icon: "chart.bar.fill" },
  { key: "periods", label: "时段", icon: "clock.fill" },
  { key: "latenight", label: "凌晨", icon: "moon.fill" },
  { key: "alerts", label: "提醒", icon: "exclamationmark.triangle.fill" },
] as const;

const PERIOD_ORDER: PeriodKey[] = ["lunch", "dinner", "midnight", "late_night"];

// ─── 时段汇总卡片 ─────────────────────────────────────────────────────────────
function PeriodSummaryCard({ periodKey, totals, colors }: {
  periodKey: PeriodKey;
  totals: { revenue: number; orders: number; guests: number; activeDays: number; avgDailyRevenue: number; avgDailyOrders: number };
  colors: any;
}) {
  const color = PERIOD_COLORS[periodKey];
  return (
    <View style={[PC.card, { backgroundColor: colors.surface, borderColor: color + "33", borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...STORE_TEXT.sectionTitle, color }}>{PERIOD_LABELS[periodKey]}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>{PERIOD_TIME_RANGE[periodKey]}</Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
          <View>
            <Text style={{ fontSize: 10, color: colors.muted }}>总营业额</Text>
            <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>{fmtRevenue(totals.revenue)}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 10, color: colors.muted }}>总订单</Text>
            <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>{totals.orders}单</Text>
          </View>
          <View>
            <Text style={{ fontSize: 10, color: colors.muted }}>营业天数</Text>
            <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>{totals.activeDays}天</Text>
          </View>
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 10, color: colors.muted }}>日均</Text>
        <Text style={{ ...STORE_TEXT.metric, color: numericColor(colors) }}>{fmtRevenue(totals.avgDailyRevenue)}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>{totals.avgDailyOrders}单/天</Text>
      </View>
    </View>
  );
}

// ─── 半小时热力条 ─────────────────────────────────────────────────────────────
function SlotHeatBar({ slot, avgRevenue, maxRevenue, color, colors }: {
  slot: string; avgRevenue: number; maxRevenue: number; color: string; colors: any;
}) {
  const pct = maxRevenue > 0 ? avgRevenue / maxRevenue : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
      <Text style={{ fontSize: 11, color: colors.muted, width: 60 }}>{slot}</Text>
      <View style={{ flex: 1, height: 14, backgroundColor: colors.border, borderRadius: 7, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(pct * 100)}%`, height: "100%", backgroundColor: color, borderRadius: 7 }} />
      </View>
      <Text style={{ fontSize: 11, fontWeight: "600", color: numericColor(colors), width: 50, textAlign: "right" }}>
        ¥{formatMoney(avgRevenue)}
      </Text>
    </View>
  );
}

// ─── 设置 Modal ───────────────────────────────────────────────────────────────
function SettingsModal({ visible, settings, colors, onSave, onClose }: {
  visible: boolean; settings: any; colors: any;
  onSave: (threshold: number, alertStart: string) => void; onClose: () => void;
}) {
  const [threshold, setThreshold] = useState(String(settings.overtimeThreshold));
  const [alertStart, setAlertStart] = useState(settings.alertStartTime);

  React.useEffect(() => {
    setThreshold(String(settings.overtimeThreshold));
    setAlertStart(settings.alertStartTime);
  }, [settings]);

  const handleSave = () => {
    const t = Number(threshold);
    if (isNaN(t) || t < 0) { Alert.alert("请输入有效的金额阈值"); return; }
    onSave(t, alertStart);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[SM.sheet, { backgroundColor: colors.background }]}>
          <View style={[SM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[SM.title, { color: colors.foreground }]}>加班提醒设置</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={[SM.section, { borderColor: colors.border }]}>
              <Text style={[SM.sectionTitle, { color: colors.muted }]}>加班性价比阈值</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, lineHeight: 18 }}>
                当凌晨加班时段（从设定时间起）的营业额低于此阈值时，触发提醒。
                默认 ¥200，可根据实际情况调整。
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 16, color: colors.muted }}>¥</Text>
                <TextInput value={threshold} onChangeText={setThreshold}
                  keyboardType="decimal-pad" placeholder="200"
                  placeholderTextColor={colors.muted}
                  style={[SM.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                {[100, 200, 300, 500].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setThreshold(String(v))}
                    style={[SM.chip, {
                      backgroundColor: Number(threshold) === v ? colors.primary : colors.surface,
                      borderColor: Number(threshold) === v ? colors.primary : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: Number(threshold) === v ? "#fff" : colors.muted }}>
                      ¥{v}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={[SM.section, { borderColor: colors.border }]}>
              <Text style={[SM.sectionTitle, { color: colors.muted }]}>提醒起始时间</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                从此时间起计算营业额，判断是否触发加班提醒。默认 01:30。
              </Text>
              <TextInput value={alertStart} onChangeText={setAlertStart}
                placeholder="01:30" placeholderTextColor={colors.muted}
                style={[SM.input, { color: colors.foreground, borderColor: colors.border }]} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                {["01:00", "01:30", "02:00"].map((v) => (
                  <TouchableOpacity key={v} onPress={() => setAlertStart(v)}
                    style={[SM.chip, {
                      backgroundColor: alertStart === v ? colors.primary : colors.surface,
                      borderColor: alertStart === v ? colors.primary : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: alertStart === v ? "#fff" : colors.muted }}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function PeriodAnalysisScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { reports, settings, latestReport, addReport, updateSettings } = usePeriodAnalysisStore();
  const { model: reportReadModel } = useStoreReportReadModel();
  const { shifts, purchases } = reportReadModel.periodDetails;
  const { businessHours, shiftTemplates, removeDateOverride, updateBusinessHours } = useScheduleStore();
  const [tab, setTab] = useState<MainTab>("overview");
  const { month: reportWorkspaceMonth } = useReportMonthNavigation();
  const [selectedMonth, setSelectedMonth] = useState<string>(embedded ? reportWorkspaceMonth : (latestReport?.month ?? ""));

  React.useEffect(() => {
    if (embedded) setSelectedMonth(reportWorkspaceMonth);
  }, [embedded, reportWorkspaceMonth]);
  const [showSettings, setShowSettings] = useState(false);
  const [showBizHoursModal, setShowBizHoursModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>("dinner");

  const report = useMemo(() =>
    reports.find((r) => r.month === selectedMonth),
    [reports, selectedMonth]
  );
  // 性能优化：将 renderOverview 内的 totalRevenue 提取为 useMemo
  const overviewTotalRevenue = useMemo(() => {
    if (!report) return 0;
    const totals = report.monthlyTotals;
    return PERIOD_ORDER.reduce((s, k) => s + totals[k].revenue, 0);
  }, [report]);

  const dailyRecordByDate = useMemo(
    () => new Map((report?.dailyRecords ?? []).map((record) => [record.date, record])),
    [report],
  );

  // 计算当月加班预警（联动排班表 + 时段数据）
  // 匹配逐轮班：与经营分析模块的晚班模板匹配（type === "evening"）
  const overtimeAlertMap = useMemo(() => {
    if (!report) return new Map<string, "poor" | "ok">();
    const month = report.month;
    const monthShifts = shifts.filter((shift) => shift.date.startsWith(month));
    const alertMap = new Map<string, "poor" | "ok">();
    // 找出经营分析模块中类型为 evening 的模板（即晚班模板）
    const eveningTemplate = shiftTemplates.find((t) => t.type === "evening");
    if (!eveningTemplate) return alertMap;
    // 匹配 labor 排班模块中对应的晚班名称（默认为"晚班"）
    const eveningSessionName = eveningTemplate.name; // 如 "晚班"
    for (const shift of monthShifts) {
      // 匹配晚班：将 labor 班次名称与经营分析晚班模板名称对比
      if (shift.shift !== eveningSessionName) continue;
      const judgment = calcOvertimeJudgment({
        employeeId: shift.employeeId,
        date: shift.date,
        shift: "evening", // calcOvertimeJudgment 使用 type 字段查找模板
        actualHours: shift.hoursValue,
        shiftTemplates,
        businessHours,
      });
      if (!judgment || !judgment.isOvertime) continue;
      const dailyRecord = dailyRecordByDate.get(shift.date);
      if (!dailyRecord) continue;
      const closingMin = judgment.closingMinutes;
      const overtimeRevenue = sumMoney(dailyRecord.slots
        .filter((slot) => {
          const startMin = slot.startHour * 60 + slot.startMin;
          return startMin >= (closingMin % 1440);
        })
        .map((slot) => slot.revenue));
      const key = shift.date;
      const level: "poor" | "ok" = overtimeRevenue < settings.overtimeThreshold ? "poor" : "ok";
      if (!alertMap.has(key) || (alertMap.get(key) === "ok" && level === "poor")) {
        alertMap.set(key, level);
      }
    }
    return alertMap;
  }, [report, shifts, shiftTemplates, businessHours, settings.overtimeThreshold, dailyRecordByDate]);

  React.useEffect(() => {
    if (latestReport && !selectedMonth) setSelectedMonth(latestReport.month);
  }, [latestReport, selectedMonth]);

  const handleImport = async () => {
    tap();
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) { setImporting(false); return; }

      const buffers: ArrayBuffer[] = [];
      for (const asset of result.assets) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        buffers.push(bytes.buffer);
      }

      const parsed = parsePeriodAnalysisExcel(buffers, settings);
      if (!parsed) { Alert.alert("解析失败", "未能识别文件格式，请确认是餐时段营业统计 Excel"); setImporting(false); return; }

      addReport(parsed);
      setSelectedMonth(parsed.month);
      Alert.alert(
        "导入成功 ✓",
        `${parsed.month} 时段分析\n共 ${parsed.dailyRecords.length} 天数据\n加班提醒 ${parsed.overtimeAlerts.length} 条`
      );
    } catch (e: unknown) {
      Alert.alert("导入失败", e instanceof Error ? e.message : "请重试");
    } finally {
      setImporting(false);
    }
  };

  // ── 总览 Tab ──────────────────────────────────────────────────────────────
  const renderOverview = () => {
    if (!report) return <EmptyState onImport={handleImport} colors={colors} />;
    const totals = report.monthlyTotals;
    const totalRevenue = overviewTotalRevenue;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 月份选择 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
          {reports.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => { tap(); setSelectedMonth(r.month); }}
              style={[S.monthChip, {
                backgroundColor: selectedMonth === r.month ? colors.primary : colors.surface,
                borderColor: selectedMonth === r.month ? colors.primary : colors.border,
              }]}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: selectedMonth === r.month ? "#fff" : colors.muted }}>
                {r.month}
              </Text>
              {r.overtimeAlerts.length > 0 && (
                <View style={[S.alertDot, { backgroundColor: colors.error }]}>
                  <Text style={{ fontSize: 9, color: "#fff" }}>{r.overtimeAlerts.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={[S.totalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <StoreMetric label="月度总营业额" value={fmtRevenue(totalRevenue)} tone="primary" icon="banknote.fill" colors={colors} primary />
          <Text style={{ ...STORE_TEXT.supporting, color: colors.muted }}>{report.sourceNote}</Text>
        </View>

        {/* 四时段占比条 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <StoreSectionHeader label="时段营业额占比" icon="chart.pie.fill" tone="primary" colors={colors} />
          <View style={{ flexDirection: "row", height: 20, borderRadius: 10, overflow: "hidden", marginVertical: 10 }}>
            {PERIOD_ORDER.map((pk) => {
              const pct = totalRevenue > 0 ? totals[pk].revenue / totalRevenue : 0;
              return pct > 0.01 ? (
                <View key={pk} style={{ flex: pct, backgroundColor: PERIOD_COLORS[pk] }} />
              ) : null;
            })}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PERIOD_ORDER.map((pk) => {
              const pct = totalRevenue > 0 ? Math.round(totals[pk].revenue / totalRevenue * 100) : 0;
              return (
                <View key={pk} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PERIOD_COLORS[pk] }} />
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {PERIOD_LABELS[pk]} {pct}%
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 四时段卡片 */}
        {PERIOD_ORDER.map((pk) => (
          <PeriodSummaryCard key={pk} periodKey={pk} totals={totals[pk]} colors={colors} />
        ))}

        {/* 加班提醒汇总 */}
        {report.overtimeAlerts.length > 0 && (
          <TouchableOpacity onPress={() => { tap(); setTab("alerts"); }}
            style={[S.alertCard, { backgroundColor: colors.error + "0a", borderColor: colors.error + "33" }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={18} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>
                {report.overtimeAlerts.length} 条加班性价比提醒
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                凌晨加班但营业额低于 ¥{report.overtimeThreshold} · 点击查看详情
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={14} color={colors.error} />
          </TouchableOpacity>
        )}

        {/* 成本维度卡片 */}
        {(() => {
          const month = report.month;
          const spiritPurchases = purchases.filter((purchase) => purchase.domain === "spirits" && purchase.date.startsWith(month));
          const spiritCost = spiritPurchases.reduce((s: number, p: any) => s + p.amount, 0);
          const foodRecords = purchases.filter((purchase) => purchase.domain === "food" && purchase.date.startsWith(month));
          const foodCost = foodRecords.reduce((sum, purchase) => sum + purchase.amount, 0);
          if (spiritCost === 0 && foodCost === 0) return null;
          const beverageCostPct = totalRevenue > 0 && spiritCost > 0 ? (spiritCost / totalRevenue * 100) : null;
          const foodCostPct = totalRevenue > 0 && foodCost > 0 ? (foodCost / totalRevenue * 100) : null;
          const totalCostPct = totalRevenue > 0 && (spiritCost + foodCost) > 0
            ? ((spiritCost + foodCost) / totalRevenue * 100) : null;
          return (
            <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>
                📊 成本分析
              </Text>
              {spiritCost > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>烈酒进货成本</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{spiritPurchases.length}条记录</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: "#EF4444" }}>¥{formatMoney(spiritCost)}</Text>
                    {beverageCostPct !== null && (
                      <Text style={{ fontSize: 11, fontWeight: "600", color: pourCostColor(beverageCostPct) }}>
                        酒水成本率 {beverageCostPct.toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>
              )}
              {foodCost > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>食材进货成本</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{foodRecords.length}条记录</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: "#F59E0B" }}>¥{formatMoney(foodCost)}</Text>
                    {foodCostPct !== null && (
                      <Text style={{ fontSize: 11, fontWeight: "600", color: foodCostPct < 30 ? "#10B981" : "#EF4444" }}>
                        食材成本率 {foodCostPct.toFixed(1)}%
                      </Text>
                    )}
                  </View>
                </View>
              )}
              {totalCostPct !== null && spiritCost > 0 && foodCost > 0 && (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8,
                  flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>综合成本率</Text>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: pourCostColor(totalCostPct) }}>
                    {totalCostPct.toFixed(1)}%
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 10, color: colors.muted, marginTop: 8 }}>
                行业参考：酒水成本率 &lt;20% 优秀 / 20-30% 正常 / &gt;30% 偏高
              </Text>
            </View>
          );
        })()}
      </ScrollView>
    );
  };

  // ── 时段 Tab ──────────────────────────────────────────────────────────────
  const renderPeriods = () => {
    if (!report) return <EmptyState onImport={handleImport} colors={colors} />;

    // 选中时段的半小时分布
    const periodSlots = Object.entries(report.slotDistribution)
      .filter(([, sd]) => sd.period === selectedPeriod)
      .sort(([a], [b]) => slotToMinutes(a) - slotToMinutes(b));
    const maxAvg = Math.max(...periodSlots.map(([, sd]) => sd.avgRevenue), 1);
    const color = PERIOD_COLORS[selectedPeriod];

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 时段选择 */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {PERIOD_ORDER.map((pk) => (
            <TouchableOpacity key={pk} onPress={() => { tap(); setSelectedPeriod(pk); }}
              style={[S.periodChip, {
                backgroundColor: selectedPeriod === pk ? PERIOD_COLORS[pk] : colors.surface,
                borderColor: selectedPeriod === pk ? PERIOD_COLORS[pk] : colors.border,
                flex: 1,
              }]}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: selectedPeriod === pk ? "#fff" : PERIOD_COLORS[pk], textAlign: "center" }}>
                {PERIOD_LABELS[pk]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 时段汇总 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: color + "33" }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View>
              <Text style={{ fontSize: 14, fontWeight: "700", color }}>{PERIOD_LABELS[selectedPeriod]}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{PERIOD_TIME_RANGE[selectedPeriod]}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 20, fontWeight: "800", color }}>
                {fmtRevenue(report.monthlyTotals[selectedPeriod].revenue)}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {report.monthlyTotals[selectedPeriod].orders}单 · {report.monthlyTotals[selectedPeriod].activeDays}天
              </Text>
            </View>
          </View>
        </View>

        {/* 半小时热力图 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>半小时分布（日均营业额）</Text>
          <View style={{ marginTop: 8 }}>
            {periodSlots.map(([slot, sd]) => (
              <SlotHeatBar key={slot} slot={slot} avgRevenue={sd.avgRevenue} maxRevenue={maxAvg} color={color} colors={colors} />
            ))}
          </View>
        </View>

        {/* 逐日明细 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>逐日明细</Text>
          {report.dailyRecords.map((dr) => {
            const pt = dr.periodTotals[selectedPeriod];
            if (pt.revenue === 0 && pt.orders === 0) return null;
            return (
              <View key={dr.date} style={[S.dayRow, { borderBottomColor: colors.border }]}>
                <Text style={{ fontSize: 13, color: colors.muted, width: 80 }}>
                  {dr.date.slice(5)} {["日","一","二","三","四","五","六"][new Date(dr.date).getDay()]}
                </Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                      {fmtRevenue(pt.revenue)}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{pt.orders}单 · {pt.guests}人</Text>
                  </View>
                  {/* 该日此时段的半小时条 */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {dr.slots.filter((s) => s.period === selectedPeriod).map((s) => (
                      <View key={s.slot} style={[S.slotTag, {
                        backgroundColor: s.revenue > 0 ? color + "22" : colors.border + "33",
                        borderColor: s.revenue > 0 ? color + "44" : colors.border,
                      }]}>
                        <Text style={{ fontSize: 9, color: s.revenue > 0 ? color : colors.muted }}>
                          {s.slot.split("-")[0]} ¥{formatMoney(s.revenue)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  // ── 凌晨 Tab ──────────────────────────────────────────────────────────────
  const renderLateNight = () => {
    if (!report) return <EmptyState onImport={handleImport} colors={colors} />;
    const lateNightDays = report.dailyRecords.filter((dr) => dr.hasLateNight);
    const color = PERIOD_COLORS.late_night;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 汇总 */}
        <View style={[S.card, { backgroundColor: color + "0a", borderColor: color + "22" }]}>
          <Text style={{ fontSize: 14, fontWeight: "700", color }}>🌙 凌晨加班时段（01:00-11:00）</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 10, color: colors.muted }}>有加班天数</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 18, fontWeight: "700", color }}>{lateNightDays.length}天</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 10, color: colors.muted }}>月度总营业额</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.58} style={{ fontSize: 18, fontWeight: "700", color }}>
                {fmtRevenue(report.monthlyTotals.late_night.revenue)}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 10, color: colors.muted }}>总订单</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 18, fontWeight: "700", color }}>
                {report.monthlyTotals.late_night.orders}单
              </Text>
            </View>
          </View>
        </View>

        {/* 提醒说明 */}
        <View style={[S.infoBox, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "22" }]}>
          <Text style={{ fontSize: 12, color: colors.warning, lineHeight: 18 }}>
            <Text style={{ fontWeight: "700" }}>加班性价比判断：</Text>
            凌晨 {settings.alertStartTime} 后营业额 &lt; ¥{settings.overtimeThreshold} 时触发提醒。
            员工有加班时长但店内收入极低，建议评估是否需要继续加班。
          </Text>
        </View>

        {/* 逐日凌晨记录 */}
        {lateNightDays.map((dr) => {
          const isAlert = dr.overtimeAlert;
          // 联动排班表的加班预警
          const scheduleAlert = overtimeAlertMap.get(dr.date);
          const borderColor = scheduleAlert === "poor" ? colors.error + "66" :
            scheduleAlert === "ok" ? "#FF9500" + "66" :
            isAlert ? colors.error + "44" : colors.border;
          const borderLeftColor = scheduleAlert === "poor" ? colors.error :
            scheduleAlert === "ok" ? "#FF9500" :
            isAlert ? colors.error : color;
          return (
            <View key={dr.date} style={[S.lateCard, {
              backgroundColor: colors.surface,
              borderColor: borderColor,
              borderLeftColor: borderLeftColor,
              borderLeftWidth: 3,
            }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                  {dr.date.slice(5)} {["\u65e5","\u4e00","\u4e8c","\u4e09","\u56db","\u4e94","\u516d"][new Date(dr.date).getDay()]}
                </Text>
                {/* 排班加班预警标签（优先显示） */}
                {scheduleAlert === "poor" && (
                  <View style={[S.alertTag, { backgroundColor: colors.error + "15" }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={10} color={colors.error} />
                    <Text style={{ fontSize: 10, color: colors.error, fontWeight: "700" }}>加班性价比不佳</Text>
                  </View>
                )}
                {scheduleAlert === "ok" && (
                  <View style={[S.alertTag, { backgroundColor: "#FF9500" + "15" }]}>
                    <IconSymbol name="checkmark.circle.fill" size={10} color="#FF9500" />
                    <Text style={{ fontSize: 10, color: "#FF9500", fontWeight: "700" }}>加班有效</Text>
                  </View>
                )}
                {!scheduleAlert && isAlert && (
                  <View style={[S.alertTag, { backgroundColor: colors.error + "15" }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={10} color={colors.error} />
                    <Text style={{ fontSize: 10, color: colors.error, fontWeight: "700" }}>加班提醒</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 14, fontWeight: "700", color: isAlert ? colors.error : color }}>
                  {fmtRevenue(dr.lateNightRevenue)}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{dr.lateNightOrders}单</Text>
              </View>

              {/* 半小时明细 */}
              {dr.slots.filter((s) => s.period === "late_night").map((s) => {
                const isLow = s.revenue < settings.overtimeThreshold;
                return (
                  <View key={s.slot} style={[S.slotRow, { backgroundColor: isLow ? colors.error + "08" : "transparent" }]}>
                    <Text style={{ fontSize: 12, color: colors.muted, width: 80 }}>{s.slot}</Text>
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: isLow ? colors.error : colors.foreground }}>
                        ¥{formatMoney(s.revenue)}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{s.orders}单 · {s.guests}人</Text>
                      {isLow && s.revenue > 0 && (
                        <View style={[S.lowTag, { backgroundColor: colors.error + "15" }]}>
                          <Text style={{ fontSize: 9, color: colors.error }}>低于阈值</Text>
                        </View>
                      )}
                      {s.revenue === 0 && s.orders > 0 && (
                        <View style={[S.lowTag, { backgroundColor: colors.warning + "15" }]}>
                          <Text style={{ fontSize: 9, color: colors.warning }}>有单无收入</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}

              {/* 1:30am后汇总 */}
              {dr.after130amRevenue > 0 || dr.after130amOrders > 0 ? (
                <View style={[S.after130Row, { borderTopColor: colors.border }]}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {settings.alertStartTime} 后：
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: dr.after130amRevenue < settings.overtimeThreshold ? colors.error : color }}>
                    ¥{formatMoney(dr.after130amRevenue)}（{dr.after130amOrders}单）
                  </Text>
                  {dr.after130amRevenue < settings.overtimeThreshold && (
                    <Text style={{ fontSize: 11, color: colors.error }}>
                      低于 ¥{settings.overtimeThreshold} 阈值
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {lateNightDays.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 40 }}>🌙</Text>
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>本月无凌晨加班营业记录</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  // ── 提醒 Tab ──────────────────────────────────────────────────────────────
  const renderAlerts = () => {
    if (!report) return <EmptyState onImport={handleImport} colors={colors} />;
    const alerts = report.overtimeAlerts;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 设置入口 */}
        <TouchableOpacity onPress={() => { tap(); setShowSettings(true); }}
          style={[S.settingsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="slider.horizontal.3" size={16} color={colors.primary} />
          <Text style={{ flex: 1, fontSize: 14, color: colors.foreground }}>
            加班提醒设置
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            阈值 ¥{settings.overtimeThreshold} · 从 {settings.alertStartTime} 起
          </Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </TouchableOpacity>

        {/* 提醒说明 */}
        <View style={[S.infoBox, { backgroundColor: colors.error + "0a", borderColor: colors.error + "22" }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.error }}>
            加班性价比提醒（{alerts.length} 条）
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 18 }}>
            以下日期：员工有凌晨加班，但 {settings.alertStartTime} 后的营业额低于 ¥{settings.overtimeThreshold}。
            建议评估是否值得让员工继续加班，或提前结束营业。
          </Text>
        </View>

        {alerts.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 40 }}>✅</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>
              本月无加班性价比提醒
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
              所有凌晨加班时段的营业额均高于 ¥{settings.overtimeThreshold}
            </Text>
          </View>
        ) : (
          alerts.map((alert) => (
            <View key={alert.date} style={[S.alertDetailCard, { backgroundColor: colors.surface, borderColor: colors.error + "33" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <IconSymbol name="exclamationmark.triangle.fill" size={16} color={colors.error} />
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                  {alert.date.slice(5)} {["日","一","二","三","四","五","六"][new Date(alert.date).getDay()]}
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>
                  ¥{formatMoney(alert.after130amRevenue)}
                </Text>
              </View>

              <View style={[S.alertSummary, { backgroundColor: colors.error + "08", borderColor: colors.error + "22" }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>凌晨总营业额</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                    ¥{formatMoney(alert.lateNightRevenue)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{settings.alertStartTime} 后营业额</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.error }}>
                    ¥{formatMoney(alert.after130amRevenue)}（{alert.orders}单）
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>阈值</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>¥{alert.threshold}</Text>
                </View>
              </View>

              {/* 低收入时段列表 */}
              {alert.lowSlots.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>低收入时段：</Text>
                  {alert.lowSlots.map((ls) => (
                    <View key={ls.slot} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 12, color: colors.muted, width: 80 }}>{ls.slot}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: ls.revenue === 0 ? colors.warning : colors.error }}>
                        ¥{formatMoney(ls.revenue)}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{ls.orders}单</Text>
                      {ls.revenue === 0 && ls.orders > 0 && (
                        <Text style={{ fontSize: 11, color: colors.warning }}>有单无收入（退单/赠菜？）</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    );
  };

  return (
    <ScreenContainer>
      {/* 独立路由才显示返回键；报表工作台内不产生额外跳转层级。 */}
      {!embedded && <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>时段营业分析</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => { tap(); setShowBizHoursModal(true); }} hitSlop={8} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="clock.badge.fill" size={20} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => { tap(); setShowSettings(true); }} hitSlop={8} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="slider.horizontal.3" size={20} color={colors.muted} />
          </Pressable>
          {!embedded && <Pressable onPress={handleImport} disabled={importing} hitSlop={8} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="arrow.down.doc.fill" size={20} color={colors.primary} />
          </Pressable>}
        </View>
      </View>}

      <StoreSegmentedTabs
        items={TAB_ITEMS}
        active={tab}
        colors={colors}
        testID="period-analysis-tabs"
        onChange={(next) => { tap(); setTab(next); }}
      />

      {/* 内容区 */}
      {tab === "overview" && renderOverview()}
      {tab === "periods" && renderPeriods()}
      {tab === "latenight" && renderLateNight()}
      {tab === "alerts" && renderAlerts()}

      {/* 设置 Modal */}
      <SettingsModal
        visible={showSettings}
        settings={settings}
        colors={colors}
        onSave={(threshold, alertStart) => updateSettings({ overtimeThreshold: threshold, alertStartTime: alertStart })}
        onClose={() => setShowSettings(false)}
      />

      {/* 营业时间设置 Modal */}
      <Modal visible={showBizHoursModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowBizHoursModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[SM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowBizHoursModal(false)}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[SM.title, { color: colors.foreground }]}>营业时间设置</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
              设定每天的正常关门时间。当晚班员工实际下班时间超过关门时间时，自动判定为加班并进行营业额对比。
            </Text>
            {[["周一", 1], ["周二", 2], ["周三", 3], ["周四", 4], ["周五", 5], ["周六", 6], ["周日", 0]].map(([label, weekday]) => {
              const wday = weekday as 0|1|2|3|4|5|6;
              const current = businessHours.weekdayClosingTimes.find((w) => w.weekday === wday);
              const timeStr = current?.closingTime ?? "24:00";
              return (
                <View key={wday} style={[SM.section, { borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{label}</Text>
                  <Pressable onPress={() => {
                    Alert.prompt(
                      `设定${label}关门时间`,
                      '格式 HH:MM，跨日用 25:00 表示次日 01:00',
                      (val) => {
                        if (!val) return;
                        const updated = {
                          ...businessHours,
                          weekdayClosingTimes: businessHours.weekdayClosingTimes.map((w) =>
                            w.weekday === wday ? { ...w, closingTime: val } : w
                          ),
                          updatedAt: new Date().toISOString(),
                        };
                        updateBusinessHours(updated);
                      },
                      'plain-text', timeStr
                    );
                  }}>
                    <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>{timeStr}</Text>
                  </Pressable>
                </View>
              );
            })}
            {businessHours.dateOverrides.length > 0 && (
              <View style={[SM.section, { borderColor: colors.border }]}>
                <Text style={[SM.sectionTitle, { color: colors.muted }]}>按日期覆盖</Text>
                {businessHours.dateOverrides.map((ov) => (
                  <View key={ov.date} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
                    <Text style={{ fontSize: 13, color: colors.foreground }}>{ov.date} {ov.note ? `(· ${ov.note})` : ""}</Text>
                    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                      <Text style={{ fontSize: 13, color: colors.primary }}>{ov.closingTime}</Text>
                      <Pressable onPress={() => removeDateOverride(ov.date)}>
                        <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────────
function EmptyState({ onImport, colors }: { onImport: () => void; colors: any }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
      <Text style={{ fontSize: 48 }}>🕐</Text>
      <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginTop: 16 }}>
        暂无时段分析数据
      </Text>
      <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
        导入「餐时段营业统计」Excel{"\n"}（支持同时选择多个文件自动去重）
      </Text>
      <TouchableOpacity onPress={onImport}
        style={{ backgroundColor: "#007AFF", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 20, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <IconSymbol name="arrow.down.doc.fill" size={18} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>导入 Excel</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabBar: { flexDirection: "row", margin: 8, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  tabText: { fontSize: 13 },
  alertDot: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  periodChip: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  totalCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 4 },
  alertCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  dayRow: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  slotTag: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  lateCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  slotRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, borderRadius: 6, paddingHorizontal: 4 },
  lowTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  after130Row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  alertTag: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  infoBox: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  alertDetailCard: { borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: "#FF3B30", padding: 14, marginBottom: 10 },
  alertSummary: { flexDirection: "row", borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 8 },
});

const PC = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
});

const SM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
});

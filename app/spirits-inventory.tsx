/**
 * 烈酒库存管理（全面重构版 v2）
 * Tab 1: 📊 总结 — 分类汇总表 + 月度对比 + 进货汇总表 + 环形图
 * Tab 2: 📋 库存管理 — 横向滚动表格 + 内联编辑期初 + Excel导入 + 负库存警告
 * Tab 3: 📦 当月进货 — 供应商主界面 + 每供应商独立子界面 + 自采备用金导入
 * Tab 4: 🔍 采购分析 — 供应商分析 + 品牌集团分析
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View, ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useSpiritsInventoryStore, getCurrentMonth, SpiritGroupDef, fuzzyMatchScore,
} from "@/lib/spirits/crud-store";
import {
  SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry,
  SPIRIT_CATEGORY_COLORS, SPIRIT_CATEGORIES, SpiritSupplierInfo,
} from "@/lib/spirits/types";
import {
  parseSpiritsExcel, ParsedPurchaseRow, previewSheets, parseSheetFromWorkbook,
} from "@/lib/spirits/excel-import";
import { parseSpiritInventoryExcel } from "@/lib/spirits/excel-parser";
import { buildImportedPurchaseRecords, dominantPurchaseMonth } from "@/lib/spirits/import-bridge";
import {   SpiritMonthlySnapshot, SpiritInventoryItem, SpiritPriceChange, SpiritPurchaseOrderItem } from "@/lib/spirits/types";
import { normalizeLLMRows } from "@/lib/spirits/pdf-import";
import { exportToExcel, exportToPdf, ExportData } from "@/lib/spirits/export";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── 工具 ─────────────────────────────────────────────────────────────────────
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function catColor(cat: string) { return SPIRIT_CATEGORY_COLORS[cat] ?? "#6B7280"; }
function tap() { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
function fmtAmt(n: number) { return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : formatMoney(n); }

type Tab = "summary" | "ledger" | "purchase" | "analysis";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "📊 总结" },
  { key: "ledger", label: "📋 库存管理" },
  { key: "purchase", label: "📦 当月进货" },
  { key: "analysis", label: "🔍 采购分析" },
];

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SpiritsInventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const store = useSpiritsInventoryStore();
  const {
    items, purchases, ledger, suppliers, groups,
    addItem, updateItem, deleteItem,
    addPurchase, updatePurchase, deletePurchase, batchAddPurchases, batchDeletePurchases,
    upsertLedger,
    setRefPrice, getRefPrice,
    upsertSupplier, deleteSupplier, getSupplierByName,
    upsertGroup, deleteGroup, mergeGroup, getItemGroup, detectPurchaseGroup, rememberGroupMatch,
    getAllCategories, upsertCustomCategory, deleteCustomCategory, getCategoryColor,
    setMatchMemory, matchPettyToItem,
    selfBuyConfig, updateSelfBuyConfig,
    getMonthPurchases, getMonthLedger, getItemLedger,
    getAvailableMonths, getPurchaseSummaryByCategory, getPurchaseSummaryBySupplier,
    closeMonth, syncLedgerFromPurchases,
    setActualClosing, batchSetActualClosing, checkPrevMonthClosed,
  } = store;
  const pettyStore = usePettyCashStore();

  const [tab, setTab] = useState<Tab>("summary");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [activeSupplier, setActiveSupplier] = useState<string | null>(null);
  // ★ 月末盘点状态
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const [stocktakeValues, setStocktakeValues] = useState<Record<string, string>>({});

  // ★ 月份切换时自动检查上月月结
  const handleMonthChange = (newMonth: string) => {
    const { needsClose, prevMonth } = checkPrevMonthClosed(newMonth);
    if (needsClose) {
      Alert.alert(
        "月结提示",
        `${prevMonth.slice(0, 4)}年${Number(prevMonth.slice(5, 7))}月尚未月结，建议先完成月结再切换。是否立即月结？`,
        [
          { text: "稍后再说", style: "cancel", onPress: () => setSelectedMonth(newMonth) },
          { text: "立即月结", onPress: () => { closeMonth(prevMonth); setSelectedMonth(newMonth); Alert.alert("月结完成", `${prevMonth} 期末库存已带入下月期初`); } },
        ]
      );
    } else {
      setSelectedMonth(newMonth);
    }
  };

  // 月份列表：有数据的历史月份 + 当前月往前12个月，去重后最多显示24个
  const availableMonths = useMemo(() => {
    const dataMonths = getAvailableMonths(); // 有数据的月份
    // 生成当前月往前12个月的列表
    const cur = getCurrentMonth();
    const [cy, cm] = cur.split("-").map(Number);
    const recentMonths: string[] = [];
    for (let i = 0; i < 12; i++) {
      let my = cy, mm = cm - i;
      if (mm <= 0) { my -= 1; mm += 12; }
      recentMonths.push(`${my}-${String(mm).padStart(2, "0")}`);
    }
    // 合并：有数据的月份优先，再加上近12个月，去重、降序、最多24个
    const merged = [...new Set([...dataMonths, ...recentMonths])].sort().reverse().slice(0, 24);
    return merged;
  }, [purchases, ledger]);
  const monthPurchases = useMemo(() => getMonthPurchases(selectedMonth), [purchases, selectedMonth]);
  const monthLedger = useMemo(() => getMonthLedger(selectedMonth), [ledger, selectedMonth]);

  // 上月
  const [y, m] = selectedMonth.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const prevMonthLedger = useMemo(() => getMonthLedger(prevMonth), [ledger, prevMonth]);
  const prevMonthPurchases = useMemo(() => getMonthPurchases(prevMonth), [purchases, prevMonth]);
  const categorySummary = useMemo(() => getPurchaseSummaryByCategory(selectedMonth), [ledger, selectedMonth]);
  const prevCategorySummary = useMemo(() => getPurchaseSummaryByCategory(prevMonth), [ledger, prevMonth]);
  const supplierSummary = useMemo(() => getPurchaseSummaryBySupplier(selectedMonth), [purchases, selectedMonth]);
  // 性能优化：将 renderSummary 内的多次 reduce 提取为 useMemo
  const summaryTotals = useMemo(() => ({
    purchaseAmt: monthPurchases.reduce((s, p) => s + p.amount, 0),
    prevPurchaseAmt: prevMonthPurchases.reduce((s, p) => s + p.amount, 0),
    closingCost: monthLedger.reduce((s, e) => s + e.closingCost, 0),
    prevClosingCost: prevMonthLedger.reduce((s, e) => s + e.closingCost, 0),
    openingQty: monthLedger.reduce((s, e) => s + e.openingQty, 0),
    openingCost: monthLedger.reduce((s, e) => s + e.openingQty * e.openingUnitCost, 0),
    purchaseQty: monthLedger.reduce((s, e) => s + e.purchaseQty, 0),
    purchaseCost: monthLedger.reduce((s, e) => s + e.purchaseCost, 0),
    closingQty: monthLedger.reduce((s, e) => s + e.closingQty, 0),
    consumeQty: monthLedger.reduce((s, e) => s + (e.consumeQty ?? 0), 0),
    consumeCost: monthLedger.reduce((s, e) => s + (e.consumeQty ?? 0) * e.closingUnitCost, 0),
  }), [monthPurchases, prevMonthPurchases, monthLedger, prevMonthLedger]);

  // ── 总结 Tab ────────────────────────────────────────────────────────────────
  const [showComparison, setShowComparison] = useState(false);
  const [chartDimension, setChartDimension] = useState<"category" | "group" | "supplier">("category");
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleExport = async (format: "excel" | "pdf") => {
    setShowExportMenu(false);
    setExporting(true);
    try {
      const exportData: ExportData = {
        month: selectedMonth,
        items,
        purchases,
        ledger,
        getRefPrice,
        categorySummary,
        supplierSummary,
      };
      if (format === "excel") {
        await exportToExcel(exportData);
      } else {
        await exportToPdf(exportData);
      }
    } catch (e) {
      Alert.alert("导出失败", String(e));
    } finally {
      setExporting(false);
    }
  };

  // 进货汇总表（每款酒 × 每供应商 2 列）
  const purchaseSummaryRows = useMemo(() => {
    const supplierNames = [...new Set(monthPurchases.map((p) => p.supplier ?? "未知"))];
    const byItem: Record<string, { item: SpiritItem; bySupplier: Record<string, { qty: number; amount: number; unitPrice: number }> }> = {};
    monthPurchases.forEach((p) => {
      const item = items.find((i) => i.id === p.itemId);
      if (!item) return;
      if (!byItem[item.id]) byItem[item.id] = { item, bySupplier: {} };
      const sup = p.supplier ?? "未知";
      if (!byItem[item.id].bySupplier[sup]) byItem[item.id].bySupplier[sup] = { qty: 0, amount: 0, unitPrice: p.unitPrice };
      byItem[item.id].bySupplier[sup].qty += p.quantity;
      byItem[item.id].bySupplier[sup].amount += p.amount;
    });
    return { rows: Object.values(byItem), supplierNames };
  }, [monthPurchases, items]);

  // 环形图数据
  const chartData = useMemo(() => {
    if (chartDimension === "category") {
      const total = Object.values(categorySummary).reduce((s, v) => s + v.purchaseQty, 0) || 1;
      return Object.entries(categorySummary).map(([cat, v]) => ({
        label: cat, value: v.purchaseQty, pct: Math.round(v.purchaseQty / total * 100), color: catColor(cat),
      })).sort((a, b) => b.value - a.value).slice(0, 10);
    }
    if (chartDimension === "supplier") {
      const total = Object.values(supplierSummary).reduce((s, v) => s + v.amount, 0) || 1;
      const COLORS = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
      return Object.entries(supplierSummary).map(([sup, v], i) => ({
        label: sup, value: v.amount, pct: Math.round(v.amount / total * 100), color: COLORS[i % COLORS.length],
      })).sort((a, b) => b.value - a.value);
    }
    // group
    const groupTotals: Record<string, number> = {};
    monthPurchases.forEach((p) => {
      const item = items.find((i) => i.id === p.itemId);
      if (!item) return;
      const g = getItemGroup(item);
      groupTotals[g] = (groupTotals[g] ?? 0) + p.amount;
    });
    const total = Object.values(groupTotals).reduce((s, v) => s + v, 0) || 1;
    const GROUP_COLORS: Record<string, string> = {};
    groups.forEach((g) => { GROUP_COLORS[g.name] = g.color; });
    return Object.entries(groupTotals).map(([g, v]) => ({
      label: g, value: v, pct: Math.round(v / total * 100), color: GROUP_COLORS[g] ?? "#6B7280",
    })).sort((a, b) => b.value - a.value);
  }, [chartDimension, categorySummary, supplierSummary, monthPurchases, items, groups]);

  const renderSummary = () => (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      {/* 导出按鈕行 */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <TouchableOpacity
          onPress={() => handleExport("excel")}
          disabled={exporting}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
            paddingVertical: 10, borderRadius: 12, borderWidth: 1,
            backgroundColor: "#F0FDF4", borderColor: "#86EFAC" }}>
          {exporting ? <ActivityIndicator size="small" color="#16A34A" /> : <IconSymbol name="square.and.arrow.up" size={14} color="#16A34A" />}
          <Text style={{ fontSize: 13, color: "#16A34A", fontWeight: "700" }}>Excel 导出</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleExport("pdf")}
          disabled={exporting}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
            paddingVertical: 10, borderRadius: 12, borderWidth: 1,
            backgroundColor: "#FEF2F2", borderColor: "#FECACA" }}>
          {exporting ? <ActivityIndicator size="small" color="#EF4444" /> : <IconSymbol name="doc.fill" size={14} color="#EF4444" />}
          <Text style={{ fontSize: 13, color: "#EF4444", fontWeight: "700" }}>PDF 导出</Text>
        </TouchableOpacity>
      </View>

      {/* 核心指标卡 */}
      <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[S.cardTitle, { color: colors.foreground }]}>
          {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月 · 总览
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { label: "进货总额", value: summaryTotals.purchaseAmt, fmt: (v: number) => `¥${fmtAmt(v)}`, color: "#EF4444",
              prev: summaryTotals.prevPurchaseAmt },
            { label: "进货品种", value: new Set(monthPurchases.map((p) => p.itemId ?? p.rawName)).size, fmt: (v: number) => `${v}款`, color: colors.foreground, prev: 0 },
            { label: "期末库存成本", value: summaryTotals.closingCost, fmt: (v: number) => `¥${fmtAmt(v)}`, color: colors.primary,
              prev: summaryTotals.prevClosingCost },
          ].map((s, i) => {
            const diff = s.prev > 0 ? s.value - s.prev : 0;
            return (
              <View key={i} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{s.label}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: s.color }}>{s.fmt(s.value)}</Text>
                {showComparison && diff !== 0 && (
                  <Text style={{ fontSize: 10, color: diff > 0 ? "#EF4444" : "#10B981", fontWeight: "600" }}>
                    {diff > 0 ? "↑" : "↓"}{s.fmt(Math.abs(diff))}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* 分类汇总表 */}
      <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Text style={[S.cardTitle, { color: colors.foreground, marginBottom: 0 }]}>分类汇总</Text>
          <TouchableOpacity onPress={() => setShowComparison(!showComparison)}
            style={[S.toggleBtn, { backgroundColor: showComparison ? "#EF4444" : colors.surface, borderColor: showComparison ? "#EF4444" : colors.border }]}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: showComparison ? "#fff" : colors.muted }}>
              {showComparison ? "对比 开" : "对比 关"}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          <View>
            {/* 表头 */}
            <View style={[S.tableHeader, { backgroundColor: "#991B1B" }]}>
              <Text style={[S.thCell, S.colCat]}>烈酒分类</Text>
              <Text style={[S.thCell, S.colNum]}>期初库存</Text>
              <Text style={[S.thCell, S.colNum]}>本月进货</Text>
              <Text style={[S.thCell, S.colNum]}>本月消耗</Text>
              <Text style={[S.thCell, S.colNum]}>期末库存</Text>
            </View>
            {/* 分类行 */}
            {SPIRIT_CATEGORIES.map((cat, idx) => {
              const data = categorySummary[cat];
              const prev = prevCategorySummary[cat];
              if (!data && !prev) return null;
              const isEven = idx % 2 === 0;
              return (
                <View key={cat} style={[S.tableRow, { backgroundColor: isEven ? colors.surface : colors.background }]}>
                  <View style={[S.tdCell, S.colCat, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: catColor(cat) }} />
                    <Text style={{ fontSize: 11, color: colors.foreground }} numberOfLines={1}>{cat}</Text>
                  </View>
                  {(["openingQty", "purchaseQty", "consumeQty", "closingQty"] as const).map((field) => {
                    const val = (data as any)?.[field] ?? 0;
                    const prevVal = (prev as any)?.[field] ?? 0;
                    return (
                      <View key={field} style={[S.tdCell, S.colNum, { alignItems: "flex-end" }]}>
                        <Text style={{ fontSize: 12, color: val < 0 ? "#EF4444" : colors.foreground, fontWeight: val < 0 ? "700" : "400" }}>
                          {val === 0 ? "—" : val.toFixed(2)}
                        </Text>
                        {showComparison && prevVal !== 0 && (
                          <Text style={{ fontSize: 9, color: val > prevVal ? "#EF4444" : "#10B981" }}>
                            {val > prevVal ? "↑" : "↓"}{Math.abs(val - prevVal).toFixed(1)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {/* 分隔线 */}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
            {/* 合计行 */}
            <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
              <Text style={[S.tdCell, S.colCat, { fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
              {(["openingQty", "purchaseQty", "consumeQty", "closingQty"] as const).map((field) => {
                const total = Object.values(categorySummary).reduce((s, v) => s + ((v as any)[field] ?? 0), 0);
                const prevTotal = Object.values(prevCategorySummary).reduce((s, v) => s + ((v as any)[field] ?? 0), 0);
                return (
                  <View key={field} style={[S.tdCell, S.colNum, { alignItems: "flex-end" }]}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#991B1B" }}>{total.toFixed(2)}</Text>
                    {showComparison && prevTotal !== 0 && (
                      <Text style={{ fontSize: 9, color: total > prevTotal ? "#EF4444" : "#10B981" }}>
                        {total > prevTotal ? "↑" : "↓"}{Math.abs(total - prevTotal).toFixed(1)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* 进货汇总表（按供应商）已移除 */}
      {false && purchaseSummaryRows.rows.length > 0 && (
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>进货汇总（按供应商）</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
            <View>
              <View style={[S.tableHeader, { backgroundColor: "#991B1B" }]}>
                <Text style={[S.thCell, { width: 120 }]}>中文名</Text>
                <Text style={[S.thCell, { width: 60 }]}>参考价</Text>
                {purchaseSummaryRows.supplierNames.map((sup) => (
                  <React.Fragment key={sup}>
                    <Text style={[S.thCell, { width: 55 }]}>{sup.slice(0, 4)} 量</Text>
                    <Text style={[S.thCell, { width: 65 }]}>{sup.slice(0, 4)} 额</Text>
                  </React.Fragment>
                ))}
                <Text style={[S.thCell, { width: 70 }]}>合计金额</Text>
              </View>
              {purchaseSummaryRows.rows.map(({ item, bySupplier }, idx) => {
                const refPrice = getRefPrice(item.id, selectedMonth);
                const prevRefPrice = getRefPrice(item.id, prevMonth);
                const totalAmt = Object.values(bySupplier).reduce((s, v) => s + v.amount, 0);
                return (
                  <View key={item.id} style={[S.tableRow, { backgroundColor: idx % 2 === 0 ? colors.surface : colors.background }]}>
                    <View style={[S.tdCell, { width: 120 }]}>
                      <Text style={{ fontSize: 11, color: colors.foreground }} numberOfLines={2}>{item.name}</Text>
                    </View>
                    <View style={[S.tdCell, { width: 60, alignItems: "flex-end" }]}>
                      <Text style={{ fontSize: 11, color: colors.foreground }}>¥{refPrice}</Text>
                      {showComparison && prevRefPrice > 0 && prevRefPrice !== refPrice && (
                        <Text style={{ fontSize: 9, color: refPrice > prevRefPrice ? "#EF4444" : "#10B981" }}>
                          {refPrice > prevRefPrice ? "↑" : "↓"}¥{formatMoney(Math.abs(refPrice - prevRefPrice))}
                        </Text>
                      )}
                    </View>
                    {purchaseSummaryRows.supplierNames.map((sup) => {
                      const d = bySupplier[sup];
                      return (
                        <React.Fragment key={sup}>
                          <Text style={[S.tdCell, { width: 55, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {d ? d.qty : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 65, textAlign: "right", fontSize: 11, color: d ? "#EF4444" : colors.muted }]}>
                            {d ? `¥${formatMoney(d.amount)}` : "—"}
                          </Text>
                        </React.Fragment>
                      );
                    })}
                    <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 12, fontWeight: "700", color: "#EF4444" }]}>
                      ¥{formatMoney(totalAmt)}
                    </Text>
                  </View>
                );
              })}
              {/* 合计行 */}
              <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
                <Text style={[S.tdCell, { width: 120, fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
                <Text style={[S.tdCell, { width: 60 }]} />
                {purchaseSummaryRows.supplierNames.map((sup) => {
                  const supTotal = purchaseSummaryRows.rows.reduce((s, { bySupplier: bs }) => s + (bs[sup]?.amount ?? 0), 0);
                  const supQty = purchaseSummaryRows.rows.reduce((s, { bySupplier: bs }) => s + (bs[sup]?.qty ?? 0), 0);
                  return (
                    <React.Fragment key={sup}>
                      <Text style={[S.tdCell, { width: 55, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>{supQty}</Text>
                      <Text style={[S.tdCell, { width: 65, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>¥{formatMoney(supTotal)}</Text>
                    </React.Fragment>
                  );
                })}
                <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                  ¥{formatMoney(summaryTotals.purchaseAmt)}
                </Text>
              </View>
            </View>
          </ScrollView>
        </View>
      )}

      {/* 环形图（三维度切换） */}
      {chartData.length > 0 && (
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Text style={[S.cardTitle, { color: colors.foreground, marginBottom: 0 }]}>进货占比</Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {(["category", "group", "supplier"] as const).map((d) => (
                <TouchableOpacity key={d} onPress={() => setChartDimension(d)}
                  style={[S.toggleBtn, { backgroundColor: chartDimension === d ? "#EF4444" : colors.surface, borderColor: chartDimension === d ? "#EF4444" : colors.border }]}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: chartDimension === d ? "#fff" : colors.muted }}>
                    {d === "category" ? "分类" : d === "group" ? "集团" : "供应商"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {chartData.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
              <View style={{ flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                <View style={{ width: `${item.pct}%`, height: "100%", backgroundColor: item.color, borderRadius: 4 }} />
              </View>
              <Text style={{ fontSize: 11, color: colors.foreground, width: 120 }} numberOfLines={1}>{item.label}</Text>
              <Text style={{ fontSize: 11, fontWeight: "600", color: "#EF4444", width: 40, textAlign: "right" }}>{item.pct}%</Text>
            </View>
          ))}
        </View>
      )}

      {monthPurchases.length === 0 && monthLedger.length === 0 && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 48 }}>🥃</Text>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>
            {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月暂无数据
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            切换到「当月进货」录入进货记录
          </Text>
        </View>
      )}
    </ScrollView>
  );

  // ── 库存管理 Tab ─────────────────────────────────────────────────────────────
  const [ledgerEditMode, setLedgerEditMode] = useState(false);
  const [editingOpeningQty, setEditingOpeningQty] = useState<Record<string, string>>({});
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<SpiritItem | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  // 分类选择器 Modal
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [catPickerTitle, setCatPickerTitle] = useState("");
  const [catPickerCallback, setCatPickerCallback] = useState<((name: string) => void) | null>(null);
  const [ledgerImporting, setLedgerImporting] = useState(false);

  const handleSaveOpeningQty = (entry: SpiritLedgerEntry, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) return;
    const prevClosing = entry.prevClosingQty ?? 0;
    const changed = Math.abs(val - prevClosing) > 0.01;
    upsertLedger({
      ...entry,
      openingQty: val,
      openingManualOverride: changed,
      closingQty: val + entry.purchaseQty - entry.consumeQty,
      closingCost: (val + entry.purchaseQty - entry.consumeQty) * entry.closingUnitCost,
    });
  };

  // 库存管理 Tab：复合 Excel 导入（解析「烈酒盘点」sheet → 写入 SpiritItem + SpiritLedgerEntry）
  const [ledgerImportPreview, setLedgerImportPreview] = useState<SpiritMonthlySnapshot | null>(null);
  const [ledgerImportPriceChanges, setLedgerImportPriceChanges] = useState<SpiritPriceChange[]>([]);
  const [showLedgerPreview, setShowLedgerPreview] = useState(false);

  const handleLedgerExcelImport = async () => {
    try {
      setLedgerImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setLedgerImporting(false); return; }
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const { snapshot, priceChanges: changes, error } = parseSpiritInventoryExcel(base64);
      if (!snapshot || snapshot.items.length === 0) {
        Alert.alert("解析失败", error ?? "未能识别烈酒盘点数据\n\n请确认 Excel 包含「烈酒盘点」工作表，格式为：产品序号/盘点分类/中文名/期初库存量/期初单位成本/期初库存成本/本月进货量/本月进货成本/期末库存量/单位成本/期末库存成本/消耗瓶数/本期消耗量");
        setLedgerImporting(false); return;
      }
      setLedgerImportPreview(snapshot);
      setLedgerImportPriceChanges(changes);
      setShowLedgerPreview(true);
    } catch (e) {
      Alert.alert("导入失败", `文件解析错误: ${String(e)}`);
    } finally {
      setLedgerImporting(false);
    }
  };

  const handleLedgerImportConfirm = () => {
    if (!ledgerImportPreview) return;
    const snapshot = ledgerImportPreview;
    const importMonth = dominantPurchaseMonth(snapshot.purchaseOrders, selectedMonth);
    const resolvedItems = [...items];
    let addedItems = 0, updatedItems = 0, addedLedger = 0;

    snapshot.items.forEach((inv: SpiritInventoryItem) => {
      let existing = resolvedItems.find((item) => item.name.trim() === inv.name.trim());
      if (!existing) {
        existing = addItem({
          name: inv.name,
          category: inv.category,
          unit: "瓶",
          refPrice: inv.unitCost > 0 ? inv.unitCost : 0,
          active: true,
        });
        resolvedItems.push(existing);
        addedItems++;
      } else {
        if (inv.unitCost > 0 && Math.abs(inv.unitCost - existing.refPrice) > 0.01) {
          setRefPrice(existing.id, importMonth, inv.unitCost, "import");
        }
        updatedItems++;
      }
      const prevEntry = getItemLedger(existing.id, importMonth);
      upsertLedger({
        id: prevEntry?.id,
        month: importMonth,
        itemId: existing.id,
        openingQty: inv.initQty,
        openingUnitCost: inv.initUnitCost > 0 ? inv.initUnitCost : inv.unitCost,
        purchaseQty: inv.purchaseQty,
        purchaseCost: inv.purchaseCost,
        consumeQty: inv.consumeQty,
        closingQty: inv.endQty,
        closingUnitCost: inv.unitCost,
        closingCost: inv.endCost,
        isClosed: false,
      });
      addedLedger++;
    });

    const firstPass = buildImportedPurchaseRecords(snapshot.purchaseOrders, resolvedItems, importMonth);
    firstPass.unmatched.forEach((order: SpiritPurchaseOrderItem) => {
      const existing = resolvedItems.find((item) => item.name.trim() === (order.nameZh || order.rawName).trim());
      if (existing) return;
      const item = addItem({
        name: order.nameZh || order.rawName,
        category: "Other",
        unit: order.spec || "瓶",
        refPrice: order.unitPrice,
        supplier: order.supplier,
        spec: order.spec,
        active: true,
      });
      resolvedItems.push(item);
      addedItems++;
    });
    const purchaseImport = buildImportedPurchaseRecords(snapshot.purchaseOrders, resolvedItems, importMonth);
    batchAddPurchases(purchaseImport.records);

    // 盘点主月份以Excel台账为准；跨月订单仅重建其实际归属月份，避免覆盖盘点期末数。
    const crossMonthRecords = purchaseImport.records.filter((record) => record.month !== importMonth);
    for (const month of new Set(crossMonthRecords.map((record) => record.month))) {
      syncLedgerFromPurchases(month, crossMonthRecords.filter((record) => record.month === month));
    }

    setShowLedgerPreview(false);
    setLedgerImportPreview(null);
    Alert.alert(
      "导入成功 ✅",
      `${snapshot.monthLabel}\n` +
      `台账：${addedLedger} 款已写入\n` +
      `当月进货：${purchaseImport.records.length} 笔已同步\n` +
      `酒款档案：新增 ${addedItems} 款，更新 ${updatedItems} 款` +
      (ledgerImportPriceChanges.length > 0 ? `\n⚠️ ${ledgerImportPriceChanges.length} 款价格有变动` : "")
    );
  };

  const renderLedger = () => (
    <View style={{ flex: 1 }}>
      {/* 操作栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" }}>
        <TouchableOpacity onPress={() => { tap(); setShowAddItem(true); }}
          style={[S.actionBtn, { backgroundColor: "#EF4444" + "15", borderColor: "#EF4444" + "33" }]}>
          <IconSymbol name="plus" size={13} color="#EF4444" />
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>新增酒款</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLedgerExcelImport}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ledgerImporting ? <ActivityIndicator size="small" color={colors.primary} /> : <IconSymbol name="square.and.arrow.down" size={13} color={colors.primary} />}
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>导入Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          Alert.alert("月结确认", `将 ${selectedMonth} 的期末库存带入下月期初？`, [
            { text: "取消", style: "cancel" },
            { text: "确认月结", onPress: () => { closeMonth(selectedMonth); Alert.alert("月结完成", "期末库存已带入下月期初"); } },
          ]);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="checkmark.seal.fill" size={13} color={colors.primary} />
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>月结</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { tap(); setLedgerEditMode(!ledgerEditMode); }}
          style={[S.actionBtn, { backgroundColor: ledgerEditMode ? "#EF4444" : colors.surface, borderColor: ledgerEditMode ? "#EF4444" : colors.border }]}>
          <IconSymbol name="pencil" size={13} color={ledgerEditMode ? "#fff" : colors.muted} />
          <Text style={{ fontSize: 12, color: ledgerEditMode ? "#fff" : colors.muted, fontWeight: "600" }}>
            {ledgerEditMode ? "完成" : "编辑期初"}
          </Text>
        </TouchableOpacity>
        {/* ★ 月末盘点按钮 */}
        <TouchableOpacity onPress={() => {
          tap();
          // 预填当前期末库存量
          const initVals: Record<string, string> = {};
          monthLedger.forEach((e) => { initVals[e.itemId] = String(e.closingQty); });
          setStocktakeValues(initVals);
          setShowStocktakeModal(true);
        }} style={[S.actionBtn, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}>
          <IconSymbol name="checklist" size={13} color="#F59E0B" />
          <Text style={{ fontSize: 12, color: "#F59E0B", fontWeight: "600" }}>月末盘点</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 横向滚动表格 */}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {items.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 48 }}>🥃</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有酒款档案</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>点击「新增酒款」或导入 Excel</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
            <View>
              {/* 表头 */}
              <View style={[S.tableHeader, { backgroundColor: "#991B1B" }]}>
                <Text style={[S.thCell, { width: 36 }]}>序</Text>
                <Text style={[S.thCell, { width: 56 }]}>分类</Text>
                <Text style={[S.thCell, { width: 130 }]}>中文名</Text>
                <Text style={[S.thCell, { width: 70 }]}>参考价</Text>
                <Text style={[S.thCell, { width: 70 }]}>期初库存量</Text>
                <Text style={[S.thCell, { width: 60 }]}>期初单价</Text>
                <Text style={[S.thCell, { width: 70 }]}>期初成本</Text>
                <Text style={[S.thCell, { width: 70 }]}>本月进货量</Text>
                <Text style={[S.thCell, { width: 70 }]}>进货成本</Text>
                <Text style={[S.thCell, { width: 70 }]}>期末库存量</Text>
                <Text style={[S.thCell, { width: 60 }]}>单位成本</Text>
                <Text style={[S.thCell, { width: 70 }]}>期末成本</Text>
                <Text style={[S.thCell, { width: 60 }]}>消耗瓶数</Text>
                <Text style={[S.thCell, { width: 70 }]}>本期消耗量</Text>
              </View>
              {/* 按分类分组（动态，未分类置顶） */}
              {(() => {
                const allCats = getAllCategories();
                const unclassified = items.filter((i) => i.active && (!i.category || i.category === "" || (!SPIRIT_CATEGORIES.includes(i.category as any) && !allCats.find((c) => c.name === i.category))));
                const catGroups: Array<{ cat: string; catItems: SpiritItem[] }> = [];
                // 未分类置顶
                if (unclassified.length > 0) catGroups.push({ cat: "__unclassified__", catItems: unclassified });
                // 内置分类
                SPIRIT_CATEGORIES.forEach((cat) => {
                  const catItems = items.filter((i) => i.category === cat && i.active);
                  if (catItems.length > 0) catGroups.push({ cat, catItems });
                });
                // 自定义分类
                allCats.filter((c) => !SPIRIT_CATEGORIES.includes(c.name as any)).forEach((c) => {
                  const catItems = items.filter((i) => i.category === c.name && i.active);
                  if (catItems.length > 0) catGroups.push({ cat: c.name, catItems });
                });
                return catGroups.map(({ cat, catItems }) => {
                  const isUnclassified = cat === "__unclassified__";
                  const displayCat = isUnclassified ? "⚠️ 未分类" : cat;
                  const color = isUnclassified ? "#F59E0B" : catColor(cat);
                  return (
                    <React.Fragment key={cat}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: color + "20" }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                        <Text style={{ fontSize: 11, fontWeight: "700", color }}>{displayCat}</Text>
                        {isUnclassified && <Text style={{ fontSize: 10, color: "#F59E0B" }}>（请补充分类）</Text>}
                      </View>
                      {catItems.map((item, idx) => {
                        const entry = getItemLedger(item.id, selectedMonth);
                        const isNeg = entry && entry.closingQty < 0;
                        const isOverride = entry?.openingManualOverride;
                        const editKey = `${item.id}:${selectedMonth}`;
                        return (
                          <TouchableOpacity key={item.id}
                            onLongPress={() => {
                              tap();
                              Alert.alert(item.name, "选择操作", [
                                { text: "编辑酒款", onPress: () => { setEditingItem(item); setShowItemForm(true); } },
                                { text: "修改分类", onPress: () => {
                                  setCatPickerTitle(`修改分类：${item.name}\n当前：${item.category || "未分类"}`);
                                  setCatPickerCallback(() => (name: string) => updateItem(item.id, { category: name, categorySource: "manual" }));
                                  setShowCatPicker(true);
                                }},
                                ...(item.bottleId ? [
                                  { text: "查看酒库档案 →", onPress: () => router.push(`/bottle/${item.bottleId}` as any) },
                                  { text: "更换酒库链接", onPress: () => { setEditingItem(item); setShowItemForm(true); } },
                                  { text: "取消酒库链接", onPress: () => updateItem(item.id, { bottleId: undefined, bottleLinkConfidence: "none" }) },
                                ] : [
                                  { text: "关联酒库档案", onPress: () => { setEditingItem(item); setShowItemForm(true); } },
                                ]),
                                { text: "删除酒款", style: "destructive" as const, onPress: () => {
                                  Alert.alert("确认删除", `删除「${item.name}」？`, [
                                    { text: "取消", style: "cancel" },
                                    { text: "删除", style: "destructive", onPress: () => deleteItem(item.id) },
                                  ]);
                                }},
                                { text: "取消", style: "cancel" as const },
                              ]);
                            }}
                            style={[S.tableRow, { backgroundColor: isNeg ? "#FEF2F2" : idx % 2 === 0 ? colors.surface : colors.background }]}>
                            <Text style={[S.tdCell, { width: 36, textAlign: "center", fontSize: 11, color: colors.muted }]}>{idx + 1}</Text>
                            {/* 分类列（固定） */}
                            <TouchableOpacity style={[S.tdCell, { width: 56, alignItems: "center" }]}
                              onPress={() => {
                                setCatPickerTitle(`修改分类：${item.name}`);
                                setCatPickerCallback(() => (name: string) => updateItem(item.id, { category: name, categorySource: "manual" }));
                                setShowCatPicker(true);
                              }}>
                              <View style={{ backgroundColor: (isUnclassified ? "#F59E0B" : catColor(item.category)) + "25",
                                borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, maxWidth: 52 }}>
                                <Text style={{ fontSize: 9, fontWeight: "700",
                                  color: isUnclassified ? "#F59E0B" : catColor(item.category) }}
                                  numberOfLines={2}>
                                  {isUnclassified ? "未分类" : (item.category.length > 8 ? item.category.slice(0, 8) + "…" : item.category)}
                                </Text>
                              </View>
                            </TouchableOpacity>
                            <Text style={[S.tdCell, { width: 130, fontSize: 11, color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
                          {/* 参考价列（可点击编辑） */}
                          {(() => {
                            const rp = getRefPrice(item.id, selectedMonth);
                            return (
                              <TouchableOpacity style={[S.tdCell, { width: 70, alignItems: "flex-end" }]}
                                onPress={() => {
                                  tap();
                                  Alert.prompt(
                                    "修改参考价",
                                    `「${item.name}」当前参考价：¥${rp > 0 ? formatMoney(rp) : "未设置"}`,
                                    (val) => {
                                      const n = parseFloat(val ?? "");
                                      if (!isNaN(n) && n >= 0) {
                                        setRefPrice(item.id, selectedMonth, n);
                                      } else if (val) {
                                        Alert.alert("请输入有效价格");
                                      }
                                    },
                                    "plain-text",
                                    rp > 0 ? String(rp.toFixed(0)) : "",
                                    "decimal-pad"
                                  );
                                }}>
                                <Text style={{ fontSize: 11, color: rp > 0 ? "#EF4444" : colors.muted, fontWeight: rp > 0 ? "600" : "400" }}>
                                  {rp > 0 ? `¥${formatMoney(rp)}` : "—"}
                                </Text>
                              </TouchableOpacity>
                            );
                          })()}
                          {/* 期初库存量（内联编辑） */}
                          <View style={[S.tdCell, { width: 70, alignItems: "flex-end" }]}>
                            {ledgerEditMode ? (
                              <TextInput
                                style={[S.inlineInput, { color: colors.foreground, borderColor: isOverride ? "#F59E0B" : colors.border }]}
                                value={editingOpeningQty[editKey] ?? String(entry?.openingQty ?? "")}
                                onChangeText={(v) => setEditingOpeningQty((prev) => ({ ...prev, [editKey]: v }))}
                                onBlur={() => {
                                  if (entry && editingOpeningQty[editKey] !== undefined) {
                                    handleSaveOpeningQty(entry, editingOpeningQty[editKey]);
                                  }
                                }}
                                keyboardType="decimal-pad"
                                placeholder="0"
                                placeholderTextColor={colors.muted}
                              />
                            ) : (
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ fontSize: 11, color: colors.foreground }}>{entry?.openingQty ?? "—"}</Text>
                                {isOverride && <Text style={{ fontSize: 9, color: "#F59E0B" }}>⚠️ 已修改</Text>}
                              </View>
                            )}
                          </View>
                          <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney(entry.openingUnitCost)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney((entry.openingQty * entry.openingUnitCost))}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseQty > 0 ? `+${entry.purchaseQty}` : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseCost > 0 ? `¥${formatMoney(entry.purchaseCost)}` : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 12, fontWeight: "700",
                            color: isNeg ? "#EF4444" : colors.foreground }]}>
                            {entry ? `${isNeg ? "⚠️" : ""}${entry.closingQty.toFixed(2)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney(entry.closingUnitCost)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: "#EF4444" }]}>
                            {entry ? `¥${formatMoney(entry.closingCost)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? entry.consumeQty.toFixed(1) : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? `¥${formatMoney((entry.consumeQty * entry.closingUnitCost))}` : "—") : "—"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    <View style={{ height: 4, backgroundColor: colors.border + "40" }} />
                  </React.Fragment>
                );
              });
              })()}
              {/* 合计行 */}
              {monthLedger.length > 0 && (
                <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
                  <Text style={[S.tdCell, { width: 36 }]} />
                  <Text style={[S.tdCell, { width: 56 }]} />
                  <Text style={[S.tdCell, { width: 130, fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
                  <Text style={[S.tdCell, { width: 70 }]} />
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {summaryTotals.openingQty.toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60 }]} />
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{formatMoney(summaryTotals.openingCost)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {summaryTotals.purchaseQty.toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{formatMoney(summaryTotals.purchaseCost)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                    {summaryTotals.closingQty.toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60 }]} />
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{formatMoney(summaryTotals.closingCost)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {summaryTotals.consumeQty.toFixed(1)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{formatMoney(summaryTotals.consumeCost)}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );

  // ── 当月进货 Tab ─────────────────────────────────────────────────────────────
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  // 未匹配商品操作 Modal（供应商列表页提示条使用）
  const [unmatchedPurchase, setUnmatchedPurchase] = useState<SpiritPurchaseRecord | null>(null);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  // 集团管理 Modal（采购分析 Tab 使用）
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SpiritGroupDef | null>(null);

  const allSupplierNames = useMemo(() => {
    const fromPurchases = [...new Set(purchases.map((p) => p.supplier ?? "未知供应商"))];
    const fromStore = suppliers.map((s) => s.name);
    return [...new Set([...fromStore, ...fromPurchases, "自采"])];
  }, [purchases, suppliers]);

  const renderPurchase = () => {
    if (activeSupplier !== null) {
      return (
        <SupplierDetailScreen
          supplier={activeSupplier}
          month={selectedMonth}
          colors={colors}
          insets={insets}
          items={items}
          purchases={purchases}
          store={store}
          pettyStore={pettyStore}
          onBack={() => setActiveSupplier(null)}
        />
      );
    }
    const supSummary = getPurchaseSummaryBySupplier(selectedMonth);
    const totalAmt = Object.values(supSummary).reduce((s, v) => s + v.amount, 0);
    const totalQty = Object.values(supSummary).reduce((s, v) => s + v.qty, 0);
    const totalItems = Object.values(supSummary).reduce((s, v) => s + v.items, 0);

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          <TouchableOpacity onPress={() => { tap(); setShowAddSupplier(true); }}
            style={[S.actionBtn, { backgroundColor: "#EF4444" + "15", borderColor: "#EF4444" + "33" }]}>
            <IconSymbol name="plus" size={13} color="#EF4444" />
            <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>新增供应商</Text>
          </TouchableOpacity>
        </View>

        {/* 当月合计卡 */}
        <View style={[S.card, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#991B1B", marginBottom: 8 }}>
            {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月 · 进货合计
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[
              { label: "总金额", value: `¥${fmtAmt(totalAmt)}`, color: "#EF4444" },
              { label: "总笔数", value: `${totalQty}笔`, color: "#991B1B" },
              { label: "总品种", value: `${totalItems}款`, color: "#991B1B" },
            ].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 10, color: "#991B1B" }}>{s.label}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: s.color }}>{s.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 未匹配汇总提示条 */}
        {(() => {
          const unmatchedList = monthPurchases.filter((p) => !p.itemId);
          if (unmatchedList.length === 0) return null;
          return (
            <TouchableOpacity
              onPress={() => {
                tap();
                // 跳转到第一个有未匹配记录的供应商，在供应商详情页处理
                const firstSupplier = unmatchedList[0]?.supplier ?? "未知供应商";
                setActiveSupplier(firstSupplier);
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12,
                backgroundColor: "#FEF3C7", borderRadius: 10, borderWidth: 1,
                borderColor: "#FCD34D", marginBottom: 12 }}>
              <Text style={{ fontSize: 16 }}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#92400E" }}>
                  {unmatchedList.length} 条进货记录未匹配到酒款档案
                </Text>
                <Text style={{ fontSize: 11, color: "#B45309" }}>
                  点击处理 · 匹配后可参与库存计算和采购分析
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: "#92400E", fontWeight: "600" }}>逐一处理 ›</Text>
            </TouchableOpacity>
          );
        })()}

        {/* 供应商列表 */}
        {allSupplierNames.map((sup) => {
          const data = supSummary[sup];
          return (
            <TouchableOpacity key={sup} onPress={() => { tap(); setActiveSupplier(sup); }}
              style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 20 }}>{sup === "自采" ? "🛒" : "🏢"}</Text>
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup}</Text>
                    {data ? (
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        本月 ¥{formatMoney(data.amount)} · {data.qty}笔 · {data.items}款
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 12, color: colors.muted }}>本月暂无进货</Text>
                    )}
                  </View>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </View>
            </TouchableOpacity>
          );
        })}

        {allSupplierNames.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 48 }}>🏢</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有供应商</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>点击「新增供应商」添加</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  // ── 采购分析 Tab ─────────────────────────────────────────────────────────────
  const renderAnalysis = () => {
    const supSummary = getPurchaseSummaryBySupplier(selectedMonth);
    const totalAmt = Object.values(supSummary).reduce((s, v) => s + v.amount, 0) || 1;
    const groupTotals: Record<string, number> = {};
    monthPurchases.forEach((p) => {
      const item = items.find((i) => i.id === p.itemId);
      if (!item) return;
      const g = getItemGroup(item);
      groupTotals[g] = (groupTotals[g] ?? 0) + p.amount;
    });
    const groupTotal = Object.values(groupTotals).reduce((s, v) => s + v, 0) || 1;
    const COLORS = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 供应商分析 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>🏢 供应商分析</Text>
          {Object.entries(supSummary).sort((a, b) => b[1].amount - a[1].amount).map(([sup, data], i) => {
            const pct = Math.round(data.amount / totalAmt * 100);
            const color = COLORS[i % COLORS.length];
            const supInfo = getSupplierByName(sup);
            return (
              <View key={sup} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{sup}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444" }}>¥{formatMoney(data.amount)} · {pct}%</Text>
                </View>
                <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                  <View style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 4 }} />
                </View>
                {supInfo && (
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {(supInfo.contact ?? supInfo.contactName) && (
                      <Text style={{ fontSize: 11, color: colors.muted }}>👤 {supInfo.contact ?? supInfo.contactName}</Text>
                    )}
                    {supInfo.phone && <Text style={{ fontSize: 11, color: colors.muted }}>📞 {supInfo.phone}</Text>}
                    {supInfo.bankAccount && (
                      <TouchableOpacity onPress={() => {
                        const info = `${supInfo.name}\n${supInfo.bankName ?? ""}\n${supInfo.bankAccount}`;
                        Alert.alert("银行信息", info, [
                          { text: "取消", style: "cancel" },
                          { text: "复制", onPress: () => Alert.alert("已复制", "银行信息已复制") },
                        ]);
                      }}>
                        <Text style={{ fontSize: 11, color: colors.primary }}>🏦 一键复制</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
          {Object.keys(supSummary).length === 0 && (
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>本月暂无供应商数据</Text>
          )}
        </View>

        {/* 品牌集团分析 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>🏷️ 品牌集团分析</Text>
          {Object.entries(groupTotals).sort((a, b) => b[1] - a[1]).map(([g, amt], i) => {
            const pct = Math.round(amt / groupTotal * 100);
            const groupDef = groups.find((gd) => gd.name === g);
            const color = groupDef?.color ?? COLORS[i % COLORS.length];
            return (
              <View key={g} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                <View style={{ flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                  <View style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: 4 }} />
                </View>
                <Text style={{ fontSize: 11, color: colors.foreground, width: 120 }} numberOfLines={1}>{g}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#EF4444", width: 70, textAlign: "right" }}>
                  ¥{formatMoney(amt)} {pct}%
                </Text>
              </View>
            );
          })}
          {Object.keys(groupTotals).length === 0 && (
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>本月暂无集团数据</Text>
          )}
        </View>

        {/* 集团管理 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Text style={[S.cardTitle, { color: colors.foreground, marginBottom: 0 }]}>集团管理</Text>
            <TouchableOpacity onPress={() => { tap(); setShowGroupManager(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5,
                backgroundColor: colors.primary + "15", borderRadius: 8 }}>
              <IconSymbol name="square.and.pencil" size={12} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>管理</Text>
            </TouchableOpacity>
          </View>
          {groups.map((g) => (
            <TouchableOpacity key={g.id}
              onPress={() => { tap(); setEditingGroup(g); setShowGroupManager(true); }}
              style={[S.supplierRow, { borderBottomColor: colors.border }]}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: g.color, marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{g.name}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                  {g.keywords.slice(0, 6).join(" · ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{g.keywords.length} 个关键词</Text>
                {!g.builtin && <Text style={{ fontSize: 9, color: "#10B981" }}>自定义</Text>}
              </View>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { tap(); setEditingGroup(null); setShowGroupManager(true); }}
            style={[S.actionBtn, { marginTop: 8, borderColor: colors.border }]}>
            <IconSymbol name="plus" size={13} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>新增集团</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  // ── 主渲染 ────────────────────────────────────────────────────────────────────
  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 8 }}>
        {/* 上行：标题小字 */}
        <View style={{ alignItems: "center", paddingTop: 6, paddingBottom: 2 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "500" }}>
            {activeSupplier ? activeSupplier : "烈酒库存管理"}
          </Text>
        </View>
        {/* 下行：返回 + 月份居中 + 左右切换 */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }}>
          {/* 返回按鈕 */}
          <TouchableOpacity onPress={() => {
            tap();
            if (activeSupplier !== null) { setActiveSupplier(null); return; }
            router.back();
          }} style={{ width: 36, alignItems: "flex-start" }}>
            <IconSymbol name="chevron.left" size={20} color="#EF4444" />
          </TouchableOpacity>
          {/* 月份居中区域 */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 }}>
            {/* 上一个月 */}
            <TouchableOpacity onPress={() => {
              tap();
              const [y, m] = selectedMonth.split("-").map(Number);
              const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
              handleMonthChange(prev);
            }}>
              <IconSymbol name="chevron.left" size={18} color={colors.foreground} />
            </TouchableOpacity>
            {/* 月份文字（点击弹出选择器） */}
            <TouchableOpacity onPress={() => { tap(); setShowMonthPicker(true); }}
              style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>
                {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月
              </Text>
            </TouchableOpacity>
            {/* 下一个月 */}
            <TouchableOpacity onPress={() => {
              tap();
              const [y, m] = selectedMonth.split("-").map(Number);
              const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
              // 不允许跳过当前月
              if (next <= getCurrentMonth()) handleMonthChange(next);
              else tap();
            }}>
              <IconSymbol name="chevron.right" size={18}
                color={selectedMonth >= getCurrentMonth() ? colors.border : colors.foreground} />
            </TouchableOpacity>
          </View>
          {/* 右侧占位（对称布局） */}
          <View style={{ width: 36 }} />
        </View>
      </View>

      {/* Tab 选择器（供应商子界面时隐藏） */}
      {activeSupplier === null && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
              style={[S.tabChip, {
                backgroundColor: tab === t.key ? "#EF4444" : colors.surface,
                borderColor: tab === t.key ? "#EF4444" : colors.border,
              }]}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Tab 内容 */}
      {activeSupplier === null ? (
        <>
          {tab === "summary" && renderSummary()}
          {tab === "ledger" && renderLedger()}
          {tab === "purchase" && renderPurchase()}
          {tab === "analysis" && renderAnalysis()}
        </>
      ) : (
        renderPurchase()
      )}

      {/* 月份选择 Modal */}
      <Modal visible={showMonthPicker} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "70%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>选择月份</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>共 {availableMonths.length} 个月</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {availableMonths.map((mo) => {
                const hasPurchase = purchases.some((p) => p.month === mo);
                const hasLedger = ledger.some((e) => e.month === mo);
                const hasData = hasPurchase || hasLedger;
                const isCurrent = mo === getCurrentMonth();
                const isSelected = mo === selectedMonth;
                return (
                  <TouchableOpacity key={mo} onPress={() => { tap(); handleMonthChange(mo); setShowMonthPicker(false); }}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
                      backgroundColor: isSelected ? "#EF444410" : "transparent",
                      paddingHorizontal: 4, borderRadius: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {isSelected && <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: "#EF4444" }} />}
                      <Text style={{ fontSize: 15, color: isSelected ? "#EF4444" : colors.foreground, fontWeight: isSelected ? "700" : "400" }}>
                        {mo.slice(0, 4)}年{Number(mo.slice(5, 7))}月
                      </Text>
                      {isCurrent && <View style={{ paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#EF444420", borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, color: "#EF4444", fontWeight: "600" }}>当前</Text>
                      </View>}
                    </View>
                    {hasData && (
                      <Text style={{ fontSize: 11, color: colors.primary }}>
                        {hasPurchase ? `${purchases.filter((p) => p.month === mo).length}笔进货` : "有台账"}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowMonthPicker(false)}
              style={{ marginTop: 12, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center" }}>
              <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 新增供应商 Modal */}
      <Modal visible={showAddSupplier} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>新增供应商</Text>
              <TextInput
                style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={newSupplierName}
                onChangeText={setNewSupplierName}
                placeholder="供应商名称（如：至缘、戎恒、自采）"
                placeholderTextColor={colors.muted}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
                <TouchableOpacity onPress={() => { setShowAddSupplier(false); setNewSupplierName(""); }}
                  style={{ flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (!newSupplierName.trim()) return;
                  upsertSupplier({ name: newSupplierName.trim(), isSelfBuy: newSupplierName.includes("自采") });
                  setShowAddSupplier(false);
                  setNewSupplierName("");
                }} style={{ flex: 1, padding: 14, backgroundColor: "#EF4444", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, color: "#fff", fontWeight: "700" }}>添加</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* 新增酒款 Modal */}
      {(showAddItem || showItemForm) && (
        <ItemFormModal
          visible={showAddItem || showItemForm}
          item={editingItem}
          colors={colors}
          allCategories={getAllCategories()}
          onSave={(data) => {
            if (editingItem) updateItem(editingItem.id, data);
            else addItem(data);
            setShowAddItem(false);
            setShowItemForm(false);
            setEditingItem(null);
          }}
          onClose={() => { setShowAddItem(false); setShowItemForm(false); setEditingItem(null); }}
        />
      )}
      {/* 分类选择器 Modal */}
      <CategoryPickerModal
        visible={showCatPicker}
        title={catPickerTitle}
        categories={getAllCategories()}
        onSelect={(name) => { if (catPickerCallback) catPickerCallback(name); }}
        onClose={() => { setShowCatPicker(false); setCatPickerCallback(null); }}
        colors={colors}
      />
      {/* 库存管理 Excel 导入预览 Modal */}
      <Modal visible={showLedgerPreview} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* 头部 */}
          <View style={[S.navbar, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
            <TouchableOpacity onPress={() => { setShowLedgerPreview(false); setLedgerImportPreview(null); }}>
              <Text style={{ fontSize: 15, color: "#EF4444", fontWeight: "600" }}>取消</Text>
            </TouchableOpacity>
            <View style={{ alignItems: "center" }}>
              <Text style={[S.navTitle, { color: colors.foreground }]}>{ledgerImportPreview?.monthLabel ?? "导入预览"}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>{ledgerImportPreview?.items.length} 款烈酒</Text>
            </View>
            <TouchableOpacity onPress={handleLedgerImportConfirm}>
              <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "700" }}>确认导入</Text>
            </TouchableOpacity>
          </View>

          {/* 汇总统计 */}
          {ledgerImportPreview && (
            <View style={{ flexDirection: "row", padding: 12, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              {[
                { label: "本月进货", value: `¥${formatMoney(ledgerImportPreview.totalPurchase)}`, color: "#EF4444" },
                { label: "本月消耗", value: ledgerImportPreview.totalConsume.toFixed(1), color: colors.foreground },
                { label: "期末成本", value: `¥${formatMoney(ledgerImportPreview.totalEndCost)}`, color: colors.primary },
                { label: "进货记录", value: `${ledgerImportPreview.purchaseOrders.length}笔`, color: colors.foreground },
              ].map((s, i) => (
                <View key={i} style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: s.color }}>{s.value}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted }}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 价格变动提示 */}
          {ledgerImportPriceChanges.length > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#FEF3C7", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#FCD34D" }}>
              <IconSymbol name="exclamationmark.triangle.fill" size={14} color="#D97706" />
              <Text style={{ fontSize: 12, color: "#D97706", fontWeight: "600" }}>
                {ledgerImportPriceChanges.length} 款商品价格有变动
              </Text>
            </View>
          )}

          {/* 台账预览列表 */}
          <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
            <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
              <View>
                {/* 表头 */}
                <View style={[S.tableHeader, { backgroundColor: "#991B1B" }]}>
                  <Text style={[S.thCell, { width: 130 }]}>中文名</Text>
                  <Text style={[S.thCell, { width: 60 }]}>分类</Text>
                  <Text style={[S.thCell, { width: 60 }]}>期初量</Text>
                  <Text style={[S.thCell, { width: 60 }]}>进货量</Text>
                  <Text style={[S.thCell, { width: 60 }]}>消耗量</Text>
                  <Text style={[S.thCell, { width: 60 }]}>期末量</Text>
                  <Text style={[S.thCell, { width: 70 }]}>单位成本</Text>
                  <Text style={[S.thCell, { width: 80 }]}>期末成本</Text>
                </View>
                {ledgerImportPreview?.items.map((inv, idx) => (
                  <View key={idx} style={[S.tableRow, { backgroundColor: idx % 2 === 0 ? colors.surface : colors.background }]}>
                    <Text style={[S.tdCell, { width: 130, fontSize: 11, color: colors.foreground }]} numberOfLines={2}>{inv.name}</Text>
                    <Text style={[S.tdCell, { width: 60, fontSize: 10, color: colors.muted }]} numberOfLines={1}>{inv.category}</Text>
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.foreground }]}>{inv.initQty}</Text>
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: inv.purchaseQty > 0 ? colors.primary : colors.muted }]}>
                      {inv.purchaseQty > 0 ? `+${inv.purchaseQty}` : "—"}
                    </Text>
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.muted }]}>{inv.consumeQty > 0 ? inv.consumeQty.toFixed(1) : "—"}</Text>
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 12, fontWeight: "700", color: inv.endQty < 0 ? "#EF4444" : colors.foreground }]}>
                      {inv.endQty < 0 ? `⚠️${inv.endQty}` : inv.endQty}
                    </Text>
                    <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.foreground }]}>¥{formatMoney(inv.unitCost)}</Text>
                    <Text style={[S.tdCell, { width: 80, textAlign: "right", fontSize: 11, color: "#EF4444" }]}>¥{formatMoney(inv.endCost)}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* 价格变动列表 */}
            {ledgerImportPriceChanges.length > 0 && (
              <View style={{ margin: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#D97706", marginBottom: 8 }}>⚠️ 价格变动明细</Text>
                {ledgerImportPriceChanges.map((c, i) => (
                  <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }} numberOfLines={1}>{c.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginHorizontal: 8 }}>¥{formatMoney(c.prevPrice)} → ¥{formatMoney(c.currPrice)}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: c.changeAmt > 0 ? "#EF4444" : "#10B981" }}>
                      {c.changeAmt > 0 ? "↑" : "↓"}¥{formatMoney(Math.abs(c.changeAmt))}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* 集团管理 Modal（采购分析 Tab 使用） */}
      <GroupManagerModal
        visible={showGroupManager}
        groups={groups}
        editingGroup={editingGroup}
        colors={colors}
        onUpsert={upsertGroup}
        onDelete={deleteGroup}
        onMerge={mergeGroup}
        onClose={() => { setShowGroupManager(false); setEditingGroup(null); }}
      />

      {/* ★ 月末盘点 Modal */}
      <Modal visible={showStocktakeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowStocktakeModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Pressable onPress={() => setShowStocktakeModal(false)}>
              <Text style={{ fontSize: 16, color: colors.primary }}>取消</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>月末盘点</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月 · 填入实际期末库存量</Text>
            </View>
            <Pressable onPress={() => {
              const entries = items
                .filter((item) => stocktakeValues[item.id] !== undefined && stocktakeValues[item.id] !== "")
                .map((item) => ({ itemId: item.id, actualQty: parseFloat(stocktakeValues[item.id] ?? "0") || 0 }));
              if (entries.length === 0) { Alert.alert("请至少填写一款酒的期末库存量"); return; }
              batchSetActualClosing(selectedMonth, entries);
              setShowStocktakeModal(false);
              Alert.alert("盘点完成", `已更新 ${entries.length} 款酒的期末库存量，消耗量已自动测算`);
            }}>
              <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>保存</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
            <View style={{ backgroundColor: "#F59E0B11", borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "#F59E0B44" }}>
              <Text style={{ fontSize: 13, color: "#92400E" }}>💡 填入实际盘点到的期末库存量，系统自动计算：消耗 = 期初 + 进货 - 期末。空白表示不修改该款酒。</Text>
            </View>
            {items.map((item) => {
              const entry = monthLedger.find((e) => e.itemId === item.id);
              const expectedClosing = entry ? entry.openingQty + entry.purchaseQty : 0;
              const actualVal = stocktakeValues[item.id] ?? "";
              const actualQty = parseFloat(actualVal) || 0;
              const consumeQty = actualVal !== "" ? Math.max(0, (entry?.openingQty ?? 0) + (entry?.purchaseQty ?? 0) - actualQty) : null;
              return (
                <View key={item.id} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{item.category} · 理论期末 {expectedClosing.toFixed(1)} 瓶</Text>
                    </View>
                    <TextInput
                      value={actualVal}
                      onChangeText={(v) => setStocktakeValues((prev) => ({ ...prev, [item.id]: v }))}
                      placeholder={String(expectedClosing.toFixed(1))}
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={{ width: 80, borderWidth: 1, borderColor: actualVal !== "" ? "#F59E0B" : colors.border, borderRadius: 8, padding: 8, fontSize: 15, fontWeight: "700", color: colors.foreground, backgroundColor: colors.background, textAlign: "center" }}
                    />
                  </View>
                  {consumeQty !== null && (
                    <Text style={{ fontSize: 11, color: consumeQty > 0 ? colors.warning : colors.muted }}>
                      自动测算消耗：{consumeQty.toFixed(1)} 瓶
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

    </ScreenContainer>
  );
}

// ─── 供应商详情子界面 ──────────────────────────────────────────────────────────
function SupplierDetailScreen({
  supplier, month, colors, insets, items, purchases, store, pettyStore, onBack,
}: {
  supplier: string; month: string; colors: any; insets: any;
  items: SpiritItem[]; purchases: SpiritPurchaseRecord[];
  store: ReturnType<typeof useSpiritsInventoryStore>;
  pettyStore: any;
  onBack: () => void;
}) {
  const {
    addPurchase, deletePurchase, batchAddPurchases, batchDeletePurchases,
    updatePurchase, updateItem,
    setRefPrice, getRefPrice, setMatchMemory, matchPettyToItem,
    selfBuyConfig, syncLedgerFromPurchases,
    getMonthLedger,
    groups, detectPurchaseGroup, getItemGroup, rememberGroupMatch,
    upsertGroup, deleteGroup, mergeGroup,
    addItem,
    getMonthPurchases,
  } = store;
  const router2 = useRouter();
  const monthPurchases = useMemo(() => getMonthPurchases(month), [purchases, month]);
  const isSelfBuy = supplier === "自采";
  const [y, m] = month.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

  const supPurchases = useMemo(
    () => purchases.filter((p) => p.month === month && (p.supplier ?? "未知供应商") === supplier)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [purchases, month, supplier]
  );

  const totalAmt = supPurchases.reduce((s, p) => s + p.amount, 0);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showPettyImport, setShowPettyImport] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [pdfImporting, setPdfImporting] = useState(false);
  // 导入预览 Modal
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<ParsedPurchaseRow[]>([]);
  const [importPreviewSource, setImportPreviewSource] = useState<"excel" | "pdf">("excel");
  // 商品名点击预览卡片
  const [previewItem, setPreviewItem] = useState<SpiritItem | null>(null);
  // 未匹配商品操作 Modal
  const [unmatchedPurchase, setUnmatchedPurchase] = useState<SpiritPurchaseRecord | null>(null);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  // 集团管理 Modal
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SpiritGroupDef | null>(null);
  // 分类管理 Modal
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  // 分类选择器 Modal
  const [showCatPicker2, setShowCatPicker2] = useState(false);
  const [catPickerTitle2, setCatPickerTitle2] = useState("");
  const [catPickerCallback2, setCatPickerCallback2] = useState<((name: string) => void) | null>(null);
  // 批量修改供应商 Modal
  const [showBatchSupplier, setShowBatchSupplier] = useState(false);
  const [batchSupplierInput, setBatchSupplierInput] = useState("");
  // 批量修改日期 Modal
  const [showBatchDate, setShowBatchDate] = useState(false);
  const [batchDateInput, setBatchDateInput] = useState("");

  // 备用金导入
  const pettyRecords = useMemo(() => {
    if (!isSelfBuy || !pettyStore?.records) return [];
    return pettyStore.records.filter((r: any) => {
      const inMonth = r.date.startsWith(month);
      const codeMatch = selfBuyConfig.pettyCodes.includes(r.code);
      const kwMatch = !selfBuyConfig.useKeywordFilter || isLikelyAlcohol(r.description);
      return inMonth && codeMatch && kwMatch;
    });
  }, [isSelfBuy, pettyStore, month, selfBuyConfig]);

  function isLikelyAlcohol(desc: string) {
    const kw = ["酒", "gin", "whisky", "rum", "vodka", "tequila", "brandy", "liqueur", "vermouth", "bitters", "syrup", "ml", "瓶", "箱"];
    return kw.some((k) => desc.toLowerCase().includes(k));
  }

  const handlePdfImport = async () => {
    try {
      setPdfImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setPdfImporting(false); return; }
      const asset = result.assets[0];
      const fileName = asset.name ?? "invoice.pdf";
      Alert.alert("AI 解析中", `正在识别 PDF 进货单内容...\n文件：${fileName}\n\n通常需要 10-20 秒，请稍候`);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const token = await Auth.getSessionToken();
      const apiBase = getApiBaseUrl();
      const trpcUrl = `${apiBase}/api/trpc/parseInvoice.parse`;
      const trpcRes = await fetch(trpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          json: { pdfBase64: base64, fileName, supplierHint: supplier },
        }),
      });
      if (!trpcRes.ok) {
        Alert.alert("解析失败", `服务器错误 (${trpcRes.status})，请检查网络连接`);
        setPdfImporting(false); return;
      }
      const trpcData = await trpcRes.json() as { result?: { data?: { json?: any } } };
      const llmResult = trpcData?.result?.data?.json;
      if (!llmResult) {
        Alert.alert("解析失败", "AI 未能识别进货单内容，请尝试 Excel 导入或手动录入");
        setPdfImporting(false); return;
      }
      const normalized = normalizeLLMRows(llmResult, supplier);
      if (!normalized.rows.length) {
        Alert.alert("提示", `AI 解析完成但未找到有效记录\n\n${normalized.errors.join("\n") || "请确认 PDF 包含进货单表格数据"}`);
        setPdfImporting(false); return;
      }
      // 打开全屏预览 Modal（可编辑）
      setImportPreviewRows(normalized.rows);
      setImportPreviewSource("pdf");
      setShowImportPreview(true);
    } catch (e) {
      Alert.alert("错误", `PDF 解析失败: ${String(e)}`);
    } finally {
      setPdfImporting(false);
    }
  };

  const handleExcelImport = async () => {
    try {
      setImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setImporting(false); return; }
      const asset = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const XLSX = require("xlsx");
      const workbook = XLSX.read(base64, { type: "base64", cellDates: true, raw: false });
      let targetSheet = workbook.SheetNames[0];
      if (workbook.SheetNames.length > 1) {
        const sheets = previewSheets(workbook);
        const valid = sheets.filter((s) => s.isValid);
        if (valid.length >= 1) targetSheet = valid.sort((a, b) => b.rowCount - a.rowCount)[0].name;
      }
      const parsed = parseSheetFromWorkbook(workbook, targetSheet, { supplierHint: supplier, fileName: asset.name ?? "import.xlsx" });
      if (!parsed.rows.length) { Alert.alert("提示", "未解析到有效数据，请检查文件格式"); setImporting(false); return; }
      // 打开全屏预览 Modal（可编辑）
      setImportPreviewRows(parsed.rows);
      setImportPreviewSource("excel");
      setShowImportPreview(true);
    } catch (e) {
      Alert.alert("错误", `Excel 解析失败: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 操作栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" }}>
        <TouchableOpacity onPress={() => { tap(); setShowAddPurchase(true); }}
          style={[S.actionBtn, { backgroundColor: "#EF4444" + "15", borderColor: "#EF4444" + "33" }]}>
          <IconSymbol name="plus" size={13} color="#EF4444" />
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>手动录入</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExcelImport}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <IconSymbol name="square.and.arrow.down" size={13} color={colors.primary} />}
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>导入Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePdfImport}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {pdfImporting ? <ActivityIndicator size="small" color="#EF4444" /> : <IconSymbol name="doc.fill" size={13} color="#EF4444" />}
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>导入PDF</Text>
        </TouchableOpacity>
        {isSelfBuy && (
          <TouchableOpacity onPress={() => { tap(); setShowPettyImport(true); }}
            style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="link" size={13} color="#F59E0B" />
            <Text style={{ fontSize: 12, color: "#F59E0B", fontWeight: "600" }}>从备用金导入</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => { tap(); setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
          style={[S.actionBtn, { backgroundColor: selectMode ? "#EF4444" : colors.surface, borderColor: selectMode ? "#EF4444" : colors.border }]}>
          <IconSymbol name="checkmark.circle" size={13} color={selectMode ? "#fff" : colors.muted} />
          <Text style={{ fontSize: 12, color: selectMode ? "#fff" : colors.muted, fontWeight: "600" }}>
            {selectMode ? `已选${selectedIds.size}` : "多选"}
          </Text>
        </TouchableOpacity>
        {selectMode && selectedIds.size > 0 && (
          <TouchableOpacity onPress={() => {
            Alert.alert("批量删除", `删除选中的 ${selectedIds.size} 条记录？`, [
              { text: "取消", style: "cancel" },
              { text: "删除", style: "destructive", onPress: () => {
                batchDeletePurchases([...selectedIds]);
                setSelectedIds(new Set());
                setSelectMode(false);
              }},
            ]);
          }} style={[S.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
            <IconSymbol name="trash" size={13} color="#EF4444" />
            <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>删除</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 第二行操作栏：多选操作 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center" }}>
        <TouchableOpacity onPress={() => {
          tap();
          const allIds = new Set(supPurchases.map((p) => p.id));
          setSelectedIds(allIds);
          setSelectMode(true);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>全选</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { tap(); setSelectedIds(new Set()); setSelectMode(false); }}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>取消全选</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要修改的记录"); return; }
          setBatchSupplierInput(supplier);
          setShowBatchSupplier(true);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>修改供应商</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要修改的记录"); return; }
          setBatchDateInput("");
          setShowBatchDate(true);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>修改日期</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要修改的记录"); return; }
          const count = selectedIds.size;
          setCatPickerTitle2(`批量修改分类（选中 ${count} 条记录）`);
          setCatPickerCallback2(() => (name: string) => {
            [...selectedIds].forEach((id) => updatePurchase(id, { category: name }));
            syncLedgerFromPurchases(month);
            setSelectedIds(new Set()); setSelectMode(false);
            Alert.alert("修改成功", `已更新 ${count} 条记录的分类`);
          });
          setShowCatPicker2(true);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>修改分类</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要修改的记录"); return; }
          Alert.prompt("批量修改数量", `将选中的 ${selectedIds.size} 条记录数量改为：`, (val) => {
            const n = parseFloat(val ?? "");
            if (!isNaN(n) && n > 0) {
              [...selectedIds].forEach((id) => {
                const p = supPurchases.find((x) => x.id === id);
                if (p) updatePurchase(id, { quantity: n, amount: n * p.unitPrice });
              });
              syncLedgerFromPurchases(month);
              setSelectedIds(new Set()); setSelectMode(false);
              Alert.alert("修改成功", `已更新 ${selectedIds.size} 条记录的数量`);
            } else if (val) { Alert.alert("请输入有效数量"); }
          }, "plain-text", "", "decimal-pad");
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>修改数量</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要修改的记录"); return; }
          Alert.prompt("批量修改单价", `将选中的 ${selectedIds.size} 条记录单价改为：`, (val) => {
            const n = parseFloat(val ?? "");
            if (!isNaN(n) && n >= 0) {
              [...selectedIds].forEach((id) => {
                const p = supPurchases.find((x) => x.id === id);
                if (p) updatePurchase(id, { unitPrice: n, amount: n * p.quantity });
              });
              syncLedgerFromPurchases(month);
              setSelectedIds(new Set()); setSelectMode(false);
              Alert.alert("修改成功", `已更新 ${selectedIds.size} 条记录的单价`);
            } else if (val) { Alert.alert("请输入有效单价"); }
          }, "plain-text", "", "decimal-pad");
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>修改单价</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          if (selectedIds.size === 0) { Alert.alert("提示", "请先勾选要删除的记录"); return; }
          Alert.alert("批量删除", `删除选中的 ${selectedIds.size} 条记录？`, [
            { text: "取消", style: "cancel" },
            { text: "删除", style: "destructive", onPress: () => {
              batchDeletePurchases([...selectedIds]);
              setSelectedIds(new Set());
              setSelectMode(false);
            }},
          ]);
        }} style={[S.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
          <IconSymbol name="trash" size={13} color="#EF4444" />
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ""}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 供应商信息头 */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          往来单位：{supplier} · 本月合计 ¥{formatMoney(totalAmt)} · {supPurchases.length} 笔
        </Text>
      </View>

      {/* 进货流水表格 */}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {supPurchases.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 48 }}>📦</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无进货记录</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>手动录入或导入 Excel 进货单</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
            <View>
              {/* 表头 */}
              <View style={[S.tableHeader, { backgroundColor: "#991B1B" }]}>
                {selectMode && <Text style={[S.thCell, { width: 32 }]} />}
                <Text style={[S.thCell, { width: 36 }]}>行号</Text>
                <Text style={[S.thCell, { width: 56 }]}>分类</Text>
                <Text style={[S.thCell, { width: 90 }]}>日期</Text>
                <Text style={[S.thCell, { width: 160 }]}>商品名称</Text>
                <Text style={[S.thCell, { width: 80 }]}>集团</Text>
                <Text style={[S.thCell, { width: 40 }]}>规格</Text>
                <Text style={[S.thCell, { width: 50 }]}>数量</Text>
                <Text style={[S.thCell, { width: 90 }]}>单价</Text>
                <Text style={[S.thCell, { width: 90 }]}>应收增加</Text>
              </View>
              {/* 数据行 */}
              {supPurchases.map((p, idx) => {
                const item = items.find((i) => i.id === p.itemId);
                const refPrice = item ? getRefPrice(item.id, month) : 0;
                const priceDiff = refPrice > 0 ? p.unitPrice - refPrice : 0;
                const priceDiffPct = refPrice > 0 ? Math.abs(priceDiff / refPrice * 100) : 0;
                const isPriceAlert = refPrice > 0 && priceDiffPct > (item?.priceAlertPct ?? 0);
                // 集团归属：优先用记录上的 group 字段，否则实时检测
                const purchaseGroup = p.group || detectPurchaseGroup(p.rawName) || (item ? getItemGroup(item) : "");
                const isSelected = selectedIds.has(p.id);
                return (
                  <TouchableOpacity key={p.id}
                    onPress={() => selectMode ? toggleSelect(p.id) : undefined}
                    onLongPress={() => {
                      tap();
                      if (!selectMode) {
                        Alert.alert("操作", `「${p.rawName}」`, [
                          { text: "删除此记录", style: "destructive", onPress: () => {
                            Alert.alert("确认删除", `删除「${p.rawName}」的进货记录？`, [
                              { text: "取消", style: "cancel" },
                              { text: "删除", style: "destructive", onPress: () => deletePurchase(p.id) },
                            ]);
                          }},
                          { text: "取消", style: "cancel" },
                        ]);
                      }
                    }}
                    style={[S.tableRow, {
                      backgroundColor: isSelected ? "#FEF2F2" : idx % 2 === 0 ? colors.surface : colors.background,
                    }]}>
                    {selectMode && (
                      <View style={[S.tdCell, { width: 32, alignItems: "center" }]}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                          borderColor: isSelected ? "#EF4444" : colors.border,
                          backgroundColor: isSelected ? "#EF4444" : "transparent",
                          alignItems: "center", justifyContent: "center" }}>
                          {isSelected && <Text style={{ color: "#fff", fontSize: 10 }}>✓</Text>}
                        </View>
                      </View>
                    )}
                    <Text style={[S.tdCell, { width: 36, textAlign: "center", fontSize: 11, color: colors.muted }]}>{idx + 1}</Text>
                    {/* 分类列 */}
                    {(() => {
                      const linkedItem = items.find((i) => i.id === p.itemId);
                      const catName = p.category || linkedItem?.category || "";
                      const catColor2 = catName ? store.getCategoryColor(catName) : "#9CA3AF";
                      return (
                        <TouchableOpacity style={[S.tdCell, { width: 56, alignItems: "center" }]}
                          onPress={() => {
                            if (selectMode) return;
                            tap();
                            setCatPickerTitle2(`修改分类：${p.rawName}`);
                            setCatPickerCallback2(() => (name: string) => {
                              updatePurchase(p.id, { category: name });
                              if (linkedItem) {
                                Alert.alert("同步分类？", "是否同步修改酒款档案的分类？", [
                                  { text: "仅此记录", style: "cancel" },
                                  { text: "同步档案", onPress: () => store.updateItem(linkedItem.id, { category: name, categorySource: "manual" }) },
                                ]);
                              }
                            });
                            setShowCatPicker2(true);
                          }}>
                          {catName ? (
                            <View style={{ backgroundColor: catColor2 + "25", borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, maxWidth: 52 }}>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: catColor2, textAlign: "center" }} numberOfLines={2}>
                                {catName.length > 6 ? catName.slice(0, 6) + "…" : catName}
                              </Text>
                            </View>
                          ) : (
                            <Text style={{ fontSize: 9, color: "#F59E0B", fontWeight: "600" }}>待分类</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })()}
                    {/* 日期列（可点击编辑） */}
                    <TouchableOpacity style={[S.tdCell, { width: 90 }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        Alert.prompt("修改日期", "格式：YYYY-MM-DD", (val) => {
                          if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                            updatePurchase(p.id, { date: val, month: val.slice(0, 7) });
                            syncLedgerFromPurchases(month);
                          } else if (val) {
                            Alert.alert("格式错误", "请输入 YYYY-MM-DD 格式");
                          }
                        }, "plain-text", p.date, "numbers-and-punctuation");
                      }}>
                      <Text style={{ fontSize: 11, color: colors.foreground }}>{p.date}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[S.tdCell, { width: 160 }]}
                      onPress={() => {
                        if (!selectMode) {
                          tap();
                          const matched = items.find((i) => i.id === p.itemId) ??
                            items.find((i) => i.name === p.rawName || i.nameEn === p.rawName ||
                              p.rawName.includes(i.name) || (i.nameEn && p.rawName.includes(i.nameEn)));
                          if (matched) {
                            setPreviewItem(matched);
                          } else {
                            // 弹出操作卡片：从现有酒款选择 / 新建酒款档案
                            setUnmatchedPurchase(p);
                            setShowUnmatchedModal(true);
                          }
                        } else {
                          toggleSelect(p.id);
                        }
                      }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={{ fontSize: 11, color: colors.foreground, flex: 1 }} numberOfLines={2}>{p.rawName}</Text>
                        {!p.itemId && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" }} />}
                      </View>
                    </TouchableOpacity>
                    {/* 集团列 */}
                    <TouchableOpacity style={[S.tdCell, { width: 80 }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        // 弹出集团选择器
                        const groupNames = groups.map((g) => g.name);
                        Alert.alert(
                          "设置集团归属",
                          `「${p.rawName}」`,
                          [
                            ...groupNames.map((gn) => ({
                              text: gn,
                              onPress: () => {
                                updatePurchase(p.id, { group: gn });
                                rememberGroupMatch(p.rawName, gn);
                              },
                            })),
                            { text: "清除", style: "destructive" as const, onPress: () => updatePurchase(p.id, { group: undefined }) },
                            { text: "取消", style: "cancel" as const },
                          ]
                        );
                      }}>
                      {purchaseGroup ? (
                        <View style={{ backgroundColor: (groups.find((g) => g.name === purchaseGroup)?.color ?? "#6B7280") + "20",
                          borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, fontWeight: "700",
                            color: groups.find((g) => g.name === purchaseGroup)?.color ?? "#6B7280" }}
                            numberOfLines={2}>
                            {purchaseGroup.replace(/ \(.*\)/, "")}
                          </Text>
                        </View>
                      ) : (
                        <Text style={{ fontSize: 9, color: "#F59E0B", fontWeight: "600" }}>待填</Text>
                      )}
                    </TouchableOpacity>
                    <Text style={[S.tdCell, { width: 40, textAlign: "center", fontSize: 11, color: colors.muted }]}>{p.unit}</Text>
                    {/* 数量列（可点击编辑） */}
                    <TouchableOpacity style={[S.tdCell, { width: 50, alignItems: "flex-end" }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        Alert.prompt("修改数量", "", (val) => {
                          const n = parseFloat(val ?? "");
                          if (!isNaN(n) && n > 0) {
                            updatePurchase(p.id, { quantity: n, amount: n * p.unitPrice });
                            syncLedgerFromPurchases(month);
                          } else if (val) {
                            Alert.alert("请输入有效数量");
                          }
                        }, "plain-text", String(p.quantity), "decimal-pad");
                      }}>
                      <Text style={{ fontSize: 11, color: colors.foreground }}>{p.quantity}</Text>
                    </TouchableOpacity>
                    {/* 单价列（可点击编辑，90pt，价格涨跌独占第二行） */}
                    <TouchableOpacity style={[S.tdCell, { width: 90, alignItems: "flex-end" }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        Alert.prompt("修改单价", "修改后自动重算应收增加", (val) => {
                          const n = parseFloat(val ?? "");
                          if (!isNaN(n) && n >= 0) {
                            updatePurchase(p.id, { unitPrice: n, amount: n * p.quantity });
                            syncLedgerFromPurchases(month);
                          } else if (val) {
                            Alert.alert("请输入有效单价");
                          }
                        }, "plain-text", String(p.unitPrice), "decimal-pad");
                      }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                        {isPriceAlert && <Text style={{ fontSize: 9 }}>⚠️</Text>}
                        <Text style={{ fontSize: 11, color: isPriceAlert ? "#F59E0B" : colors.foreground, fontWeight: isPriceAlert ? "700" : "400" }}>
                          ¥{formatMoney(p.unitPrice)}
                        </Text>
                      </View>
                      {priceDiff !== 0 && refPrice > 0 && (
                        <Text style={{ fontSize: 9, fontWeight: "700", color: priceDiff > 0 ? "#EF4444" : "#10B981" }}>
                          {priceDiff > 0 ? "↑" : "↓"}¥{formatMoney(Math.abs(priceDiff))}({priceDiffPct.toFixed(0)}%)
                        </Text>
                      )}
                    </TouchableOpacity>
                    {/* 应收增加列（可点击编辑，90pt） */}
                    <TouchableOpacity style={[S.tdCell, { width: 90, alignItems: "flex-end" }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        Alert.prompt("修改应收增加", "修改后自动反算单价", (val) => {
                          const n = parseFloat(val ?? "");
                          if (!isNaN(n) && n >= 0) {
                            const newUnitPrice = p.quantity > 0 ? n / p.quantity : p.unitPrice;
                            updatePurchase(p.id, { amount: n, unitPrice: newUnitPrice });
                            syncLedgerFromPurchases(month);
                          } else if (val) {
                            Alert.alert("请输入有效金额");
                          }
                        }, "plain-text", String(p.amount.toFixed(0)), "decimal-pad");
                      }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#EF4444" }}>¥{formatMoney(p.amount)}</Text>
                      {priceDiff !== 0 && refPrice > 0 && (
                        <Text style={{ fontSize: 9, fontWeight: "700", color: priceDiff > 0 ? "#EF4444" : "#10B981" }}>
                          {priceDiff > 0 ? "↑" : "↓"}¥{formatMoney(Math.abs(priceDiff * p.quantity))}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
              {/* 合计行 */}
              <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
                {selectMode && <Text style={[S.tdCell, { width: 32 }]} />}
                <Text style={[S.tdCell, { width: 36 }]} />
                <Text style={[S.tdCell, { width: 56 }]} />
                <Text style={[S.tdCell, { width: 90 }]} />
                <Text style={[S.tdCell, { width: 160, fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
                <Text style={[S.tdCell, { width: 80 }]} />
                <Text style={[S.tdCell, { width: 40 }]} />
                <Text style={[S.tdCell, { width: 50, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                  {supPurchases.reduce((s, p) => s + p.quantity, 0)}
                </Text>
                <Text style={[S.tdCell, { width: 90 }]} />
                <Text style={[S.tdCell, { width: 90, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                  ¥{formatMoney(totalAmt)}
                </Text>
              </View>
            </View>
          </ScrollView>
        )}
      </ScrollView>

      {/* 手动录入进货 Modal */}
      {showAddPurchase && (
        <PurchaseFormModal
          visible={showAddPurchase}
          items={items.filter((i) => i.active)}
          month={month}
          supplier={supplier}
          colors={colors}
          getRefPrice={getRefPrice}
          onSave={(data) => {
            addPurchase({ ...data, supplier });
            syncLedgerFromPurchases(month);
            setShowAddPurchase(false);
          }}
          onClose={() => setShowAddPurchase(false)}
        />
      )}

      {/* 备用金导入 Modal */}
      {isSelfBuy && showPettyImport && (
        <PettyImportModal
          visible={showPettyImport}
          pettyRecords={pettyRecords}
          items={items}
          month={month}
          colors={colors}
          matchPettyToItem={matchPettyToItem}
          setMatchMemory={setMatchMemory}
          onConfirm={(records) => {
            const pending = records.map((record) => ({ ...record, supplier: "自采", source: "manual" as const }));
            batchAddPurchases(pending);
            for (const targetMonth of new Set(pending.map((record) => record.month))) {
              syncLedgerFromPurchases(targetMonth, pending.filter((record) => record.month === targetMonth));
            }
            setShowPettyImport(false);
          }}
          onClose={() => setShowPettyImport(false)}
        />
      )}

      {/* 商品预览卡片 Modal */}
      {previewItem && (
        <Modal visible={!!previewItem} transparent animationType="fade">
          <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", paddingHorizontal: 20 }}
            activeOpacity={1} onPress={() => setPreviewItem(null)}>
            <TouchableOpacity activeOpacity={1} style={{ width: "100%", borderRadius: 20, backgroundColor: colors.background,
              shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 20 }}>
              {/* 标题区 */}
              <View style={{ padding: 20, paddingBottom: 12, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground, textAlign: "center", marginBottom: 4 }}>{previewItem.name}</Text>
                {previewItem.nameEn ? <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>{previewItem.nameEn}</Text> : null}
              </View>
              {/* 数据格 */}
              {(() => {
                const ledgerEntry = getMonthLedger(month).find((e) => e.itemId === previewItem.id);
                const refPrice = getRefPrice(previewItem.id, month);
                const rows = [
                  [{ label: "分类", value: previewItem.category, color: colors.foreground }, { label: "单位", value: previewItem.unit, color: colors.foreground }],
                  [{ label: "参考单价", value: refPrice > 0 ? `¥${refPrice}` : "未设置", color: refPrice > 0 ? "#EF4444" : colors.muted }, { label: "供应商", value: previewItem.supplier || "-", color: colors.foreground }],
                  [{ label: "本月进货", value: ledgerEntry ? `${ledgerEntry.purchaseQty}瓶` : "0瓶", color: colors.foreground }, { label: "本月消耗", value: ledgerEntry ? `${ledgerEntry.consumeQty}瓶` : "0瓶", color: colors.foreground }],
                  [{ label: "期末库存", value: ledgerEntry ? `${ledgerEntry.closingQty}瓶` : "0瓶", color: (ledgerEntry?.closingQty ?? 0) < 0 ? "#EF4444" : "#10B981" }, { label: "期末成本", value: ledgerEntry ? `¥${formatMoney(ledgerEntry.closingCost)}` : "-", color: colors.foreground }],
                ];
                return rows.map((row, ri) => (
                  <View key={ri} style={{ flexDirection: "row", borderBottomWidth: ri < rows.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                    {row.map((cell, ci) => (
                      <View key={ci} style={{ flex: 1, padding: 14,
                        borderRightWidth: ci === 0 ? StyleSheet.hairlineWidth : 0,
                        borderRightColor: colors.border }}>
                        <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>{cell.label}</Text>
                        <Text style={{ fontSize: 17, fontWeight: "700", color: cell.color }}>{cell.value}</Text>
                      </View>
                    ))}
                  </View>
                ));
              })()}
              {/* 底部按鈕 */}
              <View style={{ flexDirection: "row", gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <TouchableOpacity onPress={() => {
                  setPreviewItem(null);
                  if (previewItem?.bottleId) {
                    router2.push(("/bottle/" + previewItem.bottleId) as any);
                  } else {
                    Alert.alert(
                      "酒库档案",
                      `「${previewItem?.name}」暂未关联酒库档案`,
                      [
                        { text: "取消", style: "cancel" },
                        { text: "新建酒库档案", onPress: () => router2.push(("/bottle-form?name=" + encodeURIComponent(previewItem?.name ?? "")) as any) },
                      ]
                    );
                  }
                }} style={{ flex: 1, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }}>
                    {previewItem?.bottleId ? "查看酒库档案 →" : "新建酒库档案 →"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPreviewItem(null)}
                  style={{ flex: 1, padding: 13, backgroundColor: "#EF4444", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: "#fff", fontWeight: "700" }}>关闭</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* 批量修改供应商 Modal */}
      <Modal visible={showBatchSupplier} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>修改供应商</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>将选中的 {selectedIds.size} 条记录的供应商改为：</Text>
              <TextInput
                style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={batchSupplierInput}
                onChangeText={setBatchSupplierInput}
                placeholder="供应商名称"
                placeholderTextColor={colors.muted}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity onPress={() => setShowBatchSupplier(false)}
                  style={{ flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontWeight: "600" }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (!batchSupplierInput.trim()) { Alert.alert("提示", "请输入供应商名称"); return; }
                  [...selectedIds].forEach((id) => {
                    const p = supPurchases.find((x) => x.id === id);
                    if (p) updatePurchase(id, { supplier: batchSupplierInput.trim() });
                  });
                  syncLedgerFromPurchases(month);
                  setShowBatchSupplier(false);
                  setSelectedIds(new Set());
                  setSelectMode(false);
                  Alert.alert("修改成功", `已更新 ${selectedIds.size} 条记录的供应商`);
                }} style={{ flex: 2, padding: 14, backgroundColor: "#EF4444", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>确认修改</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* 批量修改日期 Modal */}
      <Modal visible={showBatchDate} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>修改日期</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>将选中的 {selectedIds.size} 条记录的日期改为：</Text>
              <TextInput
                style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                value={batchDateInput}
                onChangeText={setBatchDateInput}
                placeholder="YYYY-MM-DD，如 2026-08-15"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity onPress={() => setShowBatchDate(false)}
                  style={{ flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontWeight: "600" }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDateInput)) { Alert.alert("格式错误", "请输入 YYYY-MM-DD 格式"); return; }
                  const newMonth = batchDateInput.slice(0, 7);
                  [...selectedIds].forEach((id) => {
                    updatePurchase(id, { date: batchDateInput, month: newMonth });
                  });
                  syncLedgerFromPurchases(month);
                  setShowBatchDate(false);
                  setSelectedIds(new Set());
                  setSelectMode(false);
                  Alert.alert("修改成功", `已更新 ${selectedIds.size} 条记录的日期`);
                }} style={{ flex: 2, padding: 14, backgroundColor: "#EF4444", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>确认修改</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* 未匹配商品操作 Modal */}
      {showUnmatchedModal && unmatchedPurchase && (() => {
        // 模糊匹配候选（相似度 >= 0.35，最多 5 个）
        const candidates = items
          .map((it) => ({
            item: it,
            score: Math.max(
              fuzzyMatchScore(unmatchedPurchase.rawName, it.name),
              fuzzyMatchScore(unmatchedPurchase.rawName, it.nameEn ?? "")
            ),
          }))
          .filter((c) => c.score >= 0.2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        // 当月剩余未匹配数
        const remainingUnmatched = monthPurchases.filter((p) => !p.itemId && p.id !== unmatchedPurchase.id);

        const doMatch = (itemId: string, itemName: string) => {
          updatePurchase(unmatchedPurchase.id, { itemId });
          setMatchMemory(unmatchedPurchase.rawName, itemId, itemName, "manual");
          syncLedgerFromPurchases(month);
          // 自动跳到下一条未匹配
          if (remainingUnmatched.length > 0) {
            setUnmatchedPurchase(remainingUnmatched[0]);
          } else {
            setShowUnmatchedModal(false);
            setUnmatchedPurchase(null);
          }
        };

        return (
          <Modal visible={showUnmatchedModal} transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
              <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                padding: 20, paddingBottom: 32, maxHeight: "85%" }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 12 }} />
                {/* 标题、进度和关闭按钮 */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }}>
                    未匹配到酒款档案
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {remainingUnmatched.length > 0 && (
                      <Text style={{ fontSize: 11, color: "#F59E0B", fontWeight: "600" }}>
                        还剩 {remainingUnmatched.length} 条
                      </Text>
                    )}
                    <TouchableOpacity
                      onPress={() => { setShowUnmatchedModal(false); setUnmatchedPurchase(null); }}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface,
                        alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 14, color: colors.muted, fontWeight: "600", lineHeight: 16 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 10, marginBottom: 14,
                  borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }} numberOfLines={2}>
                    {unmatchedPurchase.rawName}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    {unmatchedPurchase.supplier ?? ""} · ¥{unmatchedPurchase.unitPrice} × {unmatchedPurchase.quantity}{unmatchedPurchase.unit}
                  </Text>
                </View>

                {/* 模糊匹配候选 */}
                {candidates.length > 0 && (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#3B82F6", marginBottom: 8 }}>
                      智能匹配候选（点击直接关联）
                    </Text>
                    {candidates.map((c, i) => (
                      <TouchableOpacity key={i} onPress={() => { tap(); doMatch(c.item.id, c.item.name); }}
                        style={{ flexDirection: "row", alignItems: "center", padding: 10,
                          backgroundColor: "#EFF6FF", borderRadius: 10, marginBottom: 6,
                          borderWidth: 1, borderColor: "#BFDBFE" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: "#1D4ED8" }}>{c.item.name}</Text>
                          {c.item.nameEn ? <Text style={{ fontSize: 11, color: "#3B82F6" }}>{c.item.nameEn}</Text> : null}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ fontSize: 10, fontWeight: "700",
                            color: c.score >= 0.8 ? "#16A34A" : c.score >= 0.5 ? "#D97706" : "#6B7280" }}>
                            {c.score >= 0.8 ? "高匹配" : c.score >= 0.5 ? "部分匹配" : "低匹配"} {Math.round(c.score * 100)}%
                          </Text>
                          <Text style={{ fontSize: 10, color: "#60A5FA" }}>{c.item.category}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* 其他操作 */}
                {[
                  {
                    icon: "magnifyingglass",
                    title: "搜索其他酒款匹配",
                    desc: "从全部酒款档案中搜索选择",
                    color: "#3B82F6",
                    onPress: () => {
                      setShowUnmatchedModal(false);
                      Alert.alert(
                        "选择匹配酒款",
                        `为「${unmatchedPurchase.rawName}」选择匹配酒款`,
                        [
                          ...items.slice(0, 8).map((it) => ({
                            text: it.name,
                            onPress: () => doMatch(it.id, it.name),
                          })),
                          { text: "取消", style: "cancel" as const },
                        ]
                      );
                    },
                  },
                  {
                    icon: "plus.circle.fill",
                    title: "新建酒款档案并关联",
                    desc: "以此名称创建新酒款档案",
                    color: "#10B981",
                    onPress: () => {
                      const newItem = addItem({
                        name: unmatchedPurchase.rawName,
                        category: "Other",
                        unit: unmatchedPurchase.unit || "瓶",
                        refPrice: unmatchedPurchase.unitPrice,
                        supplier: unmatchedPurchase.supplier,
                        active: true,
                      });
                      doMatch(newItem.id, newItem.name);
                    },
                  },
                  {
                    icon: "sparkles",
                    title: "AI 智能识别品类",
                    desc: "调用 AI 识别品牌、分类和集团归属",
                    color: "#8B5CF6",
                    onPress: async () => {
                      try {
                        const token = await Auth.getSessionToken();
                        const apiBase = getApiBaseUrl();
                        Alert.alert("AI 识别中", `正在识别「${unmatchedPurchase.rawName}」...`);
                        const res = await fetch(`${apiBase}/api/trpc/spirits.identifyProduct`, {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                          },
                          body: JSON.stringify({
                            json: {
                              rawName: unmatchedPurchase.rawName,
                              unitPrice: unmatchedPurchase.unitPrice,
                              unit: unmatchedPurchase.unit,
                            },
                          }),
                        });
                        if (!res.ok) {
                          Alert.alert("识别失败", `服务器错误 (${res.status})，请手动匹配`);
                          return;
                        }
                        const data = await res.json() as { result?: { data?: { json?: any } } };
                        const result = data?.result?.data?.json;
                        if (result?.zhName) {
                          // AI 识别成功，显示结果并提供选择
                          Alert.alert(
                            "AI 识别结果",
                            `品牌：${result.zhName}${result.enName ? ` / ${result.enName}` : ""}\n` +
                            `分类：${result.category ?? "未知"}\n` +
                            `集团：${result.group ?? "未知"}\n\n` +
                            `是否以此信息新建酒款档案？`,
                            [
                              { text: "取消", style: "cancel" },
                              {
                                text: "新建并关联",
                                onPress: () => {
                                  const newItem = addItem({
                                    name: result.zhName,
                                    nameEn: result.enName,
                                    category: result.category ?? "Other",
                                    group: result.group,
                                    unit: unmatchedPurchase.unit || "瓶",
                                    refPrice: unmatchedPurchase.unitPrice,
                                    supplier: unmatchedPurchase.supplier,
                                    active: true,
                                  });
                                  doMatch(newItem.id, newItem.name);
                                },
                              },
                            ]
                          );
                        } else {
                          Alert.alert("AI 识别失败", "AI 未能识别此商品，请手动匹配或新建档案");
                        }
                      } catch (e) {
                        Alert.alert("错误", `AI 识别失败: ${String(e)}`);
                      }
                    },
                  },
                  {
                    icon: "forward.end",
                    title: remainingUnmatched.length > 0 ? `跳过，处理下一条` : "跳过，关闭",
                    desc: remainingUnmatched.length > 0
                      ? `还剩 ${remainingUnmatched.length} 条未匹配`
                      : "本条不关联到酒款档案",
                    color: colors.muted,
                    onPress: () => {
                      if (remainingUnmatched.length > 0) {
                        setUnmatchedPurchase(remainingUnmatched[0]);
                      } else {
                        setShowUnmatchedModal(false);
                        setUnmatchedPurchase(null);
                      }
                    },
                  },
                ].map((opt, i) => (
                  <TouchableOpacity key={i} onPress={() => { tap(); opt.onPress(); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 12,
                      backgroundColor: colors.surface, borderRadius: 14, marginBottom: 8,
                      borderWidth: 1, borderColor: colors.border }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: (opt.color as string) + "20",
                      alignItems: "center", justifyContent: "center" }}>
                      <IconSymbol name={opt.icon as any} size={18} color={opt.color as string} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{opt.title}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{opt.desc}</Text>
                    </View>
                    <IconSymbol name="chevron.right" size={13} color={colors.muted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Modal>
        );
      })()}

      {/* 集团管理 Modal */}
      <GroupManagerModal
        visible={showGroupManager}
        groups={groups}
        editingGroup={editingGroup}
        colors={colors}
        onUpsert={upsertGroup}
        onDelete={deleteGroup}
        onMerge={mergeGroup}
        onClose={() => { setShowGroupManager(false); setEditingGroup(null); }}
      />

      {/* Excel/PDF 导入预览 Modal */}
      {showImportPreview && (
        <ImportPreviewModal
          visible={showImportPreview}
          rows={importPreviewRows}
          source={importPreviewSource}
          supplier={supplier}
          month={month}
          colors={colors}
          onConfirm={(rows) => {
            const orders: SpiritPurchaseOrderItem[] = rows.map((row) => ({
              supplier,
              rawName: row.rawName,
              nameZh: row.nameZh,
              nameEn: row.nameEn,
              unitPrice: row.unitPrice,
              quantity: row.quantity,
              amount: row.amount,
              spec: row.unit,
              date: row.date,
            }));
            const resolvedItems = [...items];
            let addedItems = 0;
            const initial = buildImportedPurchaseRecords(orders, resolvedItems, month, importPreviewSource);
            initial.unmatched.forEach((order) => {
              const name = order.nameZh || order.rawName;
              if (resolvedItems.some((item) => item.name.trim() === name.trim())) return;
              const item = addItem({
                name,
                category: "Other",
                unit: order.spec || "瓶",
                refPrice: order.unitPrice,
                supplier: order.supplier,
                spec: order.spec,
                active: true,
              });
              resolvedItems.push(item);
              addedItems++;
            });
            const purchaseImport = buildImportedPurchaseRecords(orders, resolvedItems, month, importPreviewSource);
            batchAddPurchases(purchaseImport.records);
            for (const targetMonth of new Set(purchaseImport.records.map((record) => record.month))) {
              syncLedgerFromPurchases(
                targetMonth,
                purchaseImport.records.filter((record) => record.month === targetMonth),
              );
            }
            setShowImportPreview(false);
            Alert.alert(
              "导入成功 ✅",
              `进货记录：${purchaseImport.records.length} 条已同步\n酒款档案：新增 ${addedItems} 款\n台账：已按每条记录的实际日期归属重算`,
            );
          }}
          onClose={() => setShowImportPreview(false)}
        />
      )}
      {/* 分类选择器 Modal */}
      <CategoryPickerModal
        visible={showCatPicker2}
        title={catPickerTitle2}
        categories={store.getAllCategories()}
        onSelect={(name) => { if (catPickerCallback2) catPickerCallback2(name); }}
        onClose={() => { setShowCatPicker2(false); setCatPickerCallback2(null); }}
        colors={colors}
      />
    </View>
  );
}
// ─── 分类选择器 Modal（替代 Alert.alert，支持分类过多时滚动显示） ─────────────────
function CategoryPickerModal({
  visible, title, categories, onSelect, onClose, colors,
}: {
  visible: boolean;
  title: string;
  categories: { name: string; color: string }[];
  onSelect: (name: string) => void;
  onClose: () => void;
  colors: any;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: 34,
          maxHeight: "70%",
        }}>
          {/* 标题栏 */}
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
          }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={2}>
              {title}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <IconSymbol name="xmark.circle.fill" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>
          {/* 分类列表 */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 6 }}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.name}
                onPress={() => { onSelect(cat.name); onClose(); }}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingHorizontal: 16, paddingVertical: 13,
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cat.color }} />
                <Text style={{ fontSize: 15, color: colors.foreground, fontWeight: "500", flex: 1 }}>
                  {cat.name}
                </Text>
                <IconSymbol name="chevron.right" size={14} color={colors.muted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* 取消按钮 */}
          <TouchableOpacity
            onPress={onClose}
            style={{
              marginHorizontal: 16, marginTop: 4,
              paddingVertical: 14,
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
            }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── 酒款表单 Modal ────────────────────────────────────────────────────────────
function ItemFormModal({ visible, item, colors, allCategories, onSave, onClose }: {
  visible: boolean; item: SpiritItem | null; colors: any;
  allCategories: { name: string; color: string; builtin: boolean; id: string }[];
  onSave: (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [nameEn, setNameEn] = useState(item?.nameEn ?? "");
  const [category, setCategory] = useState(item?.category ?? (allCategories[0]?.name ?? "Other"));
  const [unit, setUnit] = useState(item?.unit ?? "瓶");
  const [refPrice, setRefPrice] = useState(String(item?.refPrice ?? ""));
  const [supplier, setSupplier] = useState(item?.supplier ?? "");
  const [priceAlertPct, setPriceAlertPct] = useState(String(item?.priceAlertPct ?? ""));
  const [specMl, setSpecMl] = useState(item?.specMl != null ? String(item.specMl) : "");

  React.useEffect(() => {
    if (item) {
      setName(item.name); setNameEn(item.nameEn ?? ""); setCategory(item.category);
      setUnit(item.unit); setRefPrice(String(item.refPrice)); setSupplier(item.supplier ?? "");
      setPriceAlertPct(item.priceAlertPct != null ? String(item.priceAlertPct) : "");
      setSpecMl(item.specMl != null ? String(item.specMl) : "");
    } else {
      setName(""); setNameEn(""); setCategory(allCategories[0]?.name ?? "Other"); setUnit("瓶"); setRefPrice(""); setSupplier(""); setPriceAlertPct(""); setSpecMl("");
    }
  }, [item, visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* 导航栏 */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Text style={{ fontSize: 16, color: colors.muted }}>取消</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>
              {item ? "编辑酒款" : "新增酒款"}
            </Text>
            <TouchableOpacity onPress={() => {
              if (!name.trim()) { Alert.alert("提示", "请填写中文名"); return; }
              const alertPct = priceAlertPct.trim() !== "" ? parseFloat(priceAlertPct) : undefined;
              const specMlVal = specMl.trim() !== "" ? parseFloat(specMl) : undefined;
              onSave({ name: name.trim(), nameEn: nameEn.trim() || undefined, category, unit, refPrice: parseFloat(refPrice) || 0, supplier: supplier.trim() || undefined, priceAlertPct: alertPct, specMl: specMlVal, active: true });
              onClose();
            }} style={{ padding: 4 }}>
              <Text style={{ fontSize: 16, color: "#EF4444", fontWeight: "700" }}>保存</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            {/* 区块一：基本信息 */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
              borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>基本信息</Text>
              {[
                { label: "中文名 *", value: name, onChange: setName, placeholder: "如：添加利金酒" },
                { label: "英文名", value: nameEn, onChange: setNameEn, placeholder: "如：Tanqueray Gin" },
                { label: "单位", value: unit, onChange: setUnit, placeholder: "瓶/箱/cl" },
                { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "如：至缘" },
              ].map((f) => (
                <View key={f.label} style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>{f.label}</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                    placeholderTextColor={colors.muted}
                  />
                </View>
              ))}
            </View>
            {/* 区块二：价格与规格 */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
              borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>价格与规格</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>参考单价</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={refPrice} onChangeText={setRefPrice} placeholder="¥"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>规格容量 (ml)</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={specMl} onChangeText={setSpecMl} placeholder="如 700"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>价格预警阈值 (%)</Text>
                <TextInput
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={priceAlertPct} onChangeText={setPriceAlertPct} placeholder="默认 0，即只要有涨跌就提示"
                  placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                />
              </View>
            </View>
            {/* 区块三：进销存分类 */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
              borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>进销存分类</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>此分类用于成本报表分析，独立于酒库分类</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {allCategories.map((cat) => (
                  <TouchableOpacity key={cat.id} onPress={() => setCategory(cat.name)}
                    style={[S.catChip, { backgroundColor: category === cat.name ? cat.color : colors.surface, borderColor: cat.color }]}>
                    <Text style={{ fontSize: 11, color: category === cat.name ? "#fff" : cat.color, fontWeight: "600" }}>{cat.name}</Text>
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

// ─── 进货录入 Modal ────────────────────────────────────────────────────────────
function PurchaseFormModal({ visible, items, month, supplier, colors, getRefPrice, onSave, onClose }: {
  visible: boolean; items: SpiritItem[]; month: string; supplier?: string; colors: any;
  getRefPrice: (itemId: string, month: string) => number;
  onSave: (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(month + "-01");
  const [rawName, setRawName] = useState("");
  const [selectedItem, setSelectedItem] = useState<SpiritItem | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("瓶");
  const [unitPrice, setUnitPrice] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const filteredItems = useMemo(() =>
    searchQ ? items.filter((i) => i.name.includes(searchQ) || (i.nameEn ?? "").toLowerCase().includes(searchQ.toLowerCase())) : items.slice(0, 20),
    [items, searchQ]
  );

  const refPrice = selectedItem ? getRefPrice(selectedItem.id, month) : 0;
  const priceDiff = refPrice > 0 && unitPrice ? parseFloat(unitPrice) - refPrice : 0;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}>
            <View style={{ padding: 20 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
                手动录入进货 {supplier ? `· ${supplier}` : ""}
              </Text>
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>日期</Text>
                <TextInput style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                  value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} />
              </View>
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>搜索酒款（可选）</Text>
                <TextInput style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                  value={searchQ} onChangeText={setSearchQ} placeholder="搜索已有酒款快速填入..." placeholderTextColor={colors.muted} />
                {searchQ.length > 0 && filteredItems.slice(0, 5).map((item) => (
                  <TouchableOpacity key={item.id} onPress={() => {
                    setSelectedItem(item); setRawName(item.name); setUnit(item.unit);
                    const rp = getRefPrice(item.id, month);
                    if (rp > 0) setUnitPrice(String(rp));
                    setSearchQ("");
                  }} style={{ paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 13, color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{item.category} · ¥{getRefPrice(item.id, month)}/{item.unit}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>商品名称 *</Text>
                <TextInput style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                  value={rawName} onChangeText={setRawName} placeholder="商品名称" placeholderTextColor={colors.muted} />
              </View>
              <View style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>数量 *</Text>
                  <TextInput style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                    value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>单位</Text>
                  <TextInput style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                    value={unit} onChangeText={setUnit} placeholder="瓶" placeholderTextColor={colors.muted} />
                </View>
              </View>
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>单价 *</Text>
                  {refPrice > 0 && <Text style={{ fontSize: 11, color: colors.muted }}>参考价 ¥{refPrice}</Text>}
                </View>
                <TextInput style={[S.input, { color: colors.foreground, borderColor: priceDiff !== 0 ? (priceDiff > 0 ? "#EF4444" : "#10B981") : colors.border, backgroundColor: colors.surface }]}
                  value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="¥" placeholderTextColor={colors.muted} />
                {priceDiff !== 0 && (
                  <Text style={{ fontSize: 11, color: priceDiff > 0 ? "#EF4444" : "#10B981", marginTop: 4, fontWeight: "700" }}>
                    {priceDiff > 0 ? "↑ 涨了" : "↓ 降了"} ¥{formatMoney(Math.abs(priceDiff))}（较参考价）
                  </Text>
                )}
              </View>
              {qty && unitPrice && (
                <View style={{ padding: 12, backgroundColor: "#FEF2F2", borderRadius: 10, marginBottom: 14 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: "#991B1B" }}>
                    应收增加：¥{(parseFloat(qty) * parseFloat(unitPrice)).toFixed(1)}
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity onPress={onClose}
                  style={{ flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (!rawName.trim() || !qty || !unitPrice) { Alert.alert("提示", "请填写商品名称、数量和单价"); return; }
                  const q = parseFloat(qty), up = parseFloat(unitPrice);
                  if (isNaN(q) || isNaN(up)) { Alert.alert("提示", "数量和单价必须为数字"); return; }
                  onSave({
                    month, date, rawName: rawName.trim(),
                    itemId: selectedItem?.id,
                    supplier, quantity: q, unit, unitPrice: up, amount: q * up, source: "manual",
                  });
                  onClose();
                }} style={{ flex: 1, padding: 14, backgroundColor: "#EF4444", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, color: "#fff", fontWeight: "700" }}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── 备用金导入 Modal ──────────────────────────────────────────────────────────
function PettyImportModal({ visible, pettyRecords, items, month, colors, matchPettyToItem, setMatchMemory, onConfirm, onClose }: {
  visible: boolean; pettyRecords: any[]; items: SpiritItem[]; month: string; colors: any;
  matchPettyToItem: (desc: string) => { item: SpiritItem; score: number; source: "memory" | "fuzzy" } | null;
  setMatchMemory: (desc: string, itemId: string, itemName: string, confidence: "high" | "medium" | "manual") => void;
  onConfirm: (records: Omit<SpiritPurchaseRecord, "id" | "createdAt" | "supplier">[]) => void;
  onClose: () => void;
}) {
  type MatchState = {
    pettyId: string; desc: string; amount: number; date: string;
    matchedItem: SpiritItem | null; confidence: "high" | "medium" | "low" | "none";
    qty: string; unitPrice: string; selected: boolean;
  };

  const [states, setStates] = useState<MatchState[]>([]);

  React.useEffect(() => {
    if (visible) {
      const initial: MatchState[] = pettyRecords.map((r) => {
        const match = matchPettyToItem(r.description);
        const confidence: MatchState["confidence"] = match ? (match.score >= 0.85 ? "high" : match.score >= 0.6 ? "medium" : "low") : "none";
        return {
          pettyId: r.id, desc: r.description, amount: r.amount, date: r.date,
          matchedItem: match?.item ?? null, confidence,
          qty: "", unitPrice: match?.item ? String(match.item.refPrice) : "",
          selected: confidence !== "none",
        };
      });
      setStates(initial);
    }
  }, [visible, pettyRecords]);

  const update = (idx: number, patch: Partial<MatchState>) => {
    setStates((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const confColor = (c: MatchState["confidence"]) =>
    c === "high" ? "#10B981" : c === "medium" ? "#F59E0B" : c === "low" ? "#EF4444" : "#6B7280";
  const confLabel = (c: MatchState["confidence"]) =>
    c === "high" ? "🟢 高置信" : c === "medium" ? "🟡 中置信" : c === "low" ? "🔴 低置信" : "⚫ 未匹配";

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View style={{ flex: 1, marginTop: 60, backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>
              从备用金导入（{pettyRecords.length} 条）
            </Text>
            <TouchableOpacity onPress={onClose}>
              <IconSymbol name="xmark" size={20} color={colors.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
            {states.length === 0 && (
              <View style={{ alignItems: "center", padding: 40 }}>
                <Text style={{ fontSize: 48 }}>🔍</Text>
                <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月无酒水备用金记录</Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
                  请在备用金中添加 B1（酒水现结）类别的记录
                </Text>
              </View>
            )}
            {states.map((s, idx) => (
              <View key={s.pettyId} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: s.selected ? 1 : 0.5 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{s.desc}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{s.date} · ¥{formatMoney(s.amount)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => update(idx, { selected: !s.selected })}
                    style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                      borderColor: s.selected ? "#EF4444" : colors.border,
                      backgroundColor: s.selected ? "#EF4444" : "transparent",
                      alignItems: "center", justifyContent: "center" }}>
                    {s.selected && <Text style={{ color: "#fff", fontSize: 12 }}>✓</Text>}
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 11, color: confColor(s.confidence), fontWeight: "600", marginBottom: 6 }}>
                  {confLabel(s.confidence)}
                  {s.matchedItem ? ` → ${s.matchedItem.name}` : " — 请手动选择"}
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>数量（需手动填写）</Text>
                    <TextInput
                      style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, fontSize: 13, paddingVertical: 8 }]}
                      value={s.qty} onChangeText={(v) => update(idx, { qty: v })}
                      keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>单价</Text>
                    <TextInput
                      style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, fontSize: 13, paddingVertical: 8 }]}
                      value={s.unitPrice} onChangeText={(v) => update(idx, { unitPrice: v })}
                      keyboardType="decimal-pad" placeholder="¥" placeholderTextColor={colors.muted}
                    />
                  </View>
                </View>
                {s.qty && s.unitPrice && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                    应收增加：¥{(parseFloat(s.qty) * parseFloat(s.unitPrice)).toFixed(1)}
                    {Math.abs(parseFloat(s.qty) * parseFloat(s.unitPrice) - s.amount) > 1 && (
                      <Text style={{ color: "#F59E0B" }}> ⚠️ 与备用金金额 ¥{formatMoney(s.amount)} 不符</Text>
                    )}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
          {states.length > 0 && (
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <TouchableOpacity onPress={() => {
                const toImport = states.filter((s) => s.selected && s.qty && s.unitPrice && s.matchedItem);
                if (toImport.length === 0) { Alert.alert("提示", "请至少选择一条有效记录（需填写数量和单价，且已匹配酒款）"); return; }
                toImport.forEach((s) => {
                  if (s.matchedItem) {
                    setMatchMemory(s.desc, s.matchedItem.id, s.matchedItem.name, s.confidence === "high" ? "high" : "manual");
                  }
                });
                onConfirm(toImport.map((s) => ({
                  month,
                  date: s.date,
                  rawName: s.desc,
                  itemId: s.matchedItem!.id,
                  quantity: parseFloat(s.qty),
                  unit: s.matchedItem!.unit,
                  unitPrice: parseFloat(s.unitPrice),
                  amount: parseFloat(s.qty) * parseFloat(s.unitPrice),
                  source: "manual" as const,
                })));
              }} style={{ padding: 16, backgroundColor: "#EF4444", borderRadius: 14, alignItems: "center" }}>
                <Text style={{ fontSize: 16, color: "#fff", fontWeight: "700" }}>
                  确认导入 {states.filter((s) => s.selected).length} 条记录
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700" },
  tabChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  tableHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
  thCell: { fontSize: 11, fontWeight: "700", color: "#fff", paddingHorizontal: 6, textAlign: "center" },
  tdCell: { paddingHorizontal: 6, paddingVertical: 2 },
  colCat: { width: 130 },
  colNum: { width: 72 },
  inlineInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, width: 64, textAlign: "right" },
  supplierRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
});

// ─── 导入预览 Modal（Excel/PDF 通用，支持单条编辑 + 批量改日期 + 删除）─────────
function ImportPreviewModal({
  visible, rows: initialRows, source, supplier, month, colors, onConfirm, onClose,
}: {
  visible: boolean;
  rows: ParsedPurchaseRow[];
  source: "excel" | "pdf";
  supplier: string;
  month: string;
  colors: any;
  onConfirm: (rows: ParsedPurchaseRow[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ParsedPurchaseRow[]>(initialRows);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [batchDate, setBatchDate] = useState("");
  const [showBatchDate, setShowBatchDate] = useState(false);
  // 供应商编辑
  const [batchSupplier, setBatchSupplier] = useState(supplier);
  const [showBatchSupplier, setShowBatchSupplier] = useState(false);
  // 多选模式
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());

  // 每次打开重置
  React.useEffect(() => {
    if (visible) {
      setRows(initialRows.map((r) => ({ ...r, supplier: r.supplier || supplier })));
      setEditingIdx(null);
      setShowBatchDate(false); setBatchDate("");
      setShowBatchSupplier(false); setBatchSupplier(supplier);
      setSelectMode(false); setSelectedIdxs(new Set());
    }
  }, [visible, initialRows, supplier]);

  const toggleSelectIdx = (idx: number) => {
    setSelectedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const exitSelectMode = () => { setSelectMode(false); setSelectedIdxs(new Set()); };

  const totalAmt = rows.reduce((s, r) => s + r.amount, 0);

  const openEdit = (idx: number) => {
    const r = rows[idx];
    setEditDate(r.date);
    setEditName(r.rawName);
    setEditQty(String(r.quantity));
    setEditPrice(String(r.unitPrice));
    setEditingIdx(idx);
  };

  const saveEdit = () => {
    if (editingIdx === null) return;
    const qty = parseFloat(editQty) || rows[editingIdx].quantity;
    const price = parseFloat(editPrice) || rows[editingIdx].unitPrice;
    // 验证日期格式
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(editDate);
    const newDate = dateOk ? editDate : rows[editingIdx].date;
    const newMonth = newDate.slice(0, 7);
    setRows((prev) => prev.map((r, i) => i === editingIdx ? {
      ...r,
      date: newDate,
      month: newMonth,
      rawName: editName || r.rawName,
      nameZh: editName || r.rawName,
      quantity: qty,
      unitPrice: price,
      amount: qty * price,
    } : r));
    setEditingIdx(null);
  };

  const deleteRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyBatchDate = () => {
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(batchDate);
    if (!dateOk) { Alert.alert("格式错误", "请输入 YYYY-MM-DD 格式，如：2026-07-15"); return; }
    const newMonth = batchDate.slice(0, 7);
    // 多选模式下只修改选中的，普通模式下修改全部
    setRows((prev) => prev.map((r, i) => {
      if (selectMode && !selectedIdxs.has(i)) return r;
      return { ...r, date: batchDate, month: newMonth };
    }));
    setShowBatchDate(false);
    setBatchDate("");
    if (selectMode) exitSelectMode();
  };

  const applyBatchSupplier = () => {
    const name = batchSupplier.trim();
    if (!name) { Alert.alert("提示", "供应商名称不能为空"); return; }
    // 多选模式下只修改选中的，普通模式下修改全部
    setRows((prev) => prev.map((r, i) => {
      if (selectMode && !selectedIdxs.has(i)) return r;
      return { ...r, supplier: name };
    }));
    setShowBatchSupplier(false);
    if (selectMode) exitSelectMode();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* 头部 */}
        <View style={[S.navbar, { borderBottomColor: colors.border, paddingTop: 52 }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ fontSize: 15, color: "#EF4444", fontWeight: "600" }}>取消</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center" }}>
            <Text style={[S.navTitle, { color: colors.foreground }]}>
              {source === "pdf" ? "PDF 解析预览" : "Excel 导入预览"}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>
              {rows.length} 条记录 · 合计 ¥{formatMoney(totalAmt)} · {supplier}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { if (rows.length === 0) { Alert.alert("提示", "没有可导入的记录"); return; } onConfirm(rows); }}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "700" }}>确认导入</Text>
          </TouchableOpacity>
        </View>

        {/* 批量操作栏 */}
        {!selectMode ? (
          // 普通模式
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
            contentContainerStyle={{ flexDirection: "row", gap: 8, padding: 10, alignItems: "center" }}>
            {/* 供应商显示区 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>供应商：</Text>
              <TouchableOpacity onPress={() => { setShowBatchSupplier(!showBatchSupplier); setShowBatchDate(false); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5,
                  backgroundColor: showBatchSupplier ? "#EF444420" : colors.background,
                  borderRadius: 8, borderWidth: 1, borderColor: showBatchSupplier ? "#EF4444" : colors.border }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: showBatchSupplier ? "#EF4444" : colors.foreground }}>
                  {rows[0]?.supplier || supplier}
                </Text>
                <IconSymbol name="pencil" size={11} color={showBatchSupplier ? "#EF4444" : colors.muted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => { setShowBatchDate(!showBatchDate); setShowBatchSupplier(false); }}
              style={[S.actionBtn, { backgroundColor: showBatchDate ? "#EF444420" : colors.background, borderColor: showBatchDate ? "#EF4444" : colors.border }]}>
              <IconSymbol name="calendar" size={13} color={showBatchDate ? "#EF4444" : colors.muted} />
              <Text style={{ fontSize: 12, color: showBatchDate ? "#EF4444" : colors.muted, fontWeight: "600" }}>批量改日期</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setSelectMode(true); setShowBatchDate(false); setShowBatchSupplier(false); }}
              style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <IconSymbol name="checkmark.circle" size={13} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>多选</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: colors.muted }}>点击行编辑</Text>
          </ScrollView>
        ) : (
          // 多选模式
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: "#FEF2F2" }}
            contentContainerStyle={{ flexDirection: "row", gap: 8, padding: 10, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "700" }}>
              已选 {selectedIdxs.size}/{rows.length}
            </Text>
            <TouchableOpacity onPress={() => setSelectedIdxs(new Set(rows.map((_, i) => i)))}
              style={[S.actionBtn, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>全选</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSelectedIdxs(new Set())}
              style={[S.actionBtn, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>取消全选</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (selectedIdxs.size === 0) { Alert.alert("提示", "请先勾选记录"); return; }
              setBatchSupplier(rows[0]?.supplier || supplier);
              setShowBatchSupplier(true); setShowBatchDate(false);
            }} style={[S.actionBtn, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>改供应商</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (selectedIdxs.size === 0) { Alert.alert("提示", "请先勾选记录"); return; }
              setShowBatchDate(true); setShowBatchSupplier(false);
            }} style={[S.actionBtn, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>改日期</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (selectedIdxs.size === 0) { Alert.alert("提示", "请先勾选记录"); return; }
              Alert.alert("删除", `删除选中的 ${selectedIdxs.size} 条记录？`, [
                { text: "取消", style: "cancel" },
                { text: "删除", style: "destructive", onPress: () => {
                  setRows((prev) => prev.filter((_, i) => !selectedIdxs.has(i)));
                  exitSelectMode();
                }},
              ]);
            }} style={[S.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <IconSymbol name="trash" size={13} color="#EF4444" />
              <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>删除</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={exitSelectMode}
              style={[S.actionBtn, { backgroundColor: colors.background, borderColor: "#EF4444" }]}>
              <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "700" }}>取消多选</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* 批量日期输入 */}
        {showBatchDate && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#FEF3C7", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#FCD34D" }}>
            <TextInput
              style={[S.input, { flex: 1, color: colors.foreground, borderColor: "#FCD34D", backgroundColor: colors.background, paddingVertical: 8 }]}
              value={batchDate}
              onChangeText={setBatchDate}
              placeholder="YYYY-MM-DD，如 2026-07-15"
              placeholderTextColor={colors.muted}
              keyboardType="numbers-and-punctuation"
            />
            <TouchableOpacity onPress={applyBatchDate}
              style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#D97706", borderRadius: 10 }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>应用全部</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 供应商输入块 */}
        {showBatchSupplier && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: "#FEF2F2", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#FECACA" }}>
            <TextInput
              style={[S.input, { flex: 1, color: colors.foreground, borderColor: "#FECACA", backgroundColor: colors.background, paddingVertical: 8 }]}
              value={batchSupplier}
              onChangeText={setBatchSupplier}
              placeholder="输入供应商名称"
              placeholderTextColor={colors.muted}
              autoFocus
              selectTextOnFocus
            />
            <TouchableOpacity onPress={applyBatchSupplier}
              style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#EF4444", borderRadius: 10 }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>应用全部</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 单条编辑区 */}
        {editingIdx !== null && (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ padding: 12, backgroundColor: "#EFF6FF", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#BFDBFE" }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#1D4ED8", marginBottom: 8 }}>
                编辑第 {editingIdx + 1} 条
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>日期 (YYYY-MM-DD)</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: "#BFDBFE", backgroundColor: colors.background, paddingVertical: 7 }]}
                    value={editDate}
                    onChangeText={setEditDate}
                    placeholder="2026-07-15"
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>数量</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: "#BFDBFE", backgroundColor: colors.background, paddingVertical: 7 }]}
                    value={editQty}
                    onChangeText={setEditQty}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>单价</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: "#BFDBFE", backgroundColor: colors.background, paddingVertical: 7 }]}
                    value={editPrice}
                    onChangeText={setEditPrice}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>商品名称</Text>
                <TextInput
                  style={[S.input, { color: colors.foreground, borderColor: "#BFDBFE", backgroundColor: colors.background, paddingVertical: 7 }]}
                  value={editName}
                  onChangeText={setEditName}
                />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => setEditingIdx(null)}
                  style={{ flex: 1, padding: 10, backgroundColor: colors.surface, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted, fontWeight: "600" }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveEdit}
                  style={{ flex: 2, padding: 10, backgroundColor: "#1D4ED8", borderRadius: 10, alignItems: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>保存修改</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}

        {/* 记录列表 */}
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {rows.length === 0 && (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ color: colors.muted }}>所有记录已删除</Text>
            </View>
          )}
          {rows.map((row, idx) => {
            const isSelected = selectedIdxs.has(idx);
            return (
              <TouchableOpacity key={idx}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (selectMode) { toggleSelectIdx(idx); }
                  else { openEdit(idx); }
                }}
                style={{ flexDirection: "row", alignItems: "center",
                  borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
                  backgroundColor: isSelected ? "#FEF2F2" : editingIdx === idx ? "#EFF6FF" : (idx % 2 === 0 ? colors.surface : colors.background) }}>
                {/* 多选模式复选框 */}
                {selectMode && (
                  <View style={{ paddingLeft: 12, paddingRight: 4 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                      borderColor: isSelected ? "#EF4444" : colors.border,
                      backgroundColor: isSelected ? "#EF4444" : "transparent",
                      alignItems: "center", justifyContent: "center" }}>
                      {isSelected && <IconSymbol name="checkmark" size={12} color="#fff" />}
                    </View>
                  </View>
                )}
                {/* 主内容 */}
                <View style={{ flex: 1, padding: 12 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, marginRight: 8 }} numberOfLines={2}>
                      {row.rawName}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444" }}>¥{formatMoney(row.amount)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{row.date}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{row.quantity} {row.unit}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>¥{formatMoney(row.unitPrice)}/瓶</Text>
                    {row.supplier && row.supplier !== supplier && (
                      <Text style={{ fontSize: 11, color: "#F59E0B", fontWeight: "600" }}>{row.supplier}</Text>
                    )}
                    {row.category && <Text style={{ fontSize: 11, color: colors.primary }}>{row.category}</Text>}
                  </View>
                </View>
                {/* 删除按鈕（普通模式才显示） */}
                {!selectMode && (
                  <TouchableOpacity onPress={() => {
                    Alert.alert("删除", `删除「${row.rawName}」？`, [
                      { text: "取消", style: "cancel" },
                      { text: "删除", style: "destructive", onPress: () => deleteRow(idx) },
                    ]);
                  }} style={{ padding: 12 }}>
                    <IconSymbol name="trash" size={16} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* 底部确认栏 */}
        {rows.length > 0 && (
          <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background }}>
            <TouchableOpacity onPress={() => onConfirm(rows)}
              style={{ padding: 16, backgroundColor: "#EF4444", borderRadius: 14, alignItems: "center" }}>
              <Text style={{ fontSize: 16, color: "#fff", fontWeight: "700" }}>
                确认导入 {rows.length} 条 · 合计 ¥{formatMoney(totalAmt)}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── 集团管理 Modal ────────────────────────────────────────────────────────────
function GroupManagerModal({ visible, groups, editingGroup, colors, onUpsert, onDelete, onMerge, onClose }: {
  visible: boolean;
  groups: SpiritGroupDef[];
  editingGroup: SpiritGroupDef | null;
  colors: any;
  onUpsert: (data: Omit<SpiritGroupDef, "id" | "createdAt"> & { id?: string }) => void;
  onDelete: (id: string) => void;
  onMerge: (fromId: string, toId: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#6B7280");
  const [editBuiltin, setEditBuiltin] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");

  const PRESET_COLORS = ["#1D4ED8","#DC2626","#7C3AED","#92400E","#B45309","#059669","#0891B2","#BE185D","#6B7280","#EF4444","#10B981","#F59E0B"];

  React.useEffect(() => {
    if (editingGroup) {
      setMode("edit");
      setEditId(editingGroup.id);
      setEditName(editingGroup.name);
      setEditColor(editingGroup.color);
      setEditBuiltin(editingGroup.builtin);
      setKeywords([...editingGroup.keywords]);
    } else {
      setMode("list");
      setEditId(undefined);
      setEditName("");
      setEditColor("#6B7280");
      setEditBuiltin(false);
      setKeywords([]);
    }
  }, [editingGroup, visible]);

  const startNew = () => {
    setMode("edit");
    setEditId(undefined);
    setEditName("");
    setEditColor("#6B7280");
    setEditBuiltin(false);
    setKeywords([]);
  };

  const handleSave = () => {
    if (!editName.trim()) { Alert.alert("提示", "请填写集团名称"); return; }
    onUpsert({ id: editId, name: editName.trim(), color: editColor, keywords, builtin: editBuiltin });
    setMode("list");
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: "92%", paddingBottom: 20 }}>
          {/* 标题栏 */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center",
            padding: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => mode === "edit" ? setMode("list") : onClose()}>
              <Text style={{ fontSize: 15, color: "#EF4444", fontWeight: "600" }}>
                {mode === "edit" ? "← 返回" : "关闭"}
              </Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
              {mode === "list" ? "集团管理" : (editId ? "编辑集团" : "新增集团")}
            </Text>
            {mode === "list" ? (
              <TouchableOpacity onPress={startNew}>
                <IconSymbol name="plus" size={20} color={colors.primary} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleSave}>
                <Text style={{ fontSize: 15, color: "#10B981", fontWeight: "700" }}>保存</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {mode === "list" ? (
              // 集团列表
              groups.map((g) => (
                <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 12,
                  padding: 14, backgroundColor: colors.surface, borderRadius: 14, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: g.color }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{g.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                      {g.keywords.slice(0, 5).join(" · ")}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity onPress={() => {
                      setMode("edit");
                      setEditId(g.id);
                      setEditName(g.name);
                      setEditColor(g.color);
                      setEditBuiltin(g.builtin);
                      setKeywords([...g.keywords]);
                    }} style={{ padding: 6, backgroundColor: colors.primary + "15", borderRadius: 8 }}>
                      <IconSymbol name="pencil" size={14} color={colors.primary} />
                    </TouchableOpacity>
                    {!g.builtin && (
                      <TouchableOpacity onPress={() => {
                        Alert.alert("删除集团", `确认删除「${g.name}」？`, [
                          { text: "取消", style: "cancel" },
                          { text: "删除", style: "destructive", onPress: () => { onDelete(g.id); } },
                        ]);
                      }} style={{ padding: 6, backgroundColor: "#EF444415", borderRadius: 8 }}>
                        <IconSymbol name="trash" size={14} color="#EF4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))
            ) : (
              // 编辑表单
              <>
                {/* 集团名称 */}
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>集团名称</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
                    color: colors.foreground, backgroundColor: colors.surface, fontSize: 14, marginBottom: 16 }}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="如：保乐力加 (Pernod Ricard)"
                  placeholderTextColor={colors.muted}
                />
                {/* 颜色选择 */}
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>标识颜色</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                  {PRESET_COLORS.map((c) => (
                    <TouchableOpacity key={c} onPress={() => setEditColor(c)}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c,
                        borderWidth: editColor === c ? 3 : 0, borderColor: "#fff",
                        shadowColor: editColor === c ? c : "transparent", shadowOpacity: 0.6, shadowRadius: 4, elevation: 3 }} />
                  ))}
                </View>
                {/* 品牌关键词 */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>品牌关键词（{keywords.length} 个）</Text>
                  <TouchableOpacity onPress={() => {
                    Alert.alert("批量删除", "确认清空所有关键词？", [
                      { text: "取消", style: "cancel" },
                      { text: "清空", style: "destructive", onPress: () => setKeywords([]) },
                    ]);
                  }}>
                    <Text style={{ fontSize: 11, color: "#EF4444" }}>清空全部</Text>
                  </TouchableOpacity>
                </View>
                {/* 关键词 Chips */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {keywords.map((kw, i) => (
                    <TouchableOpacity key={i} onPress={() => setKeywords(keywords.filter((_, j) => j !== i))}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4,
                        backgroundColor: editColor + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
                        borderWidth: 1, borderColor: editColor + "60" }}>
                      <Text style={{ fontSize: 12, color: editColor, fontWeight: "600" }}>{kw}</Text>
                      <IconSymbol name="xmark" size={10} color={editColor} />
                    </TouchableOpacity>
                  ))}
                </View>
                {/* 新增关键词输入 */}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                  <TextInput
                    style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10,
                      color: colors.foreground, backgroundColor: colors.surface, fontSize: 13 }}
                    value={newKeyword}
                    onChangeText={setNewKeyword}
                    placeholder="输入品牌名或关键词，如：tanqueray"
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={() => {
                      if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
                        setKeywords([...keywords, newKeyword.trim().toLowerCase()]);
                        setNewKeyword("");
                      }
                    }}
                  />
                  <TouchableOpacity onPress={() => {
                    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
                      setKeywords([...keywords, newKeyword.trim().toLowerCase()]);
                      setNewKeyword("");
                    }
                  }} style={{ padding: 10, backgroundColor: editColor, borderRadius: 10, alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="plus" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
                {/* 删除集团（非内置） */}
                {editId && !editBuiltin && (
                  <TouchableOpacity onPress={() => {
                    Alert.alert("删除集团", `确认删除「${editName}」？此操作不可撤销。`, [
                      { text: "取消", style: "cancel" },
                      { text: "删除", style: "destructive", onPress: () => { onDelete(editId); onClose(); } },
                    ]);
                  }} style={{ padding: 14, backgroundColor: "#FEF2F2", borderRadius: 12, alignItems: "center",
                    borderWidth: 1, borderColor: "#FECACA", marginTop: 8 }}>
                    <Text style={{ fontSize: 14, color: "#EF4444", fontWeight: "700" }}>删除此集团</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

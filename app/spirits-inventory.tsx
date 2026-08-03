/**
 * 烈酒库存管理（全面重构版 v2）
 * Tab 1: 📊 总结 — 分类汇总表 + 月度对比 + 进货汇总表 + 环形图
 * Tab 2: 📋 库存管理 — 横向滚动表格 + 内联编辑期初 + Excel导入 + 负库存警告
 * Tab 3: 📦 当月进货 — 供应商主界面 + 每供应商独立子界面 + 自采备用金导入
 * Tab 4: 🔍 采购分析 — 供应商分析 + 品牌集团分析
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Dimensions, KeyboardAvoidingView, Modal, Platform,
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
  useSpiritsInventoryStore, getCurrentMonth,
} from "@/lib/spirits/crud-store";
import {
  SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry,
  SPIRIT_CATEGORY_COLORS, SPIRIT_CATEGORIES, SpiritSupplierInfo,
} from "@/lib/spirits/types";
import {
  parseSpiritsExcel, ParsedPurchaseRow, previewSheets, parseSheetFromWorkbook,
} from "@/lib/spirits/excel-import";
import { parseSpiritInventoryExcel } from "@/lib/spirits/excel-parser";
import { SpiritMonthlySnapshot, SpiritInventoryItem, SpiritPriceChange } from "@/lib/spirits/types";
import { normalizeLLMRows } from "@/lib/spirits/pdf-import";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

const { width: SCREEN_W } = Dimensions.get("window");

// ─── 工具 ─────────────────────────────────────────────────────────────────────
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function catColor(cat: string) { return SPIRIT_CATEGORY_COLORS[cat] ?? "#6B7280"; }
function tap() { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }
function fmtAmt(n: number) { return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toFixed(0); }

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
    upsertGroup, deleteGroup, getItemGroup,
    setMatchMemory, matchPettyToItem,
    selfBuyConfig, updateSelfBuyConfig,
    getMonthPurchases, getMonthLedger, getItemLedger,
    getAvailableMonths, getPurchaseSummaryByCategory, getPurchaseSummaryBySupplier,
    closeMonth, syncLedgerFromPurchases,
  } = store;
  const pettyStore = usePettyCashStore();

  const [tab, setTab] = useState<Tab>("summary");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [activeSupplier, setActiveSupplier] = useState<string | null>(null);

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

  // ── 总结 Tab ────────────────────────────────────────────────────────────────
  const [showComparison, setShowComparison] = useState(false);
  const [chartDimension, setChartDimension] = useState<"category" | "group" | "supplier">("category");

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
      {/* 核心指标卡 */}
      <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[S.cardTitle, { color: colors.foreground }]}>
          {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月 · 总览
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { label: "进货总额", value: monthPurchases.reduce((s, p) => s + p.amount, 0), fmt: (v: number) => `¥${fmtAmt(v)}`, color: "#EF4444",
              prev: prevMonthPurchases.reduce((s, p) => s + p.amount, 0) },
            { label: "进货品种", value: new Set(monthPurchases.map((p) => p.itemId ?? p.rawName)).size, fmt: (v: number) => `${v}款`, color: colors.foreground, prev: 0 },
            { label: "期末库存成本", value: monthLedger.reduce((s, e) => s + e.closingCost, 0), fmt: (v: number) => `¥${fmtAmt(v)}`, color: colors.primary,
              prev: prevMonthLedger.reduce((s, e) => s + e.closingCost, 0) },
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

      {/* 进货汇总表（每供应商 2 列） */}
      {purchaseSummaryRows.rows.length > 0 && (
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
                          {refPrice > prevRefPrice ? "↑" : "↓"}¥{Math.abs(refPrice - prevRefPrice).toFixed(0)}
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
                            {d ? `¥${d.amount.toFixed(0)}` : "—"}
                          </Text>
                        </React.Fragment>
                      );
                    })}
                    <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 12, fontWeight: "700", color: "#EF4444" }]}>
                      ¥{totalAmt.toFixed(0)}
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
                      <Text style={[S.tdCell, { width: 65, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>¥{supTotal.toFixed(0)}</Text>
                    </React.Fragment>
                  );
                })}
                <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                  ¥{monthPurchases.reduce((s, p) => s + p.amount, 0).toFixed(0)}
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
    // 推断月份（从进货记录日期，或默认当前月）
    const importMonth = snapshot.purchaseOrders.find((po) => po.date)?.date.slice(0, 7) ?? selectedMonth;
    let addedItems = 0, updatedItems = 0, addedLedger = 0;
    snapshot.items.forEach((inv: SpiritInventoryItem) => {
      // 1. 查找或创建 SpiritItem
      let existing = items.find((i) => i.name.trim() === inv.name.trim());
      if (!existing) {
        existing = addItem({
          name: inv.name,
          category: inv.category,
          unit: "瓶",
          refPrice: inv.unitCost > 0 ? inv.unitCost : 0,
          active: true,
        });
        addedItems++;
      } else {
        // 更新参考单价（如果有新单价）
        if (inv.unitCost > 0 && Math.abs(inv.unitCost - existing.refPrice) > 0.01) {
          setRefPrice(existing.id, importMonth, inv.unitCost, "import");
        }
        updatedItems++;
      }
      // 2. 写入台账（upsertLedger）
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
    setShowLedgerPreview(false);
    setLedgerImportPreview(null);
    Alert.alert(
      "导入成功 ✅",
      `${snapshot.monthLabel}\n` +
      `台账：${addedLedger} 款已写入\n` +
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
                <Text style={[S.thCell, { width: 110 }]}>中文名</Text>
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
              {/* 按分类分组 */}
              {SPIRIT_CATEGORIES.map((cat) => {
                const catItems = items.filter((i) => i.category === cat && i.active);
                if (catItems.length === 0) return null;
                return (
                  <React.Fragment key={cat}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: catColor(cat) + "20" }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: catColor(cat) }} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: catColor(cat) }}>{cat}</Text>
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
                              { text: "删除酒款", style: "destructive", onPress: () => {
                                Alert.alert("确认删除", `删除「${item.name}」？`, [
                                  { text: "取消", style: "cancel" },
                                  { text: "删除", style: "destructive", onPress: () => deleteItem(item.id) },
                                ]);
                              }},
                              { text: "取消", style: "cancel" },
                            ]);
                          }}
                          style={[S.tableRow, { backgroundColor: isNeg ? "#FEF2F2" : idx % 2 === 0 ? colors.surface : colors.background }]}>
                          <Text style={[S.tdCell, { width: 36, textAlign: "center", fontSize: 11, color: colors.muted }]}>{idx + 1}</Text>
                          <Text style={[S.tdCell, { width: 110, fontSize: 11, color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
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
                            {entry ? `¥${entry.openingUnitCost.toFixed(0)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${(entry.openingQty * entry.openingUnitCost).toFixed(0)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseQty > 0 ? `+${entry.purchaseQty}` : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseCost > 0 ? `¥${entry.purchaseCost.toFixed(0)}` : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 12, fontWeight: "700",
                            color: isNeg ? "#EF4444" : colors.foreground }]}>
                            {entry ? `${isNeg ? "⚠️" : ""}${entry.closingQty.toFixed(2)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${entry.closingUnitCost.toFixed(0)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: "#EF4444" }]}>
                            {entry ? `¥${entry.closingCost.toFixed(0)}` : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? entry.consumeQty.toFixed(1) : "—") : "—"}
                          </Text>
                          <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? `¥${(entry.consumeQty * entry.closingUnitCost).toFixed(0)}` : "—") : "—"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                    <View style={{ height: 4, backgroundColor: colors.border + "40" }} />
                  </React.Fragment>
                );
              })}
              {/* 合计行 */}
              {monthLedger.length > 0 && (
                <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
                  <Text style={[S.tdCell, { width: 36 }]} />
                  <Text style={[S.tdCell, { width: 110, fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {monthLedger.reduce((s, e) => s + e.openingQty, 0).toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60 }]} />
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{monthLedger.reduce((s, e) => s + e.openingQty * e.openingUnitCost, 0).toFixed(0)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {monthLedger.reduce((s, e) => s + e.purchaseQty, 0).toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{monthLedger.reduce((s, e) => s + e.purchaseCost, 0).toFixed(0)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                    {monthLedger.reduce((s, e) => s + e.closingQty, 0).toFixed(2)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60 }]} />
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{monthLedger.reduce((s, e) => s + e.closingCost, 0).toFixed(0)}
                  </Text>
                  <Text style={[S.tdCell, { width: 60, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    {monthLedger.reduce((s, e) => s + e.consumeQty, 0).toFixed(1)}
                  </Text>
                  <Text style={[S.tdCell, { width: 70, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                    ¥{monthLedger.reduce((s, e) => s + e.consumeQty * e.closingUnitCost, 0).toFixed(0)}
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
                        本月 ¥{data.amount.toFixed(0)} · {data.qty}笔 · {data.items}款
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
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444" }}>¥{data.amount.toFixed(0)} · {pct}%</Text>
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
                  ¥{amt.toFixed(0)} {pct}%
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
          <Text style={[S.cardTitle, { color: colors.foreground }]}>集团管理</Text>
          {groups.map((g) => (
            <View key={g.id} style={[S.supplierRow, { borderBottomColor: colors.border }]}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: g.color, marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{g.name}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                  {g.keywords.slice(0, 5).join(" · ")}
                </Text>
              </View>
              <TouchableOpacity onPress={() => {
                tap();
                Alert.alert(g.name, "选择操作", [
                  ...(g.builtin ? [] : [{ text: "删除集团", style: "destructive" as const, onPress: () => deleteGroup(g.id) }]),
                  { text: "取消", style: "cancel" },
                ]);
              }}>
                <IconSymbol name="ellipsis" size={16} color={colors.muted} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={() => {
            tap();
            Alert.alert("新增集团", "功能开发中，请联系开发者");
          }} style={[S.actionBtn, { marginTop: 8, borderColor: colors.border }]}>
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
              setSelectedMonth(prev);
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
              if (next <= getCurrentMonth()) setSelectedMonth(next);
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
                  <TouchableOpacity key={mo} onPress={() => { tap(); setSelectedMonth(mo); setShowMonthPicker(false); }}
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
                { label: "本月进货", value: `¥${ledgerImportPreview.totalPurchase.toFixed(0)}`, color: "#EF4444" },
                { label: "本月消耗", value: ledgerImportPreview.totalConsume.toFixed(1), color: colors.foreground },
                { label: "期末成本", value: `¥${ledgerImportPreview.totalEndCost.toFixed(0)}`, color: colors.primary },
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
                    <Text style={[S.tdCell, { width: 70, textAlign: "right", fontSize: 11, color: colors.foreground }]}>¥{inv.unitCost.toFixed(0)}</Text>
                    <Text style={[S.tdCell, { width: 80, textAlign: "right", fontSize: 11, color: "#EF4444" }]}>¥{inv.endCost.toFixed(0)}</Text>
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
                    <Text style={{ fontSize: 12, color: colors.muted, marginHorizontal: 8 }}>¥{c.prevPrice.toFixed(0)} → ¥{c.currPrice.toFixed(0)}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: c.changeAmt > 0 ? "#EF4444" : "#10B981" }}>
                      {c.changeAmt > 0 ? "↑" : "↓"}¥{Math.abs(c.changeAmt).toFixed(0)}
                    </Text>
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
    updatePurchase,
    setRefPrice, getRefPrice, setMatchMemory, matchPettyToItem,
    selfBuyConfig, syncLedgerFromPurchases,
    getMonthLedger,
  } = store;
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
          往来单位：{supplier} · 本月合计 ¥{totalAmt.toFixed(0)} · {supPurchases.length} 笔
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
                <Text style={[S.thCell, { width: 90 }]}>日期</Text>
                <Text style={[S.thCell, { width: 180 }]}>商品名称</Text>
                <Text style={[S.thCell, { width: 40 }]}>规格</Text>
                <Text style={[S.thCell, { width: 50 }]}>数量</Text>
                <Text style={[S.thCell, { width: 70 }]}>单价</Text>
                <Text style={[S.thCell, { width: 80 }]}>应收增加</Text>
              </View>
              {/* 数据行 */}
              {supPurchases.map((p, idx) => {
                const item = items.find((i) => i.id === p.itemId);
                const refPrice = item ? getRefPrice(item.id, month) : 0;
                const priceDiff = refPrice > 0 ? p.unitPrice - refPrice : 0;
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
                    <Text style={[S.tdCell, { width: 90, fontSize: 11, color: colors.foreground }]}>{p.date}</Text>
                    <TouchableOpacity style={[S.tdCell, { width: 180 }]}
                      onPress={() => {
                        if (!selectMode) {
                          tap();
                          const matched = items.find((i) => i.id === p.itemId) ??
                            items.find((i) => i.name === p.rawName || i.nameEn === p.rawName ||
                              p.rawName.includes(i.name) || (i.nameEn && p.rawName.includes(i.nameEn)));
                          if (matched) setPreviewItem(matched);
                          else Alert.alert("提示", `「${p.rawName}」尚未匹配到库存酒款档案`);
                        } else {
                          toggleSelect(p.id);
                        }
                      }}>
                      <Text style={{ fontSize: 11, color: colors.foreground }} numberOfLines={2}>{p.rawName}</Text>
                    </TouchableOpacity>
                    <Text style={[S.tdCell, { width: 40, textAlign: "center", fontSize: 11, color: colors.muted }]}>{p.unit}</Text>
                    <Text style={[S.tdCell, { width: 50, textAlign: "right", fontSize: 11, color: colors.foreground }]}>{p.quantity}</Text>
                    <View style={[S.tdCell, { width: 70, alignItems: "flex-end" }]}>
                      <Text style={{ fontSize: 11, color: colors.foreground }}>¥{p.unitPrice.toFixed(2)}</Text>
                      {priceDiff !== 0 && (
                        <Text style={{ fontSize: 9, fontWeight: "700", color: priceDiff > 0 ? "#EF4444" : "#10B981" }}>
                          {priceDiff > 0 ? "↑" : "↓"}¥{Math.abs(priceDiff).toFixed(0)}
                        </Text>
                      )}
                    </View>
                    <Text style={[S.tdCell, { width: 80, textAlign: "right", fontSize: 12, fontWeight: "700", color: "#EF4444" }]}>
                      ¥{p.amount.toFixed(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* 合计行 */}
              <View style={[S.tableRow, { backgroundColor: "#FEF2F2" }]}>
                {selectMode && <Text style={[S.tdCell, { width: 32 }]} />}
                <Text style={[S.tdCell, { width: 36 }]} />
                <Text style={[S.tdCell, { width: 90 }]} />
                <Text style={[S.tdCell, { width: 180, fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>合计</Text>
                <Text style={[S.tdCell, { width: 40 }]} />
                <Text style={[S.tdCell, { width: 50, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 11 }]}>
                  {supPurchases.reduce((s, p) => s + p.quantity, 0)}
                </Text>
                <Text style={[S.tdCell, { width: 70 }]} />
                <Text style={[S.tdCell, { width: 80, textAlign: "right", fontWeight: "700", color: "#991B1B", fontSize: 12 }]}>
                  ¥{totalAmt.toFixed(1)}
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
            batchAddPurchases(records.map((r) => ({ ...r, supplier: "自采", source: "manual" as const })));
            syncLedgerFromPurchases(month);
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
                  [{ label: "期末库存", value: ledgerEntry ? `${ledgerEntry.closingQty}瓶` : "0瓶", color: (ledgerEntry?.closingQty ?? 0) < 0 ? "#EF4444" : "#10B981" }, { label: "期末成本", value: ledgerEntry ? `¥${ledgerEntry.closingCost.toFixed(0)}` : "-", color: colors.foreground }],
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
                  // 跳转到库存管理 Tab 查看详情
                  onBack();
                }} style={{ flex: 1, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }}>查看详情页 →</Text>
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
            batchAddPurchases(rows.map((r) => ({
              month: r.month ?? month,
              date: r.date,
              rawName: r.rawName,
              itemId: undefined as string | undefined,
              supplier,
              quantity: r.quantity,
              unit: r.unit,
              unitPrice: r.unitPrice,
              amount: r.amount,
              source: importPreviewSource,
            })));
            syncLedgerFromPurchases(month);
            setShowImportPreview(false);
            Alert.alert("导入成功 ✅", `已导入 ${rows.length} 条进货记录`);
          }}
          onClose={() => setShowImportPreview(false)}
        />
      )}
    </View>
  );
}

// ─── 酒款表单 Modal ────────────────────────────────────────────────────────────
function ItemFormModal({ visible, item, colors, onSave, onClose }: {
  visible: boolean; item: SpiritItem | null; colors: any;
  onSave: (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [nameEn, setNameEn] = useState(item?.nameEn ?? "");
  const [category, setCategory] = useState(item?.category ?? SPIRIT_CATEGORIES[0]);
  const [unit, setUnit] = useState(item?.unit ?? "瓶");
  const [refPrice, setRefPrice] = useState(String(item?.refPrice ?? ""));
  const [supplier, setSupplier] = useState(item?.supplier ?? "");

  React.useEffect(() => {
    if (item) {
      setName(item.name); setNameEn(item.nameEn ?? ""); setCategory(item.category);
      setUnit(item.unit); setRefPrice(String(item.refPrice)); setSupplier(item.supplier ?? "");
    } else {
      setName(""); setNameEn(""); setCategory(SPIRIT_CATEGORIES[0]); setUnit("瓶"); setRefPrice(""); setSupplier("");
    }
  }, [item, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}>
            <View style={{ padding: 20 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>
                {item ? "编辑酒款" : "新增酒款"}
              </Text>
              {[
                { label: "中文名 *", value: name, onChange: setName, placeholder: "如：添加利金酒" },
                { label: "英文名", value: nameEn, onChange: setNameEn, placeholder: "如：Tanqueray Gin" },
                { label: "单位", value: unit, onChange: setUnit, placeholder: "瓶/箱/cl" },
                { label: "参考单价", value: refPrice, onChange: setRefPrice, placeholder: "¥", keyboardType: "decimal-pad" as const },
                { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "如：至缘" },
              ].map((f) => (
                <View key={f.label} style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>{f.label}</Text>
                  <TextInput
                    style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
                    value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                    placeholderTextColor={colors.muted} keyboardType={(f as any).keyboardType ?? "default"}
                  />
                </View>
              ))}
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>分类</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 14 }}
                contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: "center" }}>
                {SPIRIT_CATEGORIES.map((cat) => (
                  <TouchableOpacity key={cat} onPress={() => setCategory(cat)}
                    style={[S.catChip, { backgroundColor: category === cat ? catColor(cat) : colors.surface, borderColor: catColor(cat) }]}>
                    <Text style={{ fontSize: 11, color: category === cat ? "#fff" : catColor(cat), fontWeight: "600" }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity onPress={onClose}
                  style={{ flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (!name.trim()) { Alert.alert("提示", "请填写中文名"); return; }
                  onSave({ name: name.trim(), nameEn: nameEn.trim() || undefined, category, unit, refPrice: parseFloat(refPrice) || 0, supplier: supplier.trim() || undefined, active: true });
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
                    {priceDiff > 0 ? "↑ 涨了" : "↓ 降了"} ¥{Math.abs(priceDiff).toFixed(0)}（较参考价）
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
                    <Text style={{ fontSize: 11, color: colors.muted }}>{s.date} · ¥{s.amount.toFixed(0)}</Text>
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
                      <Text style={{ color: "#F59E0B" }}> ⚠️ 与备用金金额 ¥{s.amount.toFixed(0)} 不符</Text>
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

  // 每次打开重置
  React.useEffect(() => {
    if (visible) { setRows(initialRows); setEditingIdx(null); setShowBatchDate(false); setBatchDate(""); }
  }, [visible, initialRows]);

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
    setRows((prev) => prev.map((r) => ({ ...r, date: batchDate, month: newMonth })));
    setShowBatchDate(false);
    setBatchDate("");
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
              {rows.length} 条记录 · 合计 ¥{totalAmt.toFixed(0)} · {supplier}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { if (rows.length === 0) { Alert.alert("提示", "没有可导入的记录"); return; } onConfirm(rows); }}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: "700" }}>确认导入</Text>
          </TouchableOpacity>
        </View>

        {/* 批量操作栏 */}
        <View style={{ flexDirection: "row", gap: 8, padding: 10, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
          <TouchableOpacity onPress={() => setShowBatchDate(!showBatchDate)}
            style={[S.actionBtn, { backgroundColor: showBatchDate ? "#EF444420" : colors.background, borderColor: showBatchDate ? "#EF4444" : colors.border }]}>
            <IconSymbol name="calendar" size={13} color={showBatchDate ? "#EF4444" : colors.muted} />
            <Text style={{ fontSize: 12, color: showBatchDate ? "#EF4444" : colors.muted, fontWeight: "600" }}>批量改日期</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 12, color: colors.muted, alignSelf: "center" }}>
            点击行可单独编辑 · 左滑删除
          </Text>
        </View>

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
          {rows.map((row, idx) => (
            <View key={idx} style={{ flexDirection: "row", alignItems: "center",
              borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
              backgroundColor: editingIdx === idx ? "#EFF6FF" : (idx % 2 === 0 ? colors.surface : colors.background) }}>
              {/* 主内容 */}
              <TouchableOpacity onPress={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openEdit(idx); }}
                style={{ flex: 1, padding: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, marginRight: 8 }} numberOfLines={2}>
                    {row.rawName}
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444" }}>¥{row.amount.toFixed(0)}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{row.date}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{row.quantity} {row.unit}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>¥{row.unitPrice.toFixed(0)}/瓶</Text>
                  {row.category && <Text style={{ fontSize: 11, color: colors.primary }}>{row.category}</Text>}
                </View>
              </TouchableOpacity>
              {/* 删除按钮 */}
              <TouchableOpacity onPress={() => {
                Alert.alert("删除", `删除「${row.rawName}」？`, [
                  { text: "取消", style: "cancel" },
                  { text: "删除", style: "destructive", onPress: () => deleteRow(idx) },
                ]);
              }} style={{ padding: 12 }}>
                <IconSymbol name="trash" size={16} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        {/* 底部确认栏 */}
        {rows.length > 0 && (
          <View style={{ padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background }}>
            <TouchableOpacity onPress={() => onConfirm(rows)}
              style={{ padding: 16, backgroundColor: "#EF4444", borderRadius: 14, alignItems: "center" }}>
              <Text style={{ fontSize: 16, color: "#fff", fontWeight: "700" }}>
                确认导入 {rows.length} 条 · 合计 ¥{totalAmt.toFixed(0)}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

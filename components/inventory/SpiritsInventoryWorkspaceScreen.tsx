/**
 * 烈酒库存统一工作台。
 * 总结、库存管理、当月进货与采购分析共享当前全局月份；库存管理直接展示横向 Excel 台账。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { sumMoney } from "@/lib/finance/money";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
  View, ActivityIndicator, useWindowDimensions,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { SupplierPurchaseColumnMenu } from "@/components/spirits/supplier-purchase-column-menu";
import { LedgerColumnMenu } from "@/components/spirits/ledger-column-menu";
import { InventoryCategoryManager } from "@/components/spirits/inventory-category-manager";
import { ScreenContainer } from "@/components/screen-container";
import { StoreSegmentedTabs } from "@/components/store/store-visual-primitives";
import {
  useSpiritsInventoryStore, getCurrentMonth, SpiritBrandKeyword, SpiritGroupDef, fuzzyMatchScore,
  getSpiritGroupDisplayName, getSpiritGroupKeywords,
} from "@/lib/spirits/crud-store";
import {
  SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry,
  SPIRIT_CATEGORY_COLORS, SPIRIT_CATEGORIES,
   SpiritMonthlySnapshot, SpiritInventoryItem, SpiritPriceChange, SpiritPurchaseOrderItem } from "@/lib/spirits/types";
import { resolveSpiritItemForSupplierName } from "@/lib/spirits/supplier-alias";
import { resolvePurchaseDisplayCategory } from "@/lib/spirits/purchase-category-sync";
import type { ParsedPurchaseRow } from "@/lib/spirits/excel-import";
import { buildImportedPurchaseRecords, dominantPurchaseMonth } from "@/lib/spirits/import-bridge";
import { normalizeImportDate } from "@/lib/import/date-utils";
import type { ExportData } from "@/lib/spirits/export";
import { formatStoreMoney, STORE_TABLE_METRICS } from "@/lib/store/table-display";
import { INVENTORY_WORKSPACE_METRICS, resolveInventoryTableWindowLayout, scaleInventoryTableWidths, tableHeaderAccessibilityLabel } from "@/lib/store/inventory-workspace-ui";
import {
  applySupplierPurchaseTableView,
  collectSupplierPurchaseNameOptions,
  DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
  hasSupplierPurchaseTableFilters,
  type SupplierPurchaseSortKey,
} from "@/lib/spirits/purchase-table-view";
import {
  applyLedgerTableView,
  calculateLedgerTableTotals,
  collectLedgerNameOptions,
  DEFAULT_LEDGER_TABLE_VIEW,
  hasLedgerTableFilters,
  type LedgerSortKey,
} from "@/lib/spirits/ledger-table-view";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import { useModuleMonthCloseStore } from "@/lib/month-close/module-month-close-store";
import { useBottleStore } from "@/lib/bottles/store";
import { resolveBottleForSupplierProductName } from "@/lib/bottles/supplier-channel-resolver";
import { migrateSpiritAliasesToBottleChannels } from "@/lib/spirits/bottle-channel-migration";
import { hasBottlePurchaseProjectionChanged, projectBottleSupplierChannelsFromPurchases } from "@/lib/spirits/purchase-bottle-projection";

// ─── 工具 ─────────────────────────────────────────────────────────────────────
function catColor(cat: string) { return SPIRIT_CATEGORY_COLORS[cat] ?? "#6B7280"; }
function tap() { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }

// 库存管理的表头、分类条、商品行与合计行必须共用此唯一列轨道。
// 固定宽度在 iPhone 上保留“序号 + 商品名称 + 参考价 + 首个库存数值”的可读首屏，其余列横滑查看。
const SPIRIT_LEDGER_SELECT_WIDTH = 28;
const SPIRIT_LEDGER_INDEX_WIDTH = 28;
const SPIRIT_LEDGER_COLUMNS: readonly (readonly [string, LedgerSortKey, number])[] = [
  ["商品名称", "name", 140], ["参考价", "referencePrice", 62], ["期初库存", "openingQty", 56], ["期初单价", "openingUnitCost", 68], ["期初成本", "openingCost", 76],
  ["进货量", "purchaseQty", 56], ["进货成本", "purchaseCost", 76], ["期末库存", "closingQty", 56], ["期末单价", "closingUnitCost", 68], ["期末成本", "closingCost", 76],
  ["消耗量", "consumeQty", 56], ["消耗成本", "consumeCost", 76], ["集团", "group", 84],
];
const SPIRIT_LEDGER_BASE_WIDTH = SPIRIT_LEDGER_INDEX_WIDTH + SPIRIT_LEDGER_COLUMNS.reduce((total, [, , width]) => total + width, 0);

// 当月进货表独立使用紧凑列轨道。分类取代旧“月日”列；完整日期上移为分组行。
// 前六列在 iPhone 首屏连续呈现序号、分类、名称、数量、单价和总价，集团按需横滑。
const SPIRIT_PURCHASE_SELECT_WIDTH = 26;
const SPIRIT_PURCHASE_INDEX_WIDTH = 26;
const SPIRIT_PURCHASE_COLUMN_WIDTH = {
  category: 54,
  name: 112,
  quantity: 42,
  unitPrice: 62,
  amount: 66,
  group: 64,
} as const;
const SPIRIT_PURCHASE_BASE_WIDTH = SPIRIT_PURCHASE_INDEX_WIDTH + Object.values(SPIRIT_PURCHASE_COLUMN_WIDTH).reduce((total, width) => total + width, 0);

function LedgerDetailSection({
  title,
  metrics,
  colors,
  tone = "default",
}: {
  title: string;
  metrics: [string, string | number][];
  colors: ReturnType<typeof useColors>;
  tone?: "default" | "negative";
}) {
  const valueColor = tone === "negative" ? "#EF4444" : colors.foreground;
  return (
    <View style={{ marginBottom: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, padding: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.muted, marginBottom: 8 }}>{title}</Text>
      {metrics.map(([label, value], index) => (
        <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: index === 0 ? 0 : 8 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
          <Text style={{ fontSize: 14, fontWeight: "700", color: valueColor }}>{String(value)}</Text>
        </View>
      ))}
    </View>
  );
}

type Tab = "summary" | "ledger" | "purchase" | "analysis";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "总结" },
  { key: "ledger", label: "库存管理" },
  { key: "purchase", label: "当月进货" },
  { key: "analysis", label: "采购分析" },
];

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export interface SpiritsInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function SpiritsInventoryScreen({ month, embedded = false }: SpiritsInventoryScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: appWindowWidth } = useWindowDimensions();
  const store = useSpiritsInventoryStore();
  const { bottles, updateBottle } = useBottleStore();
  const {
    items, purchases, ledger, suppliers, groups,
    addItem, updateItem, deleteItem,
    batchAddPurchases,
    upsertLedger,
    setRefPrice, getRefPrice,
    upsertSupplier, getSupplierByName,
    upsertGroup, moveGroup, deleteGroup, getItemGroup,
    getAllCategories, upsertCustomCategory, moveCategory, removeCategorySafely,


    getMonthPurchases, getMonthLedger, getItemLedger,
    getPurchaseSummaryByCategory, getPurchaseSummaryBySupplier,
    closeMonth, syncLedgerFromPurchases,
    setActualClosing, batchSetActualClosing,
  } = store;
  const pettyStore = usePettyCashStore();

  const [tab, setTab] = useState<Tab>("summary");
  const selectedMonth = month ?? getCurrentMonth();
  const moduleClose = useModuleMonthCloseStore();
  const spiritsCloseStatus = moduleClose.getStatus("spirits", selectedMonth);
  const assertSpiritsWritable = () => {
    if (moduleClose.isWritable("spirits", selectedMonth)) return true;
    Alert.alert("烈酒月份已归档", `${selectedMonth} 烈酒已归档。请先在烈酒模块开启调整，不能直接修改历史台账。`);
    return false;
  };
  const [activeSupplier, setActiveSupplier] = useState<string | null>(null);
  const hasMigratedLegacyAliasesRef = useRef(false);

  // 打开烈酒库存时，把可唯一解析的旧别名迁入鸡尾酒库渠道；歧义条目保持待关联，绝不自动误绑。
  useEffect(() => {
    if (hasMigratedLegacyAliasesRef.current || items.length === 0 || bottles.length === 0) return;
    hasMigratedLegacyAliasesRef.current = true;
    const migration = migrateSpiritAliasesToBottleChannels(items, bottles);
    migration.bottleUpdates.forEach((bottle) => updateBottle(bottle.id, bottle));
    migration.itemPatches.forEach(({ id, patch }) => updateItem(id, patch));
  }, [bottles, items, updateBottle, updateItem]);

  // 采购是供应渠道和价格历史的唯一事实来源：所有已链接采购自动投影到对应酒库酒款。
  useEffect(() => {
    const itemsByBottleId = new Map<string, SpiritItem[]>();
    items.forEach((item) => {
      if (!item.bottleId) return;
      itemsByBottleId.set(item.bottleId, [...(itemsByBottleId.get(item.bottleId) ?? []), item]);
    });
    // 必须遍历全部酒库酒款：当一笔采购重新链接或解除链接时，原酒款也需收敛并撤销旧投影。
    bottles.forEach((bottle) => {
      const linkedItems = itemsByBottleId.get(bottle.id) ?? [];
      const itemIds = new Set(linkedItems.map((item) => item.id));
      const linkedPurchases = purchases.filter((purchase) => purchase.itemId && itemIds.has(purchase.itemId));
      const projection = projectBottleSupplierChannelsFromPurchases(bottle, linkedPurchases);
      if (hasBottlePurchaseProjectionChanged(bottle, projection)) {
        updateBottle(bottle.id, { ...bottle, ...projection });
      }
    });
  }, [bottles, items, purchases, updateBottle]);

  /** 打开唯一鸡尾酒库酒款；无匹配时进入自动预填名称的新建表单，绝不创建重复烈酒详情页。 */
  const openBottleForSpiritItem = (item: SpiritItem) => {
    const linkedBottle = item.bottleId ? bottles.find((bottle) => bottle.id === item.bottleId) : undefined;
    if (linkedBottle) {
      router.push({ pathname: "/bottle/[id]", params: { id: linkedBottle.id } });
      return;
    }
    const resolution = resolveBottleForSupplierProductName(bottles, item.supplier, item.name);
    if (resolution) {
      updateItem(item.id, { bottleId: resolution.bottle.id, bottleLinkConfidence: "auto" });
      router.push({ pathname: "/bottle/[id]", params: { id: resolution.bottle.id } });
      return;
    }
    router.push({
      pathname: "/bottle-form",
      params: {
        prefillNameAlt: item.name,
        ...(item.nameEn ? { prefillName: item.nameEn } : {}),
        sourceSpiritItemId: item.id,
      },
    });
  };
  // ★ 月末盘点状态
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const [showInventoryCategoryManager, setShowInventoryCategoryManager] = useState(false);
  const [stocktakeValues, setStocktakeValues] = useState<Record<string, string>>({});

  const monthPurchases = useMemo(() => getMonthPurchases(selectedMonth), [getMonthPurchases, selectedMonth]);
  const monthLedger = useMemo(() => getMonthLedger(selectedMonth), [getMonthLedger, selectedMonth]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const monthLedgerByItemId = useMemo(() => new Map(monthLedger.map((entry) => [entry.itemId, entry])), [monthLedger]);

  // 上月
  const [y, m] = selectedMonth.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const prevMonthLedger = useMemo(() => getMonthLedger(prevMonth), [getMonthLedger, prevMonth]);
  const prevMonthPurchases = useMemo(() => getMonthPurchases(prevMonth), [getMonthPurchases, prevMonth]);
  const categorySummary = useMemo(() => getPurchaseSummaryByCategory(selectedMonth), [getPurchaseSummaryByCategory, selectedMonth]);
  const prevCategorySummary = useMemo(() => getPurchaseSummaryByCategory(prevMonth), [getPurchaseSummaryByCategory, prevMonth]);
  const supplierSummary = useMemo(() => getPurchaseSummaryBySupplier(selectedMonth), [getPurchaseSummaryBySupplier, selectedMonth]);
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
  const summaryTableLayout = useMemo(
    () => resolveInventoryTableWindowLayout(appWindowWidth, 380, 48),
    [appWindowWidth],
  );
  const summaryColumnWidths = useMemo(() => ({
    category: Math.round(116 * summaryTableLayout.scale),
    amount: Math.round(66 * summaryTableLayout.scale),
  }), [summaryTableLayout.scale]);
  const [exporting, setExporting] = useState(false);
  const [, setShowExportMenu] = useState(false);

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
      const { exportToExcel, exportToPdf } = await import("@/lib/spirits/export");
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
      const item = p.itemId ? itemById.get(p.itemId) : undefined;
      if (!item) return;
      if (!byItem[item.id]) byItem[item.id] = { item, bySupplier: {} };
      const sup = p.supplier ?? "未知";
      if (!byItem[item.id].bySupplier[sup]) byItem[item.id].bySupplier[sup] = { qty: 0, amount: 0, unitPrice: p.unitPrice };
      byItem[item.id].bySupplier[sup].qty += p.quantity;
      byItem[item.id].bySupplier[sup].amount += p.amount;
    });
    return { rows: Object.values(byItem), supplierNames };
  }, [monthPurchases, itemById]);

  // 环形图数据
  const chartData = useMemo(() => {
    if (chartDimension === "category") {
      const total = Object.values(categorySummary).reduce((s, v) => s + v.purchaseCost, 0) || 1;
      return Object.entries(categorySummary).map(([cat, v]) => ({
        label: cat, value: v.purchaseCost, pct: Math.round(v.purchaseCost / total * 100), color: catColor(cat),
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
      const item = p.itemId ? itemById.get(p.itemId) : undefined;
      if (!item) return;
      const g = getItemGroup(item);
      groupTotals[g] = (groupTotals[g] ?? 0) + p.amount;
    });
    const total = Object.values(groupTotals).reduce((s, v) => s + v, 0) || 1;
    const GROUP_COLORS: Record<string, string> = {};
    groups.forEach((group) => { GROUP_COLORS[getSpiritGroupDisplayName(group)] = group.color; });
    return Object.entries(groupTotals).map(([g, v]) => ({
      label: g, value: v, pct: Math.round(v / total * 100), color: GROUP_COLORS[g] ?? "#6B7280",
    })).sort((a, b) => b.value - a.value);
  }, [chartDimension, monthPurchases, groups, categorySummary, supplierSummary, itemById, getItemGroup]);

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
            { label: "进货总额", value: summaryTotals.purchaseAmt, fmt: (v: number) => formatStoreMoney(v), color: colors.primary,
              prev: summaryTotals.prevPurchaseAmt },
            { label: "进货品种", value: new Set(monthPurchases.map((p) => p.itemId ?? p.rawName)).size, fmt: (v: number) => `${v}款`, color: colors.foreground, prev: 0 },
            { label: "期末库存成本", value: summaryTotals.closingCost, fmt: (v: number) => formatStoreMoney(v), color: colors.primary,
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
            style={[S.toggleBtn, { backgroundColor: showComparison ? colors.primary : colors.surface, borderColor: showComparison ? colors.primary : colors.border }]}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: showComparison ? "#fff" : colors.muted }}>
              {showComparison ? "对比 开" : "对比 关"}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, width: "100%" }}>
          <View style={[S.summaryTableContent, { width: summaryTableLayout.tableWidth }]}>
            {/* 表头 */}
            <View style={[S.summaryTableHeader, { backgroundColor: colors.primary }]}>
              <Text style={[S.summaryThCell, S.summaryColCat, { width: summaryColumnWidths.category }]}>烈酒分类</Text>
              <Text style={[S.summaryThCell, S.summaryColAmount, { width: summaryColumnWidths.amount }]}>期初金额</Text>
              <Text style={[S.summaryThCell, S.summaryColAmount, { width: summaryColumnWidths.amount }]}>本月进货</Text>
              <Text style={[S.summaryThCell, S.summaryColAmount, { width: summaryColumnWidths.amount }]}>本月消耗</Text>
              <Text style={[S.summaryThCell, S.summaryColAmount, { width: summaryColumnWidths.amount }]}>期末金额</Text>
            </View>
            {/* 分类行 */}
            {SPIRIT_CATEGORIES.map((cat, idx) => {
              const data = categorySummary[cat];
              const prev = prevCategorySummary[cat];
              if (!data && !prev) return null;
              const isEven = idx % 2 === 0;
              return (
                <View key={cat} style={[S.summaryTableRow, { backgroundColor: isEven ? colors.surface : colors.background }]}>
                  <View style={[S.summaryTdCell, S.summaryColCat, { width: summaryColumnWidths.category, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: catColor(cat) }} />
                    <Text style={{ flex: 1, fontSize: 11, color: colors.foreground }} numberOfLines={1}>{cat}</Text>
                  </View>
                  {(["openingCost", "purchaseCost", "consumeCost", "closingCost"] as const).map((field) => {
                    const val = data?.[field] ?? 0;
                    const prevVal = prev?.[field] ?? 0;
                    return (
                      <View key={field} style={[S.summaryTdCell, S.summaryColAmount, { width: summaryColumnWidths.amount, alignItems: "flex-end" }]}>
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 10, color: val < 0 ? "#EF4444" : colors.foreground, fontWeight: val < 0 ? "700" : "500" }}>
                          {val === 0 ? "—" : formatStoreMoney(val)}
                        </Text>
                        {showComparison && prevVal !== 0 && (
                          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 8, color: val > prevVal ? "#EF4444" : "#10B981" }}>
                            {val > prevVal ? "↑" : "↓"}{formatStoreMoney(Math.abs(val - prevVal))}
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
            <View style={[S.summaryTableRow, { backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={[S.summaryTdCell, S.summaryColCat, { width: summaryColumnWidths.category, fontWeight: "700", color: colors.foreground, fontSize: 12 }]}>合计</Text>
              {(["openingCost", "purchaseCost", "consumeCost", "closingCost"] as const).map((field) => {
                const total = Object.values(categorySummary).reduce((s, v) => s + v[field], 0);
                const prevTotal = Object.values(prevCategorySummary).reduce((s, v) => s + v[field], 0);
                return (
                  <View key={field} style={[S.summaryTdCell, S.summaryColAmount, { width: summaryColumnWidths.amount, alignItems: "flex-end" }]}>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 10, fontWeight: "700", color: colors.foreground }}>{formatStoreMoney(total)}</Text>
                    {showComparison && prevTotal !== 0 && (
                      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 8, color: total > prevTotal ? "#EF4444" : "#10B981" }}>
                        {total > prevTotal ? "↑" : "↓"}{formatStoreMoney(Math.abs(total - prevTotal))}
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
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
              <Text style={{ width: 88, flexShrink: 1, fontSize: 11, color: colors.foreground }} numberOfLines={1}>{item.label}</Text>
              <View style={{ flex: 1, minWidth: 32, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
                <View style={{ width: `${item.pct}%`, height: "100%", backgroundColor: item.color, borderRadius: 4 }} />
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={{ width: 110, fontSize: 10, fontWeight: "600", color: colors.foreground, textAlign: "right" }}>
                {formatStoreMoney(item.value)} · {item.pct}%
              </Text>
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
  const [editingClosingQty, setEditingClosingQty] = useState<Record<string, string>>({});
  const [selectedLedgerItemId, setSelectedLedgerItemId] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<SpiritItem | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [ledgerSelectMode, setLedgerSelectMode] = useState(false);
  const [selectedLedgerItemIds, setSelectedLedgerItemIds] = useState<Set<string>>(new Set());
  const ledgerWindowLayout = useMemo(
    () => resolveInventoryTableWindowLayout(
      appWindowWidth,
      SPIRIT_LEDGER_BASE_WIDTH + (ledgerSelectMode ? SPIRIT_LEDGER_SELECT_WIDTH : 0),
    ),
    [appWindowWidth, ledgerSelectMode],
  );
  const ledgerColumnWidths = useMemo(
    () => scaleInventoryTableWidths(
      Object.fromEntries(SPIRIT_LEDGER_COLUMNS.map(([, key, width]) => [key, width])) as Record<LedgerSortKey, number>,
      ledgerWindowLayout.scale,
    ),
    [ledgerWindowLayout.scale],
  );
  const ledgerIndexWidth = Math.round(SPIRIT_LEDGER_INDEX_WIDTH * ledgerWindowLayout.scale);
  const ledgerSelectWidth = Math.round(SPIRIT_LEDGER_SELECT_WIDTH * ledgerWindowLayout.scale);

  const [ledgerNameLanguage, setLedgerNameLanguage] = usePersistedState<"zh" | "en">("spirits.ledger.name-language.v1", "zh");
  const [ledgerTableView, setLedgerTableView] = useState(DEFAULT_LEDGER_TABLE_VIEW);
  const [activeLedgerColumn, setActiveLedgerColumn] = useState<LedgerSortKey | null>(null);
  const ledgerTableRows = useMemo(() => items.filter((item) => item.active).map((item) => {
    const entry = monthLedgerByItemId.get(item.id);
    const displayName = (ledgerNameLanguage === "zh" ? item.name : item.nameEn)?.trim() || (ledgerNameLanguage === "zh" ? item.nameEn : item.name)?.trim() || item.name;
    const consumeCost = entry?.consumeCost ?? ((entry?.consumeQty ?? 0) * (entry?.closingUnitCost ?? 0));
    return {
      id: item.id,
      nameKey: `item:${item.id}`,
      searchableName: [item.name, item.nameEn].filter(Boolean).join(" "),
      displayName,
      group: getItemGroup(item),
      referencePrice: getRefPrice(item.id, selectedMonth),
      openingQty: entry?.openingQty ?? 0,
      openingUnitCost: entry?.openingUnitCost ?? 0,
      openingCost: entry ? entry.openingQty * entry.openingUnitCost : 0,
      purchaseQty: entry?.purchaseQty ?? 0,
      purchaseCost: entry?.purchaseCost ?? 0,
      closingQty: entry?.closingQty ?? 0,
      closingUnitCost: entry?.closingUnitCost ?? 0,
      closingCost: entry?.closingCost ?? 0,
      consumeQty: entry?.consumeQty ?? 0,
      consumeCost,
    };
  }), [items, monthLedgerByItemId, ledgerNameLanguage, getItemGroup, getRefPrice, selectedMonth]);
  const ledgerNameOptions = useMemo(() => collectLedgerNameOptions(ledgerTableRows), [ledgerTableRows]);
  const visibleLedgerRows = useMemo(() => applyLedgerTableView(ledgerTableRows, ledgerTableView), [ledgerTableRows, ledgerTableView]);
  const visibleLedgerTotals = useMemo(() => calculateLedgerTableTotals(visibleLedgerRows), [visibleLedgerRows]);
  const ledgerTableHasAdjustments = Boolean(ledgerTableView.sort) || hasLedgerTableFilters(ledgerTableView.filters);
  const ledgerGroupOptions = useMemo(() => [...new Set(ledgerTableRows.map((row) => row.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")), [ledgerTableRows]);

  const selectedLedgerItem = useMemo(
    () => selectedLedgerItemId ? itemById.get(selectedLedgerItemId) ?? null : null,
    [itemById, selectedLedgerItemId],
  );
  const selectedLedgerEntry = useMemo(
    () => selectedLedgerItem ? monthLedgerByItemId.get(selectedLedgerItem.id) : undefined,
    [monthLedgerByItemId, selectedLedgerItem],
  );
  // 分类选择器 Modal
  const [showCatPicker, setShowCatPicker] = useState(false);
  // 默认展开，用户可按当前工作上下文收起；不会影响分类筛选或酒款写入事实。
  const [ledgerQuickCategoryExpanded, setLedgerQuickCategoryExpanded] = useState(true);
  const [catPickerTitle, setCatPickerTitle] = useState("");
  const [catPickerCallback, setCatPickerCallback] = useState<((name: string) => void) | null>(null);
  const [ledgerImporting, setLedgerImporting] = useState(false);
  const toggleLedgerSelection = (itemId: string) => setSelectedLedgerItemIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });
  const exitLedgerSelection = () => { setLedgerSelectMode(false); setSelectedLedgerItemIds(new Set()); };
  const requestBatchLedgerCategory = () => {
    if (!assertSpiritsWritable() || selectedLedgerItemIds.size === 0) return;
    setCatPickerTitle(`批量修改分类（已选 ${selectedLedgerItemIds.size} 款）`);
    setCatPickerCallback(() => (name: string) => {
      selectedLedgerItemIds.forEach((id) => updateItem(id, { category: name, categorySource: "manual" }));
      exitLedgerSelection();
    });
    setShowCatPicker(true);
  };
  const requestBatchLedgerRemove = () => {
    if (!assertSpiritsWritable() || selectedLedgerItemIds.size === 0) return;
    const selected = items.filter((item) => selectedLedgerItemIds.has(item.id));
    const archive = selected.filter((item) => purchases.some((purchase) => purchase.itemId === item.id)
      || ledger.some((entry) => entry.itemId === item.id)
      || store.refPrices.some((entry) => entry.itemId === item.id));
    Alert.alert("处理酒款", `已选 ${selected.length} 款：${archive.length} 款有采购、盘点或月结历史，将归档；其余 ${selected.length - archive.length} 款将删除。`, [
      { text: "取消", style: "cancel" },
      { text: "确认处理", style: "destructive", onPress: () => {
        selected.forEach((item) => {
          if (archive.some((entry) => entry.id === item.id)) updateItem(item.id, { active: false });
          else deleteItem(item.id);
        });
        exitLedgerSelection();
      } },
    ]);
  };

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

  /** 期末实际盘点只能在库存管理内修改；保存后由唯一台账命令反推本期消耗。 */
  const handleSaveClosingQty = (entry: SpiritLedgerEntry, rawVal: string) => {
    const val = parseFloat(rawVal);
    if (isNaN(val) || val < 0 || !assertSpiritsWritable()) return;
    setActualClosing(entry.itemId, selectedMonth, val);
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
      const { parseSpiritInventoryExcel } = await import("@/lib/spirits/excel-parser");
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
        consumeQty: inv.consumeBottles,
        consumeCost: inv.consumeCost,
        closingQty: inv.endQty,
        closingUnitCost: inv.unitCost,
        closingCost: inv.endCost,
        isClosed: false,
      });
      addedLedger++;
    });

    const firstPass = buildImportedPurchaseRecords(snapshot.purchaseOrders, resolvedItems, importMonth, "excel", bottles);
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
    const purchaseImport = buildImportedPurchaseRecords(snapshot.purchaseOrders, resolvedItems, importMonth, "excel", bottles);
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
      {/* 操作栏：同一行横向滚动，保留完整文本操作。 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="spirits-inventory-action-toolbar"
        style={{ flexGrow: 0, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        contentContainerStyle={{ gap: 8, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" }}>
        <TouchableOpacity onPress={() => { tap(); setShowAddItem(true); }}
          style={[S.actionBtn, { backgroundColor: "#EF4444" + "15", borderColor: "#EF4444" + "33" }]}>
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>新增酒款</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="spirits-ledger-select-toggle"
          onPress={() => ledgerSelectMode ? exitLedgerSelection() : setLedgerSelectMode(true)}
          style={[S.actionBtn, { backgroundColor: ledgerSelectMode ? colors.primary : colors.surface, borderColor: ledgerSelectMode ? colors.primary : colors.border }]}
        >
          <Text style={{ fontSize: 12, color: ledgerSelectMode ? "#fff" : colors.primary, fontWeight: "600" }}>{ledgerSelectMode ? "取消选择" : "选择"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLedgerExcelImport}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ledgerImporting && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>导入Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowInventoryCategoryManager(true)}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID="spirits-inventory-category-manager">
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>管理进销存分类</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          Alert.alert("月结确认", `将 ${selectedMonth} 的期末库存带入下月期初？`, [
            { text: "取消", style: "cancel" },
            { text: "确认月结", onPress: () => {
              if (!assertSpiritsWritable()) return;
              closeMonth(selectedMonth);
              const payable = sumMoney(monthPurchases.map((purchase) => purchase.amount));
              moduleClose.finalize({
                module: "spirits",
                month: selectedMonth,
                snapshot: { month: selectedMonth, ledger: monthLedger, purchases: monthPurchases },
                paymentSummary: { payable, paid: 0, remaining: payable },
              });
              Alert.alert("月结完成", "期末库存已带入下月期初");
            } },
          ]);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>月结 · {spiritsCloseStatus === "draft" ? "草稿" : "已归档"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { tap(); setLedgerEditMode(!ledgerEditMode); }}
          style={[S.actionBtn, { backgroundColor: ledgerEditMode ? "#EF4444" : colors.surface, borderColor: ledgerEditMode ? "#EF4444" : colors.border }]}>
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
          <Text style={{ fontSize: 12, color: "#F59E0B", fontWeight: "600" }}>月末盘点</Text>
        </TouchableOpacity>
      </ScrollView>

      {ledgerSelectMode && (
        <View testID="spirits-ledger-batch-toolbar" style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <TouchableOpacity onPress={() => setSelectedLedgerItemIds(new Set(visibleLedgerRows.map((row) => row.id)))}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>全选</Text></TouchableOpacity>
          <Text style={{ flex: 1, color: colors.muted, fontSize: 12 }}>已选 {selectedLedgerItemIds.size} 项</Text>
          <TouchableOpacity disabled={selectedLedgerItemIds.size === 0} onPress={requestBatchLedgerCategory} style={{ opacity: selectedLedgerItemIds.size === 0 ? 0.35 : 1 }}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>修改分类</Text></TouchableOpacity>
          <TouchableOpacity disabled={selectedLedgerItemIds.size === 0} onPress={requestBatchLedgerRemove} style={{ opacity: selectedLedgerItemIds.size === 0 ? 0.35 : 1 }}><Text style={{ color: "#DC2626", fontSize: 12, fontWeight: "600" }}>删除</Text></TouchableOpacity>
        </View>
      )}
      {/* 库存管理直接展示完整Excel台账；商品名称点击仍打开详情卡片。 */}
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
              {ledgerTableHasAdjustments && <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#FEF2F2" }}><Text style={{ fontSize: 11, color: "#991B1B", fontWeight: "700" }}>已筛选/排序 · 显示 {visibleLedgerRows.length} 款</Text><TouchableOpacity onPress={() => setLedgerTableView(DEFAULT_LEDGER_TABLE_VIEW)}><Text style={{ color: "#991B1B", fontSize: 11, fontWeight: "700" }}>清除全部</Text></TouchableOpacity></View>}
              {/* 紧凑横向台账：iPhone 优先显示序号、名称、参考价与首列库存数据，剩余列可横滑。 */}
              <View testID="spirits-ledger-header" style={[S.tableHeader, { width: ledgerWindowLayout.tableWidth, backgroundColor: colors.primary, minHeight: STORE_TABLE_METRICS.headerHeight }]}>
                {ledgerSelectMode && <Text style={[S.thCell, { width: ledgerSelectWidth, paddingHorizontal: 0 }]}>选</Text>}
                <Text style={[S.thCell, { width: ledgerIndexWidth, paddingHorizontal: 0 }]}>序号</Text>
                {SPIRIT_LEDGER_COLUMNS.map(([label, key]) => <TouchableOpacity key={key} testID={`spirits-ledger-column-${key}`} onPress={() => setActiveLedgerColumn(key)} style={{ width: ledgerColumnWidths[key], minHeight: STORE_TABLE_METRICS.headerHeight, justifyContent: "center", paddingHorizontal: 3 }} accessibilityLabel={tableHeaderAccessibilityLabel(label, ledgerTableView.sort?.key === key)}><Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>{label}</Text></TouchableOpacity>)}
              </View>
              {/* 按分类分组（动态，未分类置顶） */}
              {(() => {
                const allCats = getAllCategories();
                const catGroups: { cat: string; catItems: SpiritItem[] }[] = [];
                if (ledgerTableHasAdjustments) {
                  // Excel排序/筛选时必须保持全局顺序，不能再被分类标题分段打断。
                  catGroups.push({ cat: "__filtered__", catItems: visibleLedgerRows.map((row) => itemById.get(row.id)).filter((item): item is SpiritItem => Boolean(item)) });
                } else {
                  const unclassified = items.filter((i) => i.active && (!i.category || i.category === "" || (!SPIRIT_CATEGORIES.includes(i.category as any) && !allCats.find((c) => c.name === i.category))));
                  if (unclassified.length > 0) catGroups.push({ cat: "__unclassified__", catItems: unclassified });
                  allCats.filter((category) => SPIRIT_CATEGORIES.includes(category.name as any)).forEach((category) => {
                    const catItems = items.filter((i) => i.category === category.name && i.active);
                    if (catItems.length > 0) catGroups.push({ cat: category.name, catItems });
                  });
                  allCats.filter((category) => !SPIRIT_CATEGORIES.includes(category.name as any)).forEach((category) => {
                    const catItems = items.filter((i) => i.category === category.name && i.active);
                    if (catItems.length > 0) catGroups.push({ cat: category.name, catItems });
                  });
                }
                return catGroups.map(({ cat, catItems }) => {
                  const isFiltered = cat === "__filtered__";
                  const isUnclassified = cat === "__unclassified__";
                  const displayCat = isFiltered ? "筛选结果" : isUnclassified ? "⚠️ 未分类" : cat;
                  const color = isFiltered ? colors.primary : isUnclassified ? "#F59E0B" : catColor(cat);
                  return (
                    <React.Fragment key={cat}>
                      <View testID={`spirits-ledger-category-${cat}`} style={{ width: ledgerWindowLayout.tableWidth, flexDirection: "row", alignItems: "center", paddingVertical: 5, backgroundColor: color + "20" }}>
                        {ledgerSelectMode && <View style={{ width: ledgerSelectWidth }} />}
                        <View style={{ width: ledgerIndexWidth }} />
                        <View style={{ width: ledgerColumnWidths.name, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 3 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                          <Text style={{ fontSize: 11, fontWeight: "600", color }} numberOfLines={1}>{displayCat}</Text>
                        </View>
                        <View style={{ flex: 1, flexDirection: "row", justifyContent: "flex-end", paddingRight: 4 }}>
                          {isUnclassified && <Text style={{ fontSize: 10, color: "#F59E0B" }}>请补充分类</Text>}
                        </View>
                      </View>
                      {catItems.map((item, idx) => {
                        const entry = monthLedgerByItemId.get(item.id);
                        const isNeg = entry && entry.closingQty < 0;
                        const isOverride = entry?.openingManualOverride;
                        const editKey = `${item.id}:${selectedMonth}`;
                        return (
                          <TouchableOpacity key={item.id}
                            onPress={() => { tap(); if (ledgerSelectMode) toggleLedgerSelection(item.id); else setSelectedLedgerItemId(item.id); }}
                            onLongPress={ledgerSelectMode ? undefined : () => {
                              tap();
                              Alert.alert(item.name, "选择操作", [
                                { text: "编辑酒款", onPress: () => openBottleForSpiritItem(item) },
                                { text: "修改分类", onPress: () => {
                                  setCatPickerTitle(`修改分类：${item.name}\n当前：${item.category || "未分类"}`);
                                  setCatPickerCallback(() => (name: string) => updateItem(item.id, { category: name, categorySource: "manual" }));
                                  setShowCatPicker(true);
                                }},
                                ...(item.bottleId ? [
                                  { text: "查看酒库档案 →", onPress: () => openBottleForSpiritItem(item) },
                                  { text: "取消酒库链接", onPress: () => updateItem(item.id, { bottleId: undefined, bottleLinkConfidence: "none" }) },
                                ] : [
                                  { text: "关联或新建酒库档案", onPress: () => openBottleForSpiritItem(item) },
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
                            style={[S.tableRow, { minHeight: STORE_TABLE_METRICS.rowHeight, backgroundColor: idx % 2 === 0 ? colors.surface : colors.background }]}>
                            {ledgerSelectMode && <View style={[S.ledgerCell, { width: ledgerSelectWidth, alignItems: "center" }]}><View testID={`spirits-ledger-select-${item.id}`} style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: selectedLedgerItemIds.has(item.id) ? colors.primary : colors.border, backgroundColor: selectedLedgerItemIds.has(item.id) ? colors.primary : "transparent", alignItems: "center", justifyContent: "center" }}>{selectedLedgerItemIds.has(item.id) && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>}</View></View>}
                            <Text style={[S.ledgerCell, { width: ledgerIndexWidth, textAlign: "center", fontSize: STORE_TABLE_METRICS.bodyFontSize, color: colors.muted }]}>{idx + 1}</Text>
                            <Text testID={`spirits-ledger-table-name-${item.id}`} style={[S.ledgerCell, { width: ledgerColumnWidths.name, fontSize: STORE_TABLE_METRICS.nameFontSize, fontWeight: "500", color: colors.foreground }]} numberOfLines={1}>{ledgerTableRows.find((row) => row.id === item.id)?.displayName ?? item.name}</Text>
                          {/* 参考价列（可点击编辑） */}
                          {(() => {
                            const rp = getRefPrice(item.id, selectedMonth);
                            return (
                              <TouchableOpacity style={[S.ledgerCell, { width: ledgerColumnWidths.referencePrice, alignItems: "flex-end" }]}
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
                          <View style={[S.ledgerCell, { width: ledgerColumnWidths.openingQty, alignItems: "flex-end", overflow: "hidden" }]}>
                            {ledgerEditMode ? (
                              <TextInput
                                style={[S.inlineInput, { width: Math.max(42, ledgerColumnWidths.openingQty - 8), maxWidth: "100%", paddingHorizontal: 4, color: colors.foreground, borderColor: isOverride ? "#F59E0B" : colors.border }]}
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
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.openingUnitCost, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney(entry.openingUnitCost)}` : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.openingCost, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney((entry.openingQty * entry.openingUnitCost))}` : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.purchaseQty, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseQty > 0 ? `+${entry.purchaseQty}` : "—") : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.purchaseCost, textAlign: "right", fontSize: 11, color: colors.primary }]}>
                            {entry ? (entry.purchaseCost > 0 ? `¥${formatMoney(entry.purchaseCost)}` : "—") : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingQty, textAlign: "right", fontSize: 12, fontWeight: "700",
                            color: isNeg ? "#EF4444" : colors.foreground }]}>
                            {entry ? `${isNeg ? "⚠️" : ""}${entry.closingQty.toFixed(2)}` : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingUnitCost, textAlign: "right", fontSize: 11, color: colors.foreground }]}>
                            {entry ? `¥${formatMoney(entry.closingUnitCost)}` : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingCost, textAlign: "right", fontSize: 11, color: "#EF4444" }]}>
                            {entry ? `¥${formatMoney(entry.closingCost)}` : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.consumeQty, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? entry.consumeQty.toFixed(1) : "—") : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.consumeCost, textAlign: "right", fontSize: 11, color: colors.muted }]}>
                            {entry ? (entry.consumeQty > 0 ? `¥${formatMoney(entry.consumeCost ?? (entry.consumeQty * entry.closingUnitCost))}` : "—") : "—"}
                          </Text>
                          <Text style={[S.ledgerCell, { width: ledgerColumnWidths.group, textAlign: "right", fontSize: 11, color: colors.foreground }]} numberOfLines={1}>{getItemGroup(item)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                    <View style={{ height: 4, backgroundColor: colors.border + "40" }} />
                  </React.Fragment>
                );
              });
              })()}
              {/* 合计行 */}
              {visibleLedgerRows.length > 0 && (
                <View testID="spirits-ledger-total" style={[S.tableRow, { width: ledgerWindowLayout.tableWidth, backgroundColor: "#F3F4F6" }]}>
                  {ledgerSelectMode && <Text style={[S.ledgerCell, { width: ledgerSelectWidth }]} /> }
                  <Text style={[S.ledgerCell, { width: ledgerIndexWidth }]} />
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.name, fontWeight: "600", color: colors.foreground, fontSize: 12 }]}>合计</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.referencePrice }]} />
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.openingQty, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>{visibleLedgerTotals.openingQty.toFixed(2)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.openingUnitCost }]} />
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.openingCost, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>¥{formatMoney(visibleLedgerTotals.openingCost)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.purchaseQty, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>{visibleLedgerTotals.purchaseQty.toFixed(2)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.purchaseCost, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>¥{formatMoney(visibleLedgerTotals.purchaseCost)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingQty, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 12 }]}>{visibleLedgerTotals.closingQty.toFixed(2)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingUnitCost }]} />
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.closingCost, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>¥{formatMoney(visibleLedgerTotals.closingCost)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.consumeQty, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>{visibleLedgerTotals.consumeQty.toFixed(1)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.consumeCost, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>¥{formatMoney(visibleLedgerTotals.consumeCost)}</Text>
                  <Text style={[S.ledgerCell, { width: ledgerColumnWidths.group }]} />
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </ScrollView>

      <Modal
        visible={Boolean(selectedLedgerItem)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedLedgerItemId(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.42)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelectedLedgerItemId(null)} />
          <View testID="spirits-ledger-detail-sheet" style={{ maxHeight: "86%", backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Math.max(insets.bottom, 16) }}>
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>
            {selectedLedgerItem && (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 12 }}>
                  <View style={{ width: 5, alignSelf: "stretch", borderRadius: 3, backgroundColor: selectedLedgerEntry && selectedLedgerEntry.closingQty < 0 ? "#EF4444" : catColor(selectedLedgerItem.category) }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={2} style={{ fontSize: 19, fontWeight: "800", color: colors.foreground }}>{selectedLedgerItem.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>{selectedLedgerItem.category || "未分类"} · {selectedMonth}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedLedgerItemId(null)} hitSlop={10}>
                    <IconSymbol name="xmark" size={18} color={colors.muted} />
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <TouchableOpacity
                    onPress={() => { openBottleForSpiritItem(selectedLedgerItem); setSelectedLedgerItemId(null); }}
                    style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <IconSymbol name="pencil" size={13} color={colors.primary} />
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary }}>编辑酒款</Text>
                  </TouchableOpacity>
                </View>

                {selectedLedgerEntry && ledgerEditMode && (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#F59E0B14", borderWidth: 1, borderColor: "#F59E0B55", marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#B45309", marginBottom: 7 }}>编辑期初库存</Text>
                    <TextInput
                      style={[S.inlineInput, { width: "100%", color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, textAlign: "left" }]}
                      value={editingOpeningQty[`${selectedLedgerItem.id}:${selectedMonth}`] ?? String(selectedLedgerEntry.openingQty)}
                      onChangeText={(value) => setEditingOpeningQty((previous) => ({ ...previous, [`${selectedLedgerItem.id}:${selectedMonth}`]: value }))}
                      onBlur={() => {
                        const raw = editingOpeningQty[`${selectedLedgerItem.id}:${selectedMonth}`];
                        if (raw !== undefined) handleSaveOpeningQty(selectedLedgerEntry, raw);
                      }}
                      keyboardType="decimal-pad"
                    />
                  </View>
                )}

                <LedgerDetailSection
                  title="期初"
                  metrics={[
                    ["期初库存", selectedLedgerEntry?.openingQty ?? "—"],
                    ["期初单价", selectedLedgerEntry ? `¥${formatMoney(selectedLedgerEntry.openingUnitCost)}` : "—"],
                    ["期初成本", selectedLedgerEntry ? `¥${formatMoney(selectedLedgerEntry.openingQty * selectedLedgerEntry.openingUnitCost)}` : "—"],
                  ]}
                  colors={colors}
                />
                <LedgerDetailSection
                  title="本月进货"
                  metrics={[
                    ["进货数量", selectedLedgerEntry && selectedLedgerEntry.purchaseQty > 0 ? `+${selectedLedgerEntry.purchaseQty}` : "—"],
                    ["进货成本", selectedLedgerEntry && selectedLedgerEntry.purchaseCost > 0 ? `¥${formatMoney(selectedLedgerEntry.purchaseCost)}` : "—"],
                  ]}
                  colors={colors}
                />
                {selectedLedgerEntry && ledgerEditMode && (
                  <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.primary + "0d", borderWidth: 1, borderColor: colors.primary + "44", marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.primary, marginBottom: 7 }}>编辑期末库存</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>保存后自动反推本期消耗；仅在库存管理中可修改。</Text>
                    <TextInput
                      testID="spirits-ledger-closing-qty-input"
                      style={[S.inlineInput, { width: "100%", color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, textAlign: "left" }]}
                      value={editingClosingQty[`${selectedLedgerItem.id}:${selectedMonth}`] ?? String(selectedLedgerEntry.closingQty)}
                      onChangeText={(value) => setEditingClosingQty((previous) => ({ ...previous, [`${selectedLedgerItem.id}:${selectedMonth}`]: value }))}
                      onBlur={() => {
                        const raw = editingClosingQty[`${selectedLedgerItem.id}:${selectedMonth}`];
                        if (raw !== undefined) handleSaveClosingQty(selectedLedgerEntry, raw);
                      }}
                      keyboardType="decimal-pad"
                    />
                  </View>
                )}
                <LedgerDetailSection
                  title="期末库存"
                  tone={selectedLedgerEntry && selectedLedgerEntry.closingQty < 0 ? "negative" : "default"}
                  metrics={[
                    ["期末库存", selectedLedgerEntry ? selectedLedgerEntry.closingQty.toFixed(2) : "—"],
                    ["单位成本", selectedLedgerEntry ? `¥${formatMoney(selectedLedgerEntry.closingUnitCost)}` : "—"],
                    ["期末成本", selectedLedgerEntry ? `¥${formatMoney(selectedLedgerEntry.closingCost)}` : "—"],
                  ]}
                  colors={colors}
                />
                <LedgerDetailSection
                  title="本期消耗"
                  metrics={[
                    ["消耗瓶数", selectedLedgerEntry && selectedLedgerEntry.consumeQty > 0 ? selectedLedgerEntry.consumeQty.toFixed(1) : "—"],
                    ["本期消耗成本", selectedLedgerEntry && selectedLedgerEntry.consumeQty > 0 ? `¥${formatMoney(selectedLedgerEntry.consumeQty * selectedLedgerEntry.closingUnitCost)}` : "—"],
                  ]}
                  colors={colors}
                />

                <View style={{ marginBottom: 14 }} testID="spirits-ledger-quick-category">
                  <TouchableOpacity onPress={() => setLedgerQuickCategoryExpanded((expanded) => !expanded)} accessibilityRole="button" accessibilityState={{ expanded: ledgerQuickCategoryExpanded }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 38, marginBottom: ledgerQuickCategoryExpanded ? 8 : 0 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>快速选择分类</Text>
                    <IconSymbol name={ledgerQuickCategoryExpanded ? "chevron.up" : "chevron.down"} size={14} color={colors.muted} />
                  </TouchableOpacity>
                  {ledgerQuickCategoryExpanded && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingRight: 8 }}>
                      {getAllCategories().map((category) => {
                        const active = selectedLedgerItem.category === category.name;
                        return (
                          <TouchableOpacity
                            key={category.id}
                            testID={`spirits-ledger-category-${category.id}`}
                            onPress={() => updateItem(selectedLedgerItem.id, { category: category.name, categorySource: "manual" })}
                            style={[S.catChip, { minHeight: 32, backgroundColor: active ? category.color : colors.surface, borderColor: category.color }]}
                          >
                            <Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : category.color }}>{category.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );

  // ── 当月进货 Tab ─────────────────────────────────────────────────────────────
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  // 未匹配商品操作 Modal（供应商列表页提示条使用）
  // 集团管理 Modal（采购分析 Tab 使用）
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SpiritGroupDef | null>(null);

  const allSupplierNames = useMemo(() => {
    const fromPurchases = [...new Set(purchases.map((p) => p.supplier ?? "未知供应商"))];
    const fromStore = suppliers.map((s) => s.name);
    return [...new Set([...fromStore, ...fromPurchases, "自采"])];
  }, [purchases, suppliers]);

  const renderPurchase = () => {
    // 供应商和新增入口属于同一行；选择后直接在当前页渲染明细，不再进入卡片二级页面。
    const selectedSupplier = activeSupplier ?? allSupplierNames[0] ?? null;
    const unmatchedList = monthPurchases.filter((purchase) => !purchase.itemId);

    return (
      <View testID="spirits-purchase-inline-workspace" style={{ flex: 1 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          testID="spirits-purchase-supplier-tabs"
          style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
          contentContainerStyle={{ paddingHorizontal: INVENTORY_WORKSPACE_METRICS.horizontalPadding, paddingVertical: 6, gap: INVENTORY_WORKSPACE_METRICS.horizontalGap, alignItems: "center" }}
        >
          {allSupplierNames.map((sup) => {
            const active = selectedSupplier === sup;
            return (
              <TouchableOpacity
                key={sup}
                testID={`spirits-purchase-supplier-tab-${sup}`}
                onPress={() => { tap(); setActiveSupplier(sup); }}
                style={[S.tabChip, {
                  minHeight: INVENTORY_WORKSPACE_METRICS.segmentHeight,
                  borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius,
                  backgroundColor: active ? colors.foreground : colors.surface,
                  borderColor: active ? colors.foreground : colors.border,
                }]}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: active ? "#fff" : colors.muted }}>{sup}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            testID="spirits-purchase-add-supplier"
            onPress={() => { tap(); setShowAddSupplier(true); }}
            style={[S.actionBtn, { backgroundColor: "#EF4444" + "15", borderColor: "#EF4444" + "33" }]}
          >
            <IconSymbol name="plus" size={13} color="#EF4444" />
            <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>新增供应商</Text>
          </TouchableOpacity>
        </ScrollView>

        {unmatchedList.length > 0 && (
          <TouchableOpacity
            onPress={() => { tap(); setActiveSupplier(unmatchedList[0]?.supplier ?? "未知供应商"); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginTop: 8, padding: 10,
              backgroundColor: "#FEF3C7", borderRadius: 10, borderWidth: 1, borderColor: "#FCD34D" }}
          >
            <Text style={{ fontSize: 15 }}>⚠️</Text>
            <Text style={{ flex: 1, fontSize: 12, color: "#92400E", fontWeight: "600" }}>
              {unmatchedList.length} 条进货记录未匹配到酒款，点击切换到待处理供应商
            </Text>
          </TouchableOpacity>
        )}

        {selectedSupplier ? (
          <SupplierDetailScreen
            supplier={selectedSupplier}
            month={selectedMonth}
            colors={colors}
            insets={insets}
            items={items}
            bottles={bottles}
            purchases={purchases}
            store={store}
            pettyStore={pettyStore}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Text style={{ fontSize: 44 }}>🏢</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>还没有供应商</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>点击上方「新增供应商」后即可直接录入当月进货</Text>
          </View>
        )}
      </View>
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
            const groupDef = groups.find((group) => getSpiritGroupDisplayName(group) === g);
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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{g.nameZh || g.nameEn}</Text>
                {g.nameEn ? <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{g.nameEn}</Text> : null}
                <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                  {g.brandKeywords.slice(0, 3).map((keyword) => [keyword.nameZh, keyword.nameEn].filter(Boolean).join(" / ")).join(" · ") || "暂无品牌关键词"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{getSpiritGroupKeywords(g).length} 个关键词</Text>
                {g.builtin && <Text style={{ fontSize: 9, color: colors.muted }}>预置</Text>}
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
    <ScreenContainer edges={embedded ? [] : undefined}>
      {/* 门店统一二级胶囊选择器：四项等宽同一行。 */}
      <StoreSegmentedTabs
        testID="spirits-tab-"
        items={TABS}
        active={tab}
        onChange={(nextTab) => { tap(); setTab(nextTab); }}
        colors={colors}
      />

      {/* Tab 内容 */}
      <>
        {tab === "summary" && renderSummary()}
        {tab === "ledger" && renderLedger()}
        {tab === "purchase" && renderPurchase()}
        {tab === "analysis" && renderAnalysis()}
      </>

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
                  const createdSupplierName = newSupplierName.trim();
                  upsertSupplier({ name: createdSupplierName, isSelfBuy: createdSupplierName.includes("自采") });
                  setActiveSupplier(createdSupplierName);
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
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 11, color: colors.muted }]}>{inv.consumeBottles > 0 ? inv.consumeBottles.toFixed(1) : "—"}</Text>
                    <Text style={[S.tdCell, { width: 60, textAlign: "right", fontSize: 12, fontWeight: "700", color: inv.endQty < 0 ? "#EF4444" : colors.foreground }]}>
                      {inv.endQty < 0 ? `⚠️${inv.endQty}` : inv.endQty}
                    </Text>
                    <Text style={[S.tdCell, { width: 78, textAlign: "right", fontSize: 11, color: colors.foreground }]}>¥{formatMoney(inv.unitCost)}</Text>
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
        onMove={moveGroup}
        onDelete={deleteGroup}
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

      <InventoryCategoryManager
        visible={showInventoryCategoryManager}
        colors={colors}
        categories={getAllCategories()}
        itemCounts={items.reduce<Record<string, number>>((counts, item) => { counts[item.category] = (counts[item.category] ?? 0) + 1; return counts; }, {})}
        onUpsert={upsertCustomCategory}
        onMove={moveCategory}
        onSafeRemove={removeCategorySafely}
        onClose={() => setShowInventoryCategoryManager(false)}
      />
      <LedgerColumnMenu
        visible={activeLedgerColumn !== null}
        column={activeLedgerColumn}
        colors={colors}
        groups={ledgerGroupOptions}
        nameOptions={ledgerNameOptions}
        nameLanguage={ledgerNameLanguage}
        onNameLanguageChange={setLedgerNameLanguage}
        view={ledgerTableView}
        onViewChange={setLedgerTableView}
        onClose={() => setActiveLedgerColumn(null)}
      />
    </ScreenContainer>
  );
}

// ─── 供应商详情子界面 ──────────────────────────────────────────────────────────
function SupplierDetailScreen({
  supplier, month, colors, insets, items, bottles, purchases, store, pettyStore,
}: {
  supplier: string; month: string; colors: any; insets: any;
  items: SpiritItem[]; bottles: import("@/lib/bottles/types").Bottle[]; purchases: SpiritPurchaseRecord[];
  store: ReturnType<typeof useSpiritsInventoryStore>;
  pettyStore: any;
}) {
  const {
    addPurchase, batchAddPurchases, batchDeletePurchases,
    updatePurchase,
    getRefPrice, setMatchMemory, matchPettyToItem,
    selfBuyConfig, syncLedgerFromPurchases,
    getMonthLedger,
    groups, detectPurchaseGroup, getItemGroup, rememberGroupMatch,
    upsertGroup, moveGroup, deleteGroup,
    addItem, updateItem, setItemAndPurchaseCategory, setItemsAndPurchasesCategory,
    getAllCategories,
    getMonthPurchases,
  } = store;
  const router2 = useRouter();
  const { width: appWindowWidth } = useWindowDimensions();
  const monthPurchases = useMemo(() => getMonthPurchases(month), [getMonthPurchases, month]);
  const isSelfBuy = supplier === "自采";

  const supPurchases = useMemo(
    () => purchases.filter((p) => p.month === month && (p.supplier ?? "未知供应商") === supplier)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [purchases, month, supplier]
  );

  const totalAmt = supPurchases.reduce((s, p) => s + p.amount, 0);
  const deletePurchasesAndResync = (ids: readonly string[]) => {
    const deletedIds = new Set(ids);
    const affectedMonths = new Set(purchases.filter((purchase) => deletedIds.has(purchase.id)).map((purchase) => purchase.month));
    const remainingPurchases = purchases.filter((purchase) => !deletedIds.has(purchase.id));
    batchDeletePurchases([...deletedIds]);
    affectedMonths.forEach((affectedMonth) => syncLedgerFromPurchases(affectedMonth, [], remainingPurchases));
  };
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showPettyImport, setShowPettyImport] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const purchaseWindowLayout = useMemo(
    () => resolveInventoryTableWindowLayout(
      appWindowWidth,
      SPIRIT_PURCHASE_BASE_WIDTH + (selectMode ? SPIRIT_PURCHASE_SELECT_WIDTH : 0),
    ),
    [appWindowWidth, selectMode],
  );
  const purchaseColumnWidths = useMemo(
    () => scaleInventoryTableWidths(SPIRIT_PURCHASE_COLUMN_WIDTH, purchaseWindowLayout.scale),
    [purchaseWindowLayout.scale],
  );
  const purchaseIndexWidth = Math.round(SPIRIT_PURCHASE_INDEX_WIDTH * purchaseWindowLayout.scale);
  const purchaseSelectWidth = Math.round(SPIRIT_PURCHASE_SELECT_WIDTH * purchaseWindowLayout.scale);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [pdfImporting, setPdfImporting] = useState(false);
  // 导入预览 Modal
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState<ParsedPurchaseRow[]>([]);
  const [importPreviewSource, setImportPreviewSource] = useState<"excel" | "pdf">("excel");
  // 商品名点击预览卡片
  const [previewItem, setPreviewItem] = useState<SpiritItem | null>(null);
  // 当月进货与库存详情使用相同的快速分类展开语义：默认展开，用户可按需收起。
  const [purchaseQuickCategoryExpanded, setPurchaseQuickCategoryExpanded] = useState(true);
  // 详情卡由采购表打开时保留当前记录 ID，快速分类需同步写回该采购快照。
  const [previewPurchaseId, setPreviewPurchaseId] = useState<string | null>(null);
  // 酒库关联：人工选择与智能候选是两条独立路径，均需人工确认后写回烈酒主档。
  const [bottleLinkMode, setBottleLinkMode] = useState<"manual" | "smart" | null>(null);
  const [bottleLinkQuery, setBottleLinkQuery] = useState("");
  const previewPurchase = useMemo(
    () => previewPurchaseId ? purchases.find((purchase) => purchase.id === previewPurchaseId) : undefined,
    [previewPurchaseId, purchases],
  );
  const bottleLinkOptions = useMemo(() => {
    if (!previewItem || !bottleLinkMode) return [] as { bottle: import("@/lib/bottles/types").Bottle; score: number }[];
    const query = bottleLinkQuery.trim().toLocaleLowerCase();
    const sourceNames = [previewItem.name, previewItem.nameEn, previewPurchase?.rawName].filter(Boolean) as string[];
    const exactChannelBottleId = bottleLinkMode === "smart" && previewPurchase?.rawName
      ? resolveBottleForSupplierProductName(bottles, previewPurchase.supplier ?? previewItem.supplier, previewPurchase.rawName)?.bottle.id
      : undefined;
    return bottles
      .map((bottle) => {
        const candidates = [bottle.nameZh, bottle.nameEn, bottle.brand].filter(Boolean);
        const score = bottle.id === exactChannelBottleId
          ? 1
          : Math.max(0, ...sourceNames.flatMap((source) => candidates.map((candidate) => fuzzyMatchScore(source, candidate))));
        const searchable = candidates.join(" ").toLocaleLowerCase();
        return { bottle, score, searchable };
      })
      .filter((entry) => bottleLinkMode === "smart" ? entry.score >= 0.2 : !query || entry.searchable.includes(query))
      .sort((left, right) => bottleLinkMode === "smart" ? right.score - left.score : left.bottle.nameZh.localeCompare(right.bottle.nameZh, "zh-Hans-CN"))
      .slice(0, 20)
      .map(({ bottle, score }) => ({ bottle, score }));
  }, [bottleLinkMode, bottleLinkQuery, bottles, previewItem, previewPurchase]);
  const confirmBottleLink = (bottle: import("@/lib/bottles/types").Bottle, confidence: "confirmed" | "auto") => {
    if (!previewItem) return;
    updateItem(previewItem.id, { bottleId: bottle.id, bottleLinkConfidence: confidence });
    setPreviewItem((current) => current ? { ...current, bottleId: bottle.id, bottleLinkConfidence: confidence } : null);
    setBottleLinkMode(null);
    setBottleLinkQuery("");
    Alert.alert("酒库关联成功", `已将「${previewItem.name}」关联至酒库「${bottle.nameZh}」。`);
  };
  const openBottleLinkPicker = (mode: "manual" | "smart") => {
    setBottleLinkQuery("");
    setBottleLinkMode(mode);
  };
  // 未匹配商品操作 Modal
  const [unmatchedPurchase, setUnmatchedPurchase] = useState<SpiritPurchaseRecord | null>(null);
  const [showUnmatchedModal, setShowUnmatchedModal] = useState(false);
  // 集团管理 Modal
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SpiritGroupDef | null>(null);
  // 分类管理 Modal
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
  // 仅控制供应商进货表的显示语言，不参与Excel导入、账务计算或同步。
  const [purchaseNameLanguage, setPurchaseNameLanguage] = usePersistedState<"zh" | "en">("spirits.purchase.name-language.v1", "zh");
  const [purchaseTableView, setPurchaseTableView] = useState(DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW);
  const [activePurchaseColumn, setActivePurchaseColumn] = useState<SupplierPurchaseSortKey | null>(null);
  const purchaseItemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const purchaseCategories = useMemo(() => getAllCategories(), [getAllCategories]);
  const purchaseCategoryOrderByName = useMemo(
    () => new Map(purchaseCategories.map((category) => [category.name, category.order])),
    [purchaseCategories],
  );
  const purchaseGroupColorByName = useMemo(
    () => new Map(groups.map((group) => [getSpiritGroupDisplayName(group), group.color])),
    [groups],
  );
  const supplierPurchaseRows = useMemo(() => supPurchases.map((purchase) => {
    const item = purchase.itemId ? purchaseItemById.get(purchase.itemId) : undefined;
    const preferred = purchaseNameLanguage === "zh" ? item?.name : item?.nameEn;
    const fallback = purchaseNameLanguage === "zh" ? item?.nameEn : item?.name;
    const isMatched = Boolean(item?.id);
    return {
      ...purchase,
      nameKey: isMatched ? `item:${item!.id}` : `raw:${purchase.rawName.trim().toLocaleLowerCase()}`,
      isMatched,
      searchableName: [item?.name, item?.nameEn, purchase.rawName].filter(Boolean).join(" "),
      displayName: preferred?.trim() || fallback?.trim() || purchase.rawName,
      displayCategory: resolvePurchaseDisplayCategory(purchase, item),
      categoryOrder: purchaseCategoryOrderByName.get(resolvePurchaseDisplayCategory(purchase, item)) ?? Number.MAX_SAFE_INTEGER,
      displayGroup: purchase.group || detectPurchaseGroup(purchase.rawName) || (item ? getItemGroup(item) : ""),
    };
  }), [supPurchases, purchaseItemById, purchaseNameLanguage, purchaseCategoryOrderByName, detectPurchaseGroup, getItemGroup]);
  const supplierPurchaseNameOptions = useMemo(
    () => collectSupplierPurchaseNameOptions(supplierPurchaseRows),
    [supplierPurchaseRows],
  );
  const visibleSupplierPurchases = useMemo(
    () => applySupplierPurchaseTableView(supplierPurchaseRows, purchaseTableView),
    [supplierPurchaseRows, purchaseTableView],
  );
  const visibleSupplierPurchaseTotal = sumMoney(visibleSupplierPurchases.map((purchase) => purchase.amount));
  const visibleSupplierPurchaseIndexById = useMemo(
    () => new Map(visibleSupplierPurchases.map((purchase, index) => [purchase.id, index + 1])),
    [visibleSupplierPurchases],
  );
  const visiblePurchaseReferencePriceByItemId = useMemo(() => {
    const prices = new Map<string, number>();
    visibleSupplierPurchases.forEach((purchase) => {
      if (purchase.itemId && !prices.has(purchase.itemId)) prices.set(purchase.itemId, getRefPrice(purchase.itemId, month));
    });
    return prices;
  }, [getRefPrice, month, visibleSupplierPurchases]);
  const purchaseTableHasAdjustments = Boolean(purchaseTableView.sort) || hasSupplierPurchaseTableFilters(purchaseTableView.filters);
  const purchaseTableSummary = [
    purchaseTableView.sort ? `${({ category: "分类", name: "商品名称", quantity: "数量", unitPrice: "单价", amount: "总价", group: "集团" } as const)[purchaseTableView.sort.key]}${purchaseTableView.sort.direction === "asc" ? "升序" : "降序"}` : "",
    purchaseTableView.filters.nameQuery ? `名称含「${purchaseTableView.filters.nameQuery}」` : "",
    purchaseTableView.filters.categories.length ? `分类 ${purchaseTableView.filters.categories.length} 个` : "",
    purchaseTableView.filters.onlyUnassignedCategory ? "仅未分类" : "",
    purchaseTableView.filters.groups.length ? `集团 ${purchaseTableView.filters.groups.length} 个` : "",
    purchaseTableView.filters.onlyUnassignedGroup ? "仅待填集团" : "",
  ].filter(Boolean).join(" · ");

  /**
   * 当月进货按完整业务日期分组。分类是每条采购记录的固定列，不再占用分组行。
   * 筛选和排序只缩减、重排各日期内的结果；日期分组始终保留，避免用户失去采购发生日。
   */
  const purchaseDisplayGroups = useMemo(() => {
    const grouped = new Map<string, typeof visibleSupplierPurchases>();
    visibleSupplierPurchases.forEach((purchase) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(purchase.date) ? purchase.date : "未填写日期";
      const rows = grouped.get(date) ?? [];
      rows.push(purchase);
      grouped.set(date, rows);
    });
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        if (left === "未填写日期") return 1;
        if (right === "未填写日期") return -1;
        return right.localeCompare(left);
      })
      .map(([label, rows]) => ({ id: label, label, rows, amount: sumMoney(rows.map((row) => row.amount)) }));
  }, [visibleSupplierPurchases]);
  // 虚拟列表按固定行数切分日期组：即使单日导入上万条，也不会在一个 renderItem 内创建整天的全部行。
  const purchaseVirtualGroups = useMemo(
    () => purchaseDisplayGroups.flatMap((group) => {
      const chunks = [] as typeof group[];
      for (let start = 0; start < group.rows.length; start += 32) {
        chunks.push({ ...group, id: `${group.id}:${start}`, rows: group.rows.slice(start, start + 32) });
      }
      return chunks;
    }),
    [purchaseDisplayGroups],
  );

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
      const { normalizeLLMRows } = await import("@/lib/spirits/pdf-import");
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
      const [XLSX, excelImport] = await Promise.all([
        import("xlsx"),
        import("@/lib/spirits/excel-import"),
      ]);
      const workbook = XLSX.read(base64, { type: "base64", cellDates: true, raw: false });
      let targetSheet = workbook.SheetNames[0];
      if (workbook.SheetNames.length > 1) {
        const sheets = excelImport.previewSheets(workbook);
        const valid = sheets.filter((s) => s.isValid);
        if (valid.length >= 1) targetSheet = valid.sort((a, b) => b.rowCount - a.rowCount)[0].name;
      }
      const parsed = excelImport.parseSheetFromWorkbook(workbook, targetSheet, { supplierHint: supplier, fileName: asset.name ?? "import.xlsx" });
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
    <View testID="spirits-supplier-purchase-detail" style={{ flex: 1 }}>
      {/* 操作栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
        contentContainerStyle={{ gap: INVENTORY_WORKSPACE_METRICS.horizontalGap, paddingHorizontal: INVENTORY_WORKSPACE_METRICS.horizontalPadding, paddingVertical: 6, alignItems: "center" }}>
        <TouchableOpacity onPress={() => { tap(); setShowAddPurchase(true); }}
          style={[S.actionBtn, { minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, backgroundColor: colors.surface, borderColor: colors.foreground }]}>
          <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "700" }}>手动录入</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExcelImport}
          style={[S.actionBtn, { minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, backgroundColor: colors.surface, borderColor: colors.border }]}>
          {importing ? <ActivityIndicator size="small" color={colors.foreground} /> : null}
          <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>导入 Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePdfImport}
          style={[S.actionBtn, { minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, backgroundColor: colors.surface, borderColor: colors.border }]}>
          {pdfImporting ? <ActivityIndicator size="small" color={colors.foreground} /> : null}
          <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>导入 PDF</Text>
        </TouchableOpacity>
        {isSelfBuy && (
          <TouchableOpacity onPress={() => { tap(); setShowPettyImport(true); }}
            style={[S.actionBtn, { minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>从备用金导入</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => { tap(); setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
          style={[S.actionBtn, { minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, backgroundColor: selectMode ? colors.foreground : colors.surface, borderColor: selectMode ? colors.foreground : colors.border }]}>
          <Text style={{ fontSize: 12, color: selectMode ? "#fff" : colors.muted, fontWeight: "600" }}>
            {selectMode ? `已选${selectedIds.size}` : "多选"}
          </Text>
        </TouchableOpacity>
        {selectMode && selectedIds.size > 0 && (
          <TouchableOpacity onPress={() => {
            Alert.alert("批量删除", `删除选中的 ${selectedIds.size} 条记录？`, [
              { text: "取消", style: "cancel" },
              { text: "删除", style: "destructive", onPress: () => {
                deletePurchasesAndResync([...selectedIds]);
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

      {/* 批量操作仅在用户主动进入多选模式后显示。 */}
      {selectMode && (
        <View style={{ backgroundColor: "#FEF2F2", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#FECACA" }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center" }}>
            <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "700" }}>已选 {selectedIds.size}/{supPurchases.length}</Text>
        <TouchableOpacity onPress={() => {
          tap();
          const allIds = new Set(supPurchases.map((p) => p.id));
          setSelectedIds(allIds);
          setSelectMode(true);
        }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>全选</Text>
        </TouchableOpacity>
        {selectedIds.size > 0 && (
          <TouchableOpacity onPress={() => { tap(); setSelectedIds(new Set()); }}
            style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600" }}>清空选择</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => { tap(); setSelectedIds(new Set()); setSelectMode(false); }}
          style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: "#EF4444" }]}>
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "700" }}>取消多选</Text>
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
            // 批量分类以单个状态提交同步所有选中采购行及其关联库存酒款。
            setItemsAndPurchasesCategory([...selectedIds], name);
            setSelectedIds(new Set()); setSelectMode(false);
            Alert.alert("修改成功", `已同步更新 ${count} 条采购记录与关联库存酒款的分类`);
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
        </View>
      )}

      {/* 供应商信息头 */}
      <View style={{ minHeight: INVENTORY_WORKSPACE_METRICS.contextHeight, justifyContent: "center", paddingHorizontal: INVENTORY_WORKSPACE_METRICS.horizontalPadding, paddingVertical: 4, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
          往来单位：{supplier} · 本月合计 ¥{formatMoney(totalAmt)} · {supPurchases.length} 笔
        </Text>
        {purchaseTableHasAdjustments && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6, gap: 8 }}>
            <Text style={{ fontSize: 11, color: colors.primary, flex: 1 }} numberOfLines={1}>已调整：{purchaseTableSummary || "范围筛选"} · 显示 {visibleSupplierPurchases.length} 笔</Text>
            <TouchableOpacity onPress={() => setPurchaseTableView(DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW)} style={{ minHeight: 30, justifyContent: "center" }}>
              <Text style={{ fontSize: 11, color: "#EF4444", fontWeight: "700" }}>清除全部</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 进货流水表格 */}
      <View style={{ flex: 1 }}>
        {visibleSupplierPurchases.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 48 }}>📦</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>{supPurchases.length === 0 ? "本月暂无进货记录" : "没有符合当前筛选的进货记录"}</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>{supPurchases.length === 0 ? "手动录入或导入 Excel 进货单" : "可使用上方“清除全部”恢复完整列表"}</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
            <View>
              {/* 表头 */}
              <View testID="spirits-purchase-header" style={[S.tableHeader, { width: purchaseWindowLayout.tableWidth, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, backgroundColor: colors.foreground }]}>
                {selectMode && <Text style={[S.thCell, { width: purchaseSelectWidth, paddingHorizontal: 0 }]} />}
                <Text style={[S.thCell, { width: purchaseIndexWidth, paddingHorizontal: 0 }]}>序号</Text>
                <TouchableOpacity testID="spirits-purchase-column-category" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("分类", Boolean(purchaseTableView.sort?.key === "category" || purchaseTableView.filters.categories.length || purchaseTableView.filters.onlyUnassignedCategory))}
                  onPress={() => setActivePurchaseColumn("category")} style={{ width: purchaseColumnWidths.category, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>分类</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="spirits-purchase-column-name" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("商品名称", Boolean(purchaseTableView.sort?.key === "name" || purchaseTableView.filters.nameQuery))}
                  onPress={() => setActivePurchaseColumn("name")}
                  style={{ width: purchaseColumnWidths.name, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>商品名称</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="spirits-purchase-column-quantity" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("数量", Boolean(purchaseTableView.sort?.key === "quantity" || purchaseTableView.filters.quantityMin || purchaseTableView.filters.quantityMax))}
                  onPress={() => setActivePurchaseColumn("quantity")} style={{ width: purchaseColumnWidths.quantity, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>数量</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="spirits-purchase-column-unit-price" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("单价", Boolean(purchaseTableView.sort?.key === "unitPrice" || purchaseTableView.filters.unitPriceMin || purchaseTableView.filters.unitPriceMax))}
                  onPress={() => setActivePurchaseColumn("unitPrice")} style={{ width: purchaseColumnWidths.unitPrice, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>单价</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="spirits-purchase-column-amount" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("总价", Boolean(purchaseTableView.sort?.key === "amount" || purchaseTableView.filters.amountMin || purchaseTableView.filters.amountMax))}
                  onPress={() => setActivePurchaseColumn("amount")} style={{ width: purchaseColumnWidths.amount, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>总价</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="spirits-purchase-column-group" accessibilityRole="button" accessibilityLabel={tableHeaderAccessibilityLabel("集团", Boolean(purchaseTableView.sort?.key === "group" || purchaseTableView.filters.groups.length || purchaseTableView.filters.onlyUnassignedGroup))}
                  onPress={() => setActivePurchaseColumn("group")} style={{ width: purchaseColumnWidths.group, height: INVENTORY_WORKSPACE_METRICS.phoneHeaderHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }}>
                  <Text style={[S.thCell, { width: "auto", paddingHorizontal: 0 }]}>集团</Text>
                </TouchableOpacity>
              </View>

              {/* 数据行始终按完整年月日分组；分类在每条采购记录中显示。 */}
              <FlatList
                data={purchaseVirtualGroups}
                keyExtractor={(group) => group.id}
                initialNumToRender={4}
                maxToRenderPerBatch={3}
                windowSize={5}
                removeClippedSubviews={Platform.OS !== "web"}
                contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
                renderItem={({ item: group }) => (
                  <View>
                    <View style={{ width: purchaseWindowLayout.tableWidth, minHeight: STORE_TABLE_METRICS.groupHeight, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
                      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{group.label} · {group.rows.length} 笔</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{formatStoreMoney(group.amount)}</Text>
                    </View>
                    {group.rows.map((p, idx) => {
                const item = p.itemId ? purchaseItemById.get(p.itemId) : undefined;
                const refPrice = p.itemId ? (visiblePurchaseReferencePriceByItemId.get(p.itemId) ?? 0) : 0;
                const priceDiff = refPrice > 0 ? p.unitPrice - refPrice : 0;
                const priceDiffPct = refPrice > 0 ? Math.abs(priceDiff / refPrice * 100) : 0;
                const isPriceAlert = refPrice > 0 && priceDiffPct > (item?.priceAlertPct ?? 0);
                // 集团归属：优先用记录上的 group 字段，否则实时检测
                const purchaseGroup = p.displayGroup;
                const isSelected = selectedIds.has(p.id);
                return (
                  <TouchableOpacity key={p.id}
                    onPress={() => selectMode ? toggleSelect(p.id) : undefined}
                    onLongPress={() => {
                      tap();
                      if (!selectMode) {
                        Alert.alert("操作", `「${p.rawName}」`, [
                          { text: "修改日期", onPress: () => {
                            Alert.prompt("修改日期", "格式：YYYY-MM-DD", (val) => {
                              if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                                updatePurchase(p.id, { date: val, month: val.slice(0, 7) });
                                syncLedgerFromPurchases(month);
                              } else if (val) {
                                Alert.alert("格式错误", "请输入 YYYY-MM-DD 格式");
                              }
                            }, "plain-text", p.date, "numbers-and-punctuation");
                          }},
                          { text: "删除此记录", style: "destructive", onPress: () => {
                            Alert.alert("确认删除", `删除「${p.rawName}」的进货记录？`, [
                              { text: "取消", style: "cancel" },
                              { text: "删除", style: "destructive", onPress: () => deletePurchasesAndResync([p.id]) },
                            ]);
                          }},
                          { text: "取消", style: "cancel" },
                        ]);
                      }
                    }}
                    style={[S.tableRow, {
                      width: purchaseWindowLayout.tableWidth,
                      height: INVENTORY_WORKSPACE_METRICS.phoneRowHeight,
                      minHeight: INVENTORY_WORKSPACE_METRICS.phoneRowHeight,
                      backgroundColor: isSelected ? "#FEF2F2" : idx % 2 === 0 ? colors.surface : colors.background,
                    }]}>
                    {selectMode && (
                      <View style={[S.ledgerCell, { width: purchaseSelectWidth, alignItems: "center" }]}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                          borderColor: isSelected ? "#EF4444" : colors.border,
                          backgroundColor: isSelected ? "#EF4444" : "transparent",
                          alignItems: "center", justifyContent: "center" }}>
                          {isSelected && <Text style={{ color: "#fff", fontSize: 10 }}>✓</Text>}
                        </View>
                      </View>
                    )}
                    <Text style={[S.ledgerCell, { width: purchaseIndexWidth, textAlign: "center", fontSize: 10, color: colors.muted }]}>{visibleSupplierPurchaseIndexById.get(p.id) ?? "—"}</Text>
                    <Text style={[S.ledgerCell, { width: purchaseColumnWidths.category, textAlign: "center", fontSize: 10, lineHeight: 14, color: catColor(p.displayCategory) }]} numberOfLines={2}>
                      {p.displayCategory}
                    </Text>
                    <TouchableOpacity style={[S.ledgerCell, { width: purchaseColumnWidths.name, height: INVENTORY_WORKSPACE_METRICS.phoneRowHeight, justifyContent: "center" }]}
                      onPress={() => {
                        if (!selectMode) {
                          tap();
                          const matched = items.find((i) => i.id === p.itemId) ??
                            items.find((i) => i.name === p.rawName || i.nameEn === p.rawName ||
                              p.rawName.includes(i.name) || (i.nameEn && p.rawName.includes(i.nameEn)));
                          if (matched) {
                            setPreviewItem(matched);
                            setPreviewPurchaseId(p.id);
                          } else {
                            // 弹出操作卡片：从现有酒款选择 / 新建酒款档案
                            setUnmatchedPurchase(p);
                            setShowUnmatchedModal(true);
                          }
                        } else {
                          toggleSelect(p.id);
                        }
                      }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 34 }}>
                        <Text style={{ fontSize: 11, lineHeight: 16, color: colors.foreground, flex: 1 }} numberOfLines={2}>
                          {p.displayName}
                        </Text>
                        {!p.itemId && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" }} />}
                      </View>
                    </TouchableOpacity>
                    {/* 数量列（可点击编辑） */}
                    <TouchableOpacity style={[S.ledgerCell, { width: purchaseColumnWidths.quantity, alignItems: "flex-end" }]}
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
                    {/* 单价列（可点击编辑；价格涨跌独占第二行） */}
                    <TouchableOpacity style={[S.ledgerCell, { width: purchaseColumnWidths.unitPrice, alignItems: "flex-end" }]}
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
                    {/* 总价列（可点击编辑） */}
                    <TouchableOpacity style={[S.ledgerCell, { width: purchaseColumnWidths.amount, alignItems: "flex-end" }]}
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
                    {/* 集团列位于总价之后，按需横滑。 */}
                    <TouchableOpacity style={[S.ledgerCell, { width: purchaseColumnWidths.group }]}
                      onPress={() => {
                        if (selectMode) return;
                        tap();
                        const groupNames = groups.map((group) => getSpiritGroupDisplayName(group));
                        Alert.alert("设置集团归属", `「${p.rawName}」`, [
                          ...groupNames.map((gn) => ({
                            text: gn,
                            onPress: () => {
                              updatePurchase(p.id, { group: gn });
                              rememberGroupMatch(p.rawName, gn);
                            },
                          })),
                          { text: "清除", style: "destructive" as const, onPress: () => updatePurchase(p.id, { group: undefined }) },
                          { text: "取消", style: "cancel" as const },
                        ]);
                      }}>
                      {purchaseGroup ? (
                        <View style={{ backgroundColor: (purchaseGroupColorByName.get(purchaseGroup) ?? "#6B7280") + "20", borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, fontWeight: "700", color: purchaseGroupColorByName.get(purchaseGroup) ?? "#6B7280" }} numberOfLines={2}>
                            {purchaseGroup.replace(/ \(.*\)/, "")}
                          </Text>
                        </View>
                      ) : <Text style={{ fontSize: 9, color: "#F59E0B", fontWeight: "600" }}>待填</Text>}
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
                    })}
                  </View>
                )}
                ListFooterComponent={(
                  <View style={[S.tableRow, { width: purchaseWindowLayout.tableWidth, minHeight: INVENTORY_WORKSPACE_METRICS.phoneRowHeight, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>

                {selectMode && <Text style={[S.ledgerCell, { width: purchaseSelectWidth }]} />}
                <Text style={[S.ledgerCell, { width: purchaseIndexWidth }]} />
                <Text style={[S.ledgerCell, { width: purchaseColumnWidths.category }]} />
                <Text style={[S.ledgerCell, { width: purchaseColumnWidths.name, fontWeight: "600", color: colors.foreground, fontSize: 12 }]}>合计</Text>
                <Text style={[S.ledgerCell, { width: purchaseColumnWidths.quantity, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 11 }]}>
                  {visibleSupplierPurchases.reduce((sum, purchase) => sum + purchase.quantity, 0)}
                </Text>
                <Text style={[S.ledgerCell, { width: purchaseColumnWidths.unitPrice }]} />
                <Text style={[S.ledgerCell, { width: purchaseColumnWidths.amount, textAlign: "right", fontWeight: "600", color: colors.foreground, fontSize: 12 }]}>
                  ¥{formatMoney(visibleSupplierPurchaseTotal)}
                </Text>
                    <Text style={[S.ledgerCell, { width: purchaseColumnWidths.group }]} />
                  </View>
                )}
              />
            </View>
          </ScrollView>
        )}
      </View>

      {/* 手动录入进货 Modal */}
      {showAddPurchase && (
        <PurchaseFormModal
          visible={showAddPurchase}
          items={items.filter((i) => i.active)}
          bottles={bottles}
          month={month}
          supplier={supplier}
          colors={colors}
          getRefPrice={getRefPrice}
          onSave={(data) => {
            const pending = addPurchase({ ...data, supplier });
            syncLedgerFromPurchases(pending.month, [pending]);
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
            activeOpacity={1} onPress={() => { setPreviewItem(null); setPreviewPurchaseId(null); }}>
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
              <View testID="spirits-purchase-quick-category" style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <TouchableOpacity onPress={() => setPurchaseQuickCategoryExpanded((expanded) => !expanded)} accessibilityRole="button" accessibilityState={{ expanded: purchaseQuickCategoryExpanded }} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 38, marginBottom: purchaseQuickCategoryExpanded ? 8 : 0 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>快速选择分类</Text>
                  <IconSymbol name={purchaseQuickCategoryExpanded ? "chevron.up" : "chevron.down"} size={14} color={colors.muted} />
                </TouchableOpacity>
                {purchaseQuickCategoryExpanded && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingRight: 8 }}>
                    {getAllCategories().map((category) => {
                      const active = previewItem.category === category.name;
                      return (
                        <TouchableOpacity
                          key={category.id}
                          testID={`spirits-purchase-category-${category.id}`}
                          onPress={() => {
                            // 原子写回库存主档与当前采购行，表格分类列与库存管理在同一 state transition 刷新。
                            setItemAndPurchaseCategory(previewItem.id, category.name, previewPurchaseId ?? undefined);
                            setPreviewItem((current) => current ? { ...current, category: category.name, categorySource: "manual" } : null);
                          }}
                          style={[S.catChip, { minHeight: 32, backgroundColor: active ? category.color : colors.surface, borderColor: category.color }]}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "700", color: active ? "#fff" : category.color }}>{category.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* 酒库关联始终可被人工纠错：即使已经关联，也可查看、人工重连或查看智能候选。 */}
              <View style={{ paddingHorizontal: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 10 }}>
                {previewItem.bottleId && (
                  <TouchableOpacity testID="spirits-purchase-view-linked-bottle" onPress={() => {
                    setPreviewItem(null); setPreviewPurchaseId(null); setBottleLinkMode(null);
                    router2.push(("/bottle/" + previewItem.bottleId) as any);
                  }} style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600" }}>查看已关联酒库档案</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity testID="spirits-purchase-manual-bottle-link" onPress={() => openBottleLinkPicker("manual")}
                    style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600" }}>{previewItem.bottleId ? "人工重连酒库" : "人工链接酒库"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID="spirits-purchase-smart-bottle-link" onPress={() => openBottleLinkPicker("smart")}
                    style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>{previewItem.bottleId ? "智能重连" : "智能链接"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10, padding: 16 }}>
                {!previewItem.bottleId && <TouchableOpacity testID="spirits-purchase-create-bottle" onPress={() => {
                  const item = previewItem;
                  setPreviewItem(null); setPreviewPurchaseId(null); setBottleLinkMode(null);
                  router2.push({ pathname: "/bottle-form", params: { prefillNameAlt: item.name, ...(item.nameEn ? { prefillName: item.nameEn } : {}), sourceSpiritItemId: item.id } });
                }} style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: "600" }}>新建酒库档案</Text>
                </TouchableOpacity>}
                <TouchableOpacity onPress={() => { setPreviewItem(null); setPreviewPurchaseId(null); setBottleLinkMode(null); setBottleLinkQuery(""); }}
                  style={{ flex: 1, minHeight: 44, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 13, color: colors.muted, fontWeight: "600" }}>关闭</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      <Modal visible={bottleLinkMode !== null} transparent animationType="slide" onRequestClose={() => setBottleLinkMode(null)}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <View style={{ maxHeight: "82%", backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16) }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 12 }} />
            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Text style={{ fontSize: 17, color: colors.foreground, fontWeight: "600" }}>{bottleLinkMode === "manual" ? "人工链接酒库信息" : "智能链接酒库信息"}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{bottleLinkMode === "manual" ? "从已有酒库档案中搜索并确认关联。" : "根据采购名称、中英文酒名和品牌给出候选，确认后才关联。"}</Text>
              {bottleLinkMode === "manual" && <TextInput value={bottleLinkQuery} onChangeText={setBottleLinkQuery} placeholder="搜索中文名、英文名或品牌" placeholderTextColor={colors.muted} autoFocus style={[S.input, { marginTop: 12, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
              {bottleLinkOptions.map(({ bottle, score }) => (
                <TouchableOpacity key={bottle.id} onPress={() => confirmBottleLink(bottle, "confirmed")}
                  style={{ minHeight: 58, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{bottle.nameZh}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{[bottle.nameEn, bottle.brand, bottle.category].filter(Boolean).join(" · ")}</Text>
                  </View>
                  {bottleLinkMode === "smart" && <Text style={{ color: score >= 0.8 ? "#16A34A" : colors.primary, fontSize: 11, fontWeight: "600" }}>{Math.round(score * 100)}%</Text>}
                </TouchableOpacity>
              ))}
              {bottleLinkOptions.length === 0 && <Text style={{ color: colors.muted, textAlign: "center", paddingVertical: 28, fontSize: 13 }}>{bottleLinkMode === "smart" ? "没有足够可信的候选，请使用人工链接或新建档案。" : "没有匹配的酒库档案。"}</Text>}
            </ScrollView>
            <TouchableOpacity onPress={() => { setBottleLinkMode(null); setBottleLinkQuery(""); }} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
        onMove={moveGroup}
        onDelete={deleteGroup}
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
            const initial = buildImportedPurchaseRecords(orders, resolvedItems, month, importPreviewSource, bottles, purchases);
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
            const purchaseImport = buildImportedPurchaseRecords(orders, resolvedItems, month, importPreviewSource, bottles, purchases);
            const skippedDuplicates = orders.length - purchaseImport.records.length;
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
              `进货记录：${purchaseImport.records.length} 条已同步${skippedDuplicates > 0 ? `（重复跳过 ${skippedDuplicates} 条）` : ""}\n酒款档案：新增 ${addedItems} 款\n台账：已按每条记录的实际日期归属重算`,
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
      <SupplierPurchaseColumnMenu
        visible={activePurchaseColumn !== null}
        column={activePurchaseColumn}
        colors={colors}
        groups={groups.map((group) => getSpiritGroupDisplayName(group))}
        categories={purchaseCategories.map((category) => category.name)}
        nameOptions={supplierPurchaseNameOptions}
        nameLanguage={purchaseNameLanguage}
        onNameLanguageChange={setPurchaseNameLanguage}
        view={purchaseTableView}
        onViewChange={setPurchaseTableView}
        onClose={() => setActivePurchaseColumn(null)}
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

  const [priceAlertPct, setPriceAlertPct] = useState(String(item?.priceAlertPct ?? ""));
  const [specMl, setSpecMl] = useState(item?.specMl != null ? String(item.specMl) : "");
  // 分类列表异步刷新时不得重置正在填写的新酒款；仅在打开或切换档案时读取最新默认分类。
  const categoriesRef = useRef(allCategories);
  categoriesRef.current = allCategories;

  React.useEffect(() => {
    if (item) {
      setName(item.name); setNameEn(item.nameEn ?? ""); setCategory(item.category);
      setUnit(item.unit); setRefPrice(String(item.refPrice));
      setPriceAlertPct(item.priceAlertPct != null ? String(item.priceAlertPct) : "");
      setSpecMl(item.specMl != null ? String(item.specMl) : "");
    } else {
      setName(""); setNameEn(""); setCategory(categoriesRef.current[0]?.name ?? "Other"); setUnit("瓶"); setRefPrice(""); setPriceAlertPct(""); setSpecMl("");
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
              onSave({ name: name.trim(), nameEn: nameEn.trim() || undefined, category, unit, refPrice: parseFloat(refPrice) || 0, priceAlertPct: alertPct, specMl: specMlVal, active: true });
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
            {/* 区块二：价格与规格；供应渠道、多采购名称与成本基准统一在鸡尾酒库酒款详情中管理。 */}
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
            {/* 区块四：进销存分类 */}
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
function PurchaseFormModal({ visible, items, bottles, month, supplier, colors, getRefPrice, onSave, onClose }: {
  visible: boolean; items: SpiritItem[]; bottles: import("@/lib/bottles/types").Bottle[]; month: string; supplier?: string; colors: any;
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
                  const channelMatch = resolveBottleForSupplierProductName(bottles, supplier, rawName.trim());
                  const channelItem = channelMatch
                    ? items.filter((item) => item.bottleId === channelMatch.bottle.id).at(0)
                    : undefined;
                  const resolvedItem = selectedItem ?? channelItem ?? resolveSpiritItemForSupplierName(items, supplier, rawName.trim())?.item;
                  onSave({
                    month, date, rawName: rawName.trim(),
                    itemId: resolvedItem?.id,
                    supplier, quantity: q, unit: unit || resolvedItem?.unit || "瓶", unitPrice: up, amount: q * up,
                    group: resolvedItem?.group, category: resolvedItem?.category, source: "manual",
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
function PettyImportModal({ visible, pettyRecords, month, colors, matchPettyToItem, setMatchMemory, onConfirm, onClose }: {
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
  // 匹配函数的Provider引用可随数据刷新变化；导入会话只在打开或记录集变化时初始化，不能抹去人工调整。
  const matchPettyToItemRef = useRef(matchPettyToItem);
  matchPettyToItemRef.current = matchPettyToItem;

  React.useEffect(() => {
    if (visible) {
      const initial: MatchState[] = pettyRecords.map((r) => {
        const match = matchPettyToItemRef.current(r.description);
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
  tabChip: { minHeight: INVENTORY_WORKSPACE_METRICS.segmentHeight, paddingHorizontal: 14, paddingVertical: 6, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  actionBtn: { flexDirection: "row", flexShrink: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, borderWidth: 1 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  summaryTableContent: { width: "100%", minWidth: 380 },
  summaryTableHeader: { flexDirection: "row", alignItems: "center", minHeight: 36 },
  summaryTableRow: { flexDirection: "row", alignItems: "center", minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
  summaryThCell: { fontSize: 11, fontWeight: "700", color: "#fff", paddingHorizontal: 6, textAlign: "center" },
  summaryTdCell: { paddingHorizontal: 6, paddingVertical: 2 },
  summaryColCat: { width: 116 },
  summaryColAmount: { width: 66 },
  tableHeader: { flexDirection: "row", alignItems: "center", minHeight: STORE_TABLE_METRICS.headerHeight },
  tableRow: { flexDirection: "row", alignItems: "center", minHeight: STORE_TABLE_METRICS.rowHeight, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.06)" },
  thCell: { fontSize: STORE_TABLE_METRICS.bodyFontSize, fontWeight: "700", color: "#fff", paddingHorizontal: 10, textAlign: "center" },
  tdCell: { paddingHorizontal: 10, paddingVertical: 2 },
  ledgerCell: { paddingHorizontal: 3, paddingVertical: 2 },
  colCat: { flex: 1.8, minWidth: 160 },
  colNum: { flex: 1, minWidth: 78 },
  inlineInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, width: 64, textAlign: "right" },
  supplierRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
});

// ─── 导入预览 Modal（Excel/PDF 通用，支持单条编辑 + 批量改日期 + 删除）─────────
function ImportPreviewModal({
  visible, rows: initialRows, source, supplier, colors, onConfirm, onClose,
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
  const insets = useSafeAreaInsets();

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
    const newDate = normalizeImportDate(editDate);
    if (!newDate) {
      Alert.alert("日期无效", "请输入有效日期，例如：2026-07-15、2026/7/15 或 2026年7月15日");
      return;
    }
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
    const normalizedDate = normalizeImportDate(batchDate);
    if (!normalizedDate) {
      Alert.alert("日期无效", "请输入有效日期，例如：2026-07-15、2026/7/15 或 2026年7月15日");
      return;
    }
    const newMonth = normalizedDate.slice(0, 7);
    // 多选模式下只修改选中的，普通模式下修改全部
    setRows((prev) => prev.map((r, i) => {
      if (selectMode && !selectedIdxs.has(i)) return r;
      return { ...r, date: normalizedDate, month: newMonth };
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
        <View style={[S.navbar, { borderBottomColor: colors.border, paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ fontSize: 15, color: "#EF4444", fontWeight: "600" }}>取消</Text>
          </TouchableOpacity>
          <View style={{ alignItems: "center" }}>
            <Text style={[S.navTitle, { color: colors.foreground }]}>
              {source === "pdf" ? "PDF 解析预览" : "Excel 导入预览"}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>
              {rows.length} 条记录 · 合计 ¥{formatMoney(totalAmt)}
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
              <Text style={{ fontSize: 12, color: showBatchDate ? "#EF4444" : colors.muted, fontWeight: "600" }}>改日期</Text>
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
        <ScrollView contentContainerStyle={{ paddingBottom: 112 + Math.max(insets.bottom, 16) }}>
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
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, flex: 1, minWidth: 0, marginRight: 8 }} numberOfLines={2}>
                      {row.rawName}
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444", flexShrink: 0 }}>¥{formatMoney(row.amount)}</Text>
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
                  }} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                    <IconSymbol name="trash" size={16} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* 底部确认栏 */}
        {rows.length > 0 && (
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 + Math.max(insets.bottom, 0), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background }}>
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
function GroupManagerModal({ visible, groups, editingGroup, colors, onUpsert, onMove, onDelete, onClose }: {
  visible: boolean;
  groups: SpiritGroupDef[];
  editingGroup: SpiritGroupDef | null;
  colors: any;
  onUpsert: (data: Omit<SpiritGroupDef, "id" | "createdAt"> & { id?: string }) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [editNameZh, setEditNameZh] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editColor, setEditColor] = useState("#6B7280");
  const [editBuiltin, setEditBuiltin] = useState(false);
  const [editSortOrder, setEditSortOrder] = useState(0);
  const [brandKeywords, setBrandKeywords] = useState<SpiritBrandKeyword[]>([]);
  const [newKeywordZh, setNewKeywordZh] = useState("");
  const [newKeywordEn, setNewKeywordEn] = useState("");
  // 新建分组的默认排序只在会话初始化时取值；后台分组列表刷新不能覆盖正在编辑的排序输入。
  const groupCountRef = useRef(groups.length);
  groupCountRef.current = groups.length;

  const PRESET_COLORS = ["#1D4ED8","#DC2626","#7C3AED","#92400E","#B45309","#059669","#0891B2","#BE185D","#6B7280","#EF4444","#10B981","#F59E0B"];

  React.useEffect(() => {
    if (editingGroup) {
      setMode("edit");
      setEditId(editingGroup.id);
      setEditNameZh(editingGroup.nameZh);
      setEditNameEn(editingGroup.nameEn);
      setEditColor(editingGroup.color);
      setEditBuiltin(editingGroup.builtin);
      setEditSortOrder(editingGroup.sortOrder);
      setBrandKeywords(editingGroup.brandKeywords.map((keyword) => ({ ...keyword })));
      setNewKeywordZh("");
      setNewKeywordEn("");
    } else {
      setMode("list");
      setEditId(undefined);
      setEditNameZh("");
      setEditNameEn("");
      setEditColor("#6B7280");
      setEditBuiltin(false);
      setEditSortOrder(groupCountRef.current);
      setBrandKeywords([]);
      setNewKeywordZh("");
      setNewKeywordEn("");
    }
  }, [editingGroup, visible]);

  const startNew = () => {
    setMode("edit");
    setEditId(undefined);
    setEditNameZh("");
    setEditNameEn("");
    setEditColor("#6B7280");
    setEditBuiltin(false);
    setEditSortOrder(groups.length);
    setBrandKeywords([]);
    setNewKeywordZh("");
    setNewKeywordEn("");
  };

  const handleSave = () => {
    if (!editNameZh.trim() && !editNameEn.trim()) { Alert.alert("提示", "请至少填写中文名或英文名"); return; }
    onUpsert({
      id: editId,
      nameZh: editNameZh.trim(),
      nameEn: editNameEn.trim(),
      color: editColor,
      brandKeywords,
      sortOrder: editSortOrder,
      builtin: editBuiltin,
    });
    setMode("list");
  };

  const updateBrandKeyword = (id: string, patch: Partial<Pick<SpiritBrandKeyword, "nameZh" | "nameEn">>) => {
    setBrandKeywords((current) => current.map((keyword) => keyword.id === id ? { ...keyword, ...patch, updatedAt: new Date().toISOString() } : keyword));
  };

  const removeBrandKeyword = (id: string) => {
    setBrandKeywords((current) => current.filter((keyword) => keyword.id !== id));
  };

  const addBrandKeyword = () => {
    const nameZh = newKeywordZh.trim();
    const nameEn = newKeywordEn.trim();
    if (!nameZh && !nameEn) return;
    const duplicate = brandKeywords.some((keyword) => keyword.nameZh.toLocaleLowerCase() === nameZh.toLocaleLowerCase() && keyword.nameEn.toLocaleLowerCase() === nameEn.toLocaleLowerCase());
    if (duplicate) return;
    const now = new Date().toISOString();
    setBrandKeywords((current) => [...current, {
      id: `brand_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      nameZh,
      nameEn,
      sortOrder: current.length,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }]);
    setNewKeywordZh("");
    setNewKeywordEn("");
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
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{g.nameZh || g.nameEn}</Text>
                    {g.nameEn ? <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{g.nameEn}</Text> : null}
                    <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                      {g.brandKeywords.slice(0, 2).map((keyword) => [keyword.nameZh, keyword.nameEn].filter(Boolean).join(" / ")).join(" · ") || "暂无品牌关键词"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <View style={{ gap: 2 }}>
                      <TouchableOpacity onPress={() => onMove(g.id, "up")} accessibilityLabel={`上移${getSpiritGroupDisplayName(g)}`} style={{ padding: 3, backgroundColor: colors.surface, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                        <IconSymbol name="chevron.up" size={12} color={colors.muted} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => onMove(g.id, "down")} accessibilityLabel={`下移${getSpiritGroupDisplayName(g)}`} style={{ padding: 3, backgroundColor: colors.surface, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                        <IconSymbol name="chevron.down" size={12} color={colors.muted} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => {
                      setMode("edit");
                      setEditId(g.id);
                      setEditNameZh(g.nameZh);
                      setEditNameEn(g.nameEn);
                      setEditColor(g.color);
                      setEditBuiltin(g.builtin);
                      setEditSortOrder(g.sortOrder);
                      setBrandKeywords(g.brandKeywords.map((keyword) => ({ ...keyword })));
                      setNewKeywordZh("");
                      setNewKeywordEn("");
                    }} style={{ padding: 6, backgroundColor: colors.primary + "15", borderRadius: 8 }}>
                      <IconSymbol name="pencil" size={14} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => {
                      const groupName = getSpiritGroupDisplayName(g);
                      Alert.alert("删除集团", `删除「${groupName}」后，已手动归属的酒款和采购记录会恢复为未分配；历史金额不会删除。确认继续？`, [
                        { text: "取消", style: "cancel" },
                        { text: "删除", style: "destructive", onPress: () => { onDelete(g.id); } },
                      ]);
                    }} style={{ padding: 6, backgroundColor: "#EF444415", borderRadius: 8 }}>
                      <IconSymbol name="trash" size={14} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              // 编辑表单
              <>
                {/* 关联集团名称：中文作为主展示，英文作为关联副名称。 */}
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>中文名</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
                    color: colors.foreground, backgroundColor: colors.surface, fontSize: 14, marginBottom: 10 }}
                  value={editNameZh}
                  onChangeText={setEditNameZh}
                  placeholder="如：保乐力加"
                  placeholderTextColor={colors.muted}
                />
                <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>英文名</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12,
                    color: colors.foreground, backgroundColor: colors.surface, fontSize: 14, marginBottom: 16 }}
                  value={editNameEn}
                  onChangeText={setEditNameEn}
                  placeholder="e.g. Pernod Ricard"
                  autoCapitalize="words"
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
                {/* 每一条品牌关键词同时保存中文和英文，绝不再拆成两份无关联数组。 */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>品牌关键词（{brandKeywords.length} 条）</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>中文主名 · 英文副名</Text>
                </View>
                {brandKeywords.map((keyword, index) => (
                  <View key={keyword.id} style={{ padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: editColor }}>品牌关键词 {index + 1}</Text>
                      <TouchableOpacity onPress={() => removeBrandKeyword(keyword.id)} accessibilityLabel={`删除品牌关键词 ${index + 1}`} style={{ padding: 4 }}>
                        <IconSymbol name="trash" size={14} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.background, fontSize: 14, marginBottom: 7 }}
                      value={keyword.nameZh}
                      onChangeText={(nameZh) => updateBrandKeyword(keyword.id, { nameZh })}
                      placeholder="中文名，例如：芝华士"
                      placeholderTextColor={colors.muted}
                    />
                    <TextInput
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.background, fontSize: 14 }}
                      value={keyword.nameEn}
                      onChangeText={(nameEn) => updateBrandKeyword(keyword.id, { nameEn })}
                      placeholder="英文名，例如：Chivas"
                      autoCapitalize="words"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                ))}
                <View style={{ padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: editColor + "55", borderRadius: 12, backgroundColor: editColor + "0d", marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: editColor, marginBottom: 8 }}>新增品牌关键词</Text>
                  <TextInput
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.surface, fontSize: 14, marginBottom: 7 }}
                    value={newKeywordZh}
                    onChangeText={setNewKeywordZh}
                    placeholder="中文名，例如：芝华士"
                    placeholderTextColor={colors.muted}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput
                      style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, color: colors.foreground, backgroundColor: colors.surface, fontSize: 14 }}
                      value={newKeywordEn}
                      onChangeText={setNewKeywordEn}
                      placeholder="英文名，例如：Chivas"
                      autoCapitalize="words"
                      placeholderTextColor={colors.muted}
                      onSubmitEditing={addBrandKeyword}
                    />
                    <TouchableOpacity onPress={addBrandKeyword} accessibilityLabel="新增成对品牌关键词" style={{ minWidth: 44, paddingHorizontal: 12, backgroundColor: editColor, borderRadius: 9, alignItems: "center", justifyContent: "center" }}>
                      <IconSymbol name="plus" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
                {/* 删除集团：预置和自定义集团都可删除，删除时同步清理悬挂归属。 */}
                {editId && (
                  <TouchableOpacity onPress={() => {
                    const groupName = editNameZh.trim() || editNameEn.trim();
                    Alert.alert("删除集团", `删除「${groupName}」后，已手动归属的酒款和采购记录会恢复为未分配；历史金额不会删除。确认继续？`, [
                      { text: "取消", style: "cancel" },
                      { text: "删除", style: "destructive", onPress: () => { onDelete(editId); onClose(); } },
                    ]);
                  }} style={{ padding: 14, backgroundColor: "#FEF2F2", borderRadius: 12, alignItems: "center",
                    borderWidth: 1, borderColor: "#FECACA", marginTop: 8 }}>
                    <Text style={{ fontSize: 14, color: "#EF4444", fontWeight: "600" }}>删除此集团</Text>
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

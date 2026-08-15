/**
 * 通用进销存基础页面模板
 * 三个子页面：总结（分析对比）/ 库存管理（台账+期初+月结）/ 当月进货（录入+记录）
 * 各品类通过 props 定制颜色、分组方式、特有功能
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { GenericInventoryContextValue, GenericInventoryItem } from "@/lib/inventory-core/store";
import { getCurrentMonth, MonthlySnapshot } from "@/lib/inventory-core/types";
import { MonthlyLedgerRow } from "./MonthlyLedgerSheet";
import { MonthCloseModal } from "./MonthCloseModal";
import { OpeningStockModal } from "./OpeningStockModal";
import { PurchaseEntryModal } from "./PurchaseEntryModal";
import { ItemEditModal, CategoryOption, FieldConfig } from "./ItemEditModal";

type Tab = "summary" | "ledger" | "purchase";

export interface BaseInventoryScreenProps {
  store: GenericInventoryContextValue;
  title: string;
  emoji: string;
  accentColor: string;
  categoryId: string;
  categoryLabel: string;
  /** 备用金关联提示 */
  pettyHint?: string;
  /** 是否显示损耗录入（杯具/餐具） */
  showLoss?: boolean;
  /** 商品分类选项 */
  categoryOptions?: CategoryOption[];
  /** 默认单位 */
  defaultUnit?: string;
  /** 额外字段 */
  extraFields?: FieldConfig[];
  /** 分组标签获取函数 */
  getGroupLabel?: (item: GenericInventoryItem) => string;
  /** Excel 解析函数 */
  parseExcel?: (base64: string) => Promise<{
    items?: Omit<GenericInventoryItem, "id" | "createdAt" | "updatedAt">[];
    error?: string;
  }>;
  /** Excel 格式说明 */
  excelFormatHint?: string;
  /** 自定义渲染额外 Tab 内容 */
  renderExtraTabContent?: (tab: string) => React.ReactNode;
  /** 额外 Tab 定义 */
  extraTabs?: { key: string; label: string }[];
  /** 工作台传入的统一库存月份；未传入时保持独立页面的当前月行为。 */
  month?: string;
  /** 嵌入工作台时隐藏独立页面标题和返回入口。 */
  embedded?: boolean;
}

export function BaseInventoryScreen({
  store, title, emoji, accentColor, categoryId, categoryLabel,
  pettyHint, showLoss = false, categoryOptions, defaultUnit = "个",
  extraFields = [], getGroupLabel, parseExcel, excelFormatHint,
  renderExtraTabContent, extraTabs = [], month, embedded = false,
}: BaseInventoryScreenProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [tab, setTab] = useState<string>("summary");
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<"in" | "out">("in");
  const [preselectedId, setPreselectedId] = useState<string | undefined>();
  const [showMonthClose, setShowMonthClose] = useState(false);
  const [showOpening, setShowOpening] = useState(false);
  const [showEditItem, setShowEditItem] = useState(false);
  const [editingItem, setEditingItem] = useState<GenericInventoryItem | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<Omit<GenericInventoryItem, "id" | "createdAt" | "updatedAt">[]>([]);
  const [showImportPreview, setShowImportPreview] = useState(false);

  const currentMonth = month ?? getCurrentMonth();
  const activeItems = useMemo(() => store.items.filter((i) => i.active), [store.items]);
  const monthPurchases = useMemo(() => store.getMonthPurchases(currentMonth), [store, currentMonth]);
  const monthConsumes = useMemo(() => store.getMonthConsumes(currentMonth), [store, currentMonth]);
  const totalMonthPurchase = useMemo(() => monthPurchases.reduce((s, r) => s + r.totalAmount, 0), [monthPurchases]);
  const totalMonthConsume = useMemo(() => monthConsumes.reduce((s, r) => s + r.totalCost, 0), [monthConsumes]);
  const lastSnapshot = useMemo(() => store.getLastSnapshot(), [store]);

  // 构建台账数据（当月实时）
  const ledgerItems = useMemo(() => {
    return activeItems.map((item) => {
      const opening = store.getOpeningData(item.id, currentMonth);
      const purchases = store.getItemMonthPurchases(item.id, currentMonth);
      const consumes = store.getItemMonthConsumes(item.id, currentMonth);
      const losses = consumes.filter((c) => c.reason === "loss");

      const purchaseQty = purchases.reduce((s, p) => s + p.quantity, 0);
      const purchaseCost = purchases.reduce((s, p) => s + p.totalAmount, 0);
      const consumeQty = consumes.filter((c) => c.reason !== "loss").reduce((s, c) => s + c.quantity, 0);
      const consumeCost = consumes.filter((c) => c.reason !== "loss").reduce((s, c) => s + c.totalCost, 0);
      const lossQty = losses.reduce((s, c) => s + c.quantity, 0);
      const lossCost = losses.reduce((s, c) => s + c.totalCost, 0);

      const closingUnitCost = opening.unitCost > 0 || purchaseCost > 0
        ? ((opening.qty * opening.unitCost + purchaseCost) / Math.max(1, opening.qty + purchaseQty))
        : item.latestCostPrice;
      const closingQty = Math.max(0, opening.qty + purchaseQty - consumeQty - lossQty);

      return {
        itemId: item.id,
        name: item.name,
        nameEn: item.nameEn,
        category: getGroupLabel ? getGroupLabel(item) : item.category,
        spec: item.spec,
        unit: item.unit,
        openingQty: opening.qty,
        openingUnitCost: opening.unitCost,
        openingCost: opening.qty * opening.unitCost,
        purchaseQty,
        purchaseCost,
        consumeQty,
        consumeCost,
        lossQty,
        lossCost,
        closingQty,
        closingUnitCost: Math.round(closingUnitCost * 100) / 100,
        closingCost: Math.round(closingQty * closingUnitCost * 100) / 100,
        notes: "",
      };
    });
  }, [activeItems, store, currentMonth, getGroupLabel]);

  const totalClosingCost = useMemo(() => ledgerItems.reduce((s, i) => s + i.closingCost, 0), [ledgerItems]);
  const totalOpeningCost = useMemo(() => ledgerItems.reduce((s, i) => s + i.openingCost, 0), [ledgerItems]);

  // 按分组展示
  const groupedLedger = useMemo(() => {
    if (!getGroupLabel) return { "": ledgerItems };
    const map: Record<string, typeof ledgerItems> = {};
    ledgerItems.forEach((item) => {
      const g = item.category || "其他";
      if (!map[g]) map[g] = [];
      map[g].push(item);
    });
    return map;
  }, [ledgerItems, getGroupLabel]);

  const handlePickExcel = async () => {
    if (!parseExcel) { Alert.alert("该品类暂不支持 Excel 导入"); return; }
    tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setImportLoading(true);
      const base64 = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
      const { items: parsed, error } = await parseExcel(base64);
      setImportLoading(false);
      if (!parsed?.length) {
        Alert.alert("解析失败", error ?? "未能识别数据，请检查 Excel 格式");
        return;
      }
      setImportPreview(parsed);
      setShowImportPreview(true);
    } catch (e) {
      setImportLoading(false);
      Alert.alert("导入失败", String(e));
    }
  };

  const allTabs: { key: string; label: string }[] = [
    { key: "summary", label: "📊 总结" },
    { key: "ledger", label: "📋 库存管理" },
    { key: "purchase", label: "📦 当月进货" },
    ...extraTabs,
  ];

  return (
    <ScreenContainer edges={embedded ? [] : undefined}>
      {/* 独立路由保留标题与返回；嵌入工作台时由外层统一提供分类与月份导航。 */}
      {!embedded && <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{emoji} {title}</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {parseExcel && (
            <Pressable onPress={handlePickExcel} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <IconSymbol name="arrow.down.doc.fill" size={20} color={accentColor} />
            </Pressable>
          )}
          <Pressable onPress={() => { tap(); setEditingItem(null); setShowEditItem(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="plus" size={22} color={accentColor} />
          </Pressable>
        </View>
      </View>}

      {/* Tab 切换 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        {allTabs.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
            style={[S.tabChip, {
              backgroundColor: tab === t.key ? accentColor : colors.surface,
              borderColor: tab === t.key ? accentColor : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>

        {/* ── 总结 Tab ─────────────────────────────────────────────────────── */}
        {tab === "summary" && (
          <View style={{ gap: 14 }}>
            {/* 本月核心指标卡 */}
            <View style={[S.summaryCard, { backgroundColor: accentColor + "0a", borderColor: accentColor + "22" }]}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: accentColor, marginBottom: 10 }}>
                {currentMonth} 月度概况
              </Text>
              {[
                { label: "品种数量", value: `${activeItems.length} 款`, color: colors.foreground },
                { label: "期初库存成本", value: `¥${totalOpeningCost.toFixed(0)}`, color: colors.muted },
                { label: "本月进货总额", value: `¥${totalMonthPurchase.toFixed(0)}`, color: accentColor },
                { label: "本月消耗成本", value: `¥${totalMonthConsume.toFixed(0)}`, color: colors.warning },
                { label: "期末库存成本", value: `¥${totalClosingCost.toFixed(0)}`, color: colors.foreground },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: row.color }}>{row.value}</Text>
                </View>
              ))}
            </View>

            {/* 与上月对比 */}
            {lastSnapshot && (
              <View style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>
                  与上月对比（{lastSnapshot.month}）
                </Text>
                {[
                  {
                    label: "进货额",
                    cur: totalMonthPurchase,
                    prev: lastSnapshot.totalPurchaseCost,
                  },
                  {
                    label: "消耗成本",
                    cur: totalMonthConsume,
                    prev: lastSnapshot.totalConsumeCost,
                  },
                  {
                    label: "期末库存成本",
                    cur: totalClosingCost,
                    prev: lastSnapshot.totalClosingCost,
                  },
                ].map((row, i) => {
                  const diff = row.cur - row.prev;
                  const pct = row.prev > 0 ? (diff / row.prev) * 100 : 0;
                  const sign = diff > 0 ? "▲" : diff < 0 ? "▼" : "—";
                  const color = diff > 0 ? colors.error : diff < 0 ? colors.success : colors.muted;
                  return (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 13, color: colors.foreground }}>¥{row.cur.toFixed(0)}</Text>
                        <Text style={{ fontSize: 12, color }}>{sign} {Math.abs(pct).toFixed(1)}%</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* 历史月结记录 */}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>历史月结记录</Text>
            {store.snapshots.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>暂无月结记录</Text>
                <TouchableOpacity onPress={() => { tap(); setShowMonthClose(true); }}
                  style={{ marginTop: 10, backgroundColor: accentColor, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>立即月结</Text>
                </TouchableOpacity>
              </View>
            ) : (
              [...store.snapshots].sort((a, b) => b.month.localeCompare(a.month)).map((snap) => (
                <View key={snap.id} style={[S.recordCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{snap.month}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      进货 ¥{snap.totalPurchaseCost.toFixed(0)} · 消耗 ¥{snap.totalConsumeCost.toFixed(0)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: accentColor }}>期末 ¥{snap.totalClosingCost.toFixed(0)}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{snap.items.length} 款</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── 库存管理 Tab ──────────────────────────────────────────────────── */}
        {tab === "ledger" && (
          <View style={{ gap: 10 }}>
            {/* 快捷操作 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, marginBottom: 4 }}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              <TouchableOpacity onPress={() => { tap(); setShowOpening(true); }}
                style={[S.actionBtn, { backgroundColor: accentColor + "15", borderColor: accentColor + "33" }]}>
                <Text style={{ fontSize: 12, color: accentColor, fontWeight: "600" }}>📋 期初录入</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { tap(); setShowMonthClose(true); }}
                style={[S.actionBtn, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "33" }]}>
                <Text style={{ fontSize: 12, color: colors.warning, fontWeight: "600" }}>🔒 月结</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { tap(); setEditingItem(null); setShowEditItem(true); }}
                style={[S.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>+ 新增品类</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* 台账列表 */}
            {activeItems.length === 0 ? (
              <EmptyState emoji={emoji} accentColor={accentColor} excelFormatHint={excelFormatHint} colors={colors} />
            ) : getGroupLabel ? (
              Object.entries(groupedLedger).map(([group, items]) => (
                <View key={group} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: accentColor }} />
                    <Text style={{ fontSize: 14, fontWeight: "700", color: accentColor }}>{group}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>({items.length} 款)</Text>
                  </View>
                  {items.map((item) => (
                    <MonthlyLedgerRow key={item.itemId} item={item} accentColor={accentColor} showLoss={showLoss} />
                  ))}
                </View>
              ))
            ) : (
              ledgerItems.map((item) => (
                <MonthlyLedgerRow key={item.itemId} item={item} accentColor={accentColor} showLoss={showLoss} />
              ))
            )}
          </View>
        )}

        {/* ── 当月进货 Tab ──────────────────────────────────────────────────── */}
        {tab === "purchase" && (
          <View style={{ gap: 10 }}>
            {/* 录入按钮 */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
              <TouchableOpacity onPress={() => { tap(); setPurchaseMode("in"); setPreselectedId(undefined); setShowPurchase(true); }}
                style={[S.bigBtn, { backgroundColor: accentColor }]}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>+ 录入进货</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { tap(); setPurchaseMode("out"); setPreselectedId(undefined); setShowPurchase(true); }}
                style={[S.bigBtn, { backgroundColor: colors.error }]}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>- 录入出库</Text>
              </TouchableOpacity>
            </View>

            {/* 当月进货汇总 */}
            <View style={[S.summaryCard, { backgroundColor: accentColor + "0a", borderColor: accentColor + "22" }]}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: accentColor, marginBottom: 6 }}>
                {currentMonth} 进货汇总
              </Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>进货笔数</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: accentColor }}>{monthPurchases.length}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: colors.border }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>进货总额</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: accentColor }}>¥{totalMonthPurchase.toFixed(0)}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: colors.border }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>出库笔数</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.error }}>{monthConsumes.length}</Text>
                </View>
              </View>
              {pettyHint && (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
                  💡 备用金关联：{pettyHint}
                </Text>
              )}
            </View>

            {/* 进货记录列表 */}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>本月进货记录（{monthPurchases.length} 笔）</Text>
            {monthPurchases.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>本月暂无进货记录</Text>
                <TouchableOpacity onPress={() => { tap(); setPurchaseMode("in"); setShowPurchase(true); }}
                  style={{ marginTop: 10, backgroundColor: accentColor, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>立即录入进货</Text>
                </TouchableOpacity>
              </View>
            ) : (
              monthPurchases.map((r) => (
                <View key={r.id} style={[S.recordCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{r.itemName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{r.date} · {r.supplier || "自采"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: accentColor }}>+{r.quantity}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>¥{r.totalAmount.toFixed(2)}</Text>
                  </View>
                </View>
              ))
            )}

            {/* 出库记录列表 */}
            {monthConsumes.length > 0 && (
              <>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginTop: 8 }}>本月出库记录（{monthConsumes.length} 笔）</Text>
                {monthConsumes.map((r) => (
                  <View key={r.id} style={[S.recordCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{r.itemName}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {r.date} · {r.reason === "loss" ? "损耗" : r.reason === "adjust" ? "盘点调整" : "消耗"}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.error }}>-{r.quantity}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>¥{r.totalCost.toFixed(2)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* 额外 Tab */}
        {extraTabs.map((t) => tab === t.key && renderExtraTabContent ? renderExtraTabContent(t.key) : null)}
      </ScrollView>

      {/* Modals */}
      <PurchaseEntryModal visible={showPurchase} onClose={() => setShowPurchase(false)}
        store={store} accentColor={accentColor} pettyHint={pettyHint}
        preselectedItemId={preselectedId} mode={purchaseMode} />

      <MonthCloseModal visible={showMonthClose} onClose={() => setShowMonthClose(false)}
        store={store} categoryId={categoryId} categoryLabel={categoryLabel}
        accentColor={accentColor} showLoss={showLoss} getCategoryLabel={getGroupLabel} />

      <OpeningStockModal visible={showOpening} onClose={() => setShowOpening(false)}
        store={store} categoryLabel={categoryLabel} accentColor={accentColor} />

      <ItemEditModal visible={showEditItem} onClose={() => setShowEditItem(false)}
        item={editingItem} accentColor={accentColor} categoryLabel={categoryLabel}
        categoryOptions={categoryOptions} defaultUnit={defaultUnit} extraFields={extraFields}
        onSave={(data) => {
          if (editingItem) store.updateItem(editingItem.id, data);
          else store.addItem(data);
        }} />

      {/* Excel 导入预览 */}
      {showImportPreview && (
        <View style={[S.importOverlay, { backgroundColor: colors.background }]}>
          <View style={[S.importHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowImportPreview(false)}><Text style={{ color: colors.error, fontSize: 17 }}>取消</Text></Pressable>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>导入预览（{importPreview.length} 款）</Text>
            <Pressable onPress={() => {
              importPreview.forEach((item) => store.addItem(item));
              setShowImportPreview(false);
              Alert.alert("导入成功", `已导入 ${importPreview.length} 款商品`);
            }}>
              <Text style={{ color: accentColor, fontSize: 17, fontWeight: "600" }}>确认导入</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {importPreview.map((item, i) => (
              <View key={i} style={[S.recordCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {item.category} · {item.spec} · 库存 {item.currentStock}{item.unit} · ¥{item.latestCostPrice}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {importLoading && (
        <View style={[S.loadingOverlay, { backgroundColor: colors.background + "cc" }]}>
          <Text style={{ fontSize: 14, color: colors.foreground }}>正在解析 Excel...</Text>
        </View>
      )}
    </ScreenContainer>
  );
}

function EmptyState({ emoji, accentColor, excelFormatHint, colors }: any) {
  return (
    <View>
      <View style={{ alignItems: "center", padding: 40 }}>
        <Text style={{ fontSize: 48 }}>{emoji}</Text>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有商品档案</Text>
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
          点击右上角 + 手动添加，或点击 ↓ 图标导入 Excel
        </Text>
      </View>
      {excelFormatHint && (
        <View style={{ borderRadius: 10, borderWidth: 1, padding: 12, borderColor: accentColor + "33", backgroundColor: accentColor + "08" }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: accentColor, marginBottom: 4 }}>📋 Excel 导入格式（第一行为表头）</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{excelFormatHint}</Text>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  actionBtn: { flexShrink: 0, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  bigBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  recordCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, gap: 10 },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  importOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  importHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  loadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});

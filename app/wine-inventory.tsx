/**
 * 葡萄酒进销存管理页
 * - 台账视图：完整的 产品序号/酒类/供应商/中文名/期初/进货/消耗/期末 表格
 * - 供应商视图：按供应商分组，显示各供应商进货额 + 累计进货
 * - 进货录入：选择供应商 → 填写进货数量
 * - 进货汇总：本月各供应商进货明细
 */
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useWineStore, useWineSnapshotStore, useWineManualPurchaseStore } from "@/lib/wine/store";
import { WineInventoryItem, WineManualPurchase } from "@/lib/wine/types";

type ViewTab = "ledger" | "supplier" | "purchase" | "summary";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "ledger", label: "台账" },
  { key: "supplier", label: "供应商" },
  { key: "purchase", label: "进货录入" },
  { key: "summary", label: "汇总" },
];

// ─── 台账行 ──────────────────────────────────────────────────────────────────
function LedgerRow({ item, colors }: { item: WineInventoryItem; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => setExpanded(!expanded)}
      style={[S.ledgerRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
      activeOpacity={0.75}
    >
      {/* 主行 */}
      <View style={S.ledgerMain}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[S.ledgerSeq, { color: colors.muted }]}>#{item.seq}</Text>
            <View style={[S.typeTag, { backgroundColor: typeColor(item.wineType) + "22" }]}>
              <Text style={[S.typeTagText, { color: typeColor(item.wineType) }]}>{item.wineType}</Text>
            </View>
          </View>
          <Text style={[S.ledgerName, { color: colors.foreground }]} numberOfLines={expanded ? undefined : 1}>
            {item.name}
          </Text>
          <Text style={[S.ledgerSupplier, { color: colors.muted }]}>{item.supplier}</Text>
        </View>
        {/* 关键数字 */}
        <View style={S.ledgerNums}>
          <NumCell label="期末" value={item.endQty} unit="瓶" color={item.endQty > 0 ? colors.success : colors.muted} />
          <NumCell label="进货" value={item.purchaseQty} unit="瓶" color={item.purchaseQty > 0 ? colors.primary : colors.muted} />
          <NumCell label="消耗" value={item.consumeBottles} unit="瓶" color={item.consumeBottles > 0 ? colors.warning : colors.muted} />
        </View>
      </View>
      {/* 展开详情 */}
      {expanded && (
        <View style={[S.ledgerDetail, { borderTopColor: colors.border }]}>
          <DetailRow label="期初单位成本" value={`¥${item.initUnitCost}`} colors={colors} />
          <DetailRow label="期初库存量" value={`${item.initQty} 瓶`} colors={colors} />
          <DetailRow label="期初库存成本" value={`¥${item.initCost}`} colors={colors} />
          <DetailRow label="本月进货量" value={`${item.purchaseQty} 瓶`} colors={colors} />
          <DetailRow label="本月进货成本" value={`¥${item.purchaseCost}`} colors={colors} />
          <DetailRow label="期末库存量" value={`${item.endQty} 瓶`} colors={colors} />
          <DetailRow label="期末单位成本" value={`¥${item.unitCost}`} colors={colors} />
          <DetailRow label="期末库存成本" value={`¥${item.endCost}`} colors={colors} />
          <DetailRow label="消耗瓶数" value={`${item.consumeBottles} 瓶`} colors={colors} />
          <DetailRow label="本期消耗量" value={`¥${item.consumeQty}`} colors={colors} />
        </View>
      )}
    </TouchableOpacity>
  );
}

function NumCell({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={{ alignItems: "center", minWidth: 44 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color }}>{value}</Text>
      <Text style={{ fontSize: 10, color, opacity: 0.7 }}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={S.detailRow}>
      <Text style={[S.detailLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[S.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function typeColor(type: string): string {
  if (!type) return "#687076";
  const t = type.toLowerCase();
  if (t.includes("red")) return "#EF4444";
  if (t.includes("white")) return "#F59E0B";
  if (t.includes("rose") || t.includes("rosé")) return "#EC4899";
  if (t.includes("sparkling") || t.includes("prosecco")) return "#8B5CF6";
  if (t.includes("natural")) return "#22C55E";
  return "#0a7ea4";
}

// ─── 供应商卡片 ───────────────────────────────────────────────────────────────
function SupplierCard({
  supplier, items, monthPurchase, cumulativePurchase, colors, onFilter
}: {
  supplier: string;
  items: WineInventoryItem[];
  monthPurchase: number;
  cumulativePurchase: number;
  colors: any;
  onFilter: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const endQty = items.reduce((s, i) => s + i.endQty, 0);
  const consumeBottles = items.reduce((s, i) => s + i.consumeBottles, 0);

  return (
    <View style={[S.supplierCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.8}>
        <View style={S.supplierHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[S.supplierName, { color: colors.foreground }]}>{supplier}</Text>
            <Text style={[S.supplierMeta, { color: colors.muted }]}>
              {items.length} 款 · 期末库存 {endQty} 瓶 · 本月消耗 {consumeBottles} 瓶
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            {monthPurchase > 0 && (
              <Text style={[S.supplierAmount, { color: colors.primary }]}>本月 ¥{monthPurchase.toFixed(0)}</Text>
            )}
            {cumulativePurchase > 0 && (
              <Text style={[S.supplierCumul, { color: colors.muted }]}>累计 ¥{cumulativePurchase.toFixed(0)}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* 进货录入入口 */}
      <TouchableOpacity onPress={onFilter} style={[S.supplierEntryBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "0e" }]}>
        <IconSymbol name="square.and.pencil" size={13} color={colors.primary} />
        <Text style={[S.supplierEntryText, { color: colors.primary }]}>录入 {supplier} 进货数量</Text>
      </TouchableOpacity>

      {/* 展开酒款列表 */}
      {expanded && (
        <View style={[S.supplierItems, { borderTopColor: colors.border }]}>
          {items.map((item) => (
            <View key={item.seq} style={[S.supplierItemRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.supplierItemName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[S.supplierItemMeta, { color: colors.muted }]}>
                  {item.wineType} · ¥{item.unitCost}/瓶
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: item.endQty > 0 ? colors.success : colors.muted }}>
                  期末 {item.endQty} 瓶
                </Text>
                {item.purchaseQty > 0 && (
                  <Text style={{ fontSize: 11, color: colors.primary }}>本月进 {item.purchaseQty} 瓶</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── 进货录入 Sheet ───────────────────────────────────────────────────────────
function PurchaseEntrySheet({
  visible, supplier, items, colors, onClose, onSave
}: {
  visible: boolean;
  supplier: string;
  items: WineInventoryItem[];
  colors: any;
  onClose: () => void;
  onSave: (entries: { item: WineInventoryItem; qty: number; unitPrice: number }[]) => void;
}) {
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [prices, setPrices] = useState<Record<number, string>>({});

  const handleSave = () => {
    const entries = items
      .filter((item) => Number(qtys[item.seq] || 0) > 0)
      .map((item) => ({
        item,
        qty: Number(qtys[item.seq] || 0),
        unitPrice: Number(prices[item.seq] || item.unitCost || 0),
      }));
    if (entries.length === 0) { Alert.alert("请至少填写一款酒的进货数量"); return; }
    onSave(entries);
    setQtys({}); setPrices({});
    onClose();
  };

  const total = items.reduce((s, item) => {
    const qty = Number(qtys[item.seq] || 0);
    const price = Number(prices[item.seq] || item.unitCost || 0);
    return s + qty * price;
  }, 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[S.sheet, { backgroundColor: colors.background }]}>
        <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={[S.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>录入进货</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{supplier}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={[S.sheetDone, { color: colors.primary }]}>保存</Text></Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* 合计 */}
          {total > 0 && (
            <View style={[S.totalBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
              <Text style={[S.totalText, { color: colors.primary }]}>本次进货合计：¥{total.toFixed(2)}</Text>
            </View>
          )}

          {items.map((item) => (
            <View key={item.seq} style={[S.entryRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={{ marginBottom: 8 }}>
                <Text style={[S.entryName, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
                <Text style={[S.entryMeta, { color: colors.muted }]}>
                  {item.wineType} · 参考价 ¥{item.unitCost}/瓶 · 期末库存 {item.endQty} 瓶
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[S.entryFieldLabel, { color: colors.muted }]}>进货数量（瓶）</Text>
                  <TextInput
                    value={qtys[item.seq] || ""}
                    onChangeText={(v) => setQtys((prev) => ({ ...prev, [item.seq]: v }))}
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.entryFieldLabel, { color: colors.muted }]}>单价（元）</Text>
                  <TextInput
                    value={prices[item.seq] || ""}
                    onChangeText={(v) => setPrices((prev) => ({ ...prev, [item.seq]: v }))}
                    placeholder={String(item.unitCost || "")}
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                  />
                </View>
              </View>
              {Number(qtys[item.seq] || 0) > 0 && (
                <Text style={[S.entrySubtotal, { color: colors.primary }]}>
                  小计 ¥{(Number(qtys[item.seq]) * Number(prices[item.seq] || item.unitCost || 0)).toFixed(2)}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function WineInventoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { snapshots, addSnapshot } = useWineSnapshotStore();
  const { purchases, addManualPurchase } = useWineManualPurchaseStore();

  const [viewTab, setViewTab] = useState<ViewTab>("ledger");
  const [filterSupplier, setFilterSupplier] = useState<string | null>(null);
  const [showPurchaseSheet, setShowPurchaseSheet] = useState(false);
  const [activeSupplierForEntry, setActiveSupplierForEntry] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  // 最新快照
  const latestSnapshot = snapshots[0] ?? null;
  const items: WineInventoryItem[] = latestSnapshot?.items ?? [];

  // 所有供应商
  const allSuppliers = useMemo(
    () => Array.from(new Set(items.map((i) => i.supplier))).sort(),
    [items]
  );

  // 按供应商分组
  const bySupplier = useMemo(() => {
    const map = new Map<string, WineInventoryItem[]>();
    items.forEach((item) => {
      if (!map.has(item.supplier)) map.set(item.supplier, []);
      map.get(item.supplier)!.push(item);
    });
    return map;
  }, [items]);

  // 供应商进货额（本月）
  const supplierMonthTotals = latestSnapshot?.supplierTotals ?? {};

  // 供应商累计进货（跨所有快照）
  const supplierCumulTotals = useMemo(() => {
    const map: Record<string, number> = {};
    snapshots.forEach((snap) => {
      Object.entries(snap.supplierTotals).forEach(([sup, amt]) => {
        map[sup] = (map[sup] ?? 0) + amt;
      });
    });
    // 加上手动进货
    purchases.forEach((p) => {
      map[p.supplier] = (map[p.supplier] ?? 0) + p.amount;
    });
    return map;
  }, [snapshots, purchases]);

  // 台账筛选
  const filteredItems = useMemo(() => {
    let list = items;
    if (filterSupplier) list = list.filter((i) => i.supplier === filterSupplier);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q) || i.wineType.toLowerCase().includes(q));
    }
    return list;
  }, [items, filterSupplier, searchQuery]);

  // 本月进货汇总（手动 + 快照）
  const thisMonthPurchases = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return purchases.filter((p) => p.date.startsWith(prefix));
  }, [purchases]);

  // 台账统计
  const ledgerStats = useMemo(() => ({
    totalEndQty: items.reduce((s, i) => s + i.endQty, 0),
    totalEndCost: items.reduce((s, i) => s + i.endCost, 0),
    totalPurchaseCost: items.reduce((s, i) => s + i.purchaseCost, 0),
    totalConsumeCost: items.reduce((s, i) => s + i.consumeQty, 0),
    totalConsumeBottles: items.reduce((s, i) => s + i.consumeBottles, 0),
  }), [items]);

  const handlePurchaseEntry = (supplier: string) => {
    tap();
    setActiveSupplierForEntry(supplier);
    setShowPurchaseSheet(true);
  };

  const handleSavePurchase = (entries: { item: WineInventoryItem; qty: number; unitPrice: number }[]) => {
    const today = new Date().toISOString().slice(0, 10);
    entries.forEach(({ item, qty, unitPrice }) => {
      addManualPurchase({
        date: today,
        supplier: item.supplier,
        bottleId: null,
        productName: item.name,
        unitPrice,
        quantity: qty,
        amount: qty * unitPrice,
        notes: "",
      });
    });
    const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);
    Alert.alert("进货已记录", `${activeSupplierForEntry} 共 ${entries.length} 款，合计 ¥${total.toFixed(2)}`);
  };

  const activeSupplierItems = useMemo(
    () => (bySupplier.get(activeSupplierForEntry) ?? []),
    [bySupplier, activeSupplierForEntry]
  );

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>
          葡萄酒进销存{latestSnapshot ? ` · ${latestSnapshot.monthLabel}` : ""}
        </Text>
        <Pressable onPress={() => { tap(); router.push("/wine-inventory-import" as any); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="square.and.arrow.down.fill" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {/* Tab 切换 */}
      <View style={[S.tabBar, { backgroundColor: colors.border + "33" }]}>
        {VIEW_TABS.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => { tap(); setViewTab(t.key); }}
            style={[S.tabBtn, viewTab === t.key && { backgroundColor: colors.background }]}>
            <Text style={[S.tabText, { color: viewTab === t.key ? colors.foreground : colors.muted, fontWeight: viewTab === t.key ? "600" : "400" }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 无数据提示 */}
      {items.length === 0 && (
        <View style={S.emptyWrap}>
          <IconSymbol name="tray.2.fill" size={48} color={colors.border} />
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无进销存数据</Text>
          <Text style={[S.emptyDesc, { color: colors.muted }]}>点击右上角导入按钮，上传葡萄酒盘点 Excel</Text>
          <Pressable onPress={() => { tap(); router.push("/wine-inventory-import" as any); }}
            style={[S.importBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="square.and.arrow.down.fill" size={16} color="#fff" />
            <Text style={S.importBtnText}>导入 Excel</Text>
          </Pressable>
        </View>
      )}

      {/* ── 台账视图 ── */}
      {viewTab === "ledger" && items.length > 0 && (
        <>
          {/* 统计卡片 */}
          <View style={[S.statsRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <StatCell label="期末库存" value={`${ledgerStats.totalEndQty}瓶`} color={colors.foreground} />
            <StatCell label="期末成本" value={`¥${ledgerStats.totalEndCost.toFixed(0)}`} color={colors.foreground} />
            <StatCell label="本月进货" value={`¥${ledgerStats.totalPurchaseCost.toFixed(0)}`} color={colors.primary} />
            <StatCell label="本月消耗" value={`${ledgerStats.totalConsumeBottles}瓶`} color={colors.warning} />
          </View>
          {/* 供应商筛选 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[S.filterScroll, { borderBottomColor: colors.border }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            <TouchableOpacity onPress={() => setFilterSupplier(null)}
              style={[S.filterChip, { backgroundColor: !filterSupplier ? colors.primary : colors.surface, borderColor: !filterSupplier ? colors.primary : colors.border }]}>
              <Text style={[S.filterChipText, { color: !filterSupplier ? "#fff" : colors.muted }]}>全部</Text>
            </TouchableOpacity>
            {allSuppliers.map((s) => (
              <TouchableOpacity key={s} onPress={() => setFilterSupplier(filterSupplier === s ? null : s)}
                style={[S.filterChip, { backgroundColor: filterSupplier === s ? colors.primary : colors.surface, borderColor: filterSupplier === s ? colors.primary : colors.border }]}>
                <Text style={[S.filterChipText, { color: filterSupplier === s ? "#fff" : colors.muted }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* 搜索 */}
          <View style={[S.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16, marginVertical: 8 }]}>
            <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
            <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索酒名…" placeholderTextColor={colors.muted}
              style={[S.searchInput, { color: colors.foreground }]} returnKeyType="search" />
          </View>
          <FlatList
            data={filteredItems}
            keyExtractor={(i) => String(i.seq)}
            renderItem={({ item }) => <LedgerRow item={item} colors={colors} />}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          />
        </>
      )}

      {/* ── 供应商视图 ── */}
      {viewTab === "supplier" && items.length > 0 && (
        <FlatList
          data={Array.from(bySupplier.entries()).sort((a, b) => (supplierMonthTotals[b[0]] ?? 0) - (supplierMonthTotals[a[0]] ?? 0))}
          keyExtractor={([sup]) => sup}
          renderItem={({ item: [sup, supItems] }) => (
            <SupplierCard
              supplier={sup}
              items={supItems}
              monthPurchase={supplierMonthTotals[sup] ?? 0}
              cumulativePurchase={supplierCumulTotals[sup] ?? 0}
              colors={colors}
              onFilter={() => handlePurchaseEntry(sup)}
            />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          ListHeaderComponent={
            <View style={[S.supplierSummaryCard, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
              <Text style={[S.supplierSummaryTitle, { color: colors.primary }]}>供应商累计进货</Text>
              {Object.entries(supplierCumulTotals).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
                <View key={sup} style={S.supplierSummaryRow}>
                  <Text style={[S.supplierSummaryName, { color: colors.foreground }]}>{sup}</Text>
                  <Text style={[S.supplierSummaryAmt, { color: colors.primary }]}>¥{amt.toFixed(0)}</Text>
                </View>
              ))}
            </View>
          }
        />
      )}

      {/* ── 进货录入视图 ── */}
      {viewTab === "purchase" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>选择供应商录入进货</Text>
          {allSuppliers.map((sup) => (
            <TouchableOpacity key={sup} onPress={() => handlePurchaseEntry(sup)}
              style={[S.purchaseEntryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.purchaseEntryName, { color: colors.foreground }]}>{sup}</Text>
                <Text style={[S.purchaseEntryMeta, { color: colors.muted }]}>
                  {bySupplier.get(sup)?.length ?? 0} 款 · 本月进货 ¥{(supplierMonthTotals[sup] ?? 0).toFixed(0)}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </TouchableOpacity>
          ))}
          {allSuppliers.length === 0 && (
            <Text style={[S.emptyDesc, { color: colors.muted, textAlign: "center", marginTop: 40 }]}>请先导入 Excel 数据</Text>
          )}
        </ScrollView>
      )}

      {/* ── 汇总视图 ── */}
      {viewTab === "summary" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {/* 快照历史 */}
          <Text style={[S.sectionTitle, { color: colors.muted }]}>月度快照（{snapshots.length} 份）</Text>
          {snapshots.map((snap) => (
            <View key={snap.id} style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.summaryCardHeader}>
                <Text style={[S.summaryCardTitle, { color: colors.foreground }]}>{snap.monthLabel}</Text>
                <Text style={[S.summaryCardDate, { color: colors.muted }]}>{snap.importedAt.slice(0, 10)}</Text>
              </View>
              <View style={S.summaryCardStats}>
                <SummaryStatCell label="月进货" value={`¥${snap.totalPurchase.toFixed(0)}`} color={colors.primary} />
                <SummaryStatCell label="月消耗" value={`¥${snap.totalConsume.toFixed(0)}`} color={colors.warning} />
                <SummaryStatCell label="期末成本" value={`¥${snap.totalEndCost.toFixed(0)}`} color={colors.foreground} />
              </View>
              {/* 供应商明细 */}
              {Object.entries(snap.supplierTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
                <View key={sup} style={[S.summarySupRow, { borderTopColor: colors.border }]}>
                  <Text style={[S.summarySupName, { color: colors.muted }]}>{sup}</Text>
                  <Text style={[S.summarySupAmt, { color: colors.primary }]}>¥{amt.toFixed(0)}</Text>
                </View>
              ))}
              <Pressable onPress={() => Alert.alert("删除快照", `确认删除「${snap.monthLabel}」的快照？`, [
                { text: "取消", style: "cancel" },
                { text: "删除", style: "destructive", onPress: () => {} }
              ])} style={S.deleteSnap}>
                <Text style={{ color: colors.error, fontSize: 12 }}>删除此快照</Text>
              </Pressable>
            </View>
          ))}
          {snapshots.length === 0 && (
            <Text style={[S.emptyDesc, { color: colors.muted, textAlign: "center", marginTop: 20 }]}>暂无月度快照，请先导入 Excel</Text>
          )}

          {/* 手动进货记录 */}
          {thisMonthPurchases.length > 0 && (
            <>
              <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 20 }]}>本月手动进货（{thisMonthPurchases.length} 条）</Text>
              {thisMonthPurchases.map((p) => (
                <View key={p.id} style={[S.manualRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.manualName, { color: colors.foreground }]} numberOfLines={1}>{p.productName}</Text>
                    <Text style={[S.manualMeta, { color: colors.muted }]}>{p.supplier} · {p.date} · {p.quantity}瓶 × ¥{p.unitPrice}</Text>
                  </View>
                  <Text style={[S.manualAmt, { color: colors.primary }]}>¥{p.amount.toFixed(0)}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* 进货录入 Sheet */}
      <PurchaseEntrySheet
        visible={showPurchaseSheet}
        supplier={activeSupplierForEntry}
        items={activeSupplierItems}
        colors={colors}
        onClose={() => setShowPurchaseSheet(false)}
        onSave={handleSavePurchase}
      />
    </ScreenContainer>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color }}>{value}</Text>
      <Text style={{ fontSize: 11, color, opacity: 0.6, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function SummaryStatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color }}>{value}</Text>
      <Text style={{ fontSize: 11, color: "#687076", marginTop: 1 }}>{label}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  tabBar: { flexDirection: "row", margin: 12, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  filterScroll: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontWeight: "500" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 19 },
  ledgerRow: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  ledgerMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  ledgerSeq: { fontSize: 11, fontWeight: "600" },
  typeTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeTagText: { fontSize: 10, fontWeight: "700" },
  ledgerName: { fontSize: 14, fontWeight: "600", lineHeight: 20, marginTop: 2 },
  ledgerSupplier: { fontSize: 11, marginTop: 1 },
  ledgerNums: { flexDirection: "row", gap: 8 },
  ledgerDetail: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12, fontWeight: "500" },
  supplierCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  supplierHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  supplierName: { fontSize: 16, fontWeight: "700" },
  supplierMeta: { fontSize: 12, marginTop: 2 },
  supplierAmount: { fontSize: 15, fontWeight: "700" },
  supplierCumul: { fontSize: 12 },
  supplierEntryBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  supplierEntryText: { fontSize: 13, fontWeight: "500" },
  supplierItems: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  supplierItemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  supplierItemName: { fontSize: 13, fontWeight: "500" },
  supplierItemMeta: { fontSize: 11, marginTop: 1 },
  supplierSummaryCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  supplierSummaryTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  supplierSummaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  supplierSummaryName: { fontSize: 13 },
  supplierSummaryAmt: { fontSize: 13, fontWeight: "600" },
  purchaseEntryCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  purchaseEntryName: { fontSize: 15, fontWeight: "600" },
  purchaseEntryMeta: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  summaryCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  summaryCardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryCardTitle: { fontSize: 16, fontWeight: "700" },
  summaryCardDate: { fontSize: 12 },
  summaryCardStats: { flexDirection: "row", marginBottom: 10 },
  summarySupRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth },
  summarySupName: { fontSize: 13 },
  summarySupAmt: { fontSize: 13, fontWeight: "600" },
  deleteSnap: { marginTop: 8, alignItems: "center", paddingVertical: 6 },
  manualRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  manualName: { fontSize: 13, fontWeight: "500" },
  manualMeta: { fontSize: 11, marginTop: 2 },
  manualAmt: { fontSize: 14, fontWeight: "700" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
  importBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  importBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  totalBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12, alignItems: "center" },
  totalText: { fontSize: 15, fontWeight: "700" },
  entryRow: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  entryName: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  entryMeta: { fontSize: 11, marginTop: 2, marginBottom: 8 },
  entryFieldLabel: { fontSize: 11, fontWeight: "500", marginBottom: 4 },
  entryInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  entrySubtotal: { fontSize: 12, fontWeight: "600", marginTop: 6, textAlign: "right" },
});

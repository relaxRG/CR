/**
 * 烈酒进销存管理页
 * - 台账视图：按分类（Base/Gin/Whisky/Liqueur 等）分组，显示增长/减少
 * - 供应商视图：各供应商累计进货金额
 * - 进货录入：筛选供应商 → 填写数量 → 保存/分享
 * - 汇总视图：月度趋势 + 快照历史
 */
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useSpiritsSnapshotStore, useSpiritsManualPurchaseStore } from "@/lib/spirits/store";
import { SpiritInventoryItem, SpiritManualPurchase, SPIRIT_CATEGORY_COLORS } from "@/lib/spirits/types";
import { WineSupplierTrendChart } from "@/components/wine-supplier-trend-chart";

type ViewTab = "ledger" | "supplier" | "purchase" | "summary";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "summary", label: "📊 总结" },
  { key: "ledger", label: "📋 库存管理" },
  { key: "purchase", label: "📦 当月进货" },
  { key: "supplier", label: "🏢 供应商" },
];

// ─── 分类颜色 ─────────────────────────────────────────────────────────────────
function catColor(category: string): string {
  // 提取大类前缀（如 "Base (Whisky)" → "Base"）
  const prefix = category.split(" ")[0].split("(")[0].trim();
  return SPIRIT_CATEGORY_COLORS[prefix] ?? SPIRIT_CATEGORY_COLORS[category] ?? "#6B7280";
}

// ─── 分类分组 ─────────────────────────────────────────────────────────────────
function groupByCategory(items: SpiritInventoryItem[]): Map<string, SpiritInventoryItem[]> {
  const map = new Map<string, SpiritInventoryItem[]>();
  items.forEach((item) => {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  });
  return map;
}

// ─── 台账分类卡片 ─────────────────────────────────────────────────────────────
function CategoryCard({ category, items, colors }: { category: string; items: SpiritInventoryItem[]; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const color = catColor(category);
  const totalEndQty = items.reduce((s, i) => s + i.endQty, 0);
  const totalPurchase = items.reduce((s, i) => s + i.purchaseCost, 0);
  const totalConsume = items.reduce((s, i) => s + i.consumeQty, 0);
  const totalEndCost = items.reduce((s, i) => s + i.endCost, 0);

  // 增长/减少判断（期末 vs 期初）
  const totalInitQty = items.reduce((s, i) => s + i.initQty, 0);
  const qtyDelta = totalEndQty - totalInitQty;
  const deltaColor = qtyDelta > 0 ? colors.success : qtyDelta < 0 ? colors.error : colors.muted;

  return (
    <View style={[S.catCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.8}>
        <View style={S.catHeader}>
          <View style={[S.catDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={[S.catName, { color: colors.foreground }]}>{category}</Text>
            <Text style={[S.catMeta, { color: colors.muted }]}>{items.length} 款</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={[S.catEndQty, { color: colors.foreground }]}>{totalEndQty.toFixed(1)} 瓶</Text>
              {qtyDelta !== 0 && (
                <Text style={{ fontSize: 11, fontWeight: "700", color: deltaColor }}>
                  {qtyDelta > 0 ? `+${qtyDelta.toFixed(1)}` : qtyDelta.toFixed(1)}
                </Text>
              )}
            </View>
            {totalPurchase > 0 && (
              <Text style={[S.catPurchase, { color: colors.primary }]}>进货 ¥{totalPurchase.toFixed(0)}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[S.catItems, { borderTopColor: colors.border }]}>
          {items.map((item) => (
            <View key={item.seq} style={[S.itemRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.itemName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[S.itemMeta, { color: colors.muted }]}>
                  ¥{item.unitCost}/瓶 · 期末 {item.endQty} 瓶
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                {item.purchaseQty > 0 && (
                  <Text style={{ fontSize: 11, color: colors.primary }}>进 {item.purchaseQty} 瓶</Text>
                )}
                {item.consumeBottles > 0 && (
                  <Text style={{ fontSize: 11, color: colors.warning }}>耗 {item.consumeBottles} 瓶</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── 生成进货单文本 ────────────────────────────────────────────────────────────
function buildPurchaseText(
  supplier: string,
  entries: { item: SpiritInventoryItem; qty: number; unitPrice: number }[],
  date: string
): string {
  const lines = [
    `===== 烈酒进货单 =====`,
    `供应商：${supplier}`,
    `日期：${date}`,
    `─────────────────────`,
  ];
  entries.forEach(({ item, qty, unitPrice }, i) => {
    lines.push(`${i + 1}. ${item.name}`);
    lines.push(`   ${item.category} · ${qty} 瓶 × ¥${unitPrice.toFixed(2)} = ¥${(qty * unitPrice).toFixed(2)}`);
  });
  const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);
  lines.push(`─────────────────────`);
  lines.push(`合计：¥${total.toFixed(2)}`);
  lines.push(`共 ${entries.length} 款，${entries.reduce((s, e) => s + e.qty, 0)} 瓶`);
  lines.push(`=====================`);
  return lines.join("\n");
}

// ─── 进货录入 Sheet ───────────────────────────────────────────────────────────
function PurchaseEntrySheet({
  visible, supplier, items, colors, onClose, onSave
}: {
  visible: boolean;
  supplier: string;
  items: SpiritInventoryItem[];
  colors: any;
  onClose: () => void;
  onSave: (entries: { item: SpiritInventoryItem; qty: number; unitPrice: number }[]) => void;
}) {
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [sharing, setSharing] = useState(false);
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }, [items, search]);

  const buildEntries = () =>
    items
      .filter((item) => Number(qtys[item.seq] || 0) > 0)
      .map((item) => ({
        item,
        qty: Number(qtys[item.seq] || 0),
        unitPrice: Number(prices[item.seq] || item.unitCost || 0),
      }));

  const handleSave = () => {
    const entries = buildEntries();
    if (entries.length === 0) { Alert.alert("请至少填写一款酒的进货数量"); return; }
    onSave(entries);
    setQtys({}); setPrices({}); setSearch("");
    onClose();
  };

  const handleSaveAndShare = async () => {
    const entries = buildEntries();
    if (entries.length === 0) { Alert.alert("请至少填写一款酒的进货数量"); return; }
    onSave(entries);
    const today = new Date().toISOString().slice(0, 10);
    const text = buildPurchaseText(supplier, entries, today);
    try {
      setSharing(true);
      const fileUri = (FileSystem.cacheDirectory ?? "") + `spirits_purchase_${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/plain", dialogTitle: `${supplier} 烈酒进货单` });
      } else {
        Alert.alert("进货单", text);
      }
    } catch (e) {
      Alert.alert("分享失败", String(e));
    } finally {
      setSharing(false);
    }
    setQtys({}); setPrices({}); setSearch("");
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

        {/* 搜索框 */}
        <View style={[S.sheetSearch, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="搜索酒名…"
            placeholderTextColor={colors.muted} style={[S.sheetSearchInput, { color: colors.foreground }]} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          {total > 0 && (
            <View style={[S.totalBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
              <Text style={[S.totalText, { color: colors.primary }]}>本次进货合计：¥{total.toFixed(2)}</Text>
            </View>
          )}

          {filteredItems.map((item) => {
            const color = catColor(item.category);
            return (
              <View key={item.seq} style={[S.entryRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <View style={[S.catTagSmall, { backgroundColor: color + "22" }]}>
                      <Text style={[S.catTagSmallText, { color }]} numberOfLines={1}>{item.category}</Text>
                    </View>
                  </View>
                  <Text style={[S.entryName, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
                  <Text style={[S.entryMeta, { color: colors.muted }]}>
                    参考价 ¥{item.unitCost}/瓶 · 期末库存 {item.endQty} 瓶
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.entryFieldLabel, { color: colors.muted }]}>进货数量（瓶）</Text>
                    <TextInput
                      value={qtys[item.seq] || ""}
                      onChangeText={(v) => setQtys((prev) => ({ ...prev, [item.seq]: v }))}
                      placeholder="0" placeholderTextColor={colors.muted} keyboardType="number-pad"
                      style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.entryFieldLabel, { color: colors.muted }]}>单价（元）</Text>
                    <TextInput
                      value={prices[item.seq] || ""}
                      onChangeText={(v) => setPrices((prev) => ({ ...prev, [item.seq]: v }))}
                      placeholder={String(item.unitCost || "")} placeholderTextColor={colors.muted} keyboardType="decimal-pad"
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
            );
          })}
        </ScrollView>

        {/* 底部按钮 */}
        <View style={[S.sheetFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable onPress={handleSave} style={[S.footerBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="checkmark" size={15} color="#fff" />
            <Text style={S.footerBtnText}>保存</Text>
          </Pressable>
          <Pressable onPress={handleSaveAndShare} disabled={sharing}
            style={[S.footerBtn, { backgroundColor: colors.success ?? "#10B981", opacity: sharing ? 0.6 : 1 }]}>
            <IconSymbol name="square.and.arrow.up" size={15} color="#fff" />
            <Text style={S.footerBtnText}>{sharing ? "分享中…" : "保存并分享"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SpiritsInventoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { snapshots, deleteSnapshot } = useSpiritsSnapshotStore();
  const { purchases, addManualPurchase } = useSpiritsManualPurchaseStore();

  const [viewTab, setViewTab] = useState<ViewTab>("ledger");
  const [showPurchaseSheet, setShowPurchaseSheet] = useState(false);
  const [activeSupplier, setActiveSupplier] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  const latestSnapshot = snapshots[0] ?? null;
  const items: SpiritInventoryItem[] = latestSnapshot?.items ?? [];

  // 分类分组
  const byCategory = useMemo(() => groupByCategory(items), [items]);

  // 所有供应商
  const allSuppliers = useMemo(() => {
    const set = new Set<string>();
    snapshots.forEach((snap) => {
      Object.keys(snap.supplierTotals).forEach((s) => set.add(s));
    });
    purchases.forEach((p) => set.add(p.supplier));
    return Array.from(set).sort();
  }, [snapshots, purchases]);

  // 供应商累计进货
  const supplierCumulTotals = useMemo(() => {
    const map: Record<string, number> = {};
    snapshots.forEach((snap) => {
      Object.entries(snap.supplierTotals).forEach(([sup, amt]) => {
        map[sup] = (map[sup] ?? 0) + amt;
      });
    });
    purchases.forEach((p) => { map[p.supplier] = (map[p.supplier] ?? 0) + p.amount; });
    return map;
  }, [snapshots, purchases]);

  // 供应商本月进货
  const supplierMonthTotals = latestSnapshot?.supplierTotals ?? {};

  // 台账统计
  const ledgerStats = useMemo(() => ({
    totalEndQty: items.reduce((s, i) => s + i.endQty, 0),
    totalEndCost: items.reduce((s, i) => s + i.endCost, 0),
    totalPurchaseCost: items.reduce((s, i) => s + i.purchaseCost, 0),
    totalConsumeBottles: items.reduce((s, i) => s + i.consumeBottles, 0),
  }), [items]);

  // 筛选台账
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return Array.from(byCategory.entries());
    const q = searchQuery.toLowerCase();
    return Array.from(byCategory.entries())
      .map(([cat, catItems]) => [
        cat,
        catItems.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)),
      ] as [string, SpiritInventoryItem[]])
      .filter(([, catItems]) => catItems.length > 0);
  }, [byCategory, searchQuery]);

  // 本月手动进货
  const thisMonthPurchases = useMemo(() => {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return purchases.filter((p) => p.date.startsWith(prefix));
  }, [purchases]);

  const handleSavePurchase = (entries: { item: SpiritInventoryItem; qty: number; unitPrice: number }[]) => {
    const today = new Date().toISOString().slice(0, 10);
    entries.forEach(({ item, qty, unitPrice }) => {
      addManualPurchase({
        date: today,
        supplier: activeSupplier,
        bottleId: null,
        productName: item.name,
        unitPrice,
        quantity: qty,
        amount: qty * unitPrice,
        notes: "",
      });
    });
    const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);
    Alert.alert("进货已记录", `${activeSupplier} 共 ${entries.length} 款，合计 ¥${total.toFixed(2)}`);
  };

  const handleDeleteSnapshot = (id: string, label: string) => {
    Alert.alert("删除快照", `确认删除「${label}」的快照？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteSnapshot(id) },
    ]);
  };

  // 将 SpiritMonthlySnapshot 转换为 WineSupplierTrendChart 兼容格式
  const trendSnapshots = useMemo(() =>
    snapshots.map((snap) => ({
      id: snap.id,
      monthLabel: snap.monthLabel,
      importedAt: snap.importedAt,
      items: [],
      purchaseOrders: [],
      supplierTotals: snap.supplierTotals,
      totalPurchase: snap.totalPurchase,
      totalConsume: snap.totalConsume,
      totalEndCost: snap.totalEndCost,
    })),
    [snapshots]
  );

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>
          烈酒进销存{latestSnapshot ? ` · ${latestSnapshot.monthLabel}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => Alert.alert("期初录入", "烈酒进销存的期初数据通过 Excel 导入自动带入（initQty/initUnitCost 字段）。\n\n如需手动调整，请在导入后通过 Excel 重新导入修正后的数据。")} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="calendar.badge.plus" size={20} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => { tap(); router.push("/spirits-inventory-import" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.and.arrow.down.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
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
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无烈酒进销存数据</Text>
          <Text style={[S.emptyDesc, { color: colors.muted }]}>点击右上角导入按钮，上传烈酒盘点 Excel</Text>
          <Pressable onPress={() => { tap(); router.push("/spirits-inventory-import" as any); }}
            style={[S.importBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="square.and.arrow.down.fill" size={16} color="#fff" />
            <Text style={S.importBtnText}>导入 Excel</Text>
          </Pressable>
        </View>
      )}

      {/* ── 台账视图（按分类分组） ── */}
      {viewTab === "ledger" && items.length > 0 && (
        <>
          {/* 统计卡片 */}
          <View style={[S.statsRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <StatCell label="期末库存" value={`${ledgerStats.totalEndQty.toFixed(0)}瓶`} color={colors.foreground} />
            <StatCell label="期末成本" value={`¥${ledgerStats.totalEndCost.toFixed(0)}`} color={colors.foreground} />
            <StatCell label="本月进货" value={`¥${ledgerStats.totalPurchaseCost.toFixed(0)}`} color={colors.primary} />
            <StatCell label="本月消耗" value={`${ledgerStats.totalConsumeBottles.toFixed(0)}瓶`} color={colors.warning} />
          </View>
          {/* 搜索 */}
          <View style={[S.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16, marginVertical: 8 }]}>
            <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
            <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索酒名或分类…"
              placeholderTextColor={colors.muted} style={[S.searchInput, { color: colors.foreground }]} returnKeyType="search" />
          </View>
          <FlatList
            data={filteredCategories}
            keyExtractor={([cat]) => cat}
            renderItem={({ item: [cat, catItems] }) => (
              <CategoryCard category={cat} items={catItems} colors={colors} />
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          />
        </>
      )}

      {/* ── 供应商视图 ── */}
      {viewTab === "supplier" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {/* 供应商累计汇总卡片 */}
          <View style={[S.supplierSummaryCard, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
            <Text style={[S.supplierSummaryTitle, { color: colors.primary }]}>供应商累计进货</Text>
            {Object.entries(supplierCumulTotals).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
              <View key={sup} style={S.supplierSummaryRow}>
                <Text style={[S.supplierSummaryName, { color: colors.foreground }]}>{sup}</Text>
                <Text style={[S.supplierSummaryAmt, { color: colors.primary }]}>¥{amt.toFixed(0)}</Text>
              </View>
            ))}
            {Object.keys(supplierCumulTotals).length === 0 && (
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 8 }}>暂无供应商数据</Text>
            )}
          </View>

          {/* 各供应商本月进货 */}
          {allSuppliers.map((sup) => (
            <TouchableOpacity key={sup}
              onPress={() => { tap(); setActiveSupplier(sup); setShowPurchaseSheet(true); }}
              style={[S.supplierCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.supplierName, { color: colors.foreground }]}>{sup}</Text>
                <Text style={[S.supplierMeta, { color: colors.muted }]}>
                  本月 ¥{(supplierMonthTotals[sup] ?? 0).toFixed(0)} · 累计 ¥{(supplierCumulTotals[sup] ?? 0).toFixed(0)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[S.entryBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "0e" }]}>
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>录入进货</Text>
                </View>
                <IconSymbol name="chevron.right" size={14} color={colors.muted} />
              </View>
            </TouchableOpacity>
          ))}
          {allSuppliers.length === 0 && (
            <Text style={[S.emptyDesc, { color: colors.muted, textAlign: "center", marginTop: 20 }]}>请先导入 Excel 数据</Text>
          )}
        </ScrollView>
      )}

      {/* ── 进货录入视图 ── */}
      {viewTab === "purchase" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>选择供应商录入进货</Text>
          {allSuppliers.map((sup) => (
            <TouchableOpacity key={sup}
              onPress={() => { tap(); setActiveSupplier(sup); setShowPurchaseSheet(true); }}
              style={[S.purchaseEntryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.purchaseEntryName, { color: colors.foreground }]}>{sup}</Text>
                <Text style={[S.purchaseEntryMeta, { color: colors.muted }]}>
                  本月进货 ¥{(supplierMonthTotals[sup] ?? 0).toFixed(0)}
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
          {/* 供应商趋势图 */}
          {snapshots.length >= 1 && (
            <View style={[S.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[S.trendTitle, { color: colors.foreground }]}>供应商月度进货趋势</Text>
              <Text style={[S.trendSubtitle, { color: colors.muted }]}>{snapshots.length} 个月份快照</Text>
              <WineSupplierTrendChart snapshots={trendSnapshots as any} topN={5} />
            </View>
          )}

          {/* 快照历史 */}
          <Text style={[S.sectionTitle, { color: colors.muted, marginTop: snapshots.length >= 1 ? 16 : 0 }]}>
            月度快照（{snapshots.length} 份）
          </Text>
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
              {Object.entries(snap.supplierTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
                <View key={sup} style={[S.summarySupRow, { borderTopColor: colors.border }]}>
                  <Text style={[S.summarySupName, { color: colors.muted }]}>{sup}</Text>
                  <Text style={[S.summarySupAmt, { color: colors.primary }]}>¥{amt.toFixed(0)}</Text>
                </View>
              ))}
              <Pressable onPress={() => handleDeleteSnapshot(snap.id, snap.monthLabel)} style={S.deleteSnap}>
                <Text style={{ color: colors.error, fontSize: 12 }}>删除此快照</Text>
              </Pressable>
            </View>
          ))}
          {snapshots.length === 0 && (
            <Text style={[S.emptyDesc, { color: colors.muted, textAlign: "center", marginTop: 20 }]}>暂无月度快照，请先导入 Excel</Text>
          )}

          {/* 本月手动进货 */}
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
        supplier={activeSupplier}
        items={items}
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
      <Text style={{ fontSize: 14, fontWeight: "700", color }}>{value}</Text>
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
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 19 },
  catCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  catHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catName: { fontSize: 14, fontWeight: "600" },
  catMeta: { fontSize: 11, marginTop: 1 },
  catEndQty: { fontSize: 14, fontWeight: "700" },
  catPurchase: { fontSize: 11, fontWeight: "500" },
  catItems: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  itemName: { fontSize: 13, fontWeight: "500" },
  itemMeta: { fontSize: 11, marginTop: 1 },
  supplierSummaryCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  supplierSummaryTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  supplierSummaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  supplierSummaryName: { fontSize: 13 },
  supplierSummaryAmt: { fontSize: 13, fontWeight: "600" },
  supplierCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  supplierName: { fontSize: 15, fontWeight: "600" },
  supplierMeta: { fontSize: 12, marginTop: 2 },
  entryBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  purchaseEntryCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  purchaseEntryName: { fontSize: 15, fontWeight: "600" },
  purchaseEntryMeta: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  trendCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 4 },
  trendTitle: { fontSize: 15, fontWeight: "700" },
  trendSubtitle: { fontSize: 11, marginTop: 2, marginBottom: 4 },
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
  sheetSearch: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 10, paddingVertical: 7 },
  sheetSearchInput: { flex: 1, fontSize: 14 },
  sheetFooter: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  footerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12 },
  footerBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  totalBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12, alignItems: "center" },
  totalText: { fontSize: 15, fontWeight: "700" },
  entryRow: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  entryName: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  entryMeta: { fontSize: 11, marginTop: 2, marginBottom: 8 },
  entryFieldLabel: { fontSize: 11, fontWeight: "500", marginBottom: 4 },
  entryInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  entrySubtotal: { fontSize: 12, fontWeight: "600", marginTop: 6, textAlign: "right" },
  catTagSmall: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  catTagSmallText: { fontSize: 9, fontWeight: "700", maxWidth: 120 },
});

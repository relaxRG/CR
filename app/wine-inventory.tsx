/**
 * 葡萄酒进销存管理页 v2.0
 * - 台账视图：完整的 产品序号/酒类/供应商/中文名/期初/进货/消耗/期末 表格 + 月末盘点
 * - 供应商视图：按供应商分组，显示各供应商进货额 + 累计进货
 * - 当月进货：筛选酒商 + 手动录入 + 批量操作（修改日期/删除）+ 价格涨跌显示
 * - 总结：月度趋势折线图 + 快照历史 + Pour Cost 卡片
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
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
import { useWineSnapshotStore, useWineManualPurchaseStore } from "@/lib/wine/store";
import { WineInventoryItem, WineManualPurchase } from "@/lib/wine/types";
import { WineSupplierTrendChart } from "@/components/wine-supplier-trend-chart";
import { HorizontalLedgerColumn, HorizontalLedgerGroup, HorizontalLedgerTable } from "@/components/inventory/HorizontalLedgerTable";
import { MonthlyLedgerDetailSheet } from "@/components/inventory/MonthlyLedgerDetailSheet";
import { MonthlyLedgerItem } from "@/lib/inventory-core/types";
import { MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS, MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";
import { useModuleMonthCloseStore } from "@/lib/month-close/module-month-close-store";

type ViewTab = "ledger" | "supplier" | "purchase" | "summary";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "summary", label: "📊 总结" },
  { key: "ledger", label: "📋 库存管理" },
  { key: "purchase", label: "📦 当月进货" },
  { key: "supplier", label: "🏢 供应商" },
];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

// ─── 进货记录行 ───────────────────────────────────────────────────────────────
function PurchaseRow({
  purchase, prevUnitPrice, colors, selected, onSelect, onEdit, onDelete
}: {
  purchase: WineManualPurchase;
  prevUnitPrice: number | null;
  colors: any;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const delta = prevUnitPrice !== null ? purchase.unitPrice - prevUnitPrice : (purchase.unitPriceDelta ?? null);
  const alertPct = 0; // 默认全部显示涨跌
  const showAlert = delta !== null && Math.abs(delta) > 0 && Math.abs(delta / (prevUnitPrice || purchase.unitPrice)) * 100 > alertPct;

  return (
    <TouchableOpacity
      onLongPress={onSelect}
      onPress={selected ? onSelect : onEdit}
      activeOpacity={0.8}
      style={[S.purchaseRow, {
        backgroundColor: selected ? colors.primary + "15" : colors.surface,
        borderColor: selected ? colors.primary : colors.border,
      }]}
    >
      {/* 左侧选择圆圈 */}
      <TouchableOpacity onPress={onSelect} style={{ marginRight: 10 }}>
        <View style={{
          width: 22, height: 22, borderRadius: 11,
          borderWidth: 2, borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : "transparent",
          alignItems: "center", justifyContent: "center",
        }}>
          {selected && <IconSymbol name="checkmark" size={12} color="#fff" />}
        </View>
      </TouchableOpacity>

      {/* 内容 */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>
            {purchase.productName}
          </Text>
          {showAlert && delta !== null && (
            <View style={{ backgroundColor: (delta > 0 ? "#EF4444" : "#10B981") + "20", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: delta > 0 ? "#EF4444" : "#10B981" }}>
                {delta > 0 ? "↑" : "↓"}¥{formatMoney(Math.abs(delta))}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ fontSize: 11, color: colors.muted }}>
          {purchase.supplier} · {purchase.date} · {purchase.quantity}瓶
        </Text>
      </View>

      {/* 右侧金额 */}
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.primary }}>¥{formatMoney(purchase.amount)}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>¥{purchase.unitPrice}/瓶</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── 生成进货单文本 ────────────────────────────────────────────────────────────
function buildPurchaseText(
  supplier: string,
  entries: { item: WineInventoryItem; qty: number; unitPrice: number }[],
  date: string
): string {
  const lines: string[] = [];
  lines.push(`===== 葡萄酒进货单 =====`);
  lines.push(`供应商：${supplier}`);
  lines.push(`日期：${date}`);
  lines.push(`─────────────────────`);
  entries.forEach(({ item, qty, unitPrice }, i) => {
    lines.push(`${i + 1}. ${item.name}`);
    lines.push(`   ${item.wineType} · ${qty} 瓶 × ¥${formatMoney(unitPrice)} = ¥${formatMoney((qty * unitPrice))}`);
  });
  lines.push(`─────────────────────`);
  const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);
  lines.push(`合计：¥${formatMoney(total)}`);
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
  items: WineInventoryItem[];
  colors: any;
  onClose: () => void;
  onSave: (entries: { item: WineInventoryItem; qty: number; unitPrice: number }[]) => void;
}) {
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [sharing, setSharing] = useState(false);

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
    setQtys({}); setPrices({});
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
      const fileUri = (FileSystem.cacheDirectory ?? "") + `purchase_${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/plain", dialogTitle: `${supplier} 进货单` });
      } else {
        Alert.alert("分享", text);
      }
    } catch (e) {
      Alert.alert("分享失败", String(e));
    } finally {
      setSharing(false);
    }
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

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {total > 0 && (
            <View style={[S.totalBanner, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
              <Text style={[S.totalText, { color: colors.primary }]}>本次进货合计：¥{formatMoney(total)}</Text>
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
                  小计 ¥{formatMoney((Number(qtys[item.seq]) * Number(prices[item.seq] || item.unitCost || 0)))}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[S.sheetFooter, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <Pressable onPress={handleSave} style={[S.footerBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="checkmark" size={15} color="#fff" />
            <Text style={S.footerBtnText}>保存</Text>
          </Pressable>
          <Pressable
            onPress={handleSaveAndShare}
            disabled={sharing}
            style={[S.footerBtn, { backgroundColor: colors.success ?? "#10B981", opacity: sharing ? 0.6 : 1 }]}
          >
            <IconSymbol name="square.and.arrow.up" size={15} color="#fff" />
            <Text style={S.footerBtnText}>{sharing ? "分享中…" : "保存并分享"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export interface WineInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function WineInventoryScreen({ month, embedded = false }: WineInventoryScreenProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { snapshots, addSnapshot, deleteSnapshot, setActualEndQty, batchSetActualEndQty } = useWineSnapshotStore();
  const { purchases, addManualPurchase, deleteManualPurchase, batchDeleteManualPurchases, batchUpdateManualPurchaseDate, getMonthPurchases } = useWineManualPurchaseStore();

  const [viewTab, setViewTab] = useState<ViewTab>("ledger");
  const [filterSupplier, setFilterSupplier] = useState<string | null>(null);
  // 供应商页仅切换当前同页明细，不影响库存管理页的供应商筛选。
  const [supplierViewSupplier, setSupplierViewSupplier] = useState<string | null>(null);
  const [showPurchaseSheet, setShowPurchaseSheet] = useState(false);
  const [activeSupplierForEntry, setActiveSupplierForEntry] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLedgerItem, setSelectedLedgerItem] = useState<MonthlyLedgerItem | null>(null);
  const selectedMonth = month ?? getCurrentMonth();
  const moduleClose = useModuleMonthCloseStore();
  const wineCloseStatus = moduleClose.getStatus("wine", selectedMonth);
  const assertWineWritable = () => {
    if (moduleClose.isWritable("wine", selectedMonth)) return true;
    Alert.alert("葡萄酒月份已归档", `${selectedMonth} 葡萄酒已归档。请先在葡萄酒模块开启调整，不能直接修改历史台账。`);
    return false;
  };

  // ★ 当月进货多选状态
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // ★ 当月进货筛选酒商
  const [purchaseFilterSupplier, setPurchaseFilterSupplier] = useState<string | null>(null);
  // ★ 批量修改日期 Modal
  const [showBatchDateModal, setShowBatchDateModal] = useState(false);
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  // ★ 月末盘点状态
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const [stocktakeValues, setStocktakeValues] = useState<Record<number, string>>({});

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

  const toWineLedgerRow = (item: WineInventoryItem): MonthlyLedgerItem => ({
    itemId: String(item.seq),
    name: item.name,
    category: item.wineType || "其他",
    spec: item.supplier,
    unit: "瓶",
    openingQty: item.initQty,
    openingUnitCost: item.initUnitCost,
    openingCost: item.initCost,
    purchaseQty: item.purchaseQty,
    purchaseCost: item.purchaseCost,
    consumeQty: item.consumeBottles,
    consumeCost: item.consumeQty,
    lossQty: 0,
    lossCost: 0,
    closingQty: item.actualEndQty ?? item.endQty,
    closingUnitCost: item.unitCost,
    closingCost: (item.actualEndQty ?? item.endQty) * item.unitCost,
    notes: `供应商：${item.supplier}`,
  });

  const wineLedgerRows = useMemo<MonthlyLedgerItem[]>(() => filteredItems.map(toWineLedgerRow), [filteredItems]);
  const wineLedgerGroups = useMemo<HorizontalLedgerGroup<MonthlyLedgerItem>[]>(() => {
    const groups = new Map<string, MonthlyLedgerItem[]>();
    wineLedgerRows.forEach((row) => groups.set(row.category, [...(groups.get(row.category) ?? []), row]));
    return [...groups.entries()].map(([label, rows]) => ({ id: label, label, color: typeColor(label), rows }));
  }, [wineLedgerRows]);
  const wineLedgerColumns = useMemo<HorizontalLedgerColumn<MonthlyLedgerItem>[]>(() => [
    { key: "sequence", label: "序", width: 38, align: "center", render: (row) => <Text style={{ color: colors.muted, fontSize: 11 }}>{row.itemId}</Text> },
    { key: "name", label: "商品名称", width: 146, onPress: setSelectedLedgerItem, testID: (row) => `wine-ledger-name-${row.itemId}`, render: (row) => <><Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontWeight: "800" }}>{row.name}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>{row.spec}</Text></> },
    { key: "openingQty", label: "期初数量", width: 76, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: 12 }}>{row.openingQty.toFixed(2)}</Text> },
    { key: "openingUnitCost", label: "期初单价", width: 76, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: 12 }}>¥{formatMoney(row.openingUnitCost)}</Text> },
    { key: "openingCost", label: "期初成本", width: 82, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: 12 }}>¥{formatMoney(row.openingCost)}</Text> },
    { key: "purchaseQty", label: "进货数量", width: 76, align: "right", render: (row) => <Text style={{ color: row.purchaseQty > 0 ? colors.primary : colors.muted, fontSize: 12 }}>{row.purchaseQty > 0 ? `+${row.purchaseQty.toFixed(2)}` : "—"}</Text> },
    { key: "purchaseCost", label: "进货成本", width: 82, align: "right", render: (row) => <Text style={{ color: row.purchaseCost > 0 ? colors.primary : colors.muted, fontSize: 12 }}>{row.purchaseCost > 0 ? `¥${formatMoney(row.purchaseCost)}` : "—"}</Text> },
    { key: "consumeQty", label: "消耗瓶数", width: 76, align: "right", render: (row) => <Text style={{ color: row.consumeQty > 0 ? colors.warning : colors.muted, fontSize: 12 }}>{row.consumeQty > 0 ? row.consumeQty.toFixed(2) : "—"}</Text> },
    { key: "consumeCost", label: "消耗成本", width: 82, align: "right", render: (row) => <Text style={{ color: row.consumeCost > 0 ? colors.warning : colors.muted, fontSize: 12 }}>{row.consumeCost > 0 ? `¥${formatMoney(row.consumeCost)}` : "—"}</Text> },
    { key: "closingQty", label: "期末库存", width: 76, align: "right", render: (row) => <Text style={{ color: row.closingQty <= 0 ? colors.error : colors.foreground, fontSize: 12, fontWeight: "800" }}>{row.closingQty.toFixed(2)}</Text> },
    { key: "closingUnitCost", label: "期末单价", width: 82, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: 12 }}>¥{formatMoney(row.closingUnitCost)}</Text> },
    { key: "closingCost", label: "期末成本", width: 82, align: "right", render: (row) => <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>¥{formatMoney(row.closingCost)}</Text> },
  ], [colors]);

  const selectedSupplierView = supplierViewSupplier && allSuppliers.includes(supplierViewSupplier)
    ? supplierViewSupplier
    : allSuppliers[0] ?? null;
  const supplierViewRows = useMemo<MonthlyLedgerItem[]>(
    () => (selectedSupplierView ? (bySupplier.get(selectedSupplierView) ?? []).map(toWineLedgerRow) : []),
    [bySupplier, selectedSupplierView],
  );
  const supplierViewGroups = useMemo<HorizontalLedgerGroup<MonthlyLedgerItem>[]>(() => {
    const groups = new Map<string, MonthlyLedgerItem[]>();
    supplierViewRows.forEach((row) => groups.set(row.category, [...(groups.get(row.category) ?? []), row]));
    return [...groups.entries()].map(([label, rows]) => ({ id: label, label, color: typeColor(label), rows }));
  }, [supplierViewRows]);

  // ★ 当月进货记录（含筛选）
  const monthPurchaseRecords = useMemo(() => {
    let list = getMonthPurchases(selectedMonth);
    if (purchaseFilterSupplier) list = list.filter((p) => p.supplier === purchaseFilterSupplier);
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [purchases, selectedMonth, purchaseFilterSupplier]);

  // ★ 当月进货的所有供应商（用于筛选栏）
  const purchaseSuppliers = useMemo(() => {
    const all = getMonthPurchases(selectedMonth);
    return Array.from(new Set(all.map((p) => p.supplier))).sort();
  }, [purchases, selectedMonth]);

  // ★ 构建价格历史 Map（用于显示涨跌）
  const prevUnitPriceMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    const sorted = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
    for (const p of sorted) {
      const key = `${p.supplier}:${p.productName}`;
      if (p.date.startsWith(selectedMonth)) {
        // 当月的记录：找上一条同款记录的单价
        if (!(key in map)) map[key] = null; // 还没有历史价格
      } else {
        map[key] = p.unitPrice; // 记录历史价格
      }
    }
    return map;
  }, [purchases, selectedMonth]);

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
      // ★ 计算与上次进货单价的差值
      const key = `${item.supplier}:${item.name}`;
      const prevPrice = prevUnitPriceMap[key] ?? null;
      const unitPriceDelta = prevPrice !== null ? unitPrice - prevPrice : undefined;
      addManualPurchase({
        date: today,
        supplier: item.supplier,
        bottleId: null,
        productName: item.name,
        unitPrice,
        quantity: qty,
        amount: qty * unitPrice,
        notes: "",
        unitPriceDelta,
        priceAlertTriggered: unitPriceDelta !== undefined && Math.abs(unitPriceDelta) > 0,
      });
    });
    const total = entries.reduce((s, e) => s + e.qty * e.unitPrice, 0);
    Alert.alert("进货已记录", `${activeSupplierForEntry} 共 ${entries.length} 款，合计 ¥${formatMoney(total)}`);
  };

  const activeSupplierItems = useMemo(
    () => (bySupplier.get(activeSupplierForEntry) ?? []),
    [bySupplier, activeSupplierForEntry]
  );

  const handleDeleteSnapshot = (snapId: string, label: string) => {
    Alert.alert("删除快照", `确认删除「${label}」的快照？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteSnapshot(snapId) },
    ]);
  };

  // ★ 多选操作
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    Alert.alert("批量删除", `确认删除选中的 ${selectedIds.size} 条进货记录？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => {
        batchDeleteManualPurchases(Array.from(selectedIds));
        setSelectedIds(new Set());
        setSelectMode(false);
      }},
    ]);
  };

  const handleBatchUpdateDate = () => {
    if (selectedIds.size === 0) return;
    batchUpdateManualPurchaseDate(Array.from(selectedIds), batchDate);
    setShowBatchDateModal(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    Alert.alert("完成", `已将 ${selectedIds.size} 条记录的日期修改为 ${batchDate}`);
  };

  return (
    <ScreenContainer edges={embedded ? [] : undefined}>
      {/* 独立路由才保留返回导航；工作台已提供分类与月份层级。 */}
      {!embedded && <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>
          葡萄酒进销存{latestSnapshot ? ` · ${latestSnapshot.monthLabel}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => { tap(); router.push("/wine-inventory-import" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.and.arrow.down.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>}

      {/* Tab 切换 */}
      <View style={[S.tabBar, { backgroundColor: colors.border + "33" }]}>
        {VIEW_TABS.map((t) => (
          <TouchableOpacity key={t.key} testID={`wine-tab-${t.key}`} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => { tap(); setViewTab(t.key); }}
            style={[S.tabBtn, viewTab === t.key && { backgroundColor: colors.background }]}>
            <Text style={[S.tabText, { color: viewTab === t.key ? colors.foreground : colors.muted, fontWeight: viewTab === t.key ? "600" : "400" }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 无数据提示 */}
      {items.length === 0 && viewTab !== "purchase" && viewTab !== "summary" && (
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
            <StatCell label="期末成本" value={`¥${formatMoney(ledgerStats.totalEndCost)}`} color={colors.foreground} />
            <StatCell label="本月进货" value={`¥${formatMoney(ledgerStats.totalPurchaseCost)}`} color={colors.primary} />
            <StatCell label="本月消耗" value={`${ledgerStats.totalConsumeBottles}瓶`} color={colors.warning} />
          </View>
          {/* 工具栏 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }} contentContainerStyle={{ minHeight: 60, paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
            <TouchableOpacity onPress={() => {
              if (!assertWineWritable()) return;
              tap();
              const initVals: Record<number, string> = {};
              items.forEach((i) => { initVals[i.seq] = String(i.endQty); });
              setStocktakeValues(initVals);
              setShowStocktakeModal(true);
            }} style={[S.actionBtn, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}>
              <IconSymbol name="checklist" size={13} color="#F59E0B" />
              <Text style={{ fontSize: 12, color: "#F59E0B", fontWeight: "600" }}>月末盘点</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              if (!assertWineWritable()) return;
              const monthPurchases = getMonthPurchases(selectedMonth);
              const payable = monthPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);
              Alert.alert("葡萄酒月度归档", `确认归档 ${selectedMonth} 葡萄酒台账？归档后需先开启调整才能修改。`, [
                { text: "取消", style: "cancel" },
                { text: "确认归档", onPress: () => {
                  moduleClose.finalize({
                    module: "wine",
                    month: selectedMonth,
                    snapshot: { month: selectedMonth, snapshot: latestSnapshot, purchases: monthPurchases },
                    paymentSummary: { payable, paid: 0, remaining: payable },
                  });
                  Alert.alert("归档完成", `${selectedMonth} 葡萄酒已独立归档。`);
                } },
              ]);
            }} style={[S.actionBtn, { backgroundColor: wineCloseStatus === "draft" ? colors.primary + "12" : colors.success + "14", borderColor: wineCloseStatus === "draft" ? colors.primary : colors.success }]}> 
              <IconSymbol name="archivebox" size={13} color={wineCloseStatus === "draft" ? colors.primary : colors.success} />
              <Text style={{ fontSize: 12, color: wineCloseStatus === "draft" ? colors.primary : colors.success, fontWeight: "600" }}>{wineCloseStatus === "draft" ? "月度归档" : "已归档"}</Text>
            </TouchableOpacity>
          </ScrollView>
          {/* 供应商筛选 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[S.filterScroll, { borderBottomColor: colors.border, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}>
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
          <View style={{ paddingHorizontal: 16, paddingBottom: 40 + insets.bottom }}>
            <HorizontalLedgerTable
              testID="wine-horizontal-ledger-table"
              columns={wineLedgerColumns}
              groups={wineLedgerGroups}
              rowKey={(row) => row.itemId}
              emptyLabel="当前筛选条件下没有葡萄酒台账记录。"
              rowTone={(row) => row.closingQty <= 0 ? "negative" : "default"}
            />
          </View>
        </>
      )}

      <MonthlyLedgerDetailSheet item={selectedLedgerItem} accentColor={colors.primary} onClose={() => setSelectedLedgerItem(null)} />

      {/* ── 供应商视图：标签切换后在同页直接显示台账，不再使用供应商入口卡片。 ── */}
      {viewTab === "supplier" && items.length > 0 && (
        <View testID="wine-supplier-inline-workspace" style={{ flex: 1 }}>
          <ScrollView
            horizontal
            nestedScrollEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            testID="wine-supplier-tabs"
            style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}
          >
            {allSuppliers.map((supplier) => {
              const active = selectedSupplierView === supplier;
              return (
                <TouchableOpacity
                  key={supplier}
                  testID={`wine-supplier-tab-${supplier}`}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  onPress={() => { tap(); setSupplierViewSupplier(supplier); }}
                  style={[S.filterChip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
                >
                  <Text style={[S.filterChipText, { color: active ? "#fff" : colors.muted }]}>{supplier}</Text>
                </TouchableOpacity>
              );
            })}
            {selectedSupplierView && (
              <TouchableOpacity
                testID="wine-supplier-record-purchase"
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                onPress={() => handlePurchaseEntry(selectedSupplierView)}
                style={[S.actionBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "44" }]}
              >
                <IconSymbol name="plus" size={13} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>录入进货</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {selectedSupplierView && (
            <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40 + insets.bottom }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "800" }}>{selectedSupplierView}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    本月 ¥{formatMoney(supplierMonthTotals[selectedSupplierView] ?? 0)} · 累计 ¥{formatMoney(supplierCumulTotals[selectedSupplierView] ?? 0)}
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{supplierViewRows.length} 款</Text>
              </View>
              <HorizontalLedgerTable
                testID="wine-supplier-horizontal-ledger-table"
                columns={wineLedgerColumns}
                groups={supplierViewGroups}
                rowKey={(row) => row.itemId}
                emptyLabel="该供应商暂无葡萄酒台账记录。"
                rowTone={(row) => row.closingQty <= 0 ? "negative" : "default"}
              />
            </View>
          )}
        </View>
      )}

      {/* ── 当月进货视图（全面升级）── */}
      {viewTab === "purchase" && (
        <>
          {/* ★ 酒商筛选栏 */}
          {purchaseSuppliers.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
              <TouchableOpacity onPress={() => setPurchaseFilterSupplier(null)}
                style={[S.filterChip, { backgroundColor: !purchaseFilterSupplier ? colors.primary : colors.surface, borderColor: !purchaseFilterSupplier ? colors.primary : colors.border }]}>
                <Text style={[S.filterChipText, { color: !purchaseFilterSupplier ? "#fff" : colors.muted }]}>全部</Text>
              </TouchableOpacity>
              {purchaseSuppliers.map((s) => (
                <TouchableOpacity key={s} onPress={() => setPurchaseFilterSupplier(purchaseFilterSupplier === s ? null : s)}
                  style={[S.filterChip, { backgroundColor: purchaseFilterSupplier === s ? colors.primary : colors.surface, borderColor: purchaseFilterSupplier === s ? colors.primary : colors.border }]}>
                  <Text style={[S.filterChipText, { color: purchaseFilterSupplier === s ? "#fff" : colors.muted }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ★ 工具栏 */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            {/* 手动录入按钮 */}
            <TouchableOpacity onPress={() => {
              tap();
              if (allSuppliers.length > 0) {
                setActiveSupplierForEntry(purchaseFilterSupplier ?? allSuppliers[0]);
                setShowPurchaseSheet(true);
              } else {
                Alert.alert("提示", "请先导入 Excel 数据，或在供应商 Tab 中录入进货");
              }
            }} style={[S.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1 }]}>
              <IconSymbol name="plus" size={13} color="#fff" />
              <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>手动录入</Text>
            </TouchableOpacity>

            {/* 多选模式切换 */}
            <TouchableOpacity onPress={() => {
              tap();
              setSelectMode(!selectMode);
              if (selectMode) setSelectedIds(new Set());
            }} style={[S.actionBtn, { backgroundColor: selectMode ? "#EF4444" : colors.surface, borderColor: selectMode ? "#EF4444" : colors.border }]}>
              <IconSymbol name="checkmark.circle" size={13} color={selectMode ? "#fff" : colors.muted} />
              <Text style={{ fontSize: 12, color: selectMode ? "#fff" : colors.muted, fontWeight: "600" }}>
                {selectMode ? `已选 ${selectedIds.size}` : "多选"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ★ 批量操作工具栏（多选模式下显示） */}
          {selectMode && selectedIds.size > 0 && (
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary + "10", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <TouchableOpacity onPress={() => setShowBatchDateModal(true)}
                style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border, flex: 1 }]}>
                <IconSymbol name="calendar" size={13} color={colors.primary} />
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>修改日期</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleBatchDelete}
                style={[S.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#EF4444", flex: 1 }]}>
                <IconSymbol name="trash" size={13} color="#EF4444" />
                <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>删除</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 进货记录列表 */}
          {monthPurchaseRecords.length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 32 }}>🍷</Text>
              <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>
                {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月暂无进货记录
              </Text>
              <TouchableOpacity onPress={() => {
                if (allSuppliers.length > 0) {
                  setActiveSupplierForEntry(allSuppliers[0]);
                  setShowPurchaseSheet(true);
                }
              }} style={[S.importBtn, { backgroundColor: colors.primary, marginTop: 16 }]}>
                <IconSymbol name="plus" size={14} color="#fff" />
                <Text style={S.importBtnText}>手动录入进货</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
              data={monthPurchaseRecords}
              keyExtractor={(p) => p.id}
              renderItem={({ item: p }) => {
                const key = `${p.supplier}:${p.productName}`;
                const prevPrice = prevUnitPriceMap[key] ?? null;
                return (
                  <PurchaseRow
                    purchase={p}
                    prevUnitPrice={prevPrice}
                    colors={colors}
                    selected={selectedIds.has(p.id)}
                    onSelect={() => toggleSelect(p.id)}
                    onEdit={() => {
                      Alert.alert(p.productName, `供应商：${p.supplier}\n日期：${p.date}\n数量：${p.quantity}瓶\n单价：¥${p.unitPrice}\n金额：¥${formatMoney(p.amount)}`, [
                        { text: "关闭" },
                        { text: "删除", style: "destructive", onPress: () => {
                          Alert.alert("确认删除", `删除「${p.productName}」这条进货记录？`, [
                            { text: "取消", style: "cancel" },
                            { text: "删除", style: "destructive", onPress: () => deleteManualPurchase(p.id) },
                          ]);
                        }},
                      ]);
                    }}
                    onDelete={() => deleteManualPurchase(p.id)}
                  />
                );
              }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
              ListHeaderComponent={
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>
                    共 {monthPurchaseRecords.length} 条 · 合计 ¥{formatMoney(monthPurchaseRecords.reduce((s, p) => s + p.amount, 0))}
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* ── 汇总视图 ── */}
      {viewTab === "summary" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
          {/* 供应商月度趋势折线图 */}
          {snapshots.length >= 1 && (
            <View style={[S.trendCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[S.trendTitle, { color: colors.foreground }]}>供应商月度进货趋势</Text>
              <Text style={[S.trendSubtitle, { color: colors.muted }]}>
                {snapshots.length} 个月份快照 · Top 5 供应商
              </Text>
              <WineSupplierTrendChart snapshots={snapshots} topN={5} />
            </View>
          )}

          {/* 快照历史 */}
          <Text style={[S.sectionTitle, { color: colors.muted, marginTop: snapshots.length >= 1 ? 16 : 0 }]}>月度快照（{snapshots.length} 份）</Text>
          {snapshots.map((snap) => (
            <View key={snap.id} style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.summaryCardHeader}>
                <Text style={[S.summaryCardTitle, { color: colors.foreground }]}>{snap.monthLabel}</Text>
                <Text style={[S.summaryCardDate, { color: colors.muted }]}>{snap.importedAt.slice(0, 10)}</Text>
              </View>
              <View style={S.summaryCardStats}>
                <SummaryStatCell label="月进货" value={`¥${formatMoney(snap.totalPurchase)}`} color={colors.primary} />
                <SummaryStatCell label="月消耗" value={`¥${formatMoney(snap.totalConsume)}`} color={colors.warning} />
                <SummaryStatCell label="期末成本" value={`¥${formatMoney(snap.totalEndCost)}`} color={colors.foreground} />
              </View>
              {Object.entries(snap.supplierTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
                <View key={sup} style={[S.summarySupRow, { borderTopColor: colors.border }]}>
                  <Text style={[S.summarySupName, { color: colors.muted }]}>{sup}</Text>
                  <Text style={[S.summarySupAmt, { color: colors.primary }]}>¥{formatMoney(amt)}</Text>
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

          {/* 手动进货记录（本月） */}
          {getMonthPurchases(getCurrentMonth()).length > 0 && (
            <>
              <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 20 }]}>本月手动进货（{getMonthPurchases(getCurrentMonth()).length} 条）</Text>
              {getMonthPurchases(getCurrentMonth()).map((p) => (
                <View key={p.id} style={[S.manualRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.manualName, { color: colors.foreground }]} numberOfLines={1}>{p.productName}</Text>
                    <Text style={[S.manualMeta, { color: colors.muted }]}>{p.supplier} · {p.date} · {p.quantity}瓶 × ¥{p.unitPrice}</Text>
                  </View>
                  <Text style={[S.manualAmt, { color: colors.primary }]}>¥{formatMoney(p.amount)}</Text>
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

      {/* ★ 批量修改日期 Modal */}
      <Modal visible={showBatchDateModal} transparent animationType="fade" onRequestClose={() => setShowBatchDateModal(false)}>
        <View style={{ flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 24, width: 300 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>批量修改日期</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>将 {selectedIds.size} 条记录的日期修改为：</Text>
            <TextInput
              value={batchDate}
              onChangeText={setBatchDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, backgroundColor: colors.surface, marginBottom: 20 }}
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable onPress={() => setShowBatchDateModal(false)} style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
                <Text style={{ color: colors.muted }}>取消</Text>
              </Pressable>
              <Pressable onPress={handleBatchUpdateDate} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "600" }}>确认</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ★ 月末盘点 Modal */}
      <Modal visible={showStocktakeModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowStocktakeModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Pressable onPress={() => setShowStocktakeModal(false)}>
              <Text style={{ fontSize: 16, color: colors.primary }}>取消</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>月末盘点</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>填入实际期末库存量，自动测算消耗</Text>
            </View>
            <Pressable onPress={() => {
              if (!assertWineWritable() || !latestSnapshot) return;
              const entries = items
                .filter((item) => stocktakeValues[item.seq] !== undefined && stocktakeValues[item.seq] !== "")
                .map((item) => ({ seq: item.seq, actualQty: parseFloat(stocktakeValues[item.seq] ?? "0") || 0 }));
              if (entries.length === 0) { Alert.alert("请至少填写一款酒的期末库存量"); return; }
              batchSetActualEndQty(latestSnapshot.id, entries);
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
              const expectedClosing = item.initQty + item.purchaseQty;
              const actualVal = stocktakeValues[item.seq] ?? "";
              const actualQty = parseFloat(actualVal) || 0;
              const consumeBottles = actualVal !== "" ? Math.max(0, item.initQty + item.purchaseQty - actualQty) : null;
              return (
                <View key={item.seq} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{item.name}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{item.wineType} · 理论期末 {expectedClosing} 瓶</Text>
                    </View>
                    <TextInput
                      value={actualVal}
                      onChangeText={(v) => setStocktakeValues((prev) => ({ ...prev, [item.seq]: v }))}
                      placeholder={String(expectedClosing)}
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={{ width: 80, borderWidth: 1, borderColor: actualVal !== "" ? "#F59E0B" : colors.border, borderRadius: 8, padding: 8, fontSize: 15, fontWeight: "700", color: colors.foreground, backgroundColor: colors.background, textAlign: "center" }}
                    />
                  </View>
                  {consumeBottles !== null && (
                    <Text style={{ fontSize: 11, color: consumeBottles > 0 ? colors.warning : colors.muted }}>
                      自动测算消耗：{consumeBottles} 瓶
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
  tabBtn: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13, lineHeight: 18 },
  statsRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  filterScroll: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontWeight: "500" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 19 },
  actionBtn: { flexDirection: "row", flexShrink: 0, minHeight: 44, alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
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
  purchaseRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  trendCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 4 },
  trendTitle: { fontSize: 15, fontWeight: "700" },
  trendSubtitle: { fontSize: 11, marginTop: 2, marginBottom: 4 },
  summaryCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  summaryCardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryCardTitle: { fontSize: 16, fontWeight: "700" },
  summaryCardDate: { fontSize: 12 },
  summaryCardStats: { flexDirection: "row", marginBottom: 8 },
  summarySupRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth },
  summarySupName: { fontSize: 12 },
  summarySupAmt: { fontSize: 12, fontWeight: "600" },
  deleteSnap: { alignItems: "center", paddingTop: 10, marginTop: 4 },
  manualRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  manualName: { fontSize: 13, fontWeight: "500" },
  manualMeta: { fontSize: 11, marginTop: 2 },
  manualAmt: { fontSize: 14, fontWeight: "700" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 16 },
  emptyDesc: { fontSize: 14, marginTop: 8, textAlign: "center" },
  importBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 20 },
  importBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  sheetCancel: { fontSize: 16 },
  sheetDone: { fontSize: 16, fontWeight: "600" },
  sheetFooter: { flexDirection: "row", gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  footerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12 },
  footerBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  totalBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12, alignItems: "center" },
  totalText: { fontSize: 15, fontWeight: "700" },
  entryRow: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  entryName: { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  entryMeta: { fontSize: 11, marginTop: 2 },
  entryFieldLabel: { fontSize: 11, marginBottom: 4 },
  entryInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  entrySubtotal: { fontSize: 13, fontWeight: "600", marginTop: 6, textAlign: "right" },
});

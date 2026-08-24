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
  Alert, Modal, Platform, Pressable, ScrollView,
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
import { useWineImportControlStore, useWineMasterDataStore, useWineSnapshotStore, useWineManualPurchaseStore, useWineStore, wineUuid } from "@/lib/wine/store";
import { exportWinePdf, exportWineWorkbook, summarizeWineProducts, summarizeWineSuppliers } from "@/lib/wine/workbook-export";
import { WineInventoryItem } from "@/lib/wine/types";
import { appendWineFirstPurchaseInventory, appendWineInitialInventory, WineInitialInventoryInput } from "@/lib/wine/initial-inventory";
import { rankWineLinkCandidates } from "@/lib/wine/link-candidates";
import { applyWineLedgerView, applyWinePurchaseView, collectWineTypes, getWineSupplierNames, SortState, toggleSort, WineLedgerSortKey, WinePurchaseSortKey } from "@/lib/wine/table-view";
import { WineSupplierTrendChart } from "@/components/wine-supplier-trend-chart";
import { HorizontalLedgerColumn, HorizontalLedgerGroup } from "@/components/inventory/HorizontalLedgerTable";
import { VirtualizedHorizontalLedgerTable } from "@/components/inventory/VirtualizedHorizontalLedgerTable";
import { MonthlyLedgerDetailSheet } from "@/components/inventory/MonthlyLedgerDetailSheet";
import { MonthlyLedgerItem } from "@/lib/inventory-core/types";
import { useModuleMonthCloseStore } from "@/lib/month-close/module-month-close-store";
import { formatStoreMoney, formatStoreQuantity, STORE_TABLE_METRICS } from "@/lib/store/table-display";
import { INVENTORY_WORKSPACE_METRICS } from "@/lib/store/inventory-workspace-ui";
import { StoreSegmentedTabs } from "@/components/store/store-visual-primitives";

type ViewTab = "ledger" | "supplier" | "purchase" | "summary";

const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: "summary", label: "总结" },
  { key: "ledger", label: "库存管理" },
  { key: "purchase", label: "当月进货" },
  { key: "supplier", label: "采购管理" },
];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeWineIdentity(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\-–—_()（）·.，,]/g, "");
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
  visible, supplier, items, colors, onClose, onSave, onCreateWine
}: {
  visible: boolean;
  supplier: string;
  items: WineInventoryItem[];
  colors: any;
  onClose: () => void;
  onSave: (entries: { item: WineInventoryItem; qty: number; unitPrice: number }[], date: string) => void;
  onCreateWine: (input: { name: string; quantity: number; unitPrice: number; date: string }) => void;
}) {
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newWineName, setNewWineName] = useState("");
  const [newWineQuantity, setNewWineQuantity] = useState("");
  const [newWineUnitPrice, setNewWineUnitPrice] = useState("");
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) { Alert.alert("请输入 YYYY-MM-DD 格式的进货日期"); return; }
    onSave(entries, purchaseDate);
    setQtys({}); setPrices({});
    onClose();
  };

  const handleSaveAndShare = async () => {
    const entries = buildEntries();
    if (entries.length === 0) { Alert.alert("请至少填写一款酒的进货数量"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) { Alert.alert("请输入 YYYY-MM-DD 格式的进货日期"); return; }
    onSave(entries, purchaseDate);
    const text = buildPurchaseText(supplier, entries, purchaseDate);
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
          <View style={[S.entryRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[S.entryFieldLabel, { color: colors.muted }]}>实际进货日期</Text>
            <TextInput value={purchaseDate} onChangeText={setPurchaseDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 6 }]} />
          </View>

          <View style={[S.entryRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[S.entryFieldLabel, { color: colors.muted }]}>新增葡萄酒款</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <TextInput value={newWineName} onChangeText={setNewWineName} placeholder="酒款名称" placeholderTextColor={colors.muted} style={[S.entryInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
              <Pressable onPress={() => {
                const name = newWineName.trim(); const quantity = Number(newWineQuantity); const unitPrice = Number(newWineUnitPrice);
                if (!name || quantity <= 0 || unitPrice < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) { Alert.alert("请填写酒款名称、有效数量、单价和日期"); return; }
                onCreateWine({ name, quantity, unitPrice, date: purchaseDate }); setNewWineName(""); setNewWineQuantity(""); setNewWineUnitPrice("");
              }} style={[S.actionBtn, { justifyContent: "center", backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>新增并入库</Text></Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput value={newWineQuantity} onChangeText={setNewWineQuantity} keyboardType="decimal-pad" placeholder="数量" placeholderTextColor={colors.muted} style={[S.entryInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
              <TextInput value={newWineUnitPrice} onChangeText={setNewWineUnitPrice} keyboardType="decimal-pad" placeholder="单价" placeholderTextColor={colors.muted} style={[S.entryInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
            </View>
          </View>

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

// ─── 期初库存录入 Sheet ───────────────────────────────────────────────────────
function InitialWineInventorySheet({
  visible, month, suppliers, categories, colors, onClose, onSave,
}: {
  visible: boolean;
  month: string;
  suppliers: string[];
  categories: { name: string; color: string }[];
  colors: any;
  onClose: () => void;
  onSave: (input: Omit<WineInitialInventoryInput, "month" | "bottleId">) => void;
}) {
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const amount = (Number(quantity) || 0) * (Number(unitCost) || 0);
  const reset = () => { setSupplier(""); setCategory(""); setName(""); setQuantity(""); setUnitCost(""); };
  const submit = () => {
    if (!supplier.trim() || !category.trim() || !name.trim()) { Alert.alert("请填写供应商、分类和葡萄酒名称"); return; }
    if (!(Number(quantity) > 0) || !(Number(unitCost) >= 0)) { Alert.alert("请填写大于 0 的期初数量和有效单价"); return; }
    onSave({ supplier: supplier.trim(), category: category.trim(), categoryColor: categories.find((item) => item.name === category.trim())?.color, name: name.trim(), quantity: Number(quantity), unitCost: Number(unitCost) });
    reset();
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ height: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}><Pressable onPress={onClose}><Text style={{ color: colors.primary, fontSize: 16 }}>取消</Text></Pressable><Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>建立期初库存</Text><Pressable onPress={submit}><Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>保存</Text></Pressable></View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>为 {month} 录入期初盘点事实。期初数量与金额不会记为采购；之后实际进货必须使用带日期的采购流水。</Text>
        <TextInput value={supplier} onChangeText={setSupplier} placeholder="供应商名称" placeholderTextColor={colors.muted} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, borderRadius: 10, paddingHorizontal: 12, height: 44 }} />
        {suppliers.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, gap: 8 }}>{suppliers.slice(0, 12).map((item) => <TouchableOpacity key={item} onPress={() => setSupplier(item)} style={{ borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: supplier === item ? colors.primary : colors.surface, borderWidth: 1, borderColor: supplier === item ? colors.primary : colors.border }}><Text style={{ color: supplier === item ? "#fff" : colors.muted, fontSize: 12 }}>{item}</Text></TouchableOpacity>)}</ScrollView> : null}
        <TextInput value={category} onChangeText={setCategory} placeholder="库存分类" placeholderTextColor={colors.muted} style={{ marginTop: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, borderRadius: 10, paddingHorizontal: 12, height: 44 }} />
        {categories.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, gap: 8 }}>{categories.map((item) => <TouchableOpacity key={item.name} onPress={() => setCategory(item.name)} style={{ borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: category === item.name ? item.color : colors.surface, borderWidth: 1, borderColor: item.color }}><Text style={{ color: category === item.name ? "#fff" : colors.muted, fontSize: 12 }}>{item.name}</Text></TouchableOpacity>)}</ScrollView> : null}
        <TextInput value={name} onChangeText={setName} placeholder="葡萄酒名称" placeholderTextColor={colors.muted} style={{ marginTop: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, borderRadius: 10, paddingHorizontal: 12, height: 44 }} />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}><TextInput value={quantity} onChangeText={setQuantity} placeholder="期初数量（瓶）" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, borderRadius: 10, paddingHorizontal: 12, height: 44 }} /><TextInput value={unitCost} onChangeText={setUnitCost} placeholder="期初单价" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.foreground, borderRadius: 10, paddingHorizontal: 12, height: 44 }} /></View>
        <View style={{ marginTop: 12, padding: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}><Text style={{ color: colors.muted, fontSize: 12 }}>初始金额</Text><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "700", marginTop: 2 }}>¥{formatMoney(amount)}</Text></View>
      </ScrollView>
    </View>
  </Modal>;
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

  const { snapshots, addSnapshot, updateSnapshot, deleteSnapshot, batchSetActualEndQty } = useWineSnapshotStore();
  const { bottles, addBottle } = useWineStore();
  const { suppliers: supplierProfiles, categories: categoryProfiles, addSupplier, updateSupplier, reorderSuppliers, addCategory, updateCategory, reorderCategories } = useWineMasterDataStore();
  const { purchases, addManualPurchase, deleteManualPurchase, batchDeleteManualPurchases, batchUpdateManualPurchases, batchUpdateManualPurchaseDate, getMonthPurchases } = useWineManualPurchaseStore();
  const { clearMonthPurchases, recalculateMonthInventory, batches, auditEntries } = useWineImportControlStore();

  const [viewTab, setViewTab] = useState<ViewTab>("ledger");
  const [filterSupplier, setFilterSupplier] = useState<string | null>(null);
  const [filterWineType, setFilterWineType] = useState<string | null>(null);
  const [ledgerSort, setLedgerSort] = useState<SortState<WineLedgerSortKey>>({ key: "category", direction: "asc" });
  // 供应商页仅切换当前同页信息，不影响库存管理页的筛选。
  const [supplierViewSupplier, setSupplierViewSupplier] = useState<string | null>(null);
  const [showPurchaseSheet, setShowPurchaseSheet] = useState(false);
  const [showInitialInventorySheet, setShowInitialInventorySheet] = useState(false);
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
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState("");
  const [purchaseSort, setPurchaseSort] = useState<SortState<WinePurchaseSortKey>>({ key: "date", direction: "desc" });
  const [batchEditField, setBatchEditField] = useState<"supplier" | "quantity" | "unitPrice" | null>(null);
  const [batchEditValue, setBatchEditValue] = useState("");
  // ★ 批量修改日期 Modal
  const [showBatchDateModal, setShowBatchDateModal] = useState(false);
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  // ★ 月末盘点状态
  const [showStocktakeModal, setShowStocktakeModal] = useState(false);
  const [stocktakeValues, setStocktakeValues] = useState<Record<number, string>>({});
  const [dangerousAction, setDangerousAction] = useState<"clear" | "recalculate" | null>(null);
  const [dangerousConfirmation, setDangerousConfirmation] = useState("");
  const [showSupplierManager, setShowSupplierManager] = useState(false);
  const [supplierDraftName, setSupplierDraftName] = useState("");
  const [supplierDraftEn, setSupplierDraftEn] = useState("");
  const [supplierDraftAliases, setSupplierDraftAliases] = useState("");
  const [supplierDraftContactName, setSupplierDraftContactName] = useState("");
  const [supplierDraftContactPhone, setSupplierDraftContactPhone] = useState("");
  const [supplierDraftNotes, setSupplierDraftNotes] = useState("");
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryDraftName, setCategoryDraftName] = useState("");
  const [categoryDraftColor, setCategoryDraftColor] = useState("#64748B");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [showWineLinkPicker, setShowWineLinkPicker] = useState(false);

  // 当前工作台只读取全局业务月份对应的快照；绝不能按导入时间把其他月份的数据带入当前页。
  const latestSnapshot = snapshots.find((snapshot) => snapshot.monthLabel === `${selectedMonth.slice(0, 4)}年${Number(selectedMonth.slice(5))}月`) ?? null;
  const items: WineInventoryItem[] = latestSnapshot?.items ?? [];

  // 所有供应商统一来自台账、手动采购与葡萄酒库；没有采购记录时也能先选供应商录入。
  const allSuppliers = useMemo(() => {
    const existing = getWineSupplierNames(items, purchases, bottles.map((bottle) => bottle.supplier));
    const activeProfiles = supplierProfiles.filter((supplier) => !supplier.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((supplier) => supplier.name);
    return [...new Set([...activeProfiles, ...existing])];
  }, [items, purchases, bottles, supplierProfiles]);
  const wineTypes = useMemo(() => {
    const existing = collectWineTypes(items);
    const activeProfiles = categoryProfiles.filter((category) => !category.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((category) => category.name);
    return [...new Set([...activeProfiles, ...existing])];
  }, [items, categoryProfiles]);

  // 按供应商分组
  const bySupplier = useMemo(() => {
    const map = new Map<string, WineInventoryItem[]>();
    items.forEach((item) => {
      if (!map.has(item.supplier)) map.set(item.supplier, []);
      map.get(item.supplier)!.push(item);
    });
    return map;
  }, [items]);

  // 供应商与酒款的月度／累计统计只从唯一采购流水计算，不再与快照汇总重复相加。
  const supplierPurchaseSummaries = useMemo(
    () => summarizeWineSuppliers({ month: selectedMonth, snapshot: latestSnapshot, purchases, batches, auditEntries }),
    [selectedMonth, latestSnapshot, purchases, batches, auditEntries],
  );
  const productPurchaseSummaries = useMemo(
    () => summarizeWineProducts({ month: selectedMonth, snapshot: latestSnapshot, purchases, batches, auditEntries }),
    [selectedMonth, latestSnapshot, purchases, batches, auditEntries],
  );
  const supplierCumulTotals = useMemo(
    () => Object.fromEntries(supplierPurchaseSummaries.map((summary) => [summary.supplier, summary.cumulativeAmount])),
    [supplierPurchaseSummaries],
  );

  // 台账筛选与排序必须共用同一纯规则，确保搜索、供应商、酒类和表头排序可叠加。
  const filteredItems = useMemo(
    () => applyWineLedgerView(items, searchQuery, filterSupplier, filterWineType, ledgerSort),
    [items, searchQuery, filterSupplier, filterWineType, ledgerSort],
  );

  const toWineLedgerRow = (item: WineInventoryItem): MonthlyLedgerItem => ({
    itemId: String(item.seq),
    name: item.name,
    nameEn: item.bottleId ? bottles.find((bottle) => bottle.id === item.bottleId)?.nameEn || undefined : undefined,
    category: item.category || item.wineType || "其他",
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
    const categoryOrder = new Map(categoryProfiles.slice().sort((left, right) => left.sortOrder - right.sortOrder).map((category, index) => [category.name, index]));
    return [...groups.entries()].sort(([left], [right]) => (categoryOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right, "zh-CN")).map(([label, rows]) => ({
      id: label,
      label,
      color: categoryProfiles.find((category) => category.name === label)?.color ?? filteredItems.find((item) => (item.category ?? item.wineType) === label)?.categoryColor ?? colors.muted,
      rows,
    }));
  }, [wineLedgerRows, filteredItems, categoryProfiles, colors.muted]);
  const wineLedgerColumns = useMemo<HorizontalLedgerColumn<MonthlyLedgerItem>[]>(() => [
    { key: "sequence", label: "序号", width: 46, compactWidth: 40, flexWeight: 0.4, align: "center", render: (row) => <Text style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>{row.itemId}</Text> },
    { key: "name", sortKey: "name", label: "商品名称", width: 184, compactWidth: 150, pinned: true, flexWeight: 3, onPress: setSelectedLedgerItem, testID: (row) => `wine-ledger-name-${row.itemId}`, render: (row) => <View><Text numberOfLines={1} style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.nameFontSize, fontWeight: "500", lineHeight: 16 }}>{row.name}</Text>{row.nameEn ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, fontWeight: "400", lineHeight: 14, marginTop: 1 }}>{row.nameEn}</Text> : null}</View> },
    { key: "referencePrice", label: "参考价", width: 96, compactWidth: 68, flexWeight: 1.1, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreMoney(row.openingUnitCost)}</Text> },
    { key: "openingQty", sortKey: "openingQty", label: "期初库存", width: 88, flexWeight: 1, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreQuantity(row.openingQty)}</Text> },
    { key: "openingUnitCost", sortKey: "openingUnitCost", label: "期初单价", width: 104, flexWeight: 1.2, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreMoney(row.openingUnitCost)}</Text> },
    { key: "openingCost", sortKey: "openingCost", label: "期初成本", width: 112, flexWeight: 1.3, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreMoney(row.openingCost)}</Text> },
    { key: "purchaseQty", sortKey: "purchaseQty", label: "进货量", width: 88, flexWeight: 1, align: "right", render: (row) => <Text style={{ color: row.purchaseQty > 0 ? colors.primary : colors.muted, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{row.purchaseQty > 0 ? `+${formatStoreQuantity(row.purchaseQty)}` : "—"}</Text> },
    { key: "purchaseCost", sortKey: "purchaseCost", label: "进货成本", width: 112, flexWeight: 1.3, align: "right", render: (row) => <Text style={{ color: row.purchaseCost > 0 ? colors.primary : colors.muted, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{row.purchaseCost > 0 ? formatStoreMoney(row.purchaseCost) : "—"}</Text> },
    { key: "closingQty", sortKey: "closingQty", label: "期末库存", width: 96, flexWeight: 1.1, align: "right", render: (row) => <Text style={{ color: row.closingQty <= 0 ? colors.muted : colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize, fontWeight: "600" }}>{formatStoreQuantity(row.closingQty)}</Text> },
    { key: "closingUnitCost", sortKey: "closingUnitCost", label: "期末单价", width: 112, flexWeight: 1.3, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreMoney(row.closingUnitCost)}</Text> },
    { key: "closingCost", sortKey: "closingCost", label: "期末成本", width: 120, flexWeight: 1.5, align: "right", render: (row) => <Text style={{ color: colors.primary, fontSize: STORE_TABLE_METRICS.numericFontSize, fontWeight: "600" }}>{formatStoreMoney(row.closingCost)}</Text> },
    { key: "consumeQty", sortKey: "consumeQty", label: "消耗量", width: 88, flexWeight: 1, align: "right", render: (row) => <Text style={{ color: row.consumeQty > 0 ? colors.warning : colors.muted, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{row.consumeQty > 0 ? formatStoreQuantity(row.consumeQty) : "—"}</Text> },
    { key: "consumeCost", sortKey: "consumeCost", label: "消耗成本", width: 112, flexWeight: 1.3, align: "right", render: (row) => <Text style={{ color: row.consumeCost > 0 ? colors.warning : colors.muted, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{row.consumeCost > 0 ? formatStoreMoney(row.consumeCost) : "—"}</Text> },
  ], [colors]);

  const selectedSupplierView = supplierViewSupplier && allSuppliers.includes(supplierViewSupplier)
    ? supplierViewSupplier
    : allSuppliers[0] ?? null;
  const selectedSupplierLedgerItems = useMemo(
    () => selectedSupplierView ? (bySupplier.get(selectedSupplierView) ?? []) : [],
    [bySupplier, selectedSupplierView],
  );
  const selectedSupplierPurchases = useMemo(
    () => selectedSupplierView ? getMonthPurchases(selectedMonth).filter((purchase) => purchase.supplier === selectedSupplierView) : [],
    [selectedSupplierView, purchases, selectedMonth],
  );
  const selectedSupplierBottles = useMemo(
    () => selectedSupplierView ? bottles.filter((bottle) => bottle.supplier === selectedSupplierView) : [],
    [bottles, selectedSupplierView],
  );
  const selectedSupplierMonthAmount = useMemo(
    () => selectedSupplierPurchases.reduce((total, purchase) => total + purchase.amount, 0),
    [selectedSupplierPurchases],
  );
  const selectedInventoryItem = useMemo(() => selectedLedgerItem ? items.find((item) => String(item.seq) === selectedLedgerItem.itemId) ?? null : null, [selectedLedgerItem, items]);
  const selectedBottle = useMemo(() => {
    if (!selectedInventoryItem?.bottleId) return null;
    return bottles.find((bottle) => bottle.id === selectedInventoryItem.bottleId) ?? null;
  }, [selectedInventoryItem, bottles]);
  const wineLinkCandidates = useMemo(() => selectedInventoryItem ? rankWineLinkCandidates(selectedInventoryItem, bottles) : [], [selectedInventoryItem, bottles]);

  const confirmWineBottleLink = (bottleId: string, confidence: "manual" | "confirmed", bottleName?: string) => {
    if (!selectedInventoryItem || !latestSnapshot) return;
    const resolvedName = bottleName ?? bottles.find((candidate) => candidate.id === bottleId)?.name ?? selectedInventoryItem.name;
    updateSnapshot(latestSnapshot.id, { items: latestSnapshot.items.map((item) => item.seq === selectedInventoryItem.seq ? { ...item, bottleId, category: item.category ?? item.wineType } : item) });
    // 已绑定库存行的采购全部随人工确认重链；旧版无 seq 的同供应商同名采购仅在人工确认时纳入。
    const linkedPurchases = purchases.filter((purchase) => purchase.inventoryItemSeq === selectedInventoryItem.seq || (purchase.inventoryItemSeq === undefined && purchase.productName === selectedInventoryItem.name && purchase.supplier === selectedInventoryItem.supplier));
    if (linkedPurchases.length > 0) batchUpdateManualPurchases(linkedPurchases.map((purchase) => purchase.id), { bottleId, linkConfidence: confidence });
    Alert.alert("已确认链接", `库存酒款已链接至「${resolvedName}」。供应渠道和价格历史会由已确认采购自动同步；重链或删除采购时旧档案残留会自动清理。`);
  };

  // 当月进货沿用库存管理的标签分组，并允许在没有历史采购时从酒库供应商直接开始手动录入。
  const monthPurchaseRecords = useMemo(
    () => applyWinePurchaseView(getMonthPurchases(selectedMonth), purchaseSearchQuery, purchaseFilterSupplier, purchaseSort),
    [purchases, selectedMonth, purchaseSearchQuery, purchaseFilterSupplier, purchaseSort],
  );
  const purchaseSuppliers = allSuppliers;
  const purchaseLedgerRows = useMemo(() => monthPurchaseRecords.map((purchase) => ({
    ...purchase,
    category: bottles.find((bottle) => bottle.id === purchase.bottleId)?.style ?? "Other",
  })), [monthPurchaseRecords, bottles]);
  const purchaseLedgerGroups = useMemo<HorizontalLedgerGroup<(typeof purchaseLedgerRows)[number]>[]>(() => [{
    id: "month-purchases",
    label: "当月进货",
    color: colors.muted,
    rows: purchaseLedgerRows,
  }], [purchaseLedgerRows, colors.muted]);
  const purchaseLedgerColumns = useMemo<HorizontalLedgerColumn<(typeof purchaseLedgerRows)[number]>[]>(() => [
    { key: "category", label: "分类", width: 88, compactWidth: 56, pinned: true, flexWeight: 0.9, render: (row) => <Text numberOfLines={1} style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize, fontWeight: "700" }}>{row.category}</Text> },
    { key: "date", sortKey: "date", label: "日期", width: 112, compactWidth: 64, pinned: true, flexWeight: 1.1, render: (row) => <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>{row.date}</Text> },
    { key: "name", sortKey: "name", label: "商品名称", width: 220, compactWidth: 158, pinned: true, flexWeight: 3, onPress: (row) => {
      if (selectMode) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
        return;
      }
      Alert.alert(row.productName, `供应商：${row.supplier}\n日期：${row.date}\n数量：${formatStoreQuantity(row.quantity)}瓶\n单价：${formatStoreMoney(row.unitPrice)}\n金额：${formatStoreMoney(row.amount)}`, [
        { text: "关闭" },
        { text: "删除", style: "destructive", onPress: () => Alert.alert("确认删除", `删除「${row.productName}」这条进货记录？`, [
          { text: "取消", style: "cancel" },
          { text: "删除", style: "destructive", onPress: () => deleteManualPurchase(row.id) },
        ]) },
      ]);
    }, testID: (row) => `wine-purchase-name-${row.id}`, render: (row) => <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.nameFontSize, fontWeight: "800" }}>{row.productName}</Text> },
    { key: "quantity", sortKey: "quantity", label: "数量", width: 88, flexWeight: 1, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreQuantity(row.quantity)}</Text> },
    { key: "unit", label: "单位", width: 68, flexWeight: 0.6, align: "center", render: () => <Text style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>瓶</Text> },
    { key: "unitPrice", sortKey: "unitPrice", label: "单价", width: 112, flexWeight: 1.2, align: "right", render: (row) => <Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.numericFontSize }}>{formatStoreMoney(row.unitPrice)}</Text> },
    { key: "amount", sortKey: "amount", label: "总价", width: 120, flexWeight: 1.4, align: "right", render: (row) => <Text style={{ color: colors.primary, fontSize: STORE_TABLE_METRICS.numericFontSize, fontWeight: "800" }}>{formatStoreMoney(row.amount)}</Text> },
    { key: "supplier", label: "供应商", width: 156, flexWeight: 1.6, render: (row) => <Text numberOfLines={1} style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>{row.supplier}</Text> },
    { key: "notes", label: "备注", width: 180, flexWeight: 1.8, render: (row) => <Text numberOfLines={1} style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>{row.notes || "—"}</Text> },
  ], [colors, deleteManualPurchase, selectMode]);

  // 台账统计
  const ledgerStats = useMemo(() => ({
    totalEndQty: items.reduce((s, i) => s + i.endQty, 0),
    totalEndCost: items.reduce((s, i) => s + i.endCost, 0),
    totalPurchaseCost: items.reduce((s, i) => s + i.purchaseCost, 0),
    totalConsumeCost: items.reduce((s, i) => s + i.consumeQty, 0),
    totalConsumeBottles: items.reduce((s, i) => s + i.consumeBottles, 0),
  }), [items]);

  const saveSupplierProfile = () => {
    const name = supplierDraftName.trim();
    if (!name) { Alert.alert("请输入供应商名称"); return; }
    const duplicate = supplierProfiles.some((supplier) => supplier.id !== editingSupplierId && supplier.name.trim() === name);
    if (duplicate) { Alert.alert("供应商已存在", "请编辑已有供应商，避免分散采购统计。"); return; }
    const details = {
      name,
      nameEn: supplierDraftEn.trim() || undefined,
      aliases: supplierDraftAliases.split(/[，,\n]/).map((alias) => alias.trim()).filter(Boolean),
      contactName: supplierDraftContactName.trim() || undefined,
      contactPhone: supplierDraftContactPhone.trim() || undefined,
      notes: supplierDraftNotes.trim() || undefined,
    };
    if (editingSupplierId) updateSupplier(editingSupplierId, details);
    else addSupplier(details);
    setSupplierDraftName(""); setSupplierDraftEn(""); setSupplierDraftAliases(""); setSupplierDraftContactName(""); setSupplierDraftContactPhone(""); setSupplierDraftNotes(""); setEditingSupplierId(null);
  };
  const archiveSupplierProfile = (id: string, name: string) => Alert.alert("归档供应商", `归档「${name}」后不再显示在新采购列表；历史采购不会改变。`, [
    { text: "取消", style: "cancel" },
    { text: "归档", style: "destructive", onPress: () => updateSupplier(id, { archived: true }) },
  ]);
  const saveCategoryProfile = () => {
    const name = categoryDraftName.trim();
    if (!name) { Alert.alert("请输入分类名称"); return; }
    const duplicate = categoryProfiles.some((category) => category.id !== editingCategoryId && category.name.trim() === name);
    if (duplicate) { Alert.alert("分类已存在"); return; }
    if (editingCategoryId) updateCategory(editingCategoryId, { name, color: categoryDraftColor });
    else addCategory({ name, color: categoryDraftColor });
    setCategoryDraftName(""); setCategoryDraftColor("#64748B"); setEditingCategoryId(null);
  };
  const archiveCategoryProfile = (id: string, name: string) => Alert.alert("归档分类", `归档「${name}」后将不再出现在新录入选项；历史台账分类快照不改变。`, [
    { text: "取消", style: "cancel" },
    { text: "归档", style: "destructive", onPress: () => updateCategory(id, { archived: true }) },
  ]);

  const handlePurchaseEntry = (supplier: string) => {
    tap();
    setActiveSupplierForEntry(supplier);
    setShowPurchaseSheet(true);
  };

  const handleSavePurchase = (entries: { item: WineInventoryItem; qty: number; unitPrice: number }[], purchaseDate: string) => {
    const today = purchaseDate;
    entries.forEach(({ item, qty, unitPrice }) => {
      // 从唯一采购流水中定位同供应商同酒款的最近历史单价。
      const prevPurchase = purchases
        .filter((purchase) => purchase.supplier === item.supplier && purchase.productName === item.name && purchase.date < today)
        .sort((left, right) => right.date.localeCompare(left.date))[0];
      const unitPriceDelta = prevPurchase ? unitPrice - prevPurchase.unitPrice : undefined;
      addManualPurchase({
        date: today,
        supplier: item.supplier,
        bottleId: item.bottleId ?? null,
        category: item.category ?? item.wineType,
        inventoryItemSeq: item.seq,
        linkConfidence: item.bottleId ? "confirmed" : undefined,
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

  const handleCreateInitialInventory = (input: Omit<WineInitialInventoryInput, "month" | "bottleId">) => {
    if (!assertWineWritable()) return;
    const normalizedSupplier = input.supplier.trim().toLocaleLowerCase();
    const normalizedCategory = input.category.trim().toLocaleLowerCase();
    if (!supplierProfiles.some((profile) => profile.name.trim().toLocaleLowerCase() === normalizedSupplier)) addSupplier({ name: input.supplier, aliases: [] });
    if (!categoryProfiles.some((profile) => profile.name.trim().toLocaleLowerCase() === normalizedCategory)) addCategory({ name: input.category, color: input.categoryColor ?? "#64748B" });
    const existingBottle = bottles.find((bottle) => bottle.supplier.trim().toLocaleLowerCase() === normalizedSupplier && normalizeWineIdentity(bottle.name) === normalizeWineIdentity(input.name));
    const bottleId = existingBottle?.id ?? wineUuid();
    try {
      const snapshot = appendWineInitialInventory(latestSnapshot, { ...input, month: selectedMonth, bottleId }, { now: new Date().toISOString(), snapshotId: `wine-initial-${Date.now()}` });
      if (!existingBottle) addBottle({ id: bottleId, name: input.name, nameEn: "", vintage: "", region: "", grape: "", winery: "", style: "other", abv: null, costPrice: input.unitCost, salePrice: null, stock: input.quantity, rating: null, notes: "由期初库存建档创建", photoUri: "", supplier: input.supplier, purchaseChannelProjections: [] });
      if (latestSnapshot) updateSnapshot(latestSnapshot.id, snapshot);
      else addSnapshot(snapshot);
      setShowInitialInventorySheet(false);
      Alert.alert("期初库存已建立", `「${input.name}」已写入 ${selectedMonth} 期初库存，初始金额 ¥${formatMoney(input.quantity * input.unitCost)}；未计入当月进货。`);
    } catch (error) {
      Alert.alert("无法建立期初库存", error instanceof Error ? error.message : "请检查输入后重试。");
    }
  };

  const activeSupplierItems = useMemo(() => {
    const ledgerItems = bySupplier.get(activeSupplierForEntry) ?? [];
    const knownNames = new Set(ledgerItems.map((item) => normalizeWineIdentity(item.name)));
    const libraryOnlyItems = bottles
      .filter((bottle) => bottle.supplier === activeSupplierForEntry && !knownNames.has(normalizeWineIdentity(bottle.name)))
      .map((bottle, index): WineInventoryItem => ({
        seq: -(index + 1), wineType: bottle.style, supplier: bottle.supplier, name: bottle.name,
        initUnitCost: bottle.costPrice ?? 0, initQty: 0, initCost: 0,
        purchaseQty: 0, purchaseCost: 0, endQty: 0, unitCost: bottle.costPrice ?? 0,
        endCost: 0, consumeBottles: 0, consumeQty: 0,
      }));
    return [...ledgerItems, ...libraryOnlyItems];
  }, [bySupplier, activeSupplierForEntry, bottles]);

  const handleDeleteSnapshot = (snapId: string, label: string) => {
    Alert.alert("删除快照", `确认删除「${label}」的快照？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteSnapshot(snapId) },
    ]);
  };

  // ★ 多选操作

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
    const count = selectedIds.size;
    batchUpdateManualPurchaseDate(Array.from(selectedIds), batchDate);
    setShowBatchDateModal(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    Alert.alert("完成", `已将 ${count} 条记录的日期修改为 ${batchDate}`);
  };

  const handleBatchEdit = () => {
    if (!batchEditField || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (batchEditField === "supplier") {
      const supplier = batchEditValue.trim();
      if (!supplier) { Alert.alert("请输入供应商名称"); return; }
      batchUpdateManualPurchases(ids, { supplier });
    } else {
      const value = Number(batchEditValue);
      if (!Number.isFinite(value) || value < 0 || (batchEditField === "quantity" && value <= 0)) {
        Alert.alert(batchEditField === "quantity" ? "请输入大于 0 的数量" : "请输入有效单价");
        return;
      }
      batchUpdateManualPurchases(ids, batchEditField === "quantity" ? { quantity: value } : { unitPrice: value });
    }
    const count = ids.length;
    setBatchEditField(null);
    setBatchEditValue("");
    setSelectedIds(new Set());
    setSelectMode(false);
    Alert.alert("修改完成", `已更新 ${count} 条进货记录。`);
  };

  const exportCurrentWineWorkbook = async (format: "xlsx" | "pdf") => {
    try {
      const data = { month: selectedMonth, snapshot: latestSnapshot, purchases, batches, auditEntries };
      if (format === "xlsx") await exportWineWorkbook(data);
      else await exportWinePdf(data);
    } catch (error) {
      Alert.alert("导出失败", String(error));
    }
  };

  const openDangerousAction = (action: "clear" | "recalculate") => {
    if (!assertWineWritable()) return;
    if (action === "recalculate" && !latestSnapshot) {
      Alert.alert("暂无库存快照", `当前 ${selectedMonth} 没有库存管理数据，无法重新计算。`);
      return;
    }
    setDangerousConfirmation("");
    setDangerousAction(action);
  };

  const confirmDangerousAction = () => {
    if (!dangerousAction) return;
    const required = dangerousAction === "clear" ? `清空 ${selectedMonth}` : `重算 ${selectedMonth}`;
    if (dangerousConfirmation.trim() !== required) {
      Alert.alert("确认文字不匹配", `请准确输入“${required}”后再执行。`);
      return;
    }
    if (dangerousAction === "clear") {
      const restorePoint = clearMonthPurchases(selectedMonth);
      setDangerousAction(null);
      Alert.alert("已清空本月进货", `${selectedMonth} 的采购流水已清空；库存、供应商和总结已按剩余流水重建。\n恢复点：${restorePoint.createdAt.slice(0, 16)}`);
      return;
    }
    const restorePoint = recalculateMonthInventory(selectedMonth);
    setDangerousAction(null);
    if (!restorePoint) return;
    Alert.alert("重新计算完成", `${selectedMonth} 的期初成本、进货、期末成本与消耗已从唯一采购流水重建。\n恢复点：${restorePoint.createdAt.slice(0, 16)}`);
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
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Pressable onPress={() => {
            Alert.alert("导出葡萄酒工作台", "导出当前业务月份的总结、库存管理、当月进货、供应商与累计进货内容。", [
              { text: "取消", style: "cancel" },
              { text: "综合 Excel", onPress: () => { void exportCurrentWineWorkbook("xlsx"); } },
              { text: "综合 PDF", onPress: () => { void exportCurrentWineWorkbook("pdf"); } },
            ]);
          }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.and.arrow.up.fill" size={20} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => { tap(); router.push("/wine-inventory-import" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="square.and.arrow.down.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>}

      {/* 四个葡萄酒工作台使用门店唯一胶囊选择器。 */}
      <View style={{ marginHorizontal: 12, marginTop: 8 }}>
        <StoreSegmentedTabs
          testID="wine-workspace-tabs"
          items={VIEW_TABS}
          active={viewTab}
          colors={colors}
          onChange={(next) => { tap(); setViewTab(next); }}
        />
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
          <Pressable testID="wine-create-initial-inventory-empty" onPress={() => setShowInitialInventorySheet(true)} style={[S.importBtn, { marginTop: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "700" }}>建立期初库存</Text>
          </Pressable>
        </View>
      )}

      {/* ── 台账视图：工作台只保留一个纵向滚动容器，表格自身仅横向滚动。 */}
      {viewTab === "ledger" && items.length > 0 && (
        <View testID="wine-ledger-scroll-workspace" style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <View style={[S.statsRow, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <StatCell label="期末库存" value={`${formatStoreQuantity(ledgerStats.totalEndQty)}瓶`} color={colors.foreground} />
              <StatCell label="期末成本" value={formatStoreMoney(ledgerStats.totalEndCost)} color={colors.foreground} />
              <StatCell label="本月进货" value={formatStoreMoney(ledgerStats.totalPurchaseCost)} color={colors.primary} />
              <StatCell label="本月消耗" value={`${formatStoreQuantity(ledgerStats.totalConsumeBottles)}瓶`} color={colors.warning} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight + 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }} contentContainerStyle={{ minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight + 12, paddingHorizontal: INVENTORY_WORKSPACE_METRICS.horizontalPadding, paddingVertical: 6, gap: INVENTORY_WORKSPACE_METRICS.horizontalGap, alignItems: "center" }}>
              <TouchableOpacity onPress={() => {
                if (!assertWineWritable()) return;
                tap();
                const initVals: Record<number, string> = {};
                items.forEach((i) => { initVals[i.seq] = String(i.endQty); });
                setStocktakeValues(initVals);
                setShowStocktakeModal(true);
              }} style={[S.actionBtn, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}>
                <Text style={{ fontSize: 12, color: "#92400E", fontWeight: "600" }}>月末盘点</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="wine-create-initial-inventory" onPress={() => setShowInitialInventorySheet(true)} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>建立期初库存</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openDangerousAction("recalculate")} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>强制重新计算</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="wine-manage-categories" onPress={() => setShowCategoryManager(true)} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>管理进销存分类</Text>
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
                <Text style={{ fontSize: 12, color: wineCloseStatus === "draft" ? colors.primary : colors.success, fontWeight: "600" }}>{wineCloseStatus === "draft" ? "月度归档" : "已归档"}</Text>
              </TouchableOpacity>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[S.filterScroll, { borderBottomColor: colors.border, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>供应商</Text>
              <TouchableOpacity onPress={() => setFilterSupplier(null)} style={[S.filterChip, { backgroundColor: !filterSupplier ? colors.primary : colors.surface, borderColor: !filterSupplier ? colors.primary : colors.border }]}>
                <Text style={[S.filterChipText, { color: !filterSupplier ? "#fff" : colors.muted }]}>全部</Text>
              </TouchableOpacity>
              {allSuppliers.map((supplier) => (
                <TouchableOpacity key={supplier} onPress={() => setFilterSupplier(filterSupplier === supplier ? null : supplier)} style={[S.filterChip, { backgroundColor: filterSupplier === supplier ? colors.primary : colors.surface, borderColor: filterSupplier === supplier ? colors.primary : colors.border }]}>
                  <Text style={[S.filterChipText, { color: filterSupplier === supplier ? "#fff" : colors.muted }]}>{supplier}</Text>
                </TouchableOpacity>
              ))}
              {wineTypes.length > 0 && <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginLeft: 6 }}>分类</Text>}
              <TouchableOpacity testID="wine-ledger-sort-category" onPress={() => setLedgerSort((current) => toggleSort(current, "category"))} style={[S.filterChip, { backgroundColor: ledgerSort.key === "category" ? colors.primary : colors.surface, borderColor: ledgerSort.key === "category" ? colors.primary : colors.border }]}>
                <Text style={[S.filterChipText, { color: ledgerSort.key === "category" ? "#fff" : colors.muted }]}>分类排序{ledgerSort.key === "category" ? (ledgerSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</Text>
              </TouchableOpacity>
              {wineTypes.map((type) => (
                <TouchableOpacity key={type} onPress={() => setFilterWineType(filterWineType === type ? null : type)} style={[S.filterChip, { backgroundColor: filterWineType === type ? colors.primary : colors.surface, borderColor: filterWineType === type ? colors.primary : colors.border }]}>
                  <Text style={[S.filterChipText, { color: filterWineType === type ? "#fff" : colors.muted }]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={[S.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16, marginVertical: 8 }]}>
              <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
              <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="搜索商品名称、供应商或酒类…" placeholderTextColor={colors.muted} style={[S.searchInput, { color: colors.foreground }]} returnKeyType="search" />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 8 + insets.bottom }}>
              <VirtualizedHorizontalLedgerTable
                testID="wine-horizontal-ledger-table"
                columns={wineLedgerColumns}
                groups={wineLedgerGroups}
                rowKey={(row) => row.itemId}
                emptyLabel="当前筛选条件下没有葡萄酒台账记录。"
                sort={ledgerSort}
                onSort={(key) => setLedgerSort((current) => toggleSort(current, key as WineLedgerSortKey))}
                showHeaderSortIndicators={false}
              />
            </View>
          </View>
        </View>
      )}

      <MonthlyLedgerDetailSheet
        item={selectedLedgerItem}
        accentColor={colors.primary}
        onClose={() => setSelectedLedgerItem(null)}
        footer={selectedLedgerItem ? (
          selectedBottle ? (
            <TouchableOpacity
              testID="wine-ledger-open-library-record"
              onPress={() => { setSelectedLedgerItem(null); router.push(`/wine/${selectedBottle.id}` as any); }}
              style={[S.libraryLinkButton, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}
            >
              <IconSymbol name="wineglass" size={15} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "800" }}>查看葡萄酒库档案</Text>
              <IconSymbol name="chevron.right" size={13} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={{ marginTop: 14, gap: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>尚未关联真实葡萄酒档案。请选择人工链接、确认智能候选，或新建档案；系统不会按名称自动跳转。</Text>
              {wineLinkCandidates.slice(0, 3).map(({ bottle, score, reasons }) => <TouchableOpacity key={bottle.id} testID={`wine-smart-link-${bottle.id}`} onPress={() => confirmWineBottleLink(bottle.id, "confirmed")} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600" }}>{bottle.name}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>待人工确认 · {Math.round(score * 100)}% · {reasons.join("、") || "名称相似"}</Text></View><IconSymbol name="link" size={14} color={colors.primary} /></TouchableOpacity>)}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity testID="wine-manual-link" onPress={() => setShowWineLinkPicker(true)} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.background, borderColor: colors.border }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>人工链接档案</Text></TouchableOpacity>
                <TouchableOpacity testID="wine-create-library-record" onPress={() => {
                  if (!selectedInventoryItem) return;
                  const bottleId = addBottle({ name: selectedInventoryItem.name, nameEn: "", vintage: "", region: "", grape: "", winery: "", style: "other", abv: null, costPrice: selectedInventoryItem.initUnitCost, salePrice: null, stock: selectedInventoryItem.endQty, rating: null, notes: "由葡萄酒库存档案链接创建", photoUri: "", supplier: selectedInventoryItem.supplier, purchaseChannelProjections: [] });
                  confirmWineBottleLink(bottleId, "manual", selectedInventoryItem.name);
                }} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>新建葡萄酒档案</Text></TouchableOpacity>
              </View>
            </View>
          )
        ) : null}
      />

      {/* ── 供应商视图：展示往来信息与关联档案，不再重复渲染库存管理台账。 ── */}
      {viewTab === "supplier" && (
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
            <TouchableOpacity testID="wine-manage-suppliers" onPress={() => setShowSupplierManager(true)} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700" }}>管理供应商</Text>
            </TouchableOpacity>
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
          </ScrollView>

          {!selectedSupplierView ? (
            <View style={S.emptyWrap}><Text style={{ color: colors.muted }}>暂无采购管理资料</Text></View>
          ) : (
            <ScrollView testID="wine-supplier-info-scroll" contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
              <View style={[S.supplierInfoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontSize: 19, fontWeight: "800" }}>{selectedSupplierView}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>葡萄酒供货商 · 当月往来与关联商品档案</Text>
                <View style={S.supplierMetrics}>
                  <SupplierMetric label="关联酒款" value={`${selectedSupplierBottles.length}`} colors={colors} />
                  <SupplierMetric label="本月采购" value={`${selectedSupplierPurchases.length} 笔`} colors={colors} />
                  <SupplierMetric label="本月金额" value={`¥${formatMoney(selectedSupplierMonthAmount)}`} colors={colors} />
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  <TouchableOpacity testID="wine-supplier-record-purchase" onPress={() => handlePurchaseEntry(selectedSupplierView)} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>手动录入进货</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID="wine-supplier-open-library" onPress={() => router.push("/(tabs)/wine" as any)} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>查看葡萄酒库</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 18 }]}>关联葡萄酒档案</Text>
              {selectedSupplierBottles.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>尚无葡萄酒库档案。可在葡萄酒库中新建后自动纳入此供应商。</Text>
              ) : selectedSupplierBottles.map((bottle) => (
                <TouchableOpacity key={bottle.id} onPress={() => router.push(`/wine/${bottle.id}` as any)} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{bottle.name}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{[bottle.vintage, bottle.region, bottle.grape].filter(Boolean).join(" · ") || "待补充产区与品种"}</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={14} color={colors.muted} />
                </TouchableOpacity>
              ))}

              <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 18 }]}>本月采购摘要</Text>
              {selectedSupplierPurchases.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 13 }}>本月暂无手动采购记录；可使用上方按钮录入。</Text>
              ) : selectedSupplierPurchases.slice(0, 8).map((purchase) => (
                <View key={purchase.id} style={[S.supplierPurchaseRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{purchase.productName}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{purchase.date} · {purchase.quantity} 瓶 × ¥{formatMoney(purchase.unitPrice)}</Text>
                  </View>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "800" }}>¥{formatMoney(purchase.amount)}</Text>
                </View>
              ))}
              {selectedSupplierPurchases.length > 8 && <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>其余 {selectedSupplierPurchases.length - 8} 笔可在“当月进货”查看、筛选和编辑。</Text>}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 16 }}>库存台账：{selectedSupplierLedgerItems.length} 款 · 累计采购 ¥{formatMoney(supplierCumulTotals[selectedSupplierView] ?? 0)}</Text>
            </ScrollView>
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

          <View style={[S.searchBox, { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16, marginTop: 8 }]}>
            <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
            <TextInput value={purchaseSearchQuery} onChangeText={setPurchaseSearchQuery} placeholder="搜索商品名称、供应商或日期…" placeholderTextColor={colors.muted} style={[S.searchInput, { color: colors.foreground }]} returnKeyType="search" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>排序</Text>
            {([ ["date", "日期"], ["name", "商品名称"], ["quantity", "数量"], ["unitPrice", "单价"], ["amount", "总价"] ] as const).map(([key, label]) => {
              const active = purchaseSort.key === key;
              return <TouchableOpacity key={key} testID={`wine-purchase-sort-${key}`} onPress={() => setPurchaseSort((current) => toggleSort(current, key))} style={[S.filterChip, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}><Text style={[S.filterChipText, { color: active ? "#fff" : colors.muted }]}>{label}{active ? (purchaseSort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</Text></TouchableOpacity>;
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => { tap(); router.push("/wine-inventory-import" as any); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>导入完整 Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openDangerousAction("clear")} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "600" }}>强制清空本月</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => {
              tap();
              const supplier = purchaseFilterSupplier ?? allSuppliers[0];
              if (!supplier) { Alert.alert("提示", "请先在葡萄酒库建立酒款或采购管理资料后再录入进货。"); return; }
              setActiveSupplierForEntry(supplier);
              setShowPurchaseSheet(true);
            }} style={[S.actionBtn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1 }]}>
              <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>{purchaseFilterSupplier ? `向 ${purchaseFilterSupplier} 录入` : "选择供应商后录入"}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="wine-purchase-select-mode" onPress={() => { tap(); setSelectMode((enabled) => { if (enabled) setSelectedIds(new Set()); return !enabled; }); }} style={[S.actionBtn, { backgroundColor: selectMode ? colors.primary : colors.surface, borderColor: selectMode ? colors.primary : colors.border }]}>
              <Text style={{ fontSize: 12, color: selectMode ? "#fff" : colors.muted, fontWeight: "600" }}>{selectMode ? `已选 ${selectedIds.size}` : "多选"}</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* 批量操作只有主动进入多选模式后出现。 */}
          {selectMode && (
            <View testID="wine-purchase-bulk-toolbar" style={{ backgroundColor: colors.primary + "0D", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>已选 {selectedIds.size}/{monthPurchaseRecords.length}</Text>
                <TouchableOpacity onPress={() => setSelectedIds(new Set(monthPurchaseRecords.map((purchase) => purchase.id)))} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>全选</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setSelectedIds(new Set())} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>清空选择</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setSelectedIds(new Set()); setSelectMode(false); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>取消多选</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { if (!selectedIds.size) { Alert.alert("提示", "请先勾选记录"); return; } setBatchDate(new Date().toISOString().slice(0, 10)); setShowBatchDateModal(true); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>修改日期</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { if (!selectedIds.size) { Alert.alert("提示", "请先勾选记录"); return; } setBatchEditValue(purchaseFilterSupplier ?? ""); setBatchEditField("supplier"); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>修改供应商</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { if (!selectedIds.size) { Alert.alert("提示", "请先勾选记录"); return; } setBatchEditValue(""); setBatchEditField("quantity"); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>修改数量</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { if (!selectedIds.size) { Alert.alert("提示", "请先勾选记录"); return; } setBatchEditValue(""); setBatchEditField("unitPrice"); }} style={[S.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>修改单价</Text></TouchableOpacity>
                <TouchableOpacity onPress={handleBatchDelete} style={[S.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}><Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>删除</Text></TouchableOpacity>
              </ScrollView>
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
            <View style={S.purchaseLedgerWrap}>
              <Text style={{ fontSize: STORE_TABLE_METRICS.bodyFontSize, color: colors.muted, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
                共 {monthPurchaseRecords.length} 条 · 合计 {formatStoreMoney(monthPurchaseRecords.reduce((sum, purchase) => sum + purchase.amount, 0))}
              </Text>
              <VirtualizedHorizontalLedgerTable
                testID="wine-purchase-ledger-table"
                columns={purchaseLedgerColumns}
                groups={purchaseLedgerGroups}
                rowKey={(row) => row.id}
                sort={purchaseSort}
                onSort={(key) => setPurchaseSort((current) => toggleSort(current, key as WinePurchaseSortKey))}
                showGroupHeaders={false}
              />
            </View>
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

          <Text style={[S.sectionTitle, { color: colors.muted, marginTop: snapshots.length >= 1 ? 16 : 0 }]}>供应商月度与累计进货</Text>
          {supplierPurchaseSummaries.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>当前及历史月份暂无采购流水。</Text> : supplierPurchaseSummaries.map((summary) => (
            <View key={summary.supplier} style={[S.summarySupRow, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 }]}>
              <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{summary.supplier}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>本月 {summary.monthQty} 瓶 · 累计 {summary.cumulativeQty} 瓶 · {summary.productCount} 款酒</Text></View>
              <View style={{ alignItems: "flex-end" }}><Text style={{ color: colors.primary, fontSize: 13, fontWeight: "800" }}>¥{formatMoney(summary.monthAmount)}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>累计 ¥{formatMoney(summary.cumulativeAmount)}</Text></View>
            </View>
          ))}

          <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 20 }]}>酒款月度与累计进货</Text>
          {productPurchaseSummaries.slice(0, 12).map((summary) => (
            <View key={`${summary.supplier}-${summary.productName}`} style={[S.summarySupRow, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 }]}>
              <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>{summary.productName}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>{summary.supplier} · 本月 {summary.monthQty} 瓶 · 累计 {summary.cumulativeQty} 瓶</Text></View>
              <View style={{ alignItems: "flex-end" }}><Text style={{ color: colors.primary, fontSize: 13, fontWeight: "800" }}>¥{formatMoney(summary.monthAmount)}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>累计 ¥{formatMoney(summary.cumulativeAmount)}</Text></View>
            </View>
          ))}

          {/* 快照历史 */}
          <Text style={[S.sectionTitle, { color: colors.muted, marginTop: 20 }]}>月度快照（{snapshots.length} 份）</Text>
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
        onCreateWine={({ name, quantity, unitPrice, date }) => {
          const exists = bottles.some((bottle) => normalizeWineIdentity(bottle.name) === normalizeWineIdentity(name) && bottle.supplier === activeSupplierForEntry);
          if (exists) { Alert.alert("酒款已存在", "该供应商下已有同名葡萄酒款，请直接使用上方现有酒款行录入采购。 "); return; }
          const bottleId = wineUuid();
          const category = categoryProfiles.find((profile) => !profile.archived)?.name ?? "其他";
          const categoryColor = categoryProfiles.find((profile) => profile.name === category)?.color;
          try {
            const now = new Date().toISOString();
            const snapshot = appendWineFirstPurchaseInventory(latestSnapshot, { month: selectedMonth, supplier: activeSupplierForEntry, category, categoryColor, name, bottleId, quantity, unitCost: unitPrice }, { now, date, snapshotId: `wine-first-purchase-${Date.now()}` });
            addBottle({ id: bottleId, name, nameEn: "", vintage: "", region: "", grape: "", winery: "", style: "other", abv: null, costPrice: unitPrice, salePrice: null, stock: quantity, rating: null, notes: "由进货录入创建", photoUri: "", supplier: activeSupplierForEntry, purchaseChannelProjections: [] });
            if (latestSnapshot) updateSnapshot(latestSnapshot.id, snapshot);
            else addSnapshot(snapshot);
            addManualPurchase({ date, supplier: activeSupplierForEntry, bottleId, category, inventoryItemSeq: snapshot.items.find((item) => item.bottleId === bottleId)?.seq, linkConfidence: "confirmed", productName: name, unitPrice, quantity, amount: quantity * unitPrice, notes: "新建葡萄酒款的首笔采购" });
            Alert.alert("已新增并入库", `「${name}」已创建真实葡萄酒档案、写入库存台账，并记录 ${date} 的首笔采购。`);
          } catch (error) {
            Alert.alert("无法新增并入库", error instanceof Error ? error.message : "请检查数据后重试。");
          }
        }}
      />

      <InitialWineInventorySheet
        visible={showInitialInventorySheet}
        month={selectedMonth}
        suppliers={allSuppliers}
        categories={categoryProfiles.filter((category) => !category.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((category) => ({ name: category.name, color: category.color }))}
        colors={colors}
        onClose={() => setShowInitialInventorySheet(false)}
        onSave={handleCreateInitialInventory}
      />

      {/* 批量修改供应商、数量或单价：底层会原子更新，并在数量/单价变化时重算总价。 */}
      <Modal visible={batchEditField !== null} transparent animationType="fade" onRequestClose={() => setBatchEditField(null)}>
        <View style={{ flex: 1, backgroundColor: "#00000066", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 16, padding: 24, width: "100%", maxWidth: 340 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>
              {batchEditField === "supplier" ? "批量修改供应商" : batchEditField === "quantity" ? "批量修改数量" : "批量修改单价"}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>将更新已选中的 {selectedIds.size} 条进货记录。</Text>
            <TextInput
              value={batchEditValue}
              onChangeText={setBatchEditValue}
              autoFocus
              placeholder={batchEditField === "supplier" ? "供应商名称" : batchEditField === "quantity" ? "数量（瓶）" : "单价（元）"}
              placeholderTextColor={colors.muted}
              keyboardType={batchEditField === "supplier" ? "default" : "decimal-pad"}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, backgroundColor: colors.surface, marginBottom: 20 }}
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable onPress={() => { setBatchEditField(null); setBatchEditValue(""); }} style={{ flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}><Text style={{ color: colors.muted }}>取消</Text></Pressable>
              <Pressable onPress={handleBatchEdit} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "600" }}>确认修改</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

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

      {/* 强制操作必须输入月份口令，避免误触清空或重算。 */}
      <Modal transparent visible={dangerousAction !== null} animationType="fade" onRequestClose={() => setDangerousAction(null)}>
        <View style={{ flex: 1, backgroundColor: "#00000066", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800" }}>
              {dangerousAction === "clear" ? "强制清空本月进货" : "强制重新计算本月库存"}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
              {dangerousAction === "clear"
                ? `将清空 ${selectedMonth} 的所有采购流水；不会删除葡萄酒资料库或其他月份。系统会先创建恢复点。`
                : `将保留 ${selectedMonth} 的期初和期末盘点输入，并从唯一采购流水重建所有派生字段。系统会先创建恢复点。`}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 16 }}>请输入“{dangerousAction === "clear" ? `清空 ${selectedMonth}` : `重算 ${selectedMonth}`}”确认</Text>
            <TextInput
              value={dangerousConfirmation}
              onChangeText={setDangerousConfirmation}
              autoCapitalize="none"
              placeholder={dangerousAction === "clear" ? `清空 ${selectedMonth}` : `重算 ${selectedMonth}`}
              placeholderTextColor={colors.muted}
              style={{ marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.background }}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setDangerousAction(null)} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
                <Text style={{ color: colors.muted, fontWeight: "700" }}>取消</Text>
              </Pressable>
              <Pressable onPress={confirmDangerousAction} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderRadius: 10 }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>确认执行</Text>
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

      <Modal visible={showWineLinkPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowWineLinkPicker(false)}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}><Pressable onPress={() => setShowWineLinkPicker(false)}><Text style={[S.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable><Text style={[S.sheetTitle, { color: colors.foreground }]}>人工链接葡萄酒档案</Text><View style={{ width: 34 }} /></View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 + insets.bottom }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 12 }}>从真实葡萄酒档案库中选择一款确认关联。库存名称不会再自行猜测跳转。</Text>
            {bottles.map((bottle) => <TouchableOpacity key={bottle.id} testID={`wine-manual-link-option-${bottle.id}`} onPress={() => { confirmWineBottleLink(bottle.id, "manual"); setShowWineLinkPicker(false); }} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{bottle.name}</Text><Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{[bottle.supplier, bottle.vintage, bottle.region].filter(Boolean).join(" · ") || "待补充资料"}</Text></View><IconSymbol name="chevron.right" size={14} color={colors.muted} /></TouchableOpacity>)}
            {bottles.length === 0 && <Text style={{ color: colors.muted, textAlign: "center", paddingTop: 32 }}>葡萄酒档案库暂无酒款，请先新建档案。</Text>}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showSupplierManager} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowSupplierManager(false)}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowSupplierManager(false)}><Text style={[S.sheetCancel, { color: colors.primary }]}>关闭</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>管理供应商</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 56 + insets.bottom }}>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>新增、编辑、排序或归档供应商。归档不改变任何历史采购记录。</Text>
            <View style={[S.entryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput value={supplierDraftName} onChangeText={setSupplierDraftName} placeholder="供应商中文名称" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
              <TextInput value={supplierDraftEn} onChangeText={setSupplierDraftEn} placeholder="英文名称（可选）" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 8 }]} />
              <TextInput value={supplierDraftAliases} onChangeText={setSupplierDraftAliases} placeholder="别名（逗号分隔，可选）" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 8 }]} />
              <TextInput value={supplierDraftContactName} onChangeText={setSupplierDraftContactName} placeholder="联系人（可选）" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 8 }]} />
              <TextInput value={supplierDraftContactPhone} onChangeText={setSupplierDraftContactPhone} placeholder="联系电话（可选）" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 8 }]} />
              <TextInput value={supplierDraftNotes} onChangeText={setSupplierDraftNotes} placeholder="备注（可选）" placeholderTextColor={colors.muted} multiline style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, marginTop: 8, minHeight: 64, textAlignVertical: "top" }]} />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {editingSupplierId && <Pressable onPress={() => { setEditingSupplierId(null); setSupplierDraftName(""); setSupplierDraftEn(""); setSupplierDraftAliases(""); setSupplierDraftContactName(""); setSupplierDraftContactPhone(""); setSupplierDraftNotes(""); }} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.background, borderColor: colors.border }]}><Text style={{ color: colors.muted }}>取消编辑</Text></Pressable>}
                <Pressable onPress={saveSupplierProfile} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>{editingSupplierId ? "保存供应商" : "新增供应商"}</Text></Pressable>
              </View>
            </View>
            {supplierProfiles.filter((supplier) => !supplier.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((supplier, index, list) => (
              <View key={supplier.id} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{supplier.name}</Text>{supplier.nameEn ? <Text style={{ color: colors.muted, fontSize: 11 }}>{supplier.nameEn}</Text> : null}{supplier.aliases.length > 0 ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>别名：{supplier.aliases.join("、")}</Text> : null}{[supplier.contactName, supplier.contactPhone].filter(Boolean).length > 0 ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>{[supplier.contactName, supplier.contactPhone].filter(Boolean).join(" · ")}</Text> : null}</View>
                <TouchableOpacity disabled={index === 0} onPress={() => reorderSuppliers([...list.slice(0, index - 1), supplier, list[index - 1], ...list.slice(index + 1)])} style={{ padding: 8, opacity: index === 0 ? 0.35 : 1 }}><Text style={{ color: colors.primary }}>↑</Text></TouchableOpacity>
                <TouchableOpacity disabled={index === list.length - 1} onPress={() => reorderSuppliers([...list.slice(0, index), list[index + 1], supplier, ...list.slice(index + 2)])} style={{ padding: 8, opacity: index === list.length - 1 ? 0.35 : 1 }}><Text style={{ color: colors.primary }}>↓</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingSupplierId(supplier.id); setSupplierDraftName(supplier.name); setSupplierDraftEn(supplier.nameEn ?? ""); setSupplierDraftAliases(supplier.aliases.join("，")); setSupplierDraftContactName(supplier.contactName ?? ""); setSupplierDraftContactPhone(supplier.contactPhone ?? ""); setSupplierDraftNotes(supplier.notes ?? ""); }} style={{ padding: 8 }}><Text style={{ color: colors.primary }}>编辑</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => archiveSupplierProfile(supplier.id, supplier.name)} style={{ padding: 8 }}><Text style={{ color: colors.error }}>归档</Text></TouchableOpacity>
              </View>
            ))}
            {supplierProfiles.some((supplier) => supplier.archived) ? <View style={{ marginTop: 18 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>已归档供应商（历史记录仍保留）</Text>{supplierProfiles.filter((supplier) => supplier.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((supplier) => <View key={supplier.id} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.78 }]}><Text style={{ flex: 1, color: colors.muted, fontSize: 14 }}>{supplier.name}</Text><TouchableOpacity onPress={() => updateSupplier(supplier.id, { archived: false })} style={{ padding: 8 }}><Text style={{ color: colors.primary }}>恢复</Text></TouchableOpacity></View>)}</View> : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showCategoryManager} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCategoryManager(false)}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowCategoryManager(false)}><Text style={[S.sheetCancel, { color: colors.primary }]}>关闭</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>管理进销存分类</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 56 + insets.bottom }}>
            <View style={[S.entryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TextInput value={categoryDraftName} onChangeText={setCategoryDraftName} placeholder="分类名称" placeholderTextColor={colors.muted} style={[S.entryInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]} />
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>{["#64748B", "#2563EB", "#059669", "#D97706", "#7C3AED", "#DB2777"].map((color) => <TouchableOpacity key={color} onPress={() => setCategoryDraftColor(color)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: categoryDraftColor === color ? 3 : 0, borderColor: colors.foreground }} />)}</View>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {editingCategoryId && <Pressable onPress={() => { setEditingCategoryId(null); setCategoryDraftName(""); setCategoryDraftColor("#64748B"); }} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.background, borderColor: colors.border }]}><Text style={{ color: colors.muted }}>取消编辑</Text></Pressable>}
                <Pressable onPress={saveCategoryProfile} style={[S.actionBtn, { flex: 1, justifyContent: "center", backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "700" }}>{editingCategoryId ? "保存分类" : "新增分类"}</Text></Pressable>
              </View>
            </View>
            {categoryProfiles.filter((category) => !category.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((category, index, list) => (
              <View key={category.id} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: category.color, marginRight: 10 }} /><Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{category.name}</Text>
                <TouchableOpacity disabled={index === 0} onPress={() => reorderCategories([...list.slice(0, index - 1), category, list[index - 1], ...list.slice(index + 1)])} style={{ padding: 8, opacity: index === 0 ? 0.35 : 1 }}><Text style={{ color: colors.primary }}>↑</Text></TouchableOpacity>
                <TouchableOpacity disabled={index === list.length - 1} onPress={() => reorderCategories([...list.slice(0, index), list[index + 1], category, ...list.slice(index + 2)])} style={{ padding: 8, opacity: index === list.length - 1 ? 0.35 : 1 }}><Text style={{ color: colors.primary }}>↓</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => { setEditingCategoryId(category.id); setCategoryDraftName(category.name); setCategoryDraftColor(category.color); }} style={{ padding: 8 }}><Text style={{ color: colors.primary }}>编辑</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => archiveCategoryProfile(category.id, category.name)} style={{ padding: 8 }}><Text style={{ color: colors.error }}>归档</Text></TouchableOpacity>
              </View>
            ))}
            {categoryProfiles.some((category) => category.archived) ? <View style={{ marginTop: 18 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>已归档分类（历史台账分类保持不变）</Text>{categoryProfiles.filter((category) => category.archived).sort((left, right) => left.sortOrder - right.sortOrder).map((category) => <View key={category.id} style={[S.supplierBottleRow, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.78 }]}><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: category.color, marginRight: 10 }} /><Text style={{ flex: 1, color: colors.muted, fontSize: 14 }}>{category.name}</Text><TouchableOpacity onPress={() => updateCategory(category.id, { archived: false })} style={{ padding: 8 }}><Text style={{ color: colors.primary }}>恢复</Text></TouchableOpacity></View>)}</View> : null}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function SupplierMetric({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: "800" }}>{value}</Text>
      <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>{label}</Text>
    </View>
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
  statsRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  filterScroll: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontWeight: "500" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  searchInput: { flex: 1, fontSize: 14, lineHeight: 19 },
  actionBtn: { flexDirection: "row", flexShrink: 0, minHeight: INVENTORY_WORKSPACE_METRICS.actionHeight, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: INVENTORY_WORKSPACE_METRICS.segmentRadius, borderWidth: 1 },
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
  purchaseLedgerWrap: { flex: 1, minHeight: 0, paddingBottom: 8 },
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
  supplierInfoCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  supplierMetrics: { flexDirection: "row", marginTop: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#00000012" },
  supplierBottleRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  supplierPurchaseRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  libraryLinkButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginTop: 14 },
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

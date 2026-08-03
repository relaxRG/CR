/**
 * 烈酒进销存管理页（重构版）
 * 功能：
 * - 月份切换（横向滚动月份选择器）
 * - 手动增删改酒款档案
 * - 进货流水录入（单笔）
 * - Excel 导入（进货单格式：日期/品名/单位/数量/单价/金额）
 * - 台账（期初/进货/消耗/期末，支持编辑期初和消耗）
 * - 月结（期末自动带入下月期初）
 * - 三子页面：📊 总结 / 📋 库存管理 / 📦 当月进货
 */
import React, { useMemo, useState, useCallback } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useSpiritsInventoryStore, getCurrentMonth } from "@/lib/spirits/crud-store";
import { SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry, SPIRIT_CATEGORY_COLORS, SPIRIT_CATEGORIES } from "@/lib/spirits/types";
import { parseSpiritsExcel, guessCategory, ParsedPurchaseRow, previewSheets, parseSheetFromWorkbook } from "@/lib/spirits/excel-import";
import { useBottleStore } from "@/lib/bottles/store";
import { SupplierChannel, getEffectiveCostPrice } from "@/lib/bottles/types";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";

// ─── 工具 ─────────────────────────────────────────────────────────────────────
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function catColor(cat: string) { return SPIRIT_CATEGORY_COLORS[cat] ?? "#6B7280"; }

type Tab = "summary" | "ledger" | "purchase" | "supplier";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "📊 总结" },
  { key: "ledger", label: "📋 库存管理" },
  { key: "purchase", label: "📦 当月进货" },
  { key: "supplier", label: "🏢 供应商" },
];

// ─── 月份选择器 ───────────────────────────────────────────────────────────────
function MonthPicker({ months, selected, onSelect, colors }: {
  months: string[]; selected: string; onSelect: (m: string) => void; colors: any;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}>
      {months.map((m) => (
        <TouchableOpacity key={m} onPress={() => onSelect(m)}
          style={[S.monthChip, {
            backgroundColor: selected === m ? "#EF4444" : colors.surface,
            borderColor: selected === m ? "#EF4444" : colors.border,
          }]}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: selected === m ? "#fff" : colors.muted }}>
            {m.slice(0, 4)}年{Number(m.slice(5, 7))}月
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── 酒款表单 Modal ───────────────────────────────────────────────────────────
function ItemFormModal({ visible, item, colors, onSave, onClose }: {
  visible: boolean; item: SpiritItem | null; colors: any;
  onSave: (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [nameEn, setNameEn] = useState(item?.nameEn ?? "");
  const [category, setCategory] = useState(item?.category ?? "Other");
  const [unit, setUnit] = useState(item?.unit ?? "瓶");
  const [refPrice, setRefPrice] = useState(item?.refPrice ? String(item.refPrice) : "");
  const [supplier, setSupplier] = useState(item?.supplier ?? "");
  const [spec, setSpec] = useState(item?.spec ?? "");

  React.useEffect(() => {
    if (visible) {
      setName(item?.name ?? "");
      setNameEn(item?.nameEn ?? "");
      setCategory(item?.category ?? "Other");
      setUnit(item?.unit ?? "瓶");
      setRefPrice(item?.refPrice ? String(item.refPrice) : "");
      setSupplier(item?.supplier ?? "");
      setSpec(item?.spec ?? "");
    }
  }, [visible, item]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写酒款名称"); return; }
    onSave({ name: name.trim(), nameEn: nameEn.trim(), category, unit: unit.trim() || "瓶",
      refPrice: Number(refPrice) || 0, supplier: supplier.trim(), spec: spec.trim(), active: true });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>{item ? "编辑酒款" : "新增酒款"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: "#EF4444" }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            {[
              { label: "中文名 *", value: name, set: setName, placeholder: "如：添加利金酒" },
              { label: "英文名", value: nameEn, set: setNameEn, placeholder: "如：Tanqueray Gin" },
              { label: "单位", value: unit, set: setUnit, placeholder: "瓶/箱/罐" },
              { label: "参考单价（元）", value: refPrice, set: setRefPrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "供应商", value: supplier, set: setSupplier, placeholder: "可选" },
              { label: "规格", value: spec, set: setSpec, placeholder: "如：700ml" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.set} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
              </View>
            ))}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>分类</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: "center" }}>
                {SPIRIT_CATEGORIES.map((cat) => (
                  <TouchableOpacity key={cat} onPress={() => setCategory(cat)}
                    style={[S.catChip, {
                      backgroundColor: category === cat ? catColor(cat) : colors.surface,
                      borderColor: category === cat ? catColor(cat) : colors.border,
                    }]}>
                    <Text style={{ fontSize: 12, color: category === cat ? "#fff" : colors.muted }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 进货录入 Modal ───────────────────────────────────────────────────────────
function PurchaseFormModal({ visible, items, month, colors, onSave, onClose }: {
  visible: boolean; items: SpiritItem[]; month: string; colors: any;
  onSave: (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">) => void;
  onClose: () => void;
}) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [rawName, setRawName] = useState("");
  const [unit, setUnit] = useState("瓶");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const selectedItem = items.find((i) => i.id === selectedItemId);
  const amount = (Number(qty) || 0) * (Number(price) || 0);

  React.useEffect(() => {
    if (visible) {
      setSelectedItemId(""); setRawName(""); setUnit("瓶");
      setQty(""); setPrice(""); setSupplier(""); setDate(new Date().toISOString().slice(0, 10));
    }
  }, [visible]);

  React.useEffect(() => {
    if (selectedItem) {
      setRawName(selectedItem.name);
      setUnit(selectedItem.unit);
      setPrice(selectedItem.refPrice ? String(selectedItem.refPrice) : "");
      setSupplier(selectedItem.supplier ?? "");
    }
  }, [selectedItemId]);

  const handleSave = () => {
    if (!rawName.trim()) { Alert.alert("请填写商品名称"); return; }
    if (!qty || Number(qty) <= 0) { Alert.alert("请填写数量"); return; }
    const dateMonth = date.slice(0, 7);
    onSave({
      month: dateMonth, date, itemId: selectedItemId || undefined,
      rawName: rawName.trim(), unit, quantity: Number(qty),
      unitPrice: Number(price) || 0, amount: amount || Number(qty) * (Number(price) || 0),
      supplier: supplier.trim() || undefined, source: "manual",
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>录入进货</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: "#EF4444" }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            {/* 选择已有酒款 */}
            {items.length > 0 && (
              <View>
                <Text style={[S.label, { color: colors.muted }]}>选择酒款（可选，快速填入）</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0 }}
                  contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: "center" }}>
                  {items.map((it) => (
                    <TouchableOpacity key={it.id} onPress={() => setSelectedItemId(it.id === selectedItemId ? "" : it.id)}
                      style={[S.catChip, {
                        backgroundColor: selectedItemId === it.id ? "#EF4444" : colors.surface,
                        borderColor: selectedItemId === it.id ? "#EF4444" : colors.border,
                      }]}>
                      <Text style={{ fontSize: 12, color: selectedItemId === it.id ? "#fff" : colors.foreground }}>{it.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            {[
              { label: "商品名称 *", value: rawName, set: setRawName, placeholder: "如：添加利金酒 Tanqueray Gin" },
              { label: "日期", value: date, set: setDate, placeholder: "YYYY-MM-DD" },
              { label: "单位", value: unit, set: setUnit, placeholder: "瓶/箱/罐" },
              { label: "数量 *", value: qty, set: setQty, placeholder: "0", kb: "decimal-pad" as const },
              { label: "单价（元）", value: price, set: setPrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "供应商", value: supplier, set: setSupplier, placeholder: "可选" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.set} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
              </View>
            ))}
            {amount > 0 && (
              <View style={[S.totalRow, { backgroundColor: "#EF444410" }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>本次进货金额</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#EF4444" }}>¥{amount.toFixed(2)}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Excel 导入预览 Modal ─────────────────────────────────────────────────────
function ExcelPreviewModal({ visible, rows, month, supplier, totalAmount, colors, onConfirm, onClose }: {
  visible: boolean;
  rows: ParsedPurchaseRow[];
  month: string;
  supplier?: string;
  totalAmount: number;
  colors: any;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[S.sheet, { backgroundColor: colors.background }]}>
        <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[S.sheetTitle, { color: colors.foreground }]}>导入预览</Text>
          <Pressable onPress={onConfirm}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: "#EF4444" }}>确认导入</Text>
          </Pressable>
        </View>
        {/* 汇总信息 */}
        <View style={[S.previewSummary, { backgroundColor: "#EF444410", borderColor: "#EF444433" }]}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#EF4444" }}>
            {month.slice(0, 4)}年{Number(month.slice(5, 7))}月进货单
          </Text>
          {supplier && <Text style={{ fontSize: 12, color: colors.muted }}>供应商：{supplier}</Text>}
          <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
            <Text style={{ fontSize: 13, color: colors.foreground }}>共 <Text style={{ fontWeight: "700" }}>{rows.length}</Text> 条记录</Text>
            <Text style={{ fontSize: 13, color: "#EF4444" }}>合计 <Text style={{ fontWeight: "700" }}>¥{totalAmount.toFixed(2)}</Text></Text>
          </View>
        </View>
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={[S.previewRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={2}>{item.rawName}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{item.date} · {item.unit}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{item.quantity} {item.unit}</Text>
                <Text style={{ fontSize: 12, color: colors.primary }}>¥{item.unitPrice.toFixed(2)}/个</Text>
                <Text style={{ fontSize: 12, color: "#EF4444" }}>¥{item.amount.toFixed(2)}</Text>
              </View>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

// ─── 台账编辑 Modal ───────────────────────────────────────────────────────────
function LedgerEditModal({ visible, entry, item, colors, onSave, onClose }: {
  visible: boolean;
  entry: SpiritLedgerEntry | null;
  item: SpiritItem | null;
  colors: any;
  onSave: (patch: Partial<SpiritLedgerEntry>) => void;
  onClose: () => void;
}) {
  const [openingQty, setOpeningQty] = useState("");
  const [openingUnitCost, setOpeningUnitCost] = useState("");
  const [consumeQty, setConsumeQty] = useState("");

  React.useEffect(() => {
    if (visible && entry) {
      setOpeningQty(String(entry.openingQty));
      setOpeningUnitCost(String(entry.openingUnitCost));
      setConsumeQty(String(entry.consumeQty));
    }
  }, [visible, entry]);

  const handleSave = () => {
    const oQty = Number(openingQty) || 0;
    const oPrice = Number(openingUnitCost) || 0;
    const cQty = Number(consumeQty) || 0;
    const purchaseQty = entry?.purchaseQty ?? 0;
    const closingQty = oQty + purchaseQty - cQty;
    const closingUnitCost = oPrice;
    onSave({
      openingQty: oQty, openingUnitCost: oPrice, consumeQty: cQty,
      closingQty, closingUnitCost, closingCost: closingQty * closingUnitCost,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>编辑台账</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: "#EF4444" }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            {item && (
              <View style={[S.infoCard, { backgroundColor: "#EF444410", borderColor: "#EF444433" }]}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#EF4444" }}>{item.name}</Text>
                {item.nameEn && <Text style={{ fontSize: 12, color: colors.muted }}>{item.nameEn}</Text>}
                <Text style={{ fontSize: 12, color: colors.muted }}>本月进货：{entry?.purchaseQty ?? 0} {item.unit}</Text>
              </View>
            )}
            {[
              { label: "期初库存量", value: openingQty, set: setOpeningQty, hint: "上月期末自动带入，可修改" },
              { label: "期初单价（元）", value: openingUnitCost, set: setOpeningUnitCost, hint: "期初单位成本" },
              { label: "本月消耗量", value: consumeQty, set: setConsumeQty, hint: "实际消耗/使用数量" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                {f.hint && <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>{f.hint}</Text>}
                <TextInput value={f.value} onChangeText={f.set} placeholder="0"
                  placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
              </View>
            ))}
            {/* 期末预览 */}
            <View style={[S.totalRow, { backgroundColor: "#EF444410" }]}>
              <Text style={{ fontSize: 13, color: colors.muted }}>期末库存量（预览）</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#EF4444" }}>
                {(Number(openingQty) || 0) + (entry?.purchaseQty ?? 0) - (Number(consumeQty) || 0)} 瓶
              </Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SpiritsInventoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const store = useSpiritsInventoryStore();
  const {
    items, purchases, ledger,
    addItem, updateItem, deleteItem,
    addPurchase, deletePurchase, batchAddPurchases,
    upsertLedger, getMonthPurchases, getMonthLedger, getItemLedger,
    getAvailableMonths, closeMonth, syncLedgerFromPurchases,
  } = store;
  const { bottles, updateBottle } = useBottleStore();

  const [tab, setTab] = useState<Tab>("summary");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<SpiritItem | null>(null);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [showExcelPreview, setShowExcelPreview] = useState(false);
  const [excelPreviewData, setExcelPreviewData] = useState<{
    rows: ParsedPurchaseRow[]; month: string; supplier?: string; totalAmount: number;
  } | null>(null);
  const [showLedgerEdit, setShowLedgerEdit] = useState(false);
  const [editingLedgerEntry, setEditingLedgerEntry] = useState<SpiritLedgerEntry | null>(null);
  const [editingLedgerItem, setEditingLedgerItem] = useState<SpiritItem | null>(null);
  const [importing, setImporting] = useState(false);

  const availableMonths = useMemo(() => getAvailableMonths(), [purchases, ledger]);
  const monthPurchases = useMemo(() => getMonthPurchases(selectedMonth), [purchases, selectedMonth]);
  const monthLedger = useMemo(() => getMonthLedger(selectedMonth), [ledger, selectedMonth]);

  // 月度进货汇总
  const monthStats = useMemo(() => {
    const totalAmount = monthPurchases.reduce((s, p) => s + p.amount, 0);
    const totalQty = monthPurchases.reduce((s, p) => s + p.quantity, 0);
    const bySupplier: Record<string, number> = {};
    monthPurchases.forEach((p) => {
      const sup = p.supplier ?? "未知供应商";
      bySupplier[sup] = (bySupplier[sup] ?? 0) + p.amount;
    });
    return { totalAmount, totalQty, bySupplier };
  }, [monthPurchases]);

  // 台账汇总
  const ledgerStats = useMemo(() => {
    const totalClosingCost = monthLedger.reduce((s, e) => s + e.closingCost, 0);
    const totalClosingQty = monthLedger.reduce((s, e) => s + e.closingQty, 0);
    const lowStock = monthLedger.filter((e) => e.closingQty <= 2);
    return { totalClosingCost, totalClosingQty, lowStock };
  }, [monthLedger]);

  // 按分类分组的台账
  const ledgerByCategory = useMemo(() => {
    const map: Record<string, { item: SpiritItem; entry: SpiritLedgerEntry }[]> = {};
    monthLedger.forEach((entry) => {
      const item = items.find((i) => i.id === entry.itemId);
      if (!item) return;
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push({ item, entry });
    });
    return map;
  }, [monthLedger, items]);

  // Excel 导入（支持多 sheet、强化解析）
  const handleImportExcel = async () => {
    try {
      setImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setImporting(false); return; }

      const asset = result.assets[0];
      const uri = asset.uri;
      const fileName = asset.name ?? "import.xlsx";
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const XLSX = require("xlsx");
      // raw: false 让 xlsx 自动将日期格式化为字符串，避免 Excel 日期序列号问题
      const workbook = XLSX.read(base64, { type: "base64", cellDates: true, raw: false });

      // 多 sheet 处理：如果只有一个 sheet，直接解析；多个 sheet 则自动选最大的
      let targetSheet = workbook.SheetNames[0];
      if (workbook.SheetNames.length > 1) {
        const sheets = previewSheets(workbook);
        const validSheets = sheets.filter((s) => s.isValid);
        if (validSheets.length === 1) {
          targetSheet = validSheets[0].name;
        } else if (validSheets.length > 1) {
          // 选最多行的 sheet
          targetSheet = validSheets.sort((a, b) => b.rowCount - a.rowCount)[0].name;
        }
      }

      const parsed = parseSheetFromWorkbook(workbook, targetSheet, { fileName });

      if (parsed.errors.length > 0 && parsed.rows.length === 0) {
        Alert.alert("解析失败", parsed.errors.join("\n") + (parsed.warnings.length > 0 ? "\n\n警告:\n" + parsed.warnings.join("\n") : ""));
        setImporting(false); return;
      }

      if (parsed.warnings.length > 0) {
        console.warn("导入警告:", parsed.warnings);
      }

      setExcelPreviewData({
        rows: parsed.rows, month: parsed.month,
        supplier: parsed.supplier, totalAmount: parsed.totalAmount,
      });
      setShowExcelPreview(true);
    } catch (e) {
      Alert.alert("导入失败", `文件解析错误: ${String(e)}\n\n请确认文件格式为 .xlsx 或 .xls`);
    } finally {
      setImporting(false);
    }
  };

  // PDF 导入（通过 LLM 解析）
  const handleImportPdf = async () => {
    try {
      setImporting(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) { setImporting(false); return; }

      const asset = result.assets[0];
      const uri = asset.uri;
      const fileName = asset.name ?? "invoice.pdf";

      Alert.alert("正在解析", `AI 正在识别 PDF 进货单内容...\n文件：${fileName}\n\n通常需要 10-20 秒`);

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

      // 调用 tRPC parseInvoice.parse 端点
      const apiBase = getApiBaseUrl();
      const token = await Auth.getSessionToken();
      const trpcUrl = `${apiBase}/api/trpc/parseInvoice.parse`;

      const trpcRes = await fetch(trpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          json: { pdfBase64: base64, fileName },
        }),
      });

      if (!trpcRes.ok) {
        const errText = await trpcRes.text();
        Alert.alert("解析失败", `服务器错误 (${trpcRes.status}): ${errText.slice(0, 200)}`);
        setImporting(false); return;
      }

      const trpcData = await trpcRes.json() as { result?: { data?: { json?: any } } };
      const parsed = trpcData?.result?.data?.json;

      if (!parsed || !parsed.success || !parsed.rows?.length) {
        const errMsg = parsed?.errors?.join("\n") ?? "未能识别进货记录";
        Alert.alert("解析失败", `PDF 内容无法识别为进货单格式。\n\n${errMsg}\n\n建议使用 Excel 格式导入以获得更高精度。`);
        setImporting(false); return;
      }

      // 为 PDF 解析结果补充 category 字段
      const enrichedRows: ParsedPurchaseRow[] = parsed.rows.map((r: any) => ({
        ...r,
        category: guessCategory(r.rawName),
      }));

      setExcelPreviewData({
        rows: enrichedRows,
        month: parsed.month,
        supplier: parsed.supplier,
        totalAmount: parsed.totalAmount,
      });
      setShowExcelPreview(true);
    } catch (e) {
      Alert.alert("导入失败", `PDF 解析错误: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = () => {
    if (!excelPreviewData) return;
    const { rows, month } = excelPreviewData;

    // 自动匹配或创建酒款档案
    const nameToItemId: Record<string, string> = {};
    items.forEach((it) => { nameToItemId[it.name] = it.id; });

    const records: Omit<SpiritPurchaseRecord, "id" | "createdAt">[] = rows.map((row) => {
      // 尝试匹配已有酒款（精确匹配或包含匹配）
      let itemId: string | undefined;
      const lowerName = row.rawName.toLowerCase();
      for (const [name, id] of Object.entries(nameToItemId)) {
        if (lowerName.includes(name.toLowerCase()) || name.toLowerCase().includes(lowerName.split("/")[0].trim().toLowerCase())) {
          itemId = id;
          break;
        }
      }
      // 如果没有匹配到，自动创建新酒款
      if (!itemId) {
        const nameParts = row.rawName.split("/");
        const zhName = nameParts[0].trim();
        const enName = nameParts[1]?.trim() ?? "";
        const category = guessCategory(row.rawName);
        const newItem = addItem({
          name: zhName, nameEn: enName, category,
          unit: row.unit, refPrice: row.unitPrice,
          supplier: row.supplier, active: true,
        });
        itemId = newItem.id;
        nameToItemId[zhName] = itemId;
      }
      return {
        month: row.month, date: row.date, itemId,
        rawName: row.rawName, unit: row.unit,
        quantity: row.quantity, unitPrice: row.unitPrice, amount: row.amount,
        supplier: row.supplier, source: "excel" as const,
      };
    });

    batchAddPurchases(records);
    syncLedgerFromPurchases(month);
    setSelectedMonth(month);
    setShowExcelPreview(false);
    setExcelPreviewData(null);
    setTab("purchase");

    // ── 自动匹配 Bottle 库并更新渠道进货价 ──────────────────────────────────
    const supplierName = excelPreviewData?.supplier ?? "未知供应商";
    const bottleUpdateSuggestions: { bottleId: string; bottleName: string; oldPrice: number; newPrice: number; unit: string }[] = [];

    records.forEach((rec) => {
      if (!rec.itemId || rec.unitPrice <= 0) return;
      const lowerRaw = rec.rawName.toLowerCase();
      // 在 Bottle 库中模糊匹配
      const matchedBottle = bottles.find((b) => {
        const lowerZh = b.nameZh.toLowerCase();
        const lowerEn = b.nameEn.toLowerCase();
        return lowerRaw.includes(lowerZh) || lowerZh.includes(lowerRaw.split("/")[0].trim())
          || (lowerEn && (lowerRaw.includes(lowerEn) || lowerEn.includes(lowerRaw.split("/")[0].trim())));
      });
      if (!matchedBottle) return;

      const channels = matchedBottle.supplierChannels ?? [];
      const existingChannel = channels.find((c) => c.name === supplierName);
      const now = new Date().toISOString();

      if (existingChannel) {
        // 更新现有渠道的价格
        if (existingChannel.latestPrice !== rec.unitPrice) {
          const updatedChannels = channels.map((c) => {
            if (c.id !== existingChannel.id) return c;
            return {
              ...c,
              latestPrice: rec.unitPrice,
              updatedAt: now,
              priceHistory: [{ date: rec.date, price: rec.unitPrice, source: "Excel导入" }, ...(c.priceHistory ?? [])].slice(0, 10),
            };
          });
          const basisCh = updatedChannels.find((c) => c.isCostBasis);
          updateBottle(matchedBottle.id, {
            ...matchedBottle,
            supplierChannels: updatedChannels,
            priceCny: basisCh ? basisCh.latestPrice : matchedBottle.priceCny,
          });
          if (existingChannel.isCostBasis) {
            bottleUpdateSuggestions.push({
              bottleId: matchedBottle.id, bottleName: matchedBottle.nameZh,
              oldPrice: existingChannel.latestPrice, newPrice: rec.unitPrice, unit: rec.unit,
            });
          }
        }
      } else {
        // 新增渠道到 Bottle
        const newChannel: SupplierChannel = {
          id: uuid(), type: "supplier", name: supplierName,
          supplierProductName: rec.rawName, latestPrice: rec.unitPrice,
          unit: rec.unit, isCostBasis: channels.length === 0,
          priceHistory: [{ date: rec.date, price: rec.unitPrice, source: "Excel导入" }],
          createdAt: now, updatedAt: now,
        };
        const updatedChannels = [...channels, newChannel];
        updateBottle(matchedBottle.id, {
          ...matchedBottle,
          supplierChannels: updatedChannels,
          priceCny: newChannel.isCostBasis ? newChannel.latestPrice : matchedBottle.priceCny,
        });
      }
    });

    const matchCount = records.filter((r) => r.itemId).length;
    const bottleMatchCount = bottleUpdateSuggestions.length;
    let msg = `已导入 ${records.length} 条进货记录\n自动切换到 ${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
    if (matchCount > 0) msg += `\n\n✅ 已匹配 ${matchCount} 款酒到酒款档案`;
    if (bottleMatchCount > 0) {
      msg += `\n💰 ${bottleMatchCount} 款酒的成本基准价格已更新：`;
      bottleUpdateSuggestions.slice(0, 3).forEach((s) => {
        msg += `\n  ${s.bottleName}: ¥${s.oldPrice} → ¥${s.newPrice}`;
      });
    }
    Alert.alert("导入成功", msg);
  };

  const handleOpenLedgerEdit = (entry: SpiritLedgerEntry | null, item: SpiritItem) => {
    if (!entry) {
      // 创建新台账条目
      const newEntry: SpiritLedgerEntry = {
        id: uuid(), month: selectedMonth, itemId: item.id,
        openingQty: 0, openingUnitCost: item.refPrice,
        purchaseQty: monthPurchases.filter((p) => p.itemId === item.id).reduce((s, p) => s + p.quantity, 0),
        purchaseCost: monthPurchases.filter((p) => p.itemId === item.id).reduce((s, p) => s + p.amount, 0),
        consumeQty: 0, closingQty: 0, closingUnitCost: item.refPrice, closingCost: 0,
        isClosed: false, updatedAt: new Date().toISOString(),
      };
      setEditingLedgerEntry(newEntry);
    } else {
      setEditingLedgerEntry(entry);
    }
    setEditingLedgerItem(item);
    setShowLedgerEdit(true);
  };

  const handleSaveLedger = (patch: Partial<SpiritLedgerEntry>) => {
    if (!editingLedgerEntry) return;
    upsertLedger({ ...editingLedgerEntry, ...patch });
  };

  // ── 总结 Tab ────────────────────────────────────────────────────────────────
  const renderSummary = () => (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      {/* 月度概况卡片 */}
      <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[S.cardTitle, { color: colors.foreground }]}>
          {selectedMonth.slice(0, 4)}年{Number(selectedMonth.slice(5, 7))}月 · 进货概况
        </Text>
        <View style={S.statsRow}>
          {[
            { label: "进货总额", value: `¥${monthStats.totalAmount.toFixed(0)}`, color: "#EF4444" },
            { label: "进货笔数", value: `${monthPurchases.length}笔`, color: colors.primary },
            { label: "进货品种", value: `${new Set(monthPurchases.map((p) => p.rawName)).size}款`, color: colors.foreground },
          ].map((s, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>{s.label}</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", color: s.color }}>{s.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 库存概况 */}
      {monthLedger.length > 0 && (
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>库存概况</Text>
          <View style={S.statsRow}>
            {[
              { label: "期末总库存成本", value: `¥${ledgerStats.totalClosingCost.toFixed(0)}`, color: "#EF4444" },
              { label: "库存品种", value: `${monthLedger.length}款`, color: colors.foreground },
              { label: "低库存预警", value: `${ledgerStats.lowStock.length}款`, color: ledgerStats.lowStock.length > 0 ? colors.error : colors.muted },
            ].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{s.label}</Text>
                <Text style={{ fontSize: 16, fontWeight: "700", color: s.color }}>{s.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 供应商分布 */}
      {Object.keys(monthStats.bySupplier).length > 0 && (
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.cardTitle, { color: colors.foreground }]}>供应商进货分布</Text>
          {Object.entries(monthStats.bySupplier).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
            <View key={sup} style={[S.supplierRow, { borderBottomColor: colors.border }]}>
              <Text style={{ flex: 1, fontSize: 13, color: colors.foreground }}>{sup}</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#EF4444" }}>¥{amt.toFixed(0)}</Text>
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
            切换到「当月进货」录入进货记录，或导入 Excel
          </Text>
        </View>
      )}
    </ScrollView>
  );

  // ── 库存管理 Tab ─────────────────────────────────────────────────────────────
  const renderLedger = () => (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      {/* 操作按钮 */}
      <View style={[S.actionRow, { marginBottom: 12 }]}>
        <TouchableOpacity onPress={() => { tap(); setEditingItem(null); setShowItemForm(true); }}
          style={[S.actionBtn, { backgroundColor: "#EF444415", borderColor: "#EF444433" }]}>
          <IconSymbol name="plus.circle.fill" size={14} color="#EF4444" />
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>新增酒款</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => {
          tap();
          Alert.alert("月结确认", `确认对 ${selectedMonth} 进行月结？\n月结后期末库存将自动带入下月期初。`, [
            { text: "取消", style: "cancel" },
            { text: "确认月结", onPress: () => { closeMonth(selectedMonth); Alert.alert("月结完成", "期末库存已带入下月期初"); } },
          ]);
        }} style={[S.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
          <IconSymbol name="checkmark.seal.fill" size={14} color={colors.primary} />
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>月结</Text>
        </TouchableOpacity>
      </View>

      {/* 台账列表（按分类分组） */}
      {items.length === 0 ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 48 }}>🥃</Text>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有酒款档案</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>点击「新增酒款」或导入 Excel 自动创建</Text>
        </View>
      ) : (
        Object.entries(
          items.reduce((acc, item) => {
            if (!acc[item.category]) acc[item.category] = [];
            acc[item.category].push(item);
            return acc;
          }, {} as Record<string, SpiritItem[]>)
        ).map(([cat, catItems]) => (
          <View key={cat} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: catColor(cat) }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: catColor(cat) }}>{cat}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>({catItems.length} 款)</Text>
            </View>
            {catItems.map((item) => {
              const entry = getItemLedger(item.id, selectedMonth);
              const monthPurch = monthPurchases.filter((p) => p.itemId === item.id);
              const purchQty = monthPurch.reduce((s, p) => s + p.quantity, 0);
              return (
                <TouchableOpacity key={item.id}
                  onPress={() => { tap(); handleOpenLedgerEdit(entry ?? null, item); }}
                  onLongPress={() => {
                    tap();
                    Alert.alert(item.name, "选择操作", [
                      { text: "编辑酒款档案", onPress: () => { setEditingItem(item); setShowItemForm(true); } },
                      { text: "删除酒款", style: "destructive", onPress: () => {
                        Alert.alert("确认删除", `删除「${item.name}」？`, [
                          { text: "取消", style: "cancel" },
                          { text: "删除", style: "destructive", onPress: () => deleteItem(item.id) },
                        ]);
                      }},
                      { text: "取消", style: "cancel" },
                    ]);
                  }}
                  style={[S.ledgerRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    {item.nameEn && <Text style={{ fontSize: 11, color: colors.muted }}>{item.nameEn}</Text>}
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                      {entry ? (
                        <>
                          <Text style={{ fontSize: 11, color: colors.muted }}>期初 {entry.openingQty}</Text>
                          {purchQty > 0 && <Text style={{ fontSize: 11, color: colors.primary }}>进货 +{purchQty}</Text>}
                          {entry.consumeQty > 0 && <Text style={{ fontSize: 11, color: colors.warning }}>消耗 -{entry.consumeQty}</Text>}
                        </>
                      ) : (
                        <Text style={{ fontSize: 11, color: colors.muted }}>点击录入期初库存</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: entry ? (entry.closingQty <= 2 ? colors.error : colors.foreground) : colors.muted }}>
                      {entry ? `${entry.closingQty} ${item.unit}` : "—"}
                    </Text>
                    {entry && entry.closingQty <= 2 && (
                      <Text style={{ fontSize: 10, color: colors.error }}>⚠ 库存偏低</Text>
                    )}
                    <Text style={{ fontSize: 11, color: colors.muted }}>¥{item.refPrice}/{item.unit}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );

  // ── 当月进货 Tab ─────────────────────────────────────────────────────────────
  const renderPurchase = () => (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
      {/* 操作按钮 */}
      <View style={[S.actionRow, { marginBottom: 12 }]}>
        <TouchableOpacity onPress={() => { tap(); setShowPurchaseForm(true); }}
          style={[S.actionBtn, { backgroundColor: "#EF444415", borderColor: "#EF444433" }]}>
          <IconSymbol name="plus.circle.fill" size={14} color="#EF4444" />
          <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>手动录入进货</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { tap(); handleImportExcel(); }}
          disabled={importing}
          style={[S.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
          {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <IconSymbol name="square.and.arrow.down" size={14} color={colors.primary} />}
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>导入 Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { tap(); handleImportPdf(); }}
          disabled={importing}
          style={[S.actionBtn, { backgroundColor: "#8B5CF615", borderColor: "#8B5CF633" }]}>
          {importing ? <ActivityIndicator size="small" color="#8B5CF6" /> : <IconSymbol name="doc.fill" size={14} color="#8B5CF6" />}
          <Text style={{ fontSize: 12, color: "#8B5CF6", fontWeight: "600" }}>导入 PDF</Text>
        </TouchableOpacity>
      </View>

      {/* 进货汇总卡 */}
      {monthPurchases.length > 0 && (
        <View style={[S.card, { backgroundColor: "#EF444410", borderColor: "#EF444433", marginBottom: 12 }]}>
          <View style={S.statsRow}>
            {[
              { label: "本月进货总额", value: `¥${monthStats.totalAmount.toFixed(0)}`, color: "#EF4444" },
              { label: "进货笔数", value: `${monthPurchases.length}笔`, color: colors.foreground },
              { label: "进货品种", value: `${new Set(monthPurchases.map((p) => p.itemId ?? p.rawName)).size}款`, color: colors.foreground },
            ].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{s.label}</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: s.color }}>{s.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 进货记录列表 */}
      {monthPurchases.length === 0 ? (
        <View style={{ alignItems: "center", padding: 40 }}>
          <Text style={{ fontSize: 48 }}>📦</Text>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无进货记录</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>手动录入或导入 Excel 进货单</Text>
        </View>
      ) : (
        [...monthPurchases].sort((a, b) => b.date.localeCompare(a.date)).map((p) => {
          const item = items.find((i) => i.id === p.itemId);
          return (
            <TouchableOpacity key={p.id}
              onLongPress={() => {
                tap();
                Alert.alert("删除记录", `删除「${p.rawName}」的进货记录？`, [
                  { text: "取消", style: "cancel" },
                  { text: "删除", style: "destructive", onPress: () => deletePurchase(p.id) },
                ]);
              }}
              style={[S.purchaseRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{p.rawName}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{p.date}</Text>
                  {p.supplier && <Text style={{ fontSize: 11, color: colors.muted }}>{p.supplier}</Text>}
                  {p.source === "excel" && <Text style={{ fontSize: 10, color: colors.primary }}>Excel</Text>}
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{p.quantity} {p.unit}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>¥{p.unitPrice.toFixed(2)}/{p.unit}</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#EF4444" }}>¥{p.amount.toFixed(2)}</Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );

  // ── 供应商 Tab ───────────────────────────────────────────────────────────────
  const renderSupplier = () => {
    const suppliers = Object.entries(monthStats.bySupplier).sort((a, b) => b[1] - a[1]);
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {suppliers.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 48 }}>🏢</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无供应商数据</Text>
          </View>
        ) : (
          suppliers.map(([sup, amt]) => {
            const supPurchases = monthPurchases.filter((p) => (p.supplier ?? "未知供应商") === sup);
            return (
              <View key={sup} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup}</Text>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#EF4444" }}>¥{amt.toFixed(0)}</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>{supPurchases.length} 笔进货</Text>
                {supPurchases.map((p) => (
                  <View key={p.id} style={[S.supplierRow, { borderBottomColor: colors.border }]}>
                    <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }} numberOfLines={1}>{p.rawName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{p.quantity}{p.unit} × ¥{p.unitPrice.toFixed(0)}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: "#EF4444", marginLeft: 8 }}>¥{p.amount.toFixed(0)}</Text>
                  </View>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={22} color="#EF4444" />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>🥃 烈酒进销存</Text>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <TouchableOpacity onPress={() => { tap(); handleImportExcel(); }} disabled={importing}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {importing
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <IconSymbol name="tablecells" size={20} color="#EF4444" />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { tap(); handleImportPdf(); }} disabled={importing}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <IconSymbol name="doc.fill" size={20} color="#8B5CF6" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 月份选择器 */}
      <MonthPicker months={availableMonths} selected={selectedMonth} onSelect={(m) => { tap(); setSelectedMonth(m); }} colors={colors} />

      {/* Tab 切换 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8, alignItems: "center" }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
            style={[S.tabChip, {
              backgroundColor: tab === t.key ? "#EF4444" : colors.surface,
              borderColor: tab === t.key ? "#EF4444" : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 内容区 */}
      {tab === "summary" && renderSummary()}
      {tab === "ledger" && renderLedger()}
      {tab === "purchase" && renderPurchase()}
      {tab === "supplier" && renderSupplier()}

      {/* Modals */}
      <ItemFormModal visible={showItemForm} item={editingItem} colors={colors}
        onSave={(data) => { if (editingItem) updateItem(editingItem.id, data); else addItem(data); }}
        onClose={() => { setShowItemForm(false); setEditingItem(null); }} />

      <PurchaseFormModal visible={showPurchaseForm} items={items.filter((i) => i.active)}
        month={selectedMonth} colors={colors}
        onSave={(data) => { addPurchase(data); syncLedgerFromPurchases(data.month); }}
        onClose={() => setShowPurchaseForm(false)} />

      {excelPreviewData && (
        <ExcelPreviewModal visible={showExcelPreview}
          rows={excelPreviewData.rows} month={excelPreviewData.month}
          supplier={excelPreviewData.supplier} totalAmount={excelPreviewData.totalAmount}
          colors={colors} onConfirm={handleConfirmImport}
          onClose={() => { setShowExcelPreview(false); setExcelPreviewData(null); }} />
      )}

      <LedgerEditModal visible={showLedgerEdit} entry={editingLedgerEntry}
        item={editingLedgerItem} colors={colors}
        onSave={handleSaveLedger}
        onClose={() => { setShowLedgerEdit(false); setEditingLedgerEntry(null); setEditingLedgerItem(null); }} />
    </ScreenContainer>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700" },
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  tabChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  statsRow: { flexDirection: "row", gap: 8 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  ledgerRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  purchaseRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  supplierRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 10, padding: 12 },
  infoCard: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 4 },
  previewSummary: { borderRadius: 12, borderWidth: 1, padding: 14, marginHorizontal: 16, marginBottom: 8 },
  previewRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});

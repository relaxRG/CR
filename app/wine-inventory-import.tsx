/**
 * 葡萄酒进销存 Excel 导入页
 * 解析「葡萄酒盘点」「进货汇总」「进货总单」「Summary」四个工作表
 * 生成 WineMonthlySnapshot 并存入 store
 * 导入后自动同步 WineBottle 资料库（新增款 addBottle，已有款 updateBottle 更新库存和进价）
 */
import React, { useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useWineSnapshotStore, useWineStore } from "@/lib/wine/store";
import { WineInventoryItem, WinePurchaseOrderItem, WineMonthlySnapshot } from "@/lib/wine/types";
import { utils, read as xlsxRead } from "xlsx";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── Excel 解析器 ─────────────────────────────────────────────────────────────
function parseWineInventoryExcel(base64: string): WineMonthlySnapshot | null {
  try {
    const wb = xlsxRead(base64, { type: "base64", cellDates: true });

    // ── 葡萄酒盘点 ──
    const wsLedger = wb.Sheets["葡萄酒盘点"];
    const items: WineInventoryItem[] = [];
    if (wsLedger) {
      const rows = utils.sheet_to_json<any[]>(wsLedger, { header: 1, defval: null });
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const seq = r[0]; const name = r[3];
        if (!name || typeof name !== "string") continue;
        items.push({
          seq: Number(seq) || i,
          wineType: String(r[1] || ""),
          supplier: String(r[2] || ""),
          name: String(name).trim(),
          initUnitCost: Number(r[4]) || 0,
          initQty: Number(r[5]) || 0,
          initCost: Number(r[6]) || 0,
          purchaseQty: Number(r[7]) || 0,
          purchaseCost: Number(r[8]) || 0,
          endQty: Number(r[9]) || 0,
          unitCost: Number(r[10]) || 0,
          endCost: Number(r[11]) || 0,
          consumeBottles: Number(r[12]) || 0,
          consumeQty: Number(r[13]) || 0,
        });
      }
    }

    // ── 进货总单 ──
    const wsPO = wb.Sheets["进货总单"];
    const purchaseOrders: WinePurchaseOrderItem[] = [];
    if (wsPO) {
      const rows = utils.sheet_to_json<any[]>(wsPO, { header: 1, defval: null });
      for (let i = 2; i < rows.length; i++) {
        const r = rows[i];
        const dateVal = r[1]; const supplier = r[2]; const productName = r[3];
        if (!supplier || !productName) continue;
        let dateStr = "";
        if (dateVal instanceof Date) {
          dateStr = dateVal.toISOString().slice(0, 10);
        } else if (typeof dateVal === "string") {
          dateStr = dateVal.slice(0, 10);
        } else if (typeof dateVal === "number") {
          // Excel 序列日期
          const d = new Date((dateVal - 25569) * 86400 * 1000);
          dateStr = d.toISOString().slice(0, 10);
        }
        purchaseOrders.push({
          date: dateStr,
          supplier: String(supplier).trim(),
          productName: String(productName).trim(),
          unitPrice: Number(r[4]) || 0,
          quantity: Number(r[5]) || 0,
          amount: Number(r[6]) || 0,
        });
      }
    }

    // ── 供应商汇总（从 items 计算） ──
    const supplierTotals: Record<string, number> = {};
    items.forEach((item) => {
      if (item.purchaseCost > 0) {
        supplierTotals[item.supplier] = (supplierTotals[item.supplier] ?? 0) + item.purchaseCost;
      }
    });

    // ── 月份标签（从进货总单第一条日期推断） ──
    let monthLabel = "未知月份";
    if (purchaseOrders.length > 0 && purchaseOrders[0].date) {
      const d = purchaseOrders[0].date;
      const [y, m] = d.split("-");
      monthLabel = `${y}年${Number(m)}月`;
    } else if (items.length > 0) {
      // 尝试从文件名或当前时间推断
      const now = new Date();
      monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    }

    const totalPurchase = Object.values(supplierTotals).reduce((s, v) => s + v, 0);
    const totalConsume = items.reduce((s, i) => s + i.consumeQty, 0);
    const totalEndCost = items.reduce((s, i) => s + i.endCost, 0);

    return {
      id: uuid(),
      monthLabel,
      importedAt: new Date().toISOString(),
      items,
      purchaseOrders,
      supplierTotals,
      totalPurchase,
      totalConsume,
      totalEndCost,
    };
  } catch (e) {
    console.error("Excel 解析失败", e);
    return null;
  }
}

// ─── 预览行 ───────────────────────────────────────────────────────────────────
function PreviewRow({ item, colors }: { item: WineInventoryItem; colors: any }) {
  return (
    <View style={[PS.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[PS.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[PS.meta, { color: colors.muted }]}>{item.supplier} · {item.wineType}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={{ fontSize: 12, color: item.purchaseQty > 0 ? colors.primary : colors.muted }}>
          进货 {item.purchaseQty} 瓶
        </Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>期末 {item.endQty} 瓶 · ¥{item.unitCost}</Text>
      </View>
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function WineInventoryImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const { addSnapshot } = useWineSnapshotStore();
  const { bottles, addBottle, updateBottle } = useWineStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<WineMonthlySnapshot | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handlePick = async () => {
    tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setLoading(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const snapshot = parseWineInventoryExcel(base64);
      setLoading(false);
      if (!snapshot || snapshot.items.length === 0) {
        Alert.alert("解析失败", "未能识别葡萄酒盘点数据，请确认 Excel 包含「葡萄酒盘点」工作表");
        return;
      }
      setPreview(snapshot);
      setShowPreview(true);
    } catch (e) {
      setLoading(false);
      Alert.alert("导入失败", String(e));
    }
  };

  /**
   * 同步 WineBottle 资料库：
   * - 已有款（按名称精确匹配）：updateBottle 更新库存和进价
   * - 新款：addBottle 新增
   */
  const syncBottleLibrary = (items: WineInventoryItem[]) => {
    let added = 0;
    let updated = 0;
    items.forEach((item) => {
      const existing = bottles.find(
        (b) => b.name.trim() === item.name.trim()
      );
      if (existing) {
        // 更新库存和进价
        updateBottle(existing.id, {
          stock: item.endQty,
          ...(item.unitCost > 0 ? { costPrice: item.unitCost } : {}),
        });
        updated++;
      } else {
        // 新增款
        addBottle({
          name: item.name,
          nameEn: "",
          vintage: "",
          region: "",
          grape: "",
          winery: "",
          style: "other",
          abv: null,
          costPrice: item.unitCost > 0 ? item.unitCost : null,
          salePrice: null,
          stock: item.endQty,
          rating: null,
          notes: "",
          photoUri: "",
          supplier: item.supplier,
        });
        added++;
      }
    });
    return { added, updated };
  };

  const handleConfirm = () => {
    if (!preview) return;
    // 1. 存入快照
    addSnapshot(preview);
    // 2. 同步 WineBottle 资料库
    const { added, updated } = syncBottleLibrary(preview.items);
    setShowPreview(false);
    setPreview(null);
    Alert.alert(
      "导入成功",
      `已导入 ${preview.monthLabel}，共 ${preview.items.length} 款葡萄酒\n酒款库：新增 ${added} 款，更新 ${updated} 款`,
      [
        { text: "查看进销存", onPress: () => router.replace("/wine-inventory" as any) },
        { text: "继续导入" },
      ]
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[PS.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[PS.navTitle, { color: colors.foreground }]}>导入葡萄酒盘点</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {/* 说明卡片 */}
        <View style={[PS.infoCard, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
          <Text style={[PS.infoTitle, { color: colors.primary }]}>支持的 Excel 格式</Text>
          <Text style={[PS.infoText, { color: colors.muted }]}>
            工作表「葡萄酒盘点」：产品序号 / 酒类 / 盘点分类（供应商）/ 中文名 / 期初单位成本 / 期初库存量 / 期初库存成本 / 本月进货量 / 本月进货成本 / 期末库存量 / 单位成本 / 期末库存成本 / 消耗瓶数 / 本期消耗量
          </Text>
          <Text style={[PS.infoText, { color: colors.muted, marginTop: 6 }]}>
            工作表「进货总单」：行号 / 日期 / 供应商 / 商品名称 / 单价 / 数量 / 应收增加
          </Text>
          <View style={[PS.syncNote, { backgroundColor: colors.success + "18", borderColor: colors.success + "44" }]}>
            <IconSymbol name="arrow.triangle.2.circlepath" size={12} color={colors.success} />
            <Text style={[PS.syncNoteText, { color: colors.success }]}>
              导入后自动同步葡萄酒资料库（更新库存/进价，新款自动入库）
            </Text>
          </View>
        </View>

        {/* 导入按钮 */}
        <TouchableOpacity
          onPress={handlePick}
          disabled={loading}
          style={[PS.pickBtn, { backgroundColor: loading ? colors.border : colors.primary }]}
        >
          <IconSymbol name="square.and.arrow.down.fill" size={22} color="#fff" />
          <Text style={PS.pickBtnText}>{loading ? "解析中…" : "选择 Excel 文件"}</Text>
        </TouchableOpacity>

        <Text style={[PS.hint, { color: colors.muted }]}>
          支持 .xlsx 格式，文件名示例：「黎明前（2026）02葡萄酒.xlsx」
        </Text>
      </ScrollView>

      {/* 预览 Modal */}
      <Modal visible={showPreview} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPreview(false)}>
        <View style={[PS.previewSheet, { backgroundColor: colors.background }]}>
          <View style={[PS.previewHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowPreview(false)}>
              <Text style={[PS.sheetCancel, { color: colors.error }]}>取消</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[PS.previewTitle, { color: colors.foreground }]}>{preview?.monthLabel}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{preview?.items.length} 款葡萄酒</Text>
            </View>
            <Pressable onPress={handleConfirm}>
              <Text style={[PS.sheetDone, { color: colors.primary }]}>确认导入</Text>
            </Pressable>
          </View>

          {/* 汇总统计 */}
          {preview && (
            <View style={[PS.previewStats, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.primary }}>¥{preview.totalPurchase.toFixed(0)}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>本月进货</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.warning }}>¥{preview.totalConsume.toFixed(0)}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>本月消耗</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>¥{preview.totalEndCost.toFixed(0)}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>期末成本</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{Object.keys(preview.supplierTotals).length}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>活跃供应商</Text>
              </View>
            </View>
          )}

          {/* 供应商进货额 */}
          {preview && Object.entries(preview.supplierTotals).filter(([, v]) => v > 0).length > 0 && (
            <View style={[PS.supplierPreview, { borderBottomColor: colors.border }]}>
              <Text style={[PS.supplierPreviewTitle, { color: colors.muted }]}>供应商进货额</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {Object.entries(preview.supplierTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([sup, amt]) => (
                  <View key={sup} style={[PS.supChip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{sup}</Text>
                    <Text style={{ fontSize: 12, color: colors.primary }}>¥{amt.toFixed(0)}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* 台账列表 */}
          <ScrollView>
            {preview?.items.map((item) => (
              <PreviewRow key={item.seq} item={item} colors={colors} />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const PS = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  infoTitle: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  infoText: { fontSize: 12, lineHeight: 18 },
  syncNote: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderRadius: 8, borderWidth: 1, padding: 8, marginTop: 10 },
  syncNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginBottom: 12 },
  pickBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  hint: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  previewSheet: { flex: 1 },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  previewTitle: { fontSize: 17, fontWeight: "700" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  previewStats: { flexDirection: "row", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  supplierPreview: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  supplierPreviewTitle: { fontSize: 11, fontWeight: "600", marginBottom: 8, textTransform: "uppercase" },
  supChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: "center", gap: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 13, fontWeight: "500" },
  meta: { fontSize: 11, marginTop: 2 },
});

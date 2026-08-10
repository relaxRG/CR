/**
 * 烈酒进销存 Excel 导入页
 * 解析「烈酒盘点」「至缘」「戎恒」「自采」「酒类信息」「进货汇总」工作表
 * 导入后：
 * 1. 存入 SpiritMonthlySnapshot
 * 2. 智能匹配至缘商品名到 Bottle 库（记录置信度）
 * 3. 价格涨跌提示
 * 4. 自动同步 Bottle 库（更新库存/进价，新款入库）
 */
import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, ActivityIndicator
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useSpiritsSnapshotStore, useSpiritsMatchStore } from "@/lib/spirits/store";
import { useBottleStore } from "@/lib/bottles/store";
import { parseSpiritInventoryExcel } from "@/lib/spirits/excel-parser";
import { matchSpiritToBottle, confidenceColor, confidenceLabel } from "@/lib/spirits/matcher";
import {
  SpiritMonthlySnapshot, SpiritInventoryItem, SpiritPriceChange, SpiritMatchRecord
} from "@/lib/spirits/types";
import { SPIRIT_CATEGORY_COLORS } from "@/lib/spirits/types";

// ─── 预览行 ───────────────────────────────────────────────────────────────────
function PreviewRow({ item, colors }: { item: SpiritInventoryItem; colors: any }) {
  const catColor = SPIRIT_CATEGORY_COLORS[item.category] ?? SPIRIT_CATEGORY_COLORS["Other"];
  return (
    <View style={[PS.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <View style={[PS.catTag, { backgroundColor: catColor + "22" }]}>
            <Text style={[PS.catTagText, { color: catColor }]} numberOfLines={1}>{item.category}</Text>
          </View>
        </View>
        <Text style={[PS.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
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

// ─── 价格变动行 ───────────────────────────────────────────────────────────────
function PriceChangeRow({ change, colors }: { change: SpiritPriceChange; colors: any }) {
  const isUp = change.changePct > 0;
  const color = isUp ? colors.error : colors.success;
  return (
    <View style={[PS.priceRow, { borderBottomColor: colors.border }]}>
      <Text style={[PS.priceName, { color: colors.foreground }]} numberOfLines={1}>{change.name}</Text>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color }}>
          {isUp ? "▲" : "▼"} ¥{formatMoney(Math.abs(change.currPrice - change.prevPrice))}
        </Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>
          ¥{formatMoney(change.prevPrice)} → ¥{formatMoney(change.currPrice)}
        </Text>
      </View>
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function SpiritsInventoryImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const { addSnapshot } = useSpiritsSnapshotStore();
  const { upsertMatchRecord } = useSpiritsMatchStore();
  const { bottles, addBottle, bulkUpdateBottles } = useBottleStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SpiritMonthlySnapshot | null>(null);
  const [priceChanges, setPriceChanges] = useState<SpiritPriceChange[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewTab, setPreviewTab] = useState<"ledger" | "prices">("ledger");

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
      const { snapshot, infoItems, priceChanges: changes, error } = parseSpiritInventoryExcel(base64);
      setLoading(false);
      if (!snapshot || snapshot.items.length === 0) {
        Alert.alert("解析失败", error ?? "未能识别烈酒盘点数据，请确认 Excel 包含「烈酒盘点」工作表");
        return;
      }
      setPreview(snapshot);
      setPriceChanges(changes);
      setShowPreview(true);
    } catch (e) {
      setLoading(false);
      Alert.alert("导入失败", String(e));
    }
  };

  /**
   * 智能匹配至缘商品名到 Bottle 库，并记录匹配结果
   */
  const runSmartMatch = (snapshot: SpiritMonthlySnapshot) => {
    const now = new Date().toISOString();
    // 对所有至缘进货记录运行匹配
    const zyOrders = snapshot.purchaseOrders.filter((po) => po.supplier === "至缘");
    // 去重（按 rawName）
    const seen = new Set<string>();
    zyOrders.forEach((po) => {
      if (seen.has(po.rawName)) return;
      seen.add(po.rawName);
      const result = matchSpiritToBottle(po.rawName, po.nameZh, po.nameEn, bottles);
      const record: SpiritMatchRecord = {
        rawName: po.rawName,
        bottleId: result.bottleId,
        confidence: result.confidence,
        confirmed: result.confidence === "high",
        updatedAt: now,
      };
      upsertMatchRecord(record);
    });
    return seen.size;
  };

  /**
   * 同步 Bottle 库：
   * - 已有款：更新库存和进价
   * - 新款：addBottle
   */
  const syncBottleLibrary = (snapshot: SpiritMonthlySnapshot) => {
    let added = 0;
    let updated = 0;
    snapshot.items.forEach((item) => {
      const existing = bottles.find((b) => b.nameZh.trim() === item.name.trim());
      if (existing) {
        // 使用 bulkUpdateBottles 更新进价（Partial<Bottle> 接口）
        bulkUpdateBottles([existing.id], {
          ...(item.unitCost > 0 ? { priceCny: item.unitCost } : {}),
        });
        updated++;
      } else if (item.endQty > 0 || item.purchaseQty > 0) {
        // 只新增有库存或有进货的款
        addBottle({
          nameZh: item.name,
          nameEn: "",
          category: mapCategory(item.category),
          style: "",
          brand: "",
          origin: "",
          volume: "",
          abv: 0,
          priceCny: item.unitCost > 0 ? item.unitCost : 0,
          notes: "",
          flavorTags: [],
          story: "",
          styleDesc: "",
          rating: null,
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
    // 2. 智能匹配
    const matchCount = runSmartMatch(preview);
    // 3. 同步 Bottle 库
    const { added, updated } = syncBottleLibrary(preview);
    setShowPreview(false);
    setPreview(null);
    Alert.alert(
      "导入成功",
      `已导入 ${preview.monthLabel}\n` +
      `烈酒盘点：${preview.items.length} 款\n` +
      `智能匹配：${matchCount} 条至缘记录\n` +
      `酒款库：新增 ${added} 款，更新 ${updated} 款`,
      [
        { text: "查看进销存", onPress: () => router.replace("/spirits-inventory" as any) },
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
        <Text style={[PS.navTitle, { color: colors.foreground }]}>导入烈酒盘点</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {/* 说明卡片 */}
        <View style={[PS.infoCard, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
          <Text style={[PS.infoTitle, { color: colors.primary }]}>支持的 Excel 格式</Text>
          <Text style={[PS.infoText, { color: colors.muted }]}>
            工作表「烈酒盘点」：产品序号 / 盘点分类 / 中文名 / 期初库存量 / 期初单位成本 / 期初库存成本 / 本月进货量 / 本月进货成本 / 期末库存量 / 单位成本 / 期末库存成本 / 消耗瓶数 / 本期消耗量
          </Text>
          <Text style={[PS.infoText, { color: colors.muted, marginTop: 4 }]}>
            工作表「至缘/戎恒/自采」：日期 / 商品名称 / 规格 / 数量 / 单价 / 应收增加
          </Text>
          <View style={[PS.syncNote, { backgroundColor: colors.success + "18", borderColor: colors.success + "44" }]}>
            <IconSymbol name="sparkles" size={12} color={colors.success} />
            <Text style={[PS.syncNoteText, { color: colors.success }]}>
              导入后自动智能匹配至缘商品名 + 同步酒款库（更新库存/进价）
            </Text>
          </View>
        </View>

        {/* 导入按钮 */}
        <TouchableOpacity
          onPress={handlePick}
          disabled={loading}
          style={[PS.pickBtn, { backgroundColor: loading ? colors.border : colors.primary }]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <IconSymbol name="square.and.arrow.down.fill" size={22} color="#fff" />
          )}
          <Text style={PS.pickBtnText}>{loading ? "解析中…" : "选择 Excel 文件"}</Text>
        </TouchableOpacity>

        <Text style={[PS.hint, { color: colors.muted }]}>
          支持 .xlsx 格式，文件名示例：「黎明前（2026）02烈酒.xlsx」
        </Text>
      </ScrollView>

      {/* 预览 Modal */}
      <Modal visible={showPreview} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPreview(false)}>
        <View style={[PS.previewSheet, { backgroundColor: colors.background }]}>
          {/* 头部 */}
          <View style={[PS.previewHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowPreview(false)}>
              <Text style={[PS.sheetCancel, { color: colors.error }]}>取消</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[PS.previewTitle, { color: colors.foreground }]}>{preview?.monthLabel}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{preview?.items.length} 款烈酒</Text>
            </View>
            <Pressable onPress={handleConfirm}>
              <Text style={[PS.sheetDone, { color: colors.primary }]}>确认导入</Text>
            </Pressable>
          </View>

          {/* 汇总统计 */}
          {preview && (
            <View style={[PS.previewStats, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>¥{formatMoney(preview.totalPurchase)}</Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>本月进货</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.warning }}>¥{formatMoney(preview.totalConsume)}</Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>本月消耗</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>¥{formatMoney(preview.totalEndCost)}</Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>期末成本</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{preview.purchaseOrders.length}</Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>进货记录</Text>
              </View>
            </View>
          )}

          {/* 价格变动提示 */}
          {priceChanges.length > 0 && (
            <View style={[PS.priceAlert, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "44" }]}>
              <IconSymbol name="exclamationmark.triangle.fill" size={14} color={colors.warning} />
              <Text style={[PS.priceAlertText, { color: colors.warning }]}>
                {priceChanges.length} 款商品价格有变动
              </Text>
            </View>
          )}

          {/* Tab 切换 */}
          {priceChanges.length > 0 && (
            <View style={[PS.tabBar, { backgroundColor: colors.border + "33" }]}>
              <TouchableOpacity onPress={() => setPreviewTab("ledger")}
                style={[PS.tabBtn, previewTab === "ledger" && { backgroundColor: colors.background }]}>
                <Text style={[PS.tabText, { color: previewTab === "ledger" ? colors.foreground : colors.muted }]}>
                  台账（{preview?.items.length}）
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPreviewTab("prices")}
                style={[PS.tabBtn, previewTab === "prices" && { backgroundColor: colors.background }]}>
                <Text style={[PS.tabText, { color: previewTab === "prices" ? colors.warning : colors.muted }]}>
                  价格变动（{priceChanges.length}）
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 列表 */}
          <ScrollView>
            {previewTab === "ledger" && preview?.items.map((item) => (
              <PreviewRow key={item.seq} item={item} colors={colors} />
            ))}
            {previewTab === "prices" && priceChanges.map((change, i) => (
              <PriceChangeRow key={i} change={change} colors={colors} />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

/**
 * 将烈酒盘点分类映射到 Bottle 分类
 */
function mapCategory(spiritCategory: string): string {
  const cat = spiritCategory.toLowerCase();
  if (cat.includes("whisky") || cat.includes("whiskey")) return "威士忌";
  if (cat.includes("gin")) return "金酒";
  if (cat.includes("rum")) return "朗姆";
  if (cat.includes("vodka")) return "伏特加";
  if (cat.includes("tequila") || cat.includes("mezcal")) return "龙舌兰";
  if (cat.includes("brandy") || cat.includes("cognac")) return "白兰地";
  if (cat.includes("liqueur") || cat.includes("amaro") || cat.includes("aperitif")) return "利口酒";
  if (cat.includes("vermouth")) return "味美思";
  if (cat.includes("bitters")) return "苦精";
  if (cat.includes("syrup")) return "糖浆";
  if (cat.includes("juice")) return "果汁";
  if (cat.includes("soft drink") || cat.includes("beer")) return "软饮";
  if (cat.includes("absinthe")) return "利口酒";
  if (cat.includes("chinese")) return "中式白酒";
  return "利口酒";
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
  previewStats: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  priceAlert: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  priceAlertText: { fontSize: 13, fontWeight: "600" },
  tabBar: { flexDirection: "row", margin: 10, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 12, fontWeight: "500" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  catTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  catTagText: { fontSize: 10, fontWeight: "700", maxWidth: 120 },
  name: { fontSize: 13, fontWeight: "500" },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  priceName: { fontSize: 13, fontWeight: "500", flex: 1, marginRight: 8 },
});

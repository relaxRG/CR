/**
 * 葡萄酒进销存 Excel 导入页
 * 解析「葡萄酒盘点」「进货汇总」「进货总单」「Summary」四个工作表
 * 生成 WineMonthlySnapshot 并存入 store
 * 导入后自动同步 WineBottle 资料库（新增款 addBottle，已有款 updateBottle 更新库存和进价）
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
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
import { wineUuid, useWineImportControlStore, useWineManualPurchaseStore, useWineStore } from "@/lib/wine/store";
import { WineInventoryItem } from "@/lib/wine/types";
import { assessWineWorkbookImport, createWineImportBatch, createWineWorkbookSnapshot, parseWineWorkbook, WineWorkbookImportPreview } from "@/lib/wine/workbook-engine";
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";

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
  const { month: activeMonth } = useGlobalBusinessMonth();
  const { bottles, addBottle, updateBottle } = useWineStore();
  const { batches, applyWorkbookImport } = useWineImportControlStore();
  const { purchases } = useWineManualPurchaseStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<WineWorkbookImportPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const assessment = useMemo(
    () => preview ? assessWineWorkbookImport(preview, purchases, batches) : null,
    [preview, purchases, batches],
  );

  const handlePick = async () => {
    if (loading) return;
    tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if ((asset.size ?? 0) > 10 * 1024 * 1024) {
        Alert.alert("文件过大", "葡萄酒工作簿不能超过 10MB，请拆分后再导入。");
        return;
      }
      setLoading(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const parsed = await parseWineWorkbook(base64, activeMonth);
      setLoading(false);
      if (!parsed || (parsed.items.length === 0 && parsed.purchaseLines.length === 0)) {
        Alert.alert("解析失败", "未能识别葡萄酒盘点或进货总单数据，请确认工作簿包含「葡萄酒盘点」或「进货总单」工作表。");
        return;
      }
      if (parsed.month !== activeMonth) {
        Alert.alert("业务月份不一致", `该工作簿识别为 ${parsed.monthLabel}，当前葡萄酒工作台为 ${activeMonth}。请先切换到对应月份后再导入，避免跨月串账。`);
        return;
      }
      setPreview(parsed);
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
    if (!preview || !assessment) return;
    if (assessment.exactFileDuplicate) {
      Alert.alert("已阻止重复导入", `该工作簿已于 ${assessment.exactFileDuplicate.importedAt.slice(0, 16)} 导入为 ${preview.monthLabel}。如需更正，请先在当月进货执行“强制清空本月进货”，再导入。`);
      return;
    }
    if (assessment.conflicts.length > 0) {
      Alert.alert("发现冲突记录", `发现 ${assessment.conflicts.length} 条同日期、供应商与商品但数量或单价不同的记录。请先修正 Excel，避免覆盖真实采购流水。`);
      return;
    }
    const batchId = wineUuid();
    const purchaseRecords = assessment.applicablePurchaseLines.map((line) => ({
      id: wineUuid(), date: line.date, supplier: line.supplier, bottleId: null,
      productName: line.productName, unitPrice: line.unitPrice, quantity: line.quantity, amount: line.amount,
      notes: "", createdAt: new Date().toISOString(), source: "workbook" as const,
      importBatchId: batchId, importFingerprint: line.fingerprint, sourceSheet: line.sourceSheet, sourceRow: line.sourceRow,
    }));
    const snapshot = preview.items.length > 0
      ? createWineWorkbookSnapshot(wineUuid(), preview, purchaseRecords)
      : null;
    const batch = createWineImportBatch({
      id: batchId, month: preview.month, filename: "复杂葡萄酒工作簿.xlsx", fileFingerprint: preview.fileFingerprint, status: "imported",
      sourceSheets: preview.sourceSheets, parsedRows: preview.sourceRows,
      appliedRows: { inventory: preview.items.length, purchases: purchaseRecords.length, skippedDuplicates: assessment.duplicateRowIndexes.length + assessment.existingDuplicateRowIndexes.length, conflicts: assessment.conflicts.length },
    });
    applyWorkbookImport({ month: preview.month, snapshot, purchases: purchaseRecords, batch });
    const { added, updated } = syncBottleLibrary(snapshot?.items ?? []);
    setShowPreview(false);
    setPreview(null);
    Alert.alert(
      "导入成功",
      `已分配 ${preview.monthLabel} 工作簿\n库存 ${preview.items.length} 款 · 进货 ${purchaseRecords.length} 笔 · 跳过重复 ${batch.appliedRows.skippedDuplicates} 笔\n葡萄酒库：新增 ${added} 款，更新 ${updated} 款`,
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

        <TouchableOpacity
          onPress={() => {
            void import("@/lib/wine/workbook-export")
              .then(({ downloadWineWorkbookTemplate }) => downloadWineWorkbookTemplate(activeMonth))
              .catch((error) => Alert.alert("模板下载失败", String(error)));
          }}
          style={[PS.templateBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "0d" }]}
        >
          <IconSymbol name="square.and.arrow.down" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>下载完整工作簿模板</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>含葡萄酒盘点、进货总单及自动汇总页</Text>
          </View>
        </TouchableOpacity>

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
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.primary }}>¥{formatMoney(preview.totalPurchase)}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>本月进货</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.warning }}>¥{formatMoney(preview.totalConsume)}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>本月消耗</Text>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>¥{formatMoney(preview.totalEndCost)}</Text>
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
                    <Text style={{ fontSize: 12, color: colors.primary }}>¥{formatMoney(amt)}</Text>
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
  templateBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 },
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

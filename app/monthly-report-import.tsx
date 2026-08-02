/**
 * 月度经营报表导入页
 * 支持同时上传最多4个报表文件（营业概览/综合收款统计/菜品销售统计大类/菜品销售统计明细）
 * 自动识别文件类型（按文件名关键词）
 * 导入后预览 KPI 摘要，确认后存入 MonthlyReportStore
 */
import React, { useState } from "react";
import {
  Alert, ActivityIndicator, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { parseMonthlyReport } from "@/lib/store/monthly-report/excel-parser";
import { MonthlyReport } from "@/lib/store/monthly-report/types";

// ─── 文件类型识别 ─────────────────────────────────────────────────────────────
type ReportFileType = "overview" | "daily" | "dishItems" | "dishCats" | "unknown";

function detectFileType(filename: string): ReportFileType {
  const n = filename.toLowerCase();
  if (n.includes("营业概览")) return "overview";
  if (n.includes("综合收款")) return "daily";
  // 两个菜品销售统计文件，按时间戳区分（较早的是大类，较晚的是明细）
  // 或按文件名中的关键词
  if (n.includes("菜品销售统计")) {
    // 文件名中含有更大时间戳的是大类（0340），含更小时间戳的是明细（0337）
    // 实际上用文件内容区分更可靠，这里先都标为 dishItems，解析时自动区分
    return "dishItems";
  }
  return "unknown";
}

const FILE_TYPE_LABELS: Record<ReportFileType, string> = {
  overview: "营业概览",
  daily: "综合收款统计",
  dishItems: "菜品销售统计",
  dishCats: "菜品大类统计",
  unknown: "未知类型",
};

const FILE_TYPE_ICONS: Record<ReportFileType, string> = {
  overview: "chart.bar.fill",
  daily: "calendar",
  dishItems: "list.bullet",
  dishCats: "square.grid.2x2.fill",
  unknown: "doc.fill",
};

interface UploadedFile {
  name: string;
  uri: string;
  type: ReportFileType;
  base64?: string;
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function MonthlyReportImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { addReport } = useMonthlyReportStore();

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MonthlyReport | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handlePickFiles = async () => {
    tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               "application/vnd.ms-excel", "*/*"],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      setLoading(true);
      const newFiles: UploadedFile[] = [];
      for (const asset of result.assets) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const type = detectFileType(asset.name);
        newFiles.push({ name: asset.name, uri: asset.uri, type, base64 });
      }
      setFiles((prev) => {
        // 去重（按文件名）
        const existing = new Set(prev.map((f) => f.name));
        return [...prev, ...newFiles.filter((f) => !existing.has(f.name))];
      });
      setLoading(false);
    } catch (e) {
      setLoading(false);
      Alert.alert("选择文件失败", String(e));
    }
  };

  const handleRemoveFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const handleSetType = (name: string, type: ReportFileType) => {
    setFiles((prev) => prev.map((f) => f.name === name ? { ...f, type } : f));
  };

  const handleParse = async () => {
    if (files.length === 0) { Alert.alert("请先选择文件"); return; }
    tap();
    setLoading(true);
    try {
      // 按类型分配文件
      // 两个菜品销售统计文件：按文件名中的时间戳区分大类（较大时间戳）和明细（较小时间戳）
      const overviewFile = files.find((f) => f.type === "overview");
      const dailyFile = files.find((f) => f.type === "daily");
      const dishFiles = files.filter((f) => f.type === "dishItems" || f.type === "dishCats");

      // 两个菜品文件：按文件名排序，时间戳较大的是大类（0340），较小的是明细（0337）
      let dishItemsFile: UploadedFile | undefined;
      let dishCatsFile: UploadedFile | undefined;
      if (dishFiles.length >= 2) {
        const sorted = [...dishFiles].sort((a, b) => a.name.localeCompare(b.name));
        dishItemsFile = sorted[0]; // 较早（0337）= 菜品名称
        dishCatsFile = sorted[1];  // 较晚（0340）= 菜品大类
      } else if (dishFiles.length === 1) {
        dishItemsFile = dishFiles[0];
      }

      const { report, error } = parseMonthlyReport({
        overviewBase64: overviewFile?.base64,
        dailyBase64: dailyFile?.base64,
        dishItemsBase64: dishItemsFile?.base64,
        dishCatsBase64: dishCatsFile?.base64,
      });

      setLoading(false);
      if (!report) {
        Alert.alert("解析失败", error ?? "未能识别报表数据");
        return;
      }
      setPreview(report);
      setShowPreview(true);
    } catch (e) {
      setLoading(false);
      Alert.alert("解析失败", String(e));
    }
  };

  const handleConfirm = () => {
    if (!preview) return;
    addReport(preview);
    setShowPreview(false);
    setPreview(null);
    setFiles([]);
    Alert.alert(
      "导入成功",
      `${preview.monthLabel} 经营报告已导入\n营业收入 ¥${preview.kpi.revenue.toFixed(0)}\n订单量 ${preview.kpi.orderCount} 单`,
      [
        { text: "查看分析", onPress: () => router.replace("/monthly-report" as any) },
        { text: "继续导入" },
      ]
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>导入月度报表</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* 说明卡片 */}
        <View style={[S.infoCard, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
          <Text style={[S.infoTitle, { color: colors.primary }]}>支持的报表文件（美团收银系统导出）</Text>
          <View style={{ gap: 6, marginTop: 8 }}>
            {[
              { icon: "chart.bar.fill", label: "营业概览.xlsx", desc: "KPI/收款/菜品/顾客 4个工作表" },
              { icon: "calendar", label: "综合收款统计.xlsx", desc: "日度收款明细（31天）" },
              { icon: "list.bullet", label: "菜品销售统计（菜品名称）.xlsx", desc: "按菜品名称排行" },
              { icon: "square.grid.2x2.fill", label: "菜品销售统计（菜品大类）.xlsx", desc: "按大类汇总" },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <IconSymbol name={item.icon as any} size={14} color={colors.primary} />
                <View>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{item.label}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[S.infoHint, { color: colors.muted }]}>
            可同时选择多个文件，系统自动识别类型。每月只保留最新一份报告。
          </Text>
        </View>

        {/* 选择文件按钮 */}
        <TouchableOpacity onPress={handlePickFiles} disabled={loading}
          style={[S.pickBtn, { backgroundColor: loading ? colors.border : colors.primary }]}>
          {loading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="square.and.arrow.down.fill" size={20} color="#fff" />}
          <Text style={S.pickBtnText}>{loading ? "处理中…" : "选择 Excel 文件（可多选）"}</Text>
        </TouchableOpacity>

        {/* 已选文件列表 */}
        {files.length > 0 && (
          <View style={[S.fileList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[S.fileListTitle, { color: colors.foreground }]}>已选文件（{files.length}个）</Text>
            {files.map((f) => (
              <View key={f.name} style={[S.fileRow, { borderBottomColor: colors.border }]}>
                <IconSymbol name={FILE_TYPE_ICONS[f.type] as any} size={16} color={f.type === "unknown" ? colors.muted : colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[S.fileName, { color: colors.foreground }]} numberOfLines={1}>{f.name}</Text>
                  <Text style={[S.fileType, { color: f.type === "unknown" ? colors.warning : colors.success }]}>
                    {FILE_TYPE_LABELS[f.type]}
                  </Text>
                </View>
                {/* 手动修正类型 */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: 120 }}>
                  {(["overview", "daily", "dishItems", "dishCats"] as ReportFileType[]).map((t) => (
                    <TouchableOpacity key={t} onPress={() => handleSetType(f.name, t)}
                      style={[S.typeChip, {
                        backgroundColor: f.type === t ? colors.primary : colors.border + "44",
                        marginRight: 4,
                      }]}>
                      <Text style={{ fontSize: 9, color: f.type === t ? "#fff" : colors.muted }}>
                        {FILE_TYPE_LABELS[t].slice(0, 4)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Pressable onPress={() => handleRemoveFile(f.name)} style={{ padding: 4 }}>
                  <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* 解析按钮 */}
        {files.length > 0 && (
          <TouchableOpacity onPress={handleParse} disabled={loading}
            style={[S.parseBtn, { backgroundColor: loading ? colors.border : colors.success ?? "#10B981" }]}>
            {loading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="checkmark.circle.fill" size={20} color="#fff" />}
            <Text style={S.parseBtnText}>{loading ? "解析中…" : "解析并预览"}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 预览 Modal */}
      <Modal visible={showPreview} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPreview(false)}>
        <View style={[S.previewSheet, { backgroundColor: colors.background }]}>
          <View style={[S.previewHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowPreview(false)}>
              <Text style={[S.sheetCancel, { color: colors.error }]}>取消</Text>
            </Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[S.previewTitle, { color: colors.foreground }]}>{preview?.monthLabel}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>预览导入数据</Text>
            </View>
            <Pressable onPress={handleConfirm}>
              <Text style={[S.sheetDone, { color: colors.primary }]}>确认导入</Text>
            </Pressable>
          </View>

          {preview && (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {/* KPI 摘要 */}
              <View style={[S.previewKpiCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
                <Text style={[S.previewKpiTitle, { color: colors.primary }]}>营业收入</Text>
                <Text style={[S.previewKpiValue, { color: colors.foreground }]}>
                  ¥{preview.kpi.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {[
                  { label: "营业额", value: `¥${preview.kpi.turnover.toFixed(0)}` },
                  { label: "订单量", value: `${preview.kpi.orderCount}单` },
                  { label: "优惠金额", value: `¥${preview.kpi.discountAmount.toFixed(0)}` },
                  { label: "菜品销量", value: `${preview.kpi.dishSalesCount}份` },
                  { label: "退菜数量", value: `${preview.kpi.returnDishCount}份` },
                  { label: "非会员人均", value: `¥${preview.kpi.avgSpendPerPerson.toFixed(2)}` },
                ].map((item, i) => (
                  <View key={i} style={[S.previewStatCell, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{item.label}</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{item.value}</Text>
                  </View>
                ))}
              </View>

              {/* 菜品大类预览 */}
              {preview.dishCategories.length > 0 && (
                <View style={[S.previewSection, { borderColor: colors.border }]}>
                  <Text style={[S.previewSectionTitle, { color: colors.foreground }]}>
                    菜品大类（{preview.dishCategories.length}类）
                  </Text>
                  {preview.dishCategories.slice(0, 5).map((cat, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{cat.name}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>
                        ¥{cat.salesAmount.toFixed(0)} ({(cat.salesAmountPct * 100).toFixed(1)}%)
                      </Text>
                    </View>
                  ))}
                  {preview.dishCategories.length > 5 && (
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                      …还有 {preview.dishCategories.length - 5} 类
                    </Text>
                  )}
                </View>
              )}

              {/* 收款方式预览 */}
              {preview.paymentMethods.length > 0 && (
                <View style={[S.previewSection, { borderColor: colors.border }]}>
                  <Text style={[S.previewSectionTitle, { color: colors.foreground }]}>
                    收款方式（{preview.paymentMethods.length}种）
                  </Text>
                  {preview.paymentMethods.filter((p) => p.amount > 0).slice(0, 5).map((p, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{p.name}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>
                        ¥{p.amount.toFixed(0)} ({(p.pct * 100).toFixed(1)}%)
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* 日度数据预览 */}
              {preview.dailyRevenues.length > 0 && (
                <View style={[S.previewSection, { borderColor: colors.border }]}>
                  <Text style={[S.previewSectionTitle, { color: colors.foreground }]}>
                    日度收款（{preview.dailyRevenues.length}天）
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    最高：¥{Math.max(...preview.dailyRevenues.map((d) => d.total)).toFixed(0)} ·
                    最低：¥{Math.min(...preview.dailyRevenues.map((d) => d.total)).toFixed(0)} ·
                    日均：¥{(preview.dailyRevenues.reduce((s, d) => s + d.total, 0) / preview.dailyRevenues.length).toFixed(0)}
                  </Text>
                </View>
              )}

              {/* Top 菜品预览 */}
              {preview.topDishes.length > 0 && (
                <View style={[S.previewSection, { borderColor: colors.border }]}>
                  <Text style={[S.previewSectionTitle, { color: colors.foreground }]}>
                    菜品明细（{preview.topDishes.length}款）
                  </Text>
                  {preview.topDishes.slice(0, 5).map((d, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }} numberOfLines={1}>{d.name}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>
                        ¥{d.salesAmount.toFixed(0)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  infoTitle: { fontSize: 14, fontWeight: "700" },
  infoHint: { fontSize: 11, marginTop: 10, lineHeight: 16 },
  pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginBottom: 16 },
  pickBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  fileList: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  fileListTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  fileName: { fontSize: 12, fontWeight: "500" },
  fileType: { fontSize: 11, marginTop: 1 },
  typeChip: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  parseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
  parseBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  previewSheet: { flex: 1 },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  previewTitle: { fontSize: 17, fontWeight: "700" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  previewKpiCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  previewKpiTitle: { fontSize: 12 },
  previewKpiValue: { fontSize: 28, fontWeight: "800" },
  previewStatCell: { borderRadius: 10, borderWidth: 1, padding: 10, minWidth: "45%", flex: 1 },
  previewSection: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  previewSectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
});

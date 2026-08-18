/**
 * 月度经营报表导入页 (Build 135)
 * 支持9种报表类型自动识别 + 缺失检测 + 多文件同时导入
 */
import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
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
import { useDishAnalysisStore } from "@/lib/store/monthly-report/dish-analysis-store";
import { usePeriodAnalysisStore } from "@/lib/store/period-analysis/store";
import { parsePeriodAnalysisExcel } from "@/lib/store/period-analysis/excel-parser";
import {
  detectReportTypeByFilename,
  detectReportTypeByContent,
  parseDishAnalysis,
} from "@/lib/store/monthly-report/dish-analysis-parser";
import {
  ReportFileType,
  REPORT_FILE_TYPE_LABELS,
  REPORT_FILE_TYPE_DESC,
  REQUIRED_REPORT_TYPES,
  OPTIONAL_REPORT_TYPES,
} from "@/lib/store/monthly-report/dish-analysis-types";

// ─── 文件类型图标映射 ──────────────────────────────────────────────────────────
const FILE_TYPE_ICONS: Record<ReportFileType, string> = {
  overview: "chart.bar.fill",
  daily_payment: "calendar",
  dish_by_name: "list.bullet",
  dish_by_category: "square.grid.2x2.fill",
  dish_by_subcategory: "square.grid.3x3.fill",
  dish_by_spec: "list.number",
  time_slot_order: "clock.fill",
  time_slot_checkout: "clock.arrow.circlepath",
  revenue_statement: "dollarsign.circle.fill",
  unknown: "doc.fill",
};

const FILE_TYPE_COLORS: Record<ReportFileType, string> = {
  overview: "#007AFF",
  daily_payment: "#34C759",
  dish_by_name: "#FF9500",
  dish_by_category: "#5856D6",
  dish_by_subcategory: "#AF52DE",
  dish_by_spec: "#FF6B35",
  time_slot_order: "#00C7BE",
  time_slot_checkout: "#30B0C7",
  revenue_statement: "#FF2D55",
  unknown: "#8E8E93",
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i]);
    const b = chars.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? chars.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? chars.indexOf(clean[i + 3]) : -1;
    bytes[p++] = (a << 2) | (b >> 4);
    if (c >= 0) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer.slice(0, p);
}

interface UploadedFile {
  name: string;
  uri: string;
  type: ReportFileType;
  base64?: string;
  /** 是否正在识别内容 */
  detecting?: boolean;
}

// ─── 所有支持的报表（用于说明卡片） ───────────────────────────────────────────
const ALL_REPORT_TYPES: ReportFileType[] = [
  "overview",
  "daily_payment",
  "dish_by_category",
  "dish_by_subcategory",
  "dish_by_name",
  "dish_by_spec",
  "time_slot_order",
  "time_slot_checkout",
  "revenue_statement",
];

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function MonthlyReportImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { addReport } = useMonthlyReportStore();
  const { upsertSnapshot } = useDishAnalysisStore();
  const { addReport: addPeriodReport, settings: periodSettings } = usePeriodAnalysisStore();

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<MonthlyReport | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [missingTypes, setMissingTypes] = useState<ReportFileType[]>([]);
  // ─── 文件选择 ──────────────────────────────────────────────────────────────
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
        // 先按文件名识别，再按内容精确识别
        let type = detectReportTypeByFilename(asset.name);
        if (type === "unknown" || type === "dish_by_name" || type === "time_slot_order") {
          const contentType = detectReportTypeByContent(base64);
          if (contentType !== "unknown") type = contentType;
        }
        newFiles.push({ name: asset.name, uri: asset.uri, type, base64 });
      }
      setFiles((prev) => {
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

  // ─── 计算缺失报表 ──────────────────────────────────────────────────────────
  const detectedTypes = new Set(files.map((f) => f.type));
  const missing = REQUIRED_REPORT_TYPES.filter((t) => !detectedTypes.has(t));

  // ─── 解析并预览 ────────────────────────────────────────────────────────────
  const handleParse = async () => {
    if (files.length === 0) { Alert.alert("请先选择文件"); return; }
    tap();
    setLoading(true);
    try {
      // 1. 解析营业概览（传统路径，写入 MonthlyReport）
      const overviewFile = files.find((f) => f.type === "overview");
      const dailyFile = files.find((f) => f.type === "daily_payment");
      const dishNameFile = files.find((f) => f.type === "dish_by_name");
      const dishCatFile = files.find((f) => f.type === "dish_by_category");

      const { report, error } = parseMonthlyReport({
        overviewBase64: overviewFile?.base64,
        dailyBase64: dailyFile?.base64,
        dishItemsBase64: dishNameFile?.base64,
        dishCatsBase64: dishCatFile?.base64,
      });

      setLoading(false);
      if (!report) {
        Alert.alert("解析失败", error ?? "未能识别报表数据");
        return;
      }

      // 2. 解析菜品分析（新路径，写入 DishAnalysisSnapshot）
      const dishFiles = files
        .filter((f) => f.base64 && f.type !== "overview")
        .map((f) => ({ base64: f.base64!, filename: f.name }));

      if (dishFiles.length > 0) {
        const { snapshot } = parseDishAnalysis({ files: dishFiles });
        if (snapshot.month) {
          upsertSnapshot(snapshot);
        }
      }

      // 3. 同一批次的时段文件直接生成时段分析报告；不再要求用户去时段页重复上传。
      const periodFiles = files.filter((file) =>
        file.base64 && (file.type === "time_slot_order" || file.type === "time_slot_checkout"),
      );
      if (periodFiles.length > 0) {
        const periodReport = parsePeriodAnalysisExcel(
          periodFiles.map((file) => base64ToArrayBuffer(file.base64!)),
          periodSettings,
        );
        if (periodReport) addPeriodReport(periodReport);
      }

      // 4. 检测缺失报表
      const missing = REQUIRED_REPORT_TYPES.filter((t) => !detectedTypes.has(t));
      setMissingTypes(missing);
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

    if (missingTypes.length > 0) {
      Alert.alert(
        "导入成功（部分）",
        `${preview.monthLabel} 报告已导入\n\n⚠️ 以下报表尚未导入：\n${missingTypes.map((t) => `• ${REPORT_FILE_TYPE_LABELS[t]}`).join("\n")}\n\n可稍后补充导入。`,
        [
          { text: "进入报表", onPress: () => router.replace("/(tabs)/store" as any) },
          { text: "继续导入" },
        ]
      );
    } else {
      Alert.alert(
        "导入成功",
        `${preview.monthLabel} 经营报告已完整导入\n营业收入 ¥${formatMoney(preview.kpi.revenue)}\n订单量 ${preview.kpi.orderCount} 单`,
        [
          { text: "进入报表", onPress: () => router.replace("/(tabs)/store" as any) },
          { text: "继续导入" },
        ]
      );
    }
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
          <Text style={[S.infoTitle, { color: colors.primary }]}>支持的报表文件（从收银系统自行导出）</Text>
          <View style={{ gap: 8, marginTop: 10 }}>
            {/* 必要报表 */}
            <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600" }}>必要报表</Text>
            {REQUIRED_REPORT_TYPES.map((type) => (
              <View key={type} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <View style={[S.typeIconBadge, { backgroundColor: FILE_TYPE_COLORS[type] + "22" }]}>
                  <IconSymbol name={FILE_TYPE_ICONS[type] as any} size={12} color={FILE_TYPE_COLORS[type]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{REPORT_FILE_TYPE_LABELS[type]}.xlsx</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{REPORT_FILE_TYPE_DESC[type]}</Text>
                </View>
              </View>
            ))}
            {/* 可选报表 */}
            <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "600", marginTop: 4 }}>可选报表</Text>
            {OPTIONAL_REPORT_TYPES.map((type) => (
              <View key={type} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                <View style={[S.typeIconBadge, { backgroundColor: FILE_TYPE_COLORS[type] + "15" }]}>
                  <IconSymbol name={FILE_TYPE_ICONS[type] as any} size={12} color={FILE_TYPE_COLORS[type] + "99"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{REPORT_FILE_TYPE_LABELS[type]}.xlsx</Text>
                  <Text style={{ fontSize: 11, color: colors.muted + "99" }}>{REPORT_FILE_TYPE_DESC[type]}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={[S.infoHint, { color: colors.muted }]}>
            可同时选择多个文件，系统自动识别类型。每月只保留最新一份报告。
          </Text>
        </View>

        {/* 选择文件按钮 */}
        <TouchableOpacity testID="monthly-report-pick-files" onPress={handlePickFiles} disabled={loading}
          style={[S.pickBtn, { backgroundColor: loading ? colors.border : colors.primary }]}>
          {loading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="square.and.arrow.down.fill" size={20} color="#fff" />}
          <Text style={S.pickBtnText}>{loading ? "处理中…" : "选择 Excel 文件（可多选）"}</Text>
        </TouchableOpacity>

        {/* 已选文件列表 */}
        {files.length > 0 && (
          <View style={[S.fileList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={[S.fileListTitle, { color: colors.foreground }]}>已选文件（{files.length}个）</Text>
              {missing.length > 0 && (
                <View style={[S.missingBadge, { backgroundColor: colors.warning + "22" }]}>
                  <Text style={{ fontSize: 10, color: colors.warning, fontWeight: "600" }}>
                    缺失 {missing.length} 种
                  </Text>
                </View>
              )}
            </View>

            {files.map((f) => (
              <View key={f.name} style={[S.fileRow, { borderBottomColor: colors.border }]}>
                <View style={[S.typeIconBadge, { backgroundColor: FILE_TYPE_COLORS[f.type] + "22" }]}>
                  <IconSymbol name={FILE_TYPE_ICONS[f.type] as any} size={14} color={FILE_TYPE_COLORS[f.type]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.fileName, { color: colors.foreground }]} numberOfLines={1}>{f.name}</Text>
                  <Text style={[S.fileType, { color: f.type === "unknown" ? colors.warning : FILE_TYPE_COLORS[f.type] }]}>
                    {f.type === "unknown" ? "⚠️ 未识别" : `✓ ${REPORT_FILE_TYPE_LABELS[f.type]}`}
                  </Text>
                </View>
                {/* 手动修正类型 */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: 130 }}>
                  {ALL_REPORT_TYPES.map((t) => (
                    <TouchableOpacity key={t} onPress={() => handleSetType(f.name, t)}
                      style={[S.typeChip, {
                        backgroundColor: f.type === t ? FILE_TYPE_COLORS[t] : colors.border + "44",
                        marginRight: 3,
                      }]}>
                      <Text style={{ fontSize: 8, color: f.type === t ? "#fff" : colors.muted }}>
                        {REPORT_FILE_TYPE_LABELS[t].slice(0, 4)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Pressable onPress={() => handleRemoveFile(f.name)} style={{ padding: 4 }}>
                  <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ))}

            {/* 缺失报表提示 */}
            {missing.length > 0 && (
              <View style={[S.missingSection, { backgroundColor: colors.warning + "11", borderColor: colors.warning + "33" }]}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.warning, marginBottom: 4 }}>
                  ⚠️ 以下必要报表尚未选择
                </Text>
                {missing.map((t) => (
                  <Text key={t} style={{ fontSize: 11, color: colors.warning }}>
                    • {REPORT_FILE_TYPE_LABELS[t]}
                  </Text>
                ))}
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                  可以先解析已有文件，稍后补充导入缺失报表。
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 解析按钮 */}
        {files.length > 0 && (
          <TouchableOpacity testID="monthly-report-parse-files" onPress={handleParse} disabled={loading}
            style={[S.parseBtn, { backgroundColor: loading ? colors.border : "#10B981" }]}>
            {loading ? <ActivityIndicator color="#fff" /> : <IconSymbol name="checkmark.circle.fill" size={20} color="#fff" />}
            <Text style={S.parseBtnText}>{loading ? "解析中…" : `解析 ${files.length} 个文件`}</Text>
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
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {missingTypes.length === 0 ? "✓ 数据完整" : `⚠️ 缺失 ${missingTypes.length} 种报表`}
              </Text>
            </View>
            <Pressable onPress={handleConfirm}>
              <Text style={[S.sheetDone, { color: colors.primary }]}>确认导入</Text>
            </Pressable>
          </View>

          {preview && (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {/* 导入状态总览 */}
              <View style={[S.importStatusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>
                  已识别报表
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {files.filter((f) => f.type !== "unknown").map((f) => (
                    <View key={f.name} style={[S.importedBadge, { backgroundColor: FILE_TYPE_COLORS[f.type] + "22" }]}>
                      <IconSymbol name={FILE_TYPE_ICONS[f.type] as any} size={10} color={FILE_TYPE_COLORS[f.type]} />
                      <Text style={{ fontSize: 10, color: FILE_TYPE_COLORS[f.type], fontWeight: "600" }}>
                        {REPORT_FILE_TYPE_LABELS[f.type]}
                      </Text>
                    </View>
                  ))}
                </View>
                {missingTypes.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 11, color: colors.warning, fontWeight: "600" }}>缺失：</Text>
                    {missingTypes.map((t) => (
                      <Text key={t} style={{ fontSize: 11, color: colors.warning }}>• {REPORT_FILE_TYPE_LABELS[t]}</Text>
                    ))}
                  </View>
                )}
              </View>

              {/* KPI 摘要 */}
              <View style={[S.previewKpiCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
                <Text style={[S.previewKpiTitle, { color: colors.primary }]}>营业收入</Text>
                <Text style={[S.previewKpiValue, { color: colors.foreground }]}>
                  ¥{preview.kpi.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {[
                  { label: "营业额", value: `¥${formatMoney(preview.kpi.turnover)}` },
                  { label: "订单量", value: `${preview.kpi.orderCount}单` },
                  { label: "优惠金额", value: `¥${formatMoney(preview.kpi.discountAmount)}` },
                  { label: "菜品销量", value: `${preview.kpi.dishSalesCount}份` },
                  { label: "退菜数量", value: `${preview.kpi.returnDishCount}份` },
                  { label: "非会员人均", value: `¥${formatMoney(preview.kpi.avgSpendPerPerson)}` },
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
                  {preview.dishCategories.slice(0, 6).map((cat, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{cat.name}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>
                        ¥{formatMoney(cat.salesAmount)} ({(cat.salesAmountPct * 100).toFixed(1)}%)
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* 收款方式预览 */}
              {preview.paymentMethods.length > 0 && (
                <View style={[S.previewSection, { borderColor: colors.border }]}>
                  <Text style={[S.previewSectionTitle, { color: colors.foreground }]}>
                    收款方式（{preview.paymentMethods.filter((p) => p.amount > 0).length}种）
                  </Text>
                  {preview.paymentMethods.filter((p) => p.amount > 0).slice(0, 5).map((p, i) => (
                    <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{p.name}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>
                        ¥{formatMoney(p.amount)} ({(p.pct * 100).toFixed(1)}%)
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
                    最高：¥{formatMoney(Math.max(...preview.dailyRevenues.map((d) => d.total)))} ·
                    最低：¥{formatMoney(Math.min(...preview.dailyRevenues.map((d) => d.total)))} ·
                    日均：¥{formatMoney((preview.dailyRevenues.reduce((s, d) => s + d.total, 0) / preview.dailyRevenues.length))}
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
                        ¥{formatMoney(d.salesAmount)}
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
  typeIconBadge: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  pickBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16, marginBottom: 16 },
  pickBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  fileList: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  fileListTitle: { fontSize: 14, fontWeight: "700" },
  missingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  fileName: { fontSize: 12, fontWeight: "500" },
  fileType: { fontSize: 11, marginTop: 1 },
  typeChip: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 5 },
  missingSection: { borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 10 },
  parseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, paddingVertical: 16 },
  parseBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  previewSheet: { flex: 1 },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  previewTitle: { fontSize: 17, fontWeight: "700" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  importStatusCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  importedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  previewKpiCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  previewKpiTitle: { fontSize: 12 },
  previewKpiValue: { fontSize: 28, fontWeight: "800" },
  previewStatCell: { borderRadius: 10, borderWidth: 1, padding: 10, minWidth: "45%", flex: 1 },
  previewSection: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  previewSectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
});

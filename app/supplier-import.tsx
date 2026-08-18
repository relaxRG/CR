/**
 * 供应商 Excel 导入预览页
 * - 中英文拆分展示
 * - 匹配置信度标注（高/中/低/未匹配）
 * - 人工纠错：手动选择匹配、编辑名称、跳过
 * - 价格涨跌提示
 * - 确认后批量写入进销存 + 原料库
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useFoodIngredientStore, useSupplierPurchaseStore } from "@/lib/food/ingredient-store";
import { FoodIngredient, IngredientCategory, SupplierPurchaseRecord } from "@/lib/food/types";
import {
  parseSupplierExcel, matchIngredient, splitProductName,
  loadMatchMemory, saveMatchMemory, rememberMatch,
  MatchConfidence, CONFIDENCE_LABELS, CONFIDENCE_COLORS,
  ParsedRow, SupplierImportPreview,
} from "@/lib/store/supplier-import";
import { MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS, MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

// ─── 每行的导入状态 ────────────────────────────────────────────────────────────
interface RowState {
  row: ParsedRow;
  matchedId: string | null;     // 当前选中的 ingredient id
  matchScore: number;
  confidence: MatchConfidence;
  isMemorized: boolean;
  matchReason: string;
  priceDelta: number | null;    // 价格变动（元）
  prevPrice: number | null;
  skipped: boolean;             // 用户手动跳过
  /** 用户手动覆盖的中文名（用于新建原料） */
  overrideZhName: string;
  overrideEnName: string;
}

// ─── 原料选择器 Modal ──────────────────────────────────────────────────────────
function IngredientPickerModal({
  visible, ingredients, onSelect, onClose, onCreateNew, colors,
}: {
  visible: boolean;
  ingredients: FoodIngredient[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onCreateNew: () => void;
  colors: any;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q.trim()) return ingredients.slice(0, 60);
    const qn = q.toLowerCase();
    return ingredients.filter((i) =>
      i.name.toLowerCase().includes(qn) || (i.notes || "").toLowerCase().includes(qn)
    ).slice(0, 60);
  }, [ingredients, q]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[PM.container, { backgroundColor: colors.background }]}>
        <View style={[PM.header, { borderBottomColor: colors.border }]}>
          <Text style={[PM.title, { color: colors.foreground }]}>选择原料</Text>
          <Pressable onPress={onClose}><IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} /></Pressable>
        </View>
        <View style={[PM.searchRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            style={[PM.searchInput, { color: colors.foreground }]}
            placeholder="搜索原料名称..."
            placeholderTextColor={colors.muted}
            value={q} onChangeText={setQ}
          />
        </View>
        <Pressable onPress={onCreateNew} style={[PM.createBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "15" }]}>
          <IconSymbol name="plus.circle.fill" size={16} color={colors.primary} />
          <Text style={[PM.createBtnText, { color: colors.primary }]}>新建原料条目</Text>
        </Pressable>
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => { tap(); onSelect(item.id); onClose(); }}
              style={[PM.item, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[PM.itemName, { color: colors.foreground }]}>{item.name}</Text>
                {item.notes ? <Text style={[PM.itemSub, { color: colors.muted }]} numberOfLines={1}>{item.notes}</Text> : null}
              </View>
              {item.costPrice != null && (
                <Text style={[PM.itemPrice, { color: colors.primary }]}>¥{item.costPrice}/{item.unit}</Text>
              )}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={[PM.empty, { color: colors.muted }]}>无匹配原料</Text>}
        />
      </View>
    </Modal>
  );
}

// ─── 单行编辑 Modal ────────────────────────────────────────────────────────────
function RowEditModal({
  visible, rowState, onSave, onClose, colors,
}: {
  visible: boolean;
  rowState: RowState | null;
  onSave: (zhName: string, enName: string) => void;
  onClose: () => void;
  colors: any;
}) {
  const [zh, setZh] = useState(rowState?.overrideZhName ?? rowState?.row.split.zhName ?? "");
  const [en, setEn] = useState(rowState?.overrideEnName ?? rowState?.row.split.enName ?? "");
  useEffect(() => {
    if (rowState) {
      setZh(rowState.overrideZhName || rowState.row.split.zhName);
      setEn(rowState.overrideEnName || rowState.row.split.enName);
    }
  }, [rowState]);
  if (!rowState) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={EM.backdrop}>
        <View style={[EM.card, { backgroundColor: colors.surface }]}>
          <Text style={[EM.title, { color: colors.foreground }]}>编辑名称</Text>
          <Text style={[EM.label, { color: colors.muted }]}>原始名称</Text>
          <Text style={[EM.rawName, { color: colors.foreground }]}>{rowState.row.rawName}</Text>
          <Text style={[EM.label, { color: colors.muted }]}>中文名（保留品牌）</Text>
          <TextInput
            style={[EM.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            value={zh} onChangeText={setZh}
            placeholder="中文名称"
            placeholderTextColor={colors.muted}
          />
          <Text style={[EM.label, { color: colors.muted }]}>英文名</Text>
          <TextInput
            style={[EM.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
            value={en} onChangeText={setEn}
            placeholder="English name"
            placeholderTextColor={colors.muted}
          />
          <View style={EM.btnRow}>
            <Pressable onPress={onClose} style={[EM.btn, { backgroundColor: colors.border }]}>
              <Text style={{ color: colors.foreground }}>取消</Text>
            </Pressable>
            <Pressable onPress={() => { onSave(zh.trim(), en.trim()); onClose(); }}
              style={[EM.btn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>确认</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────────────────────
export default function SupplierImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ingredients, addIngredient, batchImport } = useFoodIngredientStore();
  const { addRecord } = useSupplierPurchaseStore();

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SupplierImportPreview | null>(null);
  const [rowStates, setRowStates] = useState<RowState[]>([]);
  const [memory, setMemory] = useState<Record<string, string>>({});

  // 选择器/编辑器状态
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTargetIdx, setPickerTargetIdx] = useState<number | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editTargetIdx, setEditTargetIdx] = useState<number | null>(null);

  // 聚合：同一 rawName 的所有行（用于库存累加）
  const aggregated = useMemo(() => {
    const map: Record<string, { totalQty: number; latestPrice: number; latestDate: string; unit: string }> = {};
    for (const rs of rowStates) {
      if (rs.skipped) continue;
      const key = rs.row.rawName;
      if (!map[key]) map[key] = { totalQty: 0, latestPrice: 0, latestDate: "", unit: rs.row.unit };
      map[key].totalQty += rs.row.quantity;
      if (rs.row.date >= map[key].latestDate) {
        map[key].latestPrice = rs.row.unitPrice;
        map[key].latestDate = rs.row.date;
      }
    }
    return map;
  }, [rowStates]);

  // 加载文件
  const handlePickFile = useCallback(async () => {
    try {
      setLoading(true);
      const mem = await loadMatchMemory();
      setMemory(mem);
      const pv = await parseSupplierExcel();
      if (!pv) { setLoading(false); return; }
      setPreview(pv);

      // 去重：同一 rawName 只保留一行（最新价格行）用于匹配，其余行合并数量
      const seen = new Set<string>();
      const deduped: ParsedRow[] = [];
      // 先按日期降序，保留最新
      const sorted = [...pv.rows].sort((a, b) => b.date.localeCompare(a.date));
      for (const row of sorted) {
        if (!seen.has(row.rawName)) {
          seen.add(row.rawName);
          deduped.push(row);
        }
      }
      // 重新按原始顺序排
      deduped.sort((a, b) => a.rowNo - b.rowNo);

      const states: RowState[] = deduped.map((row) => {
        const result = matchIngredient(row.rawName, row.split, ingredients, mem);
        const ing = result.ingredient;
        const prevPrice = ing?.costPrice ?? null;
        const priceDelta = prevPrice != null ? row.unitPrice - prevPrice : null;
        return {
          row,
          matchedId: ing?.id ?? null,
          matchScore: result.score,
          confidence: result.confidence,
          isMemorized: result.isMemorized,
          matchReason: result.matchReason,
          priceDelta,
          prevPrice,
          skipped: false,
          overrideZhName: "",
          overrideEnName: "",
        };
      });
      setRowStates(states);
    } catch (e: any) {
      Alert.alert("导入失败", e.message ?? "未知错误");
    } finally {
      setLoading(false);
    }
  }, [ingredients]);

  // 用户手动选择匹配
  const handlePickMatch = (idx: number) => {
    tap();
    setPickerTargetIdx(idx);
    setPickerVisible(true);
  };

  const handleMatchSelected = async (id: string) => {
    if (pickerTargetIdx == null) return;
    const rs = rowStates[pickerTargetIdx];
    const ing = ingredients.find((i) => i.id === id);
    const prevPrice = ing?.costPrice ?? null;
    const priceDelta = prevPrice != null ? rs.row.unitPrice - prevPrice : null;
    setRowStates((prev) => prev.map((r, i) =>
      i === pickerTargetIdx
        ? { ...r, matchedId: id, matchScore: 100, confidence: "high", isMemorized: false, matchReason: "手动选择", priceDelta, prevPrice }
        : r
    ));
    // 记忆
    await rememberMatch(rs.row.rawName, id);
    setMemory((m) => ({ ...m, [rs.row.rawName]: id }));
  };

  // 新建原料
  const handleCreateNew = () => {
    if (pickerTargetIdx == null) return;
    setPickerVisible(false);
    setEditTargetIdx(pickerTargetIdx);
    setEditVisible(true);
  };

  const handleEditSave = (zhName: string, enName: string) => {
    if (editTargetIdx == null) return;
    setRowStates((prev) => prev.map((r, i) =>
      i === editTargetIdx ? { ...r, overrideZhName: zhName, overrideEnName: enName } : r
    ));
  };

  // 跳过行
  const handleSkip = (idx: number) => {
    tap();
    setRowStates((prev) => prev.map((r, i) => i === idx ? { ...r, skipped: !r.skipped } : r));
  };

  // 确认导入
  const handleConfirm = async () => {
    if (!preview) return;
    tap();
    const toProcess = rowStates.filter((rs) => !rs.skipped);
    if (toProcess.length === 0) { Alert.alert("没有可导入的条目"); return; }

    // 1. 新建未匹配的原料
    const newIdMap: Record<string, string> = {};
    for (const rs of toProcess) {
      if (!rs.matchedId) {
        const zhName = rs.overrideZhName || rs.row.split.zhName || rs.row.rawName;
        const enName = rs.overrideEnName || rs.row.split.enName;
        // 自动推断分类
        const cat = inferCategory(rs.row.rawName);
        const newIng = {
          name: zhName,
          category: cat,
          spec: rs.row.split.spec,
          unit: rs.row.unit,
          costPrice: rs.row.unitPrice,
          stock: 0,
          supplier: preview.supplierName,
          notes: enName ? `英文名：${enName}` : "",
        };
        const newIngredientId = addIngredient(newIng);
        // 新增档案立即拿到稳定ID：同一批导入必须同时写入库存与月度采购台账。
        newIdMap[rs.row.rawName] = newIngredientId;
      }
    }

    // 2. 批量更新已匹配的原料（库存累加 + 价格更新）
    const updates: Parameters<typeof batchImport>[0] = [];
    const processedNames = new Set<string>();
    for (const rs of toProcess) {
      const ingredientId = rs.matchedId ?? newIdMap[rs.row.rawName];
      if (!ingredientId) continue;
      const key = rs.row.rawName;
      if (processedNames.has(key)) continue;
      processedNames.add(key);
      const agg = aggregated[key];
      updates.push({
        id: ingredientId,
        costPrice: agg?.latestPrice ?? rs.row.unitPrice,
        stockDelta: agg?.totalQty ?? rs.row.quantity,
        supplier: preview.supplierName,
        priceEntry: {
          price: agg?.latestPrice ?? rs.row.unitPrice,
          date: agg?.latestDate ?? rs.row.date,
          supplier: preview.supplierName,
          source: "import",
        },
      });
      // 更新记忆
      await rememberMatch(key, ingredientId);
    }
    if (updates.length > 0) batchImport(updates);

    // 3. 保存进货记录
    const purchaseItems = toProcess.map((rs) => ({
      rawName: rs.row.rawName,
      unit: rs.row.unit,
      quantity: aggregated[rs.row.rawName]?.totalQty ?? rs.row.quantity,
      unitPrice: rs.row.unitPrice,
      amount: rs.row.amount,
      date: rs.row.date,
      orderNo: rs.row.orderNo,
      matchedIngredientId: rs.matchedId ?? newIdMap[rs.row.rawName] ?? null,
      matchScore: rs.matchScore,
      priceDelta: rs.priceDelta,
      prevPrice: rs.prevPrice,
    }));
    const record: SupplierPurchaseRecord = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      supplierName: preview.supplierName,
      importDate: new Date().toISOString(),
      periodLabel: preview.periodLabel,
      items: purchaseItems,
      totalAmount: preview.totalAmount,
    };
    addRecord(record);

    Alert.alert(
      "导入完成",
      `已更新 ${updates.length} 个原料，新建 ${Object.keys(newIdMap).length} 个原料`,
      [{ text: "确定", onPress: () => router.back() }]
    );
  };

  // ── 渲染单行 ──────────────────────────────────────────────────────────────
  const renderRow = ({ item, index }: { item: RowState; index: number }) => {
    const { row, matchedId, confidence, matchReason, isMemorized, priceDelta, prevPrice, skipped } = item;
    const matched = matchedId ? ingredients.find((i) => i.id === matchedId) : null;
    const confColor = CONFIDENCE_COLORS[confidence];
    const agg = aggregated[row.rawName];

    return (
      <View style={[RS.card, { backgroundColor: colors.surface, borderColor: skipped ? colors.border + "44" : colors.border, opacity: skipped ? 0.5 : 1 }]}>
        {/* 行头：原始名称 + 跳过按钮 */}
        <View style={RS.rowHead}>
          <View style={{ flex: 1 }}>
            {/* 中文名 */}
            <Text style={[RS.zhName, { color: colors.foreground }]} numberOfLines={1}>
              {item.overrideZhName || row.split.zhName || row.rawName}
            </Text>
            {/* 英文名 */}
            {(item.overrideEnName || row.split.enName) ? (
              <Text style={[RS.enName, { color: colors.muted }]} numberOfLines={1}>
                {item.overrideEnName || row.split.enName}
                {row.split.spec ? <Text style={{ color: colors.muted + "99" }}>  {row.split.spec}</Text> : null}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {/* 编辑名称 */}
            <Pressable onPress={() => { tap(); setEditTargetIdx(index); setEditVisible(true); }}
              style={[RS.iconBtn, { backgroundColor: colors.border }]}>
              <IconSymbol name="pencil" size={13} color={colors.muted} />
            </Pressable>
            {/* 跳过 */}
            <Pressable onPress={() => handleSkip(index)}
              style={[RS.iconBtn, { backgroundColor: skipped ? colors.error + "22" : colors.border }]}>
              <IconSymbol name={skipped ? "arrow.triangle.2.circlepath" : "xmark.circle.fill"} size={13} color={skipped ? colors.error : colors.muted} />
            </Pressable>
          </View>
        </View>

        {/* 数量/单价/金额 */}
        <View style={RS.statsRow}>
          <Text style={[RS.stat, { color: colors.muted }]}>
            {agg ? `${agg.totalQty}${row.unit}` : `${row.quantity}${row.unit}`}
          </Text>
          <Text style={[RS.stat, { color: colors.foreground }]}>¥{row.unitPrice}/{row.unit}</Text>
          {/* 价格涨跌 */}
          {priceDelta != null && priceDelta !== 0 && (
            <View style={[RS.deltaBadge, { backgroundColor: priceDelta > 0 ? "#EF444422" : "#22C55E22" }]}>
              <IconSymbol
                name={priceDelta > 0 ? "arrow.up.to.line" : "arrow.down.to.line"}
                size={11}
                color={priceDelta > 0 ? "#EF4444" : "#22C55E"}
              />
              <Text style={[RS.deltaText, { color: priceDelta > 0 ? "#EF4444" : "#22C55E" }]}>
                {priceDelta > 0 ? "+" : ""}{priceDelta.toFixed(1)}
                {prevPrice != null ? `（原¥${prevPrice}）` : ""}
              </Text>
            </View>
          )}
          {priceDelta === 0 && prevPrice != null && (
            <Text style={[RS.stat, { color: colors.muted }]}>价格持平</Text>
          )}
          {priceDelta == null && (
            <Text style={[RS.stat, { color: colors.muted }]}>首次进货</Text>
          )}
        </View>

        {/* 匹配结果 */}
        <View style={RS.matchRow}>
          {/* 置信度标签 */}
          <View style={[RS.confBadge, { backgroundColor: confColor + "22", borderColor: confColor + "55" }]}>
            {isMemorized && <IconSymbol name="sparkles" size={10} color={confColor} />}
            <Text style={[RS.confText, { color: confColor }]}>
              {isMemorized ? "记忆" : CONFIDENCE_LABELS[confidence]}
            </Text>
          </View>
          {/* 匹配原因 */}
          <Text style={[RS.matchReason, { color: colors.muted }]} numberOfLines={1}>
            {matchReason}
          </Text>
          {/* 匹配到的原料 / 未匹配 */}
          <Pressable onPress={() => handlePickMatch(index)}
            style={[RS.matchBtn, { backgroundColor: matched ? colors.primary + "15" : colors.error + "15", borderColor: matched ? colors.primary + "44" : colors.error + "44" }]}>
            <IconSymbol name={matched ? "checkmark.circle.fill" : "plus.circle.fill"} size={13} color={matched ? colors.primary : colors.error} />
            <Text style={[RS.matchBtnText, { color: matched ? colors.primary : colors.error }]} numberOfLines={1}>
              {matched ? matched.name : "点击匹配"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  // ── 统计 ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = rowStates.filter((r) => !r.skipped);
    const high = active.filter((r) => r.confidence === "high").length;
    const med = active.filter((r) => r.confidence === "medium").length;
    const low = active.filter((r) => r.confidence === "low").length;
    const none = active.filter((r) => r.confidence === "none").length;
    const priceUp = active.filter((r) => r.priceDelta != null && r.priceDelta > 0).length;
    const priceDown = active.filter((r) => r.priceDelta != null && r.priceDelta < 0).length;
    return { total: active.length, high, med, low, none, priceUp, priceDown };
  }, [rowStates]);

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* 顶栏 */}
      <View style={[S.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={S.backBtn}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={[S.backText, { color: colors.primary }]}>返回</Text>
        </Pressable>
        <Text style={[S.title, { color: colors.foreground }]}>供应商进货导入</Text>
        {preview && (
          <Pressable onPress={handleConfirm} style={[S.confirmBtn, { backgroundColor: colors.primary }]}>
            <Text style={S.confirmText}>确认导入</Text>
          </Pressable>
        )}
      </View>

      {!preview ? (
        /* 初始选文件界面 */
        <View style={S.emptyWrap}>
          <IconSymbol name="tray.2.fill" size={56} color={colors.muted} />
          <Text style={[S.emptyTitle, { color: colors.foreground }]}>导入供应商进货单</Text>
          <Text style={[S.emptyDesc, { color: colors.muted }]}>
            支持上海创略商贸格式{"\n"}自动识别商品、中英文拆分、智能匹配原料库
          </Text>
          <Pressable onPress={handlePickFile} style={[S.pickBtn, { backgroundColor: colors.primary }]}>
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <IconSymbol name="square.and.arrow.down.fill" size={18} color="#fff" />
                <Text style={S.pickBtnText}>选择 Excel 文件</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : (
        <>
          {/* 摘要栏 */}
          <View style={[S.summaryBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <View style={S.summaryLeft}>
              <Text style={[S.supplierName, { color: colors.foreground }]}>{preview.supplierName}</Text>
              <Text style={[S.periodLabel, { color: colors.muted }]}>{preview.periodLabel}  ·  共{stats.total}种商品</Text>
            </View>
            <View style={S.summaryRight}>
              <Text style={[S.totalAmt, { color: colors.primary }]}>¥{formatMoney(preview.totalAmount)}</Text>
              <Text style={[S.totalLabel, { color: colors.muted }]}>总金额</Text>
            </View>
          </View>

          {/* 置信度统计 */}
          <View style={[S.confBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
            {[
              { label: "高置信", count: stats.high, color: CONFIDENCE_COLORS.high },
              { label: "中置信", count: stats.med, color: CONFIDENCE_COLORS.medium },
              { label: "低置信", count: stats.low, color: CONFIDENCE_COLORS.low },
              { label: "未匹配", count: stats.none, color: CONFIDENCE_COLORS.none },
              { label: "涨价", count: stats.priceUp, color: "#EF4444" },
              { label: "降价", count: stats.priceDown, color: "#22C55E" },
            ].map(({ label, count, color }) => (
              <View key={label} style={S.confStat}>
                <Text style={[S.confStatNum, { color }]}>{count}</Text>
                <Text style={[S.confStatLabel, { color: colors.muted }]}>{label}</Text>
              </View>
            ))}
          </View>

          {/* 列表 */}
          <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
            data={rowStates}
            keyExtractor={(_, i) => String(i)}
            renderItem={renderRow}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 + insets.bottom }}
          />
        </>
      )}

      {/* 原料选择器 */}
      <IngredientPickerModal
        visible={pickerVisible}
        ingredients={ingredients}
        onSelect={handleMatchSelected}
        onClose={() => setPickerVisible(false)}
        onCreateNew={handleCreateNew}
        colors={colors}
      />

      {/* 名称编辑器 */}
      <RowEditModal
        visible={editVisible}
        rowState={editTargetIdx != null ? rowStates[editTargetIdx] : null}
        onSave={handleEditSave}
        onClose={() => setEditVisible(false)}
        colors={colors}
      />
    </View>
  );
}

// ─── 分类推断 ─────────────────────────────────────────────────────────────────
function inferCategory(name: string): IngredientCategory {
  const n = name.toLowerCase();
  if (/荔枝|杨梅|葡萄|柠檬|橙|西柚|苹果|百香果|菠萝|蔓越莓|瓜|草莓|芒果|桃|梨|李|樱桃/.test(n)) return "fruit";
  if (/薄荷|迷迭香|莳萝|紫苏|罗勒|百里香|香草|香叶|花/.test(n)) return "spice";
  if (/牛奶|奶油|蛋白|乳|cream|milk|egg/.test(n)) return "dairy";
  if (/黄瓜|橄榄|花生|坚果/.test(n)) return "vegetable";
  if (/果汁|juice|汁/.test(n)) return "sauce";
  if (/抹茶|茶粉|胡椒/.test(n)) return "spice";
  return "other";
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 60 },
  backText: { fontSize: 16 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  confirmBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  confirmText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptyDesc: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  pickBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 28, marginTop: 8 },
  pickBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  summaryBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  summaryLeft: { flex: 1 },
  supplierName: { fontSize: 15, fontWeight: "700" },
  periodLabel: { fontSize: 12, marginTop: 2 },
  summaryRight: { alignItems: "flex-end" },
  totalAmt: { fontSize: 20, fontWeight: "700" },
  totalLabel: { fontSize: 11 },
  confBar: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  confStat: { flex: 1, alignItems: "center" },
  confStatNum: { fontSize: 16, fontWeight: "700" },
  confStatLabel: { fontSize: 10, marginTop: 1 },
});

const RS = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginBottom: 8 },
  rowHead: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  zhName: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  enName: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  iconBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  stat: { fontSize: 13 },
  deltaBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  deltaText: { fontSize: 12, fontWeight: "600" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  confBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  confText: { fontSize: 11, fontWeight: "600" },
  matchReason: { fontSize: 11, flex: 1 },
  matchBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, maxWidth: "60%" },
  matchBtnText: { fontSize: 12, fontWeight: "500", flex: 1 },
});

const PM = StyleSheet.create({
  container: { flex: 1, marginTop: 60, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  createBtnText: { fontSize: 14, fontWeight: "600" },
  item: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  itemName: { fontSize: 15, fontWeight: "500" },
  itemSub: { fontSize: 12, marginTop: 2 },
  itemPrice: { fontSize: 13, fontWeight: "600" },
  empty: { textAlign: "center", padding: 32, fontSize: 14 },
});

const EM = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  card: { width: "100%", borderRadius: 18, padding: 20, gap: 10 },
  title: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  label: { fontSize: 12, fontWeight: "500" },
  rawName: { fontSize: 13, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
});

/**
 * 菜品分析报表页面 (Build 135)
 *
 * 五个 Tab：
 *   大类   — 大类销售额/销量/收入占比 + 月度趋势
 *   小类   — 大类→小类下钻
 *   排行   — 全部菜品排行（可搜索/筛选/排序）
 *   规格   — 菜品规格明细
 *   对比   — 多月趋势对比
 */
import React, { useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useDishAnalysisStore } from "@/lib/store/monthly-report/dish-analysis-store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { findMonthlyReportForDishAnalysis, rebuildDishCategoriesFromMonthlyReport } from "@/lib/store/monthly-report/rebuild-dish-categories";
import { createResetActionGate } from "@/lib/store/monthly-report/reset-action-gate";
import {
  DishCategoryData, DishSubCategoryData, DishItemData, DishSpecData,
} from "@/lib/store/monthly-report/dish-analysis-types";

type MainTab = "category" | "subcategory" | "ranking" | "spec" | "compare";
type SortKey = "salesAmount" | "salesQty" | "revenue" | "discount";

const TAB_ITEMS: { key: MainTab; label: string; icon: string }[] = [
  { key: "category", label: "大类", icon: "square.grid.2x2.fill" },
  { key: "subcategory", label: "小类", icon: "square.grid.3x3.fill" },
  { key: "ranking", label: "排行", icon: "list.number" },
  { key: "spec", label: "规格", icon: "list.bullet.indent" },
  { key: "compare", label: "对比", icon: "chart.line.uptrend.xyaxis" },
];

// 品类大类 Tab（Cocktail/Wine/Food/Beer/套餐等）
const CATEGORY_TABS = [
  { key: "all", label: "全部" },
  { key: "Cocktail", label: "Cocktail" },
  { key: "Wine", label: "Wine" },
  { key: "Food", label: "Food" },
  { key: "Beer", label: "Beer" },
  { key: "Beverage", label: "Beverage" },
  { key: "Shot", label: "Shot" },
];

// 大类颜色
const CATEGORY_COLORS: Record<string, string> = {
  Cocktail: "#5856D6",
  Wine: "#FF2D55",
  Food: "#FF9500",
  Beer: "#34C759",
  Beverage: "#007AFF",
  Shot: "#AF52DE",
  "Straight-up": "#FF6B35",
  default: "#8E8E93",
};

function getCategoryColor(name: string): string {
  for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return CATEGORY_COLORS.default;
}

function fmtAmt(n: number): string {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}w`;
  return `¥${formatMoney(n)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── 大类卡片 ──────────────────────────────────────────────────────────────────
function CategoryCard({ cat, total, colors }: { cat: DishCategoryData; total: number; colors: any }) {
  const color = getCategoryColor(cat.name);
  const pct = total > 0 ? cat.salesAmount / total : 0;
  return (
    <View style={[CC.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <View style={[CC.dot, { backgroundColor: color }]} />
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, flex: 1 }}>{cat.name}</Text>
        <Text style={{ fontSize: 14, fontWeight: "700", color }}>
          {fmtAmt(cat.salesAmount)}
        </Text>
      </View>
      {/* 进度条 */}
      <View style={[CC.bar, { backgroundColor: colors.border + "44" }]}>
        <View style={[CC.barFill, { backgroundColor: color, width: `${Math.min(pct * 100, 100)}%` as any }]} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        <Text style={{ fontSize: 11, color: colors.muted }}>占比 {fmtPct(pct)}</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>销量 {cat.salesQty}份</Text>
        <Text style={{ fontSize: 11, color: colors.muted }}>优惠 {fmtAmt(cat.discount)}</Text>
      </View>
    </View>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function DishAnalysisScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { snapshots, upsertSnapshot, deleteSnapshot } = useDishAnalysisStore();
  const { reports } = useMonthlyReportStore();

  const [tab, setTab] = useState<MainTab>("category");
  const [selectedMonth, setSelectedMonth] = useState<string>(snapshots[0]?.month ?? "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("salesAmount");
  const [searchText, setSearchText] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [compareMonths, setCompareMonths] = useState<string[]>([]);
  const [isResetPromptOpen, setIsResetPromptOpen] = useState(false);
  const resetGateRef = useRef(createResetActionGate());

  const snapshot = useMemo(() =>
    snapshots.find((s) => s.month === selectedMonth) ?? snapshots[0],
    [snapshots, selectedMonth]
  );
  // 性能优化：将 renderCategory/renderRanking 内的数据计算提取为 useMemo
  const categoryCalc = useMemo(() => {
    if (!snapshot || snapshot.categories.length === 0) return null;
    const total = snapshot.categories.reduce((s, c) => s + c.salesAmount, 0);
    const sorted = [...snapshot.categories].sort((a, b) => b.salesAmount - a.salesAmount);
    return { total, sorted };
  }, [snapshot]);
  const rankingCalc = useMemo(() => {
    if (!snapshot || snapshot.items.length === 0) return null;
    const filtered = snapshot.items
      .filter((d) => !searchText || d.name.toLowerCase().includes(searchText.toLowerCase()))
      .sort((a, b) => b[sortKey] - a[sortKey]);
    return { filtered };
  }, [snapshot, searchText, sortKey]);

  const resetCurrentMonthAnalysis = () => {
    if (!snapshot || !resetGateRef.current.tryAcquire()) return;
    setIsResetPromptOpen(true);
    const releaseResetLock = () => {
      resetGateRef.current.release();
      setIsResetPromptOpen(false);
    };
    const report = findMonthlyReportForDishAnalysis(reports, snapshot.month);
    const action = () => {
      releaseResetLock();
      if (report) {
        upsertSnapshot(rebuildDishCategoriesFromMonthlyReport(snapshot, report));
        Alert.alert("已重建", `${snapshot.monthLabel} 的菜品大类已从同月原始月报重新生成。`);
        return;
      }
      // 没有同月主月报时不能伪造正确分类：只删除错误快照并要求重新导入。
      deleteSnapshot(snapshot.id);
      Alert.alert("已清除错误快照", "未找到同月原始月报，无法安全重建。请重新导入该月报表后再查看经营分析。", [
        { text: "取消", style: "cancel" },
        { text: "去导入", onPress: () => router.push("/monthly-report-import") },
      ]);
    };
    Alert.alert(
      "重置本月经营分析",
      report
        ? "将清除本月旧的菜品大类派生数据，并从同月原始月报重新生成。小类、菜品与规格明细不会被删除。"
        : "将清除本月错误菜品分析快照；由于没有保存的同月原始月报，随后需要重新导入一次。",
      [
        { text: "取消", style: "cancel", onPress: releaseResetLock },
        { text: report ? "重置并重建" : "清除错误数据", style: "destructive", onPress: action },
      ],
      { cancelable: true, onDismiss: releaseResetLock },
    );
  };

  // ── 大类 Tab ────────────────────────────────────────────────────────────────────────────
  const renderCategory = () => {
    if (!categoryCalc) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 40 }}>📊</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>暂无菜品大类数据</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            请先导入「菜品销售统计（菜品大类）」报表
          </Text>
        </View>
      );
    }

    const { total, sorted } = categoryCalc;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 + insets.bottom }}>
        {/* 总营业额 */}
        <View style={[{ backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33", borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 4 }]}>
          <Text style={{ fontSize: 12, color: colors.primary }}>菜品销售总额</Text>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.foreground }}>
            {fmtAmt(total)}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
            共 {snapshot.categories.length} 大类 · {snapshot.items.length} 款菜品
          </Text>
        </View>

        {/* 大类卡片列表 */}
        {sorted.map((cat) => (
          <CategoryCard key={cat.name} cat={cat} total={total} colors={colors} />
        ))}
      </ScrollView>
    );
  };

  // ── 小类 Tab ──────────────────────────────────────────────────────────────
  const renderSubcategory = () => {
    if (!snapshot || snapshot.subCategories.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 40 }}>📂</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>暂无菜品小类数据</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            请先导入「菜品销售统计（菜品小类）」报表
          </Text>
        </View>
      );
    }

    // 按大类分组
    const grouped = new Map<string, DishSubCategoryData[]>();
    for (const sub of snapshot.subCategories) {
      if (!grouped.has(sub.category)) grouped.set(sub.category, []);
      grouped.get(sub.category)!.push(sub);
    }

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 + insets.bottom }}>
        {Array.from(grouped.entries()).map(([category, subs]) => {
          const color = getCategoryColor(category);
          const isExpanded = expandedCategory === category;
          const catTotal = subs.reduce((s, c) => s + c.salesAmount, 0);
          return (
            <View key={category} style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, overflow: "hidden" }]}>
              {/* 大类标题行 */}
              <TouchableOpacity
                onPress={() => { tap(); setExpandedCategory(isExpanded ? null : category); }}
                style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 8 }}>
                <View style={[CC.dot, { backgroundColor: color }]} />
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, flex: 1 }}>{category}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color }}>{fmtAmt(catTotal)}</Text>
                <IconSymbol name={isExpanded ? "chevron.up" : "chevron.down"} size={14} color={colors.muted} />
              </TouchableOpacity>
              {/* 小类列表 */}
              {isExpanded && subs.sort((a, b) => b.salesAmount - a.salesAmount).map((sub, i) => (
                <View key={sub.subCategory} style={[{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "66", backgroundColor: color + "05" }]}>
                  <Text style={{ fontSize: 12, color: colors.muted, width: 20 }}>{i + 1}</Text>
                  <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{sub.subCategory}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{fmtAmt(sub.salesAmount)}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>{fmtPct(catTotal > 0 ? sub.salesAmount / catTotal : 0)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ── 排行 Tab ──────────────────────────────────────────────────────────────
  const renderRanking = () => {
    if (!rankingCalc) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 40 }}>🏆</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>暂无菜品明细数据</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            请先导入「菜品销售统计（菜品名称）」报表
          </Text>
        </View>
      );
    }

    const { filtered } = rankingCalc;

    return (
      <View style={{ flex: 1 }}>
        {/* 搜索 + 排序栏 */}
        <View style={{ padding: 12, gap: 8 }}>
          <View style={[{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, gap: 6 }]}>
            <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="搜索菜品名称…"
              placeholderTextColor={colors.muted}
              style={{ flex: 1, fontSize: 14, color: colors.foreground, paddingVertical: 8 }}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {([["salesAmount", "销售额"], ["salesQty", "销量"], ["revenue", "收入"], ["discount", "优惠"]] as [SortKey, string][]).map(([key, label]) => (
                <TouchableOpacity key={key} onPress={() => { tap(); setSortKey(key); }}
                  style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: sortKey === key ? colors.primary : colors.surface, borderWidth: 1, borderColor: sortKey === key ? colors.primary : colors.border }]}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: sortKey === key ? "#fff" : colors.muted }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        {/* 列表 */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40 + insets.bottom }}>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>
            共 {filtered.length} 款菜品
          </Text>
          {filtered.map((dish, i) => (
            <View key={dish.name} style={[{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + "66" }]}>
              <Text style={{ fontSize: 12, color: colors.muted, width: 28, textAlign: "right", marginRight: 8 }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{dish.name}</Text>
                {dish.itemType && <Text style={{ fontSize: 10, color: colors.muted }}>{dish.itemType}</Text>}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>
                  {sortKey === "salesQty" ? `${dish.salesQty}份` : fmtAmt(dish[sortKey])}
                </Text>
                <Text style={{ fontSize: 10, color: colors.muted }}>
                  {sortKey !== "salesQty" && `${dish.salesQty}份 · `}{fmtPct(dish.salesAmountPct)}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  // ── 规格 Tab ──────────────────────────────────────────────────────────────
  const renderSpec = () => {
    if (!snapshot || snapshot.specs.length === 0) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 40 }}>📋</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>暂无规格数据</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
            请先导入「菜品销售统计（菜品名称+规格）」报表
          </Text>
        </View>
      );
    }

    // 按菜品名称分组
    const grouped = new Map<string, DishSpecData[]>();
    for (const spec of snapshot.specs) {
      if (!grouped.has(spec.name)) grouped.set(spec.name, []);
      grouped.get(spec.name)!.push(spec);
    }

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 + insets.bottom }}>
        {Array.from(grouped.entries())
          .sort((a, b) => b[1].reduce((s, c) => s + c.salesAmount, 0) - a[1].reduce((s, c) => s + c.salesAmount, 0))
          .map(([name, specs]) => {
            const total = specs.reduce((s, c) => s + c.salesAmount, 0);
            return (
              <View key={name} style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, overflow: "hidden" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, flex: 1 }} numberOfLines={1}>{name}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{fmtAmt(total)}</Text>
                </View>
                {specs.map((spec, i) => (
                  <View key={spec.spec} style={[{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "66", backgroundColor: colors.primary + "04" }]}>
                    <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }}>{spec.spec}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{spec.salesQty}份</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 12 }}>{fmtAmt(spec.salesAmount)}</Text>
                  </View>
                ))}
              </View>
            );
          })}
      </ScrollView>
    );
  };

  // ── 对比 Tab ──────────────────────────────────────────────────────────────
  const renderCompare = () => {
    const availableMonths = snapshots.map((s) => s.month).sort().reverse();

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 + insets.bottom }}>
        {/* 月份选择 */}
        <View style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14 }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 10 }}>
            选择对比月份（最多3个）
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {availableMonths.map((m) => {
              const isSelected = compareMonths.includes(m);
              return (
                <TouchableOpacity key={m} onPress={() => {
                  tap();
                  if (isSelected) {
                    setCompareMonths((prev) => prev.filter((x) => x !== m));
                  } else if (compareMonths.length < 3) {
                    setCompareMonths((prev) => [...prev, m].sort());
                  }
                }}
                  style={[{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, backgroundColor: isSelected ? colors.primary : colors.background, borderColor: isSelected ? colors.primary : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: isSelected ? "#fff" : colors.muted }}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {compareMonths.length >= 2 && (() => {
          const compareData = compareMonths.map((m) => snapshots.find((s) => s.month === m)).filter(Boolean);
          // 收集所有大类
          const allCats = new Set<string>();
          compareData.forEach((s) => s?.categories?.forEach((c) => allCats.add(c.name)));

          return (
            <View style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14 }]}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>
                大类销售额对比
              </Text>
              {/* 表头 */}
              <View style={{ flexDirection: "row", marginBottom: 8 }}>
                <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>大类</Text>
                {compareMonths.map((m) => (
                  <Text key={m} style={{ width: 70, fontSize: 11, color: colors.muted, textAlign: "right" }}>{m.slice(5)}月</Text>
                ))}
              </View>
              {/* 数据行 */}
              {Array.from(allCats).map((cat) => {
                const color = getCategoryColor(cat);
                return (
                  <View key={cat} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44" }}>
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[CC.dot, { backgroundColor: color, width: 8, height: 8 }]} />
                      <Text style={{ fontSize: 12, color: colors.foreground }}>{cat}</Text>
                    </View>
                    {compareMonths.map((m) => {
                      const snap = compareData.find((s) => s?.month === m);
                      const catData = snap?.categories.find((c) => c.name === cat);
                      return (
                        <Text key={m} style={{ width: 70, fontSize: 12, fontWeight: "600", color: catData ? color : colors.muted, textAlign: "right" }}>
                          {catData ? fmtAmt(catData.salesAmount) : "—"}
                        </Text>
                      );
                    })}
                  </View>
                );
              })}
              {/* 合计行 */}
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
                <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.foreground }}>合计</Text>
                {compareMonths.map((m) => {
                  const snap = compareData.find((s) => s?.month === m);
                  const total = snap?.categories.reduce((s, c) => s + c.salesAmount, 0) ?? 0;
                  return (
                    <Text key={m} style={{ width: 70, fontSize: 13, fontWeight: "700", color: colors.primary, textAlign: "right" }}>
                      {fmtAmt(total)}
                    </Text>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {compareMonths.length < 2 && (
          <View style={{ alignItems: "center", padding: 20 }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>请选择至少 2 个月份进行对比</Text>
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>菜品分析</Text>
        <Pressable
          testID="dish-analysis-reset-current-month"
          accessibilityRole="button"
          accessibilityLabel="重置本月经营分析"
          onPress={resetCurrentMonthAnalysis}
          disabled={!snapshot || isResetPromptOpen}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            opacity: !snapshot || isResetPromptOpen ? 0.35 : pressed ? 0.6 : 1,
          })}
        >
          <IconSymbol name="arrow.clockwise" size={19} color={colors.primary} />
        </Pressable>
      </View>

      {/* 月份选择 */}
      {snapshots.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
          {snapshots.map((s) => (
            <TouchableOpacity key={s.month} onPress={() => { tap(); setSelectedMonth(s.month); }}
              style={[{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, backgroundColor: selectedMonth === s.month ? colors.primary : colors.surface, borderColor: selectedMonth === s.month ? colors.primary : colors.border }]}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: selectedMonth === s.month ? "#fff" : colors.muted }}>
                {s.monthLabel}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Tab 栏 */}
      <View style={[S.tabBar, { backgroundColor: colors.border + "33", borderBottomColor: colors.border }]}>
        {TAB_ITEMS.map((t) => {
          const isActive = tab === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
              style={[S.tabBtn, isActive && { backgroundColor: colors.background }]}>
              <Text style={[S.tabText, { color: isActive ? colors.primary : colors.muted, fontWeight: isActive ? "700" : "400" }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 内容区 */}
      {snapshots.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 48 }}>🍽️</Text>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginTop: 16 }}>
            暂无菜品分析数据
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
            请先在「导入月度报表」中{"\n"}上传菜品销售统计 Excel 文件
          </Text>
        </View>
      ) : (
        <>
          {tab === "category" && renderCategory()}
          {tab === "subcategory" && renderSubcategory()}
          {tab === "ranking" && renderRanking()}
          {tab === "spec" && renderSpec()}
          {tab === "compare" && renderCompare()}
        </>
      )}
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  tabBar: { flexDirection: "row", margin: 8, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 12 },
});

const CC = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
});

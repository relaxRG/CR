/**
 * 葡萄酒 Tab（独立数据，与鸡尾酒酒库完全隔离）
 * Segment：酒款列表 / 按产区 / 按品种
 */
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useWineStore } from "@/lib/wine/store";
import { WineBottle, WINE_STYLE_LABELS } from "@/lib/wine/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

type WineTab = "list" | "region" | "grape";
type WineGroupedRow = { kind: "header"; key: string; title: string } | { kind: "bottle"; key: string; bottle: WineBottle };

const TABS: { key: WineTab; label: string }[] = [
  { key: "list", label: "全部" },
  { key: "region", label: "产区" },
  { key: "grape", label: "品种" },
];

function WineCard({ bottle, onPress }: { bottle: WineBottle; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{bottle.name}</Text>
          {bottle.vintage ? <Text style={[styles.cardVintage, { color: colors.muted }]}>{bottle.vintage}</Text> : null}
        </View>
        <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
          {[WINE_STYLE_LABELS[bottle.style], bottle.region, bottle.grape].filter(Boolean).join(" · ")}
        </Text>
        {bottle.winery ? <Text style={[styles.cardWinery, { color: colors.muted }]} numberOfLines={1}>{bottle.winery}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {bottle.salePrice != null && (
          <Text style={[styles.cardPrice, { color: colors.primary }]}>¥{bottle.salePrice}</Text>
        )}
        <View style={[styles.stockBadge, { backgroundColor: bottle.stock > 0 ? colors.success + "22" : colors.error + "22" }]}>
          <Text style={[styles.stockText, { color: bottle.stock > 0 ? colors.success : colors.error }]}>
            库存 {bottle.stock}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}


export default function WineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bottles } = useWineStore();
  const [tab, setTab] = usePersistedState<WineTab>("wine.tab.v1", "list");
  const [query, setQuery] = useState("");

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const filtered = useMemo(() => {
    if (!query.trim()) return bottles;
    const q = query.toLowerCase();
    return bottles.filter((b) =>
      b.name.toLowerCase().includes(q) ||
      b.nameEn.toLowerCase().includes(q) ||
      b.region.toLowerCase().includes(q) ||
      b.grape.toLowerCase().includes(q) ||
      b.winery.toLowerCase().includes(q)
    );
  }, [bottles, query]);

  const createGroupedRows = useCallback((getKey: (bottle: WineBottle) => string): WineGroupedRow[] => {
    const groups = new Map<string, WineBottle[]>();
    filtered.forEach((bottle) => {
      const key = getKey(bottle) || "未分类";
      const entries = groups.get(key) ?? [];
      entries.push(bottle);
      groups.set(key, entries);
    });
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .flatMap(([title, entries]) => [
        { kind: "header" as const, key: `header-${title}`, title },
        ...entries.map((bottle) => ({ kind: "bottle" as const, key: `bottle-${bottle.id}`, bottle })),
      ]);
  }, [filtered]);

  const byRegionRows = useMemo(() => createGroupedRows((bottle) => bottle.region), [createGroupedRows]);
  const byGrapeRows = useMemo(() => createGroupedRows((bottle) => bottle.grape), [createGroupedRows]);

  const handlePress = (b: WineBottle) => {
    tap();
    router.push(`/wine/${b.id}` as any);
  };

  // 滚动位置保持：tab 切换时重置偏移量
  const { listRef: wineListRef, onScroll: onWineScroll } = useScrollPreservation<FlatList>(tab);

  const subtitle = bottles.length > 0 ? `共 ${bottles.length} 款 · 独立数据库` : "记录每一款葡萄酒";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部 */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <View>
              <Text style={[styles.title, { color: colors.foreground }]}>葡萄酒</Text>
              <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Pressable
                onPress={() => { tap(); router.push("/wine-inventory" as any); }}
                style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
              >
                <IconSymbol name="chart.bar.fill" size={18} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => { tap(); router.push("/wine-form" as any); }}
                style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
              >
                <IconSymbol name="plus" size={20} color="#fff" />
              </Pressable>
            </View>
        </View>
        {/* 搜索框 */}
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索酒名、产区、品种…"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
        {/* Segment */}
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => { tap(); setTab(item.key); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              >
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 内容 */}
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <IconSymbol name="wineglass" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {bottles.length === 0 ? "还没有葡萄酒" : "无搜索结果"}
          </Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>
            {bottles.length === 0 ? "点击右上角 + 添加第一款" : "试试其他关键词"}
          </Text>
        </View>
      ) : tab === "list" ? (
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          ref={wineListRef}
          data={filtered}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <WineCard bottle={item} onPress={() => handlePress(item)} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          onScroll={onWineScroll}
          scrollEventThrottle={100}
        />
      ) : tab === "region" ? (
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          ref={wineListRef}
          data={byRegionRows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) => row.kind === "header"
            ? <Text style={[styles.groupTitle, { color: colors.muted }]}>{row.title}</Text>
            : <WineCard bottle={row.bottle} onPress={() => handlePress(row.bottle)} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          onScroll={onWineScroll}
          scrollEventThrottle={100}
        />
      ) : (
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          ref={wineListRef}
          data={byGrapeRows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) => row.kind === "header"
            ? <Text style={[styles.groupTitle, { color: colors.muted }]}>{row.title}</Text>
            : <WineCard bottle={row.bottle} onPress={() => handlePress(row.bottle)} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          onScroll={onWineScroll}
          scrollEventThrottle={100}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: 10 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, lineHeight: 20 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  cardName: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  cardVintage: { fontSize: 13, lineHeight: 18 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardWinery: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: "700" },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  stockText: { fontSize: 12, fontWeight: "500" },
  groupTitle: { fontSize: 13, fontWeight: "600", letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
});

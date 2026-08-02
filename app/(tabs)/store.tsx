/**
 * 门店 Tab
 * 顶部右侧：「我的」入口（person.crop.circle 图标）
 * 主切换：在售清单 / 采购清单 / 营业状况 / 备用金 / 经营分析 / 进销存
 */
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useMenuStore } from "@/lib/menu/store";
import { useSync } from "@/lib/cf-sync/provider";
import { IconSymbol } from "@/components/ui/icon-symbol";
import StoreSaleScreen from "@/components/store/sale";
import StorePurchaseScreen from "@/components/store/purchase";
import StoreRevenueScreen from "@/components/store/revenue";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreInventoryScreen from "@/components/store/inventory";

type StoreTab = "sale" | "purchase" | "revenue" | "petty" | "analytics" | "inventory";

const TABS: { key: StoreTab; label: string }[] = [
  { key: "sale", label: "在售清单" },
  { key: "purchase", label: "采购清单" },
  { key: "revenue", label: "营业状况" },
  { key: "petty", label: "备用金" },
  { key: "analytics", label: "经营分析" },
  { key: "inventory", label: "进销存" },
];

export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = usePersistedState<StoreTab>("store.tab.v2", "sale");
  const { syncState } = useSync();
  const hasSyncBadge = !!syncState.error;

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const title = TABS.find((t) => t.key === tab)?.label ?? "门店";

  const childInsets = { ...insets, top: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部 */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 }}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          </View>
          {/* 我的入口 */}
          <Pressable
            onPress={() => { tap(); router.push("/me"); }}
            style={({ pressed }) => [styles.meBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            {hasSyncBadge && (
              <View style={[styles.syncDot, { backgroundColor: colors.error }]} />
            )}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>
        {/* 横向滚动 Tab 切换器 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
        >
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => { tap(); setTab(item.key); }}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.tabChipText, { color: active ? "#fff" : colors.foreground, fontWeight: active ? "600" : "400" }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 子屏 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={[{ flex: 1 }, tab !== "sale" && styles.hidden]}>
          <StoreSaleScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "purchase" && styles.hidden]}>
          <StorePurchaseScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "revenue" && styles.hidden]}>
          <StoreRevenueScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "petty" && styles.hidden]}>
          <StorePettyCashScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "analytics" && styles.hidden]}>
          <StoreAnalyticsScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "inventory" && styles.hidden]}>
          <StoreInventoryScreen />
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 0 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3 },
  meBtn: { position: "relative", marginBottom: 10 },
  syncDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, zIndex: 1 },
  tabChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  tabChipText: { fontSize: 14, lineHeight: 20 },
  hidden: { display: "none" },
});

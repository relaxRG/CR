/**
 * 门店 Tab — 四大顶级模块
 * 【月报】经营分析 / 账户
 * 【员工】薪资统计 / 排班表 / 薪资预支
 * 【备用金】备用金管理
 * 【库存】10 个品类进销存入口
 */
import React from "react";
import {
  Platform, Pressable, StyleSheet, Text, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSync } from "@/lib/cf-sync/provider";
import { IconSymbol } from "@/components/ui/icon-symbol";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreInventoryScreen from "@/components/store/inventory";
import StoreAccountsScreen from "@/components/store/accounts";
import LaborScreen from "@/app/labor";

type MainTab = "monthly" | "labor" | "petty" | "inventory";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "monthly",   label: "报表" },
  { key: "labor",     label: "员工" },
  { key: "petty",     label: "备用金" },
  { key: "inventory", label: "库存" },
];

// ── 门店主屏 ──────────────────────────────────────────────────────────────────
export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mainTab, setMainTab] = usePersistedState<MainTab>("store.main.tab.v3", "monthly");
  const { syncState } = useSync();
  const hasSyncBadge = !!syncState.error;
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const childInsets = { ...insets, top: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部导航栏：头像 + 四个顶级 Tab */}
      <View style={[S.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        {/* 头像按钮（右上角） */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingBottom: 4 }}>
          <Pressable onPress={() => { tap(); router.push("/me"); }}
            style={({ pressed }) => [S.meBtn, { opacity: pressed ? 0.7 : 1 }]}>
            {hasSyncBadge && <View style={[S.syncDot, { backgroundColor: colors.error }]} />}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>

        {/* 四大模块主 Tab（下划线风格） */}
        <View style={[S.mainTabRow, { borderBottomColor: colors.border }]}>
          {MAIN_TABS.map((t) => {
            const active = mainTab === t.key;
            return (
              <Pressable key={t.key} onPress={() => { tap(); setMainTab(t.key); }}
                style={[S.mainTabBtn, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
                <Text style={[S.mainTabText, {
                  color: active ? colors.primary : colors.muted,
                  fontWeight: active ? "700" : "400",
                }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 内容区 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        {mainTab === "monthly" && (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <SafeAreaInsetsContext.Provider value={childInsets}>
              <StoreAnalyticsScreen />
            </SafeAreaInsetsContext.Provider>
          </View>
        )}
        {mainTab === "labor" && (
          <View style={{ flex: 1 }}>
            <LaborScreen embedded />
          </View>
        )}
        {mainTab === "petty" && (
          <SafeAreaInsetsContext.Provider value={childInsets}>
            <StorePettyCashScreen />
          </SafeAreaInsetsContext.Provider>
        )}
        {mainTab === "inventory" && <StoreInventoryScreen />}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const S = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 0 },
  meBtn: { position: "relative" },
  syncDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, zIndex: 1 },
  mainTabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  mainTabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  mainTabText: { fontSize: 16 },
});

import { Tabs } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { FloatingTabBar, FloatingTabItem } from "@/components/floating-tab-bar";
import { useRouter, usePathname } from "expo-router";
import { useSync } from "@/lib/cf-sync/provider";

export default function TabLayout() {
  const colors = useColors();
  const { t } = useI18n();
  const { lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  // 当前激活 tab key
  const activeKey = pathname.startsWith("/library") ? "library"
    : pathname.startsWith("/books") ? "books"
    : pathname.startsWith("/me") ? "me"
    : "index";

  const { syncState, syncError, hasPendingConflicts, deviceInfo } = useSync();
  // 有同步失败（syncState.error）或 provider 级别错误时显示红点
  const syncBadge = !!syncError || !!syncState.error || hasPendingConflicts;
  const isGuest = deviceInfo?.role === "guest";

  const TAB_ITEMS: FloatingTabItem[] = [
    {
      key: "index",
      label: t("tab.lab"),
      icon: <IconSymbol size={24} name="flask.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="flask.fill" color={colors.primary} />,
    },
    {
      key: "library",
      label: t("tab.library"),
      icon: <IconSymbol size={24} name="wineglass.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="wineglass.fill" color={colors.primary} />,
    },
    {
      key: "books",
      label: t("tab.books"),
      icon: <IconSymbol size={24} name="book.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="book.fill" color={colors.primary} />,
    },
    {
      key: "me",
      label: t("tab.me"),
      icon: <IconSymbol size={24} name="person.crop.circle.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="person.crop.circle.fill" color={colors.primary} />,
      badge: syncBadge,
    },
  ];

  const handleTabChange = (key: string) => {
    if (key === "index") router.navigate("/" as any);
    else router.navigate(`/${key}` as any);
  };

  return (
    <View style={{ flex: 1 }}>
      {isGuest && (
        <View style={[guestBannerStyles.banner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[guestBannerStyles.text, { color: colors.muted }]}>
            {lang === "zh" ? "访客模式 · 仅可查看" : "Guest Mode · View Only"}
          </Text>
        </View>
      )}
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" },
      }}
      tabBar={() => (
        <FloatingTabBar
          items={TAB_ITEMS}
          activeKey={activeKey}
          onChange={handleTabChange}
        />
      )}
    >
      <Tabs.Screen name="index" options={{ title: t("tab.lab") }} />
      <Tabs.Screen name="library" options={{ title: t("tab.library") }} />
      <Tabs.Screen name="books" options={{ title: t("tab.books") }} />
      <Tabs.Screen name="me" options={{ title: t("tab.me") }} />
      {/* Legacy routes kept for deep-link compatibility; hidden from Tab Bar */}
      <Tabs.Screen name="bottles" options={{ href: null }} />
      <Tabs.Screen name="homemade" options={{ href: null }} />
      <Tabs.Screen name="menu" options={{ href: null }} />
      <Tabs.Screen name="shopping" options={{ href: null }} />
      <Tabs.Screen name="recipes" options={{ href: null, tabBarItemStyle: { display: "none" } }} />
    </Tabs>
    </View>
  );
}

const guestBannerStyles = StyleSheet.create({
  banner: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  text: {
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
});

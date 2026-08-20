import { Tabs } from "expo-router";
import { View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { FloatingTabBar, FloatingTabItem } from "@/components/floating-tab-bar";
import { useRouter, usePathname } from "expo-router";
import { useSync } from "@/lib/cf-sync/provider";

export default function TabLayout() {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();

  // 当前激活 tab key
  const activeKey = pathname.startsWith("/wine") ? "wine"
    : pathname.startsWith("/lab") ? "lab"
    : pathname.startsWith("/food") ? "food"
    : pathname.startsWith("/store") ? "store"
    : pathname.startsWith("/cocktail") ? "cocktail"
    : "cocktail";

  const { syncState, syncError, hasPendingConflicts } = useSync();
  const syncBadge = !!syncError || !!syncState.error || hasPendingConflicts;

  const TAB_ITEMS: FloatingTabItem[] = [
    {
      key: "cocktail",
      label: "鸡尾酒",
      icon: <IconSymbol size={24} name="wineglass.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="wineglass.fill" color={colors.primary} />,
    },
    {
      key: "wine",
      label: "葡萄酒",
      icon: <IconSymbol size={24} name="wineglass" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="wineglass" color={colors.primary} />,
    },
    {
      key: "lab",
      label: "研发",
      icon: <IconSymbol size={24} name="flask.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="flask.fill" color={colors.primary} />,
    },
    {
      key: "food",
      label: "餐食",
      icon: <IconSymbol size={24} name="fork.knife" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="fork.knife" color={colors.primary} />,
    },
    {
      key: "store",
      label: "门店",
      icon: <IconSymbol size={24} name="building.2.fill" color={colors.muted} />,
      activeIcon: <IconSymbol size={24} name="building.2.fill" color={colors.primary} />,
      badge: syncBadge,
    },
  ];

  const handleTabChange = (key: string) => {
    router.navigate(`/${key}` as any);
  };

  return (
    <View style={{ flex: 1 }}>
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
        <Tabs.Screen name="cocktail" options={{ title: "鸡尾酒" }} />
        <Tabs.Screen name="wine" options={{ title: "葡萄酒" }} />
        <Tabs.Screen name="lab" options={{ title: "研发" }} />
        <Tabs.Screen name="food" options={{ title: "餐食" }} />
        <Tabs.Screen name="store" options={{ title: "门店" }} />
        {/* 旧路由保留兼容性，隐藏 Tab */}
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen name="bottles" options={{ href: null }} />
        <Tabs.Screen name="homemade" options={{ href: null }} />
        <Tabs.Screen name="menu" options={{ href: null }} />
        <Tabs.Screen name="shopping" options={{ href: null }} />
        <Tabs.Screen name="recipes" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

/**
 * 账户余额独立页面
 * 原来嵌在「当月月报 → 账户」Tab 中，导航重构后改为独立路由页面
 * 入口：报表 Tab → 功能入口 → 账户余额
 */
import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import StoreAccountsScreen from "@/components/store/accounts";

export default function StoreAccountsPage() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <StoreAccountsScreen />
    </View>
  );
}

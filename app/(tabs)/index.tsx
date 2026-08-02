/**
 * 默认路由重定向到鸡尾酒 Tab
 * 使用 useFocusEffect 确保在 Root Layout 挂载后再执行导航
 */
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

export default function IndexRedirect() {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.replace("/cocktail" as never);
    }, [router])
  );
  return <View style={{ flex: 1 }} />;
}

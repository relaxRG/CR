import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useI18n } from "@/lib/i18n";
import { useNetwork } from "@/hooks/use-network";

/**
 * OfflineToast — a slim banner that slides in from the top when the device
 * loses internet connectivity. It automatically hides when connectivity is
 * restored. Place it near the top of any screen that uses AI features.
 */
export function OfflineToast() {
  const { t } = useI18n();
  const { isOnline } = useNetwork();
  const slideAnim = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOnline ? -60 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [isOnline, slideAnim]);

  return (
    <Animated.View
      style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
    >
      <View style={styles.inner}>
        <Text style={styles.icon}>✕</Text>
        <Text style={styles.text}>{t("offline.aiUnavailable")}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
});

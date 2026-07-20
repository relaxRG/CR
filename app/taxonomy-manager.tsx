import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { BottleTaxonomyManager } from "@/components/bottle-taxonomy-manager";
import { PrepTaxonomyManager } from "@/components/prep-taxonomy-manager";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

type Tab = "bottleCat" | "prepSec";

export default function TaxonomyManagerScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("bottleCat");

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [{ padding: 4, marginRight: 8, opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground, flex: 1 }}>
          {t("me.taxonomy")}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            padding: 3,
          }}
        >
          {(["bottleCat", "prepSec"] as Tab[]).map((key) => {
            const active = tab === key;
            const label =
              key === "bottleCat"
                ? t("tags.section.bottleCat")
                : t("tags.section.prepSection");
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[
                  { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8 },
                  active && { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: active ? "600" : "400",
                    color: active ? "#FFFFFF" : colors.muted,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {tab === "bottleCat" ? <BottleTaxonomyManager /> : <PrepTaxonomyManager />}
      </ScrollView>
    </ScreenContainer>
  );
}

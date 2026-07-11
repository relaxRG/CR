/** 冰块成本设置:冰款可自由增删改,一次设置全部配方自动计入 */
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { iceKindCostPerDrink, type IceKind, type IcePricing } from "@/lib/ice/cost";
import { useIceSettings } from "@/lib/ice/store";

function NumField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  const colors = useColors();
  const [text, setText] = useState(String(value));
  return (
    <View className="flex-1">
      <Text className="text-xs text-muted mb-1">{label}</Text>
      <View className="flex-row items-center bg-background rounded-lg px-2.5" style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
        <TextInput
          className="flex-1 py-2 text-sm text-foreground"
          keyboardType="decimal-pad"
          returnKeyType="done"
          value={text}
          onChangeText={setText}
          onEndEditing={() => {
            const n = parseFloat(text);
            if (!Number.isNaN(n) && n >= 0) onChange(n);
            else setText(String(value));
          }}
          style={{ lineHeight: 18 }}
        />
        {suffix ? <Text className="text-xs text-muted ml-1">{suffix}</Text> : null}
      </View>
    </View>
  );
}

export default function IceSettingsScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { ice, setIce, addKind, updateKind, removeKind } = useIceSettings();

  const pricingLabel = (p: IcePricing) =>
    p === "perDrink" ? t("ice.pricing.perDrink") : p === "perGram" ? t("ice.pricing.perGram") : t("ice.pricing.perPiece");

  const confirmRemove = (k: IceKind) => {
    const name = lang === "zh" ? k.nameZh : k.nameEn || k.nameZh;
    if (Platform.OS === "web") {
      removeKind(k.id);
      return;
    }
    Alert.alert(t("ice.delete.title"), t("ice.delete.msg", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => removeKind(k.id) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="chevron.left" size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-bold text-foreground">{t("ice.title")}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}>
        <Text className="text-xs text-muted" style={{ lineHeight: 17 }}>
          {t("ice.subtitle")}
        </Text>

        <View className="bg-surface rounded-xl px-4">
          <View className="flex-row items-center justify-between py-3">
            <Text className="text-sm text-foreground">{t("ice.enabled")}</Text>
            <Switch value={ice.enabled} onValueChange={(v) => setIce({ enabled: v })} />
          </View>
          <View
            className="flex-row items-center justify-between py-3"
            style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
          >
            <View className="flex-1 pr-3">
              <Text className="text-sm text-foreground">{t("ice.stirConsumes")}</Text>
              <Text className="text-xs text-muted mt-0.5" style={{ lineHeight: 15 }}>
                {t("ice.stirConsumes.desc")}
              </Text>
            </View>
            <Switch value={ice.stirConsumesIce} onValueChange={(v) => setIce({ stirConsumesIce: v })} />
          </View>
        </View>

        {ice.kinds.map((k) => (
          <View key={k.id} className="bg-surface rounded-xl p-4" style={{ gap: 10 }}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 6, flex: 1 }}>
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                  {lang === "zh" ? k.nameZh : k.nameEn || k.nameZh}
                </Text>
                {k.isShakeIce ? (
                  <View className="bg-primary/15 rounded-full px-2 py-0.5">
                    <Text className="text-[10px]" style={{ color: colors.primary, lineHeight: 13 }}>
                      {t("ice.shakeBadge")}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Pressable onPress={() => confirmRemove(k)} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                <IconSymbol name="trash.fill" size={17} color={colors.error} />
              </Pressable>
            </View>
            <View className="flex-row" style={{ gap: 8 }}>
              <View className="flex-1">
                <Text className="text-xs text-muted mb-1">{t("ice.name.zh")}</Text>
                <TextInput
                  className="bg-background rounded-lg px-2.5 py-2 text-sm text-foreground"
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, lineHeight: 18 }}
                  value={k.nameZh}
                  returnKeyType="done"
                  onChangeText={(v) => updateKind(k.id, { nameZh: v })}
                />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-muted mb-1">{t("ice.name.en")}</Text>
                <TextInput
                  className="bg-background rounded-lg px-2.5 py-2 text-sm text-foreground"
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, lineHeight: 18 }}
                  value={k.nameEn}
                  returnKeyType="done"
                  onChangeText={(v) => updateKind(k.id, { nameEn: v })}
                />
              </View>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">{t("ice.pricing")}</Text>
              <View className="flex-row" style={{ gap: 6 }}>
                {(["perDrink", "perGram", "perPiece"] as IcePricing[]).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => updateKind(k.id, { pricing: p })}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    <View
                      className="rounded-full px-3 py-1.5"
                      style={{
                        backgroundColor: k.pricing === p ? colors.primary : colors.background,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: k.pricing === p ? colors.primary : colors.border,
                      }}
                    >
                      <Text
                        className="text-xs"
                        style={{ color: k.pricing === p ? colors.background : colors.foreground, lineHeight: 16 }}
                      >
                        {pricingLabel(p)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
            <View className="flex-row" style={{ gap: 8 }}>
              {k.pricing !== "perPiece" ? (
                <NumField
                  label={t("ice.packGrams")}
                  value={k.packGrams}
                  onChange={(n) => updateKind(k.id, { packGrams: n })}
                  suffix="g"
                />
              ) : null}
              <NumField
                label={k.pricing === "perPiece" ? t("ice.pricePiece") : t("ice.pricePack")}
                value={k.price}
                onChange={(n) => updateKind(k.id, { price: n })}
                suffix="¥"
              />
              {k.pricing === "perDrink" ? (
                <NumField
                  label={t("ice.drinksPerPack")}
                  value={k.drinksPerPack}
                  onChange={(n) => updateKind(k.id, { drinksPerPack: n })}
                  suffix={t("ice.drinksUnit")}
                />
              ) : null}
              {k.pricing === "perGram" ? (
                <NumField
                  label={t("ice.gramsPerDrink")}
                  value={k.gramsPerDrink}
                  onChange={(n) => updateKind(k.id, { gramsPerDrink: n })}
                  suffix="g"
                />
              ) : null}
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">{t("ice.match")}</Text>
              <TextInput
                className="bg-background rounded-lg px-2.5 py-2 text-sm text-foreground"
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, lineHeight: 18 }}
                value={k.match}
                returnKeyType="done"
                autoCapitalize="none"
                onChangeText={(v) => updateKind(k.id, { match: v })}
              />
            </View>
            <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>
              {t("ice.perDrinkCost", { p: iceKindCostPerDrink(k).toFixed(2) })}
            </Text>
          </View>
        ))}

        <Pressable
          onPress={() =>
            addKind({
              id: `ice-${Date.now().toString(36)}`,
              nameZh: t("ice.new.defaultName"),
              nameEn: "",
              pricing: "perGram",
              packGrams: 1000,
              price: 10,
              drinksPerPack: 0,
              gramsPerDrink: 100,
              match: "",
              isShakeIce: false,
            })
          }
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
          <View
            className="rounded-xl py-3 items-center"
            style={{ borderWidth: 1, borderColor: colors.primary, borderStyle: "dashed" }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {t("ice.add")}
            </Text>
          </View>
        </Pressable>

        <Text className="text-[11px] text-muted" style={{ lineHeight: 15 }}>
          {t("ice.note")}
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

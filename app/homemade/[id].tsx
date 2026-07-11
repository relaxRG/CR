import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { StarRating } from "@/components/star-rating";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { estimatePrepCost } from "@/lib/homemade/cost";
import { prepTypeLabelIn } from "@/lib/homemade/types";
import { detectPrepTechniques, techniqueDesc, techniqueLabel } from "@/lib/homemade/technique";
import { parseSource } from "@/lib/recipes/source-parse";

export default function HomemadeDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getPrep, deletePrep, togglePrepMade, setPrepRating, types } = useHomemadeStore();
  const { bottles } = useBottleStore();
  const prep = getPrep(id);

  if (!prep) {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text className="text-base text-muted">{t("hm.notFound")}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>{t("common.back")}</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const handleDelete = () => {
    const doDelete = () => {
      deletePrep(prep.id);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    };
    if (Platform.OS === "web") {
      if (window.confirm(t("tags.delete.confirm", { name: prep.name }))) doDelete();
    } else {
      Alert.alert(t("hm.delete.title"), t("tags.delete.confirm", { name: prep.name }), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const infoRows: { label: string; value: string }[] = [
    { label: t("hmform.type"), value: prepTypeLabelIn(types, prep.type, lang) },
    ...(() => {
      const techs = detectPrepTechniques(prep);
      return techs.length > 0
        ? [
            {
              label: t("hm.technique.title"),
              value: techs.map((k) => techniqueLabel(k, lang)).join(" · "),
            },
          ]
        : [];
    })(),
    ...(prep.yield ? [{ label: t("hm.yield"), value: prep.yield }] : []),
    ...(prep.shelfLife ? [{ label: t("hm.shelfLife"), value: prep.shelfLife }] : []),
    ...(prep.storage ? [{ label: t("hm.storage"), value: prep.storage }] : []),
  ];

  const names = displayNames(prep.name, prep.nameAlt, lang);
  const cost = estimatePrepCost(prep, bottles);
  const techs = detectPrepTechniques(prep);
  const primaryTechDesc = techs.length > 0 ? techniqueDesc(techs[0], lang) : "";

  const sectionTitle = (label: string) => (
    <Text
      className="text-[13px] text-muted uppercase mt-6 mb-2 px-4"
      style={{ letterSpacing: 0.4, lineHeight: 18 }}
    >
      {label}
    </Text>
  );

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-1 pb-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            togglePrepMade(prep.id);
          }}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }, { marginRight: 18 }]}
        >
          <IconSymbol
            name={prep.made ? "checkmark.circle.fill" : "checkmark.circle"}
            size={23}
            color={prep.made ? colors.success : colors.muted}
          />
        </Pressable>
        <Pressable
          onPress={() => router.push({ pathname: "/homemade-form", params: { id: prep.id } })}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }, { marginRight: 18 }]}
        >
          <IconSymbol name="pencil" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="trash.fill" size={22} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text className="text-3xl font-bold text-foreground" style={{ lineHeight: 40 }}>
          {names.primary}
        </Text>
        {names.secondary ? (
          <Text className="text-base text-muted mt-1">{names.secondary}</Text>
        ) : null}

        {sectionTitle(t("bottle.info"))}
        <View className="bg-surface rounded-xl px-4">
          {infoRows.map((row, idx) => (
            <View
              key={row.label}
              className="flex-row items-center justify-between py-2.5"
              style={
                idx < infoRows.length - 1
                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
                  : undefined
              }
            >
              <Text className="text-[15px] text-foreground">{row.label}</Text>
              <Text className="text-[15px] text-muted" style={{ maxWidth: "65%", textAlign: "right" }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Rating */}
        <View className="flex-row items-center justify-between bg-surface rounded-xl mt-2 px-4 py-3">
          <Text className="text-[15px] text-foreground">
            {t("rating.title")}
            {prep.rating ? ` ${prep.rating}/10` : ""}
          </Text>
          <StarRating value={prep.rating} size={17} onChange={(v) => setPrepRating(prep.id, v)} />
        </View>

        {primaryTechDesc ? (
          <View
            className="rounded-xl px-4 py-2.5 mt-2"
            style={{ backgroundColor: colors.warning + "14" }}
          >
            <Text className="text-xs" style={{ color: colors.warning, lineHeight: 17 }}>
              {primaryTechDesc}
            </Text>
            <Text className="text-[10px] text-muted mt-1" style={{ lineHeight: 14 }}>
              {t("hm.technique.auto")}
            </Text>
          </View>
        ) : null}

        {prep.ingredients.length > 0 ? (
          <>
            {sectionTitle(t("hmform.ingredients"))}
            <View className="bg-surface rounded-xl px-4">
              {prep.ingredients.map((ing, idx) => (
                <View
                  key={`${ing}-${idx}`}
                  className="py-2.5"
                  style={
                    idx < prep.ingredients.length - 1
                      ? {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.border,
                        }
                      : undefined
                  }
                >
                  <Text className="text-[15px] text-foreground" style={{ lineHeight: 21 }}>
                    {ing}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Cost estimate card */}
        {prep.ingredients.length > 0 ? (
          <>
            {sectionTitle(t("hm.cost.title"))}
            <View className="bg-surface rounded-xl px-4 pb-1">
              {/* Total header row — same layout as recipe detail cost card */}
              <View
                className="flex-row items-center justify-between py-3.5"
                style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
              >
                <Text className="text-sm text-muted">
                  {t("detail.cost.total", { a: cost.estimatedCount, b: cost.totalCount })}
                </Text>
                <Text className="text-xl font-bold" style={{ color: colors.primary }}>
                  {cost.estimatedCount > 0 ? `¥${cost.batchCost.toFixed(1)}` : "—"}
                </Text>
              </View>
              {/* Per-ingredient rows; tap rows matched to library entries to edit price */}
              {cost.items.map((item, idx) => {
                const matName =
                  item.materialEn || item.materialZh
                    ? displayNames(item.materialEn ?? "", item.materialZh ?? "", lang).primary
                    : null;
                const row = (
                  <View
                    className="flex-row items-center justify-between py-2.5"
                    style={
                      idx > 0
                        ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }
                        : undefined
                    }
                  >
                    <View className="flex-1 pr-3">
                      <Text className="text-sm text-foreground" numberOfLines={1}>
                        {item.line}
                      </Text>
                      {item.cost !== null && matName ? (
                        <View className="flex-row items-center mt-0.5">
                          <Text
                            className="text-xs"
                            numberOfLines={1}
                            style={{ color: item.bottleId ? colors.primary : colors.muted }}
                          >
                            {matName}
                            {item.ref ? ` ${item.ref}` : ""}
                          </Text>
                          {item.bottleId ? (
                            <IconSymbol
                              name="chevron.right"
                              size={11}
                              color={colors.primary}
                              style={{ marginLeft: 2 }}
                            />
                          ) : null}
                        </View>
                      ) : item.cost === null ? (
                        <Text className="text-xs text-muted mt-0.5">
                          {t("hm.cost.noEstimate")}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: item.cost !== null ? colors.foreground : colors.muted }}
                    >
                      {item.cost !== null ? `¥${item.cost.toFixed(1)}` : "—"}
                    </Text>
                  </View>
                );
                return item.bottleId ? (
                  <Pressable
                    key={`${item.line}-${idx}`}
                    onPress={() =>
                      router.push({ pathname: "/bottle/[id]", params: { id: item.bottleId! } })
                    }
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={`${item.line}-${idx}`}>{row}</View>
                );
              })}
              {/* Unit costs */}
              {cost.costPer100Ml !== null || cost.costPer30Ml !== null ? (
                <View
                  className="flex-row items-center justify-between py-2.5"
                  style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                >
                  {cost.costPer100Ml !== null ? (
                    <Text className="text-xs text-muted">
                      {t("hm.cost.per100")} ¥{cost.costPer100Ml.toFixed(2)}
                    </Text>
                  ) : (
                    <View />
                  )}
                  {cost.costPer30Ml !== null ? (
                    <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                      {t("hm.cost.per30")} ¥{cost.costPer30Ml.toFixed(2)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text className="text-[11px] text-muted py-2.5" style={{ lineHeight: 15 }}>
                {cost.yieldMl === null ? t("hm.cost.noYield") : t("hm.cost.tapHint")}
              </Text>
            </View>
          </>
        ) : null}

        {prep.recipe ? (
          <>
            {sectionTitle(t("hm.recipe"))}
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 23 }}>
                {prep.recipe}
              </Text>
            </View>
          </>
        ) : null}

        {prep.notes ? (
          <>
            {sectionTitle(t("hmform.notes"))}
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 22 }}>
                {prep.notes}
              </Text>
            </View>
          </>
        ) : null}

        {prep.source ? (
          <>
            {sectionTitle(t("hmform.source"))}
            <View className="bg-surface rounded-xl px-4 py-3">
              {(() => {
                const ps = parseSource(prep.source);
                const rows = [
                  { label: t("detail.source.venue"), value: ps.venue },
                  { label: t("detail.source.creator"), value: ps.creator },
                  { label: t("detail.source.season"), value: ps.season },
                  { label: t("detail.source.year"), value: ps.year },
                ].filter((r) => r.value);
                if (rows.length === 0) {
                  return (
                    <Text className="text-sm text-muted" style={{ lineHeight: 20 }}>
                      {prep.source}
                    </Text>
                  );
                }
                return (
                  <View style={{ gap: 8 }}>
                    {rows.map((r) => (
                      <View key={r.label} className="flex-row items-start justify-between">
                        <Text className="text-sm text-muted" style={{ width: 110 }}>
                          {r.label}
                        </Text>
                        <Text
                          className="text-sm text-foreground flex-1 text-right"
                          style={{ lineHeight: 19 }}
                        >
                          {r.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

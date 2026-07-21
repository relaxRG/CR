import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, ScrollView as HScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { StarRating } from "@/components/star-rating";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { estimatePrepCostFull } from "@/lib/homemade/cost";
import { smartLinkIngredient } from "@/lib/recipes/smart-link";
import { prepTypeLabelIn, prepSectionLabelIn, prepSectionOfIn } from "@/lib/homemade/types";
import { detectPrepTechniques, techniqueDesc, techniqueLabel } from "@/lib/homemade/technique";
import { parseSource } from "@/lib/recipes/source-parse";

export default function HomemadeDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getPrep, deletePrep, togglePrepMade, setPrepRating, types, sections } = useHomemadeStore();
  const { preps } = useHomemadeStore();
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
    ...((() => {
      const yieldDisplay = (prep.yieldQty && prep.yieldUnit)
        ? `${prep.yieldQty} ${prep.yieldUnit}`
        : prep.yield;
      return yieldDisplay ? [{ label: t("hm.yield"), value: yieldDisplay }] : [];
    })()),
    ...(prep.shelfLife ? [{ label: t("hm.shelfLife"), value: prep.shelfLife }] : []),
    ...(prep.storage ? [{ label: t("hm.storage"), value: prep.storage }] : []),
  ];

  const names = displayNames(prep.name, prep.nameAlt, lang);
  const otherPreps = preps.filter((p) => p.id !== prep.id);
  const cost = estimatePrepCostFull(prep, bottles);
  const techs = detectPrepTechniques(prep);
  const primaryTechDesc = techs.length > 0 ? techniqueDesc(techs[0], lang) : "";

  // 同族形态：同 sourceFamilyKey 的其他变体（排除自身）
  const familySiblings = prep.sourceFamilyKey
    ? preps.filter(
        (p) => p.id !== prep.id && p.sourceFamilyKey === prep.sourceFamilyKey
      )
    : [];

  // 标签分区数据
  const sectionKey = prepSectionOfIn(types, prep.type);
  const sectionLabelText = prepSectionLabelIn(sections, sectionKey, lang);
  const typeLabelText = prepTypeLabelIn(types, prep.type, lang);

  const chipStyle = (primary?: boolean) => ({
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginRight: 6,
    backgroundColor: primary ? (colors.primary + "22") : colors.surface,
    borderWidth: 1,
    borderColor: primary ? (colors.primary + "55") : colors.border,
  });
  const chipTextStyle = (primary?: boolean) => ({
    fontSize: 13,
    color: primary ? colors.primary : colors.foreground,
    fontWeight: primary ? ("600" as const) : ("400" as const),
  });

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
        <Text style={{ fontSize: 28, fontWeight: "700", lineHeight: 34 }} className="text-foreground">
          {names.primary}
        </Text>
        {names.secondary ? (
          <Text className="text-base text-muted mt-1">{names.secondary}</Text>
        ) : null}

        {/* 标签分区行：分区 + 类型 + 工艺标签 */}
        <HScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 2 }}
        >
          <View style={chipStyle(true)}>
            <Text style={chipTextStyle(true)}>{sectionLabelText}</Text>
          </View>
          {typeLabelText !== sectionLabelText ? (
            <View style={chipStyle(false)}>
              <Text style={chipTextStyle(false)}>{typeLabelText}</Text>
            </View>
          ) : null}
          {techs.slice(0, 3).map((techKey) => (
            <View key={techKey} style={chipStyle(false)}>
              <Text style={chipTextStyle(false)}>{techniqueLabel(techKey, lang)}</Text>
            </View>
          ))}
        </HScrollView>

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

        {familySiblings.length > 0 ? (
          <>
            {sectionTitle(lang === "en" ? "Same Family" : "同族形态")}
            <View className="bg-surface rounded-xl px-4">
              {familySiblings.map((sibling, idx) => {
                const sibNames = displayNames(sibling.name, sibling.nameAlt, lang);
                const isLast = idx === familySiblings.length - 1;
                return (
                  <Pressable
                    key={sibling.id}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/homemade/[id]", params: { id: sibling.id } });
                    }}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <View
                      className="flex-row items-center py-3"
                      style={[
                        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                      ]}
                    >
                      <View className="flex-1">
                        <Text className="text-[15px] text-foreground" numberOfLines={1}>
                          {sibNames.primary}
                          {sibling.variantLabel ? (
                            <Text className="text-xs text-muted">{"  "}{sibling.variantLabel}</Text>
                          ) : null}
                        </Text>
                        {sibNames.secondary ? (
                          <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                            {sibNames.secondary}
                          </Text>
                        ) : null}
                      </View>
                      <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
        {/* ── 风味标签 ── */}
        {prep.flavorTags && prep.flavorTags.length > 0 ? (
          <>
            {sectionTitle(lang === "en" ? "Flavor Tags" : "风味标签")}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 4, marginBottom: 8 }}>
              {prep.flavorTags.map((tag) => (
                <View
                  key={tag}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 20,
                    backgroundColor: colors.primary + "18",
                    borderWidth: 1,
                    borderColor: colors.primary + "55",
                  }}
                >
                  <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "500" }}>{tag}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

  {prep.ingredients.length > 0 ? (
    <>
      {sectionTitle(t("hmform.ingredients"))}
      <View className="bg-surface rounded-xl px-4">
        {prep.ingredients.map((ing, idx) => {
          // Strip leading quantity for smart-link matching
          const ingNameOnly = ing.replace(/^\d[\d\s./]*(?:ml|g|oz|cl|dash|drop|piece|个|克|毫升|升|勺|茶匙|大匙)?[\s,，]*/i, "").trim();
          const link = ingNameOnly.length >= 2
            ? smartLinkIngredient(ingNameOnly, bottles, otherPreps)
            : null;
          const isLast = idx === prep.ingredients.length - 1;
          const rowContent = (
            <View
              className="flex-row items-center py-2.5"
              style={!isLast ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : undefined}
            >
              <View className="flex-1">
                <Text className="text-[15px] text-foreground" style={{ lineHeight: 21 }}>
                  {ing}
                </Text>
                {link ? (
                  <Text className="text-xs mt-0.5" style={{ color: colors.muted }} numberOfLines={1}>
                    {link.kind === "bottle"
                      ? (lang === "zh" ? (link.bottle.nameZh || link.bottle.nameEn) : (link.bottle.nameEn || link.bottle.nameZh))
                      : (lang === "zh"
                          ? (/[\u4e00-\u9fff]/.test(link.prep.name) ? link.prep.name : link.prep.nameAlt || link.prep.name)
                          : (!/[\u4e00-\u9fff]/.test(link.prep.name) ? link.prep.name : link.prep.nameAlt || link.prep.name)
                        )
                    }
                  </Text>
                ) : null}
              </View>
              {link ? (
                <IconSymbol
                  name={link.kind === "prep" ? "sparkles" : "chevron.right"}
                  size={14}
                  color={link.kind === "prep" ? colors.aiAccent : colors.muted}
                  style={{ marginLeft: 6 }}
                />
              ) : null}
            </View>
          );
          if (link?.kind === "bottle") {
            return (
              <Pressable
                key={`${ing}-${idx}`}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/bottle/[id]", params: { id: link.bottle.id } });
                }}
                style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              >
                {rowContent}
              </Pressable>
            );
          }
          if (link?.kind === "prep") {
            return (
              <Pressable
                key={`${ing}-${idx}`}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/homemade/[id]", params: { id: link.prep.id } });
                }}
                style={({ pressed }) => [pressed && { opacity: 0.5 }]}
              >
                {rowContent}
              </Pressable>
            );
          }
          return <View key={`${ing}-${idx}`}>{rowContent}</View>;
        })}
      </View>
    </>
  ) : null}

        {prep.recipe ? (
          <>
            {sectionTitle(t("hm.recipe"))}
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 23 }} selectable>
                {prep.recipe}
              </Text>
            </View>
          </>
        ) : null}

        {prep.notes ? (
          <>
            {sectionTitle(t("hmform.notes"))}
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 22 }} selectable>
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
                    <Text selectable className="text-sm text-muted" style={{ lineHeight: 20 }}>
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
                            style={{ color: colors.muted }}
                          >
                            {matName}
                            {item.ref ? ` ${item.ref}` : ""}
                          </Text>
                          {item.bottleId ? (
                            <IconSymbol
                              name="chevron.right"
                              size={11}
                              color={colors.muted}
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
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/bottle/[id]", params: { id: item.bottleId! } });
                    }}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    {row}
                  </Pressable>
                ) : item.homemadeId ? (
                  <Pressable
                    key={`${item.line}-${idx}`}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/homemade/[id]", params: { id: item.homemadeId! } });
                    }}
                    style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={`${item.line}-${idx}`}>{row}</View>
                );
              })}
              {/* Unit costs — 通用单位成本 */}
              {cost.costPerBaseUnit !== null ? (
              <View
                className="flex-row items-center justify-between py-2.5"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
              >
                {/* 每单位成本（通用） */}
                <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                  {lang === "zh"
                    ? `每${cost.baseUnit ?? "份"} ¥${cost.costPerBaseUnit.toFixed(2)}`
                    : `¥${cost.costPerBaseUnit.toFixed(2)} / ${cost.baseUnit ?? "unit"}`}
                </Text>
                {/* 兼容：如果是 ml 单位，额外显示 per30ml */}
                {cost.costPer30Ml !== null && cost.baseUnit === "ml" ? (
                  <Text className="text-xs text-muted">
                    {t("hm.cost.per30")} ¥{cost.costPer30Ml.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ) : (cost.costPer100Ml !== null || cost.costPer30Ml !== null) ? (
              <View
                className="flex-row items-center justify-between py-2.5"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
              >
                {cost.costPer100Ml !== null ? (
                  <Text className="text-xs text-muted">
                    {t("hm.cost.per100")} ¥{cost.costPer100Ml.toFixed(2)}
                  </Text>
                ) : <View />}
                {cost.costPer30Ml !== null ? (
                  <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                    {t("hm.cost.per30")} ¥{cost.costPer30Ml.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {/* 维度自适应：重量产出 */}
            {cost.yieldDimension === "weight" && cost.costPer100g !== null ? (
              <View
                className="flex-row items-center justify-between py-2.5"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
              >
                <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                  {lang === "zh" ? `每100g ¥${cost.costPer100g.toFixed(3)}` : `¥${cost.costPer100g.toFixed(3)} / 100g`}
                </Text>
                {cost.costPerBaseUnit !== null ? (
                  <Text className="text-xs text-muted">
                    {lang === "zh" ? `每g ¥${cost.costPerBaseUnit.toFixed(4)}` : `¥${cost.costPerBaseUnit.toFixed(4)}/g`}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {/* 维度自适应：计件产出 */}
            {cost.yieldDimension === "count" && cost.costPerPiece !== null ? (
              <View
                className="flex-row items-center justify-between py-2.5"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
              >
                <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                  {lang === "zh"
                    ? `每${cost.baseUnit ?? "个"} ¥${cost.costPerPiece.toFixed(2)}`
                    : `¥${cost.costPerPiece.toFixed(2)} / ${cost.baseUnit ?? "pc"}`}
                </Text>
              </View>
            ) : null}
              <Text className="text-[11px] text-muted py-2.5" style={{ lineHeight: 15 }}>
                {(cost.yieldMl === null && cost.baseQty === null)
                  ? (lang === "zh" ? "填写产量和批次成本后自动计算" : "Fill in yield & batch cost to calculate")
                  : t("hm.cost.tapHint")}
              </Text>
            </View>
          </>
        ) : null}

      </ScrollView>
    </ScreenContainer>
  );
}

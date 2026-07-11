import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useLabStore } from "@/lib/lab/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { estimateRecipeAbv } from "@/lib/recipes/abv";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { structuralFormula } from "@/lib/recipes/structure";
import { formatAmountAsMl } from "@/lib/bottles/cost";
import { localizedTagName } from "@/lib/recipes/types";

const COL_WIDTH = 150;
const LABEL_WIDTH = 78;

export default function LabCompareScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const params = useLocalSearchParams<{ projectId: string; ids: string }>();
  const { getProject, batchesOf } = useLabStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const [diffOnly, setDiffOnly] = useState(false);

  const project = getProject(params.projectId);
  const all = batchesOf(params.projectId);
  const ids = (params.ids ?? "").split(",").filter(Boolean);
  const cols = useMemo(
    () => all.filter((b) => ids.includes(b.id)).sort((a, b) => a.seq - b.seq),
    [all, ids],
  );

  /** 配料并集行 */
  const ingredientRows = useMemo(() => {
    const keys: string[] = [];
    for (const b of cols) {
      for (const ing of b.spec.ingredients) {
        const k = ing.name.trim();
        if (k && !keys.includes(k)) keys.push(k);
      }
    }
    return keys.map((name) => {
      const values = cols.map((b) => {
        const hit = b.spec.ingredients.find((i) => i.name.trim() === name);
        return hit ? hit.amount || "✓" : null;
      });
      const nonNull = values.filter((v) => v !== null);
      const allSame = nonNull.length === cols.length && new Set(nonNull).size === 1;
      return { name, values, differs: !allSame };
    });
  }, [cols]);

  /** 规格行 */
  const specRows = useMemo(() => {
    const defs: { label: string; get: (b: (typeof cols)[number]) => string }[] = [
      { label: t("detail.meta.method"), get: (b) => localizedTagName(b.spec.method, "", lang) || "—" },
      { label: t("detail.meta.ice"), get: (b) => localizedTagName(b.spec.ice, "", lang) || "—" },
      { label: t("detail.meta.glass"), get: (b) => localizedTagName(b.spec.glass, "", lang) || "—" },
      { label: t("form.garnish"), get: (b) => b.spec.garnish || "—" },
    ];
    return defs.map((d) => {
      const values = cols.map(d.get);
      const differs = new Set(values).size > 1;
      return { label: d.label, values, differs };
    });
  }, [cols, t, lang]);

  /** 指标行 */
  const metricRows = useMemo(() => {
    const abvs = cols.map((b) => {
      const est = estimateRecipeAbv(b.spec.ingredients, b.spec.method, bottles, preps);
      return est.abv !== null ? `≈${est.abv}%` : "—";
    });
    const costs = cols.map((b) => {
      const est = estimateRecipeCostSmart(b.spec.ingredients, bottles, preps);
      return est.estimatedCount > 0 ? `≈¥${est.total.toFixed(1)}` : "—";
    });
    const formulas = cols.map(
      (b) => structuralFormula(b.spec.ingredients, lang as "zh" | "en", formatAmountAsMl) || "—",
    );
    return [
      { label: t("lab.metric.abv"), values: abvs, differs: new Set(abvs).size > 1 },
      { label: t("lab.metric.cost"), values: costs, differs: new Set(costs).size > 1 },
      { label: t("lab.metric.structure"), values: formulas, differs: new Set(formulas).size > 1 },
    ];
  }, [cols, bottles, preps, lang, t]);

  if (!project || cols.length < 2) {
    return (
      <ScreenContainer className="items-center justify-center">
        <Text className="text-base text-muted">{t("detail.notFound")}</Text>
      </ScreenContainer>
    );
  }

  const renderRow = (
    key: string,
    label: string,
    values: (string | null)[],
    differs: boolean,
  ) => {
    if (diffOnly && !differs) return null;
    return (
      <View
        key={key}
        className="flex-row"
        style={{
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingVertical: 8,
        }}
      >
        <Text
          className="text-xs text-muted"
          style={{ width: LABEL_WIDTH, lineHeight: 16, paddingRight: 6 }}
        >
          {label}
        </Text>
        {values.map((v, i) => (
          <Text
            key={i}
            className="text-sm"
            style={{
              width: COL_WIDTH,
              lineHeight: 19,
              paddingRight: 8,
              color: v === null ? colors.muted : differs ? "#F59E0B" : colors.foreground,
              fontWeight: differs && v !== null ? "600" : "400",
            }}
          >
            {v ?? "—"}
          </Text>
        ))}
      </View>
    );
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View className="px-5 pt-2 pb-2 flex-row items-center" style={{ gap: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text className="text-xl font-bold text-foreground" style={{ lineHeight: 26 }} numberOfLines={1}>
            {t("lab.compare.title")}
          </Text>
          <Text className="text-xs text-muted" style={{ lineHeight: 16 }} numberOfLines={1}>
            {project.name}
          </Text>
        </View>
        <Pressable
          onPress={() => setDiffOnly((v) => !v)}
          style={({ pressed }) => [
            styles.diffToggle,
            {
              backgroundColor: diffOnly ? colors.primary : colors.surface,
              borderColor: diffOnly ? colors.primary : colors.border,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text
            className="text-xs font-medium"
            style={{ color: diffOnly ? "#FFFFFF" : colors.muted, lineHeight: 16 }}
          >
            {t("lab.compare.diffOnly")}
          </Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 列头 */}
          <View className="flex-row" style={{ paddingVertical: 8 }}>
            <View style={{ width: LABEL_WIDTH }} />
            {cols.map((b) => (
              <View key={b.id} style={{ width: COL_WIDTH }}>
                <Text className="text-base font-bold" style={{ color: colors.primary, lineHeight: 22 }}>
                  v{b.seq}
                </Text>
                <Text className="text-xs text-muted" style={{ lineHeight: 15 }}>
                  {new Date(b.createdAt).toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </Text>
              </View>
            ))}
          </View>

          {/* 配料 */}
          <Text className="text-sm font-semibold text-foreground mt-2 mb-1">
            {t("lab.compare.ingredients")}
          </Text>
          {ingredientRows.map((r) => renderRow(`ing-${r.name}`, r.name, r.values, r.differs))}

          {/* 规格 */}
          <Text className="text-sm font-semibold text-foreground mt-4 mb-1">
            {t("lab.compare.spec")}
          </Text>
          {specRows.map((r, i) => renderRow(`spec-${i}`, r.label, r.values, r.differs))}

          {/* 指标 */}
          <Text className="text-sm font-semibold text-foreground mt-4 mb-1">
            {t("lab.metrics")}
          </Text>
          {metricRows.map((r, i) => renderRow(`m-${i}`, r.label, r.values, r.differs))}

          {/* 品鉴与评分 */}
          <Text className="text-sm font-semibold text-foreground mt-4 mb-1">
            {t("lab.compare.notes")}
          </Text>
          <View className="flex-row" style={{ paddingVertical: 8 }}>
            <Text className="text-xs text-muted" style={{ width: LABEL_WIDTH, lineHeight: 16, paddingRight: 6 }}>
              {t("lab.batch.score")}
            </Text>
            {cols.map((b) => (
              <View key={b.id} className="flex-row items-center" style={{ width: COL_WIDTH, gap: 3 }}>
                {b.score !== null ? (
                  <>
                    <IconSymbol name="star.fill" size={12} color="#F59E0B" />
                    <Text className="text-sm font-semibold text-foreground" style={{ lineHeight: 18 }}>
                      {b.score}
                    </Text>
                  </>
                ) : (
                  <Text className="text-sm text-muted" style={{ lineHeight: 18 }}>
                    —
                  </Text>
                )}
                {b.verdict ? (
                  <Text className="text-xs text-muted ml-1" style={{ lineHeight: 16 }}>
                    {t(`lab.verdict.${b.verdict}` as "lab.verdict.keeper")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          <View className="flex-row" style={{ paddingVertical: 4 }}>
            <Text className="text-xs text-muted" style={{ width: LABEL_WIDTH, lineHeight: 16, paddingRight: 6 }}>
              {t("lab.batch.tasting")}
            </Text>
            {cols.map((b) => (
              <Text
                key={b.id}
                className="text-xs text-foreground"
                style={{ width: COL_WIDTH, lineHeight: 17, paddingRight: 8 }}
              >
                {b.tastingNote || "—"}
              </Text>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  diffToggle: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});

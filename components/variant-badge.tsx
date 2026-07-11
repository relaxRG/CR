import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { analyzeLineage, type LineageVerdict } from "@/lib/recipes/lineage";
import type { Recipe } from "@/lib/recipes/types";

/** 模块级结果缓存:列表 400+ 卡片每行跑加权引擎开销大,以名称+配料指纹为键缓存 */
const verdictCache = new Map<string, LineageVerdict>();
function cachedAnalyze(
  r: Pick<Recipe, "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass">,
): LineageVerdict {
  const key = `${r.name}|${r.nameEn ?? ""}|${r.method ?? ""}|${(r.ingredients ?? [])
    .map((i) => i.name)
    .join(",")}`;
  const hit = verdictCache.get(key);
  if (hit) return hit;
  const v = analyzeLineage(r);
  if (verdictCache.size > 800) verdictCache.clear();
  verdictCache.set(key, v);
  return v;
}

/**
 * 解析配方的「Variant of」展示名:
 * - 人工填写的 variantOf 优先
 * - 否则用智能谱系引擎判定(low 置信度不显示)
 * - 配方本身即经典时返回 isClassic=true(卡片/详情标注「经典原方 Classic」)
 */
export function resolveVariantLabel(
  recipe: Pick<Recipe, "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass" | "variantOf">,
  lang: string,
): { label: string; verdict: LineageVerdict | null; isClassic?: boolean } | null {
  const verdict = cachedAnalyze(recipe);
  const manual = (recipe.variantOf ?? "").trim();
  const nameNorm = `${recipe.name} ${recipe.nameEn ?? ""}`.toLowerCase();
  if (manual) {
    // 配方本身即经典:人工字段与名称一致时标注经典原方
    if (nameNorm.includes(manual.toLowerCase())) {
      return { label: pickLangName(manual, lang), verdict, isClassic: true };
    }
    return { label: pickLangName(manual, lang), verdict };
  }
  if (!verdict.classic) return null;
  if (
    nameNorm.includes(verdict.classic.en.toLowerCase()) ||
    nameNorm.includes(verdict.classic.zh)
  ) {
    const label =
      lang === "en" ? verdict.classic.en : `${verdict.classic.zh} ${verdict.classic.en}`;
    return { label, verdict, isClassic: true };
  }
  const label =
    lang === "en" ? verdict.classic.en : `${verdict.classic.zh} ${verdict.classic.en}`;
  return { label, verdict };
}

/** 「尼格罗尼 Negroni」式双语文本按界面语言取合适显示名 */
function pickLangName(full: string, lang: string): string {
  const m = full.match(/^([\u4e00-\u9fff·]+)\s+([A-Za-z].*)$/);
  if (!m) return full;
  return lang === "en" ? m[2] : full;
}

interface VariantBadgeProps {
  recipe: Pick<
    Recipe,
    "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass" | "variantOf"
  >;
  /** compact:列表卡片小标签(不可点开);full:详情页标注(点按弹资料浮层) */
  mode?: "full" | "compact";
}

/** 「Variant of 经典鸡尾酒」标注:详情页点按弹出完整谱系论证浮层 */
export function VariantBadge({ recipe, mode = "full" }: VariantBadgeProps) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);

  const resolved = React.useMemo(
    () => resolveVariantLabel(recipe, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipe.name, recipe.nameEn, recipe.variantOf, recipe.ingredients, recipe.method, lang],
  );
  if (!resolved) return null;

  if (mode === "compact") {
    // Apple HIG:纯文字次要标注,无色块背景,与主名左对齐
    return (
      <Text
        className="text-xs"
        numberOfLines={1}
        style={{ color: colors.muted, lineHeight: 16 }}
      >
        {resolved.isClassic
          ? t("variant.classicSelf")
          : t("variant.of", { name: resolved.label })}
      </Text>
    );
  }

  const openSheet = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={openSheet}
        hitSlop={8}
        style={({ pressed }) => [styles.badgeRow, pressed && { opacity: 0.6 }]}
      >
        <IconSymbol name="book.fill" size={13} color={colors.primary} />
        <Text className="text-sm font-medium" style={{ color: colors.primary }}>
          {resolved.isClassic
            ? t("variant.classicSelf")
            : t("variant.of", { name: resolved.label })}
        </Text>
        <IconSymbol name="chevron.right" size={12} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        {/* 点空白处收起 */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View
          className="bg-background rounded-t-3xl"
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View className="flex-row items-center justify-between px-5 pt-1 pb-3">
            <Text className="text-lg font-bold text-foreground" numberOfLines={1} style={{ flex: 1, lineHeight: 26 }}>
              {t("variant.sheet.title", { name: resolved.label })}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <IconSymbol name="xmark.circle.fill" size={26} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            style={{ maxHeight: 480 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {resolved.verdict ? (
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 24 }}>
                {resolved.verdict.narrative}
              </Text>
            ) : null}
            <Text className="text-xs text-muted mt-3" style={{ lineHeight: 18 }}>
              {t("detail.lineage.hint")}
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: 6,
  },
});

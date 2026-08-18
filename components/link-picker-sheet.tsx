import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View, FlatList, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { suggestIngredients, type IngredientSuggestion } from "@/lib/suggest";
import type { Bottle } from "@/lib/bottles/types";
import type { HomemadePrep } from "@/lib/homemade/types";
import type { GroupResolver } from "@/lib/suggest";
import { RESPONSIVE_LAYOUT } from "@/lib/theme/responsive-layout-tokens";
import { MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS, MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

export type LinkPickResult =
  | { kind: "bottle"; bottleId: string; name: string }
  | { kind: "prep"; prepId: string; name: string }
  | { kind: "none" };

interface Props {
  visible: boolean;
  /** 初始搜索词（行内原文） */
  initialQuery: string;
  bottles: Bottle[];
  preps: HomemadePrep[];
  groupOf?: GroupResolver;
  onPick: (result: LinkPickResult) => void;
  onClose: () => void;
}

const SOURCE_COLOR: Record<string, string> = {
  homemade: "#0A84FF",
  spirits: "#FF9500",
  materials: "#34C759",
  bottles: "#5AC8FA",
};

/**
 * 多候选链接选择器（装饰行与配料行共用）
 * 以原文为搜索词列出库内相似候选，可改词搜索、点选精确绑定，或选择「不链接（保留原文）」。
 */
export function LinkPickerSheet({ visible, initialQuery, bottles, preps, groupOf, onPick, onClose }: Props) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(initialQuery);

  // visible 变化时重置搜索词
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) setQuery(initialQuery);
  }

  const results: IngredientSuggestion[] = useMemo(() => {
    if (!query.trim()) return [];
    return suggestIngredients(query.trim(), bottles, preps, lang as "zh" | "en", 12, groupOf);
  }, [query, bottles, preps, lang, groupOf]);

  const handlePick = (s: IngredientSuggestion) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!s.refId) return;
    if (s.source === "homemade") {
      onPick({ kind: "prep", prepId: s.refId, name: s.value });
    } else {
      onPick({ kind: "bottle", bottleId: s.refId, name: s.value });
    }
  };

  const sourceLabel = (src: string) =>
    src === "homemade" ? t("form.suggest.homemade") : src === "spirits" ? t("form.suggest.spirits") : src === "materials" ? t("form.suggest.materials") : t("form.suggest.bottle");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, RESPONSIVE_LAYOUT.sheetContent, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.handle} />
        <Text className="text-base font-semibold text-foreground" style={{ textAlign: "center", marginBottom: 10, lineHeight: 22 }}>
          {t("form.link.pickTitle")}
        </Text>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={15} color={colors.muted} />
          <TextInput
            style={[RESPONSIVE_LAYOUT.fluidRowContent, { fontSize: 15, color: colors.foreground, paddingVertical: 8, lineHeight: 20 }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t("form.link.searchPlaceholder")}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} style={RESPONSIVE_LAYOUT.fixedRowItem}>
              <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          data={results}
          keyExtractor={(s) => s.key}
          style={{ maxHeight: 320, marginTop: 8 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text className="text-sm text-muted" style={{ textAlign: "center", paddingVertical: 24, lineHeight: 20 }}>
              {t("form.link.noResults")}
            </Text>
          }
          renderItem={({ item: s, index }) => (
            <Pressable
              onPress={() => handlePick(s)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <IconSymbol
                name={s.source === "homemade" ? "sparkles" : s.source === "spirits" ? "flame.fill" : s.source === "materials" ? "leaf.fill" : "wineglass.fill"}
                size={14}
                color={SOURCE_COLOR[s.source] ?? colors.muted}
              />
              <View style={RESPONSIVE_LAYOUT.fluidRowContent}>
                <Text className="text-[15px] text-foreground" numberOfLines={1} style={[RESPONSIVE_LAYOUT.rowText, { lineHeight: 20 }]}>{s.value}</Text>
                {s.secondary ? (
                  <Text className="text-xs text-muted" numberOfLines={1} style={[RESPONSIVE_LAYOUT.rowText, { lineHeight: 16 }]}>{s.secondary}</Text>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[RESPONSIVE_LAYOUT.fixedRowItem, { fontSize: 11, lineHeight: 14, color: SOURCE_COLOR[s.source] ?? colors.muted }]}>{sourceLabel(s.source)}</Text>
            </Pressable>
          )}
        />
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={() => onPick({ kind: "none" })}
            style={({ pressed }) => [styles.footerBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }, pressed && { opacity: 0.7 }]}
          >
            <Text className="text-sm font-medium text-muted" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[RESPONSIVE_LAYOUT.actionText, { lineHeight: 20 }]}>
              {t("form.link.keepText")}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.footerBtn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }, pressed && { opacity: 0.7 }]}
          >
            <Text className="text-sm font-medium text-foreground" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[RESPONSIVE_LAYOUT.actionText, { lineHeight: 20 }]}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C7C7CC",
    alignSelf: "center",
    marginBottom: 10,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  footerBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
  },
});

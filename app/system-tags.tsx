import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { IOSColorPickerSheet } from "@/components/ios-color-picker";
import { useRecipeStore } from "@/lib/recipes/store";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { TagKind } from "@/lib/recipes/types";

const SYSTEM_KINDS: { kind: TagKind; labelKey: string }[] = [
  { kind: "duration", labelKey: "tags.section.duration" },
  { kind: "occasion", labelKey: "tags.section.occasion" },
];

export default function SystemTagsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t } = useI18n();
  const { tagsOf, setTagColor } = useRecipeStore();

  const [pickerTagId, setPickerTagId] = useState<string | null>(null);
  const [pickerColor, setPickerColor] = useState<string>("#007AFF");

  const pickerTag = pickerTagId
    ? [...tagsOf("duration"), ...tagsOf("occasion")].find((t) => t.id === pickerTagId)
    : null;

  return (
    <ScreenContainer>
      {/* 顶部标题栏 */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [{ padding: 4, marginLeft: -8 }, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("me.systemTags")}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {SYSTEM_KINDS.map(({ kind, labelKey }) => {
          const items = tagsOf(kind);
          return (
            <View key={kind} style={{ marginBottom: 24 }}>
              {/* 分组标题 */}
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>
                {t(labelKey as any)}
              </Text>
              {/* 标签列表 */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {items.map((tag, idx) => (
                  <View key={tag.id}>
                    {idx > 0 && (
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />
                    )}
                    <Pressable
                      onPress={() => {
                        setPickerTagId(tag.id);
                        setPickerColor(tag.color);
                      }}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                    >
                      {/* 颜色圆点 */}
                      <View style={[styles.colorDot, { backgroundColor: tag.color }]} />
                      {/* 标签名 */}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tagName, { color: colors.foreground }]}>
                          {tag.name}
                        </Text>
                        {tag.nameEn ? (
                          <Text style={[styles.tagNameEn, { color: colors.muted }]}>
                            {tag.nameEn}
                          </Text>
                        ) : null}
                      </View>
                      {/* 颜色预览 + 箭头 */}
                      <View style={[styles.colorSwatch, { backgroundColor: tag.color }]} />
                      <IconSymbol name="chevron.right" size={16} color={colors.muted} style={{ marginLeft: 4 }} />
                    </Pressable>
                  </View>
                ))}
                {items.length === 0 && (
                  <View style={{ padding: 16, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 14 }}>{t("tags.empty", { s: t(labelKey as any) })}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* 说明文字 */}
        <Text style={[styles.hint, { color: colors.muted }]}>
          {t("systemTags.hint")}
        </Text>
      </ScrollView>

      {/* 颜色选择器 */}
      <IOSColorPickerSheet
        visible={pickerTagId !== null}
        value={pickerColor}
        onChange={setPickerColor}
        onClose={() => {
          if (pickerTagId) setTagColor(pickerTagId, pickerColor);
          setPickerTagId(null);
        }}
        title={pickerTag ? `${pickerTag.name} — ${t("tags.color.title")}` : t("tags.color.title")}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    lineHeight: 41,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  tagName: {
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
  },
  tagNameEn: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  colorSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
    marginTop: 4,
  },
});

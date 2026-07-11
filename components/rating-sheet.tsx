import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StarRating } from "@/components/star-rating";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

/**
 * 评分底部弹层:1-10 星点选(无半星),再点当前分数或"清除"取消评分。
 * 供列表滑动"评分"快捷操作与详情页共用。
 */
export function RatingSheet({
  visible,
  title,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: number | null;
  onChange: (v: number | null) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          {value ? `${value}/10` : t("rating.tapToRate")}
        </Text>
        <View style={styles.starsWrap}>
          <StarRating
            value={value}
            size={26}
            onChange={(v) => {
              onChange(v);
              onClose();
            }}
          />
        </View>
        <View style={styles.footer}>
          {value != null && (
            <Pressable
              onPress={() => {
                onChange(null);
                onClose();
              }}
              style={({ pressed }) => [
                styles.footerBtn,
                { borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.footerBtnText, { color: colors.error }]}>
                {t("rating.clear")}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.footerBtn,
              { borderColor: colors.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.footerBtnText, { color: colors.text }]}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: "700", textAlign: "center", lineHeight: 22 },
  subtitle: { fontSize: 13, textAlign: "center", marginTop: 4, lineHeight: 18 },
  starsWrap: { alignItems: "center", marginVertical: 16 },
  footer: { flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 4 },
  footerBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footerBtnText: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
});

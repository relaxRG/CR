import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

export interface BulkAction {
  key: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * 底部批量操作栏:多选模式下浮在列表底部,展示已选数量、全选/取消全选与批量操作按钮。
 * 三库列表页共用,操作项由页面注入(批量删除/改分类/改标签/改分区等)。
 */
export function BulkActionBar({
  count,
  total,
  onSelectAll,
  onClearAll,
  actions,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClearAll: () => void;
  actions: BulkAction[];
}) {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const allSelected = total > 0 && count >= total;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text style={[styles.count, { color: colors.foreground }]}>
          {t("sel.count").replace("{n}", String(count))}
        </Text>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (allSelected) onClearAll();
            else onSelectAll();
          }}
          style={({ pressed }) => [styles.selAllBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.selAllText, { color: colors.primary }]}>
            {allSelected ? t("sel.none") : t("sel.all")}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsRow}>
        {actions.map((a) => {
          const disabled = count === 0 || a.disabled === true;
          const color = a.destructive ? colors.error : colors.primary;
          return (
            <Pressable
              key={a.key}
              disabled={disabled}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                a.onPress();
              }}
              style={({ pressed }) => [
                styles.actionBtn,
                { borderColor: a.destructive ? colors.error : colors.border, backgroundColor: colors.background },
                disabled && { opacity: 0.35 },
                pressed && { opacity: 0.7 },
              ]}
            >
              {a.icon ? <IconSymbol name={a.icon as any} size={15} color={color} /> : null}
              <Text style={[styles.actionText, { color }]}>{a.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * 批量修改选项弹层:单选一组选项(分类/类型/分区等),点确认应用到所选条目。
 * options 传入 {key,label,color?};multi=true 时为多选(如风味标签)。
 */
export function BulkEditSheet({
  visible,
  title,
  options,
  multi = false,
  count,
  allowClear = false,
  onApply,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { key: string; label: string; color?: string }[];
  multi?: boolean;
  count: number;
  allowClear?: boolean;
  onApply: (keys: string[]) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (visible) setPicked([]);
  }, [visible]);

  const toggle = (key: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPicked((prev) => {
      if (multi) return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      return prev.includes(key) ? [] : [key];
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={styles.sheetHandle} />
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.optionsWrap}>
          {options.map((o) => {
            const active = picked.includes(o.key);
            return (
              <Pressable
                key={o.key}
                onPress={() => toggle(o.key)}
                style={[
                  styles.optChip,
                  { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.background },
                ]}
              >
                {o.color ? <View style={[styles.optDot, { backgroundColor: o.color }]} /> : null}
                <Text style={[styles.optText, { color: active ? "#fff" : colors.foreground }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {allowClear ? (
          <Pressable
            onPress={() => {
              onApply([]);
            }}
            style={({ pressed }) => [styles.clearFieldBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.clearFieldText, { color: colors.error }]}>{t("sel.sheet.clearField")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          disabled={picked.length === 0}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onApply(picked);
          }}
          style={({ pressed }) => [
            styles.applyBtn,
            { backgroundColor: colors.primary },
            picked.length === 0 && { opacity: 0.4 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.applyText}>{t("sel.sheet.apply").replace("{n}", String(count))}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 10,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  selAllBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  selAllText: { fontSize: 14, fontWeight: "600", lineHeight: 18 },
  actionsRow: { flexDirection: "row", gap: 8, paddingRight: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionText: { fontSize: 14, fontWeight: "600", lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(127,127,127,0.35)",
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 17, fontWeight: "700", lineHeight: 22, marginBottom: 12 },
  optionsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  optChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  optDot: { width: 8, height: 8, borderRadius: 4 },
  optText: { fontSize: 14, lineHeight: 18 },
  clearFieldBtn: { alignSelf: "center", paddingVertical: 8, marginTop: 2 },
  clearFieldText: { fontSize: 14, fontWeight: "600", lineHeight: 18 },
  applyBtn: {
    marginTop: 8,
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 13,
  },
  applyText: { color: "#fff", fontSize: 16, fontWeight: "700", lineHeight: 20 },
});

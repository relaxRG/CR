import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import type { BulkImportItem } from "@/server/routers";

/**
 * 表单页顶部的智能导入栏:粘贴导入 / 拍照导入 / 相册导入。
 * 识别成功后将首个匹配条目回调给表单页回填。
 */
export function SmartImportBar({
  targetType,
  onExtracted,
}: {
  /** 期望的条目类型:bottle/material 归 bottle 表单,prep,recipe */
  targetType: "bottle" | "prep" | "recipe";
  onExtracted: (item: BulkImportItem, all: BulkImportItem[]) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const extractMutation = trpc.bulkImport.extract.useMutation();
  const [busyKind, setBusyKind] = useState<"paste" | "camera" | "photo" | null>(null);
  const busy = busyKind !== null;

  const pickItem = useCallback(
    (items: BulkImportItem[]): BulkImportItem | null => {
      if (!items.length) return null;
      const wanted =
        targetType === "bottle"
          ? items.find((i) => i.type === "bottle" || i.type === "material")
          : items.find((i) => i.type === targetType);
      return wanted ?? items[0];
    },
    [targetType],
  );

  const handleResult = useCallback(
    (items: BulkImportItem[]) => {
      const item = pickItem(items);
      if (!item) {
        Alert.alert(t("smartImport.empty.title"), t("smartImport.empty.msg"));
        return;
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      onExtracted(item, items);
    },
    [onExtracted, pickItem, t],
  );

  const fail = useCallback(
    (e: unknown) => {
      Alert.alert(
        t("smartImport.fail.title"),
        e instanceof Error ? e.message : t("smartImport.fail.msg"),
      );
    },
    [t],
  );

  const runPaste = useCallback(async () => {
    try {
      setBusyKind("paste");
      const text = (await Clipboard.getStringAsync())?.trim();
      if (!text) {
        Alert.alert(t("smartImport.clipboard.empty.title"), t("smartImport.clipboard.empty.msg"));
        return;
      }
      const res = await extractMutation.mutateAsync({ text });
      handleResult(res.items as BulkImportItem[]);
    } catch (e) {
      fail(e);
    } finally {
      setBusyKind(null);
    }
  }, [extractMutation, fail, handleResult, t]);

  const runImage = useCallback(
    async (kind: "camera" | "photo") => {
      try {
        setBusyKind(kind);
        const res =
          kind === "camera"
            ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.8,
                base64: true,
              });
        if (res.canceled || !res.assets?.[0]?.base64) return;
        const asset = res.assets[0];
        const out = await extractMutation.mutateAsync({
          imageBase64: asset.base64!,
          imageMime: asset.mimeType || "image/jpeg",
        });
        handleResult(out.items as BulkImportItem[]);
      } catch (e) {
        fail(e);
      } finally {
        setBusyKind(null);
      }
    },
    [extractMutation, fail, handleResult],
  );

  const buttons: {
    key: "paste" | "camera" | "photo";
    icon: "doc.on.clipboard" | "camera.fill" | "photo.fill";
    label: string;
    onPress: () => void;
  }[] = [
    { key: "paste", icon: "doc.on.clipboard", label: t("smartImport.paste"), onPress: runPaste },
    ...(Platform.OS !== "web"
      ? ([
          {
            key: "camera" as const,
            icon: "camera.fill" as const,
            label: t("smartImport.camera"),
            onPress: () => runImage("camera"),
          },
        ] as const)
      : []),
    { key: "photo", icon: "photo.fill", label: t("smartImport.photo"), onPress: () => runImage("photo") },
  ];

  return (
    <View
      className="bg-surface rounded-xl border border-border px-3 py-2.5 mb-4"
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      {buttons.map((b) => (
        <Pressable
          key={b.key}
          onPress={b.onPress}
          disabled={busy}
          style={({ pressed }) => [
            {
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 8,
              borderRadius: 9,
              backgroundColor: colors.primary + "14",
              opacity: busy && busyKind !== b.key ? 0.4 : 1,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          {busyKind === b.key ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <IconSymbol name={b.icon} size={15} color={colors.primary} />
          )}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{b.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

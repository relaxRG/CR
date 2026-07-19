import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { bulkImportExtract } from "@/lib/api/smart-router";
import { parseAppleBooksExcerpt, type AppleBooksExcerpt } from "@/lib/import/apple-books";
import type { BulkImportItem } from "@/shared/client-types";

/** 导入来源元数据（Apple Books 摘录尾注解析结果等） */
export interface ImportSourceMeta {
  bookTitle: string;
  bookAuthor: string;
  /** 原始粘贴文本（含尾注），供 sourceRef.rawText 留档 */
  rawText: string;
}

/**
 * 表单页顶部的智能导入栏：粘贴/拍照/相册导入。
 * - 粘贴：点击展开多行文本框，支持手动输入或一键读剪贴板
 * - 拍照/相册：完整权限请求流程，被拒时引导去系统设置
 * - 相册：支持多图批量选择（最多 6 张）
 */
export function SmartImportBar({
  targetType,
  onExtracted,
}: {
  targetType: "bottle" | "prep" | "recipe";
  onExtracted: (item: BulkImportItem, all: BulkImportItem[], sourceMeta?: ImportSourceMeta) => void;
}) {
  const colors = useColors();
  const { t, lang } = useI18n();

  const [busyKind, setBusyKind] = useState<"paste" | "camera" | "photo" | null>(null);
  const [pasteExpanded, setPasteExpanded] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const pasteInputRef = useRef<TextInput>(null);
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
    (items: BulkImportItem[], sourceMeta?: ImportSourceMeta) => {
      const item = pickItem(items);
      if (!item) {
        Alert.alert(t("smartImport.empty.title"), t("smartImport.empty.msg"));
        return;
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      onExtracted(item, items, sourceMeta);
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

  // ── 粘贴文本框 ────────────────────────────────────────────────────────────────

  const openPasteBox = useCallback(async () => {
    setPasteExpanded(true);
    // 自动读取剪贴板内容填入文本框
    try {
      const text = (await Clipboard.getStringAsync())?.trim();
      if (text) setPasteText(text);
    } catch {}
    setTimeout(() => pasteInputRef.current?.focus(), 150);
  }, []);

  const runPasteFromBox = useCallback(async () => {
    try {
      setBusyKind("paste");
      const text = pasteText.trim();
      if (!text) {
        Alert.alert(t("smartImport.clipboard.empty.title"), t("smartImport.clipboard.empty.msg"));
        return;
      }
      // Apple Books 摘录尾注：本地正则解析书名/作者，剥离尾注后再发 AI（Bug 9）
      const excerpt: AppleBooksExcerpt | null = parseAppleBooksExcerpt(text);
      const aiText = excerpt ? excerpt.cleanText : text;
      const res = await bulkImportExtract({ text: aiText, lang: lang as 'zh' | 'en' });
      const meta: ImportSourceMeta | undefined = excerpt
        ? { bookTitle: excerpt.bookTitle, bookAuthor: excerpt.bookAuthor, rawText: excerpt.rawText }
        : undefined;
      handleResult(res.items as BulkImportItem[], meta);
      setPasteExpanded(false);
      setPasteText("");
    } catch (e) {
      fail(e);
    } finally {
      setBusyKind(null);
    }
  }, [fail, handleResult, pasteText, t, lang]);

  const handlePastePress = useCallback(() => {
    if (!pasteExpanded) {
      openPasteBox();
    } else {
      runPasteFromBox();
    }
  }, [pasteExpanded, openPasteBox, runPasteFromBox]);

  // ── 图片导入（相机/相册） ──────────────────────────────────────────────────────

  const runImage = useCallback(
    async (kind: "camera" | "photo") => {
      try {
        setBusyKind(kind);

        // 请求权限
        if (kind === "camera") {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              lang === "zh" ? "需要相机权限" : "Camera Permission Required",
              lang === "zh"
                ? "请在系统设置中开启相机权限，以便拍照导入。"
                : "Please enable camera access in Settings to use this feature.",
              [
                { text: lang === "zh" ? "去设置" : "Open Settings", onPress: () => Linking.openSettings() },
                { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
              ],
            );
            return;
          }
        } else {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert(
              lang === "zh" ? "需要相册权限" : "Photo Library Permission Required",
              lang === "zh"
                ? "请在系统设置中开启相册权限，以便从相册导入。"
                : "Please enable photo library access in Settings to use this feature.",
              [
                { text: lang === "zh" ? "去设置" : "Open Settings", onPress: () => Linking.openSettings() },
                { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
              ],
            );
            return;
          }
        }

        const res =
          kind === "camera"
            ? await ImagePicker.launchCameraAsync({
                quality: 0.7,
                base64: true,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                quality: 0.7,
                base64: true,
                allowsMultipleSelection: true,
                selectionLimit: 6,
              });

        if (res.canceled || !res.assets?.[0]?.base64) return;

        // 取第一张主图发送给 AI（Worker v3 会自动用 Qwen-VL-Max 处理图片）
        const asset = res.assets[0];
        const out = await bulkImportExtract({
          imageBase64: asset.base64!,
          imageMime: asset.mimeType || "image/jpeg",
          lang: lang as 'zh' | 'en',
        });
        handleResult(out.items as BulkImportItem[]);
      } catch (e) {
        fail(e);
      } finally {
        setBusyKind(null);
      }
    },
    [fail, handleResult, lang],
  );

  return (
    <View className="bg-surface rounded-xl border border-border mb-4" style={{ overflow: "hidden" }}>
      {/* 主按钮行 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
        {/* 粘贴/文字导入按钮 */}
        <Pressable
          onPress={handlePastePress}
          disabled={busy && busyKind !== "paste"}
          style={({ pressed }) => [
            {
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 8,
              borderRadius: 9,
              backgroundColor: pasteExpanded ? colors.primary + "22" : colors.primary + "14",
              borderWidth: pasteExpanded ? 1 : 0,
              borderColor: pasteExpanded ? colors.primary + "60" : "transparent",
              opacity: busy && busyKind !== "paste" ? 0.4 : 1,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          {busyKind === "paste" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <IconSymbol name="doc.on.clipboard" size={15} color={colors.primary} />
          )}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
            {pasteExpanded
              ? (lang === "zh" ? "确认导入" : "Import")
              : t("smartImport.paste")}
          </Text>
        </Pressable>

        {/* 相机按钮（仅 native） */}
        {Platform.OS !== "web" ? (
          <Pressable
            onPress={() => runImage("camera")}
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
                opacity: busy && busyKind !== "camera" ? 0.4 : 1,
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            {busyKind === "camera" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <IconSymbol name="camera.fill" size={15} color={colors.primary} />
            )}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
              {t("smartImport.camera")}
            </Text>
          </Pressable>
        ) : null}

        {/* 相册按钮 */}
        <Pressable
          onPress={() => runImage("photo")}
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
              opacity: busy && busyKind !== "photo" ? 0.4 : 1,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          {busyKind === "photo" ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <IconSymbol name="photo.fill" size={15} color={colors.primary} />
          )}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
            {t("smartImport.photo")}
          </Text>
        </Pressable>
      </View>

      {/* 可展开粘贴文本框 */}
      {pasteExpanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingBottom: 10 }}>
          {/* 工具栏 */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, paddingBottom: 6 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, flex: 1 }}>
              {lang === "zh" ? "粘贴或输入文字，AI 自动识别" : "Paste or type — AI will extract"}
            </Text>
            {/* 一键读剪贴板 */}
            <Pressable
              onPress={async () => {
                try {
                  const text = (await Clipboard.getStringAsync())?.trim();
                  if (text) setPasteText(text);
                } catch {}
              }}
              style={({ pressed }) => [
                {
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                  backgroundColor: colors.primary + "14",
                },
                pressed && { opacity: 0.6 },
              ]}
            >
              <IconSymbol name="doc.on.clipboard" size={12} color={colors.primary} />
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>
                {lang === "zh" ? "读剪贴板" : "Paste"}
              </Text>
            </Pressable>
            {/* 关闭 */}
            <Pressable
              onPress={() => { setPasteExpanded(false); setPasteText(""); }}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <IconSymbol name="xmark" size={14} color={colors.muted} />
            </Pressable>
          </View>
          {/* 多行文本输入框 */}
          <TextInput
            ref={pasteInputRef}
            value={pasteText}
            onChangeText={setPasteText}
            multiline
            numberOfLines={5}
            placeholder={
              lang === "zh"
                ? "在此粘贴酒款名称、配方文字…"
                : "Paste bottle names, recipe text here…"
            }
            placeholderTextColor={colors.muted}
            style={{
              minHeight: 90,
              maxHeight: 180,
              backgroundColor: colors.background,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 13,
              color: colors.foreground,
              lineHeight: 20,
              textAlignVertical: "top",
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

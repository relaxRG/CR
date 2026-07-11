import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { SmartImportBar } from "@/components/smart-import-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import { BottleDraft, useBottleStore } from "@/lib/bottles/store";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { trpc } from "@/lib/trpc";
import type { EnrichedProduct } from "@/server/routers";
import * as ImagePicker from "expo-image-picker";

export default function BottleFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { id, category: categoryParam, prefillName, prefillNameAlt, prefillStyle } =
    useLocalSearchParams<{
      id?: string;
      category?: string;
      prefillName?: string;
      prefillNameAlt?: string;
      prefillStyle?: string;
    }>();
  const { getBottle, addBottle, updateBottle } = useBottleStore();
  const { categories: taxCategories, categoryLabel, stylesOf } = useBottleTaxonomy();
  const editing = getBottle(id);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const { isOnline } = useNetwork();

  const [nameZh, setNameZh] = useState(editing?.nameZh ?? prefillNameAlt ?? "");
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? prefillName ?? "");
  const [category, setCategory] = useState(
    editing?.category ??
      (categoryParam && taxCategories.some((c) => c.zh === categoryParam)
        ? categoryParam
        : taxCategories[0]?.zh ?? "金酒"),
  );
  const [style, setStyle] = useState(editing?.style ?? prefillStyle ?? "");
  const [brand, setBrand] = useState(editing?.brand ?? "");
  const [origin, setOrigin] = useState(editing?.origin ?? "");
  const [volume, setVolume] = useState(editing?.volume ?? "");
  const [abv, setAbv] = useState(editing ? String(editing.abv) : "");
  const [price, setPrice] = useState(
    editing && editing.priceCny > 0 ? String(editing.priceCny) : "",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [flavorTags, setFlavorTags] = useState<string[]>(editing?.flavorTags ?? []);
  const [story, setStory] = useState(editing?.story ?? "");
  const [styleDesc, setStyleDesc] = useState(editing?.styleDesc ?? "");

  const canSave = nameZh.trim().length > 0 || nameEn.trim().length > 0;

  // 联网识别 + AI 风味补全:两步串联,合并结果后统一预览
  const enrichMutation = trpc.lookup.enrich.useMutation();
  const enrichBottleMutation = trpc.lookup.enrichBottle.useMutation();
  const [lookupBusy, setLookupBusy] = useState<"text" | "photo" | null>(null);
  const [lookupStatus, setLookupStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null,
  );

  type CombinedResult = EnrichedProduct & {
    flavorTags: string[];
    story: string;
    styleDesc: string;
    flavorConfidence: "high" | "medium" | "low";
  };
  const [pendingResult, setPendingResult] = useState<CombinedResult | null>(null);

  /** 串联两步:先识别基本信息,再补全风味/故事 */
  const runCombinedLookup = async (
    enrichArgs: Parameters<typeof enrichMutation.mutateAsync>[0],
  ): Promise<void> => {
    const res = await enrichMutation.mutateAsync(enrichArgs);
    const item = res.items.find((i) => i.found);
    if (!item) {
      if (isMountedRef.current) setLookupStatus({ kind: "err", msg: t("lookup.notFound") });
      return;
    }
    // Use info from step-1 to inform step-2 (richer context = better flavor result)
    const resolvedCategory = item.category && taxCategories.some((c) => c.zh === item.category)
      ? item.category
      : category;
    const flavorRes = await enrichBottleMutation.mutateAsync({
      nameZh: item.nameZh || nameZh.trim() || undefined,
      nameEn: item.nameEn || nameEn.trim() || undefined,
      category: resolvedCategory || undefined,
      style: item.style || style.trim() || undefined,
      brand: item.brand || brand.trim() || undefined,
      origin: item.origin || origin.trim() || undefined,
    });
    if (isMountedRef.current) setPendingResult({
      ...item,
      flavorTags: flavorRes.flavorTags,
      story: flavorRes.story,
      styleDesc: flavorRes.styleDesc,
      flavorConfidence: flavorRes.confidence,
    });
  };

  const applyResult = (r: CombinedResult) => {
    if (!nameZh.trim() && r.nameZh) setNameZh(r.nameZh);
    if (!nameEn.trim() && r.nameEn) setNameEn(r.nameEn);
    if (r.category && taxCategories.some((c) => c.zh === r.category)) setCategory(r.category);
    if (!style.trim() && r.style) setStyle(r.style);
    if (!brand.trim() && r.brand) setBrand(r.brand);
    if (!origin.trim() && r.origin) setOrigin(r.origin);
    if (!volume.trim() && r.volume) setVolume(r.volume);
    if (!(parseFloat(abv) > 0) && r.abv > 0) setAbv(String(r.abv));
    if (!(parseFloat(price) > 0) && r.priceCny > 0) setPrice(String(r.priceCny));
    if (!notes.trim() && r.notes) setNotes(r.notes);
    if (flavorTags.length === 0 && r.flavorTags.length > 0) setFlavorTags(r.flavorTags);
    if (!story.trim() && r.story) setStory(r.story);
    if (!styleDesc.trim() && r.styleDesc) setStyleDesc(r.styleDesc);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPendingResult(null);
    setLookupStatus({ kind: "ok", msg: t("lookup.filled") });
  };

  const handleLookup = async () => {
    const query = [nameZh.trim(), nameEn.trim(), brand.trim()].filter(Boolean).join(" ");
    if (!query) {
      setLookupStatus({ kind: "err", msg: t("lookup.needName") });
      return;
    }
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    setLookupStatus(null);
    setPendingResult(null);
    setLookupBusy("text");
    try {
      await runCombinedLookup({ names: [query] });
    } catch {
      setLookupStatus({ kind: "err", msg: t("smartImport.fail.msg") });
    } finally {
      setLookupBusy(null);
    }
  };

  /** 拍/选一张酒瓶照片,联网识别产品并补全资料 */
  const handleLookupPhoto = async () => {
    setLookupStatus(null);
    setPendingResult(null);
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      });
      if (picked.canceled || !picked.assets?.[0]?.base64) return;
      setLookupBusy("photo");
      const asset = picked.assets[0];
      const query = [nameZh.trim(), nameEn.trim(), brand.trim()].filter(Boolean).join(" ");
      await runCombinedLookup({
        names: query ? [query] : [],
        imageBase64: asset.base64!,
        imageMime: asset.mimeType || "image/jpeg",
      });
    } catch {
      setLookupStatus({ kind: "err", msg: t("smartImport.fail.msg") });
    } finally {
      setLookupBusy(null);
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const draft: BottleDraft = {
      nameZh: nameZh.trim() || nameEn.trim(),
      nameEn: nameEn.trim(),
      category,
      style: style.trim(),
      brand: brand.trim(),
      origin: origin.trim(),
      volume: volume.trim(),
      abv: Math.max(0, Math.min(100, parseFloat(abv) || 0)),
      priceCny: Math.max(0, parseFloat(price) || 0),
      notes: notes.trim(),
      flavorTags,
      story: story.trim(),
      styleDesc: styleDesc.trim(),
    };
    if (editing) {
      updateBottle(editing.id, draft);
    } else {
      addBottle(draft);
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.back();
  };

  const field = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    placeholder: string,
    options?: { keyboardType?: "numeric" | "default"; multiline?: boolean },
  ) => (
    <View className="mb-4">
      <Text className="text-sm font-medium text-foreground mb-1.5">{label}</Text>
      <TextInput
        className="bg-surface border border-border rounded-xl px-3 text-base text-foreground"
        style={{
          height: options?.multiline ? 88 : 44,
          lineHeight: 20,
          paddingTop: options?.multiline ? 10 : 0,
          textAlignVertical: options?.multiline ? "top" : "center",
        }}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={options?.keyboardType ?? "default"}
        multiline={options?.multiline}
        returnKeyType={options?.multiline ? "default" : "done"}
      />
    </View>
  );

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View className="flex-row items-center px-4 pt-1 pb-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="xmark" size={22} color={colors.foreground} />
          </Pressable>
          <Text className="flex-1 text-center text-lg font-semibold text-foreground">
            {editing ? t("bform.title.edit") : t("bform.title.new")}
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {!editing && (
            <SmartImportBar
              targetType="bottle"
              onExtracted={(item) => {
                if (item.nameZh) setNameZh(item.nameZh);
                if (item.nameEn) setNameEn(item.nameEn);
                if (item.category) setCategory(item.category);
                if (item.style) setStyle(item.style);
                if (item.brand) setBrand(item.brand);
                if (item.origin) setOrigin(item.origin);
                if (item.volume) setVolume(item.volume);
                if (item.abv) setAbv(String(item.abv));
                if (item.priceCny) setPrice(String(item.priceCny));
                if (item.notes || item.source) {
                  setNotes([item.notes, item.source].filter(Boolean).join(" · "));
                }
              }}
            />
          )}
          {field(t("bform.nameZh"), nameZh, setNameZh, lang === "en" ? "e.g. 君度橙酒" : "例如:君度橙酒")}
          {field(t("bform.nameEn"), nameEn, setNameEn, "e.g. Cointreau")}

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <Pressable
              onPress={handleLookup}
              disabled={lookupBusy !== null}
              style={({ pressed }) => [
                styles.lookupBtn,
                { flex: 1, backgroundColor: colors.primary + "14" },
                (pressed || lookupBusy !== null) && { opacity: 0.6 },
              ]}
            >
              {lookupBusy === "text" ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconSymbol name="sparkles" size={15} color={colors.primary} />
              )}
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                {lookupBusy === "text"
                  ? (lang === "zh" ? "识别补全中…" : "Looking up…")
                  : (lang === "zh" ? "AI 识别补全" : "AI Lookup")}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleLookupPhoto}
              disabled={lookupBusy !== null}
              style={({ pressed }) => [
                styles.lookupBtn,
                { paddingHorizontal: 14, backgroundColor: colors.primary + "14" },
                (pressed || lookupBusy !== null) && { opacity: 0.6 },
              ]}
            >
              {lookupBusy === "photo" ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconSymbol name="photo.fill" size={15} color={colors.primary} />
              )}
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                {t("lookup.photo")}
              </Text>
            </Pressable>
          </View>
          {lookupStatus && (
            <Text
              className="text-xs mb-3"
              style={{ color: lookupStatus.kind === "ok" ? colors.primary : "#DC2626" }}
            >
              {lookupStatus.msg}
            </Text>
          )}
          {pendingResult && (
            <View
              className="rounded-xl border px-3 py-3 mb-3"
              style={{ borderColor: colors.primary + "44", backgroundColor: colors.primary + "0A", gap: 6 }}
            >
              {/* Header */}
              <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <IconSymbol name="sparkles" size={13} color={colors.primary} />
                  <Text className="text-xs font-medium" style={{ color: colors.primary }}>
                    {lang === "zh" ? "AI 识别结果" : "AI Result"}
                    {pendingResult.nameEn || pendingResult.nameZh
                      ? ` · ${pendingResult.nameEn || pendingResult.nameZh}`
                      : ""}
                  </Text>
                  <View
                    className="px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        pendingResult.confidence === "high"
                          ? colors.success + "22"
                          : pendingResult.confidence === "medium"
                            ? "#FF950022"
                            : colors.border,
                    }}
                  >
                    <Text
                      className="text-[10px] font-medium"
                      style={{
                        color:
                          pendingResult.confidence === "high"
                            ? colors.success
                            : pendingResult.confidence === "medium"
                              ? "#FF9500"
                              : colors.muted,
                      }}
                    >
                      {pendingResult.confidence === "high"
                        ? (lang === "zh" ? "高可信" : "High")
                        : pendingResult.confidence === "medium"
                          ? (lang === "zh" ? "中可信" : "Medium")
                          : (lang === "zh" ? "低可信" : "Low")}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setPendingResult(null)} hitSlop={8}>
                  <IconSymbol name="xmark" size={14} color={colors.muted} />
                </Pressable>
              </View>
              {/* Basic fields preview */}
              {[
                pendingResult.category && { label: lang === "zh" ? "分类" : "Category", val: pendingResult.category },
                pendingResult.style && { label: lang === "zh" ? "风格" : "Style", val: pendingResult.style },
                pendingResult.brand && { label: lang === "zh" ? "品牌" : "Brand", val: pendingResult.brand },
                pendingResult.origin && { label: lang === "zh" ? "产地" : "Origin", val: pendingResult.origin },
                pendingResult.volume && { label: lang === "zh" ? "规格" : "Volume", val: pendingResult.volume },
                pendingResult.abv > 0 && { label: "ABV", val: `${pendingResult.abv}%` },
                pendingResult.priceCny > 0 && { label: lang === "zh" ? "价格" : "Price", val: `¥${pendingResult.priceCny}` },
                pendingResult.notes && { label: lang === "zh" ? "备注" : "Notes", val: pendingResult.notes },
              ].filter(Boolean).map((row) => row && (
                <Text key={row.label} className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  <Text style={{ fontWeight: "500" }}>{row.label}: </Text>{row.val}
                </Text>
              ))}
              {/* Flavor preview */}
              {pendingResult.flavorTags.length > 0 && (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  <Text style={{ fontWeight: "500" }}>{lang === "zh" ? "风味: " : "Flavors: "}</Text>
                  {pendingResult.flavorTags.join(" · ")}
                </Text>
              )}
              {pendingResult.story ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  <Text style={{ fontWeight: "500" }}>{lang === "zh" ? "故事: " : "Story: "}</Text>
                  {pendingResult.story}
                </Text>
              ) : null}
              {pendingResult.styleDesc ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  <Text style={{ fontWeight: "500" }}>{lang === "zh" ? "风格描述: " : "Style desc: "}</Text>
                  {pendingResult.styleDesc}
                </Text>
              ) : null}
              {/* Apply button */}
              <View className="flex-row mt-2" style={{ gap: 8 }}>
                <Pressable
                  onPress={() => applyResult(pendingResult)}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 7,
                      borderRadius: 8,
                      alignItems: "center" as const,
                      backgroundColor: colors.primary,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <Text className="text-xs font-semibold" style={{ color: "#FFFFFF" }}>
                    {lang === "zh" ? "应用到空白字段" : "Apply to empty fields"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setPendingResult(null)}
                  style={({ pressed }) => [
                    {
                      paddingVertical: 7,
                      paddingHorizontal: 14,
                      borderRadius: 8,
                      alignItems: "center" as const,
                      borderWidth: 1,
                      borderColor: colors.border,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {lang === "zh" ? "忽略" : "Dismiss"}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text className="text-sm font-medium text-foreground mb-1.5">{t("bform.category")}</Text>
          <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
            {taxCategories.map((c) => c.zh).map((cat) => {
              const active = category === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? "#FFFFFF" : colors.foreground },
                    ]}
                  >
                    {categoryLabel(cat, lang)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {stylesOf(category).length > 0 && (
            <>
              <Text className="text-sm font-medium text-foreground mb-1.5">
                {t("bform.style")}
              </Text>
              <View className="flex-row flex-wrap mb-2" style={{ gap: 8 }}>
                {stylesOf(category).map((d) => {
                  const s = d.name;
                  const active = style === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setStyle(active ? "" : s)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: active ? "#FFFFFF" : colors.foreground },
                        ]}
                      >
                        {lang === "zh" && d.zh ? d.zh : s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {field("", style, setStyle, lang === "en" ? "Or type a custom style…" : "或自行填写风格…")}
            </>
          )}

          {field(t("bform.brand"), brand, setBrand, "e.g. Cointreau")}
          {field(t("bform.origin"), origin, setOrigin, lang === "en" ? "e.g. France" : "例如:法国")}
          {field(t("bform.volume"), volume, setVolume, lang === "en" ? "e.g. 700ml" : "例如:700ml")}
          {field(t("bform.abv"), abv, setAbv, lang === "en" ? "e.g. 40" : "例如:40", { keyboardType: "numeric" })}
          {field(t("bform.price"), price, setPrice, lang === "en" ? "e.g. 170" : "例如:170", { keyboardType: "numeric" })}
          {field(t("bform.notes"), notes, setNotes, lang === "en" ? "Taste, usage, where to buy…" : "口感、用途、购买渠道等", { multiline: true })}

          {/* Flavor & Story */}
          <Text className="text-sm font-medium text-foreground mb-1.5" style={{ marginTop: 4 }}>
            {lang === "zh" ? "风味 / 故事" : "Flavor / Story"}
          </Text>
          {/* Flavor tags chips */}
          {flavorTags.length > 0 && (
            <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
              {flavorTags.map((tag) => (
                <Pressable
                  key={tag}
                  onPress={() => setFlavorTags((prev) => prev.filter((t) => t !== tag))}
                  style={[
                    styles.chip,
                    { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" },
                  ]}
                >
                  <Text style={[styles.chipText, { color: colors.primary }]}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {field(
            lang === "zh" ? "故事/介绍" : "Story",
            story,
            setStory,
            lang === "en" ? "Brief product story or description…" : "产品故事或简介…",
            { multiline: true },
          )}
          {field(
            lang === "zh" ? "风格描述" : "Style Description",
            styleDesc,
            setStyleDesc,
            lang === "en" ? "Style characteristics…" : "风格特点描述…",
          )}
        </ScrollView>

        <View className="px-5 pb-2 pt-2">
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: canSave ? colors.primary : colors.border },
              pressed && canSave && { transform: [{ scale: 0.98 }], opacity: 0.9 },
            ]}
          >
            <Text style={styles.saveBtnText}>{editing ? t("form.save.edit") : t("bform.save")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  lookupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 10,
  },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  saveBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
});

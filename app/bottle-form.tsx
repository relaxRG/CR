import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { SmartImportBar } from "@/components/smart-import-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import { BottleDraft, useBottleStore } from "@/lib/bottles/store";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { trpc } from "@/lib/trpc";
import * as ImagePicker from "expo-image-picker";
import { BOTTLE_GROUPS } from "@/lib/bottles/types";

const FLAVOR_TAGS_ALL = ["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草","坚硬","辛辣"];

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
  const { categories: taxCategories, categoryLabel, stylesOf, categoriesOfGroup } = useBottleTaxonomy();
  const editing = getBottle(id);
  const isMountedRef = useRef(true);
  const autoEnrichDoneRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const { isOnline } = useNetwork();

  // ── State ──────────────────────────────────────────────────────────────────
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
  const [distilleryInfo, setDistilleryInfo] = useState(editing?.distilleryInfo ?? "");
  const [pairingNotes, setPairingNotes] = useState(editing?.pairingNotes ?? "");
  const [usageNotes, setUsageNotes] = useState(editing?.usageNotes ?? "");
  const [seasonality, setSeasonality] = useState(editing?.seasonality ?? "");

  const canSave = nameZh.trim().length > 0 || nameEn.trim().length > 0;

  // ── AI 补全 ────────────────────────────────────────────────────────────────
  const enrichBottleFullMutation = trpc.lookup.enrichBottleFull.useMutation();
  const [lookupBusy, setLookupBusy] = useState<"auto" | "manual" | "photo" | null>(null);
  const [lookupStatus, setLookupStatus] = useState<{ kind: "ok" | "err" | "warn"; msg: string } | null>(null);

  type FullResult = Awaited<ReturnType<typeof enrichBottleFullMutation.mutateAsync>>;

  /** 将 AI 结果写入空字段（不覆盖用户已填内容） */
  const applyResult = useCallback((r: FullResult, overwrite = false) => {
    if (!nameZh.trim() && r.nameZh) setNameZh(r.nameZh);
    if (!nameEn.trim() && r.nameEn) setNameEn(r.nameEn);
    if (r.category && taxCategories.some((c) => c.zh === r.category)) setCategory(r.category);
    if ((overwrite || !style.trim()) && r.style) setStyle(r.style);
    if ((overwrite || !brand.trim()) && r.brand) setBrand(r.brand);
    if ((overwrite || !origin.trim()) && r.origin) setOrigin(r.origin);
    if ((overwrite || !volume.trim()) && r.volume) setVolume(r.volume);
    if ((overwrite || !(parseFloat(abv) > 0)) && r.abv > 0) setAbv(String(r.abv));
    if ((overwrite || !(parseFloat(price) > 0)) && r.priceCny > 0) setPrice(String(r.priceCny));
    if ((overwrite || !notes.trim()) && r.notes) setNotes(r.notes);
    if ((overwrite || flavorTags.length === 0) && r.flavorTags.length > 0) setFlavorTags(r.flavorTags);
    if (r.confidence !== "low") {
      if ((overwrite || !story.trim()) && r.story) setStory(r.story);
      if ((overwrite || !styleDesc.trim()) && r.styleDesc) setStyleDesc(r.styleDesc);
      if ((overwrite || !distilleryInfo.trim()) && r.distilleryInfo) setDistilleryInfo(r.distilleryInfo);
      if ((overwrite || !pairingNotes.trim()) && r.pairingNotes) setPairingNotes(r.pairingNotes);
      if ((overwrite || !usageNotes.trim()) && r.usageNotes) setUsageNotes(r.usageNotes);
      if ((overwrite || !seasonality.trim()) && r.seasonality) setSeasonality(r.seasonality);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [nameZh, nameEn, style, brand, origin, volume, abv, price, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality, taxCategories]);

  /** 核心补全函数（供自动触发和手动按钮共用） */
  const runEnrich = useCallback(async (opts: {
    mode: "auto" | "manual" | "photo";
    imageBase64?: string;
    imageMime?: string;
    overwrite?: boolean;
  }) => {
    const query = [nameZh.trim(), nameEn.trim(), brand.trim()].filter(Boolean).join(" ");
    if (!query && !opts.imageBase64) return;
    if (!isOnline) {
      if (opts.mode !== "auto") Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    setLookupStatus(null);
    setLookupBusy(opts.mode);
    try {
      const res = await enrichBottleFullMutation.mutateAsync({
        nameZh: nameZh.trim() || undefined,
        nameEn: nameEn.trim() || undefined,
        category: category || undefined,
        style: style.trim() || undefined,
        brand: brand.trim() || undefined,
        origin: origin.trim() || undefined,
        imageBase64: opts.imageBase64,
        imageMime: opts.imageMime,
      });
      if (!isMountedRef.current) return;
      if (!res.found) {
        setLookupStatus({ kind: "warn", msg: lang === "zh" ? "未找到该产品资料，已补全通用品类信息" : "Product not found, filled generic info" });
        applyResult(res, opts.overwrite);
        return;
      }
      applyResult(res, opts.overwrite);
      const confLabel = res.confidence === "high"
        ? (lang === "zh" ? "高可信度" : "High confidence")
        : res.confidence === "medium"
          ? (lang === "zh" ? "中可信度" : "Medium confidence")
          : (lang === "zh" ? "低可信度，请核实" : "Low confidence, please verify");
      setLookupStatus({ kind: res.confidence === "low" ? "warn" : "ok", msg: `✓ ${confLabel}` });
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("超时"));
      const isNotFound = err instanceof Error && err.message.includes("未找到");
      const msg = isTimeout
        ? (lang === "zh" ? "AI 响应较慢，请稍后重试" : "AI timeout, please retry")
        : isNotFound
          ? (lang === "zh" ? "未找到该产品" : "Product not found")
          : (lang === "zh" ? "AI 补全失败，请重试" : "AI lookup failed, please retry");
      setLookupStatus({ kind: "err", msg });
    } finally {
      if (isMountedRef.current) setLookupBusy(null);
    }
  }, [nameZh, nameEn, brand, category, style, origin, isOnline, lang, t, enrichBottleFullMutation, applyResult]);

  /** 打开表单时自动触发一次 AI 补全（仅当有名称且在线） */
  useEffect(() => {
    if (autoEnrichDoneRef.current) return;
    const query = [nameZh.trim(), nameEn.trim()].filter(Boolean).join(" ");
    if (!query) return;
    if (!isOnline) return;
    autoEnrichDoneRef.current = true;
    runEnrich({ mode: "auto" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 手动 AI 补全（覆盖模式，重新分析） */
  const handleLookup = () => {
    const query = [nameZh.trim(), nameEn.trim(), brand.trim()].filter(Boolean).join(" ");
    if (!query) {
      setLookupStatus({ kind: "err", msg: t("lookup.needName") });
      return;
    }
    runEnrich({ mode: "manual", overwrite: false });
  };

  /** 拍/选一张酒瓶照片，联网识别产品并补全资料 */
  const handleLookupPhoto = async () => {
    setLookupStatus(null);
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
      const asset = picked.assets[0];
      await runEnrich({
        mode: "photo",
        imageBase64: asset.base64 ?? undefined,
        imageMime: asset.mimeType || "image/jpeg",
      });
    } catch {
      setLookupStatus({ kind: "err", msg: t("smartImport.fail.msg") });
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────
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
      distilleryInfo: distilleryInfo.trim(),
      pairingNotes: pairingNotes.trim(),
      usageNotes: usageNotes.trim(),
      seasonality: seasonality.trim(),
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  const isAiBusy = lookupBusy !== null;

  const field = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    placeholder: string,
    options?: { keyboardType?: "numeric" | "default"; multiline?: boolean },
  ) => (
    <View style={styles.fieldWrap}>
      {label ? <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text> : null}
      <TextInput
        style={[
          styles.fieldInput,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            color: colors.foreground,
            height: options?.multiline ? 88 : 44,
            paddingTop: options?.multiline ? 10 : 0,
            textAlignVertical: options?.multiline ? "top" : "center",
          },
        ]}
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

  const sectionTitle = (title: string) => (
    <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="xmark" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {editing ? t("bform.title.edit") : t("bform.title.new")}
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Smart Import（新增时显示） */}
          {!editing && (
            <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
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
            </View>
          )}

          {/* ── 分区一：基本信息 ── */}
          {sectionTitle(lang === "zh" ? "基本信息" : "Basic Info")}
          <View style={{ paddingHorizontal: 20 }}>
            {field(t("bform.nameZh"), nameZh, setNameZh, lang === "en" ? "e.g. 君度橙酒" : "例如：君度橙酒")}
            {field(t("bform.nameEn"), nameEn, setNameEn, "e.g. Cointreau")}

            {/* AI 补全按钮行 */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
              <Pressable
                onPress={handleLookup}
                disabled={isAiBusy}
                style={({ pressed }) => [
                  styles.lookupBtn,
                  { flex: 1, backgroundColor: colors.primary + "14" },
                  (pressed || isAiBusy) && { opacity: 0.6 },
                ]}
              >
                {(lookupBusy === "manual" || lookupBusy === "auto") ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <IconSymbol name="sparkles" size={15} color={colors.primary} />
                )}
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                  {(lookupBusy === "manual" || lookupBusy === "auto")
                    ? (lang === "zh" ? "AI 补全中…" : "Analyzing…")
                    : (lang === "zh" ? "AI 识别补全" : "AI Lookup")}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLookupPhoto}
                disabled={isAiBusy}
                style={({ pressed }) => [
                  styles.lookupBtn,
                  { paddingHorizontal: 14, backgroundColor: colors.primary + "14" },
                  (pressed || isAiBusy) && { opacity: 0.6 },
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

            {/* AI 状态提示 */}
            {lookupStatus && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
                {lookupStatus.kind === "ok" && (
                  <IconSymbol name="checkmark.circle.fill" size={13} color={colors.success} />
                )}
                {lookupStatus.kind === "warn" && (
                  <IconSymbol name="exclamationmark.circle.fill" size={13} color="#FF9500" />
                )}
                {lookupStatus.kind === "err" && (
                  <IconSymbol name="xmark.circle.fill" size={13} color={colors.error} />
                )}
                <Text
                  style={{
                    fontSize: 12,
                    color: lookupStatus.kind === "ok"
                      ? colors.success
                      : lookupStatus.kind === "warn"
                        ? "#FF9500"
                        : colors.error,
                  }}
                >
                  {lookupStatus.msg}
                </Text>
                {lookupStatus.kind === "err" && (
                  <Pressable
                    onPress={handleLookup}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>
                      {lang === "zh" ? " 重试" : " Retry"}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* ── 分区二：分类与风格 ── */}
          {sectionTitle(lang === "zh" ? "分类与风格" : "Category & Style")}
          <View style={{ paddingHorizontal: 20 }}>
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
              {t("bform.category")}
            </Text>
            {BOTTLE_GROUPS.map((grp) => {
              const groupCats = categoriesOfGroup(grp.key);
              if (groupCats.length === 0) return null;
              return (
                <View key={grp.key} style={{ marginBottom: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor:
                          grp.key === "spirits"
                            ? colors.warning
                            : grp.key === "bottles"
                              ? colors.primary
                              : colors.success,
                      }}
                    />
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, lineHeight: 18 }}>
                      {lang === "en" ? grp.en : grp.zh}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {groupCats.map((cat) => {
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
                          <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                            {categoryLabel(cat, lang)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            {stylesOf(category).length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 4, marginBottom: 8 }]}>
                  {t("bform.style")}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
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
                        <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                          {lang === "zh" && d.zh ? d.zh : s}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {field("", style, setStyle, lang === "en" ? "Or type a custom style…" : "或自行填写风格…")}
              </>
            )}
          </View>

          {/* ── 分区三：规格与价格 ── */}
          {sectionTitle(lang === "zh" ? "规格与价格" : "Specs & Price")}
          <View style={{ paddingHorizontal: 20 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                {field(t("bform.brand"), brand, setBrand, "e.g. Cointreau")}
              </View>
              <View style={{ flex: 1 }}>
                {field(t("bform.origin"), origin, setOrigin, lang === "en" ? "e.g. France" : "例如：法国")}
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                {field(t("bform.volume"), volume, setVolume, lang === "en" ? "e.g. 700ml" : "例如：700ml")}
              </View>
              <View style={{ flex: 1 }}>
                {field(t("bform.abv"), abv, setAbv, lang === "en" ? "e.g. 40" : "例如：40", { keyboardType: "numeric" })}
              </View>
            </View>
            {field(t("bform.price"), price, setPrice, lang === "en" ? "e.g. 170 (CNY)" : "例如：170（人民币）", { keyboardType: "numeric" })}
            {field(t("bform.notes"), notes, setNotes, lang === "en" ? "Taste, usage, where to buy…" : "口感、用途、购买渠道等", { multiline: true })}
          </View>

          {/* ── 分区四：风味与描述 ── */}
          {sectionTitle(lang === "zh" ? "风味与描述" : "Flavor & Description")}
          <View style={{ paddingHorizontal: 20 }}>
            {/* 风味标签 */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
              {lang === "zh" ? "风味标签" : "Flavor Tags"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {FLAVOR_TAGS_ALL.map((tag) => {
                const active = flavorTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    onPress={() =>
                      setFlavorTags((prev) =>
                        active ? prev.filter((t) => t !== tag) : [...prev, tag],
                      )
                    }
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary + "18" : colors.surface,
                        borderColor: active ? colors.primary + "66" : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.primary : colors.foreground }]}>
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {field(lang === "zh" ? "故事 / 介绍" : "Story", story, setStory,
              lang === "en" ? "Brief product story or description…" : "产品故事或简介…",
              { multiline: true })}
            {field(lang === "zh" ? "风格描述" : "Style Description", styleDesc, setStyleDesc,
              lang === "en" ? "Style characteristics…" : "风格特点描述…")}
          </View>

          {/* ── 分区五：深度资料（按库类型条件显示） ── */}
          {(() => {
            const BASE_SPIRITS = ["金酒","朗姆","伏特加","威士忌","龙舌兰","白兰地","清酒烧酒","中式白酒"];
            const WINE_SPIRITS = ["利口酒","苦精","味美思","开胃酒","起泡酒","葡萄酒","糖浆","软饮"];
            const RAW_MATERIALS = ["糖与甜味剂","果蔬","香料与草本","花卉","茶咖与可可","坚果与谷物","乳蛋","酸类与添加剂"];
            const isBase = BASE_SPIRITS.includes(category);
            const isWine = WINE_SPIRITS.includes(category);
            const isMaterial = RAW_MATERIALS.includes(category);
            if (!isBase && !isWine && !isMaterial) return null;
            const deepSectionTitle = lang === "zh"
              ? isBase ? "蒸馏厂资料" : isWine ? "搭配建议" : "调酒用途"
              : isBase ? "Distillery Info" : isWine ? "Pairing Notes" : "Usage Notes";
            return (
              <>
                {sectionTitle(deepSectionTitle)}
                <View style={{ paddingHorizontal: 20 }}>
                  {isBase && field(
                    lang === "zh" ? "蒸馏厂 / 酒厂简介" : "Distillery Info",
                    distilleryInfo, setDistilleryInfo,
                    lang === "en" ? "e.g. Copper pot still, Highland Scotland…" : "例如：铜壶蒸馏，苏格兰高地产区…",
                    { multiline: true }
                  )}
                  {isWine && field(
                    lang === "zh" ? "搭配建议" : "Pairing Notes",
                    pairingNotes, setPairingNotes,
                    lang === "en" ? "e.g. Great in Negroni, Aperol Spritz…" : "例如：适合 Negroni、Aperol Spritz…",
                    { multiline: true }
                  )}
                  {isMaterial && (
                    <>
                      {field(
                        lang === "zh" ? "调酒用途" : "Usage Notes",
                        usageNotes, setUsageNotes,
                        lang === "en" ? "e.g. Citrus peel for Martini garnish…" : "例如：皮油常用于 Martini 装饰…",
                        { multiline: true }
                      )}
                      {field(
                        lang === "zh" ? "季节性" : "Seasonality",
                        seasonality, setSeasonality,
                        lang === "en" ? "e.g. Best in spring…" : "例如：春季最佳"
                      )}
                    </>
                  )}
                </View>
              </>
            );
          })()}
        </ScrollView>

        {/* Save Button */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, paddingTop: 8 }}>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  fieldWrap: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
    lineHeight: 18,
  },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 15,
    lineHeight: 20,
  },
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
    height: 36,
    borderRadius: 18,
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
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
});

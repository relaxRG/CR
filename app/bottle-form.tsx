import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { lookupInOfflineKb, extractBookSnippets, offlineEntryToEnrichResult } from "@/lib/bottles/offline-lookup";
import { useBookStore } from "@/lib/books/store";
import * as ImagePicker from "expo-image-picker";
import { BOTTLE_GROUPS } from "@/lib/bottles/types";

const FLAVOR_TAGS_ALL = ["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草","坚硬","辛辣"];

type AiField = {
  key: string;
  labelZh: string;
  labelEn: string;
  aiValue: string;
  currentValue: string;
  conflict: "new" | "override" | "confirm" | "low";
};

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
  const { books } = useBookStore();

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

  // ── AI 建议面板 state ──────────────────────────────────────────────────────
  const [aiResult, setAiResult] = useState<FullResult | null>(null);
  const [aiToggles, setAiToggles] = useState<Record<string, boolean>>({});
  const [undoSnapshot, setUndoSnapshot] = useState<null | {
    nameZh: string; nameEn: string; category: string; style: string;
    brand: string; origin: string; volume: string; abv: string; price: string;
    notes: string; flavorTags: string[]; story: string; styleDesc: string;
    distilleryInfo: string; pairingNotes: string; usageNotes: string; seasonality: string;
  }>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 构建 AI 字段对比列表 */
  const buildAiFields = useCallback((): AiField[] => {
    if (!aiResult) return [];
    const conf = (cur: string, ai: string, c: "high" | "medium" | "low"): AiField["conflict"] => {
      if (!cur.trim()) return "new";
      if (cur.trim().toLowerCase() === ai.trim().toLowerCase()) return "confirm";
      if (c === "low") return "low";
      return "override";
    };
    const fields: AiField[] = [];
    if (aiResult.nameZh) fields.push({ key: "nameZh", labelZh: "中文名", labelEn: "Chinese Name", aiValue: aiResult.nameZh, currentValue: nameZh, conflict: conf(nameZh, aiResult.nameZh, aiResult.confidence) });
    if (aiResult.nameEn) fields.push({ key: "nameEn", labelZh: "英文名", labelEn: "English Name", aiValue: aiResult.nameEn, currentValue: nameEn, conflict: conf(nameEn, aiResult.nameEn, aiResult.confidence) });
    if (aiResult.category && taxCategories.some((c) => c.zh === aiResult.category)) {
      fields.push({ key: "category", labelZh: "分类", labelEn: "Category", aiValue: aiResult.category, currentValue: category, conflict: conf(category, aiResult.category, aiResult.confidence) });
    }
    if (aiResult.style) fields.push({ key: "style", labelZh: "风格", labelEn: "Style", aiValue: aiResult.style, currentValue: style, conflict: conf(style, aiResult.style, aiResult.confidence) });
    if (aiResult.brand) fields.push({ key: "brand", labelZh: "品牌", labelEn: "Brand", aiValue: aiResult.brand, currentValue: brand, conflict: conf(brand, aiResult.brand, aiResult.confidence) });
    if (aiResult.origin) fields.push({ key: "origin", labelZh: "产地", labelEn: "Origin", aiValue: aiResult.origin, currentValue: origin, conflict: conf(origin, aiResult.origin, aiResult.confidence) });
    if (aiResult.volume) fields.push({ key: "volume", labelZh: "容量", labelEn: "Volume", aiValue: aiResult.volume, currentValue: volume, conflict: conf(volume, aiResult.volume, aiResult.confidence) });
    if (aiResult.abv > 0) fields.push({ key: "abv", labelZh: "酒精度", labelEn: "ABV", aiValue: `${aiResult.abv}%`, currentValue: abv ? `${abv}%` : "", conflict: conf(abv, String(aiResult.abv), aiResult.confidence) });
    if (aiResult.priceCny > 0) fields.push({ key: "price", labelZh: "参考价", labelEn: "Price", aiValue: `¥${aiResult.priceCny}`, currentValue: price ? `¥${price}` : "", conflict: conf(price, String(aiResult.priceCny), aiResult.confidence) });
    if (aiResult.notes) fields.push({ key: "notes", labelZh: "备注", labelEn: "Notes", aiValue: aiResult.notes.slice(0, 50) + (aiResult.notes.length > 50 ? "…" : ""), currentValue: notes ? notes.slice(0, 30) + (notes.length > 30 ? "…" : "") : "", conflict: conf(notes, aiResult.notes, aiResult.confidence) });
    if (aiResult.flavorTags.length > 0) {
      const curStr = flavorTags.length > 0 ? flavorTags.slice(0, 3).join(" · ") + (flavorTags.length > 3 ? "…" : "") : "";
      const aiStr = aiResult.flavorTags.slice(0, 4).join(" · ") + (aiResult.flavorTags.length > 4 ? ` +${aiResult.flavorTags.length - 4}` : "");
      fields.push({ key: "flavorTags", labelZh: "风味标签", labelEn: "Flavor Tags", aiValue: aiStr, currentValue: curStr, conflict: conf(curStr, aiStr, aiResult.confidence) });
    }
    if (aiResult.story) fields.push({ key: "story", labelZh: "故事/介绍", labelEn: "Story", aiValue: aiResult.story.slice(0, 50) + (aiResult.story.length > 50 ? "…" : ""), currentValue: story ? story.slice(0, 30) + (story.length > 30 ? "…" : "") : "", conflict: conf(story, aiResult.story, aiResult.confidence) });
    if (aiResult.styleDesc) fields.push({ key: "styleDesc", labelZh: "风格描述", labelEn: "Style Desc", aiValue: aiResult.styleDesc.slice(0, 50) + (aiResult.styleDesc.length > 50 ? "…" : ""), currentValue: styleDesc ? styleDesc.slice(0, 30) + (styleDesc.length > 30 ? "…" : "") : "", conflict: conf(styleDesc, aiResult.styleDesc, aiResult.confidence) });
    if (aiResult.distilleryInfo) fields.push({ key: "distilleryInfo", labelZh: "蒸馏厂", labelEn: "Distillery", aiValue: aiResult.distilleryInfo.slice(0, 50) + (aiResult.distilleryInfo.length > 50 ? "…" : ""), currentValue: distilleryInfo ? distilleryInfo.slice(0, 30) + "…" : "", conflict: conf(distilleryInfo, aiResult.distilleryInfo, aiResult.confidence) });
    if (aiResult.pairingNotes) fields.push({ key: "pairingNotes", labelZh: "搭配建议", labelEn: "Pairing", aiValue: aiResult.pairingNotes.slice(0, 50) + (aiResult.pairingNotes.length > 50 ? "…" : ""), currentValue: pairingNotes ? pairingNotes.slice(0, 30) + "…" : "", conflict: conf(pairingNotes, aiResult.pairingNotes, aiResult.confidence) });
    if (aiResult.usageNotes) fields.push({ key: "usageNotes", labelZh: "调酒用途", labelEn: "Usage", aiValue: aiResult.usageNotes.slice(0, 50) + (aiResult.usageNotes.length > 50 ? "…" : ""), currentValue: usageNotes ? usageNotes.slice(0, 30) + "…" : "", conflict: conf(usageNotes, aiResult.usageNotes, aiResult.confidence) });
    if (aiResult.seasonality) fields.push({ key: "seasonality", labelZh: "季节性", labelEn: "Seasonality", aiValue: aiResult.seasonality, currentValue: seasonality, conflict: conf(seasonality, aiResult.seasonality, aiResult.confidence) });
    return fields;
  }, [aiResult, nameZh, nameEn, category, style, brand, origin, volume, abv, price, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality, taxCategories]);

  /** 初始化 toggles：新增/确认字段默认 on，覆盖/低可信默认 off */
  useEffect(() => {
    if (!aiResult) { setAiToggles({}); return; }
    const fields = buildAiFields();
    const defaults: Record<string, boolean> = {};
    for (const f of fields) {
      defaults[f.key] = f.conflict === "new" || f.conflict === "confirm";
    }
    setAiToggles(defaults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult]);

  /** 将单个字段写入 state */
  const applyField = useCallback((key: string) => {
    if (!aiResult) return;
    if (key === "nameZh" && aiResult.nameZh) setNameZh(aiResult.nameZh);
    else if (key === "nameEn" && aiResult.nameEn) setNameEn(aiResult.nameEn);
    else if (key === "category" && aiResult.category) setCategory(aiResult.category);
    else if (key === "style" && aiResult.style) setStyle(aiResult.style);
    else if (key === "brand" && aiResult.brand) setBrand(aiResult.brand);
    else if (key === "origin" && aiResult.origin) setOrigin(aiResult.origin);
    else if (key === "volume" && aiResult.volume) setVolume(aiResult.volume);
    else if (key === "abv" && aiResult.abv > 0) setAbv(String(aiResult.abv));
    else if (key === "price" && aiResult.priceCny > 0) setPrice(String(aiResult.priceCny));
    else if (key === "notes" && aiResult.notes) setNotes(aiResult.notes);
    else if (key === "flavorTags" && aiResult.flavorTags.length > 0) setFlavorTags(aiResult.flavorTags);
    else if (key === "story" && aiResult.story) setStory(aiResult.story);
    else if (key === "styleDesc" && aiResult.styleDesc) setStyleDesc(aiResult.styleDesc);
    else if (key === "distilleryInfo" && aiResult.distilleryInfo) setDistilleryInfo(aiResult.distilleryInfo);
    else if (key === "pairingNotes" && aiResult.pairingNotes) setPairingNotes(aiResult.pairingNotes);
    else if (key === "usageNotes" && aiResult.usageNotes) setUsageNotes(aiResult.usageNotes);
    else if (key === "seasonality" && aiResult.seasonality) setSeasonality(aiResult.seasonality);
  }, [aiResult]);

  /** 应用所有 toggle=true 的字段，保存 undo 快照 */
  const applyAiResult = useCallback(() => {
    if (!aiResult) return;
    const fields = buildAiFields();
    setUndoSnapshot({ nameZh, nameEn, category, style, brand, origin, volume, abv, price, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality });
    for (const f of fields) {
      if (aiToggles[f.key] !== false) applyField(f.key);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAiResult(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 6000);
  }, [aiResult, aiToggles, buildAiFields, applyField, nameZh, nameEn, category, style, brand, origin, volume, abv, price, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality]);

  /** 撤销 AI 应用 */
  const undoAiApply = useCallback(() => {
    if (!undoSnapshot) return;
    setNameZh(undoSnapshot.nameZh); setNameEn(undoSnapshot.nameEn);
    setCategory(undoSnapshot.category); setStyle(undoSnapshot.style);
    setBrand(undoSnapshot.brand); setOrigin(undoSnapshot.origin);
    setVolume(undoSnapshot.volume); setAbv(undoSnapshot.abv); setPrice(undoSnapshot.price);
    setNotes(undoSnapshot.notes); setFlavorTags(undoSnapshot.flavorTags);
    setStory(undoSnapshot.story); setStyleDesc(undoSnapshot.styleDesc);
    setDistilleryInfo(undoSnapshot.distilleryInfo); setPairingNotes(undoSnapshot.pairingNotes);
    setUsageNotes(undoSnapshot.usageNotes); setSeasonality(undoSnapshot.seasonality);
    setUndoSnapshot(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoSnapshot]);

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
      // 离线时：尝试从本地知识库 + 书库文本补全
      if (opts.imageBase64) {
        // 照片识别需要联网，离线无法处理
        if (opts.mode !== "auto") Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
        return;
      }
      setLookupStatus(null);
      setLookupBusy(opts.mode);
      try {
        // 1. 先查内置离线知识库
        const kbResult = lookupInOfflineKb({
          nameZh: nameZh.trim() || undefined,
          nameEn: nameEn.trim() || undefined,
          brand: brand.trim() || undefined,
          category: category || undefined,
        });

        // 2. 从书库中提取相关段落
        const allSections = books.flatMap((b) => b.sections ?? []);
        const bookSnippets = extractBookSnippets({
          nameZh: nameZh.trim() || undefined,
          nameEn: nameEn.trim() || undefined,
          brand: brand.trim() || undefined,
          bookSections: allSections,
        });

        if (kbResult.found && kbResult.entry) {
          const result = offlineEntryToEnrichResult(kbResult.entry, bookSnippets);
          if (!isMountedRef.current) return;
          setAiResult(result);
          const snippetInfo = bookSnippets.length > 0 ? `，并在书库中找到 ${bookSnippets.length} 处相关段落` : "";
          setLookupStatus({ kind: "warn", msg: lang === "zh" ? `离线模式：已从本地知识库补全${snippetInfo}` : `Offline: filled from local knowledge base${snippetInfo}` });
        } else if (bookSnippets.length > 0) {
          // 知识库没找到，但书库有相关内容，给出提示
          if (!isMountedRef.current) return;
          setLookupStatus({ kind: "warn", msg: lang === "zh" ? `离线模式：未在知识库中找到，但书库中有 ${bookSnippets.length} 处相关段落，联网后可获得完整补全` : `Offline: not in local KB, but found ${bookSnippets.length} book snippets. Connect for full AI lookup.` });
        } else {
          if (!isMountedRef.current) return;
          if (opts.mode !== "auto") {
            setLookupStatus({ kind: "err", msg: lang === "zh" ? "离线模式：未在本地知识库中找到该酒款，请联网后重试" : "Offline: not found in local KB, please connect to internet" });
          }
        }
      } finally {
        if (isMountedRef.current) setLookupBusy(null);
      }
      return;
    }
    setLookupStatus(null);
    setLookupBusy(opts.mode);
    try {
      // 提取书库片段，传给服务器作为上下文（AI 补全时参考用户书库内容）
      const allSectionsOnline = books.flatMap((b) => b.sections ?? []);
      const onlineBookSnippets = extractBookSnippets({
        nameZh: nameZh.trim() || undefined,
        nameEn: nameEn.trim() || undefined,
        brand: brand.trim() || undefined,
        bookSections: allSectionsOnline,
      });
      const enrichInput = {
        nameZh: nameZh.trim() || undefined,
        nameEn: nameEn.trim() || undefined,
        category: category || undefined,
        style: style.trim() || undefined,
        brand: brand.trim() || undefined,
        origin: origin.trim() || undefined,
        imageBase64: opts.imageBase64,
        imageMime: opts.imageMime,
        bookSnippets: onlineBookSnippets.length > 0 ? onlineBookSnippets : undefined,
      };
      const res = await enrichBottleFullMutation.mutateAsync(enrichInput);
      if (!isMountedRef.current) return;
      if (!res.found) {
        setLookupStatus({ kind: "warn", msg: lang === "zh" ? "未找到该产品资料，已补全通用品类信息" : "Product not found, filled generic info" });
        setAiResult(res);
        return;
      }
      setAiResult(res);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      // 联网失败时降级到离线知识库
      const kbResult = lookupInOfflineKb({
        nameZh: nameZh.trim() || undefined,
        nameEn: nameEn.trim() || undefined,
        brand: brand.trim() || undefined,
        category: category || undefined,
      });
      const allSections = books.flatMap((b) => b.sections ?? []);
      const bookSnippets = extractBookSnippets({
        nameZh: nameZh.trim() || undefined,
        nameEn: nameEn.trim() || undefined,
        brand: brand.trim() || undefined,
        bookSections: allSections,
      });
      if (kbResult.found && kbResult.entry) {
        const result = offlineEntryToEnrichResult(kbResult.entry, bookSnippets);
        setAiResult(result);
        const snippetInfo = bookSnippets.length > 0 ? `，书库补充 ${bookSnippets.length} 处` : "";
        setLookupStatus({ kind: "warn", msg: lang === "zh" ? `AI 服务暂时不可用，已从本地知识库补全${snippetInfo}` : `AI unavailable, filled from local KB${snippetInfo}` });
        return;
      }
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
  }, [nameZh, nameEn, brand, category, style, origin, isOnline, lang, t, enrichBottleFullMutation, books]);

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

            {/* AI 错误/加载状态提示（仅在无建议面板时显示） */}
            {lookupStatus && !aiResult && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
                {lookupStatus.kind === "ok" && <IconSymbol name="checkmark.circle.fill" size={13} color={colors.success} />}
                {lookupStatus.kind === "warn" && <IconSymbol name="exclamationmark.circle.fill" size={13} color="#FF9500" />}
                {lookupStatus.kind === "err" && <IconSymbol name="xmark.circle.fill" size={13} color={colors.error} />}
                <Text style={{ fontSize: 12, color: lookupStatus.kind === "ok" ? colors.success : lookupStatus.kind === "warn" ? "#FF9500" : colors.error }}>
                  {lookupStatus.msg}
                </Text>
                {lookupStatus.kind === "err" && (
                  <Pressable onPress={handleLookup} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{lang === "zh" ? " 重试" : " Retry"}</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* ── AI 建议面板 ── */}
            {aiResult && (() => {
              const aiFields = buildAiFields();
              const conflictColor = (c: AiField["conflict"]) =>
                c === "new" ? colors.primary : c === "override" ? "#FF9500" : c === "confirm" ? colors.success : colors.muted;
              const conflictLabel = (c: AiField["conflict"]) =>
                lang === "zh"
                  ? c === "new" ? "新增" : c === "override" ? "覆盖" : c === "confirm" ? "确认" : "低可信"
                  : c === "new" ? "New" : c === "override" ? "Override" : c === "confirm" ? "Match" : "Low";
              const toggledCount = aiFields.filter((f) => aiToggles[f.key] !== false).length;
              return (
                <View style={{ borderRadius: 14, borderWidth: 1, marginTop: 8, marginBottom: 8, borderColor: colors.primary + "44", backgroundColor: colors.primary + "0A" }}>
                  {/* Header */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <IconSymbol name="sparkles" size={13} color={colors.primary} />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                        {lang === "zh" ? "AI 建议" : "AI Suggestion"}
                      </Text>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20, backgroundColor: aiResult.confidence === "high" ? colors.success + "22" : aiResult.confidence === "medium" ? "#FF950022" : colors.border }}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: aiResult.confidence === "high" ? colors.success : aiResult.confidence === "medium" ? "#FF9500" : colors.muted }}>
                          {aiResult.confidence === "high" ? (lang === "zh" ? "高可信" : "High") : aiResult.confidence === "medium" ? (lang === "zh" ? "中可信" : "Medium") : (lang === "zh" ? "低可信" : "Low")}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, color: colors.muted }}>{lang === "zh" ? `${aiFields.length} 个字段` : `${aiFields.length} fields`}</Text>
                    </View>
                    <Pressable onPress={() => setAiResult(null)} hitSlop={8}>
                      <IconSymbol name="xmark" size={14} color={colors.muted} />
                    </Pressable>
                  </View>
                  {/* Quick actions */}
                  <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingBottom: 8, gap: 6 }}>
                    {[
                      { label: lang === "zh" ? "全选" : "Select All", action: () => { const all: Record<string, boolean> = {}; for (const f of aiFields) all[f.key] = true; setAiToggles(all); }, color: colors.foreground },
                      { label: lang === "zh" ? "只填空白" : "Blanks Only", action: () => { const blanks: Record<string, boolean> = {}; for (const f of aiFields) blanks[f.key] = f.conflict === "new"; setAiToggles(blanks); }, color: colors.primary },
                      { label: lang === "zh" ? "全不选" : "Deselect", action: () => { const none: Record<string, boolean> = {}; for (const f of aiFields) none[f.key] = false; setAiToggles(none); }, color: colors.muted },
                    ].map((btn) => (
                      <Pressable key={btn.label} onPress={btn.action} style={({ pressed }) => ({ flex: 1, paddingVertical: 5, borderRadius: 7, alignItems: "center" as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}>
                        <Text style={{ fontSize: 11, fontWeight: "500", color: btn.color }}>{btn.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {/* Field diff list */}
                  <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    {aiFields.map((f, idx) => {
                      const isOn = aiToggles[f.key] !== false;
                      const cc = conflictColor(f.conflict);
                      return (
                        <View key={f.key} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: idx < aiFields.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border, gap: 8, opacity: isOn ? 1 : 0.45 }}>
                          <View style={{ width: 38, alignItems: "center" }}>
                            <View style={{ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, backgroundColor: cc + "22" }}>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: cc }}>{conflictLabel(f.conflict)}</Text>
                            </View>
                          </View>
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground, lineHeight: 15 }}>
                              {lang === "zh" ? f.labelZh : f.labelEn}
                            </Text>
                            {f.currentValue ? (
                              <Text style={{ fontSize: 10, color: colors.muted, lineHeight: 14 }} numberOfLines={1}>
                                {f.currentValue}{" → "}<Text style={{ color: cc, fontWeight: "500" }}>{f.aiValue}</Text>
                              </Text>
                            ) : (
                              <Text style={{ fontSize: 10, color: cc, fontWeight: "500", lineHeight: 14 }} numberOfLines={1}>{f.aiValue}</Text>
                            )}
                          </View>
                          <Switch
                            value={isOn}
                            onValueChange={(v) => setAiToggles((prev) => ({ ...prev, [f.key]: v }))}
                            trackColor={{ false: colors.border, true: colors.primary + "88" }}
                            thumbColor={isOn ? colors.primary : colors.muted}
                            style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                          />
                        </View>
                      );
                    })}
                  </View>
                  {/* Apply / Dismiss */}
                  <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 8 }}>
                    <Pressable
                      onPress={applyAiResult}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" as const, backgroundColor: toggledCount > 0 ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 })}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: toggledCount > 0 ? "#FFFFFF" : colors.muted }}>
                        {lang === "zh" ? `应用 ${toggledCount} 项` : `Apply ${toggledCount} fields`}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setAiResult(null)}
                      style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 16, borderRadius: 10, alignItems: "center" as const, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 13, color: colors.muted }}>{lang === "zh" ? "忽略" : "Dismiss"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })()}

            {/* Undo toast */}
            {undoSnapshot && (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.success + "18", borderWidth: 1, borderColor: colors.success + "44" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                  <Text style={{ fontSize: 12, fontWeight: "500", color: colors.success }}>
                    {lang === "zh" ? "AI 建议已应用" : "AI suggestions applied"}
                  </Text>
                </View>
                <Pressable onPress={undoAiApply} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{lang === "zh" ? "撤销" : "Undo"}</Text>
                </Pressable>
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

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
import { normalizeStyleToTaxonomy } from "@/lib/bottles/style-normalize";
import { enrichBottle, OfflineError } from "@/lib/api/smart-router";
import { lookupInOfflineKb, extractBookSnippets, offlineEntryToEnrichResult } from "@/lib/bottles/offline-lookup";
import { useBookStore } from "@/lib/books/store";
import * as ImagePicker from "expo-image-picker";
import { BOTTLE_GROUPS, bottleGroupOf } from "@/lib/bottles/types";

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
  // 三段式定价：包装数量 + 包装单位（与 price 配合使用）
  const [packQty, setPackQty] = useState(
    editing?.packQty ? String(editing.packQty) : "",
  );
  const [packUnit, setPackUnit] = useState(editing?.packUnit ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [flavorTags, setFlavorTags] = useState<string[]>(editing?.flavorTags ?? []);
  const [story, setStory] = useState(editing?.story ?? "");
  const [styleDesc, setStyleDesc] = useState(editing?.styleDesc ?? "");
  const [distilleryInfo, setDistilleryInfo] = useState(editing?.distilleryInfo ?? "");
  const [pairingNotes, setPairingNotes] = useState(editing?.pairingNotes ?? "");
  const [usageNotes, setUsageNotes] = useState(editing?.usageNotes ?? "");
  const [seasonality, setSeasonality] = useState(editing?.seasonality ?? "");
  const [notesEn, setNotesEn] = useState(editing?.notesEn ?? "");
  const [storyEn, setStoryEn] = useState(editing?.storyEn ?? "");
  const [substituteFor, setSubstituteFor] = useState(editing?.substituteFor ?? "");
  const [pairsWith, setPairsWith] = useState(editing?.pairsWith ?? "");

  // ── 开瓶易失效手动开关 ────────────────────────────────────────────────────
  // undefined = 使用系统自动判断；true/false = 用户手动覆盖
  const [perishableOnOpen, setPerishableOnOpen] = useState<boolean | undefined>(
    editing?.perishableOnOpen,
  );

  // ── 库归属手动选择 ────────────────────────────────────────────────────────
  // undefined = 系统自动判断（根据 category）；其他值 = 用户手动指定所属库
  const [libraryOverride, setLibraryOverride] = useState<'spirits' | 'bottles' | 'softdrinks' | 'materials' | 'homemade' | undefined>(
    editing?.libraryOverride ?? undefined,
  );
  const [homemadeGroup, setHomemadeGroup] = useState<'alcoholic' | 'non_alcoholic' | 'garnish' | 'other'>(
    editing?.homemadeGroup ?? 'non_alcoholic',
  );
  const [homemadeType, setHomemadeType] = useState<string>(
    editing?.homemadeType ?? '',
  );

  const canSave = nameZh.trim().length > 0 || nameEn.trim().length > 0;

  // ── AI 补全 ────────────────────────────────────────────────────────────────
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState<"auto" | "manual" | "photo" | null>(null);
  const [lookupStatus, setLookupStatus] = useState<{ kind: "ok" | "err" | "warn"; msg: string } | null>(null);

  type FullResult = Awaited<ReturnType<typeof enrichBottle>>;

  // ── AI 建议面板 state ──────────────────────────────────────────────────────
  const [aiResult, setAiResult] = useState<FullResult | null>(null);
  const [aiToggles, setAiToggles] = useState<Record<string, boolean>>({});
  const [undoSnapshot, setUndoSnapshot] = useState<null | {
    nameZh: string; nameEn: string; category: string; style: string;
    brand: string; origin: string; volume: string; abv: string; price: string;
    packQty?: string; packUnit?: string;
    notes: string; flavorTags: string[]; story: string; styleDesc: string;
    distilleryInfo: string; pairingNotes: string; usageNotes: string; seasonality: string;
    notesEn?: string; storyEn?: string; substituteFor?: string; pairsWith?: string;
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
    // 计算当前条目实际所属库（libraryOverride 优先，否则按 category 推断）
    const eg = (libraryOverride && libraryOverride !== 'homemade')
      ? libraryOverride
      : bottleGroupOf(category);
    // styleDesc 标签按库类型动态化
    const styleDescLabelZh = eg === "spirits" ? "桶型与陈年工艺"
      : eg === "bottles" ? "甜度与口感描述" : "风格描述";
    const styleDescLabelEn = eg === "spirits" ? "Cask & Aging"
      : eg === "bottles" ? "Sweetness & Taste" : "Style Desc";
    // distilleryInfo 标签
    const distilleryLabelZh = "蒸馏厂与工艺";
    const distilleryLabelEn = "Distillery & Craft";

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
    if (aiResult.notesEn) fields.push({ key: "notesEn", labelZh: "英文备注", labelEn: "EN Notes", aiValue: aiResult.notesEn.slice(0, 50) + (aiResult.notesEn.length > 50 ? "…" : ""), currentValue: notesEn ? notesEn.slice(0, 30) + "…" : "", conflict: conf(notesEn, aiResult.notesEn, aiResult.confidence) });
    if (aiResult.flavorTags.length > 0) {
      const curStr = flavorTags.length > 0 ? flavorTags.slice(0, 3).join(" · ") + (flavorTags.length > 3 ? "…" : "") : "";
      const aiStr = aiResult.flavorTags.slice(0, 4).join(" · ") + (aiResult.flavorTags.length > 4 ? ` +${aiResult.flavorTags.length - 4}` : "");
      fields.push({ key: "flavorTags", labelZh: "风味标签", labelEn: "Flavor Tags", aiValue: aiStr, currentValue: curStr, conflict: conf(curStr, aiStr, aiResult.confidence) });
    }
    if (aiResult.story) fields.push({ key: "story", labelZh: "故事/介绍", labelEn: "Story", aiValue: aiResult.story.slice(0, 50) + (aiResult.story.length > 50 ? "…" : ""), currentValue: story ? story.slice(0, 30) + (story.length > 30 ? "…" : "") : "", conflict: conf(story, aiResult.story, aiResult.confidence) });
    if (aiResult.storyEn) fields.push({ key: "storyEn", labelZh: "英文故事", labelEn: "EN Story", aiValue: aiResult.storyEn.slice(0, 50) + (aiResult.storyEn.length > 50 ? "…" : ""), currentValue: storyEn ? storyEn.slice(0, 30) + "…" : "", conflict: conf(storyEn, aiResult.storyEn, aiResult.confidence) });
    // styleDesc：按库类型动态标签，软饮库/其他也显示
    if (aiResult.styleDesc) fields.push({ key: "styleDesc", labelZh: styleDescLabelZh, labelEn: styleDescLabelEn, aiValue: aiResult.styleDesc.slice(0, 50) + (aiResult.styleDesc.length > 50 ? "…" : ""), currentValue: styleDesc ? styleDesc.slice(0, 30) + (styleDesc.length > 30 ? "…" : "") : "", conflict: conf(styleDesc, aiResult.styleDesc, aiResult.confidence) });
    // distilleryInfo：仅基酒库显示
    if (eg === "spirits" && aiResult.distilleryInfo) fields.push({ key: "distilleryInfo", labelZh: distilleryLabelZh, labelEn: distilleryLabelEn, aiValue: aiResult.distilleryInfo.slice(0, 50) + (aiResult.distilleryInfo.length > 50 ? "…" : ""), currentValue: distilleryInfo ? distilleryInfo.slice(0, 30) + "…" : "", conflict: conf(distilleryInfo, aiResult.distilleryInfo, aiResult.confidence) });
    // pairingNotes：基酒库不显示（基酒库用 pairsWith 替代），酒款库/原材料库显示
    if (eg !== "spirits" && aiResult.pairingNotes) fields.push({ key: "pairingNotes", labelZh: "搭配建议", labelEn: "Pairing Notes", aiValue: aiResult.pairingNotes.slice(0, 50) + (aiResult.pairingNotes.length > 50 ? "…" : ""), currentValue: pairingNotes ? pairingNotes.slice(0, 30) + "…" : "", conflict: conf(pairingNotes, aiResult.pairingNotes, aiResult.confidence) });
    // usageNotes：酒款库/原材料库显示
    if ((eg === "bottles" || eg === "materials") && aiResult.usageNotes) fields.push({ key: "usageNotes", labelZh: "调酒用途", labelEn: "Cocktail Usage", aiValue: aiResult.usageNotes.slice(0, 50) + (aiResult.usageNotes.length > 50 ? "…" : ""), currentValue: usageNotes ? usageNotes.slice(0, 30) + "…" : "", conflict: conf(usageNotes, aiResult.usageNotes, aiResult.confidence) });
    // seasonality：仅原材料库显示
    if (eg === "materials" && aiResult.seasonality) fields.push({ key: "seasonality", labelZh: "季节性", labelEn: "Seasonality", aiValue: aiResult.seasonality, currentValue: seasonality, conflict: conf(seasonality, aiResult.seasonality, aiResult.confidence) });
    // substituteFor/pairsWith：基酒库和酒款库显示
    if ((eg === "spirits" || eg === "bottles") && aiResult.substituteFor) fields.push({ key: "substituteFor", labelZh: "可替代酒款", labelEn: "Substitute For", aiValue: aiResult.substituteFor, currentValue: substituteFor, conflict: conf(substituteFor, aiResult.substituteFor, aiResult.confidence) });
    if ((eg === "spirits" || eg === "bottles") && aiResult.pairsWith) fields.push({ key: "pairsWith", labelZh: "搭配使用的酒款", labelEn: "Pairs Well With", aiValue: aiResult.pairsWith, currentValue: pairsWith, conflict: conf(pairsWith, aiResult.pairsWith, aiResult.confidence) });
    return fields;
  }, [aiResult, nameZh, nameEn, category, style, brand, origin, volume, abv, price, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality, notesEn, storyEn, substituteFor, pairsWith, taxCategories, libraryOverride]);

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
  // ── 单位选项（按库类型）──
  const applyField = useCallback((key: string) => {
    if (!aiResult) return;
    if (key === "nameZh" && aiResult.nameZh) setNameZh(aiResult.nameZh);
    else if (key === "nameEn" && aiResult.nameEn) setNameEn(aiResult.nameEn);
    else if (key === "category" && aiResult.category) setCategory(aiResult.category);
    // 应用分类后，若 AI 同时返回了 style 且当前 style 为空，自动归一化并填入
    // 这样用户点击「应用分类」时，风格字段也一并同步，无需再手动点击「应用风格」
    if (key === "category" && aiResult.category && aiResult.style && !style) {
      const normalized = normalizeStyleToTaxonomy(aiResult.style, stylesOf(aiResult.category));
      setStyle(normalized ?? aiResult.style);
    }
    else if (key === "style" && aiResult.style) {
      // Bug 4 修复：AI 返回的风格值可能与 taxonomy chip 值域存在大小写/斜杠/别名差异，
      // 先归一化到当前分类的规范值；未命中则保留原值（落入自定义风格输入框），不丢信息。
      const cat = aiResult.category && taxCategories.some((c) => c.zh === aiResult.category) ? aiResult.category : category;
      const normalized = normalizeStyleToTaxonomy(aiResult.style, stylesOf(cat));
      setStyle(normalized ?? aiResult.style);
    }
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
    else if (key === "notesEn" && aiResult.notesEn) setNotesEn(aiResult.notesEn);
    else if (key === "storyEn" && aiResult.storyEn) setStoryEn(aiResult.storyEn);
    else if (key === "substituteFor" && aiResult.substituteFor) setSubstituteFor(aiResult.substituteFor);
    else if (key === "pairsWith" && aiResult.pairsWith) setPairsWith(aiResult.pairsWith);
  }, [aiResult, taxCategories, category, stylesOf]);

  /** 应用所有 toggle=true 的字段，保存 undo 快照 */
  const applyAiResult = useCallback(() => {
    if (!aiResult) return;
    const fields = buildAiFields();
    setUndoSnapshot({ nameZh, nameEn, category, style, brand, origin, volume, abv, price, packQty, packUnit, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality, notesEn, storyEn, substituteFor, pairsWith });
    for (const f of fields) {
      if (aiToggles[f.key] !== false) applyField(f.key);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAiResult(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 6000);
  }, [aiResult, aiToggles, buildAiFields, applyField, nameZh, nameEn, category, style, brand, origin, volume, abv, price, packQty, packUnit, notes, flavorTags, story, styleDesc, distilleryInfo, pairingNotes, usageNotes, seasonality, notesEn, storyEn, substituteFor, pairsWith]);

  /** 撤销 AI 应用 */
  const undoAiApply = useCallback(() => {
    if (!undoSnapshot) return;
    setNameZh(undoSnapshot.nameZh); setNameEn(undoSnapshot.nameEn);
    setCategory(undoSnapshot.category); setStyle(undoSnapshot.style);
    setBrand(undoSnapshot.brand); setOrigin(undoSnapshot.origin);
    setVolume(undoSnapshot.volume); setAbv(undoSnapshot.abv); setPrice(undoSnapshot.price);
    if (undoSnapshot.packQty !== undefined) setPackQty(undoSnapshot.packQty);
    if (undoSnapshot.packUnit !== undefined) setPackUnit(undoSnapshot.packUnit);
    setNotes(undoSnapshot.notes); setFlavorTags(undoSnapshot.flavorTags);
    setStory(undoSnapshot.story); setStyleDesc(undoSnapshot.styleDesc);
    setDistilleryInfo(undoSnapshot.distilleryInfo); setPairingNotes(undoSnapshot.pairingNotes);
    setUsageNotes(undoSnapshot.usageNotes); setSeasonality(undoSnapshot.seasonality);
    if (undoSnapshot.notesEn !== undefined) setNotesEn(undoSnapshot.notesEn);
    if (undoSnapshot.storyEn !== undefined) setStoryEn(undoSnapshot.storyEn);
    if (undoSnapshot.substituteFor !== undefined) setSubstituteFor(undoSnapshot.substituteFor);
    if (undoSnapshot.pairsWith !== undefined) setPairsWith(undoSnapshot.pairsWith);
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
        lang: lang as 'zh' | 'en',
      };
      const res = await enrichBottle(enrichInput);
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
  }, [nameZh, nameEn, brand, category, style, origin, isOnline, lang, t, books]);

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
      packQty: packQty.trim() ? Math.max(0, parseFloat(packQty) || 0) : undefined,
      packUnit: packUnit.trim() || undefined,
      notes: notes.trim(),
      flavorTags,
      story: story.trim(),
      styleDesc: styleDesc.trim(),
      distilleryInfo: distilleryInfo.trim(),
      pairingNotes: pairingNotes.trim(),
      usageNotes: usageNotes.trim(),
      seasonality: seasonality.trim(),
      notesEn: notesEn.trim(),
      storyEn: storyEn.trim(),
      substituteFor: substituteFor.trim(),
      pairsWith: pairsWith.trim(),
    };
    if (perishableOnOpen !== undefined) {
      draft.perishableOnOpen = perishableOnOpen;
    }
    if (libraryOverride === 'homemade') {
      draft.libraryOverride = 'homemade';
      draft.homemadeGroup = homemadeGroup;
      if (homemadeType) draft.homemadeType = homemadeType;
    } else {
      // 清除之前设置的覆盖
      draft.libraryOverride = libraryOverride; // 'spirits'|'bottles'|'materials'|undefined
      draft.homemadeGroup = undefined;
      draft.homemadeType = undefined;
    }
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
  // 计算当前条目实际所属库（顶层，供所有分区使用）
  const effectiveGroup = (libraryOverride && libraryOverride !== 'homemade')
    ? libraryOverride
    : bottleGroupOf(category);

  // ── 单位选项（按库类型）──
  const unitOptions =
    effectiveGroup === "spirits" ? ["瓶", "ml", "cl", "L", "oz"]
    : effectiveGroup === "bottles" ? ["瓶", "罐", "箱", "ml", "cl"]
    : ["个", "听", "瓶", "g", "kg", "斤", "ml", "L"];

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
                  if (item.packQty) setPackQty(String(item.packQty));
                  if (item.packUnit) setPackUnit(item.packUnit);
                  if (item.notes || item.source) {
                    setNotes([item.notes, item.source].filter(Boolean).join(" · "));
                  }
                }}
              />
            </View>
          )}

          {/* ── 分区一：基本信息 ── */}
          {sectionTitle(
            effectiveGroup === "spirits"
              ? (lang === "zh" ? "基本信息 · 基酒" : "Basic Info · Spirit")
              : effectiveGroup === "bottles"
                ? (lang === "zh" ? "基本信息 · 酒款" : "Basic Info · Bottle")
                : (lang === "zh" ? "基本信息" : "Basic Info")
          )}
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
          {sectionTitle(
            effectiveGroup === "spirits"
              ? (lang === "zh" ? "分类与蒸馏风格" : "Category & Distillation Style")
              : effectiveGroup === "bottles"
                ? (lang === "zh" ? "分类与产品风格" : "Category & Product Style")
                : (lang === "zh" ? "分类与风格" : "Category & Style")
          )}
          <View style={{ paddingHorizontal: 20 }}>
            {/* ── 库归属选择器 ── */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
              {lang === "zh" ? "所属库" : "Library"}
            </Text>
            <View style={{ flexDirection: "row", backgroundColor: colors.border + "55", borderRadius: 10, padding: 2, gap: 2, marginBottom: 16 }}>
              {[
                { key: undefined as typeof libraryOverride, label: lang === "zh" ? "自动" : "Auto" },
                { key: 'spirits' as const, label: lang === "zh" ? "基酒库" : "Spirits" },
                { key: 'bottles' as const, label: lang === "zh" ? "酒款库" : "Bottles" },
                { key: 'softdrinks' as const, label: lang === "zh" ? "软饮库" : "Soft Drinks" },
                { key: 'materials' as const, label: lang === "zh" ? "原材料" : "Materials" },
                { key: 'homemade' as const, label: lang === "zh" ? "自制库" : "Homemade" },
              ].map((opt) => {
                const active = libraryOverride === opt.key;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => setLibraryOverride(opt.key as typeof libraryOverride)}
                    style={[
                      { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center" as const },
                      active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                    ]}
                  >
                    <Text style={{ fontSize: 11, fontWeight: active ? "600" : "400", color: active ? colors.foreground : colors.muted }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 自制库分区选择（仅 libraryOverride = 'homemade' 时显示） */}
            {libraryOverride === 'homemade' && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
                  {lang === "zh" ? "自制库分区" : "Homemade Section"}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {PREP_GROUPS.map((g) => {
                    const active = homemadeGroup === g.key;
                    return (
                      <Pressable
                        key={g.key}
                        onPress={() => { setHomemadeGroup(g.key as typeof homemadeGroup); setHomemadeType(''); }}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                          {lang === "en" ? g.en : g.zh}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* 自制库类型选择（按分区过滤） */}
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
                  {lang === "zh" ? "自制类型（可选）" : "Homemade Type (optional)"}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PREP_TYPES
                    .filter((pt) => {
                      if (homemadeGroup === 'alcoholic') return ['infused-spirit','homemade-liqueur','bitters-tincture','modified-spirit','homemade-spirit'].includes(pt.section);
                      if (homemadeGroup === 'non_alcoholic') return ['homemade-syrup','juice-cordial','shrub-vinegar','zero-proof','na-ferment'].includes(pt.section);
                      if (homemadeGroup === 'garnish') return pt.section.startsWith('garnish-');
                      return pt.section === 'misc';
                    })
                    .map((pt) => {
                      const active = homemadeType === pt.key;
                      return (
                        <Pressable
                          key={pt.key}
                          onPress={() => setHomemadeType(active ? '' : pt.key)}
                          style={[
                            styles.chip,
                            { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                            {lang === "en" ? pt.en : pt.zh}
                          </Text>
                        </Pressable>
                      );
                    })
                  }
                </View>
              </View>
            )}

            <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 8 }]}>
              {t("bform.category")}
            </Text>
            {(() => {
              // libraryOverride 为 undefined（自动）时，全部三组展开；选具体库时只显示该库分组
              const targetGroups = (libraryOverride && libraryOverride !== 'homemade')
                ? BOTTLE_GROUPS.filter((g) => g.key === libraryOverride)
                : BOTTLE_GROUPS;
              return targetGroups.map((grp) => {
                const groupCats = categoriesOfGroup(grp.key);
                if (groupCats.length === 0) return null;
                return (
                  <View key={grp.key} style={{ marginBottom: 12 }}>
                    {/* 仅"自动"模式下显示分组标题 */}
                    {(!libraryOverride || libraryOverride === 'homemade') && (
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
                    )}
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {groupCats.map((cat) => {
                        const active = category === cat;
                        return (
                          <Pressable
                            key={cat}
                            onPress={() => {
                              if (cat !== category) {
                                setCategory(cat);
                                setStyle(""); // 分类变化时清空风格，避免旧标签残留
                              }
                            }}
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
              });
            })()}

            {stylesOf(category).length > 0 && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 4, marginBottom: 4 }]}>
                  {effectiveGroup === "spirits"
                    ? (lang === "zh" ? "蒸馏风格" : "Distillation Style")
                    : effectiveGroup === "bottles"
                      ? (lang === "zh" ? "产品风格" : "Product Style")
                      : t("bform.style")}
                </Text>
                {effectiveGroup === "spirits" && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                    {lang === "zh" ? "选择或填写蒸馏工艺风格，如 Single Malt、Blended、Pot Still 等" : "Select or type distillation style, e.g. Single Malt, Blended, Pot Still"}
                  </Text>
                )}
                {effectiveGroup === "bottles" && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                    {lang === "zh" ? "选择或填写产品风格，如 Dry、Sweet、Bitter、Herbal 等" : "Select or type product style, e.g. Dry, Sweet, Bitter, Herbal"}
                  </Text>
                )}
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

            {/* ── 价格区（按库类型差异化）── */}
            {effectiveGroup === "spirits" ? (
              /* 基酒库：进货价（整瓶）+ 包装数量（可选）→ 自动计算每毫升成本 */
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 4 }]}>
                  {lang === "zh" ? "进货价格" : "Purchase Price"}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                  {lang === "zh"
                    ? "填写整瓶进货价（¥），系统自动计算每毫升成本"
                    : "Enter per-bottle purchase price (¥), cost-per-ml auto-calculated"}
                </Text>
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 4 }}>
                  <View style={{ flex: 1 }}>
                    {field(lang === "zh" ? "整瓶价格 (¥)" : "Bottle Price (¥)", price, setPrice,
                      lang === "zh" ? "例：180" : "e.g. 180", { keyboardType: "numeric" })}
                  </View>
                  <View style={{ flex: 1 }}>
                    {field(lang === "zh" ? "包装数量（可选）" : "Pack Qty (opt.)", packQty, setPackQty,
                      lang === "zh" ? "例：6（箱装）" : "e.g. 6 (case)", { keyboardType: "numeric" })}
                  </View>
                </View>
                {/* 每毫升成本预览 */}
                {price && volume && (() => {
                  const priceNum = parseFloat(price);
                  const volMatch = volume.match(/([\d.]+)\s*(ml|cl|L|l)/i);
                  if (!volMatch || !priceNum) return null;
                  let volMl = parseFloat(volMatch[1]);
                  const unit = volMatch[2].toLowerCase();
                  if (unit === "cl") volMl *= 10;
                  if (unit === "l") volMl *= 1000;
                  const qty = parseFloat(packQty) || 1;
                  const costPerMl = priceNum / (volMl * qty);
                  if (!isFinite(costPerMl) || costPerMl <= 0) return null;
                  return (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        {lang === "zh" ? "每毫升成本：" : "Cost/ml: "}
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                        ¥{costPerMl < 0.1 ? costPerMl.toFixed(4) : costPerMl.toFixed(3)}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>/ ml</Text>
                    </View>
                  );
                })()}
              </>
            ) : effectiveGroup === "bottles" ? (
              /* 酒款库：进货价 + 建议售价（可选）→ 自动计算毛利率 */
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 4 }]}>
                  {lang === "zh" ? "价格信息" : "Pricing"}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                  {lang === "zh"
                    ? "填写进货价和建议售价，系统自动计算毛利率"
                    : "Enter purchase and suggested retail price, margin auto-calculated"}
                </Text>
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 4 }}>
                  <View style={{ flex: 1 }}>
                    {field(lang === "zh" ? "进货价 (¥)" : "Purchase (¥)", price, setPrice,
                      lang === "zh" ? "例：45" : "e.g. 45", { keyboardType: "numeric" })}
                  </View>
                  <View style={{ flex: 1 }}>
                    {field(lang === "zh" ? "包装数量（可选）" : "Pack Qty (opt.)", packQty, setPackQty,
                      lang === "zh" ? "例：24（箱）" : "e.g. 24 (case)", { keyboardType: "numeric" })}
                  </View>
                </View>
              </>
            ) : (
              /* 原材料库 / 软饮库：计量单位 chip + 包装数量 + 总价 */
              <>
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 4 }]}>
                  {lang === "zh" ? "参考价格" : "Reference Price"}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                  {lang === "zh"
                    ? "填写进货规格和对应总价，例如：10个 → ¥8，或 1箱(24听) → ¥60"
                    : "Enter pack size and total price, e.g. 10 pcs → ¥8, or 1 case (24 cans) → ¥60"}
                </Text>
                {/* 计量单位 chip 勾选（仅原材料/软饮库） */}
                <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 6 }]}>
                  {lang === "zh" ? "计量单位" : "Unit"}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {unitOptions.map((u) => {
                    const active = packUnit === u;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => {
                          setPackUnit(active ? "" : u);
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>{u}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {/* 自定义单位（未选中预设时显示） */}
                {!unitOptions.includes(packUnit) && (
                  <View style={{ marginBottom: 8 }}>
                    {field(lang === "zh" ? "或填写自定义单位" : "Or custom unit", packUnit, setPackUnit,
                      lang === "zh" ? "例：桶、罐、袋…" : "e.g. barrel, keg…")}
                  </View>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  <View style={{ flex: 1.2 }}>
                    {field(lang === "zh" ? "包装数量" : "Pack Qty", packQty, setPackQty,
                      lang === "zh" ? "例：10 / 24" : "e.g. 10 / 24", { keyboardType: "numeric" })}
                  </View>
                  <View style={{ flex: 1.5 }}>
                    {field(lang === "zh" ? "总价(¥)" : "Total(¥)", price, setPrice,
                      lang === "zh" ? "例：8 / 60" : "e.g. 8 / 60", { keyboardType: "numeric" })}
                  </View>
                </View>
              </>
            )}
          </View>

          {/* ── 分区四：风味与描述 ── */}
          {sectionTitle(
            effectiveGroup === "spirits"
              ? (lang === "zh" ? "风味特征与介绍" : "Flavor Profile & Description")
              : effectiveGroup === "bottles"
                ? (lang === "zh" ? "风味特征与介绍" : "Flavor Profile & Description")
                : (lang === "zh" ? "风味标签与介绍" : "Flavor & Description")
          )}
          <View style={{ paddingHorizontal: 20 }}>
            {/* 风味标签 */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginBottom: 4 }]}>
              {effectiveGroup === "spirits" || effectiveGroup === "bottles"
                ? (lang === "zh" ? "风味特征标签" : "Flavor Profile Tags")
                : (lang === "zh" ? "风味标签" : "Flavor Tags")}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
              {effectiveGroup === "spirits"
                ? (lang === "zh" ? "描述该基酒的风味特征，可多选" : "Select flavor characteristics for this spirit")
                : effectiveGroup === "bottles"
                  ? (lang === "zh" ? "描述该酒款的风味特征，可多选" : "Select flavor characteristics for this bottle")
                  : (lang === "zh" ? "可多选" : "Multiple selection allowed")}
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

            {field(
              effectiveGroup === "spirits"
                ? (lang === "zh" ? "背景故事 / 品牌介绍" : "Story / Brand Background")
                : effectiveGroup === "bottles"
                  ? (lang === "zh" ? "产品介绍 / 品鉴笔记" : "Product Notes / Tasting Notes")
                  : (lang === "zh" ? "故事 / 介绍" : "Story"),
              story, setStory,
              effectiveGroup === "spirits"
                ? (lang === "en" ? "e.g. Founded in 1824, this distillery…" : "例如：创立于1824年，这家酒厂…")
                : effectiveGroup === "bottles"
                  ? (lang === "en" ? "e.g. Complex herbal liqueur with 27 botanicals…" : "例如：含27种草本植物的复杂利口酒…")
                  : (lang === "en" ? "Brief product story or description…" : "产品故事或简介…"),
              { multiline: true }
            )}
            {/* 风格描述：仅在原材料库或软饮库中显示（基酒库/酒款库已在分区五有专属字段） */}
            {(() => {
              if (effectiveGroup === "spirits" || effectiveGroup === "bottles") return null;
              return field(
                lang === "zh" ? "风格描述" : "Style Description",
                styleDesc, setStyleDesc,
                lang === "en" ? "Style characteristics…" : "风格特点描述…"
              );
            })()}
          </View>

          {/* ── 分区五：深度资料（按库类型条件显示） ── */}
          {(() => {
            if (effectiveGroup === "spirits") {
              // ── 基酒库专属深度资料 ──────────────────────────────────────────
              return (
                <>
                  {sectionTitle(lang === "zh" ? "蒸馏厂与工艺" : "Distillery & Craft")}
                  <View style={{ paddingHorizontal: 20 }}>
                    {field(
                      lang === "zh" ? "蒸馏厂 / 酒厂简介" : "Distillery Info",
                      distilleryInfo, setDistilleryInfo,
                      lang === "en"
                        ? "e.g. Copper pot still, Highland Scotland…"
                        : "例如：铜壶蒸馏，苏格兰高地产区…",
                      { multiline: true }
                    )}
                    {field(
                      lang === "zh" ? "桶型与陈年工艺" : "Cask & Aging",
                      styleDesc, setStyleDesc,
                      lang === "en"
                        ? "e.g. Ex-Bourbon Cask, 12yr, Sherry Finish…"
                        : "例如：Ex-Bourbon 桶，12年，Sherry 过桶…"
                    )}
                    {field(
                      lang === "zh" ? "可替代酒款" : "Substitute For",
                      substituteFor, setSubstituteFor,
                      lang === "en"
                        ? "e.g. Mezcal can replace Tequila in Margarita"
                        : "例如：梅斯卡尔可替代玛格丽特中的龙舌兰"
                    )}
                    {field(
                      lang === "zh" ? "搭配使用的酒款" : "Pairs Well With",
                      pairsWith, setPairsWith,
                      lang === "en"
                        ? "e.g. Campari, Sweet Vermouth"
                        : "例如：金巴利、甜味美思"
                    )}
                  </View>
                </>
              );
            }

            if (effectiveGroup === "bottles") {
              // ── 酒款库专属深度资料 ──────────────────────────────────────────
              return (
                <>
                  {sectionTitle(lang === "zh" ? "口感与调酒用途" : "Taste & Usage")}
                  <View style={{ paddingHorizontal: 20 }}>
                    {field(
                      lang === "zh" ? "甜度与口感描述" : "Sweetness & Taste",
                      styleDesc, setStyleDesc,
                      lang === "en"
                        ? "e.g. Dry, Off-Dry, Semi-Sweet, herbal bitterness…"
                        : "例如：干型、微甜、草本苦韵、柑橘酸爽…"
                    )}
                    {field(
                      lang === "zh" ? "调酒用途" : "Cocktail Usage",
                      usageNotes, setUsageNotes,
                      lang === "en"
                        ? "e.g. Base for Negroni, modifier in Spritz…"
                        : "例如：Negroni 基底，Spritz 调味剂…",
                      { multiline: true }
                    )}
                    {field(
                      lang === "zh" ? "搭配建议" : "Pairing Notes",
                      pairingNotes, setPairingNotes,
                      lang === "en"
                        ? "e.g. Great in Aperol Spritz, Negroni…"
                        : "例如：适合 Aperol Spritz、Negroni…",
                      { multiline: true }
                    )}
                    {field(
                      lang === "zh" ? "可替代酒款" : "Substitute For",
                      substituteFor, setSubstituteFor,
                      lang === "en"
                        ? "e.g. Aperol can replace Campari for a milder Negroni"
                        : "例如：Aperol 可替代金巴利做更温和的 Negroni"
                    )}
                    {field(
                      lang === "zh" ? "搭配使用的酒款" : "Pairs Well With",
                      pairsWith, setPairsWith,
                      lang === "en"
                        ? "e.g. Gin, Prosecco, Sweet Vermouth"
                        : "例如：金酒、普罗塞克、甜味美思"
                    )}
                  </View>
                </>
              );
            }

            if (effectiveGroup === "materials") {
              // ── 原材料库专属深度资料 ────────────────────────────────────────
              return (
                <>
                  {sectionTitle(lang === "zh" ? "调酒用途" : "Usage Notes")}
                  <View style={{ paddingHorizontal: 20 }}>
                    {field(
                      lang === "zh" ? "调酒用途" : "Usage Notes",
                      usageNotes, setUsageNotes,
                      lang === "en"
                        ? "e.g. Citrus peel for Martini garnish…"
                        : "例如：皮油常用于 Martini 装饰…",
                      { multiline: true }
                    )}
                    {field(
                      lang === "zh" ? "季节性" : "Seasonality",
                      seasonality, setSeasonality,
                      lang === "en" ? "e.g. Best in spring…" : "例如：春季最佳"
                    )}
                  </View>
                </>
              );
            }

            // softdrinks / 其他：无深度资料区
            return null;
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
import { PREP_GROUPS, PREP_TYPES } from "@/lib/homemade/types";

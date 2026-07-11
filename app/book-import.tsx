import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import {
  batchImagesForOcr,
  extractEpubForReading,
  extractEpubImages,
  extractPdf,
  renderPdfPagesToImages,
  ExtractedBook,
} from "@/lib/import/extract";
import { extractEpubToFileSystem } from "@/lib/import/extract";
import { detectRecipesInText, RecipeCandidate } from "@/lib/import/detect";
import { ParsedRecipe } from "@/lib/recipes/parser";
import { genId } from "@/lib/recipes/types";
import { useRecipeStore } from "@/lib/recipes/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { classifyPrepGroup, guessPrepType } from "@/lib/homemade/types";
import { normalizeCodexFamilyDecl } from "@/lib/recipes/lineage";
import { trpc } from "@/lib/trpc";
import { useBookStore } from "@/lib/books/store";

type Phase = "idle" | "loading" | "reading" | "confirm" | "done";

/** A paragraph block in the reading view */
interface ReadingBlock {
  id: string;
  type: "heading" | "paragraph";
  text: string;
  sectionTitle: string;
  /** AI detected this as a recipe candidate */
  isCandidate: boolean;
  candidateConfidence: number;
  /** User selected this block for import */
  selected: boolean;
  /** Parsed candidate data (filled when AI scans this block) */
  candidate?: RecipeCandidate;
}

/** A confirmed item for the review/import phase */
interface ReviewItem {
  blockId: string;
  candidate: RecipeCandidate;
  checked: boolean;
  kind: "cocktail" | "prep";
  expanded: boolean;
  duplicate: boolean;
  translated?: ParsedRecipe;
  showTranslated: boolean;
}

interface PendingFile {
  buffer: ArrayBuffer;
  base64?: string;
  isPdf: boolean;
  name: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i]);
    const b = chars.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? chars.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? chars.indexOf(clean[i + 3]) : -1;
    bytes[p++] = (a << 2) | (b >> 4);
    if (c >= 0) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes.buffer.slice(0, p);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const isAscii = (s: string) => /^[\x00-\x7F]+$/.test(s);

/** Convert extracted sections into reading blocks */
function buildReadingBlocks(sections: ExtractedBook["sections"]): ReadingBlock[] {
  const blocks: ReadingBlock[] = [];
  for (const section of sections) {
    if (section.title && section.title.length < 80) {
      blocks.push({
        id: genId(),
        type: "heading",
        text: section.title,
        sectionTitle: section.title,
        isCandidate: false,
        candidateConfidence: 0,
        selected: false,
      });
    }
    const lines = section.text.split(/\n+/).filter((l) => l.trim().length > 0);
    // Group into paragraph chunks (~300 chars or natural paragraph breaks)
    let buf: string[] = [];
    const flush = () => {
      if (buf.length === 0) return;
      const text = buf.join("\n").trim();
      if (text.length > 0) {
        blocks.push({
          id: genId(),
          type: "paragraph",
          text,
          sectionTitle: section.title,
          isCandidate: false,
          candidateConfidence: 0,
          selected: false,
        });
      }
      buf = [];
    };
    for (const line of lines) {
      buf.push(line);
      const joined = buf.join("\n");
      if (joined.length >= 280 || line.startsWith("##")) {
        flush();
      }
    }
    flush();
  }
  return blocks;
}

/** Book Import Screen — iOS Reading Style */
export default function BookImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const insets = useSafeAreaInsets();
  const zh = lang === "zh";

  const [phase, setPhase] = useState<Phase>("idle");
  const [loadStatus, setLoadStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [ocrOffer, setOcrOffer] = useState(false);
  const [bookTitle, setBookTitle] = useState("");

  // Reading view state
  const [blocks, setBlocks] = useState<ReadingBlock[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [currentChapter, setCurrentChapter] = useState(0);
  // AI scan range: null = all pages
  const [scanRange, setScanRange] = useState<{ from: number; to: number } | null>(null);
  const [showRangePicker, setShowRangePicker] = useState(false);

  // Confirm/import phase
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [importResult, setImportResult] = useState<{ recipes: number; preps: number } | null>(null);
  const [reviewError, setReviewError] = useState("");

  const pendingRef = useRef<PendingFile | null>(null);
  const currentBookSectionsRef = useRef<ExtractedBook["sections"]>([]);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const { isOnline } = useNetwork();

  const ocrMutation = trpc.bookImport.ocr.useMutation();
  const translateMutation = trpc.bookImport.translate.useMutation();
  const enrichRecipeMutation = trpc.lookup.enrichRecipe.useMutation();

  const { addRecipe, updateRecipe, recipes } = useRecipeStore();
  const { addPrep, preps, sections, types } = useHomemadeStore();
  const { addBook, addBookWithHtml, addBookFromFileSystem } = useBookStore();

  const existingNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) {
      if (r.name) set.add(r.name.toLowerCase().trim());
      if (r.nameEn) set.add(r.nameEn.toLowerCase().trim());
    }
    for (const p of preps) {
      if (p.name) set.add(p.name.toLowerCase().trim());
      if (p.nameAlt) set.add(p.nameAlt.toLowerCase().trim());
    }
    return set;
  }, [recipes, preps]);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ─── File loading ───────────────────────────────────────────────────────────

  const loadPlainBookIntoReader = useCallback((book: ExtractedBook, fileName: string, format = "epub") => {
    const title = book.title || fileName.replace(/\.(epub|pdf)$/i, "");
    setBookTitle(title);
    const newBlocks = buildReadingBlocks(book.sections);
    setBlocks(newBlocks);
    setCurrentChapter(0);
    setScanProgress(null);
    setPhase("reading");
    currentBookSectionsRef.current = book.sections;
    addBook({
      title,
      fileName,
      format,
      sectionCount: book.sections.length,
      hasHtml: false,
      sections: book.sections,
    });
  }, [addBook]);

  const runOcr = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (!isOnline) {
      Alert.alert(zh ? "无网络连接" : "No Internet Connection", zh ? "AI 识别需要网络连接，请检查后重试" : "AI OCR requires an internet connection.");
      return;
    }
    setLoadError("");
    setOcrOffer(false);
    setPhase("loading");
    try {
      const texts: string[] = [];
      const smallEnough = pending.buffer.byteLength <= 10 * 1024 * 1024;
      if (pending.isPdf && smallEnough) {
        setLoadStatus(zh ? "AI 正在识别 PDF…" : "AI reading PDF…");
        const base64 =
          pending.base64 ?? (Platform.OS === "web" ? arrayBufferToBase64(pending.buffer) : "");
        if (!base64) throw new Error(zh ? "读取文件失败" : "Failed to read file");
        const res = await ocrMutation.mutateAsync({ pdfBase64: base64 });
        if (res.text) texts.push(res.text);
      } else if (pending.isPdf) {
        if (Platform.OS !== "web") {
          throw new Error(
            zh ? "PDF 超过 10MB，请在网页版使用或压缩后重试" : "PDF over 10MB — use the web app",
          );
        }
        setLoadStatus(zh ? "正在渲染页面…" : "Rendering pages…");
        const images = await renderPdfPagesToImages(pending.buffer, {
          maxPages: 80,
          onProgress: (done, total) =>
            setLoadStatus(zh ? `正在渲染 ${done}/${total} 页…` : `Rendering ${done}/${total} pages…`),
        });
        const batches = batchImagesForOcr(images);
        for (let b = 0; b < batches.length; b++) {
          setLoadStatus(
            zh ? `AI 识别中… 第 ${b + 1}/${batches.length} 批` : `AI OCR… batch ${b + 1}/${batches.length}`,
          );
          const res = await ocrMutation.mutateAsync({ images: batches[b] });
          if (res.text) texts.push(res.text);
        }
      } else {
        setLoadStatus(zh ? "正在提取书页图片…" : "Extracting page images…");
        const images = await extractEpubImages(pending.buffer, 40);
        if (images.length === 0)
          throw new Error(zh ? "书中没有可识别的书页图片" : "No recognizable page images found");
        const batches = batchImagesForOcr(images);
        for (let b = 0; b < batches.length; b++) {
          setLoadStatus(
            zh ? `AI 识别中… 第 ${b + 1}/${batches.length} 批` : `AI OCR… batch ${b + 1}/${batches.length}`,
          );
          const res = await ocrMutation.mutateAsync({ images: batches[b] });
          if (res.text) texts.push(res.text);
        }
      }
      const text = texts.join("\n\n").trim();
      if (!text) throw new Error(zh ? "AI 未能识别出文字" : "AI could not read any text");
      const syntheticBook: ExtractedBook = {
        title: pending.name.replace(/\.(epub|pdf)$/i, ""),
        sections: [{ title: "", text }],
      };
      loadPlainBookIntoReader(syntheticBook, pending.name, pending.isPdf ? "scanned-pdf" : "scanned-epub");
    } catch (e) {
      if (!isMountedRef.current) return;
      setLoadError(
        (zh ? "AI 识别失败：" : "AI OCR failed: ") + (e instanceof Error ? e.message : String(e)),
      );
      setPhase("idle");
    }
  }, [zh, ocrMutation, loadPlainBookIntoReader]);

  const pickFile = useCallback(async () => {
    tap();
    setLoadError("");
    setOcrOffer(false);
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/epub+zip", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const isEpub = /\.epub$/i.test(asset.name) || asset.mimeType === "application/epub+zip";
    const isPdf = /\.pdf$/i.test(asset.name) || asset.mimeType === "application/pdf";
    if (!isEpub && !isPdf) {
      setLoadError(zh ? "仅支持 EPUB 或 PDF 文件" : "Only EPUB or PDF files are supported");
      return;
    }
    setPhase("loading");
    setLoadStatus(zh ? "正在读取文件…" : "Reading file…");
    try {
      if (isEpub && Platform.OS !== "web") {
        // Native EPUB: use filesystem extractor (supports 1GB+, no full Base64 read)
        setLoadStatus(zh ? "正在解析 EPUB…" : "Parsing EPUB…");
        const bookId = `book_${Date.now()}`;
        setLoadStatus(zh ? "正在解压书籍文件…" : "Extracting book files…");
        // Pass file URI directly — extractor reads from disk, no full-file memory load
        const result = await extractEpubToFileSystem(asset.uri, bookId);
        setLoadStatus(zh ? "正在保存书籍索引…" : "Saving book index…");
        const stored = await addBookFromFileSystem(
          {
            title: result.title || asset.name.replace(/\.epub$/i, ""),
            fileName: asset.name,
            format: "epub",
            sectionCount: result.chapters.length,
            css: result.css,
            author: result.author || undefined,
            bookDir: result.bookDir,
            coverUri: result.coverUri,
          },
          result.chapters,
        );
        router.replace(`/book-reader?id=${stored.id}`);
      } else if (isEpub && Platform.OS === "web") {
        // Web EPUB: fall back to in-memory rendering
        const resp = await fetch(asset.uri);
        const buffer = await resp.arrayBuffer();
        setLoadStatus(zh ? "正在解析文件…" : "Parsing file…");
        const htmlBook = await extractEpubForReading(buffer);
        const title = htmlBook.title || asset.name.replace(/\.epub$/i, "");
        setLoadStatus(zh ? "正在保存章节…" : "Saving chapters…");
        const stored = await addBookWithHtml(
          { title, fileName: asset.name, format: "epub", sectionCount: htmlBook.chapters.length, css: htmlBook.css },
          htmlBook.chapters,
        );
        router.replace(`/book-reader?id=${stored.id}`);
      } else if (isPdf) {
        // PDF: read into buffer then OCR or extract
        let buffer: ArrayBuffer;
        let base64: string | undefined;
        if (Platform.OS === "web") {
          const resp = await fetch(asset.uri);
          buffer = await resp.arrayBuffer();
        } else {
          const b64: string = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          base64 = b64;
          buffer = base64ToArrayBuffer(b64);
        }
        pendingRef.current = { buffer, base64, isPdf: true, name: asset.name };
        if (Platform.OS !== "web") {
          await runOcr();
        } else {
          const book = await extractPdf(buffer);
          loadPlainBookIntoReader(book, asset.name, "pdf");
        }
      }
    } catch (e) {
      setOcrOffer(true);
      setLoadError(
        (zh ? "解析失败：" : "Parse failed: ") +
          (e instanceof Error ? e.message : String(e)) +
          (zh ? "　可尝试 AI 智能识别。" : " — try AI Smart OCR."),
      );
      setPhase("idle");
    }
  }, [zh, runOcr, loadPlainBookIntoReader, addBookWithHtml, router]);

  // ─── AI scanning during reading ─────────────────────────────────────────────

  /** Scan all blocks (or visible section) with local detection engine */
  const runLocalScan = useCallback(() => {
    setBlocks((prev) => {
      const next = [...prev];
      // Group blocks by section and run detectRecipesInText per section
      const sectionMap = new Map<string, { indices: number[]; text: string }>();
      for (let i = 0; i < next.length; i++) {
        const b = next[i];
        if (b.type === "heading") continue;
        const key = b.sectionTitle;
        if (!sectionMap.has(key)) sectionMap.set(key, { indices: [], text: "" });
        const s = sectionMap.get(key)!;
        s.indices.push(i);
        s.text += (s.text ? "\n\n" : "") + b.text;
      }
      for (const [title, { indices, text }] of sectionMap) {
        const candidates = detectRecipesInText(text, title);
        if (candidates.length === 0) continue;
        // Match candidates back to blocks by text overlap
        for (const cand of candidates) {
          const rawLower = cand.raw.toLowerCase();
          let bestIdx = -1;
          let bestScore = 0;
          for (const i of indices) {
            const blockLower = next[i].text.toLowerCase();
            // score by how many chars of cand.raw appear in this block
            let overlap = 0;
            const words = rawLower.split(/\s+/).filter((w) => w.length > 3);
            for (const w of words) {
              if (blockLower.includes(w)) overlap++;
            }
            const score = words.length > 0 ? overlap / words.length : 0;
            if (score > bestScore) {
              bestScore = score;
              bestIdx = i;
            }
          }
          if (bestIdx >= 0 && bestScore > 0.25) {
            next[bestIdx] = {
              ...next[bestIdx],
              isCandidate: true,
              candidateConfidence: cand.confidence,
              candidate: cand,
            };
          }
        }
      }
      return next;
    });
  }, []);

  /** Trigger AI-assisted deep scan via OCR endpoint on current book content */
  const runAiScan = useCallback(async (range?: { from: number; to: number }) => {
    if (scanning) return;
    setScanning(true);
    // Determine which paragraph blocks to scan
    const allParas = blocks.filter((b) => b.type === "paragraph");
    const total = allParas.length;
    const effectiveRange = range ?? scanRange;
    let paras = allParas;
    if (effectiveRange) {
      // Convert 1-indexed section range to block range
      const headings = blocks.filter((b) => b.type === "heading");
      const fromIdx = Math.max(0, effectiveRange.from - 1);
      const toIdx = Math.min(headings.length - 1, effectiveRange.to - 1);
      const fromSection = headings[fromIdx]?.sectionTitle ?? "";
      const toSection = headings[toIdx]?.sectionTitle ?? headings[headings.length - 1]?.sectionTitle ?? "";
      let inRange = false;
      let past = false;
      paras = allParas.filter((b) => {
        if (b.sectionTitle === fromSection) inRange = true;
        if (inRange && b.sectionTitle === toSection) past = false;
        if (b.sectionTitle > toSection && toSection) past = true;
        return inRange && !past;
      });
      if (paras.length === 0) paras = allParas; // fallback
    }
    setScanProgress({ done: 0, total: paras.length });
    try {
      const chunkSize = 20;
      let done = 0;
      for (let i = 0; i < paras.length; i += chunkSize) {
        const chunk = paras.slice(i, i + chunkSize);
        const chunkText = chunk.map((b) => b.text).join("\n\n");
        const candidates = detectRecipesInText(chunkText, "");
        setBlocks((prev) => {
          const next = [...prev];
          for (const cand of candidates) {
            const rawWords = cand.raw.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            for (const b of chunk) {
              const idx = next.findIndex((nb) => nb.id === b.id);
              if (idx < 0) continue;
              const blockLower = next[idx].text.toLowerCase();
              let overlap = 0;
              for (const w of rawWords) if (blockLower.includes(w)) overlap++;
              const score = rawWords.length > 0 ? overlap / rawWords.length : 0;
              if (score > 0.3 && (!next[idx].isCandidate || cand.confidence > next[idx].candidateConfidence)) {
                next[idx] = {
                  ...next[idx],
                  isCandidate: true,
                  candidateConfidence: cand.confidence,
                  candidate: cand,
                };
              }
            }
          }
          return next;
        });
        done += chunk.length;
        setScanProgress({ done, total: paras.length });
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }, [scanning, blocks, scanRange]);

  // ─── Block selection ─────────────────────────────────────────────────────────

  const toggleBlock = useCallback((id: string) => {
    tap();
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b)),
    );
  }, []);

  const selectedCount = blocks.filter((b) => b.selected).length;
  const candidateCount = blocks.filter((b) => b.isCandidate).length;

  // ─── Proceed to confirm phase ────────────────────────────────────────────────

  const proceedToConfirm = useCallback(() => {
    tap();
    const selected = blocks.filter((b) => b.selected && b.type === "paragraph");
    if (selected.length === 0) return;
    const items: ReviewItem[] = selected.map((b) => {
      // Use existing candidate if available, else detect from block text
      const cand: RecipeCandidate = b.candidate ?? (() => {
        const detected = detectRecipesInText(b.text, b.sectionTitle);
        return detected[0] ?? {
          id: genId(),
          kind: "cocktail" as const,
          name: b.text.split("\n")[0].slice(0, 48).trim(),
          parsed: { name: b.text.split("\n")[0].slice(0, 48).trim(), ingredients: [], steps: b.text, garnish: "", glass: "", method: "", source: "", variantOf: "", codexFamily: "", baseSpirit: "" },
          raw: b.text,
          sectionTitle: b.sectionTitle,
          confidence: 0.5,
        };
      })();
      const duplicate = !!cand.name && existingNames.has(cand.name.toLowerCase().trim());
      return {
        blockId: b.id,
        candidate: cand,
        checked: !duplicate && !!cand.name,
        kind: cand.kind,
        expanded: false,
        duplicate,
        showTranslated: false,
      };
    });
    setReviewItems(items);
    setReviewError("");
    setImportResult(null);
    setPhase("confirm");
  }, [blocks, existingNames]);

  // ─── Confirm phase: translate & import ──────────────────────────────────────

  const updateItem = useCallback((blockId: string, patch: Partial<ReviewItem>) => {
    setReviewItems((prev) => prev.map((r) => (r.blockId === blockId ? { ...r, ...patch } : r)));
  }, []);

  const checkedCount = reviewItems.filter((r) => r.checked).length;
  const translating = translateMutation.isPending;
  const anyTranslated = reviewItems.some((r) => r.translated);
  const untranslatedChecked = reviewItems.some((r) => r.checked && !r.translated);

  const doTranslate = useCallback(async () => {
    tap();
    if (!isOnline) {
      Alert.alert(zh ? "无网络连接" : "No Internet Connection", zh ? "翻译需要网络连接，请检查后重试" : "Translation requires an internet connection.");
      return;
    }
    setReviewError("");
    const untranslated = reviewItems.filter((r) => r.checked && !r.translated).slice(0, 60);
    if (untranslated.length === 0) {
      setReviewItems((prev) => {
        const anyOff = prev.some((r) => r.translated && !r.showTranslated);
        return prev.map((r) => (r.translated ? { ...r, showTranslated: anyOff } : r));
      });
      return;
    }
    try {
      for (let i = 0; i < untranslated.length; i += 15) {
        const batch = untranslated.slice(i, i + 15);
        const res = await translateMutation.mutateAsync({
          target: zh ? "zh" : "en",
          items: batch.map((r) => ({
            id: r.candidate.id,
            name: r.candidate.parsed.name || r.candidate.name,
            ingredients: r.candidate.parsed.ingredients.map((ing) => ({ name: ing.name, amount: ing.amount })),
            steps: r.candidate.parsed.steps,
            garnish: r.candidate.parsed.garnish,
            glass: r.candidate.parsed.glass,
            method: r.candidate.parsed.method,
          })),
        });
        if (!isMountedRef.current) return;
        setReviewItems((prev) =>
          prev.map((r) => {
            const t = res.items.find((it) => it.id === r.candidate.id);
            if (!t) return r;
            const orig = r.candidate.parsed;
            const translated: ParsedRecipe = {
              ...orig,
              name: t.name || orig.name,
              ingredients:
                t.ingredients.length === orig.ingredients.length
                  ? t.ingredients.map((ing, idx) => ({ id: orig.ingredients[idx].id, name: ing.name || orig.ingredients[idx].name, amount: ing.amount || orig.ingredients[idx].amount }))
                  : t.ingredients.map((ing) => ({ id: genId(), ...ing })),
              steps: t.steps || orig.steps,
              garnish: t.garnish,
              glass: t.glass || orig.glass,
              method: t.method || orig.method,
            };
            return { ...r, translated, showTranslated: true };
          }),
        );
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      setReviewError((zh ? "翻译失败：" : "Translation failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  }, [reviewItems, zh, translateMutation]);

  const doImport = useCallback(() => {
    tap();
    const selected = reviewItems.filter((r) => r.checked);
    if (selected.length === 0) return;
    const source = bookTitle;
    let recipeCount = 0;
    let prepCount = 0;
    for (const row of selected) {
      const orig = row.candidate.parsed;
      const p = row.showTranslated && row.translated ? row.translated : orig;
      const origName = orig.name || row.candidate.name;
      const name = p.name || origName || (zh ? "未命名配方" : "Untitled recipe");
      if (row.kind === "prep") {
        const prepText = `${name} ${row.candidate.raw}`;
        const prepType = guessPrepType(prepText, types) ?? types[0]?.key ?? "syrup";
        const prepIngredients = p.ingredients.map((i) => (i.amount ? `${i.name} ${i.amount}` : i.name));
        addPrep({
          name,
          nameAlt: name !== origName ? origName : "",
          type: prepType,
          abvGroup: classifyPrepGroup({ name, type: prepType, ingredients: prepIngredients, recipe: p.steps, sections, types }),
          ingredients: prepIngredients,
          recipe: p.steps,
          yield: "",
          shelfLife: "",
          storage: "",
          source,
          notes: "",
        });
        prepCount++;
      } else {
        const draft = {
          name,
          nameEn: isAscii(name) ? name : isAscii(origName) && origName ? origName : "",
          categoryId: null,
          baseSpirit: p.baseSpirit,
          glass: p.glass,
          method: p.method,
          strength: "medium" as const,
          variantOf: p.variantOf || "",
          codexFamily: normalizeCodexFamilyDecl(p.codexFamily || ""),
          flavors: [],
          source: p.source || source,
          story: "",
          flavorDesc: "",
          ingredients: p.ingredients,
          steps: p.steps,
          garnish: p.garnish,
          notes: "",
        };
        const newRecipe = addRecipe(draft);
        const ingNames = p.ingredients.map((i) => i.name).filter(Boolean);
        enrichRecipeMutation.mutate(
          { name: draft.name, nameEn: draft.nameEn || undefined, baseSpirit: draft.baseSpirit || undefined, ingredients: ingNames.length > 0 ? ingNames : undefined },
          { onSuccess: (result) => { if (result.flavors.length > 0) updateRecipe(newRecipe.id, { ...draft, flavors: result.flavors }); } },
        );
        recipeCount++;
      }
    }
    setImportResult({ recipes: recipeCount, preps: prepCount });
    setReviewItems([]);
    setPhase("done");
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [reviewItems, bookTitle, zh, addRecipe, updateRecipe, addPrep, sections, types, enrichRecipeMutation]);

  // ─── Chapter headings for navigation ────────────────────────────────────────
  const chapterHeadings = useMemo(
    () => blocks.filter((b) => b.type === "heading").map((b, i) => ({ id: b.id, title: b.text, index: i })),
    [blocks],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border, paddingBottom: phase === "reading" ? 0 : 8 },
        ]}
      >
        <Pressable
          onPress={() => {
            tap();
            if (phase === "reading") {
              if (Platform.OS === "web") {
                if (window.confirm(zh ? "退出阅读？" : "Exit reading?")) {
                  setPhase("idle");
                  setBlocks([]);
                }
              } else {
                Alert.alert(zh ? "退出阅读" : "Exit reading", "", [
                  { text: zh ? "取消" : "Cancel", style: "cancel" },
                  { text: zh ? "退出" : "Exit", style: "destructive", onPress: () => { setPhase("idle"); setBlocks([]); } },
                ]);
              }
            } else if (phase === "confirm") {
              setPhase("reading");
            } else {
              router.back();
            }
          }}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol
            name={phase === "confirm" ? "chevron.left" : "xmark"}
            size={20}
            color={colors.foreground}
          />
        </Pressable>
        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {phase === "reading" || phase === "confirm"
              ? bookTitle || (zh ? "阅读中" : "Reading")
              : zh
                ? "书籍导入"
                : "Book Import"}
          </Text>
          {phase === "reading" && (
            <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
              {scanning
                ? scanProgress
                  ? `${zh ? "AI 扫描中" : "AI scanning"} ${scanProgress.done}/${scanProgress.total}…`
                  : (zh ? "AI 扫描中…" : "AI scanning…")
                : candidateCount > 0
                  ? zh
                    ? `发现 ${candidateCount} 处候选配方，已选 ${selectedCount} 处`
                    : `${candidateCount} recipe hints · ${selectedCount} selected`
                  : zh
                    ? "阅读并点击段落来选取配方"
                    : "Read and tap paragraphs to select recipes"}
            </Text>
          )}
        </View>
        {phase === "reading" && (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable
              onPress={() => { tap(); setShowRangePicker(true); }}
              disabled={scanning}
              hitSlop={8}
              style={({ pressed }) => [
                styles.scanBtn,
                { backgroundColor: scanning ? colors.border : colors.primary + "18", borderColor: colors.primary + "44" },
                pressed && { opacity: 0.7 },
              ]}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconSymbol name="sparkles" size={14} color={colors.primary} />
              )}
              <Text style={{ fontSize: 12, fontWeight: "600", color: scanning ? colors.muted : colors.primary }}>
                {zh ? "AI 扫描" : "AI Scan"}
              </Text>
              {scanRange && (
                <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "500" }}>
                  {scanRange.from}-{scanRange.to}
                </Text>
              )}
            </Pressable>
          </View>
        )}
        {phase === "confirm" && (
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {zh ? `已选 ${checkedCount}` : `${checkedCount} selected`}
          </Text>
        )}
      </View>

      {/* ── Idle ── */}
      {phase === "idle" && (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8 }}>
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={[styles.bigIcon, { backgroundColor: "#FF9500" }]}>
              <IconSymbol name="book.fill" size={28} color="#FFFFFF" />
            </View>
            <Text className="text-lg font-bold text-foreground mt-4 text-center">
              {zh ? "导入配方书" : "Import a Recipe Book"}
            </Text>
            <Text className="text-sm text-muted text-center mt-2" style={{ lineHeight: 20 }}>
              {zh
                ? "选择 EPUB 或 PDF 文件，在阅读器中边读边选取配方，AI 智能标注辅助，导入选中内容。支持最大 2GB 文件。"
                : "Pick an EPUB or PDF. Read it in our reader, tap paragraphs to select recipes with AI highlighting. Up to 2GB."}
            </Text>
            <Pressable
              onPress={pickFile}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.85 },
              ]}
            >
              <IconSymbol name="doc.badge.plus" size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>
                {zh ? "选择 EPUB / PDF（最大 2GB）" : "Choose EPUB / PDF (up to 2GB)"}
              </Text>
            </Pressable>
          </View>
          {!!loadError && (
            <View style={[styles.errorBox, { marginTop: 12 }]}>
              <Text style={{ color: "#FF3B30", fontSize: 13, lineHeight: 18 }}>{loadError}</Text>
            </View>
          )}
          {ocrOffer && (
            <Pressable
              onPress={() => { tap(); void runOcr(); }}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: "#FF9500", marginTop: 12 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <IconSymbol name="sparkles" size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>
                {zh ? "AI 智能识别（扫描版 / 图片书）" : "AI Smart OCR (scanned / images)"}
              </Text>
            </Pressable>
          )}
          <View style={[styles.hintBox, { borderColor: colors.border, backgroundColor: colors.surface, marginTop: 12 }]}>
            <Text className="text-xs text-muted" style={{ lineHeight: 18 }}>
              {zh
                ? "💡 新功能：书籍导入已升级为阅读器模式。打开文件后，在阅读视图中浏览内容；带橙色标注的段落是 AI 发现的配方候选，轻点选中；也可手动点选任意段落。选好后点击「导入选中内容」一键入库。"
                : "💡 New: book import is now a reader. Open a file, browse it — orange-highlighted paragraphs are AI-detected recipe candidates. Tap to select. Then tap Import."}
            </Text>
          </View>
        </ScrollView>
      )}

      {/* ── Loading ── */}
      {phase === "loading" && (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text className="text-base text-foreground mt-4">{loadStatus}</Text>
          <Text className="text-xs text-muted mt-2 text-center">
            {zh ? "大文件或 AI 识别可能需要一会，请稍候" : "Large files or AI OCR may take a while"}
          </Text>
        </View>
      )}

      {/* ── Reading ── */}
      {phase === "reading" && (
        <>
          {/* Scan progress bar */}
          {scanning && scanProgress && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
              <View style={{ height: 2, backgroundColor: colors.border, borderRadius: 1, overflow: "hidden" }}>
                <View
                  style={{
                    height: 2,
                    backgroundColor: colors.primary,
                    width: `${Math.round((scanProgress.done / Math.max(scanProgress.total, 1)) * 100)}%`,
                    borderRadius: 1,
                  }}
                />
              </View>
            </View>
          )}

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingTop: 16,
              paddingBottom: 120 + insets.bottom,
            }}
            showsVerticalScrollIndicator
          >
            {blocks.map((block) => {
              if (block.type === "heading") {
                return (
                  <Text
                    key={block.id}
                    style={[styles.chapterHeading, { color: colors.foreground, borderBottomColor: colors.border }]}
                  >
                    {block.text}
                  </Text>
                );
              }
              // Paragraph block
              const isSelected = block.selected;
              const isHint = block.isCandidate && !isSelected;
              return (
                <Pressable
                  key={block.id}
                  onPress={() => toggleBlock(block.id)}
                  style={({ pressed }) => [
                    styles.paragraphBlock,
                    {
                      backgroundColor: isSelected
                        ? colors.primary + "18"
                        : isHint
                          ? "#FF950012"
                          : "transparent",
                      borderColor: isSelected
                        ? colors.primary + "55"
                        : isHint
                          ? "#FF950044"
                          : "transparent",
                      borderWidth: isSelected || isHint ? 1 : 0,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  {(isSelected || isHint) && (
                    <View style={styles.blockBadgeRow}>
                      {isSelected && (
                        <View style={[styles.blockBadge, { backgroundColor: colors.primary }]}>
                          <IconSymbol name="checkmark" size={9} color="#FFF" />
                          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>
                            {zh ? "已选" : "Selected"}
                          </Text>
                        </View>
                      )}
                      {isHint && (
                        <View style={[styles.blockBadge, { backgroundColor: "#FF9500" }]}>
                          <IconSymbol name="sparkles" size={9} color="#FFF" />
                          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "600" }}>
                            {block.candidateConfidence >= 0.7
                              ? (zh ? "高置信配方" : "Recipe")
                              : block.candidateConfidence >= 0.5
                                ? (zh ? "疑似配方" : "Possible recipe")
                                : (zh ? "参考" : "Hint")}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                  <Text
                    style={[
                      styles.paragraphText,
                      {
                        color: isSelected ? colors.primary : colors.foreground,
                        fontWeight: isSelected ? "500" : "400",
                      },
                    ]}
                  >
                    {block.text}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Bottom action bar */}
          <View
            style={[
              styles.readingFooter,
              {
                backgroundColor: colors.background,
                borderTopColor: colors.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            {/* Hint: run local scan first if no candidates yet */}
            {candidateCount === 0 && !scanning && (
              <Pressable
                onPress={() => { tap(); runLocalScan(); }}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <IconSymbol name="magnifyingglass" size={14} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {zh ? "快速检测配方候选" : "Detect recipe candidates"}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={proceedToConfirm}
              disabled={selectedCount === 0}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: selectedCount === 0 ? colors.border : colors.primary,
                  marginTop: 0,
                  alignSelf: "stretch",
                },
                pressed && selectedCount > 0 && { opacity: 0.85 },
              ]}
            >
              <IconSymbol name="square.and.arrow.down.fill" size={17} color="#FFF" />
              <Text style={styles.primaryBtnText}>
                {selectedCount === 0
                  ? (zh ? "点击段落选取配方" : "Tap paragraphs to select")
                  : zh
                    ? `导入选中内容（${selectedCount}）`
                    : `Import selected (${selectedCount})`}
              </Text>
            </Pressable>
            {candidateCount > 0 && selectedCount === 0 && (
              <Pressable
                onPress={() => {
                  tap();
                  // Auto-select all high-confidence candidates
                  setBlocks((prev) =>
                    prev.map((b) => (b.isCandidate && b.candidateConfidence >= 0.5 ? { ...b, selected: true } : b)),
                  );
                }}
                hitSlop={6}
                style={{ alignItems: "center", paddingVertical: 6 }}
              >
                <Text style={{ color: colors.primary, fontSize: 13 }}>
                  {zh ? `选中全部 ${candidateCount} 个候选` : `Select all ${candidateCount} candidates`}
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      {/* ── Confirm ── */}
      {phase === "confirm" && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
              {zh
                ? `${reviewItems.length} 段内容，已选 ${checkedCount} 个`
                : `${reviewItems.length} items · ${checkedCount} selected`}
            </Text>
            {(untranslatedChecked || anyTranslated) && (
              <Pressable onPress={doTranslate} hitSlop={6} disabled={translating}>
                <Text style={{ color: translating ? colors.muted : colors.primary, fontSize: 14, fontWeight: "600" }}>
                  {translating
                    ? (zh ? "翻译中…" : "Translating…")
                    : untranslatedChecked
                      ? (zh ? "AI 翻译" : "AI Translate")
                      : (zh ? "切换原/译文" : "Toggle lang")}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                tap();
                setReviewItems((prev) => {
                  const allChecked = prev.every((r) => r.checked);
                  return prev.map((r) => ({ ...r, checked: !allChecked }));
                });
              }}
              hitSlop={6}
            >
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>
                {reviewItems.every((r) => r.checked) ? (zh ? "全不选" : "None") : zh ? "全选" : "All"}
              </Text>
            </Pressable>
          </View>
          {!!reviewError && (
            <View style={[styles.errorBox, { marginHorizontal: 20, marginBottom: 8 }]}>
              <Text style={{ color: "#FF3B30", fontSize: 12, lineHeight: 17 }}>{reviewError}</Text>
            </View>
          )}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110 }}>
            {reviewItems.map((row) => {
              const c = row.candidate;
              const p = row.showTranslated && row.translated ? row.translated : c.parsed;
              const displayName = p.name || c.name;
              return (
                <View
                  key={row.blockId}
                  style={[
                    styles.reviewCard,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                    !row.checked && { opacity: 0.55 },
                  ]}
                >
                  <Pressable
                    onPress={() => { tap(); updateItem(row.blockId, { checked: !row.checked }); }}
                    style={({ pressed }) => [styles.cardHead, pressed && { opacity: 0.8 }]}
                  >
                    <IconSymbol
                      name={row.checked ? "checkmark.circle.fill" : "circle"}
                      size={22}
                      color={row.checked ? colors.primary : colors.muted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                        {displayName || (zh ? "（未识别到名称）" : "(unnamed)")}
                      </Text>
                      <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                        {p.ingredients.length} {zh ? "种配料" : "ingredients"}
                        {p.glass ? ` · ${p.glass}` : ""}
                        {p.method ? ` · ${p.method}` : ""}
                        {" · "}
                        {Math.round(c.confidence * 100)}%
                      </Text>
                    </View>
                    {row.duplicate && (
                      <View style={[styles.badge, { backgroundColor: "#FF950022" }]}>
                        <Text style={{ color: "#FF9500", fontSize: 11, fontWeight: "600" }}>
                          {zh ? "已存在" : "Exists"}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  {/* Kind switcher */}
                  <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                    {(["cocktail", "prep"] as const).map((k) => {
                      const active = row.kind === k;
                      return (
                        <Pressable
                          key={k}
                          onPress={() => { tap(); updateItem(row.blockId, { kind: k }); }}
                          style={[
                            styles.kindChip,
                            { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.border },
                          ]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#FFF" : colors.muted }}>
                            {k === "cocktail" ? (zh ? "鸡尾酒" : "Cocktail") : (zh ? "自制（糖浆等）" : "Prep")}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <View style={{ flex: 1 }} />
                    {row.translated && (
                      <Pressable onPress={() => { tap(); updateItem(row.blockId, { showTranslated: !row.showTranslated }); }} hitSlop={6} style={{ justifyContent: "center" }}>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>
                          {row.showTranslated ? (zh ? "原文" : "Original") : (zh ? "译文" : "Translated")}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => { tap(); updateItem(row.blockId, { expanded: !row.expanded }); }} hitSlop={6} style={{ justifyContent: "center" }}>
                      <Text style={{ color: colors.primary, fontSize: 12 }}>
                        {row.expanded ? (zh ? "收起" : "Hide") : (zh ? "详情" : "Details")}
                      </Text>
                    </Pressable>
                  </View>
                  {row.expanded && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 12, marginBottom: 4 }}>
                        {zh ? "配料" : "Ingredients"}
                      </Text>
                      {p.ingredients.map((ing) => (
                        <Text key={ing.id} style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>
                          · {ing.name}{ing.amount ? `  ${ing.amount}` : ""}
                        </Text>
                      ))}
                      {!!p.steps && (
                        <>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 10, marginBottom: 4 }}>
                            {zh ? "做法" : "Steps"}
                          </Text>
                          <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{p.steps}</Text>
                        </>
                      )}
                      {!!p.garnish && (
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
                          {zh ? "装饰：" : "Garnish: "}{p.garnish}
                        </Text>
                      )}
                      {!!c.raw && (
                        <>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 10, marginBottom: 4 }}>
                            {zh ? "原文段落" : "Source text"}
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }} numberOfLines={6}>
                            {c.raw}
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable
              onPress={doImport}
              disabled={checkedCount === 0}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: checkedCount === 0 ? colors.border : colors.primary, marginTop: 0, alignSelf: "stretch" },
                pressed && { opacity: 0.85 },
              ]}
            >
              <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFF" />
              <Text style={styles.primaryBtnText}>
                {zh ? `导入所选（${checkedCount}）` : `Import selected (${checkedCount})`}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Done ── */}
      {phase === "done" && importResult && (
        <View style={styles.centerFill}>
          <View style={[styles.bigIcon, { backgroundColor: "#34C759" }]}>
            <IconSymbol name="checkmark" size={30} color="#FFF" />
          </View>
          <Text className="text-xl font-bold text-foreground mt-4">
            {zh ? "导入完成" : "Import complete"}
          </Text>
          <Text className="text-sm text-muted mt-2 text-center">
            {zh
              ? `新增 ${importResult.recipes} 个配方、${importResult.preps} 个自制`
              : `${importResult.recipes} recipes and ${importResult.preps} preps added`}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 24, gap: 12 }}>
            <Pressable
              onPress={() => { tap(); setPhase("reading"); setImportResult(null); }}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: colors.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>
                {zh ? "继续阅读" : "Keep reading"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { tap(); router.back(); }}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, marginTop: 0 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.primaryBtnText}>{zh ? "完成" : "Done"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── AI Scan Range Picker Modal ── */}
      {showRangePicker && (
        <ScanRangePicker
          colors={colors}
          zh={zh}
          chapterCount={blocks.filter((b) => b.type === "heading").length}
          scanRange={scanRange}
          onConfirm={(range) => {
            setScanRange(range);
            setShowRangePicker(false);
            void runAiScan(range ?? undefined);
          }}
          onClose={() => setShowRangePicker(false)}
        />
      )}
    </ScreenContainer>
  );
}

/** AI Scan page range picker overlay */
function ScanRangePicker({
  colors,
  zh,
  chapterCount,
  scanRange,
  onConfirm,
  onClose,
}: {
  colors: ReturnType<typeof useColors>;
  zh: boolean;
  chapterCount: number;
  scanRange: { from: number; to: number } | null;
  onConfirm: (range: { from: number; to: number } | null) => void;
  onClose: () => void;
}) {
  const maxChapters = Math.max(chapterCount, 1);
  const [from, setFrom] = useState(scanRange?.from ?? 1);
  const [to, setTo] = useState(scanRange?.to ?? maxChapters);
  const [mode, setMode] = useState<"all" | "range">(scanRange ? "range" : "all");

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <Pressable
        style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.4)" }]}
        onPress={onClose}
      />
      <View
        style={[
          rangeStyles.sheet,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[rangeStyles.title, { color: colors.foreground }]}>
          {zh ? "AI 扫描范围" : "AI Scan Range"}
        </Text>

        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
          {(["all", "range"] as const).map((m) => {
            const active = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[
                  rangeStyles.modeBtn,
                  { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                ]}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: active ? "#FFF" : colors.muted }}>
                  {m === "all" ? (zh ? "全部章节" : "All sections") : (zh ? "指定范围" : "Custom range")}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode === "range" && (
          <View style={{ gap: 12, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>
              {zh ? `共 ${maxChapters} 个章节` : `${maxChapters} section${maxChapters !== 1 ? "s" : ""} total`}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 14, width: 60 }}>{zh ? "从第" : "From"}</Text>
              <Pressable
                onPress={() => setFrom(Math.max(1, from - 1))}
                style={[rangeStyles.stepper, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={{ fontSize: 18, color: colors.primary }}>−</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, minWidth: 32, textAlign: "center" }}>{from}</Text>
              <Pressable
                onPress={() => setFrom(Math.min(to, from + 1))}
                style={[rangeStyles.stepper, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={{ fontSize: 18, color: colors.primary }}>+</Text>
              </Pressable>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{zh ? "章" : ""}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 14, width: 60 }}>{zh ? "到第" : "To"}</Text>
              <Pressable
                onPress={() => setTo(Math.max(from, to - 1))}
                style={[rangeStyles.stepper, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={{ fontSize: 18, color: colors.primary }}>−</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, minWidth: 32, textAlign: "center" }}>{to}</Text>
              <Pressable
                onPress={() => setTo(Math.min(maxChapters, to + 1))}
                style={[rangeStyles.stepper, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Text style={{ fontSize: 18, color: colors.primary }}>+</Text>
              </Pressable>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{zh ? "章" : ""}</Text>
            </View>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={onClose}
            style={[rangeStyles.btn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={{ color: colors.muted, fontSize: 15, fontWeight: "600" }}>
              {zh ? "取消" : "Cancel"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(mode === "range" ? { from, to } : null)}
            style={[rangeStyles.btn, { backgroundColor: colors.primary, borderColor: colors.primary, flex: 2 }]}
          >
            <IconSymbol name="sparkles" size={15} color="#FFF" />
            <Text style={{ color: "#FFF", fontSize: 15, fontWeight: "600" }}>
              {zh ? "开始扫描" : "Scan"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const rangeStyles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    marginTop: 8,
  },
  bigIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 16,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hintBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FF3B3015",
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  // Reading view
  chapterHeading: {
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 28,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paragraphBlock: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  blockBadgeRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 4,
  },
  blockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  paragraphText: {
    fontSize: 15,
    lineHeight: 24,
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  readingFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // Confirm/Review
  reviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import { useBookStore } from "@/lib/books/store";
import { detectRecipesInText, RecipeCandidate } from "@/lib/import/detect";
import { htmlToText } from "@/lib/import/extract";
import { ParsedRecipe } from "@/lib/recipes/parser";
import { genId, CATEGORY_COLORS, emptySourceRef } from "@/lib/recipes/types";
import { useRecipeStore } from "@/lib/recipes/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { classifyPrepGroup, guessPrepType } from "@/lib/homemade/types";
import { normalizeCodexFamilyDecl } from "@/lib/recipes/lineage";
import { translateRecipes, enrichRecipe as enrichRecipeAI, deepAnalyzeRecipe as deepAnalyzeRecipeAI, extractRecipesFromText } from "@/lib/api/smart-router";

/* ─── Extracted recipe result types ─────────────────────────────────────────── */

interface ExtractedIngredient {
  text: string;
  amount: string;
  unit: string;
  name: string;
  confidence: "high" | "medium" | "low";
}

interface ExtractedRecipe {
  name: string;
  nameZh: string;
  author: string;
  year: string;
  ingredients: ExtractedIngredient[];
  steps: string;
  garnish: string;
  glass: string;
  method: string;
  notes: string;
  confidence: "high" | "medium" | "low";
  missingFields: string[];
}

/* ─── Reading CSS injected into HTML renderer ─────────────────────────────── */

/* ─── Inline EPUB images as base64 to bypass WebView sandbox restrictions ───── */
async function inlineImagesAsBase64(html: string, chapterFilePath: string): Promise<string> {
  // Determine the base directory of the chapter file
  const lastSlash = chapterFilePath.lastIndexOf("/");
  const baseDir = lastSlash >= 0 ? chapterFilePath.slice(0, lastSlash + 1) : "";
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const matches: { full: string; src: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null) {
    matches.push({ full: m[0], src: m[1] });
  }
  if (matches.length === 0) return html;
  let result = html;
  for (const { full, src } of matches) {
    // Skip already-inlined or remote images
    if (src.startsWith("data:") || src.startsWith("http")) continue;
    try {
      const cleanSrc = src.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
      const docDir = FileSystemLegacy.documentDirectory ?? "";
      const booksIdx = baseDir.indexOf("/books/");
      const resolvedBase = booksIdx >= 0 ? docDir + baseDir.slice(booksIdx + 1) : baseDir;
      const imgPath = resolvedBase + cleanSrc;
      const ext = imgPath.split(".").pop()?.toLowerCase() ?? "png";
      const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
      const mime = mimeMap[ext] ?? "image/png";
      const b64 = await FileSystemLegacy.readAsStringAsync(imgPath, { encoding: FileSystemLegacy.EncodingType.Base64 });
      const dataUri = `data:${mime};base64,${b64}`;
      result = result.replace(full, full.replace(src, dataUri));
    } catch {
      // Silently skip unreadable images — never block rendering
    }
  }
  return result;
}

const READER_CSS = `
  /* Base */
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, 'Helvetica Neue', 'Georgia', serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  /* Images */
  img, svg, video {
    display: block;
    max-width: 100% !important;
    width: auto !important;
    height: auto !important;
    margin: 1.2em auto;
    border-radius: 6px;
    float: none !important;
  }
  /* Limit image height so CSS columns can paginate stably; tap to view full size */
  img {
    max-height: 35vh !important;
    object-fit: contain !important;
    cursor: pointer;
    break-inside: avoid;
    page-break-inside: avoid;
    float: none !important;
  }
  figure {
    margin: 1.5em 0;
    text-align: center;
    break-inside: avoid;
    page-break-inside: avoid;
    float: none !important;
    clear: both !important;
    display: block !important;
  }
  /* EPUB 常把图片嵌套在 div/p 中，清除 float 并防止跨列叠加 */
  div:has(> img), p:has(> img), div:has(> figure), p:has(> figure) {
    break-inside: avoid;
    page-break-inside: avoid;
    float: none !important;
    clear: both !important;
    overflow: hidden;
  }
  /* 全局清除所有 float（EPUB 原始排版的 float 在移动端 columns 模式下会叠加乱码） */
  [style*="float"] { float: none !important; clear: both !important; }
  figcaption { font-size: 0.8em; opacity: 0.6; margin-top: 0.4em; font-style: italic; }
  /* Headings */
  h1 { font-size: 1.8em; font-weight: 700; line-height: 1.2; margin: 1.6em 0 0.6em; letter-spacing: -0.02em; }
  h2 { font-size: 1.4em; font-weight: 700; line-height: 1.25; margin: 1.4em 0 0.5em; }
  h3 { font-size: 1.15em; font-weight: 600; line-height: 1.3; margin: 1.2em 0 0.4em; }
  h4, h5, h6 { font-size: 1em; font-weight: 600; line-height: 1.3; margin: 1em 0 0.3em; }
  /* Paragraphs */
  p { margin: 0 0 1em; orphans: 2; widows: 2; }
  /* Lists */
  ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
  li { margin-bottom: 0.3em; line-height: 1.6; }
  li > ul, li > ol { margin-top: 0.3em; margin-bottom: 0; }
  /* Blockquote */
  blockquote {
    margin: 1.2em 0;
    padding: 0.6em 1em;
    border-left: 3px solid rgba(128,128,128,0.4);
    opacity: 0.85;
    font-style: italic;
  }
  /* Tables */
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
  th { font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 2px solid rgba(128,128,128,0.3); }
  td { padding: 7px 10px; border-bottom: 1px solid rgba(128,128,128,0.15); }
  /* Code */
  pre, code { font-family: 'Menlo', 'Courier New', monospace; font-size: 0.85em; }
  pre { padding: 12px; border-radius: 8px; background: rgba(128,128,128,0.1); overflow-x: auto; white-space: pre-wrap; }
  code { background: rgba(128,128,128,0.12); padding: 1px 4px; border-radius: 3px; }
  /* Links */
  a { text-decoration: underline; text-underline-offset: 2px; }
  /* Horizontal rule */
  hr { border: none; border-top: 1px solid rgba(128,128,128,0.25); margin: 1.5em 0; }
  /* EPUB-specific: cover images */
  [epub\\:type="cover"] img, .cover img { border-radius: 0; width: 100% !important; max-width: 100% !important; }
  /* Suppress empty elements */
  p:empty { display: none; }
  /* Custom highlights */
  .recipe-highlight { background: rgba(255,149,0,0.12); border-left: 3px solid #FF9500; padding: 4px 8px; border-radius: 4px; }
  .selected-highlight { background: rgba(0,122,255,0.12); border-left: 3px solid #007AFF; padding: 4px 8px; border-radius: 4px; }
  /* User highlight colors */
  .hl-yellow { background: rgba(255,214,10,0.38) !important; border-radius: 2px; }
  .hl-green  { background: rgba(52,199,89,0.32) !important; border-radius: 2px; }
  .hl-pink   { background: rgba(255,45,85,0.28) !important; border-radius: 2px; }
`;


/* ─── Image viewer modal ──────────────────────────────────────────────────── */
function ImageViewerModal({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" }}
        onPress={onClose}
      >
        <Image
          source={{ uri }}
          style={{ width: width, height: height * 0.85 }}
          resizeMode="contain"
        />
        <View style={{ position: "absolute", top: 48, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 18, fontWeight: "300" }}>✕</Text>
        </View>
      </Pressable>
    </Modal>
  );
}

/* ─── HTML chapter renderer (web-only) ────────────────────────────────────── */

function HtmlChapter({
  html, css, fontSize, lineHeight, theme, onTap,
  extractMode, onSelection, webViewRef, baseUrl, pageFlipMode, onPageInfo,
  onImageTap, onInternalLink,
  fontFamily, margin, letterSpacing, highlights, onHighlight,
}: {
  html: string;
  css: string;
  fontSize: number;
  lineHeight: number;
  theme: 'light' | 'dark' | 'sepia';
  onTap?: () => void;
  extractMode?: boolean;
  onSelection?: (text: string) => void;
  webViewRef?: React.RefObject<InstanceType<typeof WebView> | null>;
  baseUrl?: string;
  pageFlipMode?: boolean;
  onPageInfo?: (info: { totalPages: number }) => void;
  onImageTap?: (uri: string) => void;
  onInternalLink?: (href: string) => void;
  fontFamily?: 'serif' | 'sans' | 'mono';
  margin?: number;
  letterSpacing?: number;
  highlights?: Array<{ id: string; text: string; color: 'yellow' | 'green' | 'pink' }>;
  onHighlight?: (text: string, color: 'yellow' | 'green' | 'pink') => void;
}) {
  const bgColor = theme === 'dark' ? '#1a1a1a' : theme === 'sepia' ? '#F8F0E3' : '#FFFFFF';
  const textColor = theme === 'dark' ? '#E0E0E0' : theme === 'sepia' ? '#3B2F2F' : '#1a1a1a';
  const linkColor = theme === 'dark' ? '#64B5F6' : '#007AFF';
  const fontFamilyCss = fontFamily === 'sans'
    ? `-apple-system, 'Helvetica Neue', sans-serif`
    : fontFamily === 'mono'
    ? `'Menlo', 'Courier New', monospace`
    : `'Georgia', 'Times New Roman', serif`;
  const marginPx = margin ?? 20;
  const letterSpacingCss = letterSpacing ?? 0;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fullHtml = useMemo(() => {
    // eslint-disable-next-line prefer-template
      if (pageFlipMode) {
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>\n<style>\n${READER_CSS}\n${css}\nhtml {\n  overflow: hidden;\n  height: 100vh;\n  width: 100vw;\n}\nbody {\n  font-size: ${fontSize}px;\n  line-height: ${lineHeight};\n  background: ${bgColor};\n  color: ${textColor};\n  margin: 0;\n  padding: 20px 20px 80px 20px;\n  box-sizing: border-box;\n  height: 100vh;\n  overflow: hidden;\n  -webkit-text-size-adjust: none;\n  word-wrap: break-word;\n  overflow-wrap: break-word;\n  columns: 1;\n  column-width: calc(100vw - 40px);\n  column-gap: 40px;\n}\na { color: ${linkColor}; }\nimg { max-width: 100% !important; height: auto !important; break-inside: avoid; page-break-inside: avoid; max-height: 35vh !important; display: block !important; float: none !important; }\nfigure, div:has(> img), p:has(> img), div:has(> figure), p:has(> figure) { break-inside: avoid; page-break-inside: avoid; float: none !important; clear: both !important; display: block !important; }\n[style*="float"] { float: none !important; clear: both !important; }\n* { max-width: 100% !important; }\npre, code { white-space: pre-wrap; font-size: 0.9em; break-inside: avoid; }\nh1,h2,h3,h4,h5,h6 { break-after: avoid; }\n</style>\n</head>\n<body>${html}</body>\n</html>`;
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>\n<style>\n${READER_CSS}\n${css}\nhtml {\n  overflow: hidden;\n  height: 100vh;\n  width: 100vw;\n}\nbody {\n  font-size: ${fontSize}px;\n  line-height: ${lineHeight};\n  font-family: ${fontFamilyCss};\n  letter-spacing: ${letterSpacingCss}px;\n  background: ${bgColor};\n  color: ${textColor};\n  margin: 0;\n  padding: ${marginPx}px ${marginPx}px 80px ${marginPx}px;\n  box-sizing: border-box;\n  height: 100vh;\n  overflow: hidden;\n  -webkit-text-size-adjust: none;\n  word-wrap: break-word;\n  overflow-wrap: break-word;\n  columns: 1;\n  column-width: calc(100vw - ${marginPx * 2}px);\n  column-gap: ${marginPx * 2}px;\n}\na { color: ${linkColor}; }\nimg { max-width: 100% !important; height: auto !important; break-inside: avoid; page-break-inside: avoid; max-height: 35vh !important; display: block !important; float: none !important; }\nfigure, div:has(> img), p:has(> img), div:has(> figure), p:has(> figure) { break-inside: avoid; page-break-inside: avoid; float: none !important; clear: both !important; display: block !important; }\n[style*="float"] { float: none !important; clear: both !important; }\n* { max-width: 100% !important; }\npre, code { white-space: pre-wrap; font-size: 0.9em; break-inside: avoid; }\nh1,h2,h3,h4,h5,h6 { break-after: avoid; }\n</style>\n</head>\n<body>${html}</body>\n</html>`;
    }
    return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=2.0"/>\n<style>\n${READER_CSS}\n${css}\nhtml, body {\n  font-size: ${fontSize}px;\n  line-height: ${lineHeight};\n  font-family: ${fontFamilyCss};\n  letter-spacing: ${letterSpacingCss}px;\n  background: ${bgColor};\n  color: ${textColor};\n  padding: 0 ${marginPx}px 80px ${marginPx}px;\n  margin: 0;\n  -webkit-text-size-adjust: none;\n  word-wrap: break-word;\n  overflow-wrap: break-word;\n}\na { color: ${linkColor}; }\nimg { max-width: 100% !important; height: auto !important; }\n* { max-width: 100% !important; }\npre, code { white-space: pre-wrap; font-size: 0.9em; }\n</style>\n</head>\n<body>${html}</body>\n</html>`;
  }, [html, css, fontSize, lineHeight, bgColor, textColor, linkColor, pageFlipMode, fontFamilyCss, letterSpacingCss, marginPx]);

  const injectedScript = `
    document.addEventListener('click', function() {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tap' }));
    });
    true;
  `;
  // Single stable script injected once — always includes tap + debounced selection.
  // We always inject the combined script so extractMode changes do NOT reload the WebView.
  // The onMessage handler below decides whether to forward selection events.
  const combinedScript = `
    (function() {
      if (window.__rn_injected) return;
      window.__rn_injected = true;
      var _selTimer = null;
      document.addEventListener('selectionchange', function() {
        if (_selTimer) clearTimeout(_selTimer);
        _selTimer = setTimeout(function() {
          var text = window.getSelection ? window.getSelection().toString() : '';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'selection', text: text }));
          }
        }, 300);
      });
      // Image tap: open full-screen viewer
      document.addEventListener('click', function(e) {
        var target = e.target;
        // Walk up to find img or anchor
        var el = target;
        while (el && el.tagName) {
          if (el.tagName === 'IMG') {
            e.preventDefault();
            e.stopPropagation();
            var src = el.src || el.getAttribute('src') || '';
            if (src && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'imageTap', src: src }));
            }
            return;
          }
          if (el.tagName === 'A') {
            var href = el.getAttribute('href') || '';
            // Internal links: relative paths, anchors, or epub: scheme
            if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) {
              e.preventDefault();
              e.stopPropagation();
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'internalLink', href: href }));
              }
              return;
            }
            break;
          }
          el = el.parentElement;
        }
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tap' }));
        }
      });
      // Long-press highlight menu
      var _lpTimer = null;
      var _lpStartX = 0, _lpStartY = 0;
      document.addEventListener('touchstart', function(e) {
        _lpStartX = e.touches[0].clientX; _lpStartY = e.touches[0].clientY;
        _lpTimer = setTimeout(function() {
          var sel = window.getSelection ? window.getSelection().toString().trim() : '';
          if (sel.length > 0 && window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'longPressSelection', text: sel }));
          }
        }, 600);
      }, { passive: true });
      document.addEventListener('touchmove', function(e) {
        if (_lpTimer && (Math.abs(e.touches[0].clientX - _lpStartX) > 8 || Math.abs(e.touches[0].clientY - _lpStartY) > 8)) {
          clearTimeout(_lpTimer); _lpTimer = null;
        }
      }, { passive: true });
      document.addEventListener('touchend', function() { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } }, { passive: true });
      // Apply highlights from RN
      window.__applyHighlights = function(hls) {
        document.querySelectorAll('.hl-yellow,.hl-green,.hl-pink').forEach(function(el) {
          var parent = el.parentNode; while (el.firstChild) parent.insertBefore(el.firstChild, el); parent.removeChild(el);
        });
        if (!hls || hls.length === 0) return;
        hls.forEach(function(h) {
          var text = h.text; var cls = 'hl-' + h.color; if (!text) return;
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
          var node;
          while ((node = walker.nextNode())) {
            var idx = node.nodeValue.indexOf(text);
            if (idx >= 0) {
              var range = document.createRange();
              range.setStart(node, idx); range.setEnd(node, idx + text.length);
              var span = document.createElement('span'); span.className = cls;
              try { range.surroundContents(span); } catch(e) {}
              break;
            }
          }
        });
      };
    })();
    true;
  `;

  // Page-flip mode: JS to calculate total pages and expose navigation API
  const pageFlipScript = pageFlipMode ? `
    (function() {
      if (window.__pf_injected) return;
      window.__pf_injected = true;
      function calcPages() {
        var w = window.innerWidth;
        if (!w) return 1;
        // Use scrollWidth of documentElement for more accurate column count
        var sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        return Math.max(1, Math.round(sw / w));
      }
      function sendPageInfo() {
        var total = calcPages();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pageInfo', totalPages: total }));
      }
      // Fire after images and fonts load for accurate measurement
      window.addEventListener('load', function() { setTimeout(sendPageInfo, 300); });
      document.addEventListener('DOMContentLoaded', function() { setTimeout(sendPageInfo, 300); });
      // Re-measure if layout changes (e.g. images load late)
      window.addEventListener('resize', function() { setTimeout(sendPageInfo, 100); });
      window.__goToPage = function(idx) {
        var targetX = idx * window.innerWidth;
        document.documentElement.scrollLeft = targetX;
        document.body.scrollLeft = targetX;
      };
      window.__getCurrentPage = function() {
        var scrollX = document.documentElement.scrollLeft || document.body.scrollLeft || window.scrollX || 0;
        return Math.round(scrollX / window.innerWidth);
      };
      window.__getTotalPages = calcPages;
      // Scroll events: report current page back to RN
      var _scrollTimer = null;
      function onScroll() {
        if (_scrollTimer) clearTimeout(_scrollTimer);
        _scrollTimer = setTimeout(function() {
          var page = window.__getCurrentPage();
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pageScroll', page: page }));
        }, 80);
      }
      document.addEventListener('scroll', onScroll, { passive: true });
    })();
    true;
  ` : '';

  if (Platform.OS === "web") {
    return (
      <div
        style={{ fontSize, lineHeight: 1.75 }}
        // eslint-disable-next-line react-native/no-inline-styles
        dangerouslySetInnerHTML={{ __html: fullHtml }}
      />
    );
  }

  // Native: use WebView for full fidelity rendering
  return (
    <WebView
      ref={webViewRef}
      source={baseUrl ? { html: fullHtml, baseUrl } : { html: fullHtml }}
      style={{ flex: 1, backgroundColor: bgColor }}
      scrollEnabled={!pageFlipMode}
      showsVerticalScrollIndicator={false}
      originWhitelist={["*"]}
      allowFileAccess={true}
      allowUniversalAccessFromFileURLs={true}
      mixedContentMode="always"
      javaScriptEnabled={true}
      domStorageEnabled={false}
      cacheEnabled={false}
      injectedJavaScript={combinedScript + (pageFlipMode ? pageFlipScript : '')}
      onMessage={(event) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === 'tap' && onTap) onTap();
          // Only forward selection events when in extract mode to avoid unnecessary state updates
          if (msg.type === 'selection' && extractMode && onSelection) onSelection(msg.text ?? '');
          if (msg.type === 'pageInfo' && onPageInfo) onPageInfo({ totalPages: msg.totalPages ?? 1 });
          if (msg.type === 'imageTap' && onImageTap && msg.src) onImageTap(msg.src);
          if (msg.type === 'internalLink' && onInternalLink && msg.href) onInternalLink(msg.href);
          if (msg.type === 'pageScroll' && typeof msg.page === 'number') {
            // This is inside HtmlChapter — no-op here, handled in parent via onPageInfo
          }
          if (msg.type === 'longPressSelection' && msg.text && onHighlight) {
            onHighlight(msg.text, 'yellow');
          }
        } catch {}
      }}
      onShouldStartLoadWithRequest={(req) => {
        // Allow initial load (about:blank / about:srcdoc / data: / file:// / blob:)
        // Block external http/https — those are handled via internalLink message above
        const u = req.url;
        if (u === "about:blank" || u === "about:srcdoc") return true;
        if (u.startsWith("data:") || u.startsWith("file://") || u.startsWith("blob:")) return true;
        // Block all external navigation (handled by JS click handler above)
        return false;
      }}
    />
  );
}

/* ─── Paragraph-range selection state ─────────────────────────────────────── */

interface TextBlock {
  id: string;
  text: string;
  isCandidate: boolean;
  confidence: number;
  candidate?: RecipeCandidate;
  selected: boolean;
}

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

const isAscii = (s: string) => /^[\x00-\x7F]+$/.test(s);

type Phase = "reading" | "select" | "confirm" | "done";

/* ─── Main screen ──────────────────────────────────────────────────────────── */

export default function BookReaderScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang, t } = useI18n();
  const insets = useSafeAreaInsets();
  const zh = lang === "zh";
  const { id } = useLocalSearchParams<{ id: string }>();

  /* Prevent setState-after-unmount in async AI callbacks */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const { books, loadChapter, updatePosition } = useBookStore();
  const book = books.find((b) => b.id === id);

  const { addRecipe, updateRecipe, recipes, tagsOf, addTag, addRecipes } = useRecipeStore();
  const { addPrep, preps, sections, types } = useHomemadeStore();
  const spiritTagsBook = tagsOf("spirit");
  const glassTagsBook = tagsOf("glass");
  const spiritNamesBook = spiritTagsBook.map((t) => t.name);
  const glassNamesBook = glassTagsBook.map((t) => t.name);
  const ensureSpiritNameBook = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = spiritNamesBook.find((s) => cleaned.includes(s) || s.includes(cleaned));
    if (hit) return hit;
    const created = addTag("spirit", cleaned, CATEGORY_COLORS[0]);
    return created?.name ?? cleaned;
  };
  const ensureGlassNameBook = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = glassNamesBook.find((g) => cleaned.includes(g) || g.includes(cleaned));
    if (hit) return hit;
    const created = addTag("glass", cleaned, CATEGORY_COLORS[3]);
    return created?.name ?? cleaned;
  };




  const { isOnline } = useNetwork();

  /* Chapter navigation */
  const [chapterIdx, setChapterIdx] = useState(book?.lastChapter ?? 0);
  const [chapterHtml, setChapterHtml] = useState<string | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  /* Reader settings */
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.75);
  const [theme, setTheme] = useState<'light' | 'dark' | 'sepia'>('light');
  const [showReaderSettings, setShowReaderSettings] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans' | 'mono'>('serif');
  const [margin, setMargin] = useState<number>(20);
  const [letterSpacing, setLetterSpacing] = useState<number>(0);
  const [highlights, setHighlights] = useState<Array<{ id: string; text: string; color: 'yellow' | 'green' | 'pink'; chapterIdx: number }>>([]);
  const [highlightMenu, setHighlightMenu] = useState<{ text: string } | null>(null);
  const SETTINGS_KEY = `cocktail.reader.settings.v1.${id}`;
  const HIGHLIGHTS_KEY = `cocktail.reader.highlights.v1.${id}`;

  /* Page-flip mode (swipe left/right to change chapter) */
  const [pageFlipMode, setPageFlipMode] = useState(true);
  const { width: screenWidth } = useWindowDimensions();
  const swipeTranslateX = useSharedValue(0);
  const swipeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeTranslateX.value }],
  }));

  /* True page-flip: page index within current chapter */
  const [currentPage, setCurrentPage] = useState(book?.lastPage ?? 0);
  // Refs for gesture callbacks — avoid stale closure values that cause page jumps
  const currentPageRef = useRef(book?.lastPage ?? 0);
  const totalPagesRef = useRef(1);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPageInChapter, setCurrentPageInChapter] = useState(book?.lastPage ?? 0);
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);


  /* Chrome visibility (tap to hide/show) */
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Navigation history for "back to previous location" after internal link jumps */
  const [navHistory, setNavHistory] = useState<{ chapterIdx: number; page: number }[]>([]);

  /* Selection mode */
  const [phase, setPhase] = useState<Phase>("reading");
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [scanning, setScanning] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [importResult, setImportResult] = useState<{ recipes: number; preps: number } | null>(null);
  const [reviewError, setReviewError] = useState("");

  /* WebView selection extract mode */
  const [extractMode, setExtractMode] = useState(false);
  const extractModeRef = useRef(false); // Ref to access extractMode in callbacks without re-creating them
  const [selectedText, setSelectedText] = useState("");
  // 跨页累积：换页时 WebView selection 被清空，但已选文字保留在 selectedText 中
  const appendModeRef = useRef(false);
  const [extractError, setExtractError] = useState("");
  const [extractResults, setExtractResults] = useState<ExtractedRecipe[]>([]);
  const [showExtractResults, setShowExtractResults] = useState(false);
  const [importedRecipeIds, setImportedRecipeIds] = useState<Set<number>>(new Set());
  const [batchImporting, setBatchImporting] = useState(false);
  // Multi-select state for extract results panel
  const [selectedExtractIds, setSelectedExtractIds] = useState<Set<number>>(new Set());
  const [extractSelectMode, setExtractSelectMode] = useState(false);
  const webViewRef = useRef<InstanceType<typeof WebView> | null>(null);

  /* Auto-save reading position every 30s */
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
      autoSaveTimer.current = setInterval(() => {
        if (book && phase === 'reading') {
          updatePosition(book.id, chapterIdx, chapterIdx, currentPageRef.current);
        }
    }, 30000);
    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
  }, [book, chapterIdx, phase, updatePosition]);

  /* Load reader settings from AsyncStorage on mount */
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (s.fontSize) setFontSize(s.fontSize);
        if (s.lineHeight) setLineHeight(s.lineHeight);
        if (s.theme) setTheme(s.theme);
        if (s.fontFamily) setFontFamily(s.fontFamily);
        if (s.margin !== undefined) setMargin(s.margin);
        if (s.letterSpacing !== undefined) setLetterSpacing(s.letterSpacing);
      } catch {}
    });
    AsyncStorage.getItem(HIGHLIGHTS_KEY).then((raw) => {
      if (!raw) return;
      try { setHighlights(JSON.parse(raw)); } catch {}
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Persist settings whenever they change */
  useEffect(() => {
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ fontSize, lineHeight, theme, fontFamily, margin, letterSpacing }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize, lineHeight, theme, fontFamily, margin, letterSpacing]);

  /* Persist highlights whenever they change */
  useEffect(() => {
    AsyncStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(highlights));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  /* Inject highlights into WebView after chapter loads */
  useEffect(() => {
    if (!webViewRef.current) return;
    const chHL = highlights.filter((h) => h.chapterIdx === chapterIdx);
    const script = `window.__applyHighlights && window.__applyHighlights(${JSON.stringify(chHL)}); true;`;
    const timer = setTimeout(() => { webViewRef.current?.injectJavaScript(script); }, 700);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterHtml, chapterIdx, highlights]);

  /* Progress bar drag */
  const progressBarWidth = useRef(0);
  const progressPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const total = book?.sections.length ?? 1;
      const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / (progressBarWidth.current || 1)));
      const target = Math.floor(ratio * total);
      setChapterIdx(Math.max(0, Math.min(total - 1, target)));
      setCurrentPage(0);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onPanResponderMove: (e) => {
      const total = book?.sections.length ?? 1;
      const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / (progressBarWidth.current || 1)));
      const target = Math.floor(ratio * total);
      setChapterIdx(Math.max(0, Math.min(total - 1, target)));
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [book]);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /* Load chapter HTML */
  useEffect(() => {
    if (!book) return;
    setLoadingChapter(true);
    setChapterHtml(null);
    setCurrentPage(0);
    setTotalPages(1);

    if (book.hasHtml) {
      loadChapter(book.id, chapterIdx).then((html) => {
        setChapterHtml(html ?? "<p>(空章节)</p>");
        setLoadingChapter(false);
      });
    } else if (book.hasFileSystem && book.sections[chapterIdx]?.text) {
      // File-system book: read HTML from local file
      // Rebuild path using current documentDirectory in case app sandbox UUID changed after update
      const rawPath = book.sections[chapterIdx].text;
      if (Platform.OS !== "web") {
        const docDir = FileSystemLegacy.documentDirectory ?? "";
        const booksIdx = rawPath.indexOf("/books/");
        const resolvedPath = booksIdx >= 0 ? docDir + rawPath.slice(booksIdx + 1) : rawPath;
        const tryRead = (path: string) =>
          FileSystemLegacy.readAsStringAsync(path, { encoding: FileSystemLegacy.EncodingType.UTF8 })
            .then((html) => {
              const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              return bodyMatch ? bodyMatch[1] : html;
            });
        tryRead(resolvedPath)
          .catch(() => tryRead(rawPath))
          .then((html) => {
            // Inline images as base64 to bypass WebView sandbox restrictions
            const chapterFilePath = book.sections[chapterIdx].text;
            inlineImagesAsBase64(html, chapterFilePath).then((inlined) => {
              setChapterHtml(inlined);
              setLoadingChapter(false);
            });
          })
          .catch(() => {
            setChapterHtml("<p>章节文件读取失败，请重新导入书籍</p>");
            setLoadingChapter(false);
          });
      } else {
        setChapterHtml("<p>文件系统阅读仅支持 iOS/Android</p>");
        setLoadingChapter(false);
      }
    } else {
      // Legacy plain-text book: render as paragraphs
      const section = book.sections[chapterIdx];
      setChapterHtml(null);
      setLoadingChapter(false);
      if (section) {
        // Build minimal HTML from plain text
        const html = section.text
          .split(/\n+/)
          .filter((l) => l.trim())
          .map((l) => `<p>${l.trim()}</p>`)
          .join("\n");
        setChapterHtml(html);
      }
    }
  }, [book, chapterIdx, loadChapter]);

  /* Persist position when chapter changes */
  useEffect(() => {
    if (book) updatePosition(book.id, 0, chapterIdx);
  }, [chapterIdx]);

  /* Auto-hide chrome after 4s */
  /* Page-flip gesture (swipe left = next chapter, swipe right = prev chapter) */
  /** Handle internal EPUB link: parse chapter file + anchor, jump to chapter */
  const handleInternalLink = useCallback((href: string) => {
    if (!book) return;
    // Strip leading ../  or ./ to get the filename
    const clean = href.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
    // Split anchor
    const [filePart, anchor] = clean.split("#");
    const fileName = filePart.split("/").pop() ?? filePart;
    // Find matching chapter by filePath
    const idx = book.sections.findIndex((s) => {
      const fp = s.text ?? "";
      return fp.endsWith("/" + fileName) || fp === fileName || fp.endsWith(filePart);
    });
    if (idx >= 0 && idx !== chapterIdx) {
      setChapterIdx(idx);
      setCurrentPage(0);
      setCurrentPageInChapter(0);
      // TODO: scroll to anchor after chapter loads
    } else if (anchor && idx === chapterIdx) {
      // Same chapter, scroll to anchor
      webViewRef.current?.injectJavaScript(
        `(function(){ var el = document.getElementById('${anchor}') || document.querySelector('[name="${anchor}"]'); if(el) el.scrollIntoView({behavior:'smooth'}); })(); true;`
      );
    }
  }, [book, chapterIdx, webViewRef]);

  const goNextChapter = useCallback(() => {
    if (chapterIdx < (book?.sections.length ?? 1) - 1) {
      setChapterIdx((i) => i + 1);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [chapterIdx, book]);

  const goPrevChapter = useCallback(() => {
    if (chapterIdx > 0) {
      setChapterIdx((i) => i - 1);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [chapterIdx]);

  /* Navigate within current chapter pages (page-flip mode) */
  const goNextPage = useCallback(() => {
    if (currentPageRef.current < totalPagesRef.current - 1) {
      const nextPage = currentPageRef.current + 1;
      setCurrentPage(nextPage);
      currentPageRef.current = nextPage;
      webViewRef.current?.injectJavaScript(`window.__goToPage && window.__goToPage(${nextPage}); true;`);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      goNextChapter();
    }
  }, [goNextChapter]);

  const goPrevPage = useCallback(() => {
    if (currentPageRef.current > 0) {
      const prevPage = currentPageRef.current - 1;
      setCurrentPage(prevPage);
      currentPageRef.current = prevPage;
      webViewRef.current?.injectJavaScript(`window.__goToPage && window.__goToPage(${prevPage}); true;`);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      goPrevChapter();
    }
  }, [goPrevChapter]);

  const pageFlipGesture = useMemo(() => {
    const disabled = !pageFlipMode || Platform.OS === "web";
    if (disabled) {
      return Gesture.Pan().enabled(false);
    }
    return Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-20, 20])
      .failOffsetY([-15, 15])
      .onUpdate((e) => {
        // Provide live drag feedback (capped at ±screenWidth/3)
        // Only animate the outer container when single-page chapters (multi-page: WebView handles internal scroll)
        if (totalPages <= 1) {
          const maxDrag = screenWidth / 3;
          swipeTranslateX.value = Math.max(-maxDrag, Math.min(maxDrag, e.translationX));
        }
      })
      .onEnd((e) => {
        const THRESHOLD = 60;
        const VELOCITY_THRESHOLD = 300;
        const shouldFlip =
          Math.abs(e.translationX) > THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;
        if (shouldFlip) {
          const dir = e.translationX < 0 ? 1 : -1;
          if (totalPagesRef.current > 1) {
            // Page-level navigation within chapter
            if (dir > 0) runOnJS(goNextPage)();
            else runOnJS(goPrevPage)();
          } else {
            // Chapter-level navigation (single-page chapter)
            const targetX = dir * screenWidth;
            swipeTranslateX.value = withTiming(targetX, { duration: 180 }, () => {
              swipeTranslateX.value = 0;
              if (dir > 0) runOnJS(goNextChapter)();
              else runOnJS(goPrevChapter)();
            });
          }
        } else {
          // Snap back
          swipeTranslateX.value = withTiming(0, { duration: 150 });
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFlipMode, screenWidth, totalPages, goNextChapter, goPrevChapter, goNextPage, goPrevPage]);

  const showChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    // Don't auto-hide when in extract mode — user needs the extract bar visible
    if (!extractModeRef.current) {
      chromeTimer.current = setTimeout(() => setChromeVisible(false), 4000);
    }
  }, []);

  const handleTap = useCallback(() => {
    if (phase !== "reading") return;
    showChrome();
  }, [phase, showChrome]);

  useEffect(() => {
    showChrome();
    return () => { if (chromeTimer.current) clearTimeout(chromeTimer.current); };
  }, []);

  const totalChapters = book?.sections.length ?? 0;
  const progress = totalChapters > 0 ? (chapterIdx + 1) / totalChapters : 0;

  /* ── Selection mode: build text blocks from current chapter ── */
  const enterSelectMode = useCallback(() => {
    tap();
    const html = chapterHtml ?? "";
    const text = htmlToText(html);
    const paras = text.split(/\n+/).filter((l) => l.trim().length > 10);
    const newBlocks: TextBlock[] = paras.map((p) => ({
      id: genId(),
      text: p.trim(),
      isCandidate: false,
      confidence: 0,
      selected: false,
    }));
    // Quick local scan
    const fullText = paras.join("\n\n");
    const candidates = detectRecipesInText(fullText, book?.sections[chapterIdx]?.title ?? "");
    for (const cand of candidates) {
      const rawLower = cand.raw.toLowerCase();
      let bestIdx = -1, bestScore = 0;
      for (let i = 0; i < newBlocks.length; i++) {
        const words = rawLower.split(/\s+/).filter((w) => w.length > 3);
        let overlap = 0;
        for (const w of words) if (newBlocks[i].text.toLowerCase().includes(w)) overlap++;
        const score = words.length > 0 ? overlap / words.length : 0;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestScore > 0.25) {
        newBlocks[bestIdx] = { ...newBlocks[bestIdx], isCandidate: true, confidence: cand.confidence, candidate: cand };
      }
    }
    setBlocks(newBlocks);
    setPhase("select");
  }, [chapterHtml, book, chapterIdx]);

  const toggleBlock = useCallback((blockId: string) => {
    tap();
    setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, selected: !b.selected } : b));
  }, []);

  const selectedCount = blocks.filter((b) => b.selected).length;
  const candidateCount = blocks.filter((b) => b.isCandidate).length;

  /* ── WebView selection extract mode ── */
  const enterExtractMode = useCallback(() => {
    tap();
    extractModeRef.current = true;
    setExtractMode(true);
    setSelectedText("");
    appendModeRef.current = false;
    setExtractError("");
    setExtractResults([]);
    setShowExtractResults(false);
    // Do NOT call showChrome() here — it triggers a 4s timer that hides the extract bar
    // and causes unnecessary state updates that reload the WebView
    setChromeVisible(true);
  }, []);

  const exitExtractMode = useCallback(() => {
    tap();
    extractModeRef.current = false;
    setExtractMode(false);
    setSelectedText("");
    appendModeRef.current = false;
    setExtractError("");
    setShowExtractResults(false);
    setSelectedExtractIds(new Set());
    setExtractSelectMode(false);
    setExtractResults([]);
  }, []);

  /** Quick-save a single extracted recipe directly to store (no navigation) */
  const quickSaveRecipe = useCallback((recipe: ExtractedRecipe, idx: number) => {
    tap();
    const source = book?.title ?? "";
    const name = recipe.nameZh || recipe.name || (zh ? "未命名配方" : "Untitled recipe");
    const nameEn = recipe.name && recipe.name !== name ? recipe.name : "";
    const draft = {
      name,
      nameEn,
      categoryId: null,
      baseSpirit: recipe.ingredients.length > 0 ? ensureSpiritNameBook(recipe.ingredients[0]?.name ?? "") : "",
      glass: recipe.glass ? ensureGlassNameBook(recipe.glass) : "",
      method: recipe.method || "",
      strength: "medium" as const,
      variantOf: "",
      codexFamily: "",
      flavors: [],
      source,
      story: "",
      flavorDesc: "",
      ingredients: recipe.ingredients.map((ing) => ({
        id: genId(),
        name: ing.name,
        amount: ing.amount ? `${ing.amount}${ing.unit ?? ""}` : "",
        unit: "",
        notes: "",
      })),
      steps: recipe.steps,
      garnish: recipe.garnish,
      notes: recipe.notes,
    };
    const newRecipe = addRecipe({ ...draft, sourceRef: { ...emptySourceRef(), bookTitle: source, sourceConfidence: "high" as const } });
    setImportedRecipeIds((prev) => new Set([...prev, idx]));
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // 串联 enrichRecipe → deepAnalyzeRecipe（后台静默，不阻塞 UI）
    const ingNames = draft.ingredients.map((ing) => ing.name).filter(Boolean);
    void (async () => {
      try {
        const result = await enrichRecipeAI({ name: draft.name, nameEn: draft.nameEn || undefined, baseSpirit: draft.baseSpirit || undefined, ingredients: ingNames.length > 0 ? ingNames : undefined, bookTitle: source || undefined });
        if (!isMountedRef.current) return;
        const patch: Record<string, unknown> = {};
        if (result.flavors.length > 0) patch.flavors = result.flavors;
        if (result.story) patch.story = result.story;
        if (result.flavorDesc) patch.flavorDesc = result.flavorDesc;
        if (result.creator || result.createdYear) {
          patch.sourceRef = { ...emptySourceRef(), bookTitle: source, sourceConfidence: "high" as const, creator: result.creator || "", createdYear: result.createdYear || "", creatorConfidence: result.creatorConfidence };
        }
        if (Object.keys(patch).length > 0) updateRecipe(newRecipe.id, { ...draft, ...patch });
        try {
          const deepResult = await deepAnalyzeRecipeAI({ name: draft.name || undefined, nameEn: draft.nameEn || undefined, ingredients: ingNames.length > 0 ? ingNames.join(", ") : undefined, baseSpirit: draft.baseSpirit || undefined, source: draft.source || undefined });
          if (!isMountedRef.current) return;
          const deepPatch: Record<string, unknown> = {};
          if (deepResult.story) deepPatch.story = deepResult.story;
          if (deepResult.flavorDesc) deepPatch.flavorDesc = deepResult.flavorDesc;
          if (deepResult.flavors && deepResult.flavors.length > 0 && (result.flavors ?? []).length === 0) deepPatch.flavors = deepResult.flavors;
          if (deepResult.suggestedCodexFamily && !draft.codexFamily) { const n = normalizeCodexFamilyDecl(deepResult.suggestedCodexFamily); if (n) deepPatch.codexFamily = n; }
          if (deepResult.suggestedMethod && !draft.method) deepPatch.method = deepResult.suggestedMethod;
          if (deepResult.suggestedVariantOf && !draft.variantOf) deepPatch.variantOf = deepResult.suggestedVariantOf;
          if (deepResult.creator || deepResult.createdYear) {
            const currentRef = (patch.sourceRef as ReturnType<typeof emptySourceRef> | undefined) ?? { ...emptySourceRef(), bookTitle: source, sourceConfidence: "high" as const };
            if (!currentRef.creator && deepResult.creator) {
              deepPatch.sourceRef = { ...currentRef, creator: deepResult.creator, createdYear: deepResult.createdYear || currentRef.createdYear, creatorConfidence: "medium" as const };
            }
          }
          if (Object.keys(deepPatch).length > 0) updateRecipe(newRecipe.id, { ...draft, ...patch, ...deepPatch });
        } catch { /* ignore deep analyze errors */ }
      } catch { /* ignore enrich errors */ }
    })();
  }, [book, zh, addRecipe, updateRecipe, ensureSpiritNameBook, ensureGlassNameBook]);

  /** Batch import all extracted recipes at once */
  const batchImportAll = useCallback(() => {
    tap();
    const targetIds = extractSelectMode && selectedExtractIds.size > 0
      ? selectedExtractIds
      : new Set(extractResults.map((_, i) => i));
    if (batchImporting || targetIds.size === 0) return;
    setBatchImporting(true);
    const source = book?.title ?? "";
    // Build all drafts first, then write atomically to avoid async state race
    const pendingIdxs: number[] = [];
    const drafts: Array<{ name: string; nameEn: string; categoryId: null; baseSpirit: string; glass: string; method: string; strength: "medium"; variantOf: string; codexFamily: string; flavors: string[]; source: string; story: string; flavorDesc: string; ingredients: Array<{ id: string; name: string; amount: string; unit: string; notes: string }>; steps: string; garnish: string; notes: string }> = [];
    for (const idx of targetIds) {
      if (importedRecipeIds.has(idx)) continue;
      const recipe = extractResults[idx];
      if (!recipe) continue;
      const name = recipe.nameZh || recipe.name || (zh ? "未命名配方" : "Untitled recipe");
      const nameEn = recipe.name && recipe.name !== name ? recipe.name : "";
      drafts.push({
        name,
        nameEn,
        categoryId: null,
        baseSpirit: recipe.ingredients.length > 0 ? ensureSpiritNameBook(recipe.ingredients[0]?.name ?? "") : "",
        glass: recipe.glass ? ensureGlassNameBook(recipe.glass) : "",
        method: recipe.method || "",
        strength: "medium" as const,
        variantOf: "",
        codexFamily: "",
        flavors: [],
        source,
        story: "",
        flavorDesc: "",
        ingredients: recipe.ingredients.map((ing) => ({
          id: genId(),
          name: ing.name,
          amount: ing.amount ? `${ing.amount}${ing.unit ?? ""}` : "",
          unit: "",
          notes: "",
        })),
        steps: recipe.steps,
        garnish: recipe.garnish,
        notes: recipe.notes,
      });
      pendingIdxs.push(idx);
    }
    const { added, skippedNames } = addRecipes(drafts);
    const newIds = new Set(importedRecipeIds);
    // Mark all pending as imported (even skipped ones, since they already exist)
    for (const idx of pendingIdxs) newIds.add(idx);
    setImportedRecipeIds(newIds);
    setBatchImporting(false);
    // Show summary toast
    const msg = skippedNames.length > 0
      ? (zh
          ? `已导入 ${added.length} 个，跳过 ${skippedNames.length} 个重复配方`
          : `Imported ${added.length}, skipped ${skippedNames.length} duplicates`)
      : (zh
          ? `已导入 ${added.length} 个配方`
          : `Imported ${added.length} recipes`);
    Alert.alert(zh ? "导入完成" : "Import Complete", msg);
    if (extractSelectMode) {
      setSelectedExtractIds(new Set());
      setExtractSelectMode(false);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // 批量导入后串联 enrichRecipe + deepAnalyzeRecipe（后台静默，不阻塞 UI）
    added.forEach((newRecipe, i) => {
      const draft = drafts[i];
      if (!newRecipe || !draft) return;
      const ingNames = (draft.ingredients as Array<{ name: string }>).map((ing) => ing.name).filter(Boolean);
      void (async () => {
        try {
          const result = await enrichRecipeAI({ name: draft.name, nameEn: draft.nameEn || undefined, baseSpirit: draft.baseSpirit || undefined, ingredients: ingNames.length > 0 ? ingNames : undefined, bookTitle: source || undefined });
          if (!isMountedRef.current) return;
          const patch: Record<string, unknown> = {};
          if (result.flavors.length > 0) patch.flavors = result.flavors;
          if (result.story) patch.story = result.story;
          if (result.flavorDesc) patch.flavorDesc = result.flavorDesc;
          if (result.creator || result.createdYear) {
            patch.sourceRef = { ...emptySourceRef(), bookTitle: source, sourceConfidence: "high" as const, creator: result.creator || "", createdYear: result.createdYear || "", creatorConfidence: result.creatorConfidence };
          }
          if (Object.keys(patch).length > 0) updateRecipe(newRecipe.id, { ...draft, ...patch });
          try {
            const deepResult = await deepAnalyzeRecipeAI({ name: draft.name || undefined, nameEn: draft.nameEn || undefined, ingredients: ingNames.length > 0 ? ingNames.join(", ") : undefined, baseSpirit: draft.baseSpirit || undefined, source: draft.source || undefined });
            if (!isMountedRef.current) return;
            const deepPatch: Record<string, unknown> = {};
            if (deepResult.story) deepPatch.story = deepResult.story;
            if (deepResult.flavorDesc) deepPatch.flavorDesc = deepResult.flavorDesc;
            if (deepResult.flavors && deepResult.flavors.length > 0 && (result.flavors ?? []).length === 0) deepPatch.flavors = deepResult.flavors;
            if (deepResult.suggestedCodexFamily && !draft.codexFamily) { const n = normalizeCodexFamilyDecl(deepResult.suggestedCodexFamily); if (n) deepPatch.codexFamily = n; }
            if (deepResult.suggestedMethod && !draft.method) deepPatch.method = deepResult.suggestedMethod;
            if (deepResult.suggestedVariantOf && !draft.variantOf) deepPatch.variantOf = deepResult.suggestedVariantOf;
            if (deepResult.creator || deepResult.createdYear) {
              const currentRef = (patch.sourceRef as ReturnType<typeof emptySourceRef> | undefined) ?? { ...emptySourceRef(), bookTitle: source, sourceConfidence: "high" as const };
              if (!currentRef.creator && deepResult.creator) {
                deepPatch.sourceRef = { ...currentRef, creator: deepResult.creator, createdYear: deepResult.createdYear || currentRef.createdYear, creatorConfidence: "medium" as const };
              }
            }
            if (Object.keys(deepPatch).length > 0) updateRecipe(newRecipe.id, { ...draft, ...patch, ...deepPatch });
          } catch { /* ignore deep analyze errors */ }
        } catch { /* ignore enrich errors */ }
      })();
    });
  }, [extractResults, importedRecipeIds, batchImporting, extractSelectMode, selectedExtractIds, book, zh, addRecipes, updateRecipe, ensureSpiritNameBook, ensureGlassNameBook]);

  const doExtract = useCallback(async () => {
    const text = selectedText.trim();
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    if (!text) {
      setExtractError(zh ? "请先长按选取文字" : "Long-press to select text first");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExtractError("");
    try {
      const results = await extractRecipesFromText({ text, lang: zh ? "zh" : "en" });
      if (!results || results.length === 0) {
        setExtractError(zh ? "未识别到配方，请重新选取" : "No recipes found. Try selecting different text.");
        return;
      }
      setExtractResults(results as ExtractedRecipe[]);
      setShowExtractResults(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setExtractError((zh ? "提取失败：" : "Extract failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  }, [selectedText, zh]);

  /* ── Confirm phase ── */
  const existingNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) {
      if (r.name) set.add(r.name.toLowerCase().trim());
      if (r.nameEn) set.add(r.nameEn.toLowerCase().trim());
    }
    for (const p of preps) {
      if (p.name) set.add(p.name.toLowerCase().trim());
    }
    return set;
  }, [recipes, preps]);

  const proceedToConfirm = useCallback(() => {
    tap();
    const selected = blocks.filter((b) => b.selected);
    if (selected.length === 0) return;
    const items: ReviewItem[] = selected.map((b) => {
      const cand: RecipeCandidate = b.candidate ?? (() => {
        const detected = detectRecipesInText(b.text, "");
        return detected[0] ?? {
          id: genId(), kind: "cocktail" as const,
          name: b.text.split("\n")[0].slice(0, 48).trim(),
          parsed: { name: b.text.split("\n")[0].slice(0, 48).trim(), ingredients: [], steps: b.text, garnish: "", glass: "", method: "", source: "", variantOf: "", codexFamily: "", baseSpirit: "" },
          raw: b.text, sectionTitle: "", confidence: 0.5,
        };
      })();
      const duplicate = !!cand.name && existingNames.has(cand.name.toLowerCase().trim());
      return { blockId: b.id, candidate: cand, checked: !duplicate && !!cand.name, kind: cand.kind, expanded: false, duplicate, showTranslated: false };
    });
    setReviewItems(items);
    setReviewError("");
    setImportResult(null);
    setPhase("confirm");
  }, [blocks, existingNames]);

  const updateItem = useCallback((blockId: string, patch: Partial<ReviewItem>) => {
    setReviewItems((prev) => prev.map((r) => (r.blockId === blockId ? { ...r, ...patch } : r)));
  }, []);

  const checkedCount = reviewItems.filter((r) => r.checked).length;
  const translating = false;
  const untranslatedChecked = reviewItems.some((r) => r.checked && !r.translated);
  const anyTranslated = reviewItems.some((r) => r.translated);

  const doTranslate = useCallback(async () => {
    tap();
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
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
        const res = await translateRecipes({
          target: zh ? "zh" : "en",
          items: batch.map((r) => ({ id: r.candidate.id, name: r.candidate.parsed.name || r.candidate.name, ingredients: r.candidate.parsed.ingredients.map((ing) => ({ name: ing.name, amount: ing.amount })), steps: r.candidate.parsed.steps, garnish: r.candidate.parsed.garnish, glass: r.candidate.parsed.glass, method: r.candidate.parsed.method })),
        });
        setReviewItems((prev) => prev.map((r) => {
          const t = res.items.find((it) => it.id === r.candidate.id);
          if (!t) return r;
          const orig = r.candidate.parsed;
          const translated: ParsedRecipe = { ...orig, name: t.name || orig.name, ingredients: t.ingredients.length === orig.ingredients.length ? t.ingredients.map((ing, idx) => ({ id: orig.ingredients[idx].id, name: ing.name || orig.ingredients[idx].name, amount: ing.amount || orig.ingredients[idx].amount })) : t.ingredients.map((ing) => ({ id: genId(), ...ing })), steps: t.steps || orig.steps, garnish: t.garnish, glass: t.glass || orig.glass, method: t.method || orig.method };
          return { ...r, translated, showTranslated: true };
        }));
      }
    } catch (e) {
      setReviewError((zh ? "翻译失败：" : "Translation failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  }, [reviewItems, zh]);

  const doImport = useCallback(() => {
    tap();
    const selected = reviewItems.filter((r) => r.checked);
    if (selected.length === 0) return;
    const source = book?.title ?? "";
    let recipeCount = 0, prepCount = 0;
    for (const row of selected) {
      const orig = row.candidate.parsed;
      const p = row.showTranslated && row.translated ? row.translated : orig;
      const origName = orig.name || row.candidate.name;
      const name = p.name || origName || (zh ? "未命名配方" : "Untitled recipe");
      if (row.kind === "prep") {
        const prepType = guessPrepType(`${name} ${row.candidate.raw}`, types) ?? types[0]?.key ?? "syrup";
        const prepIngredients = p.ingredients.map((i) => (i.amount ? `${i.name} ${i.amount}` : i.name));
        addPrep({ name, nameAlt: name !== origName ? origName : "", type: prepType, abvGroup: classifyPrepGroup({ name, type: prepType, ingredients: prepIngredients, recipe: p.steps, sections, types }), ingredients: prepIngredients, recipe: p.steps, yield: "", shelfLife: "", storage: "", source, notes: "" });
        prepCount++;
      } else {
        const draft = { name, nameEn: isAscii(name) ? name : isAscii(origName) && origName ? origName : "", categoryId: null, baseSpirit: p.baseSpirit ? ensureSpiritNameBook(p.baseSpirit) : "", glass: p.glass ? ensureGlassNameBook(p.glass) : "", method: p.method || "", strength: "medium" as const, variantOf: p.variantOf || "", codexFamily: normalizeCodexFamilyDecl(p.codexFamily || ""), flavors: [], source: p.source || source, story: "", flavorDesc: "", ingredients: p.ingredients, steps: p.steps, garnish: p.garnish, notes: "" };
        const newRecipe = addRecipe(draft);
        const ingNames = p.ingredients.map((i) => i.name).filter(Boolean);
        void enrichRecipeAI({ name: draft.name, nameEn: draft.nameEn || undefined, baseSpirit: draft.baseSpirit || undefined, ingredients: ingNames.length > 0 ? ingNames : undefined })
          .then((result) => { if (result.flavors.length > 0) updateRecipe(newRecipe.id, { ...draft, flavors: result.flavors }); })
          .catch(() => {});
        recipeCount++;
      }
    }
    setImportResult({ recipes: recipeCount, preps: prepCount });
    setReviewItems([]);
    setPhase("done");
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [reviewItems, book, zh, addRecipe, updateRecipe, addPrep, sections, types, addTag, spiritNamesBook, glassNamesBook]);

  /* ── Not found ── */
  if (!book) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>{zh ? "书籍不存在" : "Book not found"}</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.primary }}>{zh ? "返回" : "Go back"}</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  /* ─── Render ─────────────────────────────────────────────────────────────── */

  const chapterTitles = book.sections.map((s) => s.title);
  const chapterHighlights = highlights.filter((h) => h.chapterIdx === chapterIdx);

  const handleHighlight = useCallback((text: string, _color: 'yellow' | 'green' | 'pink') => {
    setHighlightMenu({ text });
  }, []);

  const applyHighlight = useCallback((text: string, color: 'yellow' | 'green' | 'pink') => {
    const newHL = { id: `hl_${Date.now()}`, text, color, chapterIdx };
    setHighlights((prev) => [...prev.filter((h) => !(h.text === text && h.chapterIdx === chapterIdx)), newHL]);
    setHighlightMenu(null);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [chapterIdx]);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>

      {/* ── Top chrome (auto-hide) ── */}
      {chromeVisible && phase === "reading" && (
        <View style={[styles.topBar, { backgroundColor: colors.background + "F0", borderBottomColor: colors.border }]}>
          {navHistory.length > 0 ? (
            <Pressable
              onPress={() => {
                const prev = navHistory[navHistory.length - 1];
                setNavHistory((h) => h.slice(0, -1));
                setChapterIdx(prev.chapterIdx);
                setCurrentPage(prev.page);
                setCurrentPageInChapter(prev.page);
                webViewRef.current?.injectJavaScript(`window.__goToPage && window.__goToPage(${prev.page}); true;`);
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              hitSlop={8}
              style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 2 }, pressed && { opacity: 0.6 }]}
            >
              <IconSymbol name="chevron.left" size={20} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "500" }}>返回</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <IconSymbol name="chevron.left" size={20} color={colors.primary} />
                <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "500" }}>
                  {pageFlipMode && totalPages > 1 ? String(currentPage + 1) : String(chapterIdx + 1)}
                </Text>
              </View>
            </Pressable>
          )}
          <Text style={[styles.topBarTitle, { color: colors.muted, fontSize: 13, fontWeight: "400" }]} numberOfLines={1}>
            {book.title || book.fileName}
          </Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {/* Reader Settings */}
            <Pressable onPress={() => { tap(); setShowReaderSettings(true); }} hitSlop={8} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
              <IconSymbol name="slider.horizontal.3" size={16} color={colors.foreground} />
            </Pressable>
            {/* Bookmark */}
            <Pressable onPress={() => { tap(); setBookmarks((prev) => prev.includes(chapterIdx) ? prev.filter((b) => b !== chapterIdx) : [...prev, chapterIdx]); }} hitSlop={8} style={[styles.iconBtn, { backgroundColor: bookmarks.includes(chapterIdx) ? colors.primary + "22" : colors.surface }]}>
              <IconSymbol name={bookmarks.includes(chapterIdx) ? "bookmark.fill" : "bookmark"} size={16} color={bookmarks.includes(chapterIdx) ? colors.primary : colors.foreground} />
            </Pressable>
            {/* TOC */}
            <Pressable onPress={() => { tap(); setTocOpen(true); }} hitSlop={8} style={[styles.iconBtn, { backgroundColor: colors.surface }]}>
              <IconSymbol name="list.bullet" size={16} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Select mode header ── */}
      {phase === "select" && (
        <View style={[styles.topBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => { tap(); setPhase("reading"); setBlocks([]); }} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <IconSymbol name="xmark" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]} numberOfLines={1}>
            {zh ? "选取配方段落" : "Select recipe paragraphs"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {zh ? `已选 ${selectedCount}` : `${selectedCount} selected`}
          </Text>
        </View>
      )}

      {/* ── Confirm phase header ── */}
      {phase === "confirm" && (
        <View style={[styles.topBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => { tap(); setPhase("select"); }} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]}>
            {zh ? "确认导入" : "Review Import"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {zh ? `已选 ${checkedCount}` : `${checkedCount} selected`}
          </Text>
        </View>
      )}

      {/* ── Reading phase ── */}
      {phase === "reading" && (
        <View style={{ flex: 1, overflow: "hidden" }}>
          {loadingChapter ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : chapterHtml ? (
            <GestureDetector gesture={pageFlipGesture}>
              <Animated.View style={[{ flex: 1 }, swipeAnimStyle]}>
                <HtmlChapter
                  html={chapterHtml}
                  css={book.css ?? ""}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  theme={theme}
                  onTap={Platform.OS !== "web" ? handleTap : undefined}
                  extractMode={extractMode}
                  onSelection={(text) => {
                    // 追加模式：换页后 WebView selection 被清空（text=""），保留已有内容
                    // 只有用户主动选取了新文字（text 非空）时才追加
                    if (!text.trim()) return;
                    setSelectedText((prev) => {
                      if (!prev.trim()) return text;
                      // 避免重复追加相同内容
                      if (prev.includes(text.trim())) return prev;
                      return prev + "\n" + text;
                    });
                  }}
                  webViewRef={webViewRef}
                  pageFlipMode={pageFlipMode && Platform.OS !== "web"}
                  onPageInfo={(info) => { setTotalPages(info.totalPages); totalPagesRef.current = info.totalPages; setCurrentPageInChapter(0); }}
                  onImageTap={(uri) => setImageViewerUri(uri)}
                  onInternalLink={handleInternalLink}
                  baseUrl={(() => {
                    if (!book.hasFileSystem) return undefined;
                    // Compute the chapter file's directory as baseUrl so relative paths resolve
                    const chapterFilePath = book.sections[chapterIdx]?.text;
                    if (chapterFilePath) {
                      const docDir = (FileSystemLegacy.documentDirectory ?? "").replace(/\/+$/, "");
                      // chapterFilePath may be relative (e.g. "books/id/content/OEBPS/Text/ch1.xhtml")
                      // or absolute (starts with file://)
                      let absPath: string;
                      if (chapterFilePath.startsWith("file://")) {
                        absPath = chapterFilePath;
                      } else if (chapterFilePath.startsWith("/")) {
                        absPath = "file://" + chapterFilePath;
                      } else {
                        absPath = "file://" + docDir + "/" + chapterFilePath;
                      }
                      // Return the directory (with trailing slash)
                      const lastSlash = absPath.lastIndexOf("/");
                      return lastSlash >= 0 ? absPath.slice(0, lastSlash + 1) : absPath;
                    }
                    // Fallback: use bookDir/content/
                    if (book.bookDir) {
                      const docDir = (FileSystemLegacy.documentDirectory ?? "").replace(/\/+$/, "");
                      const bd = book.bookDir.startsWith("/") ? book.bookDir : "/" + book.bookDir;
                      return "file://" + docDir + bd.replace(/\/+$/, "") + "/content/";
                    }
                    return undefined;
                  })()}
                  fontFamily={fontFamily}
                  margin={margin}
                  letterSpacing={letterSpacing}
                  highlights={chapterHighlights}
                  onHighlight={handleHighlight}
                />
              </Animated.View>
            </GestureDetector>
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.muted }}>{zh ? "章节为空" : "Empty chapter"}</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Select phase: paragraph list ── */}
      {phase === "select" && (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 + insets.bottom }}>
            {blocks.map((block) => {
              const isSelected = block.selected;
              const isHint = block.isCandidate && !isSelected;
              return (
                <Pressable
                  key={block.id}
                  onPress={() => toggleBlock(block.id)}
                  style={({ pressed }) => [{
                    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6,
                    backgroundColor: isSelected ? colors.primary + "18" : isHint ? "#FF950012" : "transparent",
                    borderColor: isSelected ? colors.primary + "55" : isHint ? "#FF950044" : "transparent",
                    borderWidth: isSelected || isHint ? 1 : 0,
                    opacity: pressed ? 0.75 : 1,
                  }]}
                >
                  {(isSelected || isHint) && (
                    <View style={{ flexDirection: "row", gap: 4, marginBottom: 4 }}>
                      {isSelected && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.primary }}>
                          <IconSymbol name="checkmark" size={9} color="#FFF" />
                          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>{zh ? "已选" : "Selected"}</Text>
                        </View>
                      )}
                      {isHint && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FF9500" }}>
                          <IconSymbol name="sparkles" size={9} color="#FFF" />
                          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "600" }}>
                            {block.confidence >= 0.7 ? (zh ? "高置信配方" : "Recipe") : block.confidence >= 0.5 ? (zh ? "疑似配方" : "Possible") : (zh ? "参考" : "Hint")}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                  <Text style={{ fontSize: 15, lineHeight: 24, color: isSelected ? colors.primary : colors.foreground, fontWeight: isSelected ? "500" : "400" }}>
                    {block.text}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            {candidateCount > 0 && selectedCount === 0 && (
              <Pressable onPress={() => { tap(); setBlocks((prev) => prev.map((b) => b.isCandidate && b.confidence >= 0.5 ? { ...b, selected: true } : b)); }} style={{ alignItems: "center", paddingVertical: 6 }}>
                <Text style={{ color: colors.primary, fontSize: 13 }}>{zh ? `选中全部 ${candidateCount} 个候选` : `Select all ${candidateCount} candidates`}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={proceedToConfirm}
              disabled={selectedCount === 0}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: selectedCount === 0 ? colors.border : colors.primary, marginTop: 0, alignSelf: "stretch" }, pressed && selectedCount > 0 && { opacity: 0.85 }]}
            >
              <IconSymbol name="square.and.arrow.down.fill" size={17} color="#FFF" />
              <Text style={styles.primaryBtnText}>
                {selectedCount === 0 ? (zh ? "点击段落选取配方" : "Tap paragraphs to select") : zh ? `导入选中（${selectedCount}）` : `Import (${selectedCount})`}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Confirm phase ── */}
      {phase === "confirm" && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 8, gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
              {zh ? `${reviewItems.length} 段 · ${checkedCount} 已选` : `${reviewItems.length} items · ${checkedCount} selected`}
            </Text>
            {(untranslatedChecked || anyTranslated) && (
              <Pressable onPress={doTranslate} hitSlop={6} disabled={translating}>
                <Text style={{ color: translating ? colors.muted : colors.primary, fontSize: 14, fontWeight: "600" }}>
                  {translating ? (zh ? "翻译中…" : "Translating…") : untranslatedChecked ? (zh ? "AI 翻译" : "AI Translate") : (zh ? "切换原/译文" : "Toggle")}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => { tap(); setReviewItems((prev) => { const allChecked = prev.every((r) => r.checked); return prev.map((r) => ({ ...r, checked: !allChecked })); }); }} hitSlop={6}>
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>
                {reviewItems.every((r) => r.checked) ? (zh ? "全不选" : "None") : zh ? "全选" : "All"}
              </Text>
            </Pressable>
          </View>
          {!!reviewError && (
            <View style={{ marginHorizontal: 20, marginBottom: 8, borderRadius: 12, padding: 12, backgroundColor: "#FF3B3015" }}>
              <Text style={{ color: "#FF3B30", fontSize: 12 }}>{reviewError}</Text>
            </View>
          )}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110 }}>
            {reviewItems.map((row) => {
              const c = row.candidate;
              const p = row.showTranslated && row.translated ? row.translated : c.parsed;
              const displayName = p.name || c.name;
              return (
                <View key={row.blockId} style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }, !row.checked && { opacity: 0.55 }]}>
                  <Pressable onPress={() => { tap(); updateItem(row.blockId, { checked: !row.checked }); }} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }, pressed && { opacity: 0.8 }]}>
                    <IconSymbol name={row.checked ? "checkmark.circle.fill" : "circle"} size={22} color={row.checked ? colors.primary : colors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{displayName || (zh ? "（未识别到名称）" : "(unnamed)")}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
                        {p.ingredients.length} {zh ? "种配料" : "ingredients"}{p.glass ? ` · ${p.glass}` : ""} · {Math.round(c.confidence * 100)}%
                      </Text>
                    </View>
                    {row.duplicate && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#FF950022" }}>
                        <Text style={{ color: "#FF9500", fontSize: 11, fontWeight: "600" }}>{zh ? "已存在" : "Exists"}</Text>
                      </View>
                    )}
                  </Pressable>
                  <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                    {(["cocktail", "prep"] as const).map((k) => {
                      const active = row.kind === k;
                      return (
                        <Pressable key={k} onPress={() => { tap(); updateItem(row.blockId, { kind: k }); }} style={[{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 }, { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.border }]}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#FFF" : colors.muted }}>
                            {k === "cocktail" ? (zh ? "鸡尾酒" : "Cocktail") : (zh ? "自制" : "Prep")}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <View style={{ flex: 1 }} />
                    {row.translated && (
                      <Pressable onPress={() => { tap(); updateItem(row.blockId, { showTranslated: !row.showTranslated }); }} hitSlop={6} style={{ justifyContent: "center" }}>
                        <Text style={{ color: colors.primary, fontSize: 12 }}>{row.showTranslated ? (zh ? "原文" : "Original") : (zh ? "译文" : "Translated")}</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => { tap(); updateItem(row.blockId, { expanded: !row.expanded }); }} hitSlop={6} style={{ justifyContent: "center" }}>
                      <Text style={{ color: colors.primary, fontSize: 12 }}>{row.expanded ? (zh ? "收起" : "Hide") : (zh ? "详情" : "Details")}</Text>
                    </Pressable>
                  </View>
                  {row.expanded && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 12, marginBottom: 4 }}>{zh ? "配料" : "Ingredients"}</Text>
                      {p.ingredients.map((ing) => (
                        <Text key={ing.id} style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>· {ing.name}{ing.amount ? `  ${ing.amount}` : ""}</Text>
                      ))}
                      {!!p.steps && (
                        <>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 10, marginBottom: 4 }}>{zh ? "做法" : "Steps"}</Text>
                          <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{p.steps}</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable onPress={doImport} disabled={checkedCount === 0} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: checkedCount === 0 ? colors.border : colors.primary, marginTop: 0, alignSelf: "stretch" }, pressed && { opacity: 0.85 }]}>
              <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFF" />
              <Text style={styles.primaryBtnText}>{zh ? `导入所选（${checkedCount}）` : `Import (${checkedCount})`}</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* ── Done phase ── */}
      {phase === "done" && importResult && (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <View style={{ width: 60, height: 60, borderRadius: 16, backgroundColor: "#34C759", alignItems: "center", justifyContent: "center" }}>
            <IconSymbol name="checkmark" size={30} color="#FFF" />
          </View>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground, marginTop: 16 }}>{zh ? "导入完成" : "Import complete"}</Text>
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8, textAlign: "center" }}>
            {zh ? `新增 ${importResult.recipes} 个配方、${importResult.preps} 个自制` : `${importResult.recipes} recipes and ${importResult.preps} preps added`}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 24, gap: 12 }}>
            <Pressable onPress={() => { tap(); setPhase("reading"); setImportResult(null); showChrome(); }} style={({ pressed }) => [{ paddingHorizontal: 20, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>{zh ? "继续阅读" : "Keep reading"}</Text>
            </Pressable>
            <Pressable onPress={() => { tap(); router.back(); }} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 0 }, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryBtnText}>{zh ? "完成" : "Done"}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Bottom chrome (auto-hide): chapter nav + extract button ── */}
      {chromeVisible && phase === "reading" && (
        <View style={[styles.bottomBar, { backgroundColor: colors.background + "F0", borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {/* Progress bar */}
          <View
            style={{ height: 20, justifyContent: "center", marginBottom: 6 }}
            onLayout={(e) => { progressBarWidth.current = e.nativeEvent.layout.width; }}
            {...progressPanResponder.panHandlers}
          >
            <View style={{ height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
              <View style={{ height: 3, backgroundColor: colors.primary, borderRadius: 2, width: `${Math.round(
                pageFlipMode && totalPages > 1
                  ? ((chapterIdx + (currentPage + 1) / totalPages) / totalChapters) * 100
                  : progress * 100
              )}%` }} />
            </View>
            {/* Thumb indicator */}
            <View style={{ position: "absolute", left: `${Math.round(
              pageFlipMode && totalPages > 1
                ? ((chapterIdx + (currentPage + 1) / totalPages) / totalChapters) * 100
                : progress * 100
            )}%`, top: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary, marginLeft: -7, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, elevation: 3 }} />
          </View>
          {/* Page info row */}
          <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginBottom: 6 }}>
            {pageFlipMode && totalPages > 1
              ? `${chapterIdx + 1}/${totalChapters}章  ·  第 ${currentPage + 1}/${totalPages} 页`
              : `${chapterIdx + 1} / ${totalChapters} 章`}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={() => { tap(); setCurrentPage(0); setCurrentPageInChapter(0); setChapterIdx((i) => Math.max(0, i - 1)); }}
              disabled={chapterIdx === 0}
              style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: chapterIdx === 0 ? 0.35 : 1 }]}
            >
              <IconSymbol name="chevron.left" size={16} color={colors.foreground} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }} numberOfLines={1}>
                {book.sections[chapterIdx]?.title || `${zh ? "第" : "Ch."} ${chapterIdx + 1}`}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted + "99", textAlign: "center", marginTop: 2 }}>
                {pageFlipMode && totalPages > 1
                  ? `${zh ? "第" : "Page"} ${currentPage + 1} / ${totalPages}  ·  ${zh ? "章节" : "Ch."} ${chapterIdx + 1}/${totalChapters}`
                  : `${zh ? "章节" : "Ch."} ${chapterIdx + 1} / ${totalChapters}`}
              </Text>
            </View>
            <Pressable
              onPress={() => { tap(); setCurrentPage(0); setCurrentPageInChapter(0); setChapterIdx((i) => Math.min(totalChapters - 1, i + 1)); }}
              disabled={chapterIdx >= totalChapters - 1}
              style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: chapterIdx >= totalChapters - 1 ? 0.35 : 1 }]}
            >
              <IconSymbol name="chevron.right" size={16} color={colors.foreground} />
            </Pressable>
            <Pressable
              onPress={enterExtractMode}
              style={({ pressed }) => [styles.extractBtn, { backgroundColor: "#FF950018", borderColor: "#FF950044" }, pressed && { opacity: 0.7 }]}
            >
              <IconSymbol name="text.cursor" size={14} color="#FF9500" />
              <Text style={{ fontSize: 12, fontWeight: "600", color: "#FF9500" }}>
                {zh ? "AI 选区提取" : "AI Select"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Extract mode bottom bar (overlays reading view) ── */}
      {extractMode && phase === "reading" && (
        <View style={[styles.extractBar, { backgroundColor: colors.background + "F8", borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                {zh ? "选区提取模式" : "Selection Extract"}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  {selectedText.trim().length > 0
                    ? (() => {
                        const paras = selectedText.trim().split('\n').filter((s: string) => s.trim().length > 0).length;

                        const chars = selectedText.trim().length;
                        return zh ? `已选 ${paras} 段 · ${chars} 字` : `${paras} para${paras !== 1 ? 's' : ''} · ${chars} chars`;
                      })()
                    : (zh ? "长按文字选取配方内容" : "Long-press to select recipe text")}
                {selectedText.trim().length > 0 && (
                  <Pressable
                    onPress={() => { setSelectedText(""); appendModeRef.current = false; }}
                    hitSlop={8}
                    style={({ pressed }) => [{ marginTop: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={{ fontSize: 11, color: colors.muted }}>{zh ? "清空重选" : "Clear"}</Text>
                  </Pressable>
                )}
              </Text>
            </View>
            <Pressable
              onPress={exitExtractMode}
              hitSlop={8}
              style={({ pressed }) => [{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border }, pressed && { opacity: 0.6 }]}
            >
              <Text style={{ fontSize: 12, color: colors.muted }}>{zh ? "退出" : "Exit"}</Text>
            </Pressable>
          </View>
          {!!extractError && (
            <View style={{ marginBottom: 8, borderRadius: 8, padding: 8, backgroundColor: "#FF3B3015" }}>
              <Text style={{ color: "#FF3B30", fontSize: 12 }}>{extractError}</Text>
            </View>
          )}
          <Pressable
            onPress={doExtract}
            disabled={false || selectedText.trim().length === 0}
            style={({ pressed }) => [styles.primaryBtn, {
              backgroundColor: selectedText.trim().length === 0 ? colors.border : colors.primary,
              marginTop: 0, alignSelf: "stretch",
            }, pressed && selectedText.trim().length > 0 && { opacity: 0.85 }]}
          >
            <IconSymbol name="sparkles" size={17} color="#FFF" />
            <Text style={styles.primaryBtnText}>
              {false
                ? (zh ? "AI 分析中…" : "Analyzing…")
                : selectedText.trim().length === 0
                  ? (zh ? "请先长按选取文字" : "Long-press to select text")
                  : (zh ? "AI 提取配方" : "AI Extract")}
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Reader Settings Panel ── */}
      {showReaderSettings && (
        <View style={[StyleSheet.absoluteFillObject, { pointerEvents: "box-none" }]}>
          <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.4)" }]} onPress={() => setShowReaderSettings(false)} />
          <View style={[styles.settingsSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
              <Text style={[styles.tocTitle, { color: colors.foreground }]}>{zh ? "阅读设置" : "Reader Settings"}</Text>
              <Pressable onPress={() => setShowReaderSettings(false)} hitSlop={8}>
                <IconSymbol name="xmark" size={18} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {/* Font Size */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "字体大小" : "Font Size"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable onPress={() => setFontSize((f) => Math.max(12, f - 1))} style={[{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 16, color: colors.foreground }}>−</Text>
                  </Pressable>
                  <Text style={{ flex: 1, fontSize: fontSize, textAlign: "center", color: colors.foreground }}>Aa</Text>
                  <Pressable onPress={() => setFontSize((f) => Math.min(24, f + 1))} style={[{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 16, color: colors.foreground }}>+</Text>
                  </Pressable>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>{fontSize}pt</Text>
              </View>

              {/* Line Height */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "行间距" : "Line Height"}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[1.2, 1.5, 1.75, 2.0].map((lh) => (
                    <Pressable key={lh} onPress={() => setLineHeight(lh)} style={[{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", borderWidth: 1 }, lineHeight === lh ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "500", color: lineHeight === lh ? "#FFF" : colors.foreground }}>{lh}x</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Theme */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "主题" : "Theme"}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["light", "dark", "sepia"] as const).map((t) => (
                    <Pressable key={t} onPress={() => setTheme(t)} style={[{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", borderWidth: 1 }, theme === t ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "500", color: theme === t ? "#FFF" : colors.foreground }}>{t === "light" ? (zh ? "浅色" : "Light") : t === "dark" ? (zh ? "深色" : "Dark") : (zh ? "米黄" : "Sepia")}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Font Family */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "字体" : "Font"}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([["serif", zh ? "衬线" : "Serif"], ["sans", zh ? "无衬线" : "Sans"], ["mono", zh ? "等宽" : "Mono"]] as const).map(([ff, label]) => (
                    <Pressable key={ff} onPress={() => { tap(); setFontFamily(ff); }} style={[{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", borderWidth: 1 }, fontFamily === ff ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "500", color: fontFamily === ff ? "#FFF" : colors.foreground }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Margin */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "页边距" : "Margin"}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([[12, zh ? "窄" : "Narrow"], [20, zh ? "中" : "Medium"], [32, zh ? "宽" : "Wide"]] as const).map(([m, label]) => (
                    <Pressable key={m} onPress={() => { tap(); setMargin(m); }} style={[{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", borderWidth: 1 }, margin === m ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "500", color: margin === m ? "#FFF" : colors.foreground }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Letter Spacing */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "字间距" : "Letter Spacing"}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {([[0, zh ? "紧凑" : "Tight"], [0.5, zh ? "标准" : "Normal"], [1.5, zh ? "宽松" : "Wide"]] as const).map(([ls, label]) => (
                    <Pressable key={ls} onPress={() => { tap(); setLetterSpacing(ls); }} style={[{ flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center", borderWidth: 1 }, letterSpacing === ls ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "500", color: letterSpacing === ls ? "#FFF" : colors.foreground }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Font Size (A- / A+) */}
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>{zh ? "字号" : "Font Size"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Pressable onPress={() => { tap(); setFontSize((f) => Math.max(12, f - 1)); }} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }}>A−</Text>
                  </Pressable>
                  <Text style={{ flex: 1, textAlign: "center", fontSize: 22, color: colors.foreground, fontWeight: "300" }}>Aa</Text>
                  <Pressable onPress={() => { tap(); setFontSize((f) => Math.min(28, f + 1)); }} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 17, color: colors.foreground, fontWeight: "600" }}>A+</Text>
                  </Pressable>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center", marginTop: 6 }}>{fontSize}pt</Text>
              </View>

              {/* Page Flip Mode */}
              {Platform.OS !== "web" && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{zh ? "翻页模式" : "Page Flip"}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{zh ? "左右滑动翻页（章节内分页）" : "Swipe left/right to flip pages"}</Text>
                  </View>
                  <Pressable
                    onPress={() => { tap(); setPageFlipMode((v) => !v); }}
                    style={[{ width: 50, height: 28, borderRadius: 14, justifyContent: "center", paddingHorizontal: 3 }, pageFlipMode ? { backgroundColor: colors.primary } : { backgroundColor: colors.border }]}
                  >
                    <View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFF" }, pageFlipMode ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }]} />
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ── TOC drawer ── */}
      {tocOpen && (
        <View style={[StyleSheet.absoluteFillObject, { pointerEvents: "box-none" }]}>
          <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.4)" }]} onPress={() => setTocOpen(false)} />
          <View style={[styles.tocSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {/* Apple Books style header: cover + title + page info */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 12 }}>
              {book.coverUri ? (
                <Image source={{ uri: book.coverUri }} style={{ width: 44, height: 60, borderRadius: 4, backgroundColor: colors.surface }} resizeMode="cover" />
              ) : (
                <View style={{ width: 44, height: 60, borderRadius: 4, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
                  <IconSymbol name="book.closed" size={20} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }} numberOfLines={2}>{book.title || book.fileName}</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
                  {zh ? `第 ${chapterIdx + 1} 章，共 ${totalChapters} 章` : `Ch. ${chapterIdx + 1} of ${totalChapters}`}
                </Text>
              </View>
              <Pressable onPress={() => setTocOpen(false)} hitSlop={8} style={({ pressed }) => [{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.6 }]}>
                <IconSymbol name="xmark" size={14} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {chapterTitles.map((title, i) => (
                <Pressable
                  key={i}
                  onPress={() => { tap(); setChapterIdx(i); setTocOpen(false); showChrome(); }}
                  style={({ pressed }) => [styles.tocRow, { borderBottomColor: colors.border, paddingLeft: title && title.match(/^\s/) ? 32 : 16 }, pressed && { backgroundColor: colors.surface }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: i === chapterIdx ? colors.primary : colors.foreground, fontWeight: i === chapterIdx ? "600" : "400" }} numberOfLines={2}>
                      {title || `${zh ? "第" : "Chapter"} ${i + 1}`}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 8, minWidth: 24, textAlign: "right" }}>{i + 1}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ── Extract results Modal ── */}
      {/* Extract results overlay (transparent, keeps WebView mounted and scroll position) */}
      {showExtractResults && (
        <View style={[StyleSheet.absoluteFillObject, { pointerEvents: "box-none" }]}>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.45)" }]}
            onPress={() => setShowExtractResults(false)}
          />
          <View style={{
            position: "absolute" as const,
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: "85%",
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            overflow: "hidden" as const,
          }}>
         {/* Header */}
         <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>
                {extractSelectMode
                  ? (zh ? `已选 ${selectedExtractIds.size} 个` : `${selectedExtractIds.size} selected`)
                  : (zh ? `找到 ${extractResults.length} 个配方` : `${extractResults.length} recipe(s) found`)}
              </Text>
              {importedRecipeIds.size > 0 && !extractSelectMode && (
                <Text style={{ fontSize: 12, color: "#34C759", marginTop: 2 }}>
                  {zh ? `已导入 ${importedRecipeIds.size} 个` : `${importedRecipeIds.size} imported`}
                </Text>
              )}
            </View>
            {/* Multi-select toggle (only when >1 recipe) */}
            {extractResults.length > 1 && (
              <Pressable
                onPress={() => {
                  tap();
                  if (extractSelectMode) {
                    setExtractSelectMode(false);
                    setSelectedExtractIds(new Set());
                  } else {
                    setExtractSelectMode(true);
                    // Pre-select all not yet imported
                    setSelectedExtractIds(new Set(
                      extractResults.map((_, i) => i).filter((i) => !importedRecipeIds.has(i))
                    ));
                  }
                }}
                style={({ pressed }) => [{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 14,
                  backgroundColor: extractSelectMode
                    ? colors.primary + "22"
                    : pressed ? colors.surface : colors.surface,
                  borderWidth: 1,
                  borderColor: extractSelectMode ? colors.primary : colors.border,
                }]}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: extractSelectMode ? colors.primary : colors.muted }}>
                  {extractSelectMode ? (zh ? "取消" : "Cancel") : (zh ? "多选" : "Select")}
                </Text>
              </Pressable>
            )}
            {/* Import button: "Import Selected" in select mode, "Import All" otherwise */}
            {!extractSelectMode && extractResults.length > 1 && importedRecipeIds.size < extractResults.length && (
              <Pressable
                onPress={batchImportAll}
                style={({ pressed }) => [{
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: pressed ? colors.primary + "dd" : colors.primary,
                }]}
              >
                {batchImporting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <IconSymbol name="square.and.arrow.down.fill" size={13} color="#fff" />
                )}
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>
                  {zh ? "全部导入" : "Import All"}
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setShowExtractResults(false);
                setImportedRecipeIds(new Set());
                setSelectedExtractIds(new Set());
                setExtractSelectMode(false);
              }}
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={20} color={colors.muted} />
            </Pressable>
          </View>
          {/* Results list */}
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: extractSelectMode ? 100 : 40 }}>
            {extractResults.map((recipe, idx) => {
              const confColor = recipe.confidence === "high" ? "#34C759" : recipe.confidence === "medium" ? "#FF9500" : "#FF3B30";
              const isSelected = selectedExtractIds.has(idx);
              const isImported = importedRecipeIds.has(idx);
              return (
                <Pressable
                  key={idx}
                  onPress={extractSelectMode ? () => {
                    tap();
                    setSelectedExtractIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx); else next.add(idx);
                      return next;
                    });
                  } : undefined}
                  style={({ pressed }) => [{
                    backgroundColor: colors.surface,
                    borderRadius: 16,
                    borderWidth: 1.5,
                    borderColor: isSelected ? colors.primary : isImported ? "#34C75940" : colors.border,
                    marginBottom: 14,
                    overflow: "hidden" as const,
                    opacity: extractSelectMode && pressed ? 0.75 : 1,
                  }]}
                >
                  {/* Card header */}
                  <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 8 }}>
                    {/* Checkbox (select mode) or imported badge */}
                    {extractSelectMode ? (
                      <View style={{
                        width: 22, height: 22, borderRadius: 11,
                        borderWidth: 2,
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primary : "transparent",
                        alignItems: "center", justifyContent: "center",
                      }}>
                        {isSelected && <IconSymbol name="checkmark" size={12} color="#fff" />}
                      </View>
                    ) : isImported ? (
                      <IconSymbol name="checkmark.circle.fill" size={20} color="#34C759" />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>
                        {recipe.nameZh || recipe.name || (zh ? "（未识别名称）" : "(unnamed)")}
                      </Text>
                      {!!(recipe.name && recipe.nameZh && recipe.name !== recipe.nameZh) && (
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{recipe.name}</Text>
                      )}
                    </View>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: confColor + "22" }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: confColor }}>
                        {recipe.confidence === "high" ? (zh ? "高置信" : "High") : recipe.confidence === "medium" ? (zh ? "中置信" : "Medium") : (zh ? "低置信" : "Low")}
                      </Text>
                    </View>
                  </View>
                  {/* Ingredients */}
                  {recipe.ingredients.length > 0 && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 4 }}>{zh ? "配料" : "Ingredients"}</Text>
                      {recipe.ingredients.slice(0, 5).map((ing, i) => (
                        <Text key={i} style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>
                          · {ing.name}{ing.amount ? `  ${ing.amount}${ing.unit ?? ""}` : ""}
                        </Text>
                      ))}
                      {recipe.ingredients.length > 5 && (
                        <Text style={{ fontSize: 12, color: colors.muted }}>+{recipe.ingredients.length - 5} {zh ? "种" : "more"}</Text>
                      )}
                    </View>
                  )}
                  {/* Steps preview */}
                  {!!recipe.steps && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 4 }}>{zh ? "做法" : "Steps"}</Text>
                      <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }} numberOfLines={3}>{recipe.steps}</Text>
                    </View>
                  )}
                  {/* Missing fields */}
                  {recipe.missingFields.length > 0 && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                      <Text style={{ fontSize: 11, color: "#FF9500" }}>
                        {zh ? `待确认：${recipe.missingFields.join("、")}` : `Unconfirmed: ${recipe.missingFields.join(", ")}`}
                      </Text>
                    </View>
                  )}
                  {/* Import buttons row — hidden in select mode */}
                  {!extractSelectMode && (
                    <View style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                      {/* Quick save button */}
                      <Pressable
                        onPress={() => isImported ? undefined : quickSaveRecipe(recipe, idx)}
                        style={({ pressed }) => [{
                          flex: 1,
                          flexDirection: "row" as const,
                          alignItems: "center" as const,
                          justifyContent: "center" as const,
                          gap: 5,
                          paddingVertical: 12,
                          backgroundColor: isImported
                            ? "#34C75918"
                            : pressed ? colors.primary + "18" : "transparent",
                        }]}
                      >
                        <IconSymbol
                          name={isImported ? "checkmark.circle.fill" : "square.and.arrow.down.fill"}
                          size={15}
                          color={isImported ? "#34C759" : colors.primary}
                        />
                        <Text style={{ fontSize: 13, fontWeight: "600", color: isImported ? "#34C759" : colors.primary }}>
                          {isImported ? (zh ? "已导入" : "Imported") : (zh ? "快速导入" : "Quick Save")}
                        </Text>
                      </Pressable>
                      <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                      {/* Edit then import — opens recipe-form but does NOT close this modal */}
                      <Pressable
                        onPress={() => {
                          tap();
                          // Mark as imported so the card shows "Imported" when user returns
                          // We do NOT close the modal — user can come back to import more
                          const params: Record<string, string> = {};
                          if (recipe.nameZh) params.prefillName = recipe.nameZh;
                          if (recipe.name && recipe.name !== recipe.nameZh) params.prefillNameEn = recipe.name;
                          if (recipe.glass) params.prefillGlass = recipe.glass;
                          if (recipe.steps) params.prefillSteps = recipe.steps;
                          if (recipe.garnish) params.prefillGarnish = recipe.garnish;
                          if (recipe.notes) params.prefillNotes = recipe.notes;
                          if (recipe.method) params.prefillMethod = recipe.method;
                          if (recipe.ingredients.length > 0) {
                            params.prefillIngredients = JSON.stringify(recipe.ingredients.map((ing) => ({
                              id: genId(),
                              name: ing.name,
                              amount: ing.amount ? `${ing.amount}${ing.unit ?? ""}` : "",
                            })));
                          }
                          // Mark as "pending edit" so the card shows a different state
                          setImportedRecipeIds((prev) => new Set([...prev, idx]));
                          router.push({ pathname: "/recipe-form", params });
                        }}
                        style={({ pressed }) => [{
                          flex: 1,
                          flexDirection: "row" as const,
                          alignItems: "center" as const,
                          justifyContent: "center" as const,
                          gap: 5,
                          paddingVertical: 12,
                          backgroundColor: pressed ? colors.muted + "18" : "transparent",
                        }]}
                      >
                        <IconSymbol name="pencil" size={14} color={colors.muted} />
                        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.muted }}>
                          {zh ? "编辑后导入" : "Edit & Import"}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          {/* Bottom action bar in select mode */}
          {extractSelectMode && (
            <View style={{
              position: "absolute" as const,
              bottom: 0, left: 0, right: 0,
              backgroundColor: colors.background,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 28,
              flexDirection: "row" as const,
              alignItems: "center" as const,
              gap: 10,
            }}>
              {/* Select all / deselect all */}
              <Pressable
                onPress={() => {
                  tap();
                  const allIds = new Set(extractResults.map((_, i) => i).filter((i) => !importedRecipeIds.has(i)));
                  const allSelected = allIds.size > 0 && [...allIds].every((i) => selectedExtractIds.has(i));
                  setSelectedExtractIds(allSelected ? new Set() : allIds);
                }}
                style={({ pressed }) => [{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: pressed ? colors.surface : colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }]}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                  {(() => {
                    const allIds = extractResults.map((_, i) => i).filter((i) => !importedRecipeIds.has(i));
                    return allIds.every((i) => selectedExtractIds.has(i))
                      ? (zh ? "取消全选" : "Deselect All")
                      : (zh ? "全选" : "Select All");
                  })()}
                </Text>
              </Pressable>
              {/* Import selected */}
              <Pressable
                onPress={batchImportAll}
                style={({ pressed }) => [{
                  flex: 1,
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                  gap: 6,
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: selectedExtractIds.size === 0
                    ? colors.muted + "40"
                    : pressed ? colors.primary + "dd" : colors.primary,
                }]}
              >
                {batchImporting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <IconSymbol name="square.and.arrow.down.fill" size={15} color="#fff" />
                )}
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>
                  {selectedExtractIds.size === 0
                    ? (zh ? "导入选中" : "Import Selected")
                    : (zh ? `导入 ${selectedExtractIds.size} 个` : `Import ${selectedExtractIds.size}`)}
                </Text>
              </Pressable>
            </View>
          )}
      </View>
      </View>
    )}

    {/* ── Highlight color picker ── */}
    {highlightMenu && (
      <View style={[StyleSheet.absoluteFillObject, { pointerEvents: "box-none" }]}>
        <Pressable style={[StyleSheet.absoluteFillObject]} onPress={() => setHighlightMenu(null)} />
        <View style={{ position: "absolute", bottom: Math.max(insets.bottom + 80, 100), left: 20, right: 20, backgroundColor: colors.background, borderRadius: 16, padding: 16, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, elevation: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, textAlign: "center" }}>{zh ? "选择高亮颜色" : "Choose highlight color"}</Text>
          <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 12, textAlign: "center" }} numberOfLines={2}>「{highlightMenu.text.slice(0, 40)}{highlightMenu.text.length > 40 ? "…" : ""}」</Text>
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
            {([["yellow", "#FFD60A", zh ? "黄色" : "Yellow"], ["green", "#30D158", zh ? "绿色" : "Green"], ["pink", "#FF375F", zh ? "粉色" : "Pink"]] as const).map(([color, hex, label]) => (
              <Pressable key={color} onPress={() => applyHighlight(highlightMenu.text, color)} style={({ pressed }) => [{ alignItems: "center", gap: 4 }, pressed && { opacity: 0.7 }]}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hex + "44", borderWidth: 2, borderColor: hex, alignItems: "center", justifyContent: "center" }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: hex }} />
                </View>
                <Text style={{ fontSize: 11, color: colors.muted }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    )}
  </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  topBarTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "75%",
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  extractBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  extractBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  reviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  tocSheet: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: "72%",
    maxWidth: 320,
    borderLeftWidth: 1,
    paddingTop: 16,
  },
  tocTitle: {
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  tocRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
/* ─── WebView height auto-resize script ────────────────────────────────────── */
const WEBVIEW_HEIGHT_SCRIPT = `
  (function() {
    function sendHeight() {
      var h = document.documentElement.scrollHeight || document.body.scrollHeight;
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
    }
    document.addEventListener('DOMContentLoaded', sendHeight);
    window.addEventListener('load', sendHeight);
    var obs = new MutationObserver(sendHeight);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  })();
  true;
`;

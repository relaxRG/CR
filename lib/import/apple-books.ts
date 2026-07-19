/**
 * Apple Books 摘录格式解析（Bug 9）
 *
 * iOS 从 Apple Books 复制文字时会自动附加版权尾注，格式固定为：
 *
 *   <正文...>
 *
 *   摘录来自
 *   The Japanese Art of the Cocktail
 *   Masahiro Urushido
 *   此内容可能受版权保护。
 *
 * 英文系统则为：
 *
 *   Excerpt From
 *   The Japanese Art of the Cocktail
 *   Masahiro Urushido
 *   This material may be protected by copyright.
 *
 * 本模块用纯正则在本地解析（不依赖 AI，格式固定、100% 可靠）：
 * - 提取书名 bookTitle 与作者 bookAuthor
 * - 返回剥离尾注后的正文 cleanText（喂给 AI 提取配方，避免版权句干扰识别）
 */

export interface AppleBooksExcerpt {
  bookTitle: string;
  bookAuthor: string;
  /** 剥离"摘录来自…版权保护"尾注后的正文 */
  cleanText: string;
  /** 原始完整文本（含尾注），供 sourceRef.rawText 留档 */
  rawText: string;
}

/** 中英文"摘录来自"标记行（iOS 实际会在行首附加左引号，如 “摘录来自 / “Excerpt From） */
const EXCERPT_MARKERS = /^[ \t]*["“”'']?(摘录来自|Excerpt From)[:：]?[ \t]*$/im;

/** 中英文版权句（尾注结束标志），允许句末标点和引号变体 */
const COPYRIGHT_LINE =
  /^[ \t]*["“”]?(此内容可能受版权保护|This material may be protected by copyright)[.。！!]?["“”]?[ \t]*$/i;

/**
 * 解析 Apple Books 摘录尾注。
 * 未检测到该格式时返回 null（调用方按普通文本继续处理）。
 */
export function parseAppleBooksExcerpt(text: string): AppleBooksExcerpt | null {
  if (!text) return null;
  const markerMatch = EXCERPT_MARKERS.exec(text);
  if (!markerMatch) return null;

  const markerStart = markerMatch.index;
  const afterMarker = text.slice(markerStart + markerMatch[0].length);
  // 尾注体：标记行之后的非空行依次为 书名 / 作者(可选) / 版权句(可选)
  const lines = afterMarker.split(/\r?\n/).map((l) => l.trim());

  let bookTitle = "";
  let bookAuthor = "";
  let sawCopyright = false;
  const meaningful: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (COPYRIGHT_LINE.test(line)) {
      sawCopyright = true;
      break;
    }
    meaningful.push(line);
    if (meaningful.length >= 2) {
      // 书名 + 作者已齐；后续若无版权句也停止（防误吞正文）
      continue;
    }
  }
  if (meaningful.length === 0) return null;
  // 兼容"摘录来自: 书名"同行写法（标记行正则限定整行，此处 meaningful[0] 即书名行）
  bookTitle = (meaningful[0] ?? "").replace(/^["“”]|["“”]$/g, "").trim();
  bookAuthor = (meaningful[1] ?? "").trim();
  // 作者行若明显是正文（超长或含标点句子），不当作者
  if (bookAuthor.length > 60 || /[。.!?！？;；]/.test(bookAuthor)) bookAuthor = "";
  if (!bookTitle) return null;

  // 剥离尾注：正文 = 标记行之前的内容
  const cleanText = text.slice(0, markerStart).replace(/["“]+\s*$/g, "").trim();
  return {
    bookTitle,
    bookAuthor,
    cleanText: cleanText || text.trim(),
    rawText: text.trim(),
    // sawCopyright 仅用于内部判定，不导出
  } as AppleBooksExcerpt & { sawCopyright?: boolean };
}

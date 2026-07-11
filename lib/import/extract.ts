import JSZip from "jszip";

/** 提取结果:书名 + 按章节/页的纯文本 */
export interface ExtractedBook {
  title: string;
  sections: { title: string; text: string }[];
}

/** 供阅读器使用的章节:保留原始 HTML(图片以 data: URI 内联) */
export interface BookChapter {
  title: string;
  html: string;
}

export interface ExtractedBookForReading {
  title: string;
  chapters: BookChapter[];
  css: string;
}

/** 文件系统解压结果：章节索引 + 本地目录路径 */
export interface EpubFileSystemResult {
  title: string;
  author: string;
  /** Absolute path to the book's root directory (file:// URI base) */
  bookDir: string;
  /** Ordered chapter list with title and relative HTML file path */
  chapters: { title: string; filePath: string }[];
  /** Combined CSS content (font-face stripped) */
  css: string;
  /** Cover image file:// URI, if found */
  coverUri?: string;
}

/** 把 xhtml/html 转为按行组织的纯文本(块级标签断行,行内标签去壳) */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|dt|dd|table)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n## ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return s
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1) : "";
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = (base + rel).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** 解析 EPUB(zip):读 OPF spine 顺序,逐章提取文本 */
export async function extractEpub(data: ArrayBuffer): Promise<ExtractedBook> {
  const zip = await JSZip.loadAsync(data);

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("无效的 EPUB:缺少 container.xml");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("无效的 EPUB:找不到 OPF 路径");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error("无效的 EPUB:缺少 OPF 文件");
  const opfDir = dirOf(opfPath);

  const title =
    opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() ?? "";

  // manifest: id -> href
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const type = tag.match(/media-type="([^"]+)"/)?.[1] ?? "";
    if (id && href && /html|xml/i.test(type)) manifest.set(id, href);
  }

  // spine 顺序
  const idrefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);
  const hrefs = idrefs
    .map((id) => manifest.get(id))
    .filter((h): h is string => !!h);

  const sections: ExtractedBook["sections"] = [];
  for (const href of hrefs) {
    const path = resolvePath(opfDir, decodeURIComponent(href));
    const html = await zip.file(path)?.async("string");
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 40) continue;
    const heading =
      html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
      path.split("/").pop() ??
      "";
    sections.push({ title: heading, text });
  }
  if (sections.length === 0) throw new Error("EPUB 中未找到可读文本章节");
  return { title, sections };
}

/**
 * 解析 EPUB 供阅读器使用:保留原始 HTML 结构,将图片内联为 data: URI。
 * 单张图片 base64 超过 400KB 时跳过(保留 alt 占位)。
 */
export async function extractEpubForReading(data: ArrayBuffer): Promise<ExtractedBookForReading> {
  const zip = await JSZip.loadAsync(data);

  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("无效的 EPUB:缺少 container.xml");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("无效的 EPUB:找不到 OPF 路径");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error("无效的 EPUB:缺少 OPF 文件");
  const opfDir = dirOf(opfPath);

  const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() ?? "";

  // manifest: id -> { href, mediaType }
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const mediaType = tag.match(/media-type="([^"]+)"/)?.[1] ?? "";
    if (id && href) manifest.set(id, { href, mediaType });
  }

  // Collect CSS
  let css = "";
  for (const [, { href, mediaType }] of manifest) {
    if (!/css/i.test(mediaType)) continue;
    const path = resolvePath(opfDir, decodeURIComponent(href));
    const content = await zip.file(path)?.async("string");
    if (content) {
      // Strip @font-face and external font url() – fonts can't load in WebView sandbox
      const cleaned = content
        .replace(/@font-face\s*\{[^}]*\}/gi, "")
        .replace(/url\(['"]?[^'")\s]+\.(?:ttf|otf|woff2?|eot)[^'")\s]*['"]?\)/gi, "none");
      css += cleaned + "\n";
    }
  }

  // Image cache: epub-relative path -> data URI
  const imageCache = new Map<string, string>();
  const loadImage = async (epubPath: string): Promise<string | null> => {
    if (imageCache.has(epubPath)) return imageCache.get(epubPath)!;
    const file = zip.file(epubPath);
    if (!file) return null;
    const b64 = await file.async("base64");
    if (b64.length > 800_000) return null; // ~600KB uncompressed; skip very large images
    const ext = epubPath.split(".").pop()?.toLowerCase() ?? "jpg";
    const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : ext === "webp" ? "image/webp" : "image/jpeg";
    const uri = `data:${mime};base64,${b64}`;
    imageCache.set(epubPath, uri);
    return uri;
  };

  // spine order
  const idrefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);
  const spineItems = idrefs
    .map((id) => manifest.get(id))
    .filter((x): x is { href: string; mediaType: string } => !!x && /html|xml/i.test(x.mediaType));

  const chapters: BookChapter[] = [];
  for (const { href } of spineItems) {
    const path = resolvePath(opfDir, decodeURIComponent(href));
    const html = await zip.file(path)?.async("string");
    if (!html) continue;

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    let body = bodyMatch ? bodyMatch[1] : html;

    // Inline images
    const imgDir = dirOf(path);
    for (const m of [...body.matchAll(/\bsrc="([^"]+)"/gi)]) {
      const relPath = m[1];
      if (relPath.startsWith("data:") || relPath.startsWith("http")) continue;
      const imgPath = resolvePath(imgDir, decodeURIComponent(relPath));
      const dataUri = await loadImage(imgPath);
      if (dataUri) body = body.replace(m[0], `src="${dataUri}"`);
    }

    const heading =
      html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]?.replace(/<[^>]+>/g, "").trim()
      ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      ?? path.split("/").pop()?.replace(/\.x?html?$/i, "") ?? "";

    const textLen = body.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (textLen < 30) continue;

    chapters.push({ title: heading, html: body });
  }

  if (chapters.length === 0) throw new Error("EPUB 中未找到可读章节");
  return { title, chapters, css };
}

/**
 * 解析 PDF:pdfjs 按页取 text items,依据 y 坐标还原行结构。
 * 仅 Web 平台可用(pdfjs 依赖浏览器环境)。
 */
/**
 * 解析 EPUB 并将所有文件解压到本地文件系统目录。
 * 支持任意大小的书籍（1GB+），图片通过 file:// 协议按需加载，无需内存 Base64 转换。
 * 仅 Native 平台（iOS/Android）可用。
 *
 * 目录结构:
 *   {documentDirectory}/books/{bookId}/
 *     ├── content/          ← 原始 EPUB 文件结构（HTML + 图片 + CSS）
 *     ├── chapters.json     ← 章节索引
 *     └── meta.json         ← 书籍元数据
 */
export async function extractEpubToFileSystem(
  fileUriOrData: string | ArrayBuffer,
  bookId: string,
): Promise<EpubFileSystemResult> {
  const FileSystem = await import("expo-file-system/legacy");

  // Load ZIP: accept either a file URI (native) or ArrayBuffer (web fallback)
  let zip: JSZip;
  if (typeof fileUriOrData === "string") {
    // Native: read file as base64 in chunks to avoid OOM on large files
    const b64 = await FileSystem.readAsStringAsync(fileUriOrData, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Convert base64 to Uint8Array without creating a full ArrayBuffer copy
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    zip = await JSZip.loadAsync(bytes.buffer);
  } else {
    zip = await JSZip.loadAsync(fileUriOrData);
  }

  // Parse OPF
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("无效的 EPUB：缺少 container.xml");
  const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("无效的 EPUB：找不到 OPF 路径");
  const opf = await zip.file(opfPath)?.async("string");
  if (!opf) throw new Error("无效的 EPUB：缺少 OPF 文件");
  const opfDir = dirOf(opfPath);

  const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1]?.trim() ?? "";
  const author = opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i)?.[1]?.trim() ?? "";

  // Build manifest
  const manifest = new Map<string, { href: string; mediaType: string; properties?: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const mediaType = tag.match(/media-type="([^"]+)"/)?.[1] ?? "";
    const properties = tag.match(/\bproperties="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, { href, mediaType, properties });
  }

  // Create book directory
  const bookDir = `${FileSystem.documentDirectory}books/${bookId}/`;
  const contentDir = `${bookDir}content/`;
  await FileSystem.makeDirectoryAsync(contentDir, { intermediates: true });

  // Extract all files from ZIP to local filesystem
  const zipFiles = zip.files;
  const writePromises: Promise<void>[] = [];

  for (const [zipPath, zipEntry] of Object.entries(zipFiles)) {
    if (zipEntry.dir) continue;
    const localPath = `${contentDir}${zipPath}`;
    const localDir = dirOf(localPath);

    writePromises.push(
      (async () => {
        // Ensure directory exists
        await FileSystem.makeDirectoryAsync(localDir, { intermediates: true }).catch(() => {});
        // Write file
        const isText = /\.(html?|xhtml?|css|xml|opf|ncx|txt|json)$/i.test(zipPath);
        if (isText) {
          const content = await zipEntry.async("string");
          await FileSystem.writeAsStringAsync(localPath, content, {
            encoding: FileSystem.EncodingType.UTF8,
          });
        } else {
          const b64 = await zipEntry.async("base64");
          await FileSystem.writeAsStringAsync(localPath, b64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
      })(),
    );
  }

  // Write in batches of 20 to avoid overwhelming the FS
  for (let i = 0; i < writePromises.length; i += 20) {
    await Promise.all(writePromises.slice(i, i + 20));
  }

  // Collect CSS (strip font-face)
  let css = "";
  for (const [, { href, mediaType }] of manifest) {
    if (!/css/i.test(mediaType)) continue;
    const path = resolvePath(opfDir, decodeURIComponent(href));
    const content = await zip.file(path)?.async("string");
    if (content) {
      const cleaned = content
        .replace(/@font-face\s*\{[^}]*\}/gi, "")
        .replace(/url\(['"]?[^'")\s]+\.(?:ttf|otf|woff2?|eot)[^'")\s]*['"]?\)/gi, "none");
      css += cleaned + "\n";
    }
  }

  // Find cover image
  let coverUri: string | undefined;
  for (const [, { href, mediaType, properties }] of manifest) {
    if (properties === "cover-image" || /cover/i.test(href)) {
      if (/image/i.test(mediaType)) {
        const path = resolvePath(opfDir, decodeURIComponent(href));
        coverUri = `${contentDir}${path}`;
        break;
      }
    }
  }

  // Build chapter list from spine
  const idrefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);
  const spineItems = idrefs
    .map((id) => manifest.get(id))
    .filter((x): x is { href: string; mediaType: string } => !!x && /html|xml/i.test(x.mediaType));

  const chapters: EpubFileSystemResult["chapters"] = [];
  for (const { href } of spineItems) {
    const epubRelPath = resolvePath(opfDir, decodeURIComponent(href));
    const localFilePath = `${contentDir}${epubRelPath}`;
    // Read HTML to extract title and check if non-empty
    const html = await zip.file(epubRelPath)?.async("string");
    if (!html) continue;
    const textLen = html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    if (textLen < 30) continue;
    const heading =
      html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]?.replace(/<[^>]+>/g, "").trim()
      ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      ?? epubRelPath.split("/").pop()?.replace(/\.x?html?$/i, "") ?? "";
    chapters.push({ title: heading, filePath: localFilePath });
  }

  if (chapters.length === 0) throw new Error("EPUB 中未找到可读章节");

  // Save chapter index
  await FileSystem.writeAsStringAsync(
    `${bookDir}chapters.json`,
    JSON.stringify(chapters),
    { encoding: FileSystem.EncodingType.UTF8 },
  );

  return { title, author, bookDir, chapters, css, coverUri };
}

export async function extractPdf(data: ArrayBuffer): Promise<ExtractedBook> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  // Metro/Web 无独立 worker:加载 entry 使 pdfjs 走主线程 fake worker
  await import("pdfjs-dist/legacy/build/pdf.worker.entry" as string);

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: string } | undefined)?.Title ?? "";

  const sections: ExtractedBook["sections"] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines: { y: number; parts: { x: number; str: string }[] }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (line) line.parts.push({ x, str: item.str });
      else lines.push({ y, parts: [{ x, str: item.str }] });
    }
    lines.sort((a, b) => b.y - a.y);
    const text = lines
      .map((l) =>
        l.parts
          .sort((a, b) => a.x - b.x)
          .map((s) => s.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)
      .join("\n");
    if (text.length >= 20) sections.push({ title: `第 ${p} 页`, text });
    page.cleanup();
  }
  await doc.destroy();
  if (sections.length === 0) throw new Error("PDF 中未提取到文本(可能是扫描版图片 PDF)");
  return { title, sections };
}

/** OCR 用的图片(base64 不含 data: 前缀) */
export interface OcrImage {
  base64: string;
  mime: string;
}

/**
 * 把 PDF 页面渲染为 JPEG 图片(供扫描版 PDF 做 AI OCR)。
 * 仅 Web 平台可用(依赖 canvas)。
 */
export async function renderPdfPagesToImages(
  data: ArrayBuffer,
  opts: { maxPages?: number; scale?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<OcrImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  await import("pdfjs-dist/legacy/build/pdf.worker.entry" as string);

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const total = Math.min(doc.numPages, opts.maxPages ?? 40);
  const images: OcrImage[] = [];
  for (let p = 1; p <= total; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: opts.scale ?? 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 不可用");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    images.push({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/jpeg" });
    page.cleanup();
    opts.onProgress?.(p, total);
  }
  await doc.destroy();
  return images;
}

/** 从图片版 EPUB 中按顺序提取书页图片(跳过小图标,供 AI OCR) */
export async function extractEpubImages(data: ArrayBuffer, max = 24): Promise<OcrImage[]> {
  const zip = await JSZip.loadAsync(data);
  const entries: { path: string; file: JSZip.JSZipObject }[] = [];
  zip.forEach((path, file) => {
    if (!file.dir && /\.(jpe?g|png|webp)$/i.test(path)) entries.push({ path, file });
  });
  const out: OcrImage[] = [];
  for (const e of entries) {
    if (out.length >= max) break;
    const base64 = await e.file.async("base64");
    // 跳过小图标(<~15KB)与超过单张上限(~2.6MB)的图片
    if (base64.length < 20_000 || base64.length > 3_500_000) continue;
    const mime = /\.png$/i.test(e.path)
      ? "image/png"
      : /\.webp$/i.test(e.path)
        ? "image/webp"
        : "image/jpeg";
    out.push({ base64, mime });
  }
  return out;
}

/** 把图片按张数与请求体积预算分批(单批 ≤ maxCount 张且 base64 总长 ≤ budget) */
export function batchImagesForOcr(
  images: OcrImage[],
  maxCount = 6,
  budget = 11_000_000,
): OcrImage[][] {
  const batches: OcrImage[][] = [];
  let cur: OcrImage[] = [];
  let size = 0;
  for (const img of images) {
    if (cur.length > 0 && (cur.length >= maxCount || size + img.base64.length > budget)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(img);
    size += img.base64.length;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

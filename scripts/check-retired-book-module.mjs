import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const scanRoots = ["app", "lib", "components", "scripts"];
const allowedFiles = new Set([
  "app/_layout.tsx",
  "lib/migrations/purge-retired-book-library.ts",
  "lib/migrations/retired-book-cleaner-core.ts",
  "lib/migrations/retired-book-source-ref.ts",
  "lib/migrations/retired-book-storage.ts",
  "scripts/check-retired-book-module.mjs",
]);
const ignoredDirectories = new Set(["node_modules", ".git", "dist", "dist-web"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const forbidden = /cocktail\.books|books\.workspace|book-import|book-reader|lib\/books|useBookStore|BookStoreProvider|StoredBook|BookStore|bookSnippets|extractBookSnippets|offlineEntryToEnrichResult|lookupInOfflineKb|AppleBooksExcerpt|parseAppleBooks|pdfjs-dist|\bbookTitle\b|\bbookAuthor\b|\bchapterTitle\b|\bpublishYear\b|\bpageRef\b/i;

function walk(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolutePath));
    else result.push(absolutePath);
  }
  return result;
}

const violations = [];
for (const scanRoot of scanRoots) {
  for (const absolutePath of walk(join(root, scanRoot))) {
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
    const extension = relativePath.slice(relativePath.lastIndexOf("."));
    if (!sourceExtensions.has(extension) || allowedFiles.has(relativePath)) continue;
    const content = readFileSync(absolutePath, "utf8");
    if (forbidden.test(content)) violations.push(relativePath);
  }
}

if (violations.length > 0) {
  console.error(`[retired-book-module] 检测到已退役书库功能残留：\n${violations.map((path) => `- ${path}`).join("\n")}`);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, policy: "retired book module has no production residue" }, null, 2));

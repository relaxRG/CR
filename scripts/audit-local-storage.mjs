import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const sourceRoots = ["app", "components", "constants", "hooks", "lib", "server"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ignored = new Set(["node_modules", ".git", "dist", "dist-web", ".expo", "coverage"]);

function walk(directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (ignored.has(entry)) continue;
    const rel = join(directory, entry);
    const full = join(root, rel);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(rel));
    else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) files.push(rel.replace(/\\/g, "/"));
  }
  return files;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function valueExpression(source, index) {
  const snippet = source.slice(index, index + 320).replace(/\s+/g, " ");
  const match = snippet.match(/(?:setItem|setItemAsync)\s*\(\s*[^,]+,\s*([^,)]+(?:\([^)]*\))?)/);
  return match?.[1]?.trim() ?? "";
}

function literalKey(expression, constants, globalConstants) {
  const raw = expression.trim();
  const quoted = raw.match(/^(["'])(.*?)\1$/s);
  if (quoted) return { key: quoted[2], status: "resolved" };
  const template = raw.match(/^`([^`]+)`$/s);
  if (template) return {
    key: template[1].replace(/\$\{[^}]+\}/g, "{variable}"),
    status: template[1].includes("${") ? "pattern" : "resolved",
  };
  if (constants.has(raw)) return { key: constants.get(raw), status: "resolved" };
  if (globalConstants.has(raw)) return { key: globalConstants.get(raw), status: "resolved" };
  return { key: raw, status: "unresolved" };
}

const files = sourceRoots.flatMap(walk);
const globalConstants = new Map();
for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(["'`])([^"'`]+)\2/g)) {
    if (!globalConstants.has(match[1])) globalConstants.set(match[1], match[3]);
  }
}
const calls = [];
const factoryPattern = /createGenericInventoryStore\s*\(\s*(["'`][^,\n)]+["'`])/g;
const storagePattern = /\b(AsyncStorage|SecureStore|localStorage)\.(getItem|setItem|removeItem|multiGet|multiSet|multiRemove|getAllKeys|clear|getItemAsync|setItemAsync|deleteItemAsync)\s*\(\s*([^,\n)]+)/g;

for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(["'`])([^"'`]+)\2/g)) {
    constants.set(match[1], match[3]);
  }
  const typeHints = [...source.matchAll(/\b(?:export\s+)?(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .filter((name) => /(State|Store|Data|Record|Entry|Config|Settings|Info|Snapshot|Report|Item|Category|Payment|Balance|Template|Rule|Ticket|Session)/.test(name));

  for (const match of source.matchAll(storagePattern)) {
    const resolved = literalKey(match[3], constants, globalConstants);
    const operation = match[2];
    const value = /setItem/.test(operation) ? valueExpression(source, match.index ?? 0) : "";
    calls.push({
      backend: match[1], operation, key: resolved.key, status: resolved.status,
      file, line: lineAt(source, match.index ?? 0), value, structure: typeHints.join(", "),
    });
  }

  for (const match of source.matchAll(factoryPattern)) {
    const resolved = literalKey(match[1], constants, globalConstants);
    calls.push({
      backend: "AsyncStorage", operation: "factory-key", key: resolved.key, status: resolved.status,
      file, line: lineAt(source, match.index ?? 0), value: "GenericInventoryState", structure: "GenericInventoryState, GenericInventoryItem, PurchaseRecord, ConsumeRecord, MonthlySnapshot",
    });
  }
}

const grouped = new Map();
for (const call of calls) {
  const id = `${call.backend}|${call.key}`;
  const existing = grouped.get(id) ?? { backend: call.backend, key: call.key, status: call.status, calls: [] };
  existing.status = existing.status === "resolved" ? call.status : existing.status;
  existing.calls.push({ operation: call.operation, file: call.file, line: call.line, value: call.value, structure: call.structure });
  grouped.set(id, existing);
}

const records = [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key));
const unresolved = records.filter((record) => record.status === "unresolved");
const markdown = [
  "# 本地存储键与数据结构清单",
  "",
  `> 由 \`pnpm audit:storage\` 从生产源代码生成；生成时间：${new Date().toISOString()}。`,
  "> 本清单覆盖 `AsyncStorage`、`SecureStore`、Web `localStorage` 与通用库存工厂传入的键。`{variable}` 表示按运行时参数生成的键模式。",
  "",
  "## 已解析键",
  "",
  "| 后端 | Key / 模式 | 访问操作 | 序列化数据表达式 | TypeScript 结构线索 | 源文件 |",
  "|---|---|---|---|---|---|",
  ...records.filter((record) => record.status !== "unresolved").map((record) => {
    const operations = [...new Set(record.calls.map((call) => call.operation))].join(", ");
    const values = [...new Set(record.calls.map((call) => call.value).filter(Boolean))].join("；") || "读取或删除操作";
    const structures = [...new Set(record.calls.map((call) => call.structure).filter(Boolean))].join("；") || "见源文件的写入表达式";
    const locations = record.calls.map((call) => `\`${call.file}:${call.line}\``).join("<br>");
    return `| ${record.backend} | \`${record.key}\` | ${operations} | \`${values.replace(/`/g, "'")}\` | ${structures.replace(/\|/g, "/")} | ${locations} |`;
  }),
  "",
  "## 需要人工跟踪的动态键表达式",
  "",
  unresolved.length
    ? "| 后端 | 表达式 | 操作 | 源文件 |\n|---|---|---|---|\n" + unresolved.map((record) => {
      const locations = record.calls.map((call) => `\`${call.file}:${call.line}\``).join("<br>");
      return `| ${record.backend} | \`${record.key}\` | ${[...new Set(record.calls.map((call) => call.operation))].join(", ")} | ${locations} |`;
    }).join("\n")
    : "无。",
  "",
  "## 维护规则",
  "",
  "1. 新增或更名键后必须运行 `pnpm audit:storage` 并提交本清单。",
  "2. 业务状态写入必须使用当前结构；禁止在加载时补写或转换已退役字段。",
  "3. 删除键时应同步删除读取、写入、测试和本文档中的对应记录。",
  "4. 动态键必须使用稳定前缀，并在产生键的模块中以类型或接口说明其值结构。",
  "",
];

const output = { generatedAt: "deterministic-source-scan", records, unresolved };
writeFileSync(join(root, "docs/local-storage-schema.md"), markdown.join("\n"));
writeFileSync(join(root, "docs/local-storage-schema.json"), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ sourceFiles: files.length, keys: records.length, unresolved: unresolved.length }, null, 2));

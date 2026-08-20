import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const sourceRoots = ["app", "lib", "components", "assets"];
const blockedDataExtensions = new Set([".json", ".csv", ".tsv", ".xls", ".xlsx", ".pdf", ".doc", ".docx"]);
const ignoredSegments = new Set(["node_modules", ".git", "dist", "dist-web", "tests", "docs", "images"]);
const errors = [];

function walk(directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  const results = [];
  for (const entry of readdirSync(absolute)) {
    if (ignoredSegments.has(entry)) continue;
    const full = join(absolute, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) results.push(...walk(relative(root, full)));
    else results.push(relative(root, full));
  }
  return results;
}

const productionFiles = sourceRoots.flatMap(walk);
for (const file of productionFiles) {
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (blockedDataExtensions.has(extension)) {
    errors.push(`RELEASE_EMBEDDED_STRUCTURED_DATA_FORBIDDEN: ${file}`);
  }
}

for (const file of productionFiles.filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path))) {
  const source = readFileSync(join(root, file), "utf8");
  if (/from\s+["'][^"']*\/(tests|fixtures)\//.test(source) || /require\(["'][^"']*\/(tests|fixtures)\//.test(source)) {
    errors.push(`RELEASE_TEST_FIXTURE_IMPORT_FORBIDDEN: ${file}`);
  }
  if (/buildSample(?:Preps|Data)|importSamples|buildWaldorf|WALDORF_|offline-kb|waldorf-(?:recipes|ingredients|preps)/.test(source)) {
    errors.push(`RELEASE_LEGACY_EMBEDDED_DATA_REFERENCE: ${file}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  productionFiles: productionFiles.length,
  policy: "production package contains no structured business data or test fixtures",
}, null, 2));

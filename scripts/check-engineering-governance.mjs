import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const readJson = (relativePath) => JSON.parse(readFileSync(join(root, relativePath), "utf8"));
const failures = [];

const routeContract = readFileSync(join(root, "lib/navigation/route-contract.ts"), "utf8");
for (const fileName of readdirSync(join(root, "app/dev")).filter((file) => file.endsWith(".tsx"))) {
  const route = `/dev/${fileName.replace(/\.tsx$/, "")}`;
  if (!routeContract.includes(`path: "${route}"`) || !routeContract.includes("development_only")) {
    failures.push(`未声明开发路由：${route}`);
  }
}

const migrationPolicy = readJson("docs/migration-sunset-policy.json");
const declaredMigrations = new Map(migrationPolicy.migrations.map((entry) => [entry.file, entry]));
const migrationFiles = readdirSync(join(root, "lib/migrations")).filter((file) => file.endsWith(".ts"));
for (const fileName of migrationFiles) {
  if (fileName.startsWith("retired-") || fileName.endsWith("-core.ts") || fileName.endsWith("-storage.ts")) continue;
  const entry = declaredMigrations.get(fileName);
  if (!entry) {
    failures.push(`迁移未登记到期策略：${fileName}`);
    continue;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn) || Number.isNaN(Date.parse(`${entry.expiresOn}T00:00:00Z`))) {
    failures.push(`迁移到期日期无效：${fileName}`);
  }
  if (!entry.removalCondition?.trim()) failures.push(`迁移缺少删除条件：${fileName}`);
}

const anyBudget = readJson("docs/any-budget.json");
const grep = execFileSync("rg", ["-n", "--glob", "*.{ts,tsx}", "--glob", "!tests/**", "--glob", "!node_modules/**", "\\bany\\b", ...anyBudget.scope], { cwd: root, encoding: "utf8" });
const actualAny = grep.trim() ? grep.trim().split("\n").length : 0;
if (actualAny > anyBudget.maxExplicitAnyOccurrences) {
  failures.push(`显式 any 超出预算：${actualAny} > ${anyBudget.maxExplicitAnyOccurrences}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures, actualAny, budget: anyBudget.maxExplicitAnyOccurrences }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  developmentRoutes: readdirSync(join(root, "app/dev")).filter((file) => file.endsWith(".tsx")).length,
  governedMigrations: migrationPolicy.migrations.length,
  explicitAny: actualAny,
  anyBudget: anyBudget.maxExplicitAnyOccurrences,
}, null, 2));

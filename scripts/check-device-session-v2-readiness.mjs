import fs from "node:fs";
import path from "node:path";

const root = "/home/ubuntu/cocktail-r-build";
const workerDir = path.join(root, "workers/cocktail-ai");
const worker = fs.readFileSync(path.join(workerDir, "worker-v4.js"), "utf8");
const wrangler = fs.readFileSync(path.join(workerDir, "wrangler.jsonc"), "utf8");
const migrations = fs.readdirSync(path.join(workerDir, "migrations"));

const failures = [];
for (const route of [
  "/api/device/session-v2",
  "/api/device/update-policy-v2",
  "/api/device/recover-stale-owner",
  "/api/device/health/session-v2",
]) {
  if (!worker.includes(`"${route}"`)) failures.push(`Worker缺少五Tab会话路由：${route}`);
}
for (const marker of ["policyModel: \"five_business_tabs\"", "V2_BUSINESS_TABS", "normalizeRequestedTabs", "encodeBusinessTabs"]) {
  if (!worker.includes(marker)) failures.push(`Worker缺少五Tab策略标记：${marker}`);
}
for (const migration of [
  "20260819_device_session_v2.sql",
  "20260820_01_seed_v2_owner_policies.sql",
  "20260820_02_retire_legacy_device_permissions.sql",
  "20260821_01_migrate_device_policy_to_five_tabs.sql",
]) {
  if (!migrations.includes(migration)) failures.push(`缺少迁移：${migration}`);
}
if (/<(?:EXISTING|REPLACE|YOUR)_[A-Z0-9_]+>/.test(wrangler)) {
  failures.push("wrangler.jsonc仍包含绑定占位符；必须先填入现有D1/KV/R2资源ID，禁止直接部署。");
}
if (failures.length) {
  console.error("[device-session-v2-readiness] 未通过：\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("[device-session-v2-readiness] 通过：五Tab策略、恢复路由、迁移文件与发布绑定均已就绪。");

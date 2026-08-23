# `cocktail-archive-gc` Cloudflare 部署操作指南

**适用范围。** 本指南部署独立的 `cocktail-archive-gc` Worker。该 Worker 只按计划清理已达到保留期、且在 D1 中已存在 tombstone 的归档对象；它不提供公开文件下载入口，也不会自行创建或删除业务归档记录。当前仓库中的配置文件是 `workers/cocktail-ai/wrangler.archive-gc.jsonc`，入口为 `archive-gc-worker.js`，D1 迁移为 `migrations/20260823_archive_object_tombstones.sql`。

> **部署前提。** 先确认主同步 Worker 使用的 D1 数据库就是 `cocktail-r-db`，并确认用于原始 Excel 的 R2 bucket 是私有 bucket。不要把本机 Documents URI、设备 token、API token 或业务 Excel 放入 Wrangler 配置或 Git 仓库。

## 1. 变更前检查

在仓库根目录执行以下命令。先确认当前分支包含归档 GC 提交并且工作区干净，再检查已存在的 D1 和 R2 资源。

```bash
git pull --ff-only
node --check workers/cocktail-ai/archive-gc-worker.js
pnpm vitest run \
  tests/archive-tombstone-gc-worker.test.ts \
  tests/archive-gc-worker-policy.test.ts \
  tests/archive-remote-client-conflict.test.ts --reporter=dot

npx wrangler d1 list --json
npx wrangler d1 info cocktail-r-db --json
npx wrangler r2 bucket list
```

选择已存在的 D1 数据库 `cocktail-r-db`。若没有可复用的私有归档 bucket，再创建一个专用 bucket；创建动作会生成新的云端资源，应在变更窗口内执行。

```bash
npx wrangler r2 bucket create cocktail-r-archives-production
npx wrangler r2 bucket list
```

将最终 bucket 名记录在变更单中。该 bucket 不应配置公共域名、公共读取策略或将对象 key 当作访问凭据；应用侧后续必须由受 DeviceSessionV2 组权限保护的 API 签发短期访问能力。

## 2. 替换配置占位符

备份并编辑 `workers/cocktail-ai/wrangler.archive-gc.jsonc`。只替换以下两个占位符，不要改变 `name`、`main`、`workers_dev`、`triggers` 或绑定名称。

| 字段 | 替换为 | 不可替换为 |
|---|---|---|
| `d1_databases[0].database_id` | `cocktail-r-db` 对应的实际 D1 UUID | 数据库名称、API token 或空字符串 |
| `r2_buckets[0].bucket_name` | 已确认的私有归档 bucket 名称 | workers.dev URL、R2 S3 URL 或公开 bucket |

修改后，配置的关键部分应保持如下形式：

```jsonc
{
  "name": "cocktail-archive-gc",
  "main": "archive-gc-worker.js",
  "workers_dev": false,
  "d1_databases": [{
    "binding": "DB",
    "database_name": "cocktail-r-db",
    "database_id": "实际D1_UUID",
    "migrations_dir": "migrations"
  }],
  "r2_buckets": [{
    "binding": "ARCHIVES",
    "bucket_name": "实际私有R2桶名称"
  }],
  "triggers": { "crons": ["17 3 * * *"] }
}
```

该 cron 表达式表示每日 **03:17 UTC**。若需要按本地营业时区执行，应先换算为 UTC，再修改表达式；不要将 `crons` 字段删除。对 Wrangler 管理的 Worker，部署时配置中的 cron 列表会替换该 Worker 先前的 cron 配置。[1]

## 3. 先执行并验证 D1 迁移

在部署 Worker 前，先检查远端迁移状态并应用未执行的迁移。应用前导出仅包含 schema 的备份；不要将带业务数据的导出文件提交到仓库。

```bash
npx wrangler d1 export cocktail-r-db \
  --remote --no-data \
  --output /tmp/cocktail-r-db-schema-before-archive-gc.sql

npx wrangler d1 migrations list cocktail-r-db \
  --remote \
  --config workers/cocktail-ai/wrangler.archive-gc.jsonc

npx wrangler d1 migrations apply cocktail-r-db \
  --remote \
  --config workers/cocktail-ai/wrangler.archive-gc.jsonc
```

完成后，查询两个表和 GC 索引是否存在：

```bash
npx wrangler d1 execute cocktail-r-db --remote \
  --config workers/cocktail-ai/wrangler.archive-gc.jsonc \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('archive_entries','archive_tombstones');"

npx wrangler d1 execute cocktail-r-db --remote \
  --config workers/cocktail-ai/wrangler.archive-gc.jsonc \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_archive_tombstones_due';"
```

D1 迁移命令会显示待执行项；官方文档说明远端迁移应用会捕获备份，且迁移失败时该迁移将回滚，前一条成功迁移保持生效。[2]

## 4. 本地演练与生产部署

本地演练使用本地资源，不能代替生产 R2/D1 验证，但可检查 `scheduled()` 入口和绑定名称：

```bash
npx wrangler dev --config workers/cocktail-ai/wrangler.archive-gc.jsonc
# 新终端：
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

本地演练通过后，部署独立 Worker：

```bash
npx wrangler deploy --config workers/cocktail-ai/wrangler.archive-gc.jsonc
```

该 Worker 设置 `workers_dev: false`，因为它只需要计划任务，不需要公开 workers.dev 路由。配置文件是 Worker 绑定和触发器的唯一来源；`name`、`main` 与 `compatibility_date` 是部署所需核心字段。[3]

## 5. 生产验证与运行监控

部署后，在 Cloudflare Dashboard 的 **Workers & Pages → cocktail-archive-gc → Settings → Triggers** 检查 cron 是否为 `17 3 * * *`。Cron 配置变更可能需要最多约 15 分钟传播；Cron Events 的可见性也可能存在延迟。[1]

验证项目应包括：确认 `ARCHIVES` 是预期私有 bucket；确认 D1 中没有业务归档被错误标记为 tombstone；观察第一轮日志中的 `ArchiveGC completed`；检查 `archive_tombstones` 的 `purged_at`、`attempts` 与 `last_error`；并确认 R2 删除只发生在 `purge_after <= now`、无其他 `active` 条目引用相同 `object_key` 的记录上。

```bash
npx wrangler d1 execute cocktail-r-db --remote \
  --config workers/cocktail-ai/wrangler.archive-gc.jsonc \
  --command "SELECT entry_id, attempts, last_error, purged_at FROM archive_tombstones ORDER BY deleted_at DESC LIMIT 20;"
```

初次部署阶段没有 archive 写入 API 时，Worker 应当空跑而不删除任何对象；这是预期行为。不要通过手工伪造 tombstone 触发生产删除。应先在隔离测试组用专用测试对象验证端到端删除。

## 6. 故障处理与回退

若 Worker 日志出现 `ARCHIVE_GC_MISSING_DB_BINDING` 或 `ARCHIVE_GC_MISSING_ARCHIVES_BINDING`，立即停止后续部署，核对配置中绑定名必须分别为 `DB` 和 `ARCHIVES`。若出现 `INVALID_OBJECT_KEY`，保留 tombstone，不手工删除对象；它表示对象路径不满足 `groups/{groupId}/monthly-raw/` 的安全边界。若出现 `OBJECT_STILL_REFERENCED`，GC 已安全延迟，该对象仍被其他活跃归档引用，不能强制删除。

若发现逻辑错误，先在 Dashboard 回退 Worker 部署版本或临时将 `triggers.crons` 改为 `[]` 后重新部署以停止后续计划执行。不要通过删除 `archive_tombstones` 来“撤销”清理；tombstone 是跨设备删除事实。D1 迁移应采用新的向前修复迁移，不能依赖删除生产表回滚。

## 7. 变更完成标准

只有同时满足以下条件，才能把对象存储归档功能从“基础设施就绪”提升为“可供 App 使用”：客户端上传/下载 API 已实施并完成 DeviceSessionV2 组权限校验；归档索引同步的是 `objectKey` 与内容哈希而非本机 URI；条件写入能返回 `ARCHIVE_REVISION_CONFLICT` 与 `ENTRY_DELETED`；客户端已按冲突结果停止盲重试；隔离组已验证 tombstone、保留期、GC、慢设备和恢复为新条目的完整流程。

## References

[1] [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

[2] [Cloudflare Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

[3] [Cloudflare Workers Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

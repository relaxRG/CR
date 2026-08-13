# Cocktail AI Cloudflare Worker

本目录中的 `worker-v4.js` 源自用户于 2026-08-14 从 Cloudflare Dashboard 的 `cocktail-ai.kikikong2017.workers.dev` Worker 编辑器导出的当前生产版本 `worker-v3.js`。

线上 Worker 绑定 D1 数据库 `cocktail-r-db`。用户通过只读查询导出的现有核心表为：`device_groups`、`devices`、`pair_codes`、`sync_data`、`sync_tombstones`、`group_ts` 与 `photos`；另有 `ai_usage_log`、`app_config`、`balance_history`、`kv_cache` 等表。

`worker-v4.js` 是**待验证的本地工作副本**，已加入同步组原子切换、旧成员资格撤销、完整目标组快照和审计表的实现。它尚未部署。任何上线操作必须先完成本仓库测试、代码审阅和用户明确确认。

## 安全边界

- 既有业务数据不做迁移、不做跨组自动合并。
- 所有新增 D1 表和列均使用 `CREATE TABLE IF NOT EXISTS` 或可重复执行的 `ALTER TABLE` 兼容逻辑。
- 切组恢复票据仅保存哈希；Worker 审计表不记录业务数据、配对码或原始令牌。
- 上线前必须验证：旧令牌失效、主设备交接、目标组完整快照、断网恢复和 A 组数据零泄漏。

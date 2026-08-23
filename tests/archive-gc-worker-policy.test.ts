import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("归档对象墓碑GC部署策略", () => {
  it("独立Worker绑定D1与私有R2并设置定时触发，不混入主AI Worker", () => {
    const config = read("workers/cocktail-ai/wrangler.archive-gc.jsonc");
    expect(config).toContain('"name": "cocktail-archive-gc"');
    expect(config).toContain('"main": "archive-gc-worker.js"');
    expect(config).toContain('"binding": "DB"');
    expect(config).toContain('"binding": "ARCHIVES"');
    expect(config).toContain('"crons": ["17 3 * * *"]');
    expect(config).toContain("<EXISTING_PRIVATE_ARCHIVE_BUCKET>");
  });

  it("D1迁移同时维护权威归档条目、墓碑保留期、重试状态与查询索引", () => {
    const migration = read("workers/cocktail-ai/migrations/20260823_archive_object_tombstones.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS archive_entries");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS archive_tombstones");
    expect(migration).toContain("purge_after INTEGER NOT NULL");
    expect(migration).toContain("next_attempt_at INTEGER NOT NULL");
    expect(migration).toContain("idx_archive_tombstones_due");
  });
});

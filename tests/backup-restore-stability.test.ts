import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("备份恢复稳定性", () => {
  it("本地历史快照恢复将用户选择的槽位交给带事务日志的恢复API", () => {
    const screen = source("app/backup.tsx");

    expect(screen).toContain("restoreFromSnapshot");
    expect(screen).toContain("const handleSnapshotRestore = (slot: number");
    expect(screen).toContain("await restoreFromSnapshot(slot)");
    expect(screen).not.toContain("const handleSnapshotRestore = (_slot");
  });

  it("iCloud轮转槽位不污染备份schema版本，且恢复只操作同步键并移除空值键", () => {
    const backup = source("lib/backup/icloud-backup.ts");

    expect(backup).toContain("const BACKUP_SCHEMA_VERSION = 1");
    expect(backup).toContain("version: BACKUP_SCHEMA_VERSION");
    expect(backup).toContain("const allowedKeys = new Set<string>(SYNC_KEYS)");
    expect(backup).toContain("await AsyncStorage.multiRemove(removals)");
    expect(backup).toContain("await AsyncStorage.multiSet(writes)");
  });
});

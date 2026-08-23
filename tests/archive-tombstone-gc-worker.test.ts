import { describe, expect, it, vi } from "vitest";
import { isArchiveObjectKeyForGroup, runArchiveTombstoneGc } from "../workers/cocktail-ai/archive-gc-worker.js";

type Tombstone = {
  entry_id: string;
  group_id: string;
  object_key: string;
  attempts: number;
};

function createEnv(options: { tombstones: Tombstone[]; reference?: unknown; deleteError?: Error }) {
  const updates: Array<{ sql: string; values: unknown[] }> = [];
  const remove = vi.fn(async () => {
    if (options.deleteError) throw options.deleteError;
  });
  const DB = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            all: async () => ({ results: sql.includes("FROM archive_tombstones") ? options.tombstones : [] }),
            first: async () => sql.includes("FROM archive_entries") ? options.reference ?? null : null,
            run: async () => {
              updates.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { env: { DB, ARCHIVES: { delete: remove } }, remove, updates };
}

describe("归档墓碑GC Worker", () => {
  const tombstone: Tombstone = {
    entry_id: "archive-1",
    group_id: "group-a",
    object_key: "groups/group-a/monthly-raw/2026-08/revenue/1.xlsx",
    attempts: 0,
  };

  it("只删除到期、未被其他活跃条目引用的组内对象，并记录purged_at", async () => {
    const { env, remove, updates } = createEnv({ tombstones: [tombstone] });
    const summary = await runArchiveTombstoneGc(env, { now: 1000, batchSize: 10 });

    expect(summary).toEqual({ scanned: 1, purged: 1, deferredReferenced: 0, deferredInvalid: 0, retryScheduled: 0 });
    expect(remove).toHaveBeenCalledWith(tombstone.object_key);
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ sql: expect.stringContaining("SET purged_at = ?"), values: [1000, "archive-1", "group-a"] }),
    ]));
  });

  it("对象仍被另一条活跃归档引用时不物理删除，而是延迟复核", async () => {
    const { env, remove, updates } = createEnv({ tombstones: [tombstone], reference: { entry_id: "archive-2" } });
    const summary = await runArchiveTombstoneGc(env, { now: 1000 });

    expect(summary).toEqual({ scanned: 1, purged: 0, deferredReferenced: 1, deferredInvalid: 0, retryScheduled: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining("SET attempts = attempts + 1"),
        values: expect.arrayContaining(["OBJECT_STILL_REFERENCED"]),
      }),
    ]));
  });

  it("R2删除失败时保存错误并按退避时间重试；跨组或路径穿越对象键不会触达R2", async () => {
    const failing = createEnv({ tombstones: [tombstone], deleteError: new Error("temporary R2 outage") });
    const failed = await runArchiveTombstoneGc(failing.env, { now: 1000 });
    expect(failed.retryScheduled).toBe(1);
    expect(failing.remove).toHaveBeenCalledTimes(1);
    expect(failing.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining("SET attempts = attempts + 1"),
        values: expect.arrayContaining(["R2_DELETE_FAILED:temporary R2 outage"]),
      }),
    ]));

    const invalid = createEnv({ tombstones: [{ ...tombstone, object_key: "groups/group-b/monthly-raw/../../secret.xlsx" }] });
    const rejected = await runArchiveTombstoneGc(invalid.env, { now: 1000 });
    expect(rejected.deferredInvalid).toBe(1);
    expect(invalid.remove).not.toHaveBeenCalled();
    expect(isArchiveObjectKeyForGroup("groups/group-a/monthly-raw/2026-08/a.xlsx", "group-a")).toBe(true);
    expect(isArchiveObjectKeyForGroup("groups/group-b/monthly-raw/2026-08/a.xlsx", "group-a")).toBe(false);
  });
});

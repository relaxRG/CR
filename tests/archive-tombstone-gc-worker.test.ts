import { describe, expect, it, vi } from "vitest";
import { isArchiveObjectKeyForGroup, runArchiveOrphanReconciliation, runArchiveTombstoneGc } from "../workers/cocktail-ai/archive-gc-worker.js";

type Tombstone = {
  entry_id: string;
  group_id: string;
  object_key: string;
  attempts: number;
};

function createEnv(options: {
  tombstones: Tombstone[];
  reference?: unknown;
  referencesByObjectKey?: Readonly<Record<string, unknown>>;
  deleteError?: Error;
}) {
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
            first: async () => sql.includes("FROM archive_entries")
              ? options.referencesByObjectKey?.[String(values[1])] ?? options.reference ?? null
              : null,
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

  it("同一批次中只清理无引用的到期墓碑，并独立延迟仍引用或非法路径记录", async () => {
    const activeObject = "groups/group-a/monthly-raw/2026-08/revenue/2.xlsx";
    const { env, remove, updates } = createEnv({
      tombstones: [
        tombstone,
        { ...tombstone, entry_id: "archive-2", object_key: activeObject },
        { ...tombstone, entry_id: "archive-3", object_key: "groups/group-b/monthly-raw/../../secret.xlsx" },
      ],
      referencesByObjectKey: { [activeObject]: { entry_id: "active-reference" } },
    });

    const summary = await runArchiveTombstoneGc(env, { now: 1000, batchSize: 3 });

    expect(summary).toEqual({ scanned: 3, purged: 1, deferredReferenced: 1, deferredInvalid: 1, retryScheduled: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(tombstone.object_key);
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ values: expect.arrayContaining(["OBJECT_STILL_REFERENCED"]) }),
      expect.objectContaining({ values: expect.arrayContaining(["INVALID_OBJECT_KEY"]) }),
      expect.objectContaining({ values: expect.arrayContaining([1000, "archive-1", "group-a"]) }),
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

  it("R2先写D1后失败且即时删除也失败时，超过宽限期的无索引对象会被协调任务清理", async () => {
    const orphan = "groups/group-a/monthly-raw/objects/orphan-op.xlsx";
    const active = "groups/group-a/monthly-raw/objects/active-op.xlsx";
    const protectedObject = "groups/group-a/monthly-raw/objects/deleted-op.xlsx";
    const fresh = "groups/group-a/monthly-raw/objects/fresh-op.xlsx";
    const remove = vi.fn(async () => undefined);
    const env = {
      ARCHIVES: {
        delete: remove,
        list: vi.fn(async () => ({ objects: [
          { key: orphan, uploaded: new Date(0) },
          { key: active, uploaded: new Date(0) },
          { key: protectedObject, uploaded: new Date(0) },
          { key: fresh, uploaded: new Date(19_500) },
          { key: "groups/group-a/monthly-raw/2026-08/legacy.xlsx", uploaded: new Date(0) },
        ] })),
      },
      DB: {
        prepare(sql: string) {
          return {
            bind(...values: unknown[]) {
              return {
                first: async () => {
                  const objectKey = String(values[1]);
                  if (sql.includes("FROM archive_entries") && objectKey === active) return { entry_id: "active-entry" };
                  if (sql.includes("FROM archive_tombstones") && objectKey === protectedObject) return { entry_id: "deleted-entry" };
                  return null;
                },
              };
            },
          };
        },
      },
    };

    const summary = await runArchiveOrphanReconciliation(env, { now: 20_000, graceMs: 1_000 });
    expect(summary).toEqual({ scanned: 4, deleted: 1, retainedActive: 1, retainedTombstone: 1, skippedFresh: 1, skippedUnmanaged: 1 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(orphan);
  });

  it("孤儿对象在15分钟宽限期内保留，恰满15分钟后才具备清理资格", async () => {
    const key = "groups/group-a/monthly-raw/objects/boundary-op.xlsx";
    const remove = vi.fn(async () => undefined);
    const env = {
      ARCHIVES: {
        delete: remove,
        list: vi.fn(async () => ({ objects: [{ key, uploaded: new Date(0) }] })),
      },
      DB: {
        prepare() {
          return { bind() { return { first: async () => null }; } };
        },
      },
    };

    const before = await runArchiveOrphanReconciliation(env, { now: 15 * 60 * 1000 - 1 });
    expect(before).toEqual(expect.objectContaining({ deleted: 0, skippedFresh: 1 }));
    expect(remove).not.toHaveBeenCalled();

    const atBoundary = await runArchiveOrphanReconciliation(env, { now: 15 * 60 * 1000 });
    expect(atBoundary).toEqual(expect.objectContaining({ deleted: 1, skippedFresh: 0 }));
    expect(remove).toHaveBeenCalledWith(key);
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

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const REFERENCE_RETRY_MS = 60 * 60 * 1000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function assertBinding(env, binding) {
  if (!env[binding]) throw new Error(`ARCHIVE_GC_MISSING_${binding}_BINDING`);
}

export function isArchiveObjectKeyForGroup(objectKey, groupId) {
  return typeof objectKey === "string"
    && typeof groupId === "string"
    && groupId.length > 0
    && objectKey.startsWith(`groups/${groupId}/monthly-raw/`)
    && !objectKey.includes("..")
    && !objectKey.startsWith("/");
}

export function retryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(8, Number(attempts) || 0));
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

async function deferTombstone(env, tombstone, now, reason, delayMs) {
  await env.DB.prepare(
    `UPDATE archive_tombstones
       SET attempts = attempts + 1,
           last_error = ?,
           next_attempt_at = ?
     WHERE entry_id = ? AND group_id = ? AND purged_at IS NULL`,
  ).bind(reason, now + delayMs, tombstone.entry_id, tombstone.group_id).run();
}

/**
 * 清理已超过保留期的归档对象。
 * D1 tombstone 是删除事实的唯一权威；R2 删除是可重试、幂等的副作用。
 */
export async function runArchiveTombstoneGc(env, options = {}) {
  assertBinding(env, "DB");
  assertBinding(env, "ARCHIVES");

  const now = options.now ?? Date.now();
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, options.batchSize ?? DEFAULT_BATCH_SIZE));
  const rows = await env.DB.prepare(
    `SELECT entry_id, group_id, object_key, attempts
       FROM archive_tombstones
      WHERE purged_at IS NULL
        AND purge_after <= ?
        AND next_attempt_at <= ?
      ORDER BY purge_after ASC, entry_id ASC
      LIMIT ?`,
  ).bind(now, now, batchSize).all();

  const summary = {
    scanned: rows.results.length,
    purged: 0,
    deferredReferenced: 0,
    deferredInvalid: 0,
    retryScheduled: 0,
  };

  for (const tombstone of rows.results) {
    if (!isArchiveObjectKeyForGroup(tombstone.object_key, tombstone.group_id)) {
      await deferTombstone(env, tombstone, now, "INVALID_OBJECT_KEY", RETRY_MAX_MS);
      summary.deferredInvalid += 1;
      continue;
    }

    const reference = await env.DB.prepare(
      `SELECT entry_id
         FROM archive_entries
        WHERE group_id = ?
          AND object_key = ?
          AND status = 'active'
          AND entry_id <> ?
        LIMIT 1`,
    ).bind(tombstone.group_id, tombstone.object_key, tombstone.entry_id).first();
    if (reference) {
      await deferTombstone(env, tombstone, now, "OBJECT_STILL_REFERENCED", REFERENCE_RETRY_MS);
      summary.deferredReferenced += 1;
      continue;
    }

    try {
      // R2 delete 对不存在对象也应成功，因此Worker崩溃后的重试是安全的。
      await env.ARCHIVES.delete(tombstone.object_key);
      await env.DB.prepare(
        `UPDATE archive_tombstones
            SET purged_at = ?, last_error = NULL
          WHERE entry_id = ? AND group_id = ? AND purged_at IS NULL`,
      ).bind(now, tombstone.entry_id, tombstone.group_id).run();
      summary.purged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "R2_DELETE_FAILED";
      await deferTombstone(env, tombstone, now, `R2_DELETE_FAILED:${message}`, retryDelayMs(tombstone.attempts));
      summary.retryScheduled += 1;
    }
  }

  return Object.freeze(summary);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ status: "ok", worker: "archive-gc" });
    return json({ error: "NOT_FOUND" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runArchiveTombstoneGc(env)
        .then((summary) => console.log("[ArchiveGC] completed", JSON.stringify(summary)))
        .catch((error) => console.error("[ArchiveGC] failed", error instanceof Error ? error.message : "unknown")),
    );
  },
};

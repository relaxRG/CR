CREATE TABLE IF NOT EXISTS archive_entries (
  entry_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  month TEXT NOT NULL,
  file_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, group_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_entries_group_object
  ON archive_entries (group_id, object_key);
CREATE INDEX IF NOT EXISTS idx_archive_entries_group_status
  ON archive_entries (group_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS archive_tombstones (
  entry_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_by_device_id TEXT NOT NULL,
  delete_operation_id TEXT NOT NULL,
  supersedes_revision INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('user_delete', 'retention')),
  purge_after INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  purged_at INTEGER,
  PRIMARY KEY (entry_id, group_id),
  UNIQUE (group_id, delete_operation_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_tombstones_due
  ON archive_tombstones (purged_at, purge_after, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_archive_tombstones_object
  ON archive_tombstones (group_id, object_key, purged_at);

-- 条件提交的幂等操作记录：同一同步组内同一 operation_id 必须返回已提交的权威响应。
CREATE TABLE IF NOT EXISTS archive_operations (
  operation_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (operation_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_operations_group_entry
  ON archive_operations (group_id, entry_id, created_at DESC);

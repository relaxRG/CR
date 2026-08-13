-- 同步组原子切换：仅新增协议状态与审计结构。
-- 本迁移不读取、更新、删除或迁移任何现有业务数据。

CREATE TABLE IF NOT EXISTS group_switches (
  switch_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'committed', 'cancelled')),
  source_device_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  target_group_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  target_token TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_platform TEXT,
  target_role TEXT NOT NULL,
  target_allowed_keys TEXT,
  handoff_device_id TEXT,
  pair_code TEXT NOT NULL,
  recovery_ticket_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  cancelled_at INTEGER,
  last_error_code TEXT
);

CREATE TABLE IF NOT EXISTS group_switch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  switch_id TEXT NOT NULL,
  event TEXT NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL
);

ALTER TABLE pair_codes ADD COLUMN reserved_switch_id TEXT;
ALTER TABLE pair_codes ADD COLUMN reserved_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_group_switches_source
  ON group_switches(source_device_id, state);
CREATE INDEX IF NOT EXISTS idx_pair_code_reservations
  ON pair_codes(reserved_switch_id);

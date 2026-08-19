-- DeviceSessionV2 cutover: delete the legacy per-device storage-key permission columns.
-- Deploy this only with the V2 Worker and V2 App release; old clients must be upgraded first.

-- group_switches was historically created lazily by Worker. Creating the legacy-shaped table only
-- for first-time databases lets the same migration safely remove the retired column immediately.
CREATE TABLE IF NOT EXISTS group_switches (
  switch_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  target_group_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  target_token TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_platform TEXT,
  target_role TEXT NOT NULL,
  target_allowed_keys TEXT,
  target_capabilities_json TEXT NOT NULL DEFAULT '[]',
  handoff_device_id TEXT,
  pair_code TEXT NOT NULL,
  recovery_ticket_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  cancelled_at INTEGER,
  last_error_code TEXT
);

ALTER TABLE devices DROP COLUMN allowed_keys;
ALTER TABLE pair_codes DROP COLUMN allowed_keys;
ALTER TABLE group_switches DROP COLUMN target_allowed_keys;

-- V2 policies are the only authorization source after this point.
CREATE INDEX IF NOT EXISTS idx_device_policies_group_revision
  ON device_policies(group_id, revision);
CREATE INDEX IF NOT EXISTS idx_group_switches_source
  ON group_switches(source_device_id, state);
CREATE INDEX IF NOT EXISTS idx_pair_code_policies_group
  ON pair_code_policies(group_id, created_at);

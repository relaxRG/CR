-- 价格异常云端协同账本。只保存告警事实与状态，不保存完整酒款资料或采购原文。
CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  sync_group_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  bottle_id TEXT NOT NULL,
  channel_id TEXT,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  price REAL,
  reference_price REAL,
  delta REAL,
  delta_percent REAL,
  unit TEXT,
  detail TEXT NOT NULL,
  source TEXT NOT NULL,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  detected_count INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  resolution TEXT,
  suppression_until TEXT,
  operation_id TEXT,
  updated_by_device_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sync_group_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_price_alerts_group_status ON price_alerts(sync_group_id, status, severity, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_alerts_bottle ON price_alerts(sync_group_id, bottle_id, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS price_alert_runs (
  id TEXT PRIMARY KEY,
  sync_group_id TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by_device_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_alert_runs_group ON price_alert_runs(sync_group_id, started_at DESC);

CREATE TABLE IF NOT EXISTS price_alert_notification_log (
  id TEXT PRIMARY KEY,
  sync_group_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(alert_id, channel)
);

-- DeviceSessionV2：设备策略与组策略版本。
-- 业务数据、设备令牌和历史同步记录不在本迁移中删除；删除旧 allowed_keys 列仅在所有客户端切换 V2 并完成受控部署后执行。

CREATE TABLE IF NOT EXISTS device_policies (
  device_id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  capabilities_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  FOREIGN KEY(device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_policies_group ON device_policies(group_id);

CREATE TABLE IF NOT EXISTS group_policy_revisions (
  group_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_policy_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  actor_device_id TEXT,
  event_type TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_policy_audit_group_time ON device_policy_audit(group_id, created_at DESC);

-- 配对码在目标设备注册前暂存能力策略；配对成功后原子写入 device_policies。
CREATE TABLE IF NOT EXISTS pair_code_policies (
  code TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(code) REFERENCES pair_codes(code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pair_code_policies_group ON pair_code_policies(group_id, created_at);

-- group_switches 的 target_capabilities_json 由 Worker 的 ensureSwitchSchema 幂等创建/升级，
-- 以兼容尚未首次使用组切换功能的新数据库。

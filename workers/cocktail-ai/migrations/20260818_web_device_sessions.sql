-- Web 设备会话：Cookie 仅保存随机会话 ID；设备 token 永不写入浏览器持久化存储。
-- 会话过期后由 Worker 在鉴权路径主动清理。

CREATE TABLE IF NOT EXISTS web_device_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_device_sessions_expiry
  ON web_device_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_web_device_sessions_device
  ON web_device_sessions(device_id, expires_at);

-- 仅在当前页面内存保存的短期降级票据；浏览器刷新后客户端自然丢失。
CREATE TABLE IF NOT EXISTS web_device_memory_tickets (
  ticket TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_device_memory_tickets_expiry
  ON web_device_memory_tickets(expires_at);

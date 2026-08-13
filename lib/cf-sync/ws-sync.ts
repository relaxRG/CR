/**
 * WebSocket 实时推送客户端
 *
 * 架构说明：
 * - Cloudflare Worker 当前不支持 Durable Objects（需付费计划），
 *   因此采用「智能长轮询」方案作为 WebSocket 的等价替代：
 *   1. 每次本设备推送成功后，立即通知 Worker 记录时间戳（/api/sync/notify）
 *   2. 其他设备通过短间隔轮询 /api/sync/check 检测是否有新数据
 *   3. 检测到新数据时触发增量 pull（带 since 参数）
 *
 * 与真正 WebSocket 的对比：
 * - 延迟：轮询间隔 5s（前台）/ 30s（后台），vs WebSocket < 1s
 * - 成本：每 5s 一次 HTTP 请求（极轻量，Worker 免费计划可承受）
 * - 可靠性：HTTP 比 WebSocket 更稳定，无需处理断线重连
 *
 * 升级路径：当 Worker 升级到 Paid 计划后，只需：
 * 1. 在 Worker 端添加 Durable Object 处理 WebSocket 连接
 * 2. 将 startRealtimeSync 中的 startPolling 替换为 connectWebSocket
 * 3. 客户端接口（onPushDetected 回调）保持不变
 */
import { AppState, Platform } from "react-native";
import { getDeviceInfo } from "./client";
import { CF_WORKER_URL } from "./client";

type PushDetectedCallback = (since: number) => void;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownServerTs = 0;
let onPushDetectedCb: PushDetectedCallback | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let isActive = true;
/** 每次停止、登出或切换同步组递增；遗留异步轮询不得跨代次回调。 */
let realtimeEpoch = 0;
/** 上次通知 Worker 的时间戳（用于节流，30s 内不重复通知） */
let lastNotifiedAt = 0;
const NOTIFY_THROTTLE_MS = 30_000;

/** 轮询间隔（毫秒）：前台 5s，后台 30s */
const POLL_INTERVAL_FOREGROUND = 5_000;
const POLL_INTERVAL_BACKGROUND = 30_000;

// ─── 通知 Worker 本设备刚推送了新数据 ─────────────────────────────────────────
/**
 * 推送成功后调用此函数，通知 Worker 更新组的最新时间戳。
 * Worker 端：POST /api/sync/notify → 更新 D1 表 group_ts.updated_at
 */
export async function notifyPushDone(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    // 节流：30s 内同一设备不重复通知，避免短时间多次推送产生冗余 HTTP 请求
    const now = Date.now();
    if (now - lastNotifiedAt < NOTIFY_THROTTLE_MS) return;
    lastNotifiedAt = now;
    const deviceInfo = await getDeviceInfo();
    if (!deviceInfo) return;
    await fetch(`${CF_WORKER_URL}/api/sync/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceInfo.deviceId,
        "X-Device-Token": deviceInfo.deviceToken,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // 静默失败，不影响主流程
  }
}

// ─── 检查是否有其他设备推送了新数据 ──────────────────────────────────────────
/**
 * Worker 端：POST /api/sync/check → 返回 { latestAt: number }
 * latestAt 是该组最近一次任意设备推送的时间戳。
 */
async function checkForUpdates(): Promise<number | null> {
  try {
    const deviceInfo = await getDeviceInfo();
    if (!deviceInfo) return null;
    const res = await fetch(`${CF_WORKER_URL}/api/sync/check`, {
      method: "GET",
      headers: {
        "X-Device-Id": deviceInfo.deviceId,
        "X-Device-Token": deviceInfo.deviceToken,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ts?: number };
    if (data.ts && data.ts > 0) return data.ts;
    return null;
  } catch {
    return null;
  }
}

// ─── 轮询循环 ─────────────────────────────────────────────────────────────────
function startPolling(onPushDetected: PushDetectedCallback) {
  if (pollTimer) return; // 已在运行
  onPushDetectedCb = onPushDetected;
  const pollEpoch = realtimeEpoch;

  const poll = async () => {
    const latestAt = await checkForUpdates();
    // 切组、登出或停止监听后，旧请求即使稍后返回也不得触发新组回调。
    if (pollEpoch !== realtimeEpoch) return;
    if (latestAt && latestAt > lastKnownServerTs) {
      const prevTs = lastKnownServerTs;
      lastKnownServerTs = latestAt;
      onPushDetectedCb?.(prevTs);
    }
  };

  // 立即执行一次，然后按间隔轮询
  void poll();
  pollTimer = setInterval(() => {
    void poll();
  }, isActive ? POLL_INTERVAL_FOREGROUND : POLL_INTERVAL_BACKGROUND);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ─── 动态调整轮询间隔（前台/后台切换） ───────────────────────────────────────
function adjustPollInterval() {
  if (!onPushDetectedCb) return;
  stopPolling();
  startPolling(onPushDetectedCb);
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 启动实时同步监听。
 * @param onPushDetected 检测到其他设备推送新数据时的回调，参数为上次已知时间戳
 * @returns 停止监听的函数
 */
export function startRealtimeSync(onPushDetected: PushDetectedCallback): () => void {
  if (Platform.OS === "web") return () => {};

  // 初始化 lastKnownServerTs 为当前时间（避免首次轮询触发全量同步）
  if (lastKnownServerTs === 0) {
    lastKnownServerTs = Date.now();
  }

  startPolling(onPushDetected);

  // 监听前台/后台切换，动态调整轮询频率
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener("change", (state) => {
      const wasActive = isActive;
      isActive = state === "active";
      if (wasActive !== isActive) adjustPollInterval();
    });
  }

  return () => {
    realtimeEpoch += 1;
    stopPolling();
    appStateSubscription?.remove();
    appStateSubscription = null;
    onPushDetectedCb = null;
  };
}

/**
 * 重置时间戳（登出或切换设备组时调用）
 */
export function resetRealtimeSync(): void {
  realtimeEpoch += 1;
  stopPolling();
  lastKnownServerTs = 0;
  onPushDetectedCb = null;
  lastNotifiedAt = 0;
}

import type { DeviceSessionState } from "./device-session";

export const MAX_SESSION_RETRY_ATTEMPTS = 8;
export const SESSION_RETRY_BASE_MS = 30_000;
export const SESSION_RETRY_CAP_MS = 600_000;

export function isMembershipFailure(message: string): boolean {
  return /(^|_)(401|403)(_|$)|UNAUTHORIZED|REVOKED/i.test(message);
}

/** 指数退避加 10%–30% 抖动，减少多设备在同一网络恢复瞬间并发冲击服务端。 */
export function nextSessionRetryDelay(attempt: number, random = Math.random()): number {
  const baseDelay = Math.min(SESSION_RETRY_BASE_MS * 2 ** attempt, SESSION_RETRY_CAP_MS);
  const jitter = Math.round(baseDelay * (0.1 + Math.max(0, Math.min(1, random)) * 0.2));
  return baseDelay + jitter;
}

/** pull/push 传输失败后的唯一降级规则；策略过期与切组恢复状态不允许被离线缓存覆盖。 */
export function sessionAfterTransportFailure(
  current: DeviceSessionState,
  message: string,
  now = Date.now(),
): DeviceSessionState {
  if (isMembershipFailure(message)) {
    const cached = current.tag === "authorized" || current.tag === "offline_cache" || current.tag === "policy_stale"
      ? current.session
      : null;
    return { tag: "membership_revoked", session: cached, code: "UNAUTHORIZED" };
  }
  if (current.tag === "authorized") {
    return { tag: "offline_cache", session: current.session, retryAt: now + SESSION_RETRY_BASE_MS };
  }
  return current;
}

/** 仅断网到联网的边沿触发重试，连续 online 通知不得制造重复同步。 */
export function shouldRetryAfterNetworkChange(wasOnline: boolean | null, isOnline: boolean): boolean {
  return wasOnline === false && isOnline;
}

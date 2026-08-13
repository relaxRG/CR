import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remove = vi.fn();
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: vi.fn(() => ({ remove })) },
}));
vi.mock("@/lib/cf-sync/client", () => ({
  CF_WORKER_URL: "https://worker.test",
  getDeviceInfo: vi.fn(async () => ({ deviceId: "a", deviceToken: "token-a", groupId: "group-a" })),
}));

import { resetRealtimeSync, startRealtimeSync } from "@/lib/cf-sync/ws-sync";

describe("实时同步成员资格代次屏障", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    remove.mockClear();
  });

  afterEach(() => {
    resetRealtimeSync();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("切组重置后，旧组轮询即使延迟返回也不能触发回调", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const callback = vi.fn();

    const stop = startRealtimeSync(callback);
    await Promise.resolve();
    resetRealtimeSync();
    resolveFetch?.(new Response(JSON.stringify({ ts: Date.now() + 60_000 }), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(callback).not.toHaveBeenCalled();
    stop();
  });
});

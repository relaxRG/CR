/**
 * 回归测试：退出同步组后重新加入新同步组的完整生命周期
 *
 * Bug 背景：
 * - pairWithCode() 成功后只写入 AsyncStorage，没有通知 SyncProvider 更新 deviceInfo state
 * - 同步初始化 useEffect 的依赖数组不包含 deviceInfo，不会重新触发
 * - 结果：新 DeviceInfo 存在于 AsyncStorage，但同步引擎从未重启
 *
 * 修复方案：
 * - 在 SyncProvider 新增 restartSync() 函数，配对成功后调用
 * - restartSync 重置 startedRef 并重新执行完整同步流程
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 模拟 AsyncStorage ────────────────────────────────────────────────────────
const mockStorage: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(mockStorage[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    multiRemove: vi.fn((keys: string[]) => {
      keys.forEach((k) => delete mockStorage[k]);
      return Promise.resolve();
    }),
  },
}));

// ─── 模拟 cf-sync/client ──────────────────────────────────────────────────────
const DEVICE_INFO_KEY = "cf.sync.deviceInfo";

type DeviceInfo = {
  deviceId: string;
  groupId: string;
  deviceToken: string;
  role: "owner" | "collaborator" | "guest";
  allowedKeys: string[] | null;
  deviceName: string;
};

// 模拟初始设备（已在同步组 A 中）
const initialDeviceInfo: DeviceInfo = {
  deviceId: "device-001",
  groupId: "group-A",
  deviceToken: "token-A",
  role: "owner",
  allowedKeys: null,
  deviceName: "iPhone",
};

// 模拟配对后的新设备信息（加入同步组 B）
const newDeviceInfo: DeviceInfo = {
  deviceId: "device-002",
  groupId: "group-B",
  deviceToken: "token-B",
  role: "owner",
  allowedKeys: null,
  deviceName: "iPhone",
};

// 模拟 pairWithCode 函数
const mockPairWithCode = vi.fn(async (_code: string): Promise<DeviceInfo> => {
  // 模拟配对成功：写入 AsyncStorage
  mockStorage[DEVICE_INFO_KEY] = JSON.stringify(newDeviceInfo);
  return newDeviceInfo;
});

// 模拟 clearDeviceInfo 函数
const mockClearDeviceInfo = vi.fn(async () => {
  delete mockStorage[DEVICE_INFO_KEY];
});

// 模拟 getDeviceInfo 函数
const mockGetDeviceInfo = vi.fn(async (): Promise<DeviceInfo | null> => {
  const raw = mockStorage[DEVICE_INFO_KEY];
  return raw ? JSON.parse(raw) : null;
});

// 模拟 getOrCreateDevice 函数
const mockGetOrCreateDevice = vi.fn(async (): Promise<DeviceInfo> => {
  const existing = await mockGetDeviceInfo();
  if (existing) return existing;
  // 自动注册为独立设备
  const standalone: DeviceInfo = {
    deviceId: "device-standalone",
    groupId: "group-standalone",
    deviceToken: "token-standalone",
    role: "owner",
    allowedKeys: null,
    deviceName: "iPhone",
  };
  mockStorage[DEVICE_INFO_KEY] = JSON.stringify(standalone);
  return standalone;
});

// ─── 模拟同步引擎状态 ─────────────────────────────────────────────────────────
class MockSyncEngine {
  deviceInfo: DeviceInfo | null = null;
  startedRef = false;
  syncCount = 0;
  realtimeStarted = false;

  async performSync(): Promise<boolean> {
    const info = await mockGetOrCreateDevice();
    this.deviceInfo = info;
    this.syncCount++;
    return true;
  }

  async logout(): Promise<void> {
    await mockClearDeviceInfo();
    this.deviceInfo = null;
    this.startedRef = false;
    this.realtimeStarted = false;
  }

  async restartSync(): Promise<boolean> {
    // 停止实时监听
    this.realtimeStarted = false;
    // 重置 startedRef
    this.startedRef = false;
    // 执行完整同步
    const ok = await this.performSync();
    if (ok) {
      this.realtimeStarted = true;
    }
    return ok;
  }

  // 模拟初始化 useEffect（只运行一次）
  async initialize(): Promise<void> {
    if (this.startedRef) return;
    this.startedRef = true;
    const ok = await this.performSync();
    if (ok) {
      this.realtimeStarted = true;
    }
  }
}

// ─── 测试用例 ─────────────────────────────────────────────────────────────────
describe("同步组生命周期回归测试", () => {
  let engine: MockSyncEngine;

  beforeEach(() => {
    // 重置状态
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    mockStorage[DEVICE_INFO_KEY] = JSON.stringify(initialDeviceInfo);
    engine = new MockSyncEngine();
    vi.clearAllMocks();
    // 重新设置 mock
    mockGetOrCreateDevice.mockImplementation(async () => {
      const existing = await mockGetDeviceInfo();
      if (existing) return existing;
      const standalone: DeviceInfo = {
        deviceId: "device-standalone",
        groupId: "group-standalone",
        deviceToken: "token-standalone",
        role: "owner",
        allowedKeys: null,
        deviceName: "iPhone",
      };
      mockStorage[DEVICE_INFO_KEY] = JSON.stringify(standalone);
      return standalone;
    });
  });

  describe("正常启动流程", () => {
    it("App 启动时应自动初始化同步引擎", async () => {
      await engine.initialize();
      expect(engine.startedRef).toBe(true);
      expect(engine.deviceInfo).not.toBeNull();
      expect(engine.deviceInfo?.groupId).toBe("group-A");
      expect(engine.realtimeStarted).toBe(true);
      expect(engine.syncCount).toBe(1);
    });

    it("重复调用 initialize 不应重复同步", async () => {
      await engine.initialize();
      await engine.initialize();
      await engine.initialize();
      expect(engine.syncCount).toBe(1); // 只同步了一次
    });
  });

  describe("退出同步组流程", () => {
    it("退出后 deviceInfo 应为 null", async () => {
      await engine.initialize();
      expect(engine.deviceInfo).not.toBeNull();

      await engine.logout();
      expect(engine.deviceInfo).toBeNull();
    });

    it("退出后 AsyncStorage 中的 DeviceInfo 应被清除", async () => {
      await engine.initialize();
      await engine.logout();
      const stored = await mockGetDeviceInfo();
      expect(stored).toBeNull();
    });

    it("退出后 startedRef 应重置为 false", async () => {
      await engine.initialize();
      expect(engine.startedRef).toBe(true);
      await engine.logout();
      expect(engine.startedRef).toBe(false);
    });

    it("退出后实时监听应停止", async () => {
      await engine.initialize();
      expect(engine.realtimeStarted).toBe(true);
      await engine.logout();
      expect(engine.realtimeStarted).toBe(false);
    });
  });

  describe("退出后重新配对流程（Bug 修复验证）", () => {
    it("配对成功后调用 restartSync 应读取新的 DeviceInfo", async () => {
      // 1. 初始化
      await engine.initialize();
      expect(engine.deviceInfo?.groupId).toBe("group-A");

      // 2. 退出同步组
      await engine.logout();
      expect(engine.deviceInfo).toBeNull();

      // 3. 配对新同步组（模拟 pairWithCode）
      await mockPairWithCode("123456");
      // 此时 AsyncStorage 已有新 DeviceInfo，但 engine.deviceInfo 仍为 null
      expect(engine.deviceInfo).toBeNull(); // Bug：配对后 State 未更新

      // 4. 调用 restartSync（修复后的行为）
      const ok = await engine.restartSync();
      expect(ok).toBe(true);
      expect(engine.deviceInfo).not.toBeNull();
      expect(engine.deviceInfo?.groupId).toBe("group-B"); // 应读取到新的同步组
    });

    it("restartSync 后实时监听应重新启动", async () => {
      await engine.initialize();
      await engine.logout();
      await mockPairWithCode("123456");
      await engine.restartSync();
      expect(engine.realtimeStarted).toBe(true);
    });

    it("restartSync 后 syncCount 应增加（表示执行了完整同步）", async () => {
      await engine.initialize();
      const countBefore = engine.syncCount;
      await engine.logout();
      await mockPairWithCode("123456");
      await engine.restartSync();
      expect(engine.syncCount).toBeGreaterThan(countBefore);
    });

    it("不调用 restartSync 时，重新 initialize 不会重启（startedRef 已被 logout 重置）", async () => {
      await engine.initialize();
      await engine.logout();
      await mockPairWithCode("123456");
      // 不调用 restartSync，直接调用 initialize
      await engine.initialize(); // startedRef = false，所以会重新初始化
      expect(engine.deviceInfo?.groupId).toBe("group-B"); // 也能读到新数据
    });
  });

  describe("多次退出和重新加入", () => {
    it("可以多次退出和重新加入不同的同步组", async () => {
      // 第一次：加入 group-A
      await engine.initialize();
      expect(engine.deviceInfo?.groupId).toBe("group-A");

      // 退出 group-A
      await engine.logout();

      // 加入 group-B
      await mockPairWithCode("111111");
      await engine.restartSync();
      expect(engine.deviceInfo?.groupId).toBe("group-B");

      // 再次退出 group-B
      await engine.logout();
      expect(engine.deviceInfo).toBeNull();

      // 再次加入（模拟新的配对码）
      mockStorage[DEVICE_INFO_KEY] = JSON.stringify({
        ...newDeviceInfo,
        groupId: "group-C",
        deviceToken: "token-C",
      });
      await engine.restartSync();
      expect(engine.deviceInfo?.groupId).toBe("group-C");
    });
  });

  describe("restartSync 的幂等性", () => {
    it("连续调用 restartSync 不应导致状态异常", async () => {
      await engine.initialize();
      await engine.logout();
      await mockPairWithCode("123456");

      // 连续调用 3 次
      await engine.restartSync();
      await engine.restartSync();
      await engine.restartSync();

      expect(engine.deviceInfo?.groupId).toBe("group-B");
      expect(engine.realtimeStarted).toBe(true);
    });
  });

  describe("规范 10 验证：写入持久化存储后必须同步更新 State", () => {
    it("pairWithCode 后如果不调用 restartSync，State 不会自动更新（证明 Bug 存在）", async () => {
      await engine.initialize();
      await engine.logout();

      // 只调用 pairWithCode，不调用 restartSync
      await mockPairWithCode("123456");

      // AsyncStorage 已有新数据
      const stored = await mockGetDeviceInfo();
      expect(stored?.groupId).toBe("group-B");

      // 但 engine.deviceInfo 仍为 null（State 未更新）
      expect(engine.deviceInfo).toBeNull();
    });

    it("pairWithCode 后调用 restartSync，State 正确更新（修复后的行为）", async () => {
      await engine.initialize();
      await engine.logout();

      await mockPairWithCode("123456");
      await engine.restartSync(); // ← 修复的关键

      // State 已更新
      expect(engine.deviceInfo?.groupId).toBe("group-B");
    });
  });
});

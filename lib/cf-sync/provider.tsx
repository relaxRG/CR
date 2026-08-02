/**
 * CF 同步 Provider（方案 C+）
 * 替换原来基于 OAuth 的 SyncProvider，使用设备配对码实现无账号云同步。
 *
 * 兼容原有 useSync() hook 接口，上层组件无需修改。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import {
  cfPull,
  cfPush,
  clearDeviceInfo,
  getDeviceInfo,
  getOrCreateDevice,
  type DeviceInfo,
  type DeviceRole,
} from "./client";
import {
  disableSync,
  getSyncState,
  runInitialSync,
  subscribeSyncState,
  type SyncState,
  triggerStoreReload,
} from "@/lib/sync/engine";
import { createSnapshot } from "@/lib/backup/local-backup";
import { startAutoBackup } from "@/lib/backup/icloud-backup";
import { syncPhotos } from "@/lib/sync/photo-sync";

// ─── Context type (compatible with original useSync) ─────────────────────────
type SyncContextValue = {
  syncState: SyncState;
  accessAllowed: boolean | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  /** CF device info (replaces OAuth user) */
  user: { id: number; name: string | null; email: string | null } | null;
  /** Open pair code modal to add this device to an existing group */
  login: () => void;
  logout: () => Promise<void>;
  /** CF-specific extras */
  deviceInfo: DeviceInfo | null;
  deviceRole: DeviceRole | null;
  /** Last sync error message (registration or pull/push failure), null when healthy */
  syncError: string | null;
  /** Manually retry full sync (register if needed → pull → merge → push) */
  retrySync: () => Promise<boolean>;
  /** Trigger pair code flow (owner generates code for new device) */
  openPairModal: () => void;
  /** Open device management screen */
  openDeviceManager: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

type SyncProviderProps = {
  children: React.ReactNode;
  /** Called when user taps "add device" (show pair code input modal) */
  onRequestPair?: () => void;
  /** Called when user taps "manage devices" */
  onRequestDeviceManager?: () => void;
};

export function SyncProvider({
  children,
  onRequestPair,
  onRequestDeviceManager,
}: SyncProviderProps) {
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  useEffect(() => subscribeSyncState(setSyncState), []);

  // Build push function using CF API
  const pushFn = useCallback(
    async (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => {
      await cfPush(entries);
    },
    [],
  );

  // Full sync pipeline: register (if needed) → pull → merge → push.
  // Returns true on success. Safe to call repeatedly (guarded by syncingRef).
  const performSync = useCallback(async (): Promise<boolean> => {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    try {
      // Get or create device identity (auto-registers as owner on first run)
      const info = await getOrCreateDevice();
      setDeviceInfo(info);
      setAuthLoading(false);

      // ── Backup channels ────────────────────────────────────────────────
      // 1. Create local snapshot (channel 3)
      void createSnapshot().catch((e) =>
        console.warn("[CFSync] local snapshot failed:", e),
      );
      // 2. Start local-documents auto-backup every 5 min (channel 2).
      //    Note: writes to app documentDirectory (included in iCloud device
      //    backup, NOT cross-device iCloud Drive sync).
      startAutoBackup(info.deviceName);
      // ───────────────────────────────────────────────────────────────────

     if (info.role === "guest") {
      // Guest devices: pull only, no push
      const { entries } = await cfPull();
       const guestOverwritten = await runInitialSync(entries, async () => {
         // no-op push for guests — read-only devices don't push
       });
       if (guestOverwritten && Platform.OS === "web" && typeof window !== "undefined") {
         window.location.reload();
       } else if (guestOverwritten && Platform.OS !== "web") {
         triggerStoreReload();
       }
    } else {
       // Owner / collaborator: full sync
       const { entries } = await cfPull();
       const overwritten = await runInitialSync(entries, pushFn);
       if (overwritten && Platform.OS === "web" && typeof window !== "undefined") {
         window.location.reload();
       } else if (overwritten && Platform.OS !== "web") {
         triggerStoreReload();
       }
     }
      // 成品照片同步（非阻塞）：上传本地新照片、下载云端缺失照片并修复路径。
      // 下载/路径修复发生后触发 store 重载，让详情页立即显示照片。
      void syncPhotos()
        .then(({ downloaded, repaired }) => {
          if ((downloaded > 0 || repaired) && Platform.OS !== "web") {
            triggerStoreReload();
          }
        })
        .catch(() => {});
     setSyncError(null);
     retryCountRef.current = 0;
     lastSyncAtRef.current = Date.now();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[CFSync] sync failed:", msg);
      setSyncError(msg);
      // Non-blocking: app works offline
      setAuthLoading(false);
      return false;
    } finally {
      syncingRef.current = false;
    }
  }, [pushFn]);

  // Auto-retry with exponential backoff: 30s * 2^n, capped at 10 min, max 8 attempts
  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (retryCountRef.current >= 8) return;
    const delay = Math.min(30_000 * 2 ** retryCountRef.current, 600_000);
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(async () => {
      const ok = await performSync();
      if (!ok) scheduleRetry();
    }, delay);
  }, [performSync]);

  // Manual retry exposed to UI (e.g. device manager "Sync Now" button)
  const retrySync = useCallback(async (): Promise<boolean> => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    const ok = await performSync();
    if (!ok) scheduleRetry();
    return ok;
  }, [performSync, scheduleRetry]);

  // Initialize on mount
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const ok = await performSync();
      if (!ok) scheduleRetry();
    })();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [performSync, scheduleRetry]);

  // Bug 5 修复：前台激活自动同步。
  // 此前 pull 只在冷启动执行一次，iOS App 常驻后台多天时永远拉不到其它设备
  // （如 Mac）推送的更新。现在监听 AppState：每次回到前台（active）且距上次
  // 成功同步超过 60 秒时，自动执行一轮完整同步（pull → LWW merge → push）。
  // Web 端用 visibilitychange + focus 实现同等行为。
  useEffect(() => {
    const syncIfStale = () => {
      if (Date.now() - lastSyncAtRef.current < 60_000) return;
      void performSync();
    };
    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      const onVisible = () => {
        if (document.visibilityState === "visible") syncIfStale();
      };
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("focus", syncIfStale);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", syncIfStale);
      };
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncIfStale();
    });
    return () => sub.remove();
  }, [performSync]);

  // "login" = enter pair code to join an existing group
  const login = useCallback(() => {
    onRequestPair?.();
  }, [onRequestPair]);

  // "logout" = remove device identity (leaves the sync group)
  const logout = useCallback(async () => {
    disableSync();
    await clearDeviceInfo();
    setDeviceInfo(null);
    setSyncError(null);
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    startedRef.current = false;
  }, []);

  const openPairModal = useCallback(() => {
    onRequestPair?.();
  }, [onRequestPair]);

  const openDeviceManager = useCallback(() => {
    onRequestDeviceManager?.();
  }, [onRequestDeviceManager]);

  // Build a user-like object for compatibility with existing UI
  const user = deviceInfo
    ? {
        id: 1,
        name: deviceInfo.deviceName,
        email: null,
      }
    : null;

  return (
    <SyncContext.Provider
      value={{
        syncState,
        accessAllowed: deviceInfo ? true : null,
        isAuthenticated: !!deviceInfo,
        authLoading,
        user,
        login,
        logout,
        deviceInfo,
        deviceRole: deviceInfo?.role ?? null,
        syncError,
        retrySync,
        openPairModal,
        openDeviceManager,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}

export function useCFSync() {
  return useSync();
}

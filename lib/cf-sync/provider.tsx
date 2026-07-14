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
import { Platform } from "react-native";
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
  const startedRef = useRef(false);

  useEffect(() => subscribeSyncState(setSyncState), []);

  // Build push function using CF API
  const pushFn = useCallback(
    async (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => {
      await cfPush(entries);
    },
    [],
  );

  // Initialize: get or create device, then run initial sync
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Get or create device identity (auto-registers as owner on first run)
        const info = await getOrCreateDevice();
        if (cancelled) return;
        setDeviceInfo(info);
        setAuthLoading(false);

        // ── 5D: Start backup channels ──────────────────────────────────────
        // 1. Create local snapshot (channel 3)
        void createSnapshot().catch((e) =>
          console.warn("[CFSync] local snapshot failed:", e),
        );
        // 2. Start iCloud Drive auto-backup every 5 min (channel 2)
        startAutoBackup(info.deviceName);
        // ──────────────────────────────────────────────────────────────────

        // Guest devices: pull only, no push
        if (info.role === "guest") {
          const { entries } = await cfPull();
          if (cancelled) return;
          // For guests, just write remote data locally without enabling push
          await runInitialSync(entries, async () => {
            // no-op push for guests
          });
          return;
        }

        // Owner / collaborator: full sync
        const { entries } = await cfPull();
        if (cancelled) return;
        const overwritten = await runInitialSync(entries, pushFn);
        if (overwritten && Platform.OS === "web" && typeof window !== "undefined") {
          window.location.reload();
        } else if (overwritten && Platform.OS !== "web") {
          triggerStoreReload();
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[CFSync] initial sync failed:", err);
        // Non-blocking: app works offline
        setAuthLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pushFn]);

  // "login" = enter pair code to join an existing group
  const login = useCallback(() => {
    onRequestPair?.();
  }, [onRequestPair]);

  // "logout" = remove device identity (leaves the sync group)
  const logout = useCallback(async () => {
    disableSync();
    await clearDeviceInfo();
    setDeviceInfo(null);
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

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
import { Alert, AppState, Platform } from "react-native";
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
import { resolveConflict, clearSyncError, type SyncConflict } from "@/lib/sync/engine";
import { createSnapshot } from "@/lib/backup/local-backup";
import { startAutoBackup } from "@/lib/backup/icloud-backup";
import { syncPhotos } from "@/lib/sync/photo-sync";
import { useI18n } from "@/lib/i18n";

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
  /** 用户查看同步日志后调用，清除错误状态（消除红点角标） */
  dismissSyncError: () => void;
  /** 是否有未解决的同步冲突（用于角标显示） */
  hasPendingConflicts: boolean;
  /** 刷新本地设备信息（重命名后调用） */
  refreshDeviceInfo: () => Promise<void>;
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
  const [pendingConflicts, setPendingConflicts] = useState<SyncConflict[]>([]);
  const { lang } = useI18n();
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

  // 冲突解决：逐个弹出 Alert 让用户选择
  useEffect(() => {
    if (pendingConflicts.length === 0) return;
    const conflict = pendingConflicts[0];
    const label = STORAGE_KEY_LABELS[conflict.storageKey] ?? conflict.storageKey;
    const localTime = new Date(conflict.localTs).toLocaleTimeString();
    const remoteTime = new Date(conflict.remoteTs).toLocaleTimeString();
    const isEn = lang === "en";
    Alert.alert(
      isEn ? "Sync Conflict" : "同步冲突",
      isEn
        ? `"${label}" was modified on two devices at nearly the same time:\n\nLocal: ${localTime}\nCloud: ${remoteTime}\n\nWhich version would you like to keep?`
        : `「${label}」在两台设备上几乎同时被修改：\n\n本机版本：${localTime}\n云端版本：${remoteTime}\n\n请选择保留哪一方：`,
      [
        {
          text: isEn ? "Keep Local" : "保留本机",
          style: "default",
          onPress: () => {
            void resolveConflict(conflict, true, pushFn ?? (async () => {}));
            setPendingConflicts((prev) => prev.slice(1));
          },
        },
        {
          text: isEn ? "Use Cloud" : "采用云端",
          style: "destructive",
          onPress: () => {
            void resolveConflict(conflict, false, pushFn ?? (async () => {}));
            setPendingConflicts((prev) => prev.slice(1));
          },
        },
      ],
      { cancelable: false },
    );
  }, [pendingConflicts, pushFn, lang]);

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
      if (info.role !== "owner") { void checkAndNotifyPermissionChange(info.allowedKeys); }

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
       const { overwritten: guestOverwritten, conflicts: guestConflicts } = await runInitialSync(entries, async () => {
        // no-op push for guests — read-only devices don't push
      });
      if (guestOverwritten && Platform.OS === "web" && typeof window !== "undefined") {
        window.location.reload();
      } else if (guestOverwritten && Platform.OS !== "web") {
        triggerStoreReload();
      }
      if (guestConflicts.length > 0) {
        setPendingConflicts(guestConflicts);
      }
    } else {
      // Owner / collaborator: full sync
      const { entries } = await cfPull();
       const { overwritten, conflicts } = await runInitialSync(entries, pushFn);
       if (overwritten && Platform.OS === "web" && typeof window !== "undefined") {
        window.location.reload();
      } else if (overwritten && Platform.OS !== "web") {
        triggerStoreReload();
      }
      if (conflicts.length > 0) {
        setPendingConflicts(conflicts);
      }
    }
      // 成品照片同步（非阻塞）：上传本地新照片、下载云端缺失照片并修复路径。
      // 下载/路径修复发生后触发 store 重载，让详情页立即显示照片。
      void syncPhotos()
        .then(({ downloaded, repaired, oversized }) => {
          if ((downloaded > 0 || repaired) && Platform.OS !== "web") {
            triggerStoreReload();
          }
          if (oversized > 0) {
            console.warn(`[CFSync] ${oversized} photo(s) skipped (too large to sync)`);
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

  const dismissSyncError = useCallback(() => {
    setSyncError(null);
    clearSyncError();
  }, []);

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
        dismissSyncError,
        hasPendingConflicts: pendingConflicts.length > 0,
        refreshDeviceInfo: async () => {
          const info = await getDeviceInfo();
          setDeviceInfo(info);
        },
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

/** 存储键 → 用户可读名称（用于冲突弹框） */
const STORAGE_KEY_LABELS: Record<string, string> = {
  "cocktail.recipes": "配方库",
  "cocktail.categories": "分类",
  "cocktail.tags": "标签",
  "cocktail.tagGroups": "标签分组",
  "cocktail.categoryGroups": "分类分组",
  "cocktail.bottles": "酒款库",
  "homemade.preps.v1": "自制库",
  "homemade.sections.v1": "自制分区",
  "homemade.types.v1": "自制类型",
  "homemade.taxonomy.v2": "自制分类体系",
  "bottles.taxonomy.categories.v1": "酒款分类",
  "bottles.taxonomy.styles.v1": "酒款风格",
  "cocktail.lab.projects": "研发项目",
  "cocktail.lab.batches": "研发批次",
  "cocktail.books.v1": "书库",
  "menu_store_v1": "门店酒单",
  "shopping_store_v1": "采购清单",
  "cocktail.iceSettings.v2": "冰块设置",
  "app.lang.v1": "语言设置",
};
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── 权限变更检测 ─────────────────────────────────────────────────────────────
const PREV_ALLOWED_KEYS_STORAGE = "cf.sync.prevAllowedKeys.v1";
const LANG_STORAGE_KEY = "app.lang.v1";
async function checkAndNotifyPermissionChange(newAllowedKeys: string[] | null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PREV_ALLOWED_KEYS_STORAGE);
    if (raw === null) {
      await AsyncStorage.setItem(PREV_ALLOWED_KEYS_STORAGE, JSON.stringify(newAllowedKeys));
      return;
    }
    const prev: string[] | null = JSON.parse(raw);
    const prevJson = JSON.stringify(prev?.slice().sort() ?? null);
    const newJson = JSON.stringify(newAllowedKeys?.slice().sort() ?? null);
    if (prevJson !== newJson) {
      await AsyncStorage.setItem(PREV_ALLOWED_KEYS_STORAGE, JSON.stringify(newAllowedKeys));
      const lang = await AsyncStorage.getItem(LANG_STORAGE_KEY).catch(() => null);
      const isEn = lang === "en";
      Alert.alert(
        isEn ? "Permissions Updated" : "权限已更新",
        isEn
          ? "The administrator has updated your device permissions. Some features may be restricted or newly available. Contact the owner device if you have questions."
          : "管理员已修改您的设备权限，部分功能可能受限或已开放。如有疑问请联系主设备管理员。",
        [{ text: isEn ? "OK" : "知道了" }],
      );
    }
  } catch {}
}

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
  type DeviceInfo,
  type DeviceRole,
} from "./client";
import {
  disableSync,
  getSyncState,
  runInitialSync,
  subscribeSyncState,
  resolveConflict,
  resolveAllConflicts,
  clearSyncError,
  triggerStoreReload,
  type SyncState,
  type SyncConflict,
} from "@/lib/sync/engine";
import { createSnapshot } from "@/lib/backup/local-backup";
import { startAutoBackup } from "@/lib/backup/icloud-backup";
import { syncPhotos } from "@/lib/sync/photo-sync";
import { useI18n } from "@/lib/i18n";
import { startRealtimeSync, notifyPushDone, resetRealtimeSync } from "./ws-sync";
import { recoverPendingGroupSwitch, switchToAnotherGroup, type GroupSwitchRuntime } from "./group-switch";

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
  /** Manually retry the currently active group. Unpaired local mode never auto-creates a group. */
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
  /**
   * 重启同步引擎（退出同步组后重新配对时调用）
   * 会重置 startedRef 并重新执行完整同步流程（读取新 DeviceInfo → pull → merge → push）
   */
  restartSync: () => Promise<boolean>;
  /** 加入另一个同步组；主设备可选择先把原组主角色交接给其他活跃设备。 */
  switchToAnotherGroup: (code: string, handoffDeviceId?: string) => Promise<void>;
  /** 正在执行原子切组或冷启动补偿时禁用高风险设备管理操作。 */
  isGroupSwitching: boolean;
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
  const [isGroupSwitching, setIsGroupSwitching] = useState(false);
  const { lang } = useI18n();
  const startedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const syncingRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const stopRealtimeRef = useRef<(() => void) | null>(null);

  useEffect(() => subscribeSyncState(setSyncState), []);

  // Build push function using CF API
  const pushFn = useCallback(
    async (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => {
      // Collaborator devices: filter entries to only allowed keys
      const info = deviceInfo;
      const filtered =
        info && info.role === "collaborator" && Array.isArray(info.allowedKeys)
          ? entries.filter((e) => (info.allowedKeys as string[]).includes(e.storageKey))
          : entries;
      if (filtered.length === 0) return;
      await cfPush(filtered);
      // 推送成功后通知其他设备（非阻塞）
      void notifyPushDone();
    },
    [deviceInfo],
  );

  const groupSwitchRuntime: GroupSwitchRuntime = {
    stopSourceRealtime: () => {
      stopRealtimeRef.current?.();
      stopRealtimeRef.current = null;
      resetRealtimeSync();
    },
    setActiveMembership: (membership) => setDeviceInfo(membership),
    // 首次水合必须仅下载目标组照片，禁止旧组文件被上传到新成员资格。
    syncTargetPhotosReadOnly: async () => {
      await syncPhotos(undefined, "download-only");
    },
    createTargetPush: (membership) => async (entries) => {
      const filtered = membership.role === "collaborator" && Array.isArray(membership.allowedKeys)
        ? entries.filter((entry) => (membership.allowedKeys as string[]).includes(entry.storageKey))
        : entries;
      if (filtered.length === 0 || membership.role === "guest") return;
      await cfPush(filtered);
      void notifyPushDone();
    },
  };

  // ★ 冲突解决：升级版—显示数据预览和自动推荐
  useEffect(() => {
    if (pendingConflicts.length === 0) return;
    const conflict = pendingConflicts[0];
    const label = STORAGE_KEY_LABELS[conflict.storageKey] ?? conflict.storageKey;
    const localTime = new Date(conflict.localTs).toLocaleTimeString();
    const remoteTime = new Date(conflict.remoteTs).toLocaleTimeString();
    const localPreview = getDataPreview(conflict.localValue, conflict.storageKey);
    const remotePreview = getDataPreview(conflict.remoteValue, conflict.storageKey);
    const rec = getConflictRecommendation(
      conflict.localValue, conflict.localTs,
      conflict.remoteValue, conflict.remoteTs,
    );
    const remaining = pendingConflicts.length;
    const isEn = lang === "en";
    const recHint = rec === "remote"
      ? (isEn ? "\n\n💡 Recommended: Use Cloud (newer & more data)" : "\n\n💡 建议：采用云端版本（更新且数据更多）")
      : rec === "local"
      ? (isEn ? "\n\n💡 Recommended: Keep Local (newer & more data)" : "\n\n💡 建议：保留本机版本（更新且数据更多）")
      : "";
    const countHint = remaining > 1
      ? (isEn ? `\n(${remaining} conflicts remaining)` : `\n（还有 ${remaining} 个冲突需要处理）`)
      : "";
    // 如果有多个冲突，提供「全部保留本机」和「全部采用云端」一键处理按鈕
    const hasMultiple = remaining > 1;
    const resolveAll = (keepLocal: boolean) => {
      const allConflicts = pendingConflicts;
      // 使用批量冲突解决函数：一次 push，一次 triggerStoreReload，避免 N 次网络请求
      void resolveAllConflicts(allConflicts, keepLocal, pushFn ?? (async () => {}));
      setPendingConflicts([]);
    };
    Alert.alert(
      isEn ? `Sync Conflict` : `同步冲突`,
      isEn
        ? `"${label}" was modified on two devices:\n\nLocal (${localTime}): ${localPreview}\nCloud (${remoteTime}): ${remotePreview}${recHint}${countHint}`
        : `「${label}」在两台设备上被修改：\n\n本机（${localTime}）：${localPreview}\n云端（${remoteTime}）：${remotePreview}${recHint}${countHint}`,
      [
        {
          text: isEn
            ? `Keep Local${rec === "local" ? " ✓" : ""}`
            : `保留本机${rec === "local" ? " ✓推荐" : ""}`,
          style: rec === "remote" ? "destructive" : "default",
          onPress: () => {
            void resolveConflict(conflict, true, pushFn ?? (async () => {}));
            setPendingConflicts((prev) => prev.slice(1));
          },
        },
        {
          text: isEn
            ? `Use Cloud${rec === "remote" ? " ✓" : ""}`
            : `采用云端${rec === "remote" ? " ✓推荐" : ""}`,
          style: rec === "local" ? "destructive" : "default",
          onPress: () => {
            void resolveConflict(conflict, false, pushFn ?? (async () => {}));
            setPendingConflicts((prev) => prev.slice(1));
          },
        },
        // 当有多个冲突时，显示一键处理全部的按鈕
        ...(hasMultiple ? [
          {
            text: isEn
              ? `Keep ALL Local (×${remaining})`
              : `全部保留本机（一键处理 ${remaining} 个）`,
            style: "default" as const,
            onPress: () => resolveAll(true),
          },
          {
            text: isEn
              ? `Use ALL Cloud (×${remaining})`
              : `全部采用云端（一键处理 ${remaining} 个）`,
            style: "destructive" as const,
            onPress: () => resolveAll(false),
          },
        ] : []),
      ],
      { cancelable: false },
    );
  }, [pendingConflicts, pushFn, lang]);

  // Full sync pipeline: existing membership only → pull → merge → push.
  // Returns true on success. Safe to call repeatedly (guarded by syncingRef).
  const performSync = useCallback(async (): Promise<boolean> => {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    try {
      // 仅使用已有成员资格。未配对状态是本地模式，绝不能因启动、重试或前后台回归而自动创建主设备组。
      const info = await getDeviceInfo();
      if (!info) {
        setDeviceInfo(null);
        setAuthLoading(false);
        setSyncError(null);
        disableSync();
        return true;
      }
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
      setIsGroupSwitching(true);
      const recovery = await recoverPendingGroupSwitch(groupSwitchRuntime);
      setIsGroupSwitching(false);
      if (recovery === "blocked") {
        setAuthLoading(false);
        setSyncError(lang === "zh" ? "同步组切换等待网络恢复，请勿清除应用数据" : "Group switch is awaiting network recovery. Do not clear app data.");
        return;
      }
      const ok = await performSync();
      if (!ok) scheduleRetry();
      else if (await getDeviceInfo()) {
        // 仅已有活跃成员资格时才启动实时监听。
        stopRealtimeRef.current?.();
        stopRealtimeRef.current = startRealtimeSync((since) => {
          // 检测到其他设备有新数据 → 触发增量 pull
          void (async () => {
            if (syncingRef.current) return;
            syncingRef.current = true;
            try {
              const { entries } = await cfPull(since > 0 ? since : undefined);
              if (entries.length > 0) {
                const { overwritten, conflicts } = await runInitialSync(entries, pushFn);
                if (overwritten && Platform.OS !== "web") triggerStoreReload();
                if (conflicts.length > 0) setPendingConflicts(conflicts);
                lastSyncAtRef.current = Date.now();
              }
            } catch (err) {
              console.warn("[Realtime] incremental pull failed:", err);
            } finally {
              syncingRef.current = false;
            }
          })();
        });
      }
    })();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      stopRealtimeRef.current?.();
      stopRealtimeRef.current = null;
    };
  }, [performSync, scheduleRetry, lang, pushFn]);

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

  // "logout" = stop the current local sync session. Provider never recreates a group after this call.
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
    // 登出时停止实时监听并重置时间戳
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    resetRealtimeSync();
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

  // 配对成功或恢复完成后重新同步当前已激活的成员资格；不隐式注册新组。
  const restartSync = useCallback(async (): Promise<boolean> => {
    // 停止当前实时监听
    stopRealtimeRef.current?.();
    stopRealtimeRef.current = null;
    // 清除重试计时器
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    syncingRef.current = false;
    // 重置 startedRef，允许同步引擎重新启动
    startedRef.current = false;
    // 执行当前成员资格的完整同步；未配对时安全停留在本地模式。
    const ok = await performSync();
    if (ok && await getDeviceInfo()) {
      // 仅已有活跃成员资格时重新启动实时监听
      stopRealtimeRef.current = startRealtimeSync((since) => {
        void (async () => {
          if (syncingRef.current) return;
          syncingRef.current = true;
          try {
            const { entries } = await cfPull(since > 0 ? since : undefined);
            if (entries.length > 0) {
              const { overwritten, conflicts } = await runInitialSync(entries, pushFn);
              if (overwritten && Platform.OS !== "web") triggerStoreReload();
              if (conflicts.length > 0) setPendingConflicts(conflicts);
              lastSyncAtRef.current = Date.now();
            }
          } catch (err) {
            console.warn("[Realtime] incremental pull failed:", err);
          } finally {
            syncingRef.current = false;
          }
        })();
      });
    } else {
      scheduleRetry();
    }
    return ok;
  }, [performSync, scheduleRetry, pushFn]);

  const switchCurrentDeviceToAnotherGroup = useCallback(async (code: string, handoffDeviceId?: string) => {
    const switchId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `switch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setIsGroupSwitching(true);
    try {
      await switchToAnotherGroup({ code, switchId, handoffDeviceId }, groupSwitchRuntime);
      await restartSync();
    } finally {
      setIsGroupSwitching(false);
    }
  }, [groupSwitchRuntime, restartSync]);

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
        restartSync,
        switchToAnotherGroup: switchCurrentDeviceToAnotherGroup,
        isGroupSwitching,
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

/** ★ 存储键 → 用户可读名称（用于冲突弹框）—全面补全 */
const STORAGE_KEY_LABELS: Record<string, string> = {
  // 鸡尾酒核心
  "cocktail.recipes":              "配方库",
  "cocktail.categories":           "分类",
  "cocktail.tags":                 "标签",
  "cocktail.tagGroups":            "标签分组",
  "cocktail.categoryGroups":       "分类分组",
  "cocktail.bottles":              "酒款库",
  "homemade.preps.v1":             "自制库",
  "homemade.sections.v1":          "自制分区",
  "homemade.types.v1":             "自制类型",
  "homemade.taxonomy.v2":          "自制分类体系",
  "bottles.taxonomy.categories.v1":"酒款分类",
  "bottles.taxonomy.styles.v1":    "酒款风格",
  "cocktail.lab.projects":         "研发项目",
  "cocktail.lab.batches":          "研发批次",
  "cocktail.books.v1":             "书库",
  "menu_store_v1":                 "门店酒单",
  "shopping_store_v1":             "采购清单",
  "cocktail.iceSettings.v2":       "冰块设置",
  "app.lang.v1":                   "语言设置",
  "cocktail.prefs.v1":             "偏好设置",
  // ★ 新增：葡萄酒模块
  "wine.bottles.v1":               "葡萄酒库",
  "wine.snapshots.v2":             "葡萄酒库存快照",
  "wine.manual_purchases.v1":      "葡萄酒进货记录",
  // ★ 新增：餐食模块
  "food.menu.v1":                  "餐食菜单",
  "food.ingredients.v2":           "食材库",
  "food.purchases.v1":             "食材采购记录",
  // ★ 新增：研发计划
  "lab.plan.v1":                   "研发计划清单",
  // ★ 新增：门店模块
  "store.revenue.v1":              "营业状况",
  "store.petty.v1":                "备用金记录",
  "store.petty_categories.v1":     "备用金分类",
  "store.petty_inv_links.v1":      "备用金库存联动",
  "store.inventory.v1":            "门店库存",
  "menu.packages.v1":              "套餐管理",
  // ★ 新增：月度报表
  "monthly_summary.reports.v1":    "月度总报表",
  "monthly_summary.suppliers.v1":  "供应商档案",
  "monthly_summary.payments.v1":   "货款记录",
  "monthly_summary.balances.v1":   "账户余额",
  "monthly_reports_v1":            "月度报表导入",
  // ★ 新增：经营分析
  "period_analysis.reports.v1":    "经营分析报表",
  "period_analysis.settings.v1":   "经营分析设置",
  // ★ 新增：人工成本
  "labor_employees_v1":            "员工档案",
  "labor_shifts_v1":               "排班记录",
  "labor_attendance_v1":           "考勤记录",
  "labor_payslips_v1":             "薪资单",
  "labor_month_close_archives_v1":  "月度结算归档",
  "labor_month_adjustment_sessions_v1": "薪资差额调整会话",
  "labor_month_configs_v1":        "月度薪资配置",
  "labor.salary_advances.v1":      "员工预支记录",
  // ★ 新增：人工模块补全
  "labor_custom_depts_v1":          "自定义部门",
  "labor_business_hours_v1":        "店铺营业时间",
  "labor_shift_groups_v1":          "班次分组",
  "labor_fill_presets_v1":          "快速填充预设",
  "store.petty_labor_links.v1":     "备用金人工关联",
  "store.employee_name_aliases.v1": "员工名字映射",
  // ★ 新增：烈酒进销存
  "spirits.items.v3":               "烈酒酒款档案",
  "spirits.purchases.v3":           "烈酒进货流水",
  "spirits.ledger.v3":              "烈酒台账",
  "spirits.refPrices.v1":           "烈酒参考单价",
  "spirits.suppliers.v1":           "烈酒供应商",
  "spirits.groups.v1":              "品牌集团",
  "spirits.matchMemory.v1":         "商品匹配记忆",
  "spirits.selfBuyConfig.v1":       "自采配置",
  "spirits.customCategories.v1":    "自定义分类",
  "spirits.groupMatchMemory.v1":    "集团匹配记忆",
  "supplier.match.memory.v1":        "供应商匹配记忆",
  // ★ 新增：啤酒库存
  "beer.items.v1":                   "啤酒库存",
  "beer.transactions.v1":            "啤酒交易记录",
  "beer.snapshots.v1":               "啤酒库存快照",
  // ★ 新增：水果库存
  "fruit.items.v1":                  "水果库存",
  "fruit.transactions.v1":           "水果交易记录",
  "fruit.snapshots.v1":              "水果库存快照",
  // ★ 新增：冰块库存
  "ice.inv.items.v1":                "冰块库存",
  "ice.inv.tx.v1":                   "冰块交易记录",
  "ice.inventory.v1":                "冰块库存配置",
  // ★ 新增：器具库存
  "equipment.inventory.v1":          "器具设备清单",
  // ★ 新增：排班快照和其他员工模块
  "labor_employee_groups_v1":        "员工分组",
  "labor_shift_templates_v1":        "班次模板",
  "labor_holiday_configs_v1":        "节假日配置",
  "labor_comp_off_v1":               "调休配置",
  "labor_comp_off_entries_v1":       "调休余额记录",
  "labor_holiday_comp_off_v1":       "节假日调休余额",
  "labor_unexplained_rest_alerts_v1":"未解释休息提醒",
  "labor_special_statuses_v1":       "特殊状态配置",
  "labor_global_payroll_settings_v1":"全局薪资设置",
  "labor_performance_templates_v1":  "绩效模板",
  "labor_performance_records_v1":    "绩效记录",
  "labor.advance_categories.v1":     "预支分类",
  // ★ 新增：月报附加配置
  "monthly_summary.petty_configs.v1": "备用金科目配置",
  "monthly_summary.inventory_configs.v1": "库存报表配置",
  // ★ 新增：时段分析排班
  "schedule.business_hours.v1":      "营业时间设置",
  "schedule.shift_templates.v1":     "时段分析班次模板",
  "dish_analysis.snapshots.v1":      "菜品分析快照",
  // ★ 种子数据和迁移键（不常冲突，但需有友好名称）
  "cocktail.seeded":                 "酒库初始化标记",
  "cocktail_waldorf_imported_v1":    "Waldorf 导入标记",
  "cocktail.bottles.seeded":         "酒款库初始化标记",
  "cocktail.bottles.waldorf.v1":     "Waldorf 酒款库导入",
  "homemade.seeded.v1":              "自制库初始化标记",
  "homemade.waldorf.v1":             "Waldorf 自制库导入",
  "homemade.waldorf.v2":             "Waldorf 自制库导入 v2",
  "homemade.source.v3":              "自制库来源数据",
};

/** ★ 获取数据预览（条目数量） */
function getDataPreview(value: string, _key: string): string {
  try {
    const data = JSON.parse(value);
    if (Array.isArray(data)) return `${data.length} 条记录`;
    if (data && typeof data === "object") {
      const firstArr = Object.values(data).find(Array.isArray);
      if (firstArr) return `${(firstArr as unknown[]).length} 条记录`;
      return "数据已修改";
    }
    return "数据已修改";
  } catch {
    return "数据已修改";
  }
}

/** ★ 自动推荐冲突解决方案：时间更新且数据更多的版本 */
function getConflictRecommendation(
  localValue: string,
  localTs: number,
  remoteValue: string,
  remoteTs: number,
): "local" | "remote" | null {
  const getCount = (v: string): number => {
    try {
      const d = JSON.parse(v);
      if (Array.isArray(d)) return d.length;
      if (d && typeof d === "object") {
        const arr = Object.values(d).find(Array.isArray);
        return arr ? (arr as unknown[]).length : 0;
      }
      return 0;
    } catch { return 0; }
  };
  const localCount = getCount(localValue);
  const remoteCount = getCount(remoteValue);
  const remoteNewer = remoteTs > localTs;
  const localNewer = localTs > remoteTs;
  if (remoteNewer && remoteCount >= localCount) return "remote";
  if (localNewer && localCount >= remoteCount) return "local";
  if (remoteCount > localCount + 2) return "remote";
  if (localCount > remoteCount + 2) return "local";
  return null;
}
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

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import {
  disableSync,
  getSyncState,
  runInitialSync,
  subscribeSyncState,
  type SyncState,
} from "./engine";

/**
 * 云端同步 Provider(类 iCloud 体验):
 * - 登录后自动 pull 云端数据并与本地合并,之后本地改动自动推送
 * - access=false 时标记 denied(私人应用,仅 owner 可用)
 * - 云端数据覆盖本地后触发页面刷新(web reload)
 */

type SyncContextValue = {
  syncState: SyncState;
  /** 登录用户是否被允许访问(私人应用 owner 校验);null=未知/未登录 */
  accessAllowed: boolean | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  user: ReturnType<typeof useAuth>["user"];
  login: () => void;
  logout: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading: authLoading, logout: authLogout } = useAuth();
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const startedRef = useRef(false);
  const utils = trpc.useUtils();
  const pushMutation = trpc.sync.push.useMutation();
  // mutation 对象每次渲染都是新引用,存入 ref 避免 effect 依赖循环
  const pushMutationRef = useRef(pushMutation);
  pushMutationRef.current = pushMutation;
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  useEffect(() => subscribeSyncState(setSyncState), []);

  const pushFn = useCallback(
    async (entries: { storageKey: string; value: string; clientUpdatedAt: number }[]) => {
      await pushMutationRef.current.mutateAsync({ entries });
    },
    [],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user) {
      disableSync();
      setAccessAllowed((prev) => (prev === null ? prev : null));
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const pulled = await utilsRef.current.sync.pull.fetch();
        if (cancelled) return;
        setAccessAllowed(true);
        const overwritten = await runInitialSync(pulled.entries, pushFn);
        if (overwritten && Platform.OS === "web" && typeof window !== "undefined") {
          // 云端数据已写入本地存储,刷新以让各 store 重新加载
          window.location.reload();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const code = (err as { data?: { code?: string } })?.data?.code;
        if (code === "FORBIDDEN") {
          setAccessAllowed(false);
          disableSync();
        } else {
          // 网络等错误:保持本地可用,不阻塞
          setAccessAllowed(true);
          console.warn("[Sync] initial sync failed:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.id, pushFn]);

  const login = useCallback(() => {
    void import("@/constants/oauth").then((m) => m.startOAuthLogin());
  }, []);

  const logout = useCallback(async () => {
    disableSync();
    startedRef.current = false;
    await authLogout();
  }, [authLogout]);

  return (
    <SyncContext.Provider
      value={{ syncState, accessAllowed, isAuthenticated, authLoading, user, login, logout }}
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

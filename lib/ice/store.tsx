/** 冰块成本设置的全局 Context:一次设置,全 App 自动生效 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_ICE_SETTINGS,
  loadIceSettings,
  saveIceSettings,
  type IceKind,
  type IceSettings,
} from "./cost";

interface IceCtx {
  ice: IceSettings;
  setIce: (next: Partial<IceSettings>) => void;
  addKind: (k: IceKind) => void;
  updateKind: (id: string, patch: Partial<IceKind>) => void;
  removeKind: (id: string) => void;
  reset: () => void;
}

const Ctx = createContext<IceCtx | null>(null);

export function IceSettingsProvider({ children }: { children: React.ReactNode }) {
  const [ice, setState] = useState<IceSettings>(DEFAULT_ICE_SETTINGS);

  useEffect(() => {
    loadIceSettings().then(setState);
  }, []);

  const value = useMemo<IceCtx>(
    () => ({
      ice,
      setIce: (next) => {
        setState((prev) => {
          const merged = { ...prev, ...next };
          void saveIceSettings(merged);
          return merged;
        });
      },
      addKind: (k) => {
        setState((prev) => {
          const merged = { ...prev, kinds: [...prev.kinds, k] };
          void saveIceSettings(merged);
          return merged;
        });
      },
      updateKind: (id, patch) => {
        setState((prev) => {
          const merged = {
            ...prev,
            kinds: prev.kinds.map((k) => (k.id === id ? { ...k, ...patch } : k)),
          };
          void saveIceSettings(merged);
          return merged;
        });
      },
      removeKind: (id) => {
        setState((prev) => {
          const merged = { ...prev, kinds: prev.kinds.filter((k) => k.id !== id) };
          void saveIceSettings(merged);
          return merged;
        });
      },
      reset: () => {
        setState(DEFAULT_ICE_SETTINGS);
        void saveIceSettings(DEFAULT_ICE_SETTINGS);
      },
    }),
    [ice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIceSettings(): IceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useIceSettings must be used within IceSettingsProvider");
  return v;
}

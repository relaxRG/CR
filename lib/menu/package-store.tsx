/**
 * 套餐 Store
 * 套餐：由多个在售产品（鸡尾酒/葡萄酒/餐食）组合而成，有固定售价和描述
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "menu.packages.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export interface PackageItem {
  type: "cocktail" | "wine" | "food";
  refId: string;       // recipeId / bottleId / foodItemId
  name: string;        // 快照名称（防止引用失效）
  quantity: number;
}

export interface MenuPackage {
  id: string;
  name: string;        // 套餐名称
  nameEn?: string;     // 英文名（可选）
  description?: string; // 套餐描述
  price: number | null; // 套餐售价
  originalPrice?: number; // 原价（用于展示折扣）
  items: PackageItem[]; // 套餐内容
  available: boolean;  // 是否在售
  sortIndex: number;
  tags?: string[];     // 标签（如 "热门" "新品" "限时"）
  createdAt: string;
  updatedAt: string;
}

type Action =
  | { type: "LOAD"; payload: MenuPackage[] }
  | { type: "ADD"; pkg: MenuPackage }
  | { type: "UPDATE"; id: string; updates: Partial<MenuPackage> }
  | { type: "DELETE"; id: string }
  | { type: "TOGGLE_AVAILABLE"; id: string }
  | { type: "REORDER"; packages: MenuPackage[] };

function reducer(state: MenuPackage[], action: Action): MenuPackage[] {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return [action.pkg, ...state];
    case "UPDATE": return state.map((p) => p.id === action.id ? { ...p, ...action.updates, updatedAt: new Date().toISOString() } : p);
    case "DELETE": return state.filter((p) => p.id !== action.id);
    case "TOGGLE_AVAILABLE": return state.map((p) => p.id === action.id ? { ...p, available: !p.available, updatedAt: new Date().toISOString() } : p);
    case "REORDER": return action.packages;
    default: return state;
  }
}

interface PackageContextValue {
  packages: MenuPackage[];
  ready: boolean;
  addPackage: (data: Omit<MenuPackage, "id" | "createdAt" | "updatedAt">) => string;
  updatePackage: (id: string, updates: Partial<MenuPackage>) => void;
  deletePackage: (id: string) => void;
  toggleAvailable: (id: string) => void;
}

const PackageContext = createContext<PackageContextValue | null>(null);

export function MenuPackageProvider({ children }: { children: React.ReactNode }) {
  const [packages, dispatch] = useReducer(reducer, []);
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    const load = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      setReady(true);
    });
    load();
    // ★ 注册同步重载回调
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(packages)).catch(() => {});
    // ★ 通知同步引擎
    notifySyncChange(STORAGE_KEY);
  }, [packages, ready]);

  const addPackage = useCallback((data: Omit<MenuPackage, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD", pkg: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);

  const updatePackage = useCallback((id: string, updates: Partial<MenuPackage>) => {
    dispatch({ type: "UPDATE", id, updates });
  }, []);

  const deletePackage = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const toggleAvailable = useCallback((id: string) => dispatch({ type: "TOGGLE_AVAILABLE", id }), []);

  return (
    <PackageContext.Provider value={{ packages, ready, addPackage, updatePackage, deletePackage, toggleAvailable }}>
      {children}
    </PackageContext.Provider>
  );
}

export function useMenuPackageStore(): PackageContextValue {
  const ctx = useContext(PackageContext);
  if (!ctx) throw new Error("useMenuPackageStore must be used within MenuPackageProvider");
  return ctx;
}

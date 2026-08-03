import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuEntry {
  id: string;          // unique entry id (uuid)
  recipeId: string;    // reference to Recipe.id
  price: number | null; // 门店售价（元），null 表示未设置
  available: boolean;  // 兼容性保留，UI 已不展示
  sortIndex: number;
  addedAt: string;     // ISO date
  /** 单杯分量（ml），用于计算倒酒成本 */
  servingSize?: number;
  /** 关联的主酒酒款档案 ID（用于计算 Pour Cost） */
  linkedSpiritItemId?: string;
}

export interface MenuGroup {
  id: string;
  name: string;
  collapsed: boolean;
  sortIndex: number;
  entries: MenuEntry[];
}

export interface MenuState {
  groups: MenuGroup[];
  /** 未分配到任何分组的配方条目 */
  ungroupedEntries: MenuEntry[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: "LOAD"; payload: MenuState }
  | { type: "ADD_GROUP"; name: string }
  | { type: "RENAME_GROUP"; groupId: string; name: string }
  | { type: "DELETE_GROUP"; groupId: string }
  | { type: "TOGGLE_COLLAPSE"; groupId: string }
  | { type: "REORDER_GROUPS"; groups: MenuGroup[] }
  | { type: "ADD_ENTRY"; groupId: string; recipeId: string }
  | { type: "REMOVE_ENTRY"; groupId: string; entryId: string }
  | { type: "SET_PRICE"; groupId: string; entryId: string; price: number | null }
  | { type: "TOGGLE_AVAILABLE"; groupId: string; entryId: string }
  | { type: "REORDER_ENTRIES"; groupId: string; entries: MenuEntry[] }
  | { type: "MOVE_ENTRY"; entryId: string; fromGroupId: string; toGroupId: string }
  // 无分组 actions
  | { type: "ADD_UNGROUPED_ENTRY"; recipeId: string }
  | { type: "REMOVE_UNGROUPED_ENTRY"; entryId: string }
  | { type: "SET_UNGROUPED_PRICE"; entryId: string; price: number | null }
  | { type: "REORDER_UNGROUPED"; entries: MenuEntry[] }
  // 批量定价
  | { type: "BATCH_SET_PRICE"; entryIds: string[]; price: number | null }
  | { type: "TOGGLE_UNGROUPED_AVAILABLE"; entryId: string }
  // 分量和关联酒款
  | { type: "SET_SERVING_SIZE"; entryId: string; groupId: string | null; servingSize: number | undefined }
  | { type: "SET_LINKED_SPIRIT"; entryId: string; groupId: string | null; linkedSpiritItemId: string | undefined };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function reducer(state: MenuState, action: Action): MenuState {
  switch (action.type) {
    case "LOAD": {
      // 兼容旧数据：若没有 ungroupedEntries 字段，补充空数组
      const payload = action.payload;
      return {
        groups: payload.groups ?? [],
        ungroupedEntries: payload.ungroupedEntries ?? [],
      };
    }

    case "ADD_GROUP": {
      const newGroup: MenuGroup = {
        id: uuid(),
        name: action.name,
        collapsed: false,
        sortIndex: state.groups.length,
        entries: [],
      };
      return { ...state, groups: [...state.groups, newGroup] };
    }

    case "RENAME_GROUP":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, name: action.name } : g
        ),
      };

    case "DELETE_GROUP":
      return { ...state, groups: state.groups.filter((g) => g.id !== action.groupId) };

    case "TOGGLE_COLLAPSE":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, collapsed: !g.collapsed } : g
        ),
      };

    case "REORDER_GROUPS":
      return { ...state, groups: action.groups };

    case "ADD_ENTRY": {
      return {
        ...state,
        groups: state.groups.map((g) => {
          if (g.id !== action.groupId) return g;
          // 防止重复添加同一配方到同一分组
          if (g.entries.some((e) => e.recipeId === action.recipeId)) return g;
          const entry: MenuEntry = {
            id: uuid(),
            recipeId: action.recipeId,
            price: null,
            available: true,
            sortIndex: g.entries.length,
            addedAt: new Date().toISOString(),
          };
          return { ...g, entries: [...g.entries, entry] };
        }),
      };
    }

    case "REMOVE_ENTRY":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId
            ? { ...g, entries: g.entries.filter((e) => e.id !== action.entryId) }
            : g
        ),
      };

    case "SET_PRICE":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId
            ? {
                ...g,
                entries: g.entries.map((e) =>
                  e.id === action.entryId ? { ...e, price: action.price } : e
                ),
              }
            : g
        ),
      };

    case "TOGGLE_AVAILABLE":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId
            ? {
                ...g,
                entries: g.entries.map((e) =>
                  e.id === action.entryId ? { ...e, available: !e.available } : e
                ),
              }
            : g
        ),
      };
    case "TOGGLE_UNGROUPED_AVAILABLE":
      return {
        ...state,
        ungroupedEntries: state.ungroupedEntries.map((e) =>
          e.id === action.entryId ? { ...e, available: !e.available } : e
        ),
      };

    case "REORDER_ENTRIES":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, entries: action.entries } : g
        ),
      };

    case "MOVE_ENTRY": {
      let movedEntry: MenuEntry | null = null;
      let newGroups = state.groups.map((g) => {
        if (g.id === action.fromGroupId) {
          const entry = g.entries.find((e) => e.id === action.entryId);
          if (entry) movedEntry = entry;
          return { ...g, entries: g.entries.filter((e) => e.id !== action.entryId) };
        }
        return g;
      });
      if (movedEntry) {
        newGroups = newGroups.map((g) => {
          if (g.id === action.toGroupId) {
            return { ...g, entries: [...g.entries, movedEntry!] };
          }
          return g;
        });
      }
      return { ...state, groups: newGroups };
    }

    // ─── 无分组 actions ───────────────────────────────────────────────────────

    case "ADD_UNGROUPED_ENTRY": {
      // 防止重复添加
      if (state.ungroupedEntries.some((e) => e.recipeId === action.recipeId)) return state;
      const entry: MenuEntry = {
        id: uuid(),
        recipeId: action.recipeId,
        price: null,
        available: true,
        sortIndex: state.ungroupedEntries.length,
        addedAt: new Date().toISOString(),
      };
      return { ...state, ungroupedEntries: [...state.ungroupedEntries, entry] };
    }

    case "REMOVE_UNGROUPED_ENTRY":
      return {
        ...state,
        ungroupedEntries: state.ungroupedEntries.filter((e) => e.id !== action.entryId),
      };

    case "SET_UNGROUPED_PRICE":
      return {
        ...state,
        ungroupedEntries: state.ungroupedEntries.map((e) =>
          e.id === action.entryId ? { ...e, price: action.price } : e
        ),
      };

    case "REORDER_UNGROUPED":
      return { ...state, ungroupedEntries: action.entries };

    // ─── 批量定价 ─────────────────────────────────────────────────────────────

    case "BATCH_SET_PRICE": {
      const idSet = new Set(action.entryIds);
      return {
        ...state,
        groups: state.groups.map((g) => ({
          ...g,
          entries: g.entries.map((e) =>
            idSet.has(e.id) ? { ...e, price: action.price } : e
          ),
        })),
        ungroupedEntries: state.ungroupedEntries.map((e) =>
          idSet.has(e.id) ? { ...e, price: action.price } : e
        ),
      };
    }

    case "SET_SERVING_SIZE": {
      const updateEntry = (e: MenuEntry) =>
        e.id === action.entryId ? { ...e, servingSize: action.servingSize } : e;
      if (action.groupId) {
        return {
          ...state,
          groups: state.groups.map((g) =>
            g.id === action.groupId ? { ...g, entries: g.entries.map(updateEntry) } : g
          ),
        };
      }
      return { ...state, ungroupedEntries: state.ungroupedEntries.map(updateEntry) };
    }

    case "SET_LINKED_SPIRIT": {
      const updateEntry = (e: MenuEntry) =>
        e.id === action.entryId ? { ...e, linkedSpiritItemId: action.linkedSpiritItemId } : e;
      if (action.groupId) {
        return {
          ...state,
          groups: state.groups.map((g) =>
            g.id === action.groupId ? { ...g, entries: g.entries.map(updateEntry) } : g
          ),
        };
      }
      return { ...state, ungroupedEntries: state.ungroupedEntries.map(updateEntry) };
    }

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "menu_store_v1";

interface MenuContextValue {
  ready: boolean;
  groups: MenuGroup[];
  ungroupedEntries: MenuEntry[];
  addGroup: (name: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  toggleCollapse: (groupId: string) => void;
  reorderGroups: (groups: MenuGroup[]) => void;
  addEntry: (groupId: string, recipeId: string) => void;
  removeEntry: (groupId: string, entryId: string) => void;
  setPrice: (groupId: string, entryId: string, price: number | null) => void;
  toggleAvailable: (groupId: string, entryId: string) => void;
  reorderEntries: (groupId: string, entries: MenuEntry[]) => void;
  moveEntry: (entryId: string, fromGroupId: string, toGroupId: string) => void;
  // 无分组 actions
  addUngroupedEntry: (recipeId: string) => void;
  removeUngroupedEntry: (entryId: string) => void;
  setUngroupedPrice: (entryId: string, price: number | null) => void;
  reorderUngrouped: (entries: MenuEntry[]) => void;
  // 批量定价
  batchSetPrice: (entryIds: string[], price: number | null) => void;
  toggleUngroupedAvailable: (entryId: string) => void;
  /** 设置单杯分量（ml） */
  setServingSize: (entryId: string, groupId: string | null, servingSize: number | undefined) => void;
  /** 设置关联酒款档案 ID */
  setLinkedSpirit: (entryId: string, groupId: string | null, linkedSpiritItemId: string | undefined) => void;
  /** 返回某 recipeId 所在的所有 groupId */
  groupsContaining: (recipeId: string) => string[];
  /** 返回整个门店酒单中的配方 id 集合（去重，含无分组） */
  allRecipeIds: Set<string>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { groups: [], ungroupedEntries: [] });
  const [ready, setReady] = React.useState(false);

  // 加载持久化数据（也作为同步重载入口）
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as MenuState;
            dispatch({ type: "LOAD", payload: parsed });
          } catch {
            // ignore
          }
        }
      })
      .finally(() => setReady(true));
  }, []);

  // 原生端云同步覆盖后重载
  useEffect(() => {
    return registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) {
          try { dispatch({ type: "LOAD", payload: JSON.parse(raw) as MenuState }); } catch {}
        }
      });
    });
  }, []);

  // 持久化
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state, ready]);

  const addGroup = useCallback((name: string) => dispatch({ type: "ADD_GROUP", name }), []);
  const renameGroup = useCallback((groupId: string, name: string) => dispatch({ type: "RENAME_GROUP", groupId, name }), []);
  const deleteGroup = useCallback((groupId: string) => dispatch({ type: "DELETE_GROUP", groupId }), []);
  const toggleCollapse = useCallback((groupId: string) => dispatch({ type: "TOGGLE_COLLAPSE", groupId }), []);
  const reorderGroups = useCallback((groups: MenuGroup[]) => dispatch({ type: "REORDER_GROUPS", groups }), []);
  const addEntry = useCallback((groupId: string, recipeId: string) => dispatch({ type: "ADD_ENTRY", groupId, recipeId }), []);
  const removeEntry = useCallback((groupId: string, entryId: string) => dispatch({ type: "REMOVE_ENTRY", groupId, entryId }), []);
  const setPrice = useCallback((groupId: string, entryId: string, price: number | null) => dispatch({ type: "SET_PRICE", groupId, entryId, price }), []);
  const toggleAvailable = useCallback((groupId: string, entryId: string) => dispatch({ type: "TOGGLE_AVAILABLE", groupId, entryId }), []);
  const reorderEntries = useCallback((groupId: string, entries: MenuEntry[]) => dispatch({ type: "REORDER_ENTRIES", groupId, entries }), []);
  const moveEntry = useCallback((entryId: string, fromGroupId: string, toGroupId: string) => dispatch({ type: "MOVE_ENTRY", entryId, fromGroupId, toGroupId }), []);

  const addUngroupedEntry = useCallback((recipeId: string) => dispatch({ type: "ADD_UNGROUPED_ENTRY", recipeId }), []);
  const removeUngroupedEntry = useCallback((entryId: string) => dispatch({ type: "REMOVE_UNGROUPED_ENTRY", entryId }), []);
  const setUngroupedPrice = useCallback((entryId: string, price: number | null) => dispatch({ type: "SET_UNGROUPED_PRICE", entryId, price }), []);
  const reorderUngrouped = useCallback((entries: MenuEntry[]) => dispatch({ type: "REORDER_UNGROUPED", entries }), []);
  const batchSetPrice = useCallback((entryIds: string[], price: number | null) => dispatch({ type: "BATCH_SET_PRICE", entryIds, price }), []);
  const toggleUngroupedAvailable = useCallback((entryId: string) => dispatch({ type: "TOGGLE_UNGROUPED_AVAILABLE", entryId }), []);
  const setServingSize = useCallback((entryId: string, groupId: string | null, servingSize: number | undefined) =>
    dispatch({ type: "SET_SERVING_SIZE", entryId, groupId, servingSize }), []);
  const setLinkedSpirit = useCallback((entryId: string, groupId: string | null, linkedSpiritItemId: string | undefined) =>
    dispatch({ type: "SET_LINKED_SPIRIT", entryId, groupId, linkedSpiritItemId }), []);

  const groupsContaining = useCallback(
    (recipeId: string) =>
      state.groups.filter((g) => g.entries.some((e) => e.recipeId === recipeId)).map((g) => g.id),
    [state.groups]
  );

  const allRecipeIds = React.useMemo(
    () => new Set([
      ...state.groups.flatMap((g) => g.entries.map((e) => e.recipeId)),
      ...state.ungroupedEntries.map((e) => e.recipeId),
    ]),
    [state.groups, state.ungroupedEntries]
  );

  return (
    <MenuContext.Provider
      value={{
        ready,
        groups: state.groups,
        ungroupedEntries: state.ungroupedEntries,
        addGroup,
        renameGroup,
        deleteGroup,
        toggleCollapse,
        reorderGroups,
        addEntry,
        removeEntry,
        setPrice,
        toggleAvailable,
        reorderEntries,
        moveEntry,
        addUngroupedEntry,
        removeUngroupedEntry,
        setUngroupedPrice,
        reorderUngrouped,
        batchSetPrice,
        toggleUngroupedAvailable,
        setServingSize,
        setLinkedSpirit,
        groupsContaining,
        allRecipeIds,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export function useMenuStore(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error("useMenuStore must be used within MenuProvider");
  return ctx;
}

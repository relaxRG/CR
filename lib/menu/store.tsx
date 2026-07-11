import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuEntry {
  id: string;          // unique entry id (uuid)
  recipeId: string;    // reference to Recipe.id
  price: number | null; // 门店售价（元），null 表示未设置
  available: boolean;  // 今日是否供应
  sortIndex: number;
  addedAt: string;     // ISO date
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
  | { type: "MOVE_ENTRY"; entryId: string; fromGroupId: string; toGroupId: string };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function reducer(state: MenuState, action: Action): MenuState {
  switch (action.type) {
    case "LOAD":
      return action.payload;

    case "ADD_GROUP": {
      const newGroup: MenuGroup = {
        id: uuid(),
        name: action.name,
        collapsed: false,
        sortIndex: state.groups.length,
        entries: [],
      };
      return { groups: [...state.groups, newGroup] };
    }

    case "RENAME_GROUP":
      return {
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, name: action.name } : g
        ),
      };

    case "DELETE_GROUP":
      return { groups: state.groups.filter((g) => g.id !== action.groupId) };

    case "TOGGLE_COLLAPSE":
      return {
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, collapsed: !g.collapsed } : g
        ),
      };

    case "REORDER_GROUPS":
      return { groups: action.groups };

    case "ADD_ENTRY": {
      return {
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
        groups: state.groups.map((g) =>
          g.id === action.groupId
            ? { ...g, entries: g.entries.filter((e) => e.id !== action.entryId) }
            : g
        ),
      };

    case "SET_PRICE":
      return {
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

    case "REORDER_ENTRIES":
      return {
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
      return { groups: newGroups };
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
  /** 返回某 recipeId 所在的所有 groupId */
  groupsContaining: (recipeId: string) => string[];
  /** 返回整个门店酒单中的配方 id 集合（去重） */
  allRecipeIds: Set<string>;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function MenuProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { groups: [] });
  const [ready, setReady] = React.useState(false);

  // 加载持久化数据
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

  // 持久化
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
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

  const groupsContaining = useCallback(
    (recipeId: string) =>
      state.groups.filter((g) => g.entries.some((e) => e.recipeId === recipeId)).map((g) => g.id),
    [state.groups]
  );

  const allRecipeIds = React.useMemo(
    () => new Set(state.groups.flatMap((g) => g.entries.map((e) => e.recipeId))),
    [state.groups]
  );

  return (
    <MenuContext.Provider
      value={{
        ready,
        groups: state.groups,
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

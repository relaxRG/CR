import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

/** 网络采购链接 */
export interface OnlineLink {
  id: string;
  platform: string;   // 如 "天猫"、"京东"、"1919"
  url: string;
  note: string;
}

/** 线下酒商采购备注 */
export interface OfflineNote {
  supplier: string;   // 供应商名称
  contact: string;    // 联系方式
  address: string;    // 地址
  price: string;      // 参考采购价
  moq: string;        // 最小起订量
  note: string;       // 其他备注
}

/** 采购清单条目 */
export interface ShoppingItem {
  id: string;
  /** 原材料/酒款名称（中文） */
  ingredientName: string;
  /** 原材料/酒款名称（英文） */
  ingredientNameEn: string;
  /** 分类：spirit=烈酒/酒款, material=原材料, homemade=自制品, other=其他 */
  category: "spirit" | "material" | "homemade" | "other";
  /** 关联酒库 Bottle id（智能匹配结果） */
  linkedBottleId?: string;
  /** 关联自制品 HomemadePrep id */
  linkedPrepId?: string;
  /** 关联的在售配方 id 列表（自动聚合） */
  linkedRecipeIds: string[];
  /** 网络采购链接列表 */
  onlineLinks: OnlineLink[];
  /** 线下酒商采购备注 */
  offlineNote: OfflineNote;
  /** 是否已采购 */
  purchased: boolean;
  /** 是否手动添加（非配方自动聚合） */
  isManual: boolean;
  addedAt: string;
}

export interface ShoppingState {
  items: ShoppingItem[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: "LOAD"; payload: ShoppingState }
  | { type: "UPSERT_ITEM"; item: ShoppingItem }
  | { type: "REMOVE_ITEM"; itemId: string }
  | { type: "TOGGLE_PURCHASED"; itemId: string }
  | { type: "ADD_ONLINE_LINK"; itemId: string; link: OnlineLink }
  | { type: "UPDATE_ONLINE_LINK"; itemId: string; link: OnlineLink }
  | { type: "REMOVE_ONLINE_LINK"; itemId: string; linkId: string }
  | { type: "UPDATE_OFFLINE_NOTE"; itemId: string; note: OfflineNote }
  | { type: "BATCH_MARK_PURCHASED"; itemIds: string[]; purchased: boolean }
  | { type: "CLEAR_AUTO_ITEMS" };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyOfflineNote(): OfflineNote {
  return { supplier: "", contact: "", address: "", price: "", moq: "", note: "" };
}

function reducer(state: ShoppingState, action: Action): ShoppingState {
  switch (action.type) {
    case "LOAD":
      return action.payload;

    case "UPSERT_ITEM": {
      const exists = state.items.findIndex((i) => i.id === action.item.id);
      if (exists >= 0) {
        const updated = [...state.items];
        updated[exists] = action.item;
        return { items: updated };
      }
      return { items: [...state.items, action.item] };
    }

    case "REMOVE_ITEM":
      return { items: state.items.filter((i) => i.id !== action.itemId) };

    case "TOGGLE_PURCHASED":
      return {
        items: state.items.map((i) =>
          i.id === action.itemId ? { ...i, purchased: !i.purchased } : i
        ),
      };

    case "ADD_ONLINE_LINK":
      return {
        items: state.items.map((i) =>
          i.id === action.itemId
            ? { ...i, onlineLinks: [...i.onlineLinks, action.link] }
            : i
        ),
      };

    case "UPDATE_ONLINE_LINK":
      return {
        items: state.items.map((i) =>
          i.id === action.itemId
            ? {
                ...i,
                onlineLinks: i.onlineLinks.map((l) =>
                  l.id === action.link.id ? action.link : l
                ),
              }
            : i
        ),
      };

    case "REMOVE_ONLINE_LINK":
      return {
        items: state.items.map((i) =>
          i.id === action.itemId
            ? { ...i, onlineLinks: i.onlineLinks.filter((l) => l.id !== action.linkId) }
            : i
        ),
      };

    case "UPDATE_OFFLINE_NOTE":
      return {
        items: state.items.map((i) =>
          i.id === action.itemId ? { ...i, offlineNote: action.note } : i
        ),
      };

    case "BATCH_MARK_PURCHASED": {
      const idSet = new Set(action.itemIds);
      return {
        items: state.items.map((i) =>
          idSet.has(i.id) ? { ...i, purchased: action.purchased } : i
        ),
      };
    }

    case "CLEAR_AUTO_ITEMS":
      // 只保留手动添加的条目，清除自动聚合的条目
      return { items: state.items.filter((i) => i.isManual) };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "shopping_store_v1";

interface ShoppingContextValue {
  ready: boolean;
  items: ShoppingItem[];
  upsertItem: (item: ShoppingItem) => void;
  removeItem: (itemId: string) => void;
  togglePurchased: (itemId: string) => void;
  addOnlineLink: (itemId: string, link: OnlineLink) => void;
  updateOnlineLink: (itemId: string, link: OnlineLink) => void;
  removeOnlineLink: (itemId: string, linkId: string) => void;
  updateOfflineNote: (itemId: string, note: OfflineNote) => void;
  batchMarkPurchased: (itemIds: string[], purchased: boolean) => void;
  clearAutoItems: () => void;
  /** 创建新的 OnlineLink 对象（带 uuid） */
  createOnlineLink: (platform: string, url: string, note?: string) => OnlineLink;
}

const ShoppingContext = createContext<ShoppingContextValue | null>(null);

export function ShoppingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [] });
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as ShoppingState;
            dispatch({ type: "LOAD", payload: parsed });
          } catch {
            // ignore
          }
        }
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const upsertItem = useCallback((item: ShoppingItem) => dispatch({ type: "UPSERT_ITEM", item }), []);
  const removeItem = useCallback((itemId: string) => dispatch({ type: "REMOVE_ITEM", itemId }), []);
  const togglePurchased = useCallback((itemId: string) => dispatch({ type: "TOGGLE_PURCHASED", itemId }), []);
  const addOnlineLink = useCallback((itemId: string, link: OnlineLink) => dispatch({ type: "ADD_ONLINE_LINK", itemId, link }), []);
  const updateOnlineLink = useCallback((itemId: string, link: OnlineLink) => dispatch({ type: "UPDATE_ONLINE_LINK", itemId, link }), []);
  const removeOnlineLink = useCallback((itemId: string, linkId: string) => dispatch({ type: "REMOVE_ONLINE_LINK", itemId, linkId }), []);
  const updateOfflineNote = useCallback((itemId: string, note: OfflineNote) => dispatch({ type: "UPDATE_OFFLINE_NOTE", itemId, note }), []);
  const batchMarkPurchased = useCallback((itemIds: string[], purchased: boolean) => dispatch({ type: "BATCH_MARK_PURCHASED", itemIds, purchased }), []);
  const clearAutoItems = useCallback(() => dispatch({ type: "CLEAR_AUTO_ITEMS" }), []);
  const createOnlineLink = useCallback((platform: string, url: string, note = ""): OnlineLink => ({
    id: uuid(),
    platform,
    url,
    note,
  }), []);

  return (
    <ShoppingContext.Provider
      value={{
        ready,
        items: state.items,
        upsertItem,
        removeItem,
        togglePurchased,
        addOnlineLink,
        updateOnlineLink,
        removeOnlineLink,
        updateOfflineNote,
        batchMarkPurchased,
        clearAutoItems,
        createOnlineLink,
      }}
    >
      {children}
    </ShoppingContext.Provider>
  );
}

export function useShoppingStore(): ShoppingContextValue {
  const ctx = useContext(ShoppingContext);
  if (!ctx) throw new Error("useShoppingStore must be used within ShoppingProvider");
  return ctx;
}

// ─── 工具函数：空对象构造 ─────────────────────────────────────────────────────

export function createEmptyShoppingItem(
  ingredientName: string,
  ingredientNameEn: string,
  category: ShoppingItem["category"],
  isManual = false,
): ShoppingItem {
  return {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    ingredientName,
    ingredientNameEn,
    category,
    linkedRecipeIds: [],
    onlineLinks: [],
    offlineNote: emptyOfflineNote(),
    purchased: false,
    isManual,
    addedAt: new Date().toISOString(),
  };
}

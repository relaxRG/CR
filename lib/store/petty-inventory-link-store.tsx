/**
 * 备用金 ↔ 进销存联动 Store
 * 存储每条备用金记录关联的商品明细
 * 当备用金录入 A/B/C/F/K 类时，可附加商品明细，保存后自动触发进销存入库
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { ExtendedInventoryCategory } from "./petty-category-store";

const STORAGE_KEY = "store.petty_inv_links.v1";

// ─── 商品明细行 ───────────────────────────────────────────────────────────────
export interface PettyInventoryLine {
  /** 关联的进销存品类 */
  inventoryCategory: ExtendedInventoryCategory;
  /** 进销存条目 ID（已匹配时填入） */
  inventoryItemId?: string;
  /** 商品名称（手动填写或从进销存选择） */
  itemName: string;
  /** 规格 */
  spec: string;
  /** 数量 */
  quantity: number;
  /** 单位 */
  unit: string;
  /** 单价（元） */
  unitPrice: number;
  /** 小计（自动 = quantity × unitPrice） */
  subtotal: number;
}

// ─── 联动记录（每条备用金记录对应一条） ──────────────────────────────────────
export interface PettyInventoryLink {
  /** 对应的备用金记录 ID */
  pettyRecordId: string;
  /** 备用金日期（冗余，方便查询） */
  date: string;
  /** 备用金分类代码 */
  pettyCode: string;
  /** 商品明细列表 */
  lines: PettyInventoryLine[];
  /** 是否已同步到进销存 */
  synced: boolean;
  /** 同步时间 */
  syncedAt?: string;
  /** 创建时间 */
  createdAt: string;
}

// ─── State / Actions ──────────────────────────────────────────────────────────
interface LinkState {
  links: PettyInventoryLink[];
}

type Action =
  | { type: "LOAD"; payload: LinkState }
  | { type: "UPSERT"; link: PettyInventoryLink }
  | { type: "DELETE"; pettyRecordId: string }
  | { type: "MARK_SYNCED"; pettyRecordId: string };

function reducer(state: LinkState, action: Action): LinkState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "UPSERT": {
      const idx = state.links.findIndex((l) => l.pettyRecordId === action.link.pettyRecordId);
      if (idx >= 0) {
        const next = [...state.links];
        next[idx] = action.link;
        return { links: next };
      }
      return { links: [...state.links, action.link] };
    }
    case "DELETE":
      return { links: state.links.filter((l) => l.pettyRecordId !== action.pettyRecordId) };
    case "MARK_SYNCED": {
      const idx = state.links.findIndex((l) => l.pettyRecordId === action.pettyRecordId);
      if (idx < 0) return state;
      const next = [...state.links];
      next[idx] = { ...next[idx], synced: true, syncedAt: new Date().toISOString() };
      return { links: next };
    }
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface LinkContextValue extends LinkState {
  upsertLink: (link: PettyInventoryLink) => void;
  deleteLink: (pettyRecordId: string) => void;
  markSynced: (pettyRecordId: string) => void;
  getLink: (pettyRecordId: string) => PettyInventoryLink | undefined;
}

const LinkContext = createContext<LinkContextValue | null>(null);

export function PettyInventoryLinkProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { links: [] });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const upsertLink = useCallback((link: PettyInventoryLink) => dispatch({ type: "UPSERT", link }), []);
  const deleteLink = useCallback((pettyRecordId: string) => dispatch({ type: "DELETE", pettyRecordId }), []);
  const markSynced = useCallback((pettyRecordId: string) => dispatch({ type: "MARK_SYNCED", pettyRecordId }), []);
  const getLink = useCallback((pettyRecordId: string) => state.links.find((l) => l.pettyRecordId === pettyRecordId), [state.links]);

  return (
    <LinkContext.Provider value={{ ...state, upsertLink, deleteLink, markSynced, getLink }}>
      {children}
    </LinkContext.Provider>
  );
}

export function usePettyInventoryLinkStore(): LinkContextValue {
  const ctx = useContext(LinkContext);
  if (!ctx) throw new Error("usePettyInventoryLinkStore must be used within PettyInventoryLinkProvider");
  return ctx;
}

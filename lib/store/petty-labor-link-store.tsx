/**
 * 备用金-人工关联 Store
 * 管理备用金条目与薪资预支/员工的关联关系
 * - PettyCashLaborLink：某条备用金记录被纳入薪资预支的关联记录
 * - NameAliasMap：员工名字/备注关键词 → 员工ID 的学习映射表
 */
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const LINK_STORAGE_KEY = "store.petty_labor_links.v1";
const ALIAS_STORAGE_KEY = "store.employee_name_aliases.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── PettyCashLaborLink 类型 ──────────────────────────────────────────────────

/**
 * 备用金条目与薪资预支的关联记录
 * 一旦创建，金额/用途/来源均从备用金同步，只读
 */
export interface PettyCashLaborLink {
  id: string;
  /** 关联的备用金记录 ID（只读来源） */
  pettyRecordId: string;
  /** 备用金小组代码，如 "K1"、"K9" */
  pettyCode: string;
  /** 从备用金同步的金额（只读） */
  amount: number;
  /** 从备用金同步的日期（只读） */
  date: string;
  /** 从备用金同步的描述/用途（只读） */
  description: string;
  /** 从备用金同步的支付方式（只读） */
  paymentMethod: string;
  /** 关联的员工 ID（可手动匹配，空=未匹配） */
  employeeId: string;
  /** 匹配置信度：auto=自动匹配, manual=手动指定, unmatched=未匹配 */
  matchType: "auto" | "manual" | "unmatched";
  /** 所属月份 YYYY-MM */
  month: string;
  /** 是否已同步到薪资单 */
  syncedToPaySlip: boolean;
  /** 关联的薪资单 ID */
  paySlipId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 员工名字别名映射 ─────────────────────────────────────────────────────────

/**
 * 员工名字/备注关键词 → 员工ID 的学习映射
 * 每次手动匹配后自动记录，下次遇到相同关键词自动带入
 */
export interface NameAlias {
  id: string;
  /** 关键词（小写，如 "stephen", "小宇", "pd jason"） */
  keyword: string;
  /** 对应的员工 ID */
  employeeId: string;
  /** 最后使用时间 */
  lastUsedAt: string;
  /** 使用次数 */
  useCount: number;
}

// ─── State / Actions ──────────────────────────────────────────────────────────

interface LinkState {
  links: PettyCashLaborLink[];
  aliases: NameAlias[];
}

type Action =
  | { type: "LOAD_LINKS"; payload: PettyCashLaborLink[] }
  | { type: "LOAD_ALIASES"; payload: NameAlias[] }
  | { type: "ADD_LINK"; link: PettyCashLaborLink }
  | { type: "UPDATE_LINK"; id: string; updates: Partial<PettyCashLaborLink> }
  | { type: "DELETE_LINK"; id: string }
  | { type: "UPSERT_ALIAS"; keyword: string; employeeId: string };

function reducer(state: LinkState, action: Action): LinkState {
  switch (action.type) {
    case "LOAD_LINKS": return { ...state, links: action.payload };
    case "LOAD_ALIASES": return { ...state, aliases: action.payload };
    case "ADD_LINK": return { ...state, links: [action.link, ...state.links] };
    case "UPDATE_LINK":
      return { ...state, links: state.links.map((l) => l.id === action.id ? { ...l, ...action.updates, updatedAt: new Date().toISOString() } : l) };
    case "DELETE_LINK":
      return { ...state, links: state.links.filter((l) => l.id !== action.id) };
    case "UPSERT_ALIAS": {
      const existing = state.aliases.find((a) => a.keyword === action.keyword.toLowerCase());
      if (existing) {
        return {
          ...state,
          aliases: state.aliases.map((a) => a.keyword === action.keyword.toLowerCase()
            ? { ...a, employeeId: action.employeeId, lastUsedAt: new Date().toISOString(), useCount: a.useCount + 1 }
            : a
          ),
        };
      }
      return {
        ...state,
        aliases: [...state.aliases, {
          id: uuid(),
          keyword: action.keyword.toLowerCase(),
          employeeId: action.employeeId,
          lastUsedAt: new Date().toISOString(),
          useCount: 1,
        }],
      };
    }
    default: return state;
  }
}

// ─── 智能匹配：从备注中提取关键词并匹配员工 ──────────────────────────────────

/**
 * 从备注文本中提取可能的员工名字关键词
 * 规则：去掉括号内容、分割空格/标点，取每个词段
 */
export function extractKeywords(description: string): string[] {
  if (!description) return [];
  // 去掉 (pd)、(pt)、w (pd) 等前缀标记
  const cleaned = description
    .replace(/\(pd\)/gi, "")
    .replace(/\(pt\)/gi, "")
    .replace(/w\s*/gi, "")
    .replace(/[()（）]/g, " ")
    .trim();
  // 分割并过滤短词
  return cleaned.split(/[\s,，·、/]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);
}

/**
 * 根据备注和别名映射表，智能匹配员工 ID
 * 返回匹配到的员工 ID，或空字符串
 */
export function matchEmployeeFromDescription(
  description: string,
  aliases: NameAlias[],
  employees: { id: string; code: string; realName?: string }[]
): { employeeId: string; matchType: "auto" | "unmatched" } {
  if (!description) return { employeeId: "", matchType: "unmatched" };

  const keywords = extractKeywords(description);
  const descLower = description.toLowerCase();

  // 1. 先查别名映射表（学习记忆）
  for (const alias of aliases.sort((a, b) => b.useCount - a.useCount)) {
    if (descLower.includes(alias.keyword)) {
      return { employeeId: alias.employeeId, matchType: "auto" };
    }
  }

  // 2. 再直接匹配员工 code 或 realName
  for (const emp of employees) {
    const codeL = emp.code.toLowerCase();
    const nameL = (emp.realName ?? "").toLowerCase();
    if (keywords.some((k) => codeL.includes(k) || (nameL && nameL.includes(k)))) {
      return { employeeId: emp.id, matchType: "auto" };
    }
  }

  return { employeeId: "", matchType: "unmatched" };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface LinkContextValue {
  links: PettyCashLaborLink[];
  aliases: NameAlias[];
  /** 新增一条备用金-人工关联 */
  addLink: (data: Omit<PettyCashLaborLink, "id" | "createdAt" | "updatedAt">) => string;
  /** 更新关联（如手动匹配员工、标记已同步） */
  updateLink: (id: string, updates: Partial<PettyCashLaborLink>) => void;
  /** 删除关联（取消纳入薪资预支） */
  deleteLink: (id: string) => void;
  /** 记录名字别名（手动匹配后调用） */
  learnAlias: (keyword: string, employeeId: string) => void;
  /** 获取某月的所有关联 */
  getLinksForMonth: (month: string) => PettyCashLaborLink[];
  /** 判断某条备用金记录是否已被关联 */
  isLinked: (pettyRecordId: string) => boolean;
  /** 备用金记录被修改时同步更新关联快照 */
  syncFromPettyRecord: (pettyRecordId: string, updates: { amount?: number; description?: string; paymentMethod?: string; date?: string }) => void;
  /** 备用金记录被删除时，根据 pettyRecordId 删除关联，返回被删除的关联（用于调用方从薪资单移除） */
  deleteLinkByPettyId: (pettyRecordId: string) => PettyCashLaborLink | null;
}

const LinkContext = createContext<LinkContextValue>({
  links: [], aliases: [],
  addLink: () => "", updateLink: () => {}, deleteLink: () => {},
  learnAlias: () => {}, getLinksForMonth: () => [], isLinked: () => false,
  syncFromPettyRecord: () => {},
  deleteLinkByPettyId: () => null,
});

export function PettyLaborLinkProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { links: [], aliases: [] });

  useEffect(() => {
    const loadLinks = (raw: string | null) => {
      if (!raw) return;
      try { dispatch({ type: "LOAD_LINKS", payload: JSON.parse(raw) }); } catch {}
    };
    const loadAliases = (raw: string | null) => {
      if (!raw) return;
      try { dispatch({ type: "LOAD_ALIASES", payload: JSON.parse(raw) }); } catch {}
    };
    AsyncStorage.getItem(LINK_STORAGE_KEY).then(loadLinks);
    AsyncStorage.getItem(ALIAS_STORAGE_KEY).then(loadAliases);
    registerStoreReload(() => {
      AsyncStorage.getItem(LINK_STORAGE_KEY).then(loadLinks);
      AsyncStorage.getItem(ALIAS_STORAGE_KEY).then(loadAliases);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(state.links)).catch(() => {});
    notifySyncChange(LINK_STORAGE_KEY);
  }, [state.links]);

  useEffect(() => {
    AsyncStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(state.aliases)).catch(() => {});
    notifySyncChange(ALIAS_STORAGE_KEY);
  }, [state.aliases]);

  const addLink = useCallback((data: Omit<PettyCashLaborLink, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    dispatch({ type: "ADD_LINK", link: { ...data, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    return id;
  }, []);

  const updateLink = useCallback((id: string, updates: Partial<PettyCashLaborLink>) => {
    dispatch({ type: "UPDATE_LINK", id, updates });
  }, []);

  const deleteLink = useCallback((id: string) => {
    dispatch({ type: "DELETE_LINK", id });
  }, []);

  const learnAlias = useCallback((keyword: string, employeeId: string) => {
    if (!keyword || !employeeId) return;
    dispatch({ type: "UPSERT_ALIAS", keyword: keyword.toLowerCase(), employeeId });
  }, []);

  const getLinksForMonth = useCallback((month: string) => {
    return state.links.filter((l) => l.month === month);
  }, [state.links]);

  const isLinked = useCallback((pettyRecordId: string) => {
    return state.links.some((l) => l.pettyRecordId === pettyRecordId);
  }, [state.links]);

  /**
   * 当备用金原始记录被修改时，同步更新关联快照中的只读字段
   * 调用方：在 PettyCashProvider 的 updateRecord 后调用
   */
  const syncFromPettyRecord = useCallback((pettyRecordId: string, updates: { amount?: number; description?: string; paymentMethod?: string; date?: string }) => {
    const link = state.links.find((l) => l.pettyRecordId === pettyRecordId);
    if (!link) return;
    dispatch({ type: "UPDATE_LINK", id: link.id, updates });
  }, [state.links]);

  /**
   * 备用金记录被删除时调用：删除关联并返回被删除的关联对象
   * 调用方应在收到返回值后，从对应员工的薪资单中移除 pettyLaborPaid
   */
  const deleteLinkByPettyId = useCallback((pettyRecordId: string): PettyCashLaborLink | null => {
    const link = state.links.find((l) => l.pettyRecordId === pettyRecordId);
    if (!link) return null;
    dispatch({ type: "DELETE_LINK", id: link.id });
    return link;
  }, [state.links]);

  return (
    <LinkContext.Provider value={{ links: state.links, aliases: state.aliases, addLink, updateLink, deleteLink, learnAlias, getLinksForMonth, isLinked, syncFromPettyRecord, deleteLinkByPettyId }}>
      {children}
    </LinkContext.Provider>
  );
}

export function usePettyLaborLinkStore() { return useContext(LinkContext); }

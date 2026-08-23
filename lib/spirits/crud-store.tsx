/**
 * 烈酒进销存 CRUD Store（升级版）
 * 支持：手动增删改酒款、月份切换、进货流水录入、Excel/PDF 导入、台账月结
 * 新增：参考单价按月生效、品牌集团管理、供应商信息卡、备用金匹配记忆、自采分类配置
 */
import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { purchasesForMonth, type PendingSpiritPurchase } from "./import-bridge";
import { moveInventoryCategory } from "./category-lifecycle";
import { normalizeSpiritSupplierAliases } from "./supplier-alias";
import { summarizeSpiritLedgerByCategory, type SpiritCategorySummary } from "./category-summary";
import { applyAtomicSpiritBatchCategorySelection, applyAtomicSpiritCategorySelection } from "./category-selection";
import { sumMoney } from "@/lib/finance/money";
import {
  SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry,
  SpiritRefPrice, SpiritSupplierInfo, SpiritCustomCategory,
  SPIRIT_CATEGORIES, SPIRIT_CATEGORY_COLORS,
} from "./types";

const ITEMS_KEY = "spirits.items.v3";
const PURCHASES_KEY = "spirits.purchases.v3";
const LEDGER_KEY = "spirits.ledger.v3";
const REF_PRICES_KEY = "spirits.refPrices.v1";
const SUPPLIERS_KEY = "spirits.suppliers.v1";
const GROUPS_KEY = "spirits.groups.v1";
const MATCH_MEMORY_KEY = "spirits.matchMemory.v1";
const SELF_BUY_CONFIG_KEY = "spirits.selfBuyConfig.v1";
const CUSTOM_CATEGORIES_KEY = "spirits.customCategories.v1";
const GROUP_MATCH_MEMORY_KEY = "spirits.groupMatchMemory.v1";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** 模糊匹配分数（0-1），用于备用金描述与酒款名称的匹配 */
export function fuzzyMatchScore(query: string, target: string): number {
  if (!query || !target) return 0;
  // 归一化：小写 + 去除括号/空格/斜杠
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[（）()\[\]\/\\\s·・\-_,，。]/g, "");
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;

  // 1. 完全相同 → 1.0
  if (q === t) return 1.0;

  // 2. 提取关键词（去掉常见单位/容量词后的核心词）
  const stripUnits = (s: string) => s
    .replace(/\d+(\.\d+)?(ml|cl|l|oz|年|yr|year|yo|岁|瓶|箱|桶|杯|g|kg)/gi, "")
    .replace(/(limited|edition|reserve|special|premium|classic|original|extra|ultra|super|deluxe)/gi, "");
  const qCore = stripUnits(q);
  const tCore = stripUnits(t);

  // 3. 核心词完全包含（双向）→ 高分
  if (qCore.length >= 3 && tCore.includes(qCore)) return 0.92;
  if (tCore.length >= 3 && qCore.includes(tCore)) return 0.88;

  // 4. 原始词完全包含（双向）→ 中高分
  if (q.length >= 3 && t.includes(q)) return 0.82;
  if (t.length >= 3 && q.includes(t)) return 0.78;

  // 5. 分词匹配：把 query 拆成 2-4 字的词块，检查 target 包含几个
  const chunks: string[] = [];
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= qCore.length - len; i++) {
      chunks.push(qCore.slice(i, i + len));
    }
  }
  const uniqueChunks = [...new Set(chunks)];
  const matchedChunks = uniqueChunks.filter((c) => tCore.includes(c));
  if (uniqueChunks.length > 0) {
    const chunkScore = matchedChunks.length / uniqueChunks.length;
    if (chunkScore >= 0.5) return Math.min(0.75, 0.4 + chunkScore * 0.4);
  }

  // 6. 字符级 bigram 相似度（2-gram overlap）
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const qBi = bigrams(qCore);
  const tBi = bigrams(tCore);
  if (qBi.size === 0 || tBi.size === 0) return 0;
  let bigramIntersect = 0;
  qBi.forEach((b) => { if (tBi.has(b)) bigramIntersect++; });
  const bigramScore = (2 * bigramIntersect) / (qBi.size + tBi.size);

  return bigramScore;
}

/** 根据描述自动检测是否为酒水采购（用于备用金智能过滤） */
export function isLikelyAlcoholPurchase(description: string): boolean {
  const keywords = [
    "酒", "gin", "whisky", "whiskey", "rum", "vodka", "tequila", "brandy",
    "liqueur", "vermouth", "bitters", "syrup", "ml", "瓶", "箱", "cl",
    "beer", "wine", "champagne", "cognac", "mezcal", "absinthe",
  ];
  const lower = description.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ─── 品牌集团类型 ─────────────────────────────────────────────────────────────
export interface SpiritGroupDef {
  id: string;
  /** 集团中文名：页面中的主名称。 */
  nameZh: string;
  /** 集团英文名：与中文名关联的副名称，可为空。 */
  nameEn: string;
  /** 中文品牌关键词：用于中文采购名称和酒款的自动识别。 */
  keywordsZh: string[];
  /** 英文品牌关键词：用于英文采购名称和酒款的自动识别。 */
  keywordsEn: string[];
  color: string;
  /** 是否为首次安装时提供的预置集团；仅用于标识来源，不再限制删除。 */
  builtin: boolean;
  createdAt: string;
}

export function getSpiritGroupDisplayName(group: Pick<SpiritGroupDef, "nameZh" | "nameEn">): string {
  return group.nameZh.trim() || group.nameEn.trim() || "未命名集团";
}

export function getSpiritGroupLegacyName(group: Pick<SpiritGroupDef, "nameZh" | "nameEn">): string {
  const nameZh = group.nameZh.trim();
  const nameEn = group.nameEn.trim();
  return nameZh && nameEn ? `${nameZh} (${nameEn})` : nameZh || nameEn;
}

export function getSpiritGroupKeywords(group: Pick<SpiritGroupDef, "keywordsZh" | "keywordsEn">): string[] {
  return [...group.keywordsZh, ...group.keywordsEn];
}

/** 备用金匹配记忆：记住「描述X → 酒款ID Y」的映射 */
export interface PettyMatchMemory {
  /** 备用金描述（归一化后） */
  description: string;
  /** 匹配到的酒款 ID */
  itemId: string;
  /** 匹配到的酒款名称（用于显示） */
  itemName: string;
  /** 置信度 */
  confidence: "high" | "medium" | "manual";
  /** 最后确认时间 */
  confirmedAt: string;
}

/** 集团匹配记忆：rawName → groupName */
export interface GroupMatchMemory {
  rawName: string;
  groupName: string;
  confirmedAt: string;
}

/** 自采配置：哪些备用金分类代码视为酒水自采 */
export interface SelfBuyConfig {
  /** 勾选的备用金分类代码，如 ["B1", "B2"] */
  pettyCodes: string[];
  /** 是否启用 AI 关键词二次过滤（description 中含酒水关键词才导入） */
  useKeywordFilter: boolean;
  /** 更新时间 */
  updatedAt: string;
}

const DEFAULT_SELF_BUY_CONFIG: SelfBuyConfig = {
  pettyCodes: ["B1"],
  useKeywordFilter: true,
  updatedAt: new Date().toISOString(),
};

// ─── 内置品牌集团 ─────────────────────────────────────────────────────────────
const BUILTIN_GROUPS: SpiritGroupDef[] = [
  { id: "group_pernod", nameZh: "保乐力加", nameEn: "Pernod Ricard", color: "#1D4ED8",
    keywordsZh: ["芝华士", "百龄坛", "必富达", "哈瓦那", "马爹利", "甘露", "马利宝", "三得利响", "皇家礼炮", "绝对"],
    keywordsEn: ["chivas", "ballantine", "beefeater", "havana", "martell", "kahlua", "malibu", "hibiki", "royal salute", "absolut"],
    builtin: true, createdAt: new Date().toISOString() },
  { id: "group_campari", nameZh: "金巴利集团", nameEn: "Campari Group", color: "#DC2626",
    keywordsZh: ["金巴利", "阿佩罗", "深蓝", "野火鸡", "大马利尼", "古贝塔"],
    keywordsEn: ["campari", "aperol", "skyy", "wild turkey", "grand marnier", "courvoisier", "appleton"],
    builtin: true, createdAt: new Date().toISOString() },
  { id: "group_diageo", nameZh: "帝亚吉欧", nameEn: "Diageo", color: "#7C3AED",
    keywordsZh: ["尊尼获加", "添加利", "贝利", "摩根船长", "斯米诺", "尊美醇"],
    keywordsEn: ["johnnie walker", "tanqueray", "baileys", "captain morgan", "smirnoff", "jameson"],
    builtin: true, createdAt: new Date().toISOString() },
  { id: "group_brownforman", nameZh: "百富门", nameEn: "Brown-Forman", color: "#92400E",
    keywordsZh: ["杰克丹尼", "白占边", "美格", "老福斯特", "伍德福德"],
    keywordsEn: ["jack daniel", "jim beam", "maker", "old forester", "woodford"],
    builtin: true, createdAt: new Date().toISOString() },
  { id: "group_beamsuntory", nameZh: "宾三得利", nameEn: "Beam Suntory", color: "#B45309",
    keywordsZh: ["山崎", "白州", "知多", "角瓶", "三得利", "响", "乐加维林"],
    keywordsEn: ["yamazaki", "hakushu", "chita", "kakubin", "suntory", "hibiki", "laphroaig"],
    builtin: true, createdAt: new Date().toISOString() },
  { id: "group_remy", nameZh: "人头马君度", nameEn: "Rémy Cointreau", color: "#059669",
    keywordsZh: ["人头马", "君度", "路易十三", "圣哲曼"],
    keywordsEn: ["remy martin", "cointreau", "louis xiii", "st germain", "metaxa"],
    builtin: true, createdAt: new Date().toISOString() },
];

function normalizedKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((keyword): keyword is string => typeof keyword === "string").map((keyword) => keyword.trim()).filter(Boolean))];
}

function splitLegacyGroupName(value: string): { nameZh: string; nameEn: string } {
  const match = /^(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$/.exec(value.trim());
  if (match) return { nameZh: match[1].trim(), nameEn: match[2].trim() };
  return { nameZh: value.trim(), nameEn: "" };
}

function splitLegacyKeywords(keywords: string[]): { keywordsZh: string[]; keywordsEn: string[] } {
  return {
    keywordsZh: keywords.filter((keyword) => /[\u3400-\u9FFF]/.test(keyword)),
    keywordsEn: keywords.filter((keyword) => !/[\u3400-\u9FFF]/.test(keyword)),
  };
}

function normalizeSpiritGroup(value: unknown): SpiritGroupDef | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SpiritGroupDef> & { name?: unknown; keywords?: unknown };
  if (typeof raw.id !== "string" || typeof raw.color !== "string") return null;
  const fallback = BUILTIN_GROUPS.find((group) => group.id === raw.id);
  const legacyName = typeof raw.name === "string" ? splitLegacyGroupName(raw.name) : { nameZh: "", nameEn: "" };
  const legacyKeywords = splitLegacyKeywords(normalizedKeywords(raw.keywords));
  const hasKeywordsZh = Array.isArray(raw.keywordsZh);
  const hasKeywordsEn = Array.isArray(raw.keywordsEn);
  const nameZh = typeof raw.nameZh === "string" ? raw.nameZh.trim() : legacyName.nameZh || fallback?.nameZh || "";
  const nameEn = typeof raw.nameEn === "string" ? raw.nameEn.trim() : legacyName.nameEn || fallback?.nameEn || "";
  return {
    id: raw.id,
    nameZh,
    nameEn,
    keywordsZh: hasKeywordsZh ? normalizedKeywords(raw.keywordsZh) : legacyKeywords.keywordsZh.length > 0 ? legacyKeywords.keywordsZh : fallback?.keywordsZh ?? [],
    keywordsEn: hasKeywordsEn ? normalizedKeywords(raw.keywordsEn) : legacyKeywords.keywordsEn.length > 0 ? legacyKeywords.keywordsEn : fallback?.keywordsEn ?? [],
    color: raw.color,
    builtin: Boolean(raw.builtin ?? fallback?.builtin),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallback?.createdAt ?? new Date().toISOString(),
  };
}

function groupReferenceNames(group: SpiritGroupDef): Set<string> {
  return new Set([getSpiritGroupDisplayName(group), getSpiritGroupLegacyName(group), group.nameZh, group.nameEn].filter(Boolean));
}

// ─── State 定义 ───────────────────────────────────────────────────────────────
interface SpiritsState {
  items: SpiritItem[];
  purchases: SpiritPurchaseRecord[];
  ledger: SpiritLedgerEntry[];
  refPrices: SpiritRefPrice[];
  suppliers: SpiritSupplierInfo[];
  groups: SpiritGroupDef[];
  matchMemory: PettyMatchMemory[];
  selfBuyConfig: SelfBuyConfig;
  customCategories: SpiritCustomCategory[];
  groupMatchMemory: GroupMatchMemory[];
}

const initial: SpiritsState = {
  items: [], purchases: [], ledger: [],
  refPrices: [], suppliers: [],
  groups: BUILTIN_GROUPS,
  matchMemory: [],
  selfBuyConfig: DEFAULT_SELF_BUY_CONFIG,
  customCategories: [],
  groupMatchMemory: [],
};

export function isCurrentSpiritLedgerEntry(value: unknown): value is SpiritLedgerEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const textFields = ["id", "month", "itemId", "updatedAt"];
  const numberFields = ["openingQty", "openingUnitCost", "purchaseQty", "purchaseCost", "consumeQty", "consumeCost", "closingQty", "closingUnitCost", "closingCost"];
  return textFields.every((field) => typeof entry[field] === "string")
    && numberFields.every((field) => typeof entry[field] === "number" && Number.isFinite(entry[field]))
    && typeof entry.isClosed === "boolean";
}

type Action =
  | { type: "LOAD"; payload: SpiritsState }
  | { type: "ADD_ITEM"; item: SpiritItem }
  | { type: "UPDATE_ITEM"; id: string; patch: Partial<SpiritItem> }
  | { type: "SET_ITEM_AND_PURCHASE_CATEGORY"; itemId: string; purchaseId?: string; category: string }
  | { type: "SET_ITEMS_AND_PURCHASES_CATEGORY"; purchaseIds: string[]; category: string }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_PURCHASE"; record: SpiritPurchaseRecord }
  | { type: "UPDATE_PURCHASE"; id: string; patch: Partial<SpiritPurchaseRecord> }
  | { type: "DELETE_PURCHASE"; id: string }
  | { type: "BATCH_ADD_PURCHASES"; records: SpiritPurchaseRecord[] }
  | { type: "BATCH_DELETE_PURCHASES"; ids: string[] }
  | { type: "UPSERT_LEDGER"; entry: SpiritLedgerEntry }
  | { type: "DELETE_LEDGER"; id: string }
  | { type: "SET_REF_PRICE"; entry: SpiritRefPrice }
  | { type: "UPSERT_SUPPLIER"; supplier: SpiritSupplierInfo }
  | { type: "DELETE_SUPPLIER"; id: string }
  | { type: "UPSERT_GROUP"; group: SpiritGroupDef }
  | { type: "DELETE_GROUP"; id: string }
  | { type: "SET_MATCH_MEMORY"; memory: PettyMatchMemory }
  | { type: "UPDATE_SELF_BUY_CONFIG"; config: SelfBuyConfig }
  | { type: "UPSERT_CUSTOM_CATEGORY"; category: SpiritCustomCategory }
  | { type: "MIGRATE_CATEGORY_CONTENT"; fromCategory: string; toCategory: string }
  | { type: "MIGRATE_AND_DELETE_CATEGORY"; category: { id: string; name: string; color: string; builtin: boolean; order: number }; toCategory: string }
  | { type: "SET_GROUP_MATCH_MEMORY"; memory: GroupMatchMemory };

function reducer(state: SpiritsState, action: Action): SpiritsState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_ITEM": return { ...state, items: [...state.items, action.item] };
    case "UPDATE_ITEM": return {
      ...state,
      items: state.items.map((i) => i.id === action.id ? { ...i, ...action.patch, updatedAt: new Date().toISOString() } : i),
    };
    // 采购详情的快速分类必须在同一个 reducer transition 中更新库存主档和当前采购记录。
    // 这样列表分类列与库存管理不会经历两个渲染周期或保留旧快照。
    case "SET_ITEM_AND_PURCHASE_CATEGORY": return {
      ...state,
      ...applyAtomicSpiritCategorySelection(state.items, state.purchases, action.itemId, action.category, action.purchaseId),
    };
    case "SET_ITEMS_AND_PURCHASES_CATEGORY": return {
      ...state,
      ...applyAtomicSpiritBatchCategorySelection(state.items, state.purchases, action.purchaseIds, action.category),
    };
    case "DELETE_ITEM": return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "ADD_PURCHASE": return { ...state, purchases: [...state.purchases, action.record] };
    case "UPDATE_PURCHASE": return {
      ...state,
      purchases: state.purchases.map((p) => p.id === action.id ? { ...p, ...action.patch } : p),
    };
    case "DELETE_PURCHASE": return { ...state, purchases: state.purchases.filter((p) => p.id !== action.id) };
    case "BATCH_ADD_PURCHASES": return { ...state, purchases: [...state.purchases, ...action.records] };
    case "BATCH_DELETE_PURCHASES": return { ...state, purchases: state.purchases.filter((p) => !action.ids.includes(p.id)) };
    case "UPSERT_LEDGER": {
      const idx = state.ledger.findIndex((e) => e.id === action.entry.id);
      if (idx >= 0) {
        const next = [...state.ledger];
        next[idx] = action.entry;
        return { ...state, ledger: next };
      }
      return { ...state, ledger: [...state.ledger, action.entry] };
    }
    case "DELETE_LEDGER": return { ...state, ledger: state.ledger.filter((e) => e.id !== action.id) };
    case "SET_REF_PRICE": {
      // 同一 itemId + month 只保留一条
      const filtered = state.refPrices.filter((r) => !(r.itemId === action.entry.itemId && r.month === action.entry.month));
      return { ...state, refPrices: [...filtered, action.entry] };
    }
    case "UPSERT_SUPPLIER": {
      const idx = state.suppliers.findIndex((s) => s.id === action.supplier.id);
      if (idx >= 0) {
        const next = [...state.suppliers];
        next[idx] = action.supplier;
        return { ...state, suppliers: next };
      }
      return { ...state, suppliers: [...state.suppliers, action.supplier] };
    }
    case "DELETE_SUPPLIER": return { ...state, suppliers: state.suppliers.filter((s) => s.id !== action.id) };
    case "UPSERT_GROUP": {
      const idx = state.groups.findIndex((group) => group.id === action.group.id);
      if (idx < 0) return { ...state, groups: [...state.groups, action.group] };
      const previous = state.groups[idx];
      const previousNames = groupReferenceNames(previous);
      const displayName = getSpiritGroupDisplayName(action.group);
      const groups = [...state.groups];
      groups[idx] = action.group;
      return {
        ...state,
        groups,
        items: state.items.map((item) => previousNames.has(item.group ?? "") ? { ...item, group: displayName, updatedAt: new Date().toISOString() } : item),
        purchases: state.purchases.map((purchase) => previousNames.has(purchase.group ?? "") ? { ...purchase, group: displayName } : purchase),
        groupMatchMemory: state.groupMatchMemory.map((memory) => previousNames.has(memory.groupName) ? { ...memory, groupName: displayName, confirmedAt: new Date().toISOString() } : memory),
      };
    }
    case "DELETE_GROUP": {
      const group = state.groups.find((entry) => entry.id === action.id);
      if (!group) return state;
      const names = groupReferenceNames(group);
      return {
        ...state,
        groups: state.groups.filter((entry) => entry.id !== action.id),
        items: state.items.map((item) => names.has(item.group ?? "") ? { ...item, group: undefined, updatedAt: new Date().toISOString() } : item),
        purchases: state.purchases.map((purchase) => names.has(purchase.group ?? "") ? { ...purchase, group: undefined } : purchase),
        groupMatchMemory: state.groupMatchMemory.filter((memory) => !names.has(memory.groupName)),
      };
    }
    case "UPSERT_CUSTOM_CATEGORY": {
      const idx = state.customCategories.findIndex((c) => c.id === action.category.id);
      if (idx >= 0) {
        const next = [...state.customCategories];
        next[idx] = action.category;
        return { ...state, customCategories: next };
      }
      return { ...state, customCategories: [...state.customCategories, action.category] };
    }
    case "MIGRATE_CATEGORY_CONTENT": return {
      ...state,
      // 采购分类是发生时快照；当前主档迁移不得改写已归档或历史月份。
      items: state.items.map((item) => item.category === action.fromCategory ? { ...item, category: action.toCategory, categorySource: "manual", updatedAt: new Date().toISOString() } : item),
    };
    case "MIGRATE_AND_DELETE_CATEGORY": {
      const previous = state.customCategories.find((entry) => entry.id === action.category.id);
      const remaining = state.customCategories.filter((entry) => entry.id !== action.category.id);
      const deletedBuiltinMarker: SpiritCustomCategory | null = action.category.builtin ? {
        id: action.category.id,
        originalName: action.category.id,
        name: action.category.name,
        color: action.category.color,
        builtin: true,
        deleted: true,
        order: action.category.order,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      } : null;
      return {
        ...state,
        // 只迁移现行主档；历史采购分类永久保留原始快照。
        items: state.items.map((item) => item.category === action.category.name ? { ...item, category: action.toCategory, categorySource: "manual", updatedAt: new Date().toISOString() } : item),
        // 内置分类通过墓碑记录被删除，避免下一次启动时由默认分类集重新注入。
        customCategories: deletedBuiltinMarker ? [...remaining, deletedBuiltinMarker] : remaining,
      };
    }
    case "SET_GROUP_MATCH_MEMORY": {
      const filtered = state.groupMatchMemory.filter((m) => m.rawName !== action.memory.rawName);
      return { ...state, groupMatchMemory: [...filtered, action.memory] };
    }
    case "SET_MATCH_MEMORY": {
      const filtered = state.matchMemory.filter((m) => m.description !== action.memory.description);
      return { ...state, matchMemory: [...filtered, action.memory] };
    }
    case "UPDATE_SELF_BUY_CONFIG": return { ...state, selfBuyConfig: action.config };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface SpiritsContextValue extends SpiritsState {
  // 酒款档案
  addItem: (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">) => SpiritItem;
  updateItem: (id: string, patch: Partial<SpiritItem>) => void;
  setItemAndPurchaseCategory: (itemId: string, category: string, purchaseId?: string) => void;
  setItemsAndPurchasesCategory: (purchaseIds: string[], category: string) => void;
  deleteItem: (id: string) => void;
  // 进货流水
  addPurchase: (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">) => SpiritPurchaseRecord;
  updatePurchase: (id: string, patch: Partial<SpiritPurchaseRecord>) => void;
  deletePurchase: (id: string) => void;
  batchAddPurchases: (records: Omit<SpiritPurchaseRecord, "id" | "createdAt">[]) => void;
  batchDeletePurchases: (ids: string[]) => void;
  // 台账
  upsertLedger: (entry: Omit<SpiritLedgerEntry, "id" | "updatedAt"> & { id?: string }) => void;
  deleteLedger: (id: string) => void;
  // 参考单价（按月生效）
  setRefPrice: (itemId: string, month: string, price: number, by?: "manual" | "import") => void;
  getRefPrice: (itemId: string, month: string) => number;
  // 供应商信息卡
  upsertSupplier: (supplier: Omit<SpiritSupplierInfo, "id" | "createdAt" | "updatedAt"> & { id?: string }) => SpiritSupplierInfo;
  deleteSupplier: (id: string) => void;
  getSupplierByName: (name: string) => SpiritSupplierInfo | undefined;
  // 品牌集团
  upsertGroup: (group: Omit<SpiritGroupDef, "id" | "createdAt"> & { id?: string }) => void;
  deleteGroup: (id: string) => void;
  getItemGroup: (item: SpiritItem) => string;
  detectPurchaseGroup: (rawName: string) => string;
  rememberGroupMatch: (rawName: string, groupName: string) => void;
  // 自定义分类
  getAllCategories: () => { name: string; color: string; builtin: boolean; id: string; order: number }[];
  upsertCustomCategory: (data: Omit<SpiritCustomCategory, "id" | "createdAt"> & { id?: string }) => void;
  moveCategory: (id: string, direction: "up" | "down") => void;
  removeCategorySafely: (id: string, toCategory: string) => boolean;
  getCategoryColor: (catName: string) => string;
  // 备用金匹配记忆
  setMatchMemory: (description: string, itemId: string, itemName: string, confidence: PettyMatchMemory["confidence"]) => void;
  findMatchMemory: (description: string) => PettyMatchMemory | undefined;
  matchPettyToItem: (description: string) => { item: SpiritItem; score: number; source: "memory" | "fuzzy" } | null;
  // 自采配置
  updateSelfBuyConfig: (config: Partial<SelfBuyConfig>) => void;
  // 查询
  getMonthPurchases: (month: string) => SpiritPurchaseRecord[];
  getSupplierMonthPurchases: (supplier: string, month: string) => SpiritPurchaseRecord[];
  getMonthLedger: (month: string) => SpiritLedgerEntry[];
  getItemLedger: (itemId: string, month: string) => SpiritLedgerEntry | undefined;
  getAvailableMonths: () => string[];
  getPurchaseSummaryByCategory: (month: string) => Record<string, SpiritCategorySummary>;
  getPurchaseSummaryBySupplier: (month: string) => Record<string, { qty: number; amount: number; items: number }>;
  // 月结
  closeMonth: (month: string) => void;
  syncLedgerFromPurchases: (month: string, pending?: readonly PendingSpiritPurchase[], purchaseSource?: readonly SpiritPurchaseRecord[]) => void;
  /** ★ 月末盘点：录入实际期末库存量，自动反推消耗量 */
  setActualClosing: (itemId: string, month: string, actualQty: number) => void;
  /** ★ 批量月末盘点：一次性录入所有酒款的实际期末库存量 */
  batchSetActualClosing: (month: string, entries: { itemId: string; actualQty: number }[]) => void;
  /** ★ 检查上月是否需要月结（切换月份时调用） */
  checkPrevMonthClosed: (currentMonth: string) => { needsClose: boolean; prevMonth: string };
}

const SpiritsContext = createContext<SpiritsContextValue | null>(null);

export function SpiritsInventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const loadedRef = useRef(false);
  const skipNextPersistenceRef = useRef(true);

  // 加载持久化数据
  useEffect(() => {
    const load = () => Promise.all([
      AsyncStorage.getItem(ITEMS_KEY),
      AsyncStorage.getItem(PURCHASES_KEY),
      AsyncStorage.getItem(LEDGER_KEY),
      AsyncStorage.getItem(REF_PRICES_KEY),
      AsyncStorage.getItem(SUPPLIERS_KEY),
      AsyncStorage.getItem(GROUPS_KEY),
      AsyncStorage.getItem(MATCH_MEMORY_KEY),
      AsyncStorage.getItem(SELF_BUY_CONFIG_KEY),
      AsyncStorage.getItem(CUSTOM_CATEGORIES_KEY),
      AsyncStorage.getItem(GROUP_MATCH_MEMORY_KEY),
    ]).then(([itemsRaw, purchasesRaw, ledgerRaw, refPricesRaw, suppliersRaw, groupsRaw, matchMemoryRaw, selfBuyRaw, customCatsRaw, groupMatchRaw]) => {
      const parsedItems: SpiritItem[] = itemsRaw ? JSON.parse(itemsRaw) : [];
      const items = parsedItems.map((item) => ({
        ...item,
        supplierAliases: normalizeSpiritSupplierAliases(item.supplierAliases),
      }));
      const purchases = purchasesRaw ? JSON.parse(purchasesRaw) : [];
      const parsedLedger: unknown = ledgerRaw ? JSON.parse(ledgerRaw) : [];
      const ledger: SpiritLedgerEntry[] = Array.isArray(parsedLedger)
        ? parsedLedger.filter(isCurrentSpiritLedgerEntry)
        : [];
      const refPrices = refPricesRaw ? JSON.parse(refPricesRaw) : [];
      const suppliers = suppliersRaw ? JSON.parse(suppliersRaw) : [];
      const parsedGroups: unknown = groupsRaw ? JSON.parse(groupsRaw) : null;
      // 首次安装才提供预置集团。只要用户曾保存过集团列表，就尊重其删除结果，绝不把已删集团重新注入。
      const groups = Array.isArray(parsedGroups)
        ? parsedGroups.map(normalizeSpiritGroup).filter((group): group is SpiritGroupDef => Boolean(group))
        : BUILTIN_GROUPS;
      const matchMemory = matchMemoryRaw ? JSON.parse(matchMemoryRaw) : [];
      const selfBuyConfig = selfBuyRaw ? JSON.parse(selfBuyRaw) : DEFAULT_SELF_BUY_CONFIG;
      const customCategories: SpiritCustomCategory[] = customCatsRaw ? JSON.parse(customCatsRaw) : [];
      const groupMatchMemory: GroupMatchMemory[] = groupMatchRaw ? JSON.parse(groupMatchRaw) : [];
      skipNextPersistenceRef.current = true;
      dispatch({ type: "LOAD", payload: { items, purchases, ledger, refPrices, suppliers, groups, matchMemory, selfBuyConfig, customCategories, groupMatchMemory } });
      loadedRef.current = true;
    });
    load();
    return registerStoreReload(() => { void load(); });
  }, []);

  // 仅用户命令产生的状态变化才落盘并通知同步；初次加载/远端重载绝不重新标脏。
  useEffect(() => {
    if (!loadedRef.current) return;
    if (skipNextPersistenceRef.current) {
      skipNextPersistenceRef.current = false;
      return;
    }
    const entries: [string, string][] = [
      [ITEMS_KEY, JSON.stringify(state.items)],
      [PURCHASES_KEY, JSON.stringify(state.purchases)],
      [LEDGER_KEY, JSON.stringify(state.ledger)],
      [REF_PRICES_KEY, JSON.stringify(state.refPrices)],
      [SUPPLIERS_KEY, JSON.stringify(state.suppliers)],
      [GROUPS_KEY, JSON.stringify(state.groups)],
      [MATCH_MEMORY_KEY, JSON.stringify(state.matchMemory)],
      [SELF_BUY_CONFIG_KEY, JSON.stringify(state.selfBuyConfig)],
      [CUSTOM_CATEGORIES_KEY, JSON.stringify(state.customCategories)],
      [GROUP_MATCH_MEMORY_KEY, JSON.stringify(state.groupMatchMemory)],
    ];
    void AsyncStorage.multiSet(entries)
      .then(() => entries.forEach(([key]) => notifySyncChange(key)))
      .catch((error: unknown) => console.warn("烈酒库存写入失败", error));
  }, [state]);

  // ── 酒款档案 ──────────────────────────────────────────────────────────────
  const addItem = (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">): SpiritItem => {
    const now = new Date().toISOString();
    const item: SpiritItem = {
      ...data,
      supplierAliases: normalizeSpiritSupplierAliases(data.supplierAliases),
      id: uuid(),
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: "ADD_ITEM", item });
    return item;
  };

  const updateItem = (id: string, patch: Partial<SpiritItem>) => {
    const normalizedPatch = patch.supplierAliases === undefined
      ? patch
      : { ...patch, supplierAliases: normalizeSpiritSupplierAliases(patch.supplierAliases) };
    // 分类只影响现行酒款；采购记录保存发生时快照，不得被当前编辑改写。
    dispatch({ type: "UPDATE_ITEM", id, patch: normalizedPatch });
  };

  const setItemAndPurchaseCategory = (itemId: string, category: string, purchaseId?: string) => {
    dispatch({ type: "SET_ITEM_AND_PURCHASE_CATEGORY", itemId, category: category.trim(), ...(purchaseId ? { purchaseId } : {}) });
  };

  const setItemsAndPurchasesCategory = (purchaseIds: string[], category: string) => {
    dispatch({ type: "SET_ITEMS_AND_PURCHASES_CATEGORY", purchaseIds, category: category.trim() });
  };

  const deleteItem = (id: string) => {
    dispatch({ type: "DELETE_ITEM", id });
  };

  // ── 进货流水 ──────────────────────────────────────────────────────────────
  const addPurchase = (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">): SpiritPurchaseRecord => {
    const record: SpiritPurchaseRecord = { ...data, id: uuid(), createdAt: new Date().toISOString() };
    dispatch({ type: "ADD_PURCHASE", record });
    return record;
  };

  const updatePurchase = (id: string, patch: Partial<SpiritPurchaseRecord>) => {
    // ★ 匹配关联：当进货记录关联到酒款时，自动同步分类
    let finalPatch = { ...patch };
    if (patch.itemId !== undefined) {
      const item = state.items.find((i) => i.id === patch.itemId);
      if (item?.category && !patch.category) {
        finalPatch = { ...finalPatch, category: item.category };
      }
    }
    dispatch({ type: "UPDATE_PURCHASE", id, patch: finalPatch });
  };

  const deletePurchase = (id: string) => {
    dispatch({ type: "DELETE_PURCHASE", id });
  };

  const batchAddPurchases = (records: Omit<SpiritPurchaseRecord, "id" | "createdAt">[]) => {
    const now = new Date().toISOString();
    const full = records.map((r) => ({ ...r, id: uuid(), createdAt: now }));
    dispatch({ type: "BATCH_ADD_PURCHASES", records: full });
    // ★ 自动更新参考单价：每款酒取该月最新单价更新 refPrice
    const byItemMonth: Record<string, { itemId: string; month: string; unitPrice: number }> = {};
    for (const r of records) {
      if (!r.itemId || !r.month) continue;
      const key = `${r.itemId}:${r.month}`;
      const unitPrice = r.quantity > 0 ? r.amount / r.quantity : 0;
      if (unitPrice <= 0) continue;
      if (!byItemMonth[key] || unitPrice > byItemMonth[key].unitPrice) {
        byItemMonth[key] = { itemId: r.itemId, month: r.month, unitPrice };
      }
    }
    Object.values(byItemMonth).forEach(({ itemId, month, unitPrice }) => {
      setRefPrice(itemId, month, unitPrice, "import");
    });
  };

  const batchDeletePurchases = (ids: string[]) => {
    dispatch({ type: "BATCH_DELETE_PURCHASES", ids });
  };

  // ── 台账 ──────────────────────────────────────────────────────────────────
  const upsertLedger = (entry: Omit<SpiritLedgerEntry, "id" | "updatedAt"> & { id?: string }) => {
    const full: SpiritLedgerEntry = {
      ...entry,
      id: entry.id ?? uuid(),
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "UPSERT_LEDGER", entry: full });
  };

  const deleteLedger = (id: string) => {
    dispatch({ type: "DELETE_LEDGER", id });
  };

  // ── 参考单价（按月生效） ──────────────────────────────────────────────────
  const setRefPrice = (itemId: string, month: string, price: number, by: "manual" | "import" = "manual") => {
    dispatch({
      type: "SET_REF_PRICE",
      entry: { itemId, month, price, setAt: new Date().toISOString(), setBy: by },
    });
    // 同步更新 item.refPrice（最新值）
    updateItem(itemId, { refPrice: price });
  };

  /** 获取某款酒在某月的参考单价（取该月及之前最近一次设置的价格） */
  const getRefPrice = (itemId: string, month: string): number => {
    const relevant = state.refPrices
      .filter((r) => r.itemId === itemId && r.month <= month)
      .sort((a, b) => b.month.localeCompare(a.month));
    if (relevant.length > 0) return relevant[0].price;
    // 回退到 item.refPrice
    return state.items.find((i) => i.id === itemId)?.refPrice ?? 0;
  };

  // ── 供应商信息卡 ──────────────────────────────────────────────────────────
  const upsertSupplier = (data: Omit<SpiritSupplierInfo, "id" | "createdAt" | "updatedAt"> & { id?: string }): SpiritSupplierInfo => {
    const now = new Date().toISOString();
    const supplier: SpiritSupplierInfo = {
      ...data,
      id: data.id ?? uuid(),
      createdAt: data.id ? (state.suppliers.find((s) => s.id === data.id)?.createdAt ?? now) : now,
      updatedAt: now,
    };
    dispatch({ type: "UPSERT_SUPPLIER", supplier });
    return supplier;
  };

  const deleteSupplier = (id: string) => {
    dispatch({ type: "DELETE_SUPPLIER", id });
  };

  const getSupplierByName = (name: string) =>
    state.suppliers.find((s) => s.name === name);

  // ── 品牌集团 ──────────────────────────────────────────────────────────────
  const upsertGroup = (data: Omit<SpiritGroupDef, "id" | "createdAt"> & { id?: string }) => {
    const now = new Date().toISOString();
    const group: SpiritGroupDef = {
      ...data,
      id: data.id ?? uuid(),
      createdAt: data.id ? (state.groups.find((g) => g.id === data.id)?.createdAt ?? now) : now,
    };
    dispatch({ type: "UPSERT_GROUP", group });
  };

  const deleteGroup = (id: string) => {
    dispatch({ type: "DELETE_GROUP", id });
  };

  /** 获取酒款所属集团中文主名称；名称识别同时覆盖中英文关键词。 */
  const getItemGroup = (item: SpiritItem): string => {
    if (item.group) return item.group;
    const combined = `${item.name} ${item.nameEn ?? ""}`.toLowerCase();
    for (const group of state.groups) {
      if (getSpiritGroupKeywords(group).some((keyword) => combined.includes(keyword.toLowerCase()))) {
        return getSpiritGroupDisplayName(group);
      }
    }
    return "独立品牌";
  };

  const detectPurchaseGroup = (rawName: string): string => {
    const key = rawName.toLowerCase().trim();
    const memory = state.groupMatchMemory.find((entry) => entry.rawName === key);
    if (memory) return memory.groupName;
    for (const group of state.groups) {
      if (getSpiritGroupKeywords(group).some((keyword) => key.includes(keyword.toLowerCase()))) return getSpiritGroupDisplayName(group);
    }
    return "";
  };

  const rememberGroupMatch = (rawName: string, groupName: string) => {
    dispatch({
      type: "SET_GROUP_MATCH_MEMORY",
      memory: { rawName: rawName.toLowerCase().trim(), groupName, confirmedAt: new Date().toISOString() },
    });
  };

  // ── 自定义分类管理 ───────────────────────────────────────────────────────────────
  const getAllCategories = (): { name: string; color: string; builtin: boolean; id: string; order: number }[] => {
    const builtinList = (SPIRIT_CATEGORIES as readonly string[]).flatMap((cat, index) => {
      const override = state.customCategories.find((category) => category.originalName === cat || category.id === cat);
      if (override?.deleted) return [];
      return [{
        id: cat,
        name: override ? override.name : cat,
        color: override ? override.color : (SPIRIT_CATEGORY_COLORS[cat] ?? "#6B7280"),
        builtin: true,
        order: override?.order ?? index,
      }];
    });
    const customList = state.customCategories
      .filter((category) => !category.builtin && !category.deleted)
      .map((c, index) => ({ id: c.id, name: c.name, color: c.color, builtin: false, order: c.order ?? SPIRIT_CATEGORIES.length + index }));
    return [...builtinList, ...customList].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-Hans-CN"));
  };

  const upsertCustomCategory = (data: Omit<SpiritCustomCategory, "id" | "createdAt"> & { id?: string }) => {
    const now = new Date().toISOString();
    const previous = data.id ? state.customCategories.find((category) => category.id === data.id) : undefined;
    const previousName = previous?.name ?? (data.builtin ? data.originalName ?? data.id : undefined);
    const category: SpiritCustomCategory = {
      ...data,
      id: data.id ?? uuid(),
      createdAt: data.id ? (previous?.createdAt ?? now) : now,
    };
    dispatch({ type: "UPSERT_CUSTOM_CATEGORY", category });
    if (previousName && previousName !== category.name) dispatch({ type: "MIGRATE_CATEGORY_CONTENT", fromCategory: previousName, toCategory: category.name });
  };

  const moveCategory = (id: string, direction: "up" | "down") => {
    const ordered = getAllCategories();
    const changes = moveInventoryCategory(ordered, id, direction);
    if (!changes.length) return;
    const current = ordered.find((category) => category.id === changes[0].id)!;
    const target = ordered.find((category) => category.id === changes[1].id)!;
    const now = new Date().toISOString();
    const persistOrder = (category: typeof current, order: number) => dispatch({ type: "UPSERT_CUSTOM_CATEGORY", category: {
      id: category.id,
      originalName: category.builtin ? category.id : undefined,
      name: category.name,
      color: category.color,
      builtin: category.builtin,
      order,
      createdAt: state.customCategories.find((entry) => entry.id === category.id)?.createdAt ?? now,
    } });
    persistOrder(current, changes[0].order);
    persistOrder(target, changes[1].order);
  };

  const removeCategorySafely = (id: string, toCategory: string) => {
    const category = getAllCategories().find((entry) => entry.id === id);
    if (!category) return false;
    dispatch({
      type: "MIGRATE_AND_DELETE_CATEGORY",
      category: { id: category.id, name: category.name, color: category.color, builtin: category.builtin, order: category.order },
      toCategory: toCategory.trim(),
    });
    return true;
  };

  const getCategoryColor = (catName: string): string => {
    const all = getAllCategories();
    return all.find((c) => c.name === catName || c.id === catName)?.color ?? "#6B7280";
  };

  // ── 备用金匹配记忆 ────────────────────────────────────────────────────────
  const setMatchMemory = (description: string, itemId: string, itemName: string, confidence: PettyMatchMemory["confidence"]) => {
    dispatch({
      type: "SET_MATCH_MEMORY",
      memory: { description: description.toLowerCase().trim(), itemId, itemName, confidence, confirmedAt: new Date().toISOString() },
    });
  };

  const findMatchMemory = (description: string): PettyMatchMemory | undefined => {
    const key = description.toLowerCase().trim();
    return state.matchMemory.find((m) => m.description === key);
  };

  /** 智能匹配备用金描述到酒款 */
  const matchPettyToItem = (description: string): { item: SpiritItem; score: number; source: "memory" | "fuzzy" } | null => {
    // 1. 先查记忆
    const memory = findMatchMemory(description);
    if (memory) {
      const item = state.items.find((i) => i.id === memory.itemId);
      if (item) return { item, score: 1.0, source: "memory" };
    }
    // 2. 模糊匹配
    let best: { item: SpiritItem; score: number } | null = null;
    for (const item of state.items) {
      const score = Math.max(
        fuzzyMatchScore(description, item.name),
        fuzzyMatchScore(description, item.nameEn ?? ""),
      );
      if (!best || score > best.score) best = { item, score };
    }
    if (best && best.score >= 0.5) return { ...best, source: "fuzzy" };
    return null;
  };

  // ── 自采配置 ──────────────────────────────────────────────────────────────
  const updateSelfBuyConfig = (config: Partial<SelfBuyConfig>) => {
    dispatch({
      type: "UPDATE_SELF_BUY_CONFIG",
      config: { ...state.selfBuyConfig, ...config, updatedAt: new Date().toISOString() },
    });
  };

  // ── 查询 ──────────────────────────────────────────────────────────────────
  const getMonthPurchases = (month: string) =>
    state.purchases.filter((p) => p.month === month);

  const getSupplierMonthPurchases = (supplier: string, month: string) =>
    state.purchases.filter((p) => p.month === month && (p.supplier ?? "") === supplier);

  const getMonthLedger = (month: string) =>
    state.ledger.filter((e) => e.month === month);

  const getItemLedger = (itemId: string, month: string) =>
    state.ledger.find((e) => e.itemId === itemId && e.month === month);

  const getAvailableMonths = (): string[] => {
    const months = new Set<string>();
    state.purchases.forEach((p) => months.add(p.month));
    state.ledger.forEach((e) => months.add(e.month));
    months.add(getCurrentMonth());
    return [...months].sort().reverse();
  };

  /** 按分类汇总月度台账：数量用于库存管理，成本用于总结、占比与导出。 */
  const getPurchaseSummaryByCategory = (month: string): Record<string, SpiritCategorySummary> =>
    summarizeSpiritLedgerByCategory(state.items, getMonthLedger(month));

  /** 按供应商汇总进货数据 */
  const getPurchaseSummaryBySupplier = (month: string): Record<string, { qty: number; amount: number; items: number }> => {
    const result: Record<string, { qty: number; amount: number; items: number }> = {};
    const monthPurchases = getMonthPurchases(month);
    const itemIds = new Set<string>();
    for (const p of monthPurchases) {
      const sup = p.supplier ?? "未知供应商";
      if (!result[sup]) result[sup] = { qty: 0, amount: 0, items: 0 };
      result[sup].qty += p.quantity;
      result[sup].amount = sumMoney([result[sup].amount, p.amount]);
      const key = `${sup}:${p.itemId ?? p.rawName}`;
      if (!itemIds.has(key)) { result[sup].items++; itemIds.add(key); }
    }
    return result;
  };

  // ── 月结 ──────────────────────────────────────────────────────────────────
  const closeMonth = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    const nextMonth = m === 12
      ? `${y + 1}-01`
      : `${y}-${String(m + 1).padStart(2, "0")}`;
    const monthLedger = getMonthLedger(month);
    for (const entry of monthLedger) {
      const existing = getItemLedger(entry.itemId, nextMonth);
      if (!existing) {
        upsertLedger({
          month: nextMonth,
          itemId: entry.itemId,
          openingQty: entry.closingQty,
          openingUnitCost: entry.closingUnitCost,
          prevClosingQty: entry.closingQty,
          purchaseQty: 0,
          purchaseCost: 0,
          consumeQty: 0,
          consumeCost: 0,
          closingQty: entry.closingQty,
          closingUnitCost: entry.closingUnitCost,
          closingCost: entry.closingCost,
          isClosed: false,
        });
      }
    }
  };

  const syncLedgerFromPurchases = (
    month: string,
    pending: readonly PendingSpiritPurchase[] = [],
    purchaseSource: readonly SpiritPurchaseRecord[] = state.purchases,
  ) => {
    const monthPurchases = purchasesForMonth(purchaseSource, pending, month);
    const byItem: Record<string, Array<SpiritPurchaseRecord | PendingSpiritPurchase>> = {};
    monthPurchases.forEach((p) => {
      const key = p.itemId ?? `raw:${p.rawName}`;
      if (!byItem[key]) byItem[key] = [];
      byItem[key].push(p);
    });
    // 以既有台账行与本月采购行的并集作为重算范围；删除最后一笔采购后，
    // 原有台账也必须显式归零，不能因缺少 records 而残留旧金额。
    const itemIds = new Set([
      ...Object.keys(byItem).filter((key) => !key.startsWith("raw:")),
      ...getMonthLedger(month).map((entry) => entry.itemId),
    ]);
    itemIds.forEach((itemId) => {
      const records = byItem[itemId] ?? [];
      const purchaseQty = records.reduce((s, r) => s + r.quantity, 0);
      const purchaseCost = records.reduce((s, r) => s + r.amount, 0);
      const existing = getItemLedger(itemId, month);
      if (existing) {
        const closingQty = existing.openingQty + purchaseQty - existing.consumeQty;
        const closingUnitCost = closingQty > 0 ? (existing.openingQty * existing.openingUnitCost + purchaseCost) / (existing.openingQty + purchaseQty) : existing.openingUnitCost;
        upsertLedger({
          ...existing,
          purchaseQty,
          purchaseCost,
          closingQty,
          closingUnitCost,
          closingCost: closingQty * closingUnitCost,
        });
      } else {
        const refPrice = getRefPrice(itemId, month);
        upsertLedger({
          month,
          itemId,
          openingQty: 0,
          openingUnitCost: refPrice,
          purchaseQty,
          purchaseCost,
          consumeQty: 0,
          consumeCost: 0,
          closingQty: purchaseQty,
          closingUnitCost: purchaseQty > 0 ? purchaseCost / purchaseQty : refPrice,
          closingCost: purchaseCost,
          isClosed: false,
        });
      }
    });
  };

  // ★ 月末盘点：录入实际期末库存量，自动反推消耗量
  const setActualClosing = (itemId: string, month: string, actualQty: number) => {
    const existing = getItemLedger(itemId, month);
    if (!existing) return;
    const consumeQty = Math.max(0, existing.openingQty + existing.purchaseQty - actualQty);
    const closingUnitCost = actualQty > 0
      ? (existing.openingQty * existing.openingUnitCost + existing.purchaseCost) / (existing.openingQty + existing.purchaseQty)
      : existing.openingUnitCost;
    upsertLedger({
      ...existing,
      consumeQty,
      closingQty: actualQty,
      closingUnitCost,
      closingCost: actualQty * closingUnitCost,
    });
  };

  // ★ 批量月末盘点
  const batchSetActualClosing = (month: string, entries: { itemId: string; actualQty: number }[]) => {
    entries.forEach(({ itemId, actualQty }) => setActualClosing(itemId, month, actualQty));
  };

  // ★ 检查上月是否需要月结
  const checkPrevMonthClosed = (currentMonth: string): { needsClose: boolean; prevMonth: string } => {
    const [y, m] = currentMonth.split("-").map(Number);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const prevMonth = `${prevY}-${String(prevM).padStart(2, "0")}`;
    const prevLedger = getMonthLedger(prevMonth);
    if (prevLedger.length === 0) return { needsClose: false, prevMonth };
    const allClosed = prevLedger.every((e) => e.isClosed);
    return { needsClose: !allClosed, prevMonth };
  };

  const value: SpiritsContextValue = {
    ...state,
        addItem, updateItem, setItemAndPurchaseCategory, setItemsAndPurchasesCategory, deleteItem, addPurchase, updatePurchase, deletePurchase, batchAddPurchases, batchDeletePurchases,
    upsertLedger, deleteLedger,
    setRefPrice, getRefPrice,
    upsertSupplier, deleteSupplier, getSupplierByName,
    upsertGroup, deleteGroup, getItemGroup, detectPurchaseGroup, rememberGroupMatch,
    getAllCategories, upsertCustomCategory, moveCategory, removeCategorySafely, getCategoryColor,
    setMatchMemory, findMatchMemory, matchPettyToItem,
    updateSelfBuyConfig,
    getMonthPurchases, getSupplierMonthPurchases, getMonthLedger, getItemLedger,
    getAvailableMonths, getPurchaseSummaryByCategory, getPurchaseSummaryBySupplier,
    closeMonth, syncLedgerFromPurchases,
    setActualClosing, batchSetActualClosing, checkPrevMonthClosed,
  };

  return (
    <SpiritsContext.Provider value={value}>
      {children}
    </SpiritsContext.Provider>
  );
}

export function useSpiritsInventoryStore() {
  const ctx = useContext(SpiritsContext);
  if (!ctx) throw new Error("useSpiritsInventoryStore must be used within SpiritsInventoryProvider");
  return ctx;
}

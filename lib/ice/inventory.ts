/**
 * 冰块进销存扩展
 * 在现有 IceKind（成本设置）基础上，增加进货记录和库存追踪
 * 冰块全部自采（备用金 B1/B2/B3）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "ice.inventory.v1";

export interface IceInventoryItem {
  id: string;
  /** 关联的 IceKind ID（可选，未关联时为独立条目） */
  iceKindId?: string;
  /** 冰块名称，如「摇冰袋」「大冰球」「直条冰」 */
  name: string;
  /** 规格，如「10kg/袋」「1颗」 */
  spec: string;
  /** 库存单位：袋/颗/kg/箱 */
  unit: string;
  /** 当前库存 */
  currentStock: number;
  /** 预警线 */
  alertThreshold: number;
  /** 最新进货价（元/单位） */
  latestCostPrice: number;
  /** 供应商/采购渠道 */
  supplier: string;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IceInventoryTransaction {
  id: string;
  iceItemId: string;
  type: "in" | "out" | "adjust";
  /** 数量（正=入库，负=出库） */
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  date: string;
  /** 关联备用金记录 ID */
  pettyRecordId?: string;
  notes: string;
  createdAt: string;
}

export interface IceInventoryState {
  items: IceInventoryItem[];
  transactions: IceInventoryTransaction[];
}

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export async function loadIceInventory(): Promise<IceInventoryState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { items: [], transactions: [] };
}

export async function saveIceInventory(state: IceInventoryState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  notifySyncChange(STORAGE_KEY);
}

export function createIceItem(data: Omit<IceInventoryItem, "id" | "createdAt" | "updatedAt">): IceInventoryItem {
  const now = new Date().toISOString();
  return { ...data, id: uuid(), createdAt: now, updatedAt: now };
}

export function createIceTx(data: Omit<IceInventoryTransaction, "id" | "createdAt">): IceInventoryTransaction {
  return { ...data, id: uuid(), createdAt: new Date().toISOString() };
}

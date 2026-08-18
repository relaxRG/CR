import type { WineManualPurchase } from "./types";

export interface WineManualPurchaseState {
  purchases: WineManualPurchase[];
}

export type WineManualPurchaseAction =
  | { type: "LOAD"; payload: WineManualPurchaseState }
  | { type: "ADD"; purchase: WineManualPurchase }
  | { type: "UPDATE"; id: string; updates: Partial<WineManualPurchase> }
  | { type: "BATCH_UPDATE"; ids: string[]; updates: Partial<WineManualPurchase> }
  | { type: "BATCH_UPDATE_DATE"; ids: string[]; date: string }
  | { type: "DELETE"; id: string }
  | { type: "BATCH_DELETE"; ids: string[] }
  | { type: "BATCH_ADD"; purchases: WineManualPurchase[] }
  | { type: "CLEAR_MONTH"; month: string }
  | { type: "RESTORE_MONTH"; month: string; purchases: WineManualPurchase[] };

/**
 * 手动采购的唯一状态机。所有批量编辑在同一个 reducer 中完成，
 * 避免数量、单价与总价分散更新而造成金额不同步。
 */
export function wineManualPurchaseReducer(
  state: WineManualPurchaseState,
  action: WineManualPurchaseAction,
): WineManualPurchaseState {
  switch (action.type) {
    case "LOAD":
      return action.payload;
    case "ADD":
      return { purchases: [action.purchase, ...state.purchases] };
    case "UPDATE":
      return {
        purchases: state.purchases.map((purchase) =>
          purchase.id === action.id ? { ...purchase, ...action.updates } : purchase,
        ),
      };
    case "BATCH_UPDATE":
      return {
        purchases: state.purchases.map((purchase) => {
          if (!action.ids.includes(purchase.id)) return purchase;
          const next = { ...purchase, ...action.updates };
          if (action.updates.quantity !== undefined || action.updates.unitPrice !== undefined) {
            next.amount = next.quantity * next.unitPrice;
          }
          return next;
        }),
      };
    case "BATCH_UPDATE_DATE":
      return {
        purchases: state.purchases.map((purchase) =>
          action.ids.includes(purchase.id) ? { ...purchase, date: action.date } : purchase,
        ),
      };
    case "DELETE":
      return { purchases: state.purchases.filter((purchase) => purchase.id !== action.id) };
    case "BATCH_DELETE":
      return { purchases: state.purchases.filter((purchase) => !action.ids.includes(purchase.id)) };
    case "BATCH_ADD":
      return { purchases: [...action.purchases, ...state.purchases] };
    case "CLEAR_MONTH":
      return { purchases: state.purchases.filter((purchase) => !purchase.date.startsWith(action.month)) };
    case "RESTORE_MONTH":
      return {
        purchases: [
          ...action.purchases,
          ...state.purchases.filter((purchase) => !purchase.date.startsWith(action.month)),
        ],
      };
    default:
      return state;
  }
}

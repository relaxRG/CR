import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { sumMoney } from "@/lib/finance/money";

const STORAGE_KEY = "store.petty.v1";

/** 备用金分类代码（A1-N5） */
export type PettyCode =
  | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A9" | "A10"
  | "B1" | "B2" | "B3"
  | "C1" | "C2" | "C3" | "C4" | "C5" | "C6"
  | "D1" | "D2" | "D3"
  | "E1" | "E2" | "E3"
  | "F1" | "F2" | "F3" | "F4" | "F5" | "F6"
  | "G1" | "G2" | "G3" | "G4" | "G5" | "G6"
  | "H1" | "H2" | "H3"
  | "I1" | "I2" | "I3"
  | "J1" | "J2" | "J3"
  | "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8" | "K9"
  | "L1" | "L2"
  | "M1" | "M2"
  | "N0" | "N1" | "N2" | "N3" | "N4" | "N5";

export const PETTY_CODE_LABELS: Record<PettyCode, string> = {
  A1: "A1 新鲜肉类", A2: "A2 新鲜海鲜", A3: "A3 各种冻品",
  A4: "A4 米面粮油", A5: "A5 蔬菜水果", A6: "A6 牛排",
  A7: "A7 火腿", A8: "A8 三文鱼", A9: "A9 临时采购", A10: "A10 研发采购",
  B1: "B1 酒水现结", B2: "B2 酒水配料", B3: "B3 酒水耗材",
  C1: "C1 厨房设备", C2: "C2 厨房工具", C3: "C3 吧台设备",
  C4: "C4 吧台工具", C5: "C5 前厅硬装", C6: "C6 前厅软装",
  D1: "D1 员工聚餐", D2: "D2 员工工餐", D3: "D3 员工福利",
  E1: "E1 设计创意", E2: "E2 图文广告", E3: "E3 节日采购",
  F1: "F1 餐具", F2: "F2 酒杯", F3: "F3 餐具一次性",
  F4: "F4 酒杯一次性", F5: "F5 包装袋", F6: "F6 杯垫",
  G1: "G1 点星", G2: "G2 大众点评美团", G3: "G3 小红书",
  G4: "G4 抖音", G5: "G5 美团外卖", G6: "G6 饿了么",
  H1: "H1 餐食探店", H2: "H2 酒水探店", H3: "H3 差旅费用",
  I1: "I1 闪送、跑腿", I2: "I2 交通、运输", I3: "I3 快递",
  J1: "J1 客户维护", J2: "J2 处理客诉", J3: "J3 会员福利",
  K1: "K1 固定兼职", K2: "K2 日常消耗", K3: "K3 洗手间消耗",
  K4: "K4 维护维修", K5: "K5 消杀工作", K6: "K6 电话网费",
  K7: "K7 账号费用", K8: "K8 其他", K9: "K9 临时兼职",
  L1: "L1 上月电费", L2: "L2 上月水费",
  M1: "M1 247房租", M2: "M2 仓库房租",
  N0: "N0 （招商）备用金", N1: "N1 （工商）备用金",
  N2: "N2 （微信）备用金", N3: "N3 返点",
  N4: "N4 充电宝", N5: "N5 其他",
};

/** 备用金分组 */
export const PETTY_GROUPS: { label: string; codes: PettyCode[] }[] = [
  { label: "A 食材采购", codes: ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"] },
  { label: "B 酒水耗材", codes: ["B1","B2","B3"] },
  { label: "C 设备工具", codes: ["C1","C2","C3","C4","C5","C6"] },
  { label: "D 员工福利", codes: ["D1","D2","D3"] },
  { label: "E 营销推广", codes: ["E1","E2","E3"] },
  { label: "F 餐具酒具", codes: ["F1","F2","F3","F4","F5","F6"] },
  { label: "G 平台推广", codes: ["G1","G2","G3","G4","G5","G6"] },
  { label: "H 探店差旅", codes: ["H1","H2","H3"] },
  { label: "I 物流运输", codes: ["I1","I2","I3"] },
  { label: "J 客户维护", codes: ["J1","J2","J3"] },
  { label: "K 日常运营", codes: ["K1","K2","K3","K4","K5","K6","K7","K8","K9"] },
  { label: "L 水电费", codes: ["L1","L2"] },
  { label: "M 房租", codes: ["M1","M2"] },
  { label: "N 备用金账户", codes: ["N0","N1","N2","N3","N4","N5"] },
];

export interface PettyRecord {
  id: string;
  date: string;          // YYYY-MM-DD
  code: PettyCode;
  amount: number;        // 元
  description: string;
  paymentMethod: string; // 现金/微信/支付宝/银行卡
  receiptUri: string;
  createdAt: string;
}

/** 每月账期：存储期初备用金（手动覆盖值）*/
export interface PettyPeriod {
  month: string;           // YYYY-MM
  openingBalance: number;  // 期初备用金，-1 表示未手动设置（自动使用上月期末）
  note: string;
}

/** 月度账期汇总 */
export interface PeriodSummary {
  month: string;
  openingBalance: number;    // 期初
  inflow: number;            // 备用金转入 N0+N1+N2
  otherIncome: number;       // 其他收入 N3+N4+N5
  expense: number;           // 本期支出 A1-M2
  closingBalance: number;    // 期末 = 期初 + 转入 + 其他收入 - 支出
  groupExpenses: Record<string, number>; // 各大类支出（A/B/C…）
  openingOverridden: boolean;  // 是否手动覆盖了期初
  openingAutoValue: number;    // 自动计算的期初（上月期末）
}

export interface PettyState { records: PettyRecord[]; periods: PettyPeriod[] }

type Action =
  | { type: "LOAD"; payload: PettyState }
  | { type: "ADD"; record: PettyRecord }
  | { type: "UPDATE"; id: string; updates: Partial<PettyRecord> }
  | { type: "DELETE"; id: string }
  | { type: "SET_PERIOD"; period: PettyPeriod };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: PettyState, action: Action): PettyState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { ...state, records: [action.record, ...state.records] };
    case "UPDATE": return { ...state, records: state.records.map((r) => r.id === action.id ? { ...r, ...action.updates } : r) };
    case "DELETE": return { ...state, records: state.records.filter((r) => r.id !== action.id) };
    case "SET_PERIOD": {
      const idx = state.periods.findIndex((p) => p.month === action.period.month);
      const periods = idx >= 0
        ? state.periods.map((p, i) => i === idx ? action.period : p)
        : [...state.periods, action.period];
      return { ...state, periods };
    }
    default: return state;
  }
}

interface PettyContextValue extends PettyState {
  addRecord: (data: Omit<PettyRecord, "id" | "createdAt">) => void;
  updateRecord: (id: string, updates: Partial<PettyRecord>) => void;
  deleteRecord: (id: string) => void;
  setPeriod: (period: PettyPeriod) => void;
  calcPeriod: (month: string) => PeriodSummary;
  /** 计算某月的期末（供下月自动带入）*/
  calcClosing: (month: string, allRecords: PettyRecord[], allPeriods: PettyPeriod[]) => number;
}

const PettyContext = createContext<PettyContextValue | null>(null);

/** 纯函数：计算某月期末备用金（可递归） */
export function calcClosingPure(
  month: string,
  allRecords: PettyRecord[],
  allPeriods: PettyPeriod[],
  depth = 0
): number {
  if (depth > 24) return 0; // 防止无限递归
  const monthRecords = allRecords.filter((r) => r.date.startsWith(month));
  const inflow = sumMoney(monthRecords.filter((record) => ["N0", "N1", "N2"].includes(record.code)).map((record) => record.amount));
  const otherIncome = sumMoney(monthRecords.filter((record) => ["N3", "N4", "N5"].includes(record.code)).map((record) => record.amount));
  const expense = sumMoney(monthRecords.filter((record) => !["N0", "N1", "N2", "N3", "N4", "N5"].includes(record.code)).map((record) => record.amount));
  const periodData = allPeriods.find((p) => p.month === month);
  let opening: number;
  if (periodData && periodData.openingBalance >= 0) {
    opening = periodData.openingBalance;
  } else {
    // 自动：上月期末
    const [y, m] = month.split("-").map(Number);
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    opening = calcClosingPure(prevMonth, allRecords, allPeriods, depth + 1);
  }
  return sumMoney([opening, inflow, otherIncome, -expense]);
}

export function PettyCashProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { records: [], periods: [] });

  useEffect(() => {
    const load = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<PettyState>;
        if (!parsed.periods) parsed.periods = [];
        dispatch({ type: "LOAD", payload: parsed as PettyState });
      } catch {}
    };
    AsyncStorage.getItem(STORAGE_KEY).then(load);
    registerStoreReload(() => AsyncStorage.getItem(STORAGE_KEY).then(load));
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const addRecord = useCallback((data: Omit<PettyRecord, "id" | "createdAt">) => {
    dispatch({ type: "ADD", record: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);
  const updateRecord = useCallback((id: string, updates: Partial<PettyRecord>) => dispatch({ type: "UPDATE", id, updates }), []);
  const deleteRecord = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const setPeriod = useCallback((period: PettyPeriod) => dispatch({ type: "SET_PERIOD", period }), []);

  const calcClosing = useCallback((month: string, allRecords: PettyRecord[], allPeriods: PettyPeriod[]) => {
    return calcClosingPure(month, allRecords, allPeriods);
  }, []);

  const calcPeriod = useCallback((month: string): PeriodSummary => {
    const monthRecords = state.records.filter((r) => r.date.startsWith(month));
    const groupExpenses: Record<string, number> = {};
    const inflow = sumMoney(monthRecords.filter((record) => ["N0", "N1", "N2"].includes(record.code)).map((record) => record.amount));
    const otherIncome = sumMoney(monthRecords.filter((record) => ["N3", "N4", "N5"].includes(record.code)).map((record) => record.amount));
    const expenseRecords = monthRecords.filter((record) => !["N0", "N1", "N2", "N3", "N4", "N5"].includes(record.code));
    const expense = sumMoney(expenseRecords.map((record) => record.amount));
    for (const record of expenseRecords) {
      const group = record.code[0];
      groupExpenses[group] = sumMoney([groupExpenses[group], record.amount]);
    }
    // 自动期初 = 上月期末
    const [y, m] = month.split("-").map(Number);
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const openingAutoValue = calcClosingPure(prevMonth, state.records, state.periods);
    const periodData = state.periods.find((p) => p.month === month);
    const openingOverridden = !!(periodData && periodData.openingBalance >= 0);
    const openingBalance = openingOverridden ? periodData!.openingBalance : openingAutoValue;
    return {
      month,
      openingBalance,
      inflow,
      otherIncome,
      expense,
      closingBalance: sumMoney([openingBalance, inflow, otherIncome, -expense]),
      groupExpenses,
      openingOverridden,
      openingAutoValue,
    };
  }, [state]);

  return (
    <PettyContext.Provider value={{ ...state, addRecord, updateRecord, deleteRecord, setPeriod, calcPeriod, calcClosing }}>
      {children}
    </PettyContext.Provider>
  );
}

export function usePettyCashStore(): PettyContextValue {
  const ctx = useContext(PettyContext);
  if (!ctx) throw new Error("usePettyCashStore must be used within PettyCashProvider");
  return ctx;
}

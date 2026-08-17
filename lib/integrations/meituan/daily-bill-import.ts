import { normalizeMeituanMonth, type MeituanStoreScope } from "./monthly-import";

export interface MeituanBillSku {
  app_spu_code?: string;
  sku_id?: string;
  name?: string;
  count?: number | string;
  totalOriginPrice?: number | string;
  totalActivityPrice?: number | string;
  totalReducePrice?: number | string;
}

/** 美团官方 bill/list/yuan 的最小安全映射，不依赖网页后台私有字段。 */
export interface MeituanOfficialDailyBillRow {
  wmOrderViewId: string;
  daliyBillDate: string | number;
  wmPoiName?: string;
  appPoiCode: string;
  orderState?: number;
  settleAmount: number | string;
  totalFoodAmount: number | string;
  activityPoiAmount?: number | string;
  activityMeituanAmount?: number | string;
  platformChargeFee?: number | string;
  userOnlinePayAmount?: number | string;
  userOfflinePayAmount?: number | string;
  refundTime?: string | null;
  wmAppOrderSkuBenefitDetailList?: MeituanBillSku[];
}

export interface MeituanBillImportIssue {
  code: "STORE_MISMATCH" | "MONTH_MISMATCH" | "DUPLICATE_CONFLICT" | "REFUND_CONFLICT" | "RECONCILIATION_GAP" | "MISSING_ORDER_ID";
  message: string;
  orderId?: string;
}

export interface NormalizedMeituanBill {
  source: "meituan-openapi";
  sourceKey: string;
  storeId: string;
  month: string;
  businessDate: string;
  orderId: string;
  grossFoodAmount: number;
  merchantDiscount: number;
  platformDiscount: number;
  platformFee: number;
  onlinePaid: number;
  offlinePaid: number;
  settlementAmount: number;
  skuLines: Array<{
    externalSkuId: string;
    externalSpuCode: string;
    name: string;
    quantity: number;
    grossAmount: number;
    netAmount: number;
    discountAmount: number;
  }>;
}

export interface MeituanDailyBillPreview {
  source: "meituan-openapi";
  store: MeituanStoreScope;
  month: string;
  bills: NormalizedMeituanBill[];
  totals: {
    grossFoodAmount: number;
    merchantDiscount: number;
    platformDiscount: number;
    platformFee: number;
    settlementAmount: number;
  };
  issues: MeituanBillImportIssue[];
  isValid: boolean;
}

const TOLERANCE = 0.01;

function number(value: number | string | null | undefined): number {
  const parsed = Number(String(value ?? 0).replace(/[￥¥,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function positive(value: number | string | null | undefined): number {
  return Math.abs(number(value));
}

function parseBillDate(raw: string | number): { date: string; month: string } | null {
  if (typeof raw === "number" && raw > 1_000_000_000) {
    const date = new Date(raw * 1000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const month = normalizeMeituanMonth(date);
    return month ? { date, month } : null;
  }
  const value = String(raw ?? "").trim();
  const match = value.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const month = normalizeMeituanMonth(date);
  return month ? { date, month } : null;
}

/**
 * 日账单仅产生待确认快照，不直接计入总月报。跨门店、跨月、退款冲突或外部单号冲突均阻断确认。
 */
export function buildMeituanDailyBillPreview(input: {
  store: MeituanStoreScope;
  month: string;
  bills: MeituanOfficialDailyBillRow[];
  existingSourceKeys?: Map<string, string>;
}): MeituanDailyBillPreview {
  const expectedMonth = normalizeMeituanMonth(input.month);
  if (!expectedMonth) throw new Error("日账单导入缺少有效业务月份（YYYY-MM）");
  const expectedStoreId = String(input.store.storeId ?? "").trim();
  if (!expectedStoreId) throw new Error("日账单导入必须指定门店 ID，禁止按门店名称匹配");

  const issues: MeituanBillImportIssue[] = [];
  const seen = new Map<string, string>();
  const normalized: NormalizedMeituanBill[] = [];

  for (const raw of input.bills) {
    const orderId = String(raw.wmOrderViewId ?? "").trim();
    if (!orderId) {
      issues.push({ code: "MISSING_ORDER_ID", message: "账单缺少 wmOrderViewId，无法建立幂等键" });
      continue;
    }
    if (String(raw.appPoiCode ?? "").trim() !== expectedStoreId) {
      issues.push({ code: "STORE_MISMATCH", orderId, message: `订单 ${orderId} 的 appPoiCode 与目标门店不一致` });
      continue;
    }
    const parsedDate = parseBillDate(raw.daliyBillDate);
    if (!parsedDate || parsedDate.month !== expectedMonth) {
      issues.push({ code: "MONTH_MISMATCH", orderId, message: `订单 ${orderId} 的账单日不属于 ${expectedMonth}` });
      continue;
    }
    if (raw.refundTime) {
      issues.push({ code: "REFUND_CONFLICT", orderId, message: `订单 ${orderId} 包含退款时间，须以退款状态或退款接口复核后再导入` });
      continue;
    }

    const sourceKey = `meituan-openapi:${expectedStoreId}:${orderId}`;
    const fingerprint = JSON.stringify([
      raw.settleAmount, raw.totalFoodAmount, raw.activityPoiAmount, raw.activityMeituanAmount,
      raw.platformChargeFee, raw.userOnlinePayAmount, raw.userOfflinePayAmount,
    ]);
    const existingFingerprint = input.existingSourceKeys?.get(sourceKey) ?? seen.get(sourceKey);
    if (existingFingerprint && existingFingerprint !== fingerprint) {
      issues.push({ code: "DUPLICATE_CONFLICT", orderId, message: `订单 ${orderId} 已存在但金额字段不同，禁止覆盖旧快照` });
      continue;
    }
    seen.set(sourceKey, fingerprint);

    const skuLines = (raw.wmAppOrderSkuBenefitDetailList ?? []).map((sku) => {
      const grossAmount = positive(sku.totalOriginPrice);
      const netAmount = positive(sku.totalActivityPrice);
      const discountAmount = positive(sku.totalReducePrice) || Math.max(0, grossAmount - netAmount);
      return {
        externalSkuId: String(sku.sku_id ?? ""),
        externalSpuCode: String(sku.app_spu_code ?? ""),
        name: String(sku.name ?? "未命名菜品").trim() || "未命名菜品",
        quantity: number(sku.count),
        grossAmount,
        netAmount,
        discountAmount,
      };
    });
    const grossFoodAmount = positive(raw.totalFoodAmount);
    const merchantDiscount = positive(raw.activityPoiAmount);
    const platformDiscount = positive(raw.activityMeituanAmount);
    const platformFee = positive(raw.platformChargeFee);
    const settlementAmount = number(raw.settleAmount);
    const onlinePaid = positive(raw.userOnlinePayAmount);
    const offlinePaid = positive(raw.userOfflinePayAmount);

    // 菜品列表不必等于订单总额（包装费、配送费等可能存在），但若菜品净额超出菜品总额则为映射错误。
    const skuNet = skuLines.reduce((sum, sku) => sum + sku.netAmount, 0);
    if (skuNet > grossFoodAmount + TOLERANCE) {
      issues.push({ code: "RECONCILIATION_GAP", orderId, message: `订单 ${orderId} 的 SKU 净额 ¥${skuNet.toFixed(2)} 超过菜品金额 ¥${grossFoodAmount.toFixed(2)}` });
      continue;
    }

    normalized.push({
      source: "meituan-openapi",
      sourceKey,
      storeId: expectedStoreId,
      month: expectedMonth,
      businessDate: parsedDate.date,
      orderId,
      grossFoodAmount,
      merchantDiscount,
      platformDiscount,
      platformFee,
      onlinePaid,
      offlinePaid,
      settlementAmount,
      skuLines,
    });
  }

  const totals = normalized.reduce((acc, bill) => ({
    grossFoodAmount: acc.grossFoodAmount + bill.grossFoodAmount,
    merchantDiscount: acc.merchantDiscount + bill.merchantDiscount,
    platformDiscount: acc.platformDiscount + bill.platformDiscount,
    platformFee: acc.platformFee + bill.platformFee,
    settlementAmount: acc.settlementAmount + bill.settlementAmount,
  }), { grossFoodAmount: 0, merchantDiscount: 0, platformDiscount: 0, platformFee: 0, settlementAmount: 0 });

  return {
    source: "meituan-openapi",
    store: { ...input.store, storeId: expectedStoreId, timeZone: "Asia/Shanghai" },
    month: expectedMonth,
    bills: normalized,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 100) / 100])) as MeituanDailyBillPreview["totals"],
    issues,
    isValid: issues.length === 0,
  };
}

import type { DishCategory, MonthlyKPI } from "@/lib/store/monthly-report/types";

export interface MeituanStoreScope {
  storeId: string;
  storeName: string;
  timeZone?: "Asia/Shanghai";
}

export interface MeituanMonthlyRevenueRow {
  storeId: string;
  month: string;
  revenue: number | string;
  turnover?: number | string;
  discountAmount?: number | string;
  orderCount?: number | string;
}

export interface MeituanDishCategoryRow {
  storeId: string;
  month: string;
  categoryName: string;
  salesQty?: number | string;
  salesAmount?: number | string;
  revenue: number | string;
  discountAmount?: number | string;
  sourceRow?: number;
}

export interface MeituanImportIssue {
  code: "STORE_MISMATCH" | "MONTH_MISMATCH" | "EMPTY_CATEGORY" | "REVENUE_GAP";
  message: string;
  sourceRow?: number;
}

export interface MeituanMonthlyImportPreview {
  source: "meituan-guanJia";
  store: MeituanStoreScope;
  month: string;
  kpi: Pick<MonthlyKPI, "revenue" | "turnover" | "discountAmount" | "discountRate" | "orderCount">;
  dishCategories: DishCategory[];
  categoryRevenue: number;
  unclassifiedRevenue: number;
  isBalanced: boolean;
  issues: MeituanImportIssue[];
  importKey: string;
}

const EPSILON = 0.01;

export function normalizeMeituanMonth(raw: string): string | null {
  const value = String(raw ?? "").trim().replaceAll("/", "-");
  const match = value.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/) ?? value.match(/^(\d{4})年(\d{1,2})月$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 合并 Food / food / 全角空格等同名菜品大类；不把“Food · 套餐”与 Food 合并。 */
export function canonicalizeMeituanCategoryName(raw: string): { key: string; label: string } | null {
  const label = String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[・]/g, "·")
    .replace(/\s+/g, " ")
    .replace(/\s*([·/+()&-])\s*/g, "$1")
    .trim();
  if (!label || label === "合计") return null;
  return { key: label.toLocaleLowerCase("en-US"), label };
}

function money(value: number | string | undefined): number {
  const normalized = typeof value === "string" ? value.replace(/[￥¥,\s]/g, "") : value;
  const parsed = Number(normalized ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function canonicalStoreId(value: string): string {
  return String(value ?? "").trim();
}

function issue(code: MeituanImportIssue["code"], message: string, sourceRow?: number): MeituanImportIssue {
  return { code, message, sourceRow };
}

/**
 * 仅生成待确认预览；不写入任何本地 Store。
 * 写入层必须以 importKey（source + storeId + month）做幂等键，并在用户确认后提交。
 */
export function buildMeituanMonthlyImportPreview(input: {
  store: MeituanStoreScope;
  month: string;
  revenueRows: MeituanMonthlyRevenueRow[];
  dishCategoryRows: MeituanDishCategoryRow[];
}): MeituanMonthlyImportPreview {
  const month = normalizeMeituanMonth(input.month);
  if (!month) throw new Error("美团月度导入缺少有效业务月份（YYYY-MM）");
  const storeId = canonicalStoreId(input.store.storeId);
  if (!storeId) throw new Error("美团月度导入缺少门店 ID，禁止按门店名称猜测归属");

  const issues: MeituanImportIssue[] = [];
  const inScopeRevenue = input.revenueRows.filter((row) => {
    if (canonicalStoreId(row.storeId) !== storeId) {
      issues.push(issue("STORE_MISMATCH", `收入行门店 ${row.storeId} 与导入目标 ${storeId} 不一致`));
      return false;
    }
    if (normalizeMeituanMonth(row.month) !== month) {
      issues.push(issue("MONTH_MISMATCH", `收入行月份 ${row.month} 不属于 ${month}`));
      return false;
    }
    return true;
  });

  const totals = inScopeRevenue.reduce((acc, row) => ({
    revenue: acc.revenue + money(row.revenue),
    turnover: acc.turnover + money(row.turnover),
    discountAmount: acc.discountAmount + Math.abs(money(row.discountAmount)),
    orderCount: acc.orderCount + money(row.orderCount),
  }), { revenue: 0, turnover: 0, discountAmount: 0, orderCount: 0 });

  const categoryMap = new Map<string, DishCategory>();
  for (const row of input.dishCategoryRows) {
    if (canonicalStoreId(row.storeId) !== storeId) {
      issues.push(issue("STORE_MISMATCH", `菜品大类“${row.categoryName}”属于门店 ${row.storeId}，不能导入 ${storeId}`, row.sourceRow));
      continue;
    }
    if (normalizeMeituanMonth(row.month) !== month) {
      issues.push(issue("MONTH_MISMATCH", `菜品大类“${row.categoryName}”月份 ${row.month} 不属于 ${month}`, row.sourceRow));
      continue;
    }
    const category = canonicalizeMeituanCategoryName(row.categoryName);
    if (!category) {
      issues.push(issue("EMPTY_CATEGORY", "菜品大类为空或为合计行，已拒绝写入", row.sourceRow));
      continue;
    }
    const current = categoryMap.get(category.key);
    const next = {
      salesQty: money(row.salesQty),
      salesAmount: money(row.salesAmount),
      revenue: money(row.revenue),
      discountAmount: Math.abs(money(row.discountAmount)),
    };
    if (current) {
      current.salesQty += next.salesQty;
      current.salesAmount += next.salesAmount;
      current.revenue += next.revenue;
      current.discountAmount += next.discountAmount;
    } else {
      categoryMap.set(category.key, {
        name: category.label,
        salesQty: next.salesQty,
        salesQtyPct: 0,
        salesAmount: next.salesAmount,
        salesAmountPct: 0,
        revenue: next.revenue,
        revenuePct: 0,
        discountAmount: next.discountAmount,
        discountPct: 0,
      });
    }
  }

  const dishCategories = Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "zh-CN"));
  const categoryRevenue = dishCategories.reduce((sum, category) => sum + category.revenue, 0);
  const categorySales = dishCategories.reduce((sum, category) => sum + category.salesAmount, 0);
  const categoryDiscount = dishCategories.reduce((sum, category) => sum + category.discountAmount, 0);
  dishCategories.forEach((category) => {
    category.salesAmountPct = categorySales > 0 ? category.salesAmount / categorySales : 0;
    category.revenuePct = categoryRevenue > 0 ? category.revenue / categoryRevenue : 0;
    category.discountPct = categoryDiscount > 0 ? category.discountAmount / categoryDiscount : 0;
  });

  const unclassifiedRevenue = Math.round((totals.revenue - categoryRevenue) * 100) / 100;
  const isBalanced = Math.abs(unclassifiedRevenue) <= EPSILON;
  if (!isBalanced) {
    issues.push(issue("REVENUE_GAP", `月度营业收入 ¥${totals.revenue.toFixed(2)} 与菜品大类 ¥${categoryRevenue.toFixed(2)} 相差 ¥${unclassifiedRevenue.toFixed(2)}；需作为未分类差额确认，禁止静默平账。`));
  }

  return {
    source: "meituan-guanJia",
    store: { ...input.store, storeId, timeZone: "Asia/Shanghai" },
    month,
    kpi: {
      revenue: totals.revenue,
      turnover: totals.turnover,
      discountAmount: totals.discountAmount,
      discountRate: totals.turnover > 0 ? totals.discountAmount / totals.turnover : 0,
      orderCount: totals.orderCount,
    },
    dishCategories,
    categoryRevenue,
    unclassifiedRevenue,
    isBalanced,
    issues,
    importKey: `meituan-guanJia:${storeId}:${month}`,
  };
}

/**
 * 月度总报表聚合引擎 (Build 134)
 *
 * 核心原则：
 *   - 所有分类路由完全由 PettyCodeConfig / InventoryReportConfig 决定
 *   - 无任何硬编码的分类判断（不再有 if code === "A1" 这样的逻辑）
 *   - 用户可以随时修改任意备用金分类的归属，下次汇总时自动生效
 *   - 金额为0的行依然生成（showInReport=true 的分类始终显示）
 *
 * 分类路由规则（按优先级）：
 *   1. PettyCodeConfig.reportCategory != null → 使用指定科目分类
 *   2. PettyCodeConfig.isLabor = true + showInReport = true → 归入 labor
 *   3. PettyCodeConfig.inventoryModule != null + InventoryReportConfig.showInReport = true → 归入库存对应科目
 *   4. PettyCodeConfig.showInReport = false → 归入 petty_other 汇总
 *   5. 无配置的分类 → 归入 petty_other 汇总
 */
import {
  SummaryLineItem, MonthlySummaryReport,
  PettyCodeConfig, InventoryReportConfig, AccountCategory,
  DEFAULT_PETTY_CODE_CONFIGS, DEFAULT_INVENTORY_CONFIGS,
  calcPettyExcludedCodes,
} from "./types";
import type { PettyRecord } from "../../store/petty-store";
import { PETTY_CODE_LABELS } from "../../store/petty-store";
import type { MonthlyReport } from "../../store/monthly-report/types";
import type { PaySlip } from "../../labor/types";
import type { SupplierPurchaseRecord } from "../../food/types";
import { sumMoney } from "@/lib/finance/money";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function makeItem(overrides: Partial<SummaryLineItem> & Pick<SummaryLineItem, "code" | "label" | "category" | "amount" | "source">): SummaryLineItem {
  return {
    id: uuid(),
    isPaid: false,
    paymentNote: "",
    isDuplicate: false,
    duplicateNote: "",
    isManual: false,
    notes: "",
    ...overrides,
  };
}

/** 烈酒进货按供应商汇总 */
export interface SpiritPurchaseSupplierSummary {
  supplier: string;
  totalAmount: number;
  itemCount: number;
  isPaid?: boolean;
}

export interface AggregatorInput {
  month: string;
  /** 月度经营分析报告（收款渠道/菜品大类数据） */
  monthlyReport?: MonthlyReport;
  /** 备用金原始记录（用于逐分类提取） */
  pettyRecords?: PettyRecord[];
  /** 薪资单列表 */
  paySlips?: PaySlip[];
  /** 手动录入项（房租/外卖/活动收入等） */
  manualItems?: SummaryLineItem[];
  /** 烈酒当月进货汇总（按供应商分组）——来自烈酒库存管理 */
  spiritPurchaseSummary?: SpiritPurchaseSupplierSummary[];
  /** 所有烈酒供应商名称（用于生成金额为0的行）*/
  allSpiritSupplierNames?: string[];
  /** 食材当月进货记录——来自供应商采购管理 */
  foodPurchaseRecords?: SupplierPurchaseRecord[];
  /** 葡萄酒当月进货快照供应商汇总——来自葡萄酒库存管理 */
  wineSnapshotSupplierTotals?: Record<string, number>;
  /** 葡萄酒当月手动进货记录 */
  wineManualPurchases?: { supplier: string; amount: number; productName: string }[];
  /** 所有葡萄酒供应商名称（用于生成金额为0的行）*/
  allWineSupplierNames?: string[];
  /** 所有食材供应商名称（用于生成金额为0的行）*/
  allFoodSupplierNames?: string[];
  /** 员工列表（用于生成金额为0的薪资行）*/
  allEmployees?: { id: string; realName: string; code: string }[];
  /**
   * 备用金分类配置（来自 useMonthlySummaryStore().pettyCodeConfigs）
   * 不传则使用默认配置
   */
  pettyCodeConfigs?: PettyCodeConfig[];
  /**
   * 库存模块月报配置（来自 useMonthlySummaryStore().inventoryConfigs）
   * 不传则使用默认配置
   */
  inventoryConfigs?: InventoryReportConfig[];
  /**
   * 已被纳入薪资预支的备用金记录 ID 列表
   * 这些记录将从备用金消耗总额中排除，单独列入「人工」类别
   */
  laborLinkedPettyIds?: Set<string>;
  /**
   * 已被纳入薪资预支的备用金人工总金额（用于单独展示）
   */
  laborLinkedTotal?: number;
}

// ─── 辅助：获取备用金分类配置 ────────────────────────────────────────────────
function getPettyCfg(code: string, configs: PettyCodeConfig[]): PettyCodeConfig | undefined {
  return configs.find((c) => c.code === code)
    ?? DEFAULT_PETTY_CODE_CONFIGS.find((c) => c.code === code);
}

function getInventoryCfg(module: string, configs: InventoryReportConfig[]): InventoryReportConfig | undefined {
  return configs.find((c) => c.module === module)
    ?? DEFAULT_INVENTORY_CONFIGS.find((c) => c.module === module);
}

/**
 * 根据备用金分类配置决定该分类应归入哪个月报科目
 * 返回 null 表示归入 petty_other 汇总
 */
function resolvePettyCategory(
  code: string,
  pettyCfgs: PettyCodeConfig[],
  inventoryCfgs: InventoryReportConfig[],
): AccountCategory | null {
  const cfg = getPettyCfg(code, pettyCfgs);
  if (!cfg) return null; // 无配置 → 归入汇总

  // 优先：明确指定了 reportCategory
  if (cfg.reportCategory) return cfg.reportCategory;

  // 人工
  if (cfg.isLabor && cfg.showInReport) return "labor";

  // 库存模块
  if (cfg.inventoryModule && cfg.showInReport) {
    const invCfg = getInventoryCfg(cfg.inventoryModule, inventoryCfgs);
    if (invCfg?.showInReport) return invCfg.reportCategory;
  }

  // 不单独显示 → 归入汇总
  if (!cfg.showInReport) return null;

  return null;
}

export function aggregateMonthlyReport(input: AggregatorInput): Partial<MonthlySummaryReport> {
  const items: SummaryLineItem[] = [];
  const pettyCfgs = input.pettyCodeConfigs ?? [...DEFAULT_PETTY_CODE_CONFIGS];
  const inventoryCfgs = input.inventoryConfigs ?? [...DEFAULT_INVENTORY_CONFIGS];

  // 动态计算应排除的备用金分类（单独显示的分类从汇总中排除）
  const excludedFromOther = new Set(calcPettyExcludedCodes(pettyCfgs));

  // ── 1. 营业收入：菜品大类是总月报唯一主展示，手续费独立列示 ────────────────
  if (input.monthlyReport) {
    const mr = input.monthlyReport;
    const dishCategories = (mr.dishCategories ?? []).filter((cat) => cat.revenue !== 0);

    if (dishCategories.length > 0) {
      for (const cat of dishCategories) {
        items.push(makeItem({
          code: `revenue_dish_${cat.name}`,
          label: cat.name,
          category: "revenue",
          amount: cat.revenue,
          source: "monthly_report",
          revenueKind: "dish_category",
          linkedModule: "monthly-report",
          isPaid: true,
          paymentNote: "已收",
        }));
      }
    } else {
      // 缺少菜品大类文件时，账户正向流水只作为不中断利润计算的透明降级项；
      // 一旦导入菜品大类，下面这条路径不再产生任何收入行。
      for (const pm of mr.paymentMethods ?? []) {
        if (pm.amount <= 0) continue;
        items.push(makeItem({
          code: `revenue_unmatched_${pm.name.replace(/\s/g, "_").slice(0, 20)}`,
          label: `未匹配菜品大类 · ${pm.name}`,
          category: "revenue",
          amount: pm.amount,
          source: "monthly_report",
          revenueKind: "uncategorized",
          linkedModule: "monthly-report",
          isPaid: true,
          paymentNote: "账户校验收入",
          notes: "请导入同月菜品大类报表以替换账户校验收入",
        }));
      }
    }

    // 所有收款渠道负数统一为手续费；收款渠道正数只留在账户页对账。
    for (const pm of mr.paymentMethods ?? []) {
      if (pm.amount >= 0) continue;
      items.push(makeItem({
        code: `revenue_fee_${pm.name.replace(/\s/g, "_").slice(0, 20)}`,
        label: pm.name,
        category: "revenue",
        amount: pm.amount,
        source: "monthly_report",
        revenueKind: "fee",
        linkedModule: "monthly-report",
        isPaid: true,
        paymentNote: "手续费/服务费",
        notes: "已计入净利润，不计入本营业收入",
      }));
    }

    // 优惠已在营业收入中扣减：保留原始月报数据供经营分析使用，但不再生成总月报参考行。
  }

  // ── 2. 备用金各分类（完全按配置动态路由） ────────────────────────────────────
  if (input.pettyRecords) {
    // 收集所有出现过的分类代码（去重）
    const allCodes = new Set<string>();

    // 加入所有有配置且 showInReport=true 的分类（即使当月金额为0也显示）
    for (const cfg of pettyCfgs) {
      if (cfg.showInReport) allCodes.add(cfg.code);
    }
    // 加入当月有实际记录的分类
    for (const rec of input.pettyRecords) {
      allCodes.add(rec.code);
    }

    // 已被纳入薪资预支的备用金记录 ID
    const laborLinkedIds = input.laborLinkedPettyIds ?? new Set<string>();
    const laborLinkedTotal = input.laborLinkedTotal ?? 0;

    // 按分类代码生成科目行
    for (const code of allCodes) {
      const cfg = getPettyCfg(code, pettyCfgs);

      // N 类（备用金账户收入）→ 跳过，不生成支出行
      if (code.startsWith("N")) continue;

      // 排除已被纳入薪资预支的条目（按记录 ID 过滤）
      const recs = input.pettyRecords.filter((r) => r.code === code && !laborLinkedIds.has(r.id));
      const total = recs.reduce((s, r) => s + r.amount, 0);

      // 决定归属科目
      const resolvedCategory = resolvePettyCategory(code, pettyCfgs, inventoryCfgs);

      if (resolvedCategory === null) {
        // 归入备用金其他费用汇总，不单独生成行
        continue;
      }

      const displayLabel = cfg?.customLabel
        ?? (PETTY_CODE_LABELS[code as keyof typeof PETTY_CODE_LABELS] ?? code);

      items.push(makeItem({
        code: `petty_${code}`,
        label: displayLabel,
        category: resolvedCategory,
        amount: -total,
        source: "petty_cash",
        pettyCode: code,
        inventoryModule: cfg?.inventoryModule ?? undefined,
        isPaid: total > 0,
        paymentNote: total > 0 ? "已付(备用金)" : "",
      }));
    }

    // 备用金其他费用汇总行（排除已纳入薪资预支的人工条目）
    const otherRecs = input.pettyRecords.filter((r) => !excludedFromOther.has(r.code) && !laborLinkedIds.has(r.id));
    const otherTotal = otherRecs.reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "petty_other",
      label: "备用金费用（其他）",
      category: "petty_other",
      amount: -otherTotal,
      source: "petty_cash",
      isPaid: otherTotal > 0,
      paymentNote: otherTotal > 0 ? "已付(备用金)" : "",
      notes: "未单独列示的备用金支出合计（不含人工）",
    }));

    // 备用金人工单独行（已纳入薪资预支的部分）
    if (laborLinkedTotal > 0) {
      items.push(makeItem({
        code: "petty_labor",
        label: "备用金人工支出",
        category: "labor",
        amount: -laborLinkedTotal,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "已付(备用金)",
        notes: "已纳入薪资预支，不计入备用金消耗总额",
      }));
    }

    // 备用金收入（N4 充电宝等）
    const n4Total = input.pettyRecords.filter((r) => r.code === "N4").reduce((s, r) => s + r.amount, 0);
    if (n4Total > 0) {
      items.push(makeItem({
        code: "revenue_charger",
        label: "充电宝收入",
        category: "revenue",
        amount: n4Total,
        source: "petty_cash",
        revenueKind: "other_operating",
        pettyCode: "N4",
        isPaid: true,
        paymentNote: "已在备用金 N4 中计算",
        isDuplicate: true,
        duplicateNote: "已在备用金收入中计算，月报中仅供参考",
      }));
    }
  }

  // ── 3. 工资（薪资单 + 备用金兼职/人工，所有员工都生成行） ─────────────────────
  const paySlipMap: Record<string, PaySlip> = {};
  if (input.paySlips) {
    for (const slip of input.paySlips) {
      paySlipMap[slip.employeeId] = slip;
    }
  }
  const employeesToShow = input.allEmployees
    ?? (input.paySlips?.map((s) => ({ id: s.employeeId, realName: s.employeeId, code: "" })) ?? []);
  const shownEmpIds = new Set<string>();
  for (const emp of employeesToShow) {
    if (shownEmpIds.has(emp.id)) continue;
    shownEmpIds.add(emp.id);
    const slip = paySlipMap[emp.id];
    items.push(makeItem({
      code: `labor_${emp.id}`,
      label: emp.realName || emp.id,
      category: "labor",
      amount: -(slip?.finalSalary ?? 0),
      source: "labor",
      employeeId: emp.id,
      linkedModule: "labor-attendance",
      notes: slip?.notes ?? "",
    }));
  }
  // 薪资单中有但员工列表中没有的（兜底）
  if (input.paySlips) {
    for (const slip of input.paySlips) {
      if (!shownEmpIds.has(slip.employeeId)) {
        items.push(makeItem({
          code: `labor_${slip.employeeId}`,
          label: slip.employeeId,
          category: "labor",
          amount: -(slip.finalSalary ?? 0),
          source: "labor",
          employeeId: slip.employeeId,
          linkedModule: "labor-attendance",
          notes: slip.notes ?? "",
        }));
      }
    }
  }

  // ── 4. 库存模块进货成本（按 InventoryReportConfig 决定是否单独显示） ──────────
  // 4a. 烈酒供应商
  {
    const invCfg = getInventoryCfg("spirits", inventoryCfgs);
    if (invCfg?.showInReport) {
      const spiritSupplierMap: Record<string, SpiritPurchaseSupplierSummary> = {};
      if (input.spiritPurchaseSummary) {
        for (const sup of input.spiritPurchaseSummary) {
          spiritSupplierMap[sup.supplier] = sup;
        }
      }
      const allSpiritNames = new Set<string>([
        ...Object.keys(spiritSupplierMap),
        ...(input.allSpiritSupplierNames ?? []),
      ]);
      for (const supName of allSpiritNames) {
        const sup = spiritSupplierMap[supName];
        const amt = sup?.totalAmount ?? 0;
        items.push(makeItem({
          code: `cogs_bev_spirit_${supName.replace(/\s/g, "_").slice(0, 20)}`,
          label: supName,
          category: invCfg.reportCategory,
          amount: -amt,
          source: "spirits_inventory",
          inventoryModule: "spirits",
          linkedModule: "spirits-inventory",
          isPaid: sup?.isPaid ?? false,
          paymentNote: sup?.isPaid ? "已付" : "",
          notes: sup ? `${sup.itemCount} 款烈酒` : "",
        }));
      }
    }
    // showInReport=false → 烈酒进货金额归入备用金汇总（petty_other），库存分析仍然使用
  }

  // 4b. 葡萄酒供应商
  {
    const invCfg = getInventoryCfg("wine", inventoryCfgs);
    if (invCfg?.showInReport) {
      const wineSupplierMap: Record<string, number> = { ...(input.wineSnapshotSupplierTotals ?? {}) };
      if (input.wineManualPurchases) {
        for (const p of input.wineManualPurchases) {
          wineSupplierMap[p.supplier] = (wineSupplierMap[p.supplier] ?? 0) + p.amount;
        }
      }
      const allWineNames = new Set<string>([
        ...Object.keys(wineSupplierMap),
        ...(input.allWineSupplierNames ?? []),
      ]);
      for (const supName of allWineNames) {
        const amt = wineSupplierMap[supName] ?? 0;
        items.push(makeItem({
          code: `cogs_bev_wine_${supName.replace(/\s/g, "_").slice(0, 20)}`,
          label: supName,
          category: invCfg.reportCategory,
          amount: -amt,
          source: "wine_inventory",
          inventoryModule: "wine",
          linkedModule: "wine-inventory",
          isPaid: false,
          paymentNote: "",
        }));
      }
    }
  }

  // 4c. 食材供应商（来自供应商采购管理）
  {
    const invCfg = getInventoryCfg("food", inventoryCfgs);
    if (invCfg?.showInReport) {
      const foodSupplierMap: Record<string, number> = {};
      if (input.foodPurchaseRecords) {
        for (const rec of input.foodPurchaseRecords) {
          foodSupplierMap[rec.supplierName] = (foodSupplierMap[rec.supplierName] ?? 0) + rec.totalAmount;
        }
      }
      const allFoodNames = new Set<string>([
        ...Object.keys(foodSupplierMap),
        ...(input.allFoodSupplierNames ?? []),
      ]);
      for (const supName of allFoodNames) {
        const amt = foodSupplierMap[supName] ?? 0;
        items.push(makeItem({
          code: `cogs_food_supplier_${supName.replace(/\s/g, "_").slice(0, 20)}`,
          label: supName,
          category: invCfg.reportCategory,
          amount: -amt,
          source: "supplier_purchase",
          inventoryModule: "food",
          linkedModule: "supplier-import",
          isPaid: false,
          paymentNote: "",
        }));
      }
    }
  }

  const manualItems = input.manualItems ?? [];

  // ── 计算各小计（用户手工标记 manualDuplicate 优先于自动 isDuplicate） ─────────
  const effectiveDuplicate = (item: SummaryLineItem) =>
    item.manualDuplicate !== undefined ? item.manualDuplicate : item.isDuplicate;

  const nonDuplicate = items.filter((i) => !effectiveDuplicate(i));
  const sumAmounts = (records: ReadonlyArray<SummaryLineItem>) => sumMoney(records.map((item) => item.amount));
  const totalRevenue = sumAmounts(nonDuplicate.filter((i) => i.category === "revenue" && i.amount > 0));
  const revenueDeductions = sumAmounts(nonDuplicate.filter((i) => i.category === "revenue" && i.amount < 0));
  const totalCOGS = sumAmounts(nonDuplicate.filter((i) => ["cogs_food","cogs_beverage","cogs_wine"].includes(i.category)));
  const totalLabor = sumAmounts(nonDuplicate.filter((i) => i.category === "labor"));
  const totalRent = sumAmounts([...nonDuplicate, ...manualItems.filter((i) => !effectiveDuplicate(i))].filter((i) => i.category === "rent"));
  const totalUtilities = sumAmounts(nonDuplicate.filter((i) => i.category === "utilities"));
  const totalPettyOther = sumAmounts(nonDuplicate.filter((i) => i.category === "petty_other"));
  const totalExtra = sumAmounts(manualItems.filter((i) => i.category === "extra" && !effectiveDuplicate(i)));
  const manualRevenue = sumAmounts(manualItems.filter((i) => i.category === "revenue" && !effectiveDuplicate(i)));
  const manualCOGS = sumAmounts(manualItems.filter((i) => ["cogs_food","cogs_beverage","cogs_wine"].includes(i.category) && !effectiveDuplicate(i)));
  const manualLabor = sumAmounts(manualItems.filter((i) => i.category === "labor" && !effectiveDuplicate(i)));

  const resolvedRevenue = sumMoney([totalRevenue, revenueDeductions, manualRevenue]);
  const resolvedCOGS = sumMoney([totalCOGS, manualCOGS]);
  const resolvedLabor = sumMoney([totalLabor, manualLabor]);
  const netProfit = sumMoney([resolvedRevenue, resolvedCOGS, resolvedLabor, totalRent, totalUtilities, totalPettyOther, totalExtra]);

  return {
    lineItems: items,
    manualItems,
    totalRevenue: resolvedRevenue,
    totalCOGS: Math.abs(resolvedCOGS),
    totalLabor: Math.abs(resolvedLabor),
    totalRent: Math.abs(totalRent),
    totalUtilities: Math.abs(totalUtilities),
    totalPettyOther: Math.abs(totalPettyOther),
    totalExtra: Math.abs(totalExtra),
    netProfit,
  };
}

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
import type { MonthlyReport } from "../../store/monthly-report/types";
import type { PaySlip } from "../../labor/types";
import type { SupplierPurchaseRecord } from "../../food/types";

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

  // ── 1. 本月收入（来自月度经营分析 - 收款渠道） ──────────────────────────────
  if (input.monthlyReport) {
    const mr = input.monthlyReport;

    // 1a. 收款渠道（paymentMethods）
    if (mr.paymentMethods && mr.paymentMethods.length > 0) {
      for (const pm of mr.paymentMethods) {
        if (pm.amount === 0) continue;
        const isNegative = pm.amount < 0; // 手续费/服务费
        items.push(makeItem({
          code: `revenue_pm_${pm.name.replace(/\s/g, "_").slice(0, 20)}`,
          label: pm.name,
          category: "revenue",
          amount: pm.amount,
          source: "monthly_report",
          linkedModule: "monthly-report",
          isPaid: !isNegative,
          paymentNote: isNegative ? "手续费/服务费扣减" : "已收",
          notes: isNegative ? "支出项（红字）" : "",
        }));
      }
    } else if (mr.dishCategories && mr.dishCategories.length > 0) {
      // 降级：无收款渠道时用菜品大类
      for (const cat of mr.dishCategories) {
        if (cat.revenue === 0) continue;
        items.push(makeItem({
          code: `revenue_dish_${cat.name}`,
          label: cat.name,
          category: "revenue",
          amount: cat.revenue,
          source: "monthly_report",
          linkedModule: "monthly-report",
          isPaid: true,
          paymentNote: "已收",
        }));
      }
    }

    // 1b. 优惠扣减
    if (mr.kpi?.discountAmount && mr.kpi.discountAmount > 0) {
      items.push(makeItem({
        code: "revenue_discount",
        label: "优惠金额（扣减）",
        category: "revenue",
        amount: -mr.kpi.discountAmount,
        source: "monthly_report",
        notes: "已在营业额中扣除",
        isDuplicate: true,
        duplicateNote: "营业额已扣除优惠，此行仅供参考",
      }));
    }
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

    // 按分类代码生成科目行
    for (const code of allCodes) {
      const cfg = getPettyCfg(code, pettyCfgs);

      // N 类（备用金账户收入）→ 跳过，不生成支出行
      if (code.startsWith("N")) continue;

      const recs = input.pettyRecords.filter((r) => r.code === code);
      const total = recs.reduce((s, r) => s + r.amount, 0);

      // 决定归属科目
      const resolvedCategory = resolvePettyCategory(code, pettyCfgs, inventoryCfgs);

      if (resolvedCategory === null) {
        // 归入备用金其他费用汇总，不单独生成行
        continue;
      }

      const displayLabel = cfg?.customLabel
        ?? (code + " " + (recs[0]?.description?.slice(0, 10) ?? code));

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

    // 备用金其他费用汇总行（所有不单独显示的分类合计）
    const otherRecs = input.pettyRecords.filter((r) => !excludedFromOther.has(r.code));
    const otherTotal = otherRecs.reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "petty_other",
      label: "备用金费用（其他）",
      category: "petty_other",
      amount: -otherTotal,
      source: "petty_cash",
      isPaid: otherTotal > 0,
      paymentNote: otherTotal > 0 ? "已付(备用金)" : "",
      notes: "未单独列示的备用金支出合计",
    }));

    // 备用金收入（N4 充电宝等）
    const n4Total = input.pettyRecords.filter((r) => r.code === "N4").reduce((s, r) => s + r.amount, 0);
    if (n4Total > 0) {
      items.push(makeItem({
        code: "revenue_charger",
        label: "充电宝收入",
        category: "revenue",
        amount: n4Total,
        source: "petty_cash",
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
  const totalRevenue = nonDuplicate.filter((i) => i.category === "revenue" && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const revenueDeductions = nonDuplicate.filter((i) => i.category === "revenue" && i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const totalCOGS = nonDuplicate.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category)).reduce((s, i) => s + i.amount, 0);
  const totalLabor = nonDuplicate.filter((i) => i.category === "labor").reduce((s, i) => s + i.amount, 0);
  const totalRent = [...nonDuplicate, ...manualItems.filter((i) => !effectiveDuplicate(i))].filter((i) => i.category === "rent").reduce((s, i) => s + i.amount, 0);
  const totalUtilities = nonDuplicate.filter((i) => i.category === "utilities").reduce((s, i) => s + i.amount, 0);
  const totalPettyOther = nonDuplicate.filter((i) => i.category === "petty_other").reduce((s, i) => s + i.amount, 0);
  const totalExtra = manualItems.filter((i) => i.category === "extra" && !effectiveDuplicate(i)).reduce((s, i) => s + i.amount, 0);
  const manualRevenue = manualItems.filter((i) => i.category === "revenue" && !effectiveDuplicate(i)).reduce((s, i) => s + i.amount, 0);
  const manualCOGS = manualItems.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category) && !effectiveDuplicate(i)).reduce((s, i) => s + i.amount, 0);
  const manualLabor = manualItems.filter((i) => i.category === "labor" && !effectiveDuplicate(i)).reduce((s, i) => s + i.amount, 0);

  const netProfit = (totalRevenue + revenueDeductions + manualRevenue)
    + totalCOGS + manualCOGS
    + totalLabor + manualLabor
    + totalRent + totalUtilities + totalPettyOther + totalExtra;

  return {
    lineItems: items,
    manualItems,
    totalRevenue: totalRevenue + revenueDeductions + manualRevenue,
    totalCOGS: Math.abs(totalCOGS + manualCOGS),
    totalLabor: Math.abs(totalLabor + manualLabor),
    totalRent: Math.abs(totalRent),
    totalUtilities: Math.abs(totalUtilities),
    totalPettyOther: Math.abs(totalPettyOther),
    totalExtra: Math.abs(totalExtra),
    netProfit,
  };
}

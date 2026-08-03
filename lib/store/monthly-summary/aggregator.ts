/**
 * 月度总报表聚合引擎 (Build 133)
 *
 * 升级：
 *   - 所有科目行（含金额为0）均生成，对齐 Excel 月报固定行结构
 *   - 收入行从 paymentMethods（收款渠道）生成，不再只用 dishCategories
 *   - 烈酒/葡萄酒供应商无论当月是否进货都生成行（需传入 allSpiritSuppliers/allWineSuppliers）
 *   - 房租/水电/备用金固定行始终生成
 *   - 重复检测逻辑保持不变
 */
import { SummaryLineItem, MonthlySummaryReport, PETTY_EXCLUDED_FROM_OTHER } from "./types";
import type { PeriodSummary, PettyRecord } from "../../store/petty-store";
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
  /** 备用金月度汇总 */
  pettySummary?: PeriodSummary;
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
}

export function aggregateMonthlyReport(input: AggregatorInput): Partial<MonthlySummaryReport> {
  const items: SummaryLineItem[] = [];

  // ── 1. 本月收入（来自月度经营分析 - 收款渠道） ──────────────────────────────
  if (input.monthlyReport) {
    const mr = input.monthlyReport;

    // 1a. 收款渠道（paymentMethods）- 主要收入来源
    if (mr.paymentMethods && mr.paymentMethods.length > 0) {
      for (const pm of mr.paymentMethods) {
        if (pm.amount === 0) continue; // 收入渠道金额为0不生成行
        items.push(makeItem({
          code: `revenue_pm_${pm.name.replace(/\s/g, "_").slice(0, 20)}`,
          label: pm.name,
          category: "revenue",
          amount: pm.amount,
          source: "monthly_report",
          linkedModule: "monthly-report",
          isPaid: true,
          paymentNote: "已收",
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

    // 1b. 手续费/服务费扣减
    if (mr.kpi?.discountAmount) {
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

  // ── 2. 备用金收入（N4 充电宝） ───────────────────────────────────────────────
  if (input.pettyRecords) {
    const n4Total = input.pettyRecords.filter((r) => r.code === "N4").reduce((s, r) => s + r.amount, 0);
    if (n4Total > 0) {
      items.push(makeItem({
        code: "revenue_charger",
        label: "充电宝收入",
        category: "revenue",
        amount: n4Total,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "已在备用金 N4 中计算",
        isDuplicate: true,
        duplicateNote: "已在备用金收入中计算，月报中仅供参考",
      }));
    }
  }

  // ── 3. 进货成本-食材（备用金 A 类，始终生成所有分类行） ─────────────────────
  const FOOD_CODES = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"];
  const FOOD_LABELS: Record<string, string> = {
    A1: "新鲜肉类", A2: "新鲜海鲜", A3: "各种冻品",
    A4: "米面粮油", A5: "蔬菜水果", A6: "牛排",
    A7: "火腿", A8: "三文鱼", A9: "临时采购", A10: "研发采购",
  };
  if (input.pettyRecords) {
    for (const code of FOOD_CODES) {
      const recs = input.pettyRecords.filter((r) => r.code === code);
      const total = recs.reduce((s, r) => s + r.amount, 0);
      // 始终生成行，金额为0显示「-」
      items.push(makeItem({
        code: `cogs_food_${code}`,
        label: `${code} ${FOOD_LABELS[code] ?? code}`,
        category: "cogs_food",
        amount: -total,
        source: "petty_cash",
        isPaid: total > 0,
        paymentNote: total > 0 ? "已付(备用金)" : "",
      }));
    }
    // B1 啤酒（备用金 B1）
    const b1Total = input.pettyRecords.filter((r) => r.code === "B1").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "cogs_bev_b1",
      label: "B1 啤酒",
      category: "cogs_beverage",
      amount: -b1Total,
      source: "petty_cash",
      isPaid: b1Total > 0,
      paymentNote: b1Total > 0 ? "已付(备用金)" : "",
    }));
    // B2 酒水配料
    const b2Total = input.pettyRecords.filter((r) => r.code === "B2").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "cogs_bev_b2",
      label: "B2 酒水配料",
      category: "cogs_beverage",
      amount: -b2Total,
      source: "petty_cash",
      isPaid: b2Total > 0,
      paymentNote: b2Total > 0 ? "已付(备用金)" : "",
    }));
    // B3 酒水耗材
    const b3Total = input.pettyRecords.filter((r) => r.code === "B3").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "cogs_bev_b3",
      label: "B3 酒水耗材",
      category: "cogs_beverage",
      amount: -b3Total,
      source: "petty_cash",
      isPaid: b3Total > 0,
      paymentNote: b3Total > 0 ? "已付(备用金)" : "",
    }));
  }

  // ── 4. 工资（来自薪资单，所有员工都生成行） ──────────────────────────────────
  const paySlipMap: Record<string, PaySlip> = {};
  if (input.paySlips) {
    for (const slip of input.paySlips) {
      paySlipMap[slip.employeeId] = slip;
    }
  }
  // 如果传入了员工列表，为所有员工生成行（含无薪资单的员工）
  const employeesToShow = input.allEmployees ?? (input.paySlips?.map((s) => ({ id: s.employeeId, realName: s.employeeId, code: "" })) ?? []);
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

  // ── 5. 水电（备用金 L 类，始终生成行） ──────────────────────────────────────
  if (input.pettyRecords) {
    const l1Total = input.pettyRecords.filter((r) => r.code === "L1").reduce((s, r) => s + r.amount, 0);
    const l2Total = input.pettyRecords.filter((r) => r.code === "L2").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "utilities_electric",
      label: "电费（上月）",
      category: "utilities",
      amount: -l1Total,
      source: "petty_cash",
      isPaid: l1Total > 0,
      paymentNote: l1Total > 0 ? "微信支付" : "",
    }));
    items.push(makeItem({
      code: "utilities_water",
      label: "水费（上月）",
      category: "utilities",
      amount: -l2Total,
      source: "petty_cash",
      isPaid: l2Total > 0,
      paymentNote: l2Total > 0 ? "微信支付" : "",
    }));
  }

  // ── 6. 备用金其他费用（排除已单独列示的科目） ─────────────────────────────────
  if (input.pettyRecords) {
    const otherRecs = input.pettyRecords.filter((r) => !PETTY_EXCLUDED_FROM_OTHER.includes(r.code));
    const otherTotal = otherRecs.reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "petty_other",
      label: "备用金费用（其他）",
      category: "petty_other",
      amount: -otherTotal,
      source: "petty_cash",
      isPaid: otherTotal > 0,
      paymentNote: otherTotal > 0 ? "包含员工餐补、福利、食材、探店、消杀等" : "",
      notes: `D/E/G/H/I/J/K 类合计，排除已单独列示科目`,
    }));
  }

  // ── 7. 烈酒进货成本（所有供应商都生成行，含金额为0） ─────────────────────────
  {
    const pettyBevTotal = input.pettyRecords
      ? input.pettyRecords.filter((r) => r.code === "B2" || r.code === "B3").reduce((s, r) => s + r.amount, 0)
      : 0;
    const hasPettyBev = pettyBevTotal > 0;

    // 当月有进货的供应商
    const spiritSupplierMap: Record<string, SpiritPurchaseSupplierSummary> = {};
    if (input.spiritPurchaseSummary) {
      for (const sup of input.spiritPurchaseSummary) {
        spiritSupplierMap[sup.supplier] = sup;
      }
    }

    // 合并：有进货的 + 所有已登记供应商（金额为0）
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
        category: "cogs_beverage",
        amount: -amt,
        source: "spirits_inventory",
        linkedModule: "spirits-inventory",
        isPaid: sup?.isPaid ?? false,
        paymentNote: sup?.isPaid ? "已付" : "",
        notes: sup ? `${sup.itemCount} 款烈酒` : "",
        isDuplicate: hasPettyBev && amt > 0,
        duplicateNote: hasPettyBev && amt > 0
          ? "备用金 B2/B3 已包含部分酒水成本，请核对后保留其中一项"
          : "",
      }));
    }
  }

  // ── 8. 食材进货成本（来自供应商采购管理，所有供应商都生成行） ─────────────────
  {
    const pettyFoodTotal = input.pettyRecords
      ? input.pettyRecords.filter((r) => r.code.startsWith("A")).reduce((s, r) => s + r.amount, 0)
      : 0;
    const hasPettyFood = pettyFoodTotal > 0;

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
        category: "cogs_food",
        amount: -amt,
        source: "supplier_purchase",
        linkedModule: "supplier-import",
        isPaid: false,
        paymentNote: "",
        isDuplicate: hasPettyFood && amt > 0,
        duplicateNote: hasPettyFood && amt > 0
          ? "备用金 A 类已包含部分食材成本，请核对后保留其中一项"
          : "",
      }));
    }
  }

  // ── 9. 葡萄酒进货成本（所有供应商都生成行，含金额为0） ───────────────────────
  {
    const hasPettyBev = input.pettyRecords
      ? input.pettyRecords.filter((r) => r.code === "B2" || r.code === "B3").reduce((s, r) => s + r.amount, 0) > 0
      : false;

    // 快照供应商
    const wineSupplierMap: Record<string, number> = { ...(input.wineSnapshotSupplierTotals ?? {}) };
    // 手动进货叠加
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
        category: "cogs_beverage",
        amount: -amt,
        source: "spirits_inventory",
        linkedModule: "wine-inventory",
        isPaid: false,
        paymentNote: "",
        isDuplicate: hasPettyBev && amt > 0,
        duplicateNote: hasPettyBev && amt > 0 ? "备用金 B2/B3 已包含部分酒水成本，请核对后保留其中一项" : "",
      }));
    }
  }

  const manualItems = input.manualItems ?? [];

  // ── 计算各小计 ───────────────────────────────────────────────────────────────
  const nonDuplicate = items.filter((i) => !i.isDuplicate);
  const totalRevenue = nonDuplicate.filter((i) => i.category === "revenue" && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const revenueDeductions = nonDuplicate.filter((i) => i.category === "revenue" && i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const totalCOGS = nonDuplicate.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category)).reduce((s, i) => s + i.amount, 0);
  const totalLabor = nonDuplicate.filter((i) => i.category === "labor").reduce((s, i) => s + i.amount, 0);
  const totalRent = [...nonDuplicate, ...manualItems].filter((i) => i.category === "rent").reduce((s, i) => s + i.amount, 0);
  const totalUtilities = nonDuplicate.filter((i) => i.category === "utilities").reduce((s, i) => s + i.amount, 0);
  const totalPettyOther = nonDuplicate.filter((i) => i.category === "petty_other").reduce((s, i) => s + i.amount, 0);
  const totalExtra = manualItems.filter((i) => i.category === "extra").reduce((s, i) => s + i.amount, 0);
  const manualRevenue = manualItems.filter((i) => i.category === "revenue").reduce((s, i) => s + i.amount, 0);
  const manualCOGS = manualItems.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category)).reduce((s, i) => s + i.amount, 0);

  const netProfit = (totalRevenue + revenueDeductions + manualRevenue)
    + totalCOGS + manualCOGS
    + totalLabor + totalRent + totalUtilities + totalPettyOther + totalExtra;

  return {
    lineItems: items,
    manualItems,
    totalRevenue: totalRevenue + revenueDeductions + manualRevenue,
    totalCOGS: Math.abs(totalCOGS + manualCOGS),
    totalLabor: Math.abs(totalLabor),
    totalRent: Math.abs(totalRent),
    totalUtilities: Math.abs(totalUtilities),
    totalPettyOther: Math.abs(totalPettyOther),
    totalExtra: Math.abs(totalExtra),
    netProfit,
  };
}

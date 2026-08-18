import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("模块独立月结界面接入", () => {
  it("通用库存月结将水果、啤酒、冰块与店铺四类映射到各自模块，不建立全店锁", () => {
    const modal = read("components/inventory/MonthCloseModal.tsx");
    for (const mapping of [
      'beer: "beer"',
      'fruit: "fruit"',
      'ice: "ice"',
      'glassware: "glassware"',
      'tableware: "tableware"',
      'daily: "daily_supplies"',
      'equipment: "equipment"',
    ]) {
      expect(modal).toContain(mapping);
    }
    expect(modal).toContain("moduleClose.isWritable(module, currentMonth)");
    expect(modal).toContain("moduleClose.finalize({");
    expect(modal).not.toContain("store_month_close_archives");
  });

  it("食材的采购、消耗、盘点和月结都必须经过食材本月写入守卫", () => {
    const food = read("app/food-inventory.tsx");
    expect(food).toContain('moduleClose.getStatus("food", currentMonth)');
    expect(food).toContain('moduleClose.isWritable("food", currentMonth)');
    expect(food).toContain("assertFoodWritable()");
    expect(food).toContain('module: "food"');
    expect(food).toContain("recordPurchase");
    expect(food).toContain("recordConsume");
    expect(food).toContain("recordStocktake");
  });

  it("备用金归档只冻结备用金账本，并统一保护导入、编辑、期初和删除", () => {
    const petty = read("components/store/petty-cash.tsx");
    expect(petty).toContain('moduleClose.getStatus("petty_cash", month)');
    expect(petty).toContain('moduleClose.isWritable("petty_cash", month)');
    expect(petty).toContain('module: "petty_cash"');
    expect(petty).toContain("snapshot: { month, summary, records: monthRecords");
    expect(petty).toContain("if (!assertPettyWritable()) return;");
  });

  it("烈酒月结使用烈酒自身台账和进货金额，不能改写工资或其他库存状态", () => {
    const spirits = read("app/spirits-inventory.tsx");
    expect(spirits).toContain('moduleClose.getStatus("spirits", selectedMonth)');
    expect(spirits).toContain('moduleClose.isWritable("spirits", selectedMonth)');
    expect(spirits).toContain('module: "spirits"');
    expect(spirits).toContain("snapshot: { month: selectedMonth, ledger: monthLedger, purchases: monthPurchases }");
    expect(spirits).toContain("sumMoney(monthPurchases.map((purchase) => purchase.amount))");
  });

  it("工资仍保留既有独立月结键，不会被库存月结替换或合并", () => {
    const labor = read("lib/labor/store.tsx");
    const engine = read("lib/month-close/module-month-close.ts");
    expect(labor).toContain('"labor_month_close_archives_v1"');
    expect(labor).toContain('"labor_month_adjustment_sessions_v1"');
    expect(engine).toContain('"payroll"');
    expect(engine).not.toContain("labor_month_close_archives_v1");
  });
});

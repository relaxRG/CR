import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("全局月份多模块压力回归规范", () => {
  const script = read("scripts/h5-global-month-stress-e2e.mjs");
  const packageJson = read("package.json");

  it("通过真实月份卡片连续切换 24 次并验证最后月份", () => {
    expect(script).toContain('rapidSwitches: 24');
    expect(script).toContain('report-workspace-month-navigator-picker');
    expect(script).toContain('report-workspace-month-navigator-month-${targetMonth}');
    expect(script).toContain('selected.month !== "2026-07"');
    expect(script).toContain('selected.label.includes("2026年7月")');
  });

  it("采样 30 帧并将主线程卡顿阈值固定为 100ms", () => {
    expect(script).toContain("count < 30");
    expect(script).toContain("Performance.getMetrics");
    expect(script).toContain("JSHeapUsedSize");
    expect(script).toContain("frames.maxFrameGapMs > 100");
  });

  it("覆盖员工、报表、烈酒、葡萄酒、食材和账户的真实路由加载", () => {
    for (const route of ["/labor", "/store", "/spirits-inventory", "/wine-inventory", "/food-inventory", "/store-accounts"]) {
      expect(script).toContain(`"${route}"`);
    }
    expect(script).not.toContain('"/monthly-report"');
  });

  it("将压力回归登记为可重复执行的项目命令", () => {
    expect(packageJson).toContain('"test:h5:global-month-stress"');
  });
});

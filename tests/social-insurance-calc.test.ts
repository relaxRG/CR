/**
 * 社保、公积金、个税计算单元测试
 *
 * 覆盖场景：
 * 1. calcSocialInsurance - 基数上下限约束（低于下限、高于上限、在范围内）
 * 2. calcSocialInsurance - 开关控制（全局关闭、单险种关闭）
 * 3. calcSocialInsurance - 公积金独立基数和上下限
 * 4. calcSocialInsurance - 个人/公司双轨费率
 * 5. calcSocialInsurance - 工伤险/生育险个人费率为0时不扣员工工资
 * 6. calcIncomeTax - 累计预扣法各档位
 * 7. calcIncomeTax - 累计税额不得为负
 * 8. getCityPolicy - 城市匹配（精确/模糊/不存在）
 * 9. applyCityPolicy - 城市政策应用后保留原有 enabled/base 设置
 * 10. taxPreview 逻辑验证 - 基数上下限约束修复后的预览计算
 * 11. hfPreview 逻辑验证 - 公积金基数上下限约束修复后的预览计算
 */
import { describe, it, expect } from "vitest";
import {
  calcSocialInsurance,
  calcIncomeTax,
  getCityPolicy,
  applyCityPolicy,
  DEFAULT_SOCIAL_INSURANCE,
  BUILTIN_CITY_POLICIES,
  SocialInsuranceConfig,
  INCOME_TAX_BRACKETS,
} from "../lib/labor/types";

// ─── 辅助函数：构建上海社保配置 ────────────────────────────────────────────────
function buildShanghaiConfig(overrides: Partial<SocialInsuranceConfig> = {}): SocialInsuranceConfig {
  const policy = BUILTIN_CITY_POLICIES.find((p) => p.city === "上海")!;
  return applyCityPolicy({ ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 0 }, policy);
}

// ─── 辅助函数：复现 taxPreview/siPreview/hfPreview 中修复后的基数计算逻辑 ───────
function calcEffectiveBase(rawBase: number, baseMin: number, baseMax: number): number {
  if (baseMax > 0) return Math.min(baseMax, Math.max(baseMin, rawBase));
  return Math.max(baseMin, rawBase);
}

// ─── 1. calcSocialInsurance - 基数上下限约束 ───────────────────────────────────
describe("calcSocialInsurance - 基数上下限约束", () => {
  const shanghaiConfig = buildShanghaiConfig();
  // 上海 2025：baseMin=7310, baseMax=35811
  // 养老险个人 8%，医疗险个人 2%，失业险个人 0.5%
  const SHANGHAI_BASE_MIN = 7310;
  const SHANGHAI_BASE_MAX = 35811;

  it("工资低于基数下限时，应以下限为基数计算", () => {
    const grossSalary = 5000; // 低于上海下限 7310
    const result = calcSocialInsurance(grossSalary, shanghaiConfig);
    // 基数应被强制提升到 7310
    const expectedPension = Math.round(SHANGHAI_BASE_MIN * 0.08 * 100) / 100; // 584.80
    expect(result.pension).toBeCloseTo(expectedPension, 1);
    // 个人合计应大于直接用工资计算的结果（因为下限约束使基数变大）
    const directPension = grossSalary * 0.08; // 400
    expect(result.pension).toBeGreaterThan(directPension);
  });

  it("工资高于基数上限时，应以上限为基数计算", () => {
    const grossSalary = 50000; // 高于上海上限 35811
    const result = calcSocialInsurance(grossSalary, shanghaiConfig);
    // 基数应被限制在 35811
    const expectedPension = Math.round(SHANGHAI_BASE_MAX * 0.08 * 100) / 100; // 2864.88
    expect(result.pension).toBeCloseTo(expectedPension, 1);
    // 个人合计应小于直接用工资计算的结果（因为上限约束使基数变小）
    const directPension = grossSalary * 0.08; // 4000
    expect(result.pension).toBeLessThan(directPension);
  });

  it("工资在基数上下限范围内时，应以工资为基数计算", () => {
    const grossSalary = 15000; // 在 7310~35811 范围内
    const result = calcSocialInsurance(grossSalary, shanghaiConfig);
    const expectedPension = Math.round(grossSalary * 0.08 * 100) / 100; // 1200
    expect(result.pension).toBeCloseTo(expectedPension, 2);
  });

  it("手动设置 base 时，应以手动 base 为基准（再应用上下限）", () => {
    const config: SocialInsuranceConfig = { ...shanghaiConfig, base: 10000 };
    const result = calcSocialInsurance(50000, config); // grossSalary 不影响，base=10000
    const expectedPension = Math.round(10000 * 0.08 * 100) / 100; // 800
    expect(result.pension).toBeCloseTo(expectedPension, 2);
  });

  it("手动设置 base 低于下限时，仍应以下限为准", () => {
    const config: SocialInsuranceConfig = { ...shanghaiConfig, base: 3000 }; // 低于上海下限 7310
    const result = calcSocialInsurance(20000, config);
    const expectedPension = Math.round(SHANGHAI_BASE_MIN * 0.08 * 100) / 100; // 584.80
    expect(result.pension).toBeCloseTo(expectedPension, 1);
  });

  it("无上下限配置（baseMin=0, baseMax=0）时，直接使用工资", () => {
    const config: SocialInsuranceConfig = {
      ...DEFAULT_SOCIAL_INSURANCE,
      enabled: true,
      base: 0,
      baseMin: 0,
      baseMax: 0,
    };
    const grossSalary = 8000;
    const result = calcSocialInsurance(grossSalary, config);
    const expectedPension = Math.round(grossSalary * 0.08 * 100) / 100; // 640
    expect(result.pension).toBeCloseTo(expectedPension, 2);
  });
});

// ─── 2. calcSocialInsurance - 开关控制 ────────────────────────────────────────
describe("calcSocialInsurance - 开关控制", () => {
  it("enabled=false 时，所有结果为 0", () => {
    const config: SocialInsuranceConfig = { ...DEFAULT_SOCIAL_INSURANCE, enabled: false };
    const result = calcSocialInsurance(10000, config);
    expect(result.employeeTotal).toBe(0);
    expect(result.employerTotal).toBe(0);
    expect(result.total).toBe(0);
  });

  it("单个险种 enabled=false 时，该险种不计入合计", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const configNoPension: SocialInsuranceConfig = {
      ...shanghaiConfig,
      pension: { ...shanghaiConfig.pension, enabled: false },
    };
    const result = calcSocialInsurance(10000, configNoPension);
    expect(result.pension).toBe(0);
    expect(result.employerPension).toBe(0);
    // 其他险种仍然计算
    expect(result.medical).toBeGreaterThan(0);
  });

  it("工伤险和生育险个人费率为 0 时，不扣员工工资", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const result = calcSocialInsurance(10000, shanghaiConfig);
    // 上海工伤险个人费率 0，生育险个人费率 0
    expect(result.workInjury).toBe(0);
    expect(result.maternity).toBe(0);
    // 但公司部分仍然有
    expect(result.employerWorkInjury).toBeGreaterThan(0);
  });
});

// ─── 3. calcSocialInsurance - 公积金独立基数和上下限 ──────────────────────────
describe("calcSocialInsurance - 公积金独立基数和上下限", () => {
  it("公积金基数为 0 时，使用工资作为基数", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const grossSalary = 15000;
    const result = calcSocialInsurance(grossSalary, config);
    // 上海公积金：baseMin=2540, baseMax=35811，工资 15000 在范围内
    const expectedHF = Math.round(grossSalary * 0.07 * 100) / 100; // 1050
    expect(result.housingFund).toBeCloseTo(expectedHF, 2);
  });

  it("公积金基数低于下限时，以下限为准", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const grossSalary = 2000; // 低于上海公积金下限 2540
    const result = calcSocialInsurance(grossSalary, config);
    // 基数应被提升到 2540
    const expectedHF = Math.round(2540 * 0.07 * 100) / 100; // 177.80
    expect(result.housingFund).toBeCloseTo(expectedHF, 1);
    expect(result.housingFund).toBeGreaterThan(grossSalary * 0.07);
  });

  it("公积金基数高于上限时，以上限为准", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const grossSalary = 50000; // 高于上海公积金上限 35811
    const result = calcSocialInsurance(grossSalary, config);
    // 基数应被限制在 35811
    const expectedHF = Math.round(35811 * 0.07 * 100) / 100; // 2506.77
    expect(result.housingFund).toBeCloseTo(expectedHF, 1);
    expect(result.housingFund).toBeLessThan(grossSalary * 0.07);
  });

  it("公积金 enabled=false 时，housingFund 为 0", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: false },
    };
    const result = calcSocialInsurance(15000, config);
    expect(result.housingFund).toBe(0);
    expect(result.employerHousingFund).toBe(0);
  });
});

// ─── 4. calcSocialInsurance - 个人/公司双轨费率 ───────────────────────────────
describe("calcSocialInsurance - 个人/公司双轨费率", () => {
  it("个人合计 = 养老+医疗+失业+工伤+生育（个人费率）", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const grossSalary = 10000; // 在上海基数范围内
    const result = calcSocialInsurance(grossSalary, shanghaiConfig);
    const expectedEmployeeTotal = result.pension + result.medical + result.unemployment
      + result.workInjury + result.maternity;
    expect(result.employeeTotal).toBeCloseTo(expectedEmployeeTotal, 2);
  });

  it("公司合计 = 养老+医疗+失业+工伤+生育（公司费率）", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const grossSalary = 10000;
    const result = calcSocialInsurance(grossSalary, shanghaiConfig);
    const expectedEmployerTotal = result.employerPension + result.employerMedical
      + result.employerUnemployment + result.employerWorkInjury + result.employerMaternity;
    expect(result.employerTotal).toBeCloseTo(expectedEmployerTotal, 2);
  });

  it("total = employeeTotal + employerTotal（不含公积金）", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const result = calcSocialInsurance(10000, shanghaiConfig);
    expect(result.total).toBeCloseTo(result.employeeTotal + result.employerTotal, 2);
  });

  it("公司费率高于个人费率时，公司合计 > 个人合计", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const result = calcSocialInsurance(10000, shanghaiConfig);
    // 上海公司费率（16+9.5+0.5+0.4+0.8=27.2%）远高于个人（8+2+0.5=10.5%）
    expect(result.employerTotal).toBeGreaterThan(result.employeeTotal);
  });
});

// ─── 5. calcIncomeTax - 累计预扣法 ────────────────────────────────────────────
describe("calcIncomeTax - 累计预扣法", () => {
  it("累计应税收入为 0 时，税额为 0", () => {
    const result = calcIncomeTax(0, 0);
    expect(result.tax).toBe(0);
  });

  it("累计应税收入在 3% 档（≤36000）时，正确计算", () => {
    // 累计应税 10000，税率 3%，速算扣除 0
    const result = calcIncomeTax(10000, 0);
    expect(result.tax).toBeCloseTo(300, 2);
  });

  it("累计应税收入在 10% 档（36000~144000）时，正确计算", () => {
    // 累计应税 50000，税率 10%，速算扣除 2520
    const result = calcIncomeTax(50000, 0);
    const expected = 50000 * 0.10 - 2520; // = 2480
    expect(result.tax).toBeCloseTo(expected, 2);
  });

  it("扣除已缴税额后，本月税额不得为负", () => {
    // 累计应税 10000，已缴 5000（异常情况）
    const result = calcIncomeTax(10000, 5000);
    expect(result.tax).toBeGreaterThanOrEqual(0);
  });

  it("累计应税收入为负数时，税额为 0", () => {
    const result = calcIncomeTax(-1000, 0);
    expect(result.tax).toBe(0);
  });

  it("跨档位时正确应用税率（累计 36000 临界值）", () => {
    // 累计应税恰好 36000，calcIncomeTax 用 > b.min && <= b.max
    // 36000 > 0 && 36000 <= 36000 → 命中 3% 档
    const result = calcIncomeTax(36000, 0);
    const expected = 36000 * 0.03 - 0; // = 1080
    expect(result.tax).toBeCloseTo(expected, 2);
  });

  it("累计应税 36001 时，命中 10% 档", () => {
    const result = calcIncomeTax(36001, 0);
    const expected = 36001 * 0.10 - 2520; // = 1080.10
    expect(result.tax).toBeCloseTo(expected, 1);
  });

  it("返回 note 字段包含税率信息", () => {
    const result = calcIncomeTax(10000, 0);
    expect(result.note).toContain("3%");
  });
});

// ─── 6. getCityPolicy - 城市匹配 ──────────────────────────────────────────────
describe("getCityPolicy - 城市匹配", () => {
  it("精确匹配城市名称", () => {
    const policy = getCityPolicy("上海");
    expect(policy).not.toBeNull();
    expect(policy!.city).toBe("上海");
  });

  it("带「市」后缀时自动去除后匹配", () => {
    const policy = getCityPolicy("上海市");
    expect(policy).not.toBeNull();
    expect(policy!.city).toBe("上海");
  });

  it("带「市区」后缀时自动去除后匹配", () => {
    const policy = getCityPolicy("深圳市");
    expect(policy).not.toBeNull();
    expect(policy!.city).toBe("深圳");
  });

  it("不在内置列表中的城市返回 null", () => {
    const policy = getCityPolicy("西安");
    expect(policy).toBeNull();
  });

  it("内置 8 个城市均可被精确匹配", () => {
    const cities = ["上海", "北京", "广州", "深圳", "杭州", "成都", "武汉", "南京"];
    for (const city of cities) {
      const policy = getCityPolicy(city);
      expect(policy, `城市 ${city} 应能匹配`).not.toBeNull();
    }
  });
});

// ─── 7. applyCityPolicy - 城市政策应用 ────────────────────────────────────────
describe("applyCityPolicy - 城市政策应用", () => {
  it("应用上海政策后，险种费率正确更新", () => {
    const policy = getCityPolicy("上海")!;
    const config = applyCityPolicy({ ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 0 }, policy);
    expect(config.pension.employeeRate).toBeCloseTo(0.08, 4);
    expect(config.pension.employerRate).toBeCloseTo(0.16, 4);
    expect(config.baseMin).toBe(7310);
    expect(config.baseMax).toBe(35811);
  });

  it("应用城市政策后，原有 enabled 设置被保留", () => {
    const policy = getCityPolicy("北京")!;
    const original = { ...DEFAULT_SOCIAL_INSURANCE, enabled: false, base: 8000 };
    const config = applyCityPolicy(original, policy);
    // enabled 应保留原值 false
    expect(config.enabled).toBe(false);
  });

  it("应用城市政策后，原有 base 设置被保留", () => {
    const policy = getCityPolicy("广州")!;
    const original = { ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 12000 };
    const config = applyCityPolicy(original, policy);
    // base 应保留原值 12000
    expect(config.base).toBe(12000);
  });

  it("应用城市政策后，公积金 base 设置被保留", () => {
    const policy = getCityPolicy("深圳")!;
    const original = {
      ...DEFAULT_SOCIAL_INSURANCE,
      enabled: true,
      base: 0,
      housingFund: { ...DEFAULT_SOCIAL_INSURANCE.housingFund, base: 15000 },
    };
    const config = applyCityPolicy(original, policy);
    // 公积金 base 应保留原值 15000
    expect(config.housingFund.base).toBe(15000);
  });
});

// ─── 8. taxPreview 逻辑验证 - 修复后的基数上下限约束 ──────────────────────────
describe("taxPreview 逻辑验证 - 修复后的基数上下限约束", () => {
  // 复现修复后的 taxPreview 中 siDeduct 计算逻辑
  function calcSiDeductWithLimit(
    salary: number,
    siConfig: SocialInsuranceConfig
  ): number {
    const rawBase = siConfig.base > 0 ? siConfig.base : salary;
    const base = calcEffectiveBase(rawBase, siConfig.baseMin, siConfig.baseMax);
    return (siConfig.pension.enabled ? base * siConfig.pension.employeeRate : 0) +
      (siConfig.medical.enabled ? base * siConfig.medical.employeeRate : 0) +
      (siConfig.unemployment.enabled ? base * siConfig.unemployment.employeeRate : 0) +
      (siConfig.workInjury.enabled ? base * siConfig.workInjury.employeeRate : 0) +
      (siConfig.maternity.enabled ? base * siConfig.maternity.employeeRate : 0);
  }

  it("工资低于上海下限时，taxPreview 的 siDeduct 应与 calcSocialInsurance 一致", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const salary = 5000; // 低于上海下限 7310
    const siDeductFixed = calcSiDeductWithLimit(salary, shanghaiConfig);
    const siResult = calcSocialInsurance(salary, shanghaiConfig);
    const siDeductActual = siResult.pension + siResult.medical + siResult.unemployment
      + siResult.workInjury + siResult.maternity;
    expect(siDeductFixed).toBeCloseTo(siDeductActual, 2);
  });

  it("工资高于上海上限时，taxPreview 的 siDeduct 应与 calcSocialInsurance 一致", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const salary = 50000; // 高于上海上限 35811
    const siDeductFixed = calcSiDeductWithLimit(salary, shanghaiConfig);
    const siResult = calcSocialInsurance(salary, shanghaiConfig);
    const siDeductActual = siResult.pension + siResult.medical + siResult.unemployment
      + siResult.workInjury + siResult.maternity;
    // 注：两者都应用了上限约束，不同之处在于 calcSocialInsurance 内部对每个险种单独四舍五入，而我们是先求和再四舍五入，允许 0.01 的浮点误差
    expect(Math.abs(siDeductFixed - siDeductActual)).toBeLessThan(0.02);
  });

  it("修复前后的差异：工资低于下限时，修复后 siDeduct 更大（下限约束）", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const salary = 5000;
    // 修复前（无上下限约束）
    const siDeductBefore = salary * 0.08 + salary * 0.02 + salary * 0.005; // = 525
    // 修复后（有下限约束，基数提升到 7310）
    const siDeductAfter = calcSiDeductWithLimit(salary, shanghaiConfig);
    expect(siDeductAfter).toBeGreaterThan(siDeductBefore);
  });

  it("修复前后的差异：工资高于上限时，修复后 siDeduct 更小（上限约束）", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const salary = 50000;
    // 修复前（无上下限约束）
    const siDeductBefore = salary * 0.08 + salary * 0.02 + salary * 0.005; // = 5250
    // 修复后（有上限约束，基数限制在 35811）
    const siDeductAfter = calcSiDeductWithLimit(salary, shanghaiConfig);
    expect(siDeductAfter).toBeLessThan(siDeductBefore);
  });
});

// ─── 9. hfPreview 逻辑验证 - 修复后的公积金基数上下限约束 ─────────────────────
describe("hfPreview 逻辑验证 - 修复后的公积金基数上下限约束", () => {
  function calcHfDeductWithLimit(
    salary: number,
    siConfig: SocialInsuranceConfig
  ): number {
    const hfRawBase = siConfig.housingFund.base > 0 ? siConfig.housingFund.base : salary;
    const hfBase = calcEffectiveBase(
      hfRawBase,
      siConfig.housingFund.baseMin,
      siConfig.housingFund.baseMax
    );
    return hfBase * siConfig.housingFund.employeeRate;
  }

  it("公积金工资低于下限时，以下限为准", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const salary = 2000; // 低于上海公积金下限 2540
    const hfDeduct = calcHfDeductWithLimit(salary, config);
    // 应以下限 2540 为基数
    const expected = 2540 * 0.07; // = 177.80
    expect(hfDeduct).toBeCloseTo(expected, 1);
  });

  it("公积金工资高于上限时，以上限为准", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const salary = 50000; // 高于上海公积金上限 35811
    const hfDeduct = calcHfDeductWithLimit(salary, config);
    // 应以上限 35811 为基数
    const expected = 35811 * 0.07; // = 2506.77
    expect(hfDeduct).toBeCloseTo(expected, 1);
  });

  it("hfPreview 的公积金基数与 calcSocialInsurance 结果一致", () => {
    const shanghaiConfig = buildShanghaiConfig();
    const config: SocialInsuranceConfig = {
      ...shanghaiConfig,
      housingFund: { ...shanghaiConfig.housingFund, enabled: true, base: 0 },
    };
    const salary = 2000;
    const hfDeductFixed = calcHfDeductWithLimit(salary, config);
    const siResult = calcSocialInsurance(salary, config);
    expect(hfDeductFixed).toBeCloseTo(siResult.housingFund, 2);
  });
});

// ─── 10. 各城市社保计算正确性验证 ─────────────────────────────────────────────
describe("各城市社保计算正确性验证", () => {
  it("北京：工资 10000 在基数范围内，个人合计正确", () => {
    const policy = getCityPolicy("北京")!;
    const config = applyCityPolicy({ ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 0 }, policy);
    const result = calcSocialInsurance(10000, config);
    // 北京个人：养老8%+医疗2%+失业0.5% = 10.5%
    const expected = 10000 * (0.08 + 0.02 + 0.005);
    expect(result.employeeTotal).toBeCloseTo(expected, 2);
  });

  it("深圳：工资低于下限 2360 时，以下限为基数", () => {
    const policy = getCityPolicy("深圳")!;
    const config = applyCityPolicy({ ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 0 }, policy);
    const result = calcSocialInsurance(2000, config); // 低于深圳下限 2360
    const expectedPension = Math.round(2360 * 0.08 * 100) / 100; // 188.80
    expect(result.pension).toBeCloseTo(expectedPension, 1);
  });

  it("广州：工资 5000 在基数范围内（下限 3096），正常计算", () => {
    const policy = getCityPolicy("广州")!;
    const config = applyCityPolicy({ ...DEFAULT_SOCIAL_INSURANCE, enabled: true, base: 0 }, policy);
    const result = calcSocialInsurance(5000, config);
    const expectedPension = Math.round(5000 * 0.08 * 100) / 100; // 400
    expect(result.pension).toBeCloseTo(expectedPension, 2);
  });
});

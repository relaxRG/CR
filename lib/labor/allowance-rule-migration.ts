import type { AllowancePeriodMode, AllowanceRule, AllowanceType, AllowanceUnit } from "./types";

const KNOWN_TYPES = new Set<AllowanceType>([
  "meal_per_day",
  "transport_fixed",
  "custom_fixed",
]);
const KNOWN_UNITS = new Set<AllowanceUnit>(["per_day", "per_month", "per_quarter", "per_year"]);
const KNOWN_PERIOD_MODES = new Set<AllowancePeriodMode>(["natural", "rolling"]);

function normalizeLabel(value: unknown): string {
  return String(value ?? "").replace(/\s/g, "").toLowerCase();
}

function looksLikeMealAllowance(label: string): boolean {
  return /饭补|餐补|餐费补贴|用餐补贴/.test(label);
}

function looksLikeTransportAllowance(label: string): boolean {
  return /交通补贴|通勤补贴|车补|交通费补贴/.test(label);
}

export function isValidAllowanceEffectiveMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * 将旧版 AsyncStorage 或云同步中取得的单个补贴规则无损规范化。
 *
 * 设计原则：只补全/修正已被历史UI错误创建的预设类型；不能依据名称把“公司补贴”
 * 等自定义规则随意改变语义。迁移后规则可被新表单和唯一结算引擎安全读取。
 */
export function migrateAllowanceRule(raw: unknown): AllowanceRule {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const label = String(source.label ?? "自定义补贴").trim() || "自定义补贴";
  const normalizedLabel = normalizeLabel(label);
  const rawUnit = typeof source.unit === "string" && KNOWN_UNITS.has(source.unit as AllowanceUnit)
    ? source.unit as AllowanceUnit
    : undefined;
  const rawType = typeof source.type === "string" && KNOWN_TYPES.has(source.type as AllowanceType)
    ? source.type as AllowanceType
    : undefined;

  // 旧员工档案的“+ 餐补/+ 交通补贴”曾统一写入 custom_fixed。
  // 仅在名称匹配预设语义时提升类型，普通自定义补贴永远维持 custom_fixed。
  const type: AllowanceType = rawType === "custom_fixed" && looksLikeMealAllowance(normalizedLabel) && rawUnit === "per_day"
    ? "meal_per_day"
    : rawType === "custom_fixed" && looksLikeTransportAllowance(normalizedLabel) && rawUnit !== "per_day"
      ? "transport_fixed"
      : rawType ?? (looksLikeMealAllowance(normalizedLabel) ? "meal_per_day" : looksLikeTransportAllowance(normalizedLabel) ? "transport_fixed" : "custom_fixed");

  const unit: AllowanceUnit = type === "meal_per_day"
    ? "per_day"
    : type === "transport_fixed"
      ? "per_month"
      : rawUnit ?? "per_month";
  const isPeriodic = unit === "per_quarter" || unit === "per_year";
  const mode: AllowancePeriodMode = KNOWN_PERIOD_MODES.has(source.periodMode as AllowancePeriodMode)
    ? source.periodMode as AllowancePeriodMode
    : "natural";
  const periodMode = isPeriodic ? mode : undefined;
  const effectiveMonth = isPeriodic && periodMode === "rolling" && isValidAllowanceEffectiveMonth(source.effectiveMonth)
    ? source.effectiveMonth
    : undefined;
  const numericAmount = Number(source.amount);

  return {
    id: String(source.id ?? `migrated_allowance_${label}`),
    type,
    label,
    amount: Number.isFinite(numericAmount) ? numericAmount : 0,
    unit,
    periodMode,
    effectiveMonth,
    enabled: source.enabled !== false,
  };
}

export function migrateAllowanceRules(rawRules: unknown): AllowanceRule[] | undefined {
  if (!Array.isArray(rawRules)) return undefined;
  return rawRules.map(migrateAllowanceRule);
}

export function needsAllowanceRulesMigration(rawRules: unknown): boolean {
  if (!Array.isArray(rawRules)) return false;
  return rawRules.some((raw) => {
    const migrated = migrateAllowanceRule(raw);
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return source.type !== migrated.type ||
      source.label !== migrated.label ||
      source.amount !== migrated.amount ||
      source.unit !== migrated.unit ||
      source.periodMode !== migrated.periodMode ||
      source.effectiveMonth !== migrated.effectiveMonth ||
      source.enabled !== migrated.enabled;
  });
}

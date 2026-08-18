import { roundMoney } from "@/lib/finance/money";

/**
 * 模块独立月结：每个 module + month 拥有自己的归档、付款和调整会话。
 * 该文件不读取任何业务 Store，避免工资、库存、账户相互锁定。
 */
export const MONTH_CLOSE_MODULES = [
  "payroll",
  "spirits",
  "wine",
  "food",
  "fruit",
  "beer",
  "ice",
  "glassware",
  "tableware",
  "daily_supplies",
  "equipment",
  "petty_cash",
  "accounts",
] as const;

export type MonthCloseModule = (typeof MONTH_CLOSE_MODULES)[number];
export type ModuleArchiveStatus = "frozen" | "superseded";
export type ModuleMonthCloseStatus = "draft" | "frozen_unpaid" | "frozen_partial" | "frozen_paid" | "adjusting";

export interface ModulePaymentSummary {
  payable: number;
  paid: number;
  remaining: number;
}

export interface ModuleMonthAdjustment {
  id: string;
  module: MonthCloseModule;
  month: string;
  baseArchiveId: string;
  baseVersion: number;
  reason: string;
  createdAt: number;
  createdBy: "manager";
  /** 调整开始前该模块的完整快照。 */
  baselineSnapshot: unknown;
}

export interface ModuleMonthCloseArchive<TSnapshot = unknown> {
  id: string;
  module: MonthCloseModule;
  month: string;
  version: number;
  status: ModuleArchiveStatus;
  createdAt: number;
  closedBy: "manager";
  previousArchiveId?: string;
  snapshot: TSnapshot;
  paymentSummary: ModulePaymentSummary;
}

export interface FinalizeModuleMonthInput<TSnapshot> {
  module: MonthCloseModule;
  month: string;
  snapshot: TSnapshot;
  paymentSummary: ModulePaymentSummary;
  now?: number;
}

export interface ModuleCloseSummary {
  module: MonthCloseModule;
  status: ModuleMonthCloseStatus;
  version: number | null;
  paymentSummary: ModulePaymentSummary;
  updatedAt: number | null;
}

export function normalizePaymentSummary(summary: ModulePaymentSummary): ModulePaymentSummary {
  const payable = Math.max(0, roundMoney(summary.payable));
  const paid = Math.max(0, Math.min(payable, roundMoney(summary.paid)));
  return {
    payable,
    paid,
    remaining: roundMoney(Math.max(0, payable - paid)),
  };
}

export function getCurrentModuleArchive(
  archives: ModuleMonthCloseArchive[],
  module: MonthCloseModule,
  month: string,
): ModuleMonthCloseArchive | null {
  return archives
    .filter((archive) => archive.module === module && archive.month === month && archive.status === "frozen")
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function getModuleMonthCloseStatus(
  archives: ModuleMonthCloseArchive[],
  sessions: ModuleMonthAdjustment[],
  module: MonthCloseModule,
  month: string,
): ModuleMonthCloseStatus {
  if (sessions.some((session) => session.module === module && session.month === month)) return "adjusting";
  const archive = getCurrentModuleArchive(archives, module, month);
  if (!archive) return "draft";
  const payment = normalizePaymentSummary(archive.paymentSummary);
  if (payment.remaining === 0) return "frozen_paid";
  if (payment.paid > 0) return "frozen_partial";
  return "frozen_unpaid";
}

export function isModuleMonthWritable(
  archives: ModuleMonthCloseArchive[],
  sessions: ModuleMonthAdjustment[],
  module: MonthCloseModule,
  month: string,
): boolean {
  const status = getModuleMonthCloseStatus(archives, sessions, module, month);
  return status === "draft" || status === "adjusting";
}

export function finalizeModuleMonth<TSnapshot>(
  archives: ModuleMonthCloseArchive[],
  sessions: ModuleMonthAdjustment[],
  input: FinalizeModuleMonthInput<TSnapshot>,
): { archives: ModuleMonthCloseArchive<TSnapshot>[]; sessionIdsToRemove: string[]; archive: ModuleMonthCloseArchive<TSnapshot> | null } {
  const current = getCurrentModuleArchive(archives, input.module, input.month);
  const adjustment = sessions.find((session) => session.module === input.module && session.month === input.month) ?? null;
  if (current && !adjustment) return { archives: archives as ModuleMonthCloseArchive<TSnapshot>[], sessionIdsToRemove: [], archive: null };

  const now = input.now ?? Date.now();
  const version = Math.max(0, ...archives
    .filter((archive) => archive.module === input.module && archive.month === input.month)
    .map((archive) => archive.version)) + 1;
  const archive: ModuleMonthCloseArchive<TSnapshot> = {
    id: `module-close-${input.module}-${input.month}-${version}-${now}`,
    module: input.module,
    month: input.month,
    version,
    status: "frozen",
    createdAt: now,
    closedBy: "manager",
    previousArchiveId: current?.id,
    snapshot: input.snapshot,
    paymentSummary: normalizePaymentSummary(input.paymentSummary),
  };

  const next = current
    ? archives.map((item) => item.id === current.id ? { ...item, status: "superseded", supersededByArchiveId: archive.id } : item)
    : [...archives];
  return {
    archives: [...next, archive] as ModuleMonthCloseArchive<TSnapshot>[],
    sessionIdsToRemove: adjustment ? [adjustment.id] : [],
    archive,
  };
}

export function openModuleAdjustment(
  archives: ModuleMonthCloseArchive[],
  sessions: ModuleMonthAdjustment[],
  module: MonthCloseModule,
  month: string,
  reason: string,
  now = Date.now(),
): ModuleMonthAdjustment | null {
  if (!reason.trim() || sessions.some((session) => session.module === module && session.month === month)) return null;
  const archive = getCurrentModuleArchive(archives, module, month);
  if (!archive) return null;
  return {
    id: `module-adjust-${module}-${month}-${now}`,
    module,
    month,
    baseArchiveId: archive.id,
    baseVersion: archive.version,
    reason: reason.trim(),
    createdAt: now,
    createdBy: "manager",
    baselineSnapshot: archive.snapshot,
  };
}

export function summarizeModuleMonth(
  archives: ModuleMonthCloseArchive[],
  sessions: ModuleMonthAdjustment[],
  module: MonthCloseModule,
  month: string,
): ModuleCloseSummary {
  const archive = getCurrentModuleArchive(archives, module, month);
  return {
    module,
    status: getModuleMonthCloseStatus(archives, sessions, module, month),
    version: archive?.version ?? null,
    paymentSummary: normalizePaymentSummary(archive?.paymentSummary ?? { payable: 0, paid: 0, remaining: 0 }),
    updatedAt: archive?.createdAt ?? null,
  };
}

export type InventoryBulkAction = "archive" | "delete" | "reclassify";

export interface InventoryHistoryReferences {
  purchases: number;
  consumes: number;
  ledger: number;
  snapshots: number;
  referencePrices: number;
  currentStock: number;
}

export interface InventoryBulkCandidate {
  id: string;
  active: boolean;
  category?: string;
}

export type InventoryBulkDecision = "delete" | "archive" | "reclassify" | "skip";

export interface InventoryBulkPreflightItem {
  id: string;
  decision: InventoryBulkDecision;
  reason?: "month-locked" | "not-found" | "already-archived" | "history-protected" | "invalid-category";
  history: InventoryHistoryReferences;
}

export interface InventoryBulkPreflight {
  operationId: string;
  action: InventoryBulkAction;
  createdAt: string;
  items: InventoryBulkPreflightItem[];
  deletableIds: string[];
  archivableIds: string[];
  reclassifiableIds: string[];
  skippedIds: string[];
  counts: { selected: number; delete: number; archive: number; reclassify: number; skipped: number };
}

const EMPTY_HISTORY: InventoryHistoryReferences = {
  purchases: 0,
  consumes: 0,
  ledger: 0,
  snapshots: 0,
  referencePrices: 0,
  currentStock: 0,
};

export function createInventoryOperationId(scope: string, now = new Date()): string {
  return `${scope}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function hasInventoryHistory(history: InventoryHistoryReferences): boolean {
  return history.purchases > 0
    || history.consumes > 0
    || history.ledger > 0
    || history.snapshots > 0
    || history.referencePrices > 0
    || history.currentStock > 0;
}

/**
 * 批量操作只负责给出可解释的处理计划，不直接修改持久化数据。
 * 调用方必须在用户二次确认后，把该计划作为单次 reducer action 提交。
 */
export function prepareInventoryBulkOperation(input: {
  scope: string;
  action: InventoryBulkAction;
  selectedIds: readonly string[];
  items: readonly InventoryBulkCandidate[];
  isMonthWritable: boolean;
  targetCategory?: string;
  getHistory: (itemId: string) => InventoryHistoryReferences;
  now?: Date;
}): InventoryBulkPreflight {
  const uniqueIds = [...new Set(input.selectedIds.filter(Boolean))];
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const items: InventoryBulkPreflightItem[] = uniqueIds.map((id) => {
    const item = byId.get(id);
    const history = item ? input.getHistory(id) : EMPTY_HISTORY;
    if (!item) return { id, decision: "skip", reason: "not-found", history };
    if (!input.isMonthWritable) return { id, decision: "skip", reason: "month-locked", history };
    if (input.action === "reclassify") {
      if (!input.targetCategory?.trim()) return { id, decision: "skip", reason: "invalid-category", history };
      if (!item.active) return { id, decision: "skip", reason: "already-archived", history };
      return { id, decision: "reclassify", history };
    }
    if (input.action === "archive") {
      if (!item.active) return { id, decision: "skip", reason: "already-archived", history };
      return { id, decision: "archive", history };
    }
    if (!item.active) return { id, decision: "skip", reason: "already-archived", history };
    return hasInventoryHistory(history)
      ? { id, decision: "archive", reason: "history-protected", history }
      : { id, decision: "delete", history };
  });

  const byDecision = (decision: InventoryBulkDecision) => items.filter((item) => item.decision === decision).map((item) => item.id);
  const deletableIds = byDecision("delete");
  const archivableIds = byDecision("archive");
  const reclassifiableIds = byDecision("reclassify");
  const skippedIds = byDecision("skip");
  return {
    operationId: createInventoryOperationId(input.scope, input.now),
    action: input.action,
    createdAt: (input.now ?? new Date()).toISOString(),
    items,
    deletableIds,
    archivableIds,
    reclassifiableIds,
    skippedIds,
    counts: {
      selected: uniqueIds.length,
      delete: deletableIds.length,
      archive: archivableIds.length,
      reclassify: reclassifiableIds.length,
      skipped: skippedIds.length,
    },
  };
}

export interface InventoryOperationReceipt {
  operationId: string;
  scope: string;
  action: InventoryBulkAction;
  createdAt: string;
  completedAt: string;
  deletedIds: string[];
  archivedIds: string[];
  reclassifiedIds: string[];
  skippedIds: string[];
}

export function createInventoryOperationReceipt(input: {
  scope: string;
  preflight: InventoryBulkPreflight;
  completedAt?: string;
}): InventoryOperationReceipt {
  return {
    operationId: input.preflight.operationId,
    scope: input.scope,
    action: input.preflight.action,
    createdAt: input.preflight.createdAt,
    completedAt: input.completedAt ?? new Date().toISOString(),
    deletedIds: input.preflight.deletableIds,
    archivedIds: input.preflight.archivableIds,
    reclassifiedIds: input.preflight.reclassifiableIds,
    skippedIds: input.preflight.skippedIds,
  };
}

export function describeInventoryBulkSkip(reason: InventoryBulkPreflightItem["reason"]): string {
  switch (reason) {
    case "month-locked": return "所选月份已归档";
    case "not-found": return "项目已不存在或已被其他设备更新";
    case "already-archived": return "项目已经归档";
    case "history-protected": return "项目存在历史数据，只能归档";
    case "invalid-category": return "未选择目标分类";
    default: return "无法处理";
  }
}

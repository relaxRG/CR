import type { MeituanBillFetchBatch } from "./bill-import-window";

export type MeituanApiBatchStatus = "pending" | "running" | "completed" | "failed";

export interface MeituanApiBatchCheckpoint {
  batchKey: string;
  storeId: string;
  month: string;
  startDate: string;
  endDate: string;
  status: MeituanApiBatchStatus;
  attempts: number;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface MeituanBillResumeState {
  version: 1;
  storeId: string;
  historyMonths: number;
  checkpoints: Record<string, MeituanApiBatchCheckpoint>;
}

export function meituanApiBatchKey(storeId: string, batch: Pick<MeituanBillFetchBatch, "month" | "startDate" | "endDate">): string {
  return `meituan-openapi:${String(storeId).trim()}:${batch.month}:${batch.startDate}:${batch.endDate}`;
}

export function createMeituanBillResumeState(storeId: string, historyMonths: number): MeituanBillResumeState {
  const normalizedStoreId = String(storeId ?? "").trim();
  if (!normalizedStoreId) throw new Error("断点续传必须绑定当前门店 ID");
  return { version: 1, storeId: normalizedStoreId, historyMonths, checkpoints: {} };
}

/**
 * 仅从未完成或失败的官方 API 批次继续；文件导入批次必须由用户上传导出文件，不能伪造为已同步。
 */
export function getResumableMeituanApiBatches(input: {
  storeId: string;
  batches: MeituanBillFetchBatch[];
  state: MeituanBillResumeState;
}): MeituanBillFetchBatch[] {
  const storeId = String(input.storeId ?? "").trim();
  if (!storeId || storeId !== input.state.storeId) throw new Error("断点状态与当前绑定门店不一致，禁止继续");
  return input.batches.filter((batch) => {
    if (batch.source !== "meituan-openapi") return false;
    const checkpoint = input.state.checkpoints[meituanApiBatchKey(storeId, batch)];
    return checkpoint?.status !== "completed";
  });
}

export function markMeituanApiBatchRunning(state: MeituanBillResumeState, batch: MeituanBillFetchBatch, now: string): MeituanBillResumeState {
  if (batch.source !== "meituan-openapi") throw new Error("文件导入批次不能标记为 API 读取中");
  const key = meituanApiBatchKey(state.storeId, batch);
  const previous = state.checkpoints[key];
  return {
    ...state,
    checkpoints: {
      ...state.checkpoints,
      [key]: {
        batchKey: key,
        storeId: state.storeId,
        month: batch.month,
        startDate: batch.startDate,
        endDate: batch.endDate,
        status: "running",
        attempts: (previous?.attempts ?? 0) + 1,
        updatedAt: now,
      },
    },
  };
}

export function markMeituanApiBatchResult(input: {
  state: MeituanBillResumeState;
  batch: MeituanBillFetchBatch;
  now: string;
  success: boolean;
  errorMessage?: string;
}): MeituanBillResumeState {
  const { state, batch, now, success, errorMessage } = input;
  if (batch.source !== "meituan-openapi") throw new Error("文件导入批次不适用 API 断点结果");
  const key = meituanApiBatchKey(state.storeId, batch);
  const previous = state.checkpoints[key];
  if (!previous || previous.status !== "running") throw new Error("批次必须先标记为运行中才能写入结果");
  return {
    ...state,
    checkpoints: {
      ...state.checkpoints,
      [key]: {
        ...previous,
        status: success ? "completed" : "failed",
        updatedAt: now,
        completedAt: success ? now : undefined,
        errorMessage: success ? undefined : String(errorMessage ?? "美团账单读取失败"),
      },
    },
  };
}

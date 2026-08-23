import type { ArchiveMutationOutcome } from "./archive-remote-client";
import type { ArchiveRemoteIndex } from "./archive-sync-coordinator";

export type ArchiveConflictViewState =
  | Readonly<{ status: "conflict"; outcome: Extract<ArchiveMutationOutcome, { status: "conflict" }>; index: ArchiveRemoteIndex }>
  | Readonly<{ status: "deleted"; outcome: Extract<ArchiveMutationOutcome, { status: "deleted" }>; index: ArchiveRemoteIndex }>;

export type ArchiveConflictViewModel = Readonly<{
  title: string;
  explanation: string;
  revision: number;
  terminalDeleted: boolean;
  actions: readonly ["view_remote", "reimport_as_new", "discard_local"];
}>;

/** 纯视图决策：冲突永不自动覆盖，删除永不复活旧entry。 */
export function buildArchiveConflictViewModel(conflict: ArchiveConflictViewState): ArchiveConflictViewModel {
  if (conflict.status === "deleted") {
    return Object.freeze({
      title: "云端归档已删除",
      explanation: `此归档已在云端删除（版本 ${conflict.outcome.tombstoneRevision}）。旧本机操作不会自动复活它。`,
      revision: conflict.outcome.tombstoneRevision,
      terminalDeleted: true,
      actions: ["view_remote", "reimport_as_new", "discard_local"] as const,
    });
  }
  return Object.freeze({
    title: "另一台设备已更新归档",
    explanation: `云端版本已更新至 ${conflict.outcome.currentRevision}。为防止覆盖另一台设备的文件，当前本机操作已暂停。`,
    revision: conflict.outcome.currentRevision,
    terminalDeleted: false,
    actions: ["view_remote", "reimport_as_new", "discard_local"] as const,
  });
}

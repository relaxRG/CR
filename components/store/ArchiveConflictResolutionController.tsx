import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  ArchiveConflictResolutionPanel,
} from "@/components/store/ArchiveConflictResolutionPanel";
import type { ArchiveConflictViewState } from "@/lib/store/monthly-report/archive-conflict-view-model";
import { useRawExcelArchiveStore } from "@/lib/store/monthly-report/raw-excel-archive-store";

export type ArchiveConflictResolutionControllerProps = Readonly<{
  operationId: string;
  conflict: ArchiveConflictViewState;
  onResolved?: () => void;
}>;

/**
 * 将冲突面板的三项显式用户决策连接到持久化outbox协调器。
 * 任何动作失败都保留原冲突，不会回退为自动重试或静默覆盖。
 */
export function ArchiveConflictResolutionController({
  operationId,
  conflict,
  onResolved,
}: ArchiveConflictResolutionControllerProps) {
  const {
    viewRemoteArchiveConflict,
    reimportArchiveConflictAsNew,
    discardLocalArchiveConflict,
  } = useRawExcelArchiveStore();
  const [busy, setBusy] = useState<"view" | "reimport" | "discard" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const run = async (kind: "view" | "reimport" | "discard", action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setFeedback(null);
    try {
      await action();
      if (kind === "view") setFeedback("已刷新云端权威版本。");
      if (kind === "reimport") setFeedback("已将本机文件作为新条目重新提交。");
      if (kind === "discard") {
        setFeedback("已放弃旧本机提交，不会修改云端版本。");
        onResolved?.();
      }
    } catch (error) {
      setFeedback(error instanceof Error ? `处理未完成：${error.message}` : "处理未完成，请稍后重试。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="archive-conflict-controller" style={{ paddingTop: 8 }}>
      <ArchiveConflictResolutionPanel
        conflict={conflict}
        busy={busy !== null}
        onViewRemote={() => { void run("view", () => viewRemoteArchiveConflict(operationId)); }}
        onReimportAsNew={() => { void run("reimport", async () => {
          await reimportArchiveConflictAsNew(operationId);
          onResolved?.();
        }); }}
        onDiscardLocalCopy={() => { void run("discard", () => discardLocalArchiveConflict(operationId)); }}
      />
      {feedback ? <Text testID="archive-conflict-feedback" style={{ fontSize: 12, lineHeight: 18, paddingTop: 8 }}>{feedback}</Text> : null}
    </View>
  );
}

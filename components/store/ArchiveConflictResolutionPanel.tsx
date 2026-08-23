import React from "react";
import { Pressable, Text, View } from "react-native";
import {
  buildArchiveConflictViewModel,
  type ArchiveConflictViewState,
} from "@/lib/store/monthly-report/archive-conflict-view-model";

type ArchiveConflict = ArchiveConflictViewState;

export type ArchiveConflictResolutionPanelProps = Readonly<{
  conflict: ArchiveConflict;
  busy?: boolean;
  onViewRemote: () => void;
  onReimportAsNew: () => void;
  onDiscardLocalCopy: () => void;
}>;

/**
 * 归档冲突绝不自动覆盖云端：用户必须选择查看权威版本、以新entry重导，或放弃本机副本。
 * 所有按钮由上层协调器绑定，组件本身不直接执行网络写入。
 */
export function ArchiveConflictResolutionPanel({
  conflict,
  busy = false,
  onViewRemote,
  onReimportAsNew,
  onDiscardLocalCopy,
}: ArchiveConflictResolutionPanelProps) {
  const viewModel = buildArchiveConflictViewModel(conflict);

  return (
    <View testID="archive-conflict-panel" style={{ gap: 10, paddingTop: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>{viewModel.title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: "#6B7280" }}>{viewModel.explanation}</Text>
      <Pressable testID="archive-conflict-view-remote" disabled={busy} onPress={onViewRemote}>
        <Text style={{ color: "#2563EB", fontWeight: "600" }}>查看云端版本</Text>
      </Pressable>
      <Pressable testID="archive-conflict-reimport" disabled={busy} onPress={onReimportAsNew}>
        <Text style={{ color: "#2563EB", fontWeight: "600" }}>将本机文件作为新条目重新导入</Text>
      </Pressable>
      <Pressable testID="archive-conflict-discard" disabled={busy} onPress={onDiscardLocalCopy}>
        <Text style={{ color: "#B91C1C", fontWeight: "600" }}>放弃本机副本</Text>
      </Pressable>
    </View>
  );
}

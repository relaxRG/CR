import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArchiveConflictViewModel,
  type ArchiveConflictViewState,
} from "@/lib/store/monthly-report/archive-conflict-view-model";

const index = { entries: [], fetchedAt: 1 };
const conflict: ArchiveConflictViewState = {
  status: "conflict",
  operationId: "op-conflict",
  outcome: { status: "conflict", currentRevision: 4, currentStatus: "active", operationId: "op-1" },
  index,
};
const deleted: ArchiveConflictViewState = {
  status: "deleted",
  operationId: "op-deleted",
  outcome: { status: "deleted", tombstoneRevision: 5, operationId: "op-2" },
  index,
};
const componentSource = fs.readFileSync(
  path.join(process.cwd(), "components/store/ArchiveConflictResolutionPanel.tsx"),
  "utf8",
);

describe("ArchiveConflictResolutionPanel", () => {
  it("版本冲突视图只暴露查看云端、重新导入新条目和放弃本机副本三种显式策略", () => {
    const view = buildArchiveConflictViewModel(conflict);
    expect(view).toEqual(expect.objectContaining({
      title: "另一台设备已更新归档",
      revision: 4,
      terminalDeleted: false,
      actions: ["view_remote", "reimport_as_new", "discard_local"],
    }));
    expect(view.explanation).toContain("防止覆盖另一台设备的文件");
    expect(componentSource).toContain("onViewRemote");
    expect(componentSource).toContain("onReimportAsNew");
    expect(componentSource).toContain("onDiscardLocalCopy");
  });

  it("墓碑删除视图明确禁止复活旧entry，并让组件三种操作均受busy状态禁用", () => {
    const view = buildArchiveConflictViewModel(deleted);
    expect(view).toEqual(expect.objectContaining({
      title: "云端归档已删除",
      revision: 5,
      terminalDeleted: true,
    }));
    expect(view.explanation).toContain("不会自动复活它");
    for (const testID of ["archive-conflict-view-remote", "archive-conflict-reimport", "archive-conflict-discard"]) {
      expect(componentSource).toContain(`testID="${testID}" disabled={busy}`);
    }
  });
});

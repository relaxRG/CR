import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ArchiveConflictViewState } from "@/lib/store/monthly-report/archive-conflict-view-model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = {
  viewRemoteArchiveConflict: vi.fn<() => Promise<void>>(),
  reimportArchiveConflictAsNew: vi.fn<() => Promise<void>>(),
  discardLocalArchiveConflict: vi.fn<() => Promise<void>>(),
};

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = (name: string) => ({ children, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(name, props, children as React.ReactNode);
  return {
    View: primitive("View"),
    Text: primitive("Text"),
    Pressable: primitive("Pressable"),
  };
});

vi.mock("@/lib/store/monthly-report/raw-excel-archive-store", () => ({
  useRawExcelArchiveStore: () => store,
}));

const { ArchiveConflictResolutionController } = await import(
  "@/components/store/ArchiveConflictResolutionController"
);

const conflict: ArchiveConflictViewState = {
  status: "conflict",
  operationId: "op-conflict",
  outcome: {
    status: "conflict",
    operationId: "op-conflict",
    currentRevision: 3,
    currentStatus: "active",
  },
  index: { entries: [], fetchedAt: 1 },
};

function deferred() {
  let release: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release?.() };
}

function press(renderer: ReactTestRenderer, testID: string) {
  const target = renderer.root.find((node) => node.props.testID === testID);
  target.props.onPress();
}

function flattenText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join("");
  if (React.isValidElement<{ children?: unknown }>(value)) return flattenText(value.props.children);
  return "";
}

function text(renderer: ReactTestRenderer, testID: string): string {
  return flattenText(renderer.root.find((node) => node.props.testID === testID).props.children);
}

describe("ArchiveConflictResolutionController", () => {
  afterEach(() => vi.clearAllMocks());

  it("查看云端版本时立即进入busy并在完成后展示权威索引刷新反馈", async () => {
    const operation = deferred();
    store.viewRemoteArchiveConflict.mockReturnValueOnce(operation.promise);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ArchiveConflictResolutionController operationId="op-conflict" conflict={conflict} />);
    });

    await act(async () => { press(renderer, "archive-conflict-view-remote"); });
    expect(store.viewRemoteArchiveConflict).toHaveBeenCalledWith("op-conflict");
    for (const testID of ["archive-conflict-view-remote", "archive-conflict-reimport", "archive-conflict-discard"]) {
      expect(renderer.root.find((node) => node.props.testID === testID).props.disabled).toBe(true);
    }

    await act(async () => { operation.release(); await operation.promise; });
    expect(text(renderer, "archive-conflict-feedback")).toBe("已刷新云端权威版本。");
  });

  it("重新导入以新条目提交，busy期间抑制重复点击并在成功后通知上层消除冲突", async () => {
    const operation = deferred();
    store.reimportArchiveConflictAsNew.mockReturnValueOnce(operation.promise);
    const onResolved = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ArchiveConflictResolutionController operationId="op-conflict" conflict={conflict} onResolved={onResolved} />);
    });

    await act(async () => {
      press(renderer, "archive-conflict-reimport");
      press(renderer, "archive-conflict-reimport");
    });
    expect(store.reimportArchiveConflictAsNew).toHaveBeenCalledTimes(1);
    expect(store.reimportArchiveConflictAsNew).toHaveBeenCalledWith("op-conflict");

    await act(async () => { operation.release(); await operation.promise; });
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(text(renderer, "archive-conflict-feedback")).toBe("已将本机文件作为新条目重新提交。");
  });

  it("放弃本机副本只转换本地outbox状态，成功后通知上层而不触发重新导入", async () => {
    store.discardLocalArchiveConflict.mockResolvedValueOnce();
    const onResolved = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ArchiveConflictResolutionController operationId="op-conflict" conflict={conflict} onResolved={onResolved} />);
    });

    await act(async () => { press(renderer, "archive-conflict-discard"); });
    expect(store.discardLocalArchiveConflict).toHaveBeenCalledWith("op-conflict");
    expect(store.reimportArchiveConflictAsNew).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(text(renderer, "archive-conflict-feedback")).toBe("已放弃旧本机提交，不会修改云端版本。");
  });

  it("网络中断后释放busy、保留冲突并允许用户再次尝试同一策略", async () => {
    store.reimportArchiveConflictAsNew
      .mockRejectedValueOnce(new Error("NETWORK_INTERRUPTED"))
      .mockResolvedValueOnce();
    const onResolved = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ArchiveConflictResolutionController operationId="op-conflict" conflict={conflict} onResolved={onResolved} />);
    });

    await act(async () => { press(renderer, "archive-conflict-reimport"); });
    expect(onResolved).not.toHaveBeenCalled();
    expect(text(renderer, "archive-conflict-feedback")).toBe("处理未完成：NETWORK_INTERRUPTED");
    for (const testID of ["archive-conflict-view-remote", "archive-conflict-reimport", "archive-conflict-discard"]) {
      expect(renderer.root.find((node) => node.props.testID === testID).props.disabled).toBe(false);
    }

    await act(async () => { press(renderer, "archive-conflict-reimport"); });
    expect(store.reimportArchiveConflictAsNew).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(text(renderer, "archive-conflict-feedback")).toBe("已将本机文件作为新条目重新提交。");
  });
});
